import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import {
  ensureBoundedString,
  ensureOptionalBoundedString,
  randomToken,
  sha256Hex,
  CONTROL_PLANE_LIMITS,
} from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";

const RunnerTokenListItem = v.object({
  tokenId: v.id("runnerTokens"),
  runnerId: v.id("runners"),
  runnerName: v.optional(v.string()),
  createdAt: v.number(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
});

const RUNNER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashToken(token: string): Promise<string> {
  return await sha256Hex(token);
}

async function upsertRunner(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runnerName: string;
}): Promise<Id<"runners">> {
  const existing = await params.ctx.db
    .query("runners")
    .withIndex("by_project_runner", (q) =>
      q.eq("projectId", params.projectId).eq("runnerName", params.runnerName),
    )
    .unique();
  if (existing) return existing._id;
  return await params.ctx.db.insert("runners", {
    projectId: params.projectId,
    runnerName: params.runnerName,
    lastSeenAt: Date.now(),
    lastStatus: "offline",
  });
}

export const create = mutation({
  args: { projectId: v.id("projects"), runnerName: v.string() },
  returns: v.object({
    tokenId: v.id("runnerTokens"),
    runnerId: v.id("runners"),
    token: v.string(),
  }),
  handler: async (ctx, { projectId, runnerName }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `runnerTokens.create:${access.authed.user._id}`,
      limit: 20,
      windowMs: 60_000,
    });

    const name = ensureBoundedString(runnerName, "runnerName", CONTROL_PLANE_LIMITS.runnerName);
    const runnerId = await upsertRunner({ ctx, projectId, runnerName: name });

    const token = randomToken();
    const tokenHash = await hashToken(token);
    const now = Date.now();
    const tokenId = await ctx.db.insert("runnerTokens", {
      projectId,
      runnerId,
      runnerName: name,
      tokenHash,
      createdByUserId: access.authed.user._id,
      createdAt: now,
      expiresAt: now + RUNNER_TOKEN_TTL_MS,
    });

    return { tokenId, runnerId, token };
  },
});

export const revoke = mutation({
  args: { tokenId: v.id("runnerTokens") },
  returns: v.null(),
  handler: async (ctx, { tokenId }) => {
    const tokenRow = await ctx.db.get(tokenId);
    if (!tokenRow) fail("not_found", "runner token not found");
    const access = await requireProjectAccessMutation(ctx, tokenRow.projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `runnerTokens.revoke:${access.authed.user._id}`,
      limit: 30,
      windowMs: 60_000,
    });
    await ctx.db.patch(tokenId, { revokedAt: Date.now() });
    return null;
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(RunnerTokenListItem),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("runnerTokens")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        tokenId: row._id,
        runnerId: row.runnerId,
        runnerName: row.runnerName,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
      }));
  },
});

export const backfillRunnerNameSnapshots = mutation({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, { projectId, limit }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    const maxRows = Math.max(1, Math.min(10_000, Math.trunc(limit ?? 2_000)));
    const rows = await ctx.db
      .query("runnerTokens")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    let scanned = 0;
    let updated = 0;
    for (const row of rows) {
      if (scanned >= maxRows) break;
      scanned += 1;
      const snapshot = ensureOptionalBoundedString(
        typeof row.runnerName === "string" ? row.runnerName : undefined,
        "runnerName",
        CONTROL_PLANE_LIMITS.runnerName,
      );
      if (snapshot) continue;
      const runner = await ctx.db.get(row.runnerId);
      if (!runner || runner.projectId !== row.projectId) continue;
      await ctx.db.patch(row._id, { runnerName: runner.runnerName });
      updated += 1;
    }
    return { scanned, updated };
  },
});

const RunnerTokenAuthDoc = v.object({
  tokenId: v.id("runnerTokens"),
  projectId: v.id("projects"),
  runnerId: v.id("runners"),
  runnerName: v.string(),
  runnerLastStatus: v.union(v.literal("online"), v.literal("offline")),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
});

export const resolveAuthContextInternal = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(RunnerTokenAuthDoc, v.null()),
  handler: async (ctx, { tokenHash }) => {
    const tokenRow = await ctx.db
      .query("runnerTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!tokenRow) return null;
    let runnerName = ensureOptionalBoundedString(
      typeof tokenRow.runnerName === "string" ? tokenRow.runnerName : undefined,
      "runnerName",
      CONTROL_PLANE_LIMITS.runnerName,
    );
    let runnerLastStatus: "online" | "offline" = "online";
    if (!runnerName) {
      const runner = await ctx.db.get(tokenRow.runnerId);
      if (!runner) return null;
      if (runner.projectId !== tokenRow.projectId) return null;
      runnerName = runner.runnerName;
      runnerLastStatus = runner.lastStatus === "offline" ? "offline" : "online";
    }
    if (!runnerName) return null;
    return {
      tokenId: tokenRow._id,
      projectId: tokenRow.projectId,
      runnerId: tokenRow.runnerId,
      runnerName,
      runnerLastStatus,
      expiresAt: tokenRow.expiresAt,
      revokedAt: tokenRow.revokedAt,
      lastUsedAt: tokenRow.lastUsedAt,
    };
  },
});

export const touchLastUsedIfStaleInternal = internalMutation({
  args: {
    tokenId: v.id("runnerTokens"),
    now: v.number(),
    minIntervalMs: v.number(),
    runnerName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { tokenId, now, minIntervalMs, runnerName }) => {
    const row = await ctx.db.get(tokenId);
    if (!row) return null;
    const minTouchIntervalMs = Math.max(0, Math.trunc(minIntervalMs));
    const nextRunnerName = ensureOptionalBoundedString(
      typeof runnerName === "string" ? runnerName : undefined,
      "runnerName",
      CONTROL_PLANE_LIMITS.runnerName,
    );
    const patch: Record<string, unknown> = {};
    if (!(typeof row.lastUsedAt === "number" && now - row.lastUsedAt < minTouchIntervalMs)) {
      patch.lastUsedAt = now;
    }
    if (nextRunnerName && nextRunnerName !== row.runnerName) {
      patch.runnerName = nextRunnerName;
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(tokenId, patch as any);
    return null;
  },
});
