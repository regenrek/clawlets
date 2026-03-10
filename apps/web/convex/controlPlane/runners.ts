import { RUNNER_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { ensureBoundedString, ensureOptionalBoundedString, CONTROL_PLANE_LIMITS } from "../shared/controlPlane";
import { rateLimit } from "../shared/rateLimit";
import { RunnerDoc } from "../shared/validators";
import { RunnerCapabilities, RunnerDeployCredsSummary } from "../schema";
import { sanitizeDeployCredsSummary } from "./httpParsers";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const HeartbeatPatch = v.object({
  version: v.optional(v.string()),
  capabilities: v.optional(RunnerCapabilities),
  status: v.optional(v.union(...literals(RUNNER_STATUSES))),
});

function isJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function upsertHeartbeatInternalDb(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runnerName: string;
  patch: {
    version?: string;
    capabilities?: {
      supportsSealedInput?: boolean;
      sealedInputAlg?: string;
      sealedInputPubSpkiB64?: string;
      sealedInputKeyId?: string;
      supportsInfraApply?: boolean;
      hasNix?: boolean;
      nixBin?: string;
      nixVersion?: string;
    };
    status?: string;
  };
}): Promise<Id<"runners">> {
  const now = Date.now();
  const name = ensureBoundedString(params.runnerName, "runnerName", CONTROL_PLANE_LIMITS.runnerName);
  const nextStatus = params.patch.status === "offline" ? "offline" : "online";
  const existing = await params.ctx.db
    .query("runners")
    .withIndex("by_project_runner", (q) => q.eq("projectId", params.projectId).eq("runnerName", name))
    .unique();
  const next = {
    lastSeenAt: now,
    lastStatus: nextStatus,
    version: ensureOptionalBoundedString(params.patch.version, "patch.version", CONTROL_PLANE_LIMITS.hash),
    capabilities: params.patch.capabilities,
  };
  if (existing) {
    const patch: Record<string, unknown> = { ...next };
    const normalizedSummary = sanitizeDeployCredsSummary(existing.deployCredsSummary);
    if (normalizedSummary && !isJsonEqual(existing.deployCredsSummary, normalizedSummary)) {
      patch.deployCredsSummary = normalizedSummary;
    }
    await params.ctx.db.patch(existing._id, patch as any);
    return existing._id;
  }
  return await params.ctx.db.insert("runners", { projectId: params.projectId, runnerName: name, ...next });
}

export const upsertHeartbeat = mutation({
  args: {
    projectId: v.id("projects"),
    runnerName: v.string(),
    patch: HeartbeatPatch,
  },
  returns: v.object({ runnerId: v.id("runners") }),
  handler: async (ctx, { projectId, runnerName, patch }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `runners.upsertHeartbeat:${access.authed.user._id}`,
      limit: 240,
      windowMs: 60_000,
    });

    const runnerId = await upsertHeartbeatInternalDb({ ctx, projectId, runnerName, patch });
    return { runnerId };
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(RunnerDoc),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("runners")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return [...rows].sort((a, b) => a.runnerName.localeCompare(b.runnerName));
  },
});

export const upsertHeartbeatInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    runnerName: v.string(),
    patch: HeartbeatPatch,
  },
  returns: v.object({ runnerId: v.id("runners") }),
  handler: async (ctx, { projectId, runnerName, patch }) => {
    const runnerId = await upsertHeartbeatInternalDb({ ctx, projectId, runnerName, patch });
    return { runnerId };
  },
});

export const patchDeployCredsSummaryInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    runnerId: v.id("runners"),
    deployCredsSummary: RunnerDeployCredsSummary,
  },
  returns: v.null(),
  handler: async (ctx, { projectId, runnerId, deployCredsSummary }) => {
    const runner = await ctx.db.get(runnerId);
    if (!runner || runner.projectId !== projectId) return null;
    const normalized = sanitizeDeployCredsSummary(deployCredsSummary);
    if (!normalized) return null;
    await ctx.db.patch(runnerId, { deployCredsSummary: normalized });
    await ctx.runMutation(internal.controlPlane.projectCredentials.syncFromDeployCredsSummaryInternal, {
      projectId,
      summary: normalized,
    });
    return null;
  },
});

export const normalizeDeployCredsSummaries = mutation({
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
    const maxRows = Math.max(1, Math.min(10_000, Math.trunc(limit ?? 1_000)));
    const rows = await ctx.db
      .query("runners")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    let scanned = 0;
    let updated = 0;
    for (const row of rows) {
      if (scanned >= maxRows) break;
      scanned += 1;
      const normalized = sanitizeDeployCredsSummary(row.deployCredsSummary);
      if (!normalized) continue;
      if (isJsonEqual(row.deployCredsSummary, normalized)) continue;
      await ctx.db.patch(row._id, { deployCredsSummary: normalized });
      await ctx.runMutation(internal.controlPlane.projectCredentials.syncFromDeployCredsSummaryInternal, {
        projectId,
        summary: normalized,
      });
      updated += 1;
    }
    return { scanned, updated };
  },
});
