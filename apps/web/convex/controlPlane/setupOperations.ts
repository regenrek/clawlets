import { SEALED_INPUT_B64_MAX_CHARS } from "@clawlets/core/lib/runtime/control-plane-constants";
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { ensureBoundedString, ensureBoundedUtf8String, sha256Hex, CONTROL_PLANE_LIMITS } from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { SetupDraftSealedSections, SetupOperationStep } from "../schema";
import { SetupOperationDoc } from "../shared/validators";
import { resolveRunKind } from "./jobState";

const PLAN_JSON_MAX_BYTES = 512 * 1024;
const STEP_DETAIL_JSON_MAX_BYTES = 64 * 1024;
const SUMMARY_JSON_MAX_BYTES = 256 * 1024;
const PREPARED_OPERATION_TTL_MS = 5 * 60_000;

function normalizeHostName(raw: string): string {
  return ensureBoundedString(raw, "hostName", CONTROL_PLANE_LIMITS.hostName);
}

function normalizePlanJson(raw: string): string {
  const value = ensureBoundedUtf8String(raw, "planJson", PLAN_JSON_MAX_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("conflict", "planJson invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("conflict", "planJson must be an object");
  return JSON.stringify(parsed);
}

function normalizeOptionalJson(raw: string | undefined, field: string, maxBytes: number): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = ensureBoundedUtf8String(raw, field, maxBytes);
  try {
    JSON.parse(value);
  } catch {
    fail("conflict", `${field} invalid JSON`);
  }
  return value;
}

function initialSteps(now = Date.now()): Array<{
  stepId: "plan_validated" | "workspace_staged" | "config_written" | "deploy_creds_written" | "bootstrap_secrets_initialized" | "bootstrap_secrets_verified" | "persist_committed";
  status: "pending";
  safeMessage: "Pending";
  detailJson?: undefined;
  retryable: boolean;
  updatedAt: number;
}> {
  const stepIds = [
    "plan_validated",
    "workspace_staged",
    "config_written",
    "deploy_creds_written",
    "bootstrap_secrets_initialized",
    "bootstrap_secrets_verified",
    "persist_committed",
  ] as const;
  return stepIds.map((stepId) => ({
    stepId,
    status: "pending" as const,
    safeMessage: "Pending" as const,
    retryable: stepId !== "persist_committed",
    updatedAt: now,
  }));
}

async function getLatestByHost(params: {
  ctx: MutationCtx | QueryCtx;
  projectId: Id<"projects">;
  hostName: string;
}): Promise<Doc<"setupOperations"> | null> {
  const rows = await params.ctx.db
    .query("setupOperations")
    .withIndex("by_project_host_createdAt", (q) => q.eq("projectId", params.projectId).eq("hostName", params.hostName))
    .order("desc")
    .take(1);
  return rows[0] ?? null;
}

async function getByCurrentJobId(params: {
  ctx: MutationCtx;
  jobId: Id<"jobs">;
}): Promise<Doc<"setupOperations"> | null> {
  return await params.ctx.db
    .query("setupOperations")
    .withIndex("by_currentJobId", (q) => q.eq("currentJobId", params.jobId))
    .unique();
}

function replaceStep(
  steps: Doc<"setupOperations">["steps"],
  patch: {
    stepId: Doc<"setupOperations">["steps"][number]["stepId"];
    status: Doc<"setupOperations">["steps"][number]["status"];
    safeMessage: string;
    detailJson?: string;
    retryable: boolean;
    updatedAt: number;
  },
): Doc<"setupOperations">["steps"] {
  return steps.map((step) => (step.stepId === patch.stepId ? patch : step));
}

async function insertSetupApplyAuditLog(params: {
  ctx: MutationCtx;
  userId: Id<"users">;
  projectId: Id<"projects">;
  action: "setup.apply.start" | "setup.apply.retry" | "setup.apply.fail" | "setup.apply.commit";
  hostName: string;
  runId?: Id<"runs">;
}): Promise<void> {
  await params.ctx.db.insert("auditLogs", {
    ts: Date.now(),
    userId: params.userId,
    projectId: params.projectId,
    action: params.action,
    target: { host: params.hostName },
    ...(params.runId ? { data: { runId: params.runId } } : {}),
  });
}

async function requireTargetRunner(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  targetRunnerId: Id<"runners">;
}): Promise<{
  runnerId: Id<"runners">;
  sealedInputAlg: string;
  sealedInputKeyId: string;
  sealedInputPubSpkiB64: string;
}> {
  const runner = await params.ctx.db.get(params.targetRunnerId);
  if (!runner || runner.projectId !== params.projectId) fail("not_found", "target runner not found");
  if (runner.lastStatus !== "online") fail("conflict", "target runner offline");
  const caps = runner.capabilities;
  const alg = String(caps?.sealedInputAlg || "").trim();
  const keyId = String(caps?.sealedInputKeyId || "").trim();
  const pub = String(caps?.sealedInputPubSpkiB64 || "").trim();
  if (!caps?.supportsSealedInput || !alg || !keyId || !pub) {
    fail("conflict", "target runner sealed-input capabilities incomplete");
  }
  return {
    runnerId: params.targetRunnerId,
    sealedInputAlg: alg,
    sealedInputKeyId: keyId,
    sealedInputPubSpkiB64: pub,
  };
}

async function createRunAndJob(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  hostName: string;
  operationId: Id<"setupOperations">;
  initiatedByUserId: Id<"users">;
  targetRunnerId: Id<"runners">;
  sealedPlanB64: string;
  sealedInputAlg: string;
  sealedInputKeyId: string;
  planJson: string;
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs"> }> {
  const now = Date.now();
  const runId = await params.ctx.db.insert("runs", {
    projectId: params.projectId,
    kind: resolveRunKind("setup_apply"),
    status: "queued",
    title: `Setup apply (${params.hostName})`,
    host: params.hostName,
    initiatedByUserId: params.initiatedByUserId,
    createdAt: now,
    startedAt: now,
  });
  const jobId = await params.ctx.db.insert("jobs", {
    projectId: params.projectId,
    runId,
    kind: "setup_apply",
    status: "queued",
    payload: {
      operationId: params.operationId,
      hostName: params.hostName,
      note: "setup apply operation",
    } as any,
    payloadHash: await sha256Hex(params.planJson),
    targetRunnerId: params.targetRunnerId,
    sealedInputB64: ensureBoundedUtf8String(params.sealedPlanB64, "sealedPlanB64", SEALED_INPUT_B64_MAX_CHARS),
    sealedInputAlg: ensureBoundedString(params.sealedInputAlg, "sealedInputAlg", CONTROL_PLANE_LIMITS.hash),
    sealedInputKeyId: ensureBoundedString(params.sealedInputKeyId, "sealedInputKeyId", CONTROL_PLANE_LIMITS.hash),
    sealedInputRequired: true,
    attempt: 0,
    createdAt: now,
  });
  return { runId, jobId };
}

export const latestByProjectHost = query({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
  },
  returns: v.union(SetupOperationDoc, v.null()),
  handler: async (ctx, { projectId, hostName }) => {
    await requireProjectAccessQuery(ctx, projectId);
    return await getLatestByHost({ ctx, projectId, hostName: normalizeHostName(hostName) });
  },
});

export const get = query({
  args: { operationId: v.id("setupOperations") },
  returns: v.union(SetupOperationDoc, v.null()),
  handler: async (ctx, { operationId }) => {
    const row = await ctx.db.get(operationId);
    if (!row) return null;
    await requireProjectAccessQuery(ctx, row.projectId);
    return row;
  },
});

export const prepareStart = mutation({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
    targetRunnerId: v.id("runners"),
    planSchemaVersion: v.number(),
    planJson: v.string(),
    sealedSecretDrafts: SetupDraftSealedSections,
  },
  returns: v.object({
    operationId: v.id("setupOperations"),
    attempt: v.number(),
    reusedOperation: v.boolean(),
    targetRunnerId: v.id("runners"),
    sealedInputAlg: v.string(),
    sealedInputKeyId: v.string(),
    sealedInputPubSpkiB64: v.string(),
  }),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `setupOperations.prepareStart:${access.authed.user._id}`, limit: 60, windowMs: 60_000 });

    const hostName = normalizeHostName(args.hostName);
    const planJson = normalizePlanJson(args.planJson);
    const latest = await getLatestByHost({ ctx, projectId: args.projectId, hostName });
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      fail("conflict", "setup apply already running for host");
    }
    const runner = await requireTargetRunner({
      ctx,
      projectId: args.projectId,
      targetRunnerId: args.targetRunnerId,
    });

    const shouldReuse =
      Boolean(latest)
      && latest?.status === "failed"
      && latest.planSchemaVersion === Math.trunc(args.planSchemaVersion)
      && latest.targetRunnerId === args.targetRunnerId
      && latest.planJson === planJson;
    const now = Date.now();
    if (shouldReuse && latest) {
      const attempt = Math.max(1, Math.trunc(latest.currentAttempt || 0) + 1);
      await ctx.db.patch(latest._id, {
        status: "queued",
        currentAttempt: attempt,
        preparedExpiresAt: now + PREPARED_OPERATION_TTL_MS,
        currentJobId: undefined,
        currentRunId: undefined,
        steps: initialSteps(now),
        startedAt: undefined,
        finishedAt: undefined,
        terminalMessage: undefined,
        summaryJson: undefined,
      });
      return {
        operationId: latest._id,
        attempt,
        reusedOperation: true,
        targetRunnerId: runner.runnerId,
        sealedInputAlg: runner.sealedInputAlg,
        sealedInputKeyId: runner.sealedInputKeyId,
        sealedInputPubSpkiB64: runner.sealedInputPubSpkiB64,
      };
    }

    const operationId = await ctx.db.insert("setupOperations", {
      projectId: args.projectId,
      hostName,
      status: "queued",
      planSchemaVersion: Math.max(1, Math.trunc(args.planSchemaVersion || 1)),
      planJson,
      targetRunnerId: args.targetRunnerId,
      sealedSecretDrafts: args.sealedSecretDrafts,
      currentAttempt: 1,
      preparedExpiresAt: now + PREPARED_OPERATION_TTL_MS,
      currentJobId: undefined,
      currentRunId: undefined,
      runHistory: [],
      steps: initialSteps(now),
      createdByUserId: access.authed.user._id,
      createdAt: now,
      startedAt: undefined,
      finishedAt: undefined,
      terminalMessage: undefined,
      summaryJson: undefined,
    });
    return {
      operationId,
      attempt: 1,
      reusedOperation: false,
      targetRunnerId: runner.runnerId,
      sealedInputAlg: runner.sealedInputAlg,
      sealedInputKeyId: runner.sealedInputKeyId,
      sealedInputPubSpkiB64: runner.sealedInputPubSpkiB64,
    };
  },
});

export const finalizeStart = mutation({
  args: {
    projectId: v.id("projects"),
    operationId: v.id("setupOperations"),
    attempt: v.number(),
    sealedPlanB64: v.string(),
    sealedInputAlg: v.string(),
    sealedInputKeyId: v.string(),
  },
  returns: v.object({
    operationId: v.id("setupOperations"),
    runId: v.id("runs"),
    jobId: v.id("jobs"),
    attempt: v.number(),
  }),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `setupOperations.finalizeStart:${access.authed.user._id}`, limit: 60, windowMs: 60_000 });

    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.projectId !== args.projectId) fail("not_found", "setup operation not found");
    if (Math.max(1, Math.trunc(operation.currentAttempt || 1)) !== Math.max(1, Math.trunc(args.attempt || 1))) {
      fail("conflict", "setup operation attempt mismatch");
    }
    if (operation.currentJobId || operation.currentRunId) fail("conflict", "setup operation already finalized");
    if (typeof operation.preparedExpiresAt === "number" && operation.preparedExpiresAt < Date.now()) {
      await ctx.db.patch(operation._id, {
        status: "failed",
        finishedAt: Date.now(),
        terminalMessage: "setup apply preparation expired",
      });
      fail("conflict", "setup operation preparation expired");
    }

    const runner = await requireTargetRunner({
      ctx,
      projectId: args.projectId,
      targetRunnerId: operation.targetRunnerId,
    });
    if (runner.sealedInputAlg !== String(args.sealedInputAlg || "").trim()) fail("conflict", "sealedInputAlg mismatch");
    if (runner.sealedInputKeyId !== String(args.sealedInputKeyId || "").trim()) fail("conflict", "sealedInputKeyId mismatch");

    const { runId, jobId } = await createRunAndJob({
      ctx,
      projectId: args.projectId,
      hostName: operation.hostName,
      operationId: operation._id,
      initiatedByUserId: access.authed.user._id,
      targetRunnerId: operation.targetRunnerId,
      sealedPlanB64: args.sealedPlanB64,
      sealedInputAlg: args.sealedInputAlg,
      sealedInputKeyId: args.sealedInputKeyId,
      planJson: operation.planJson,
    });
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "queued",
      preparedExpiresAt: undefined,
      currentJobId: jobId,
      currentRunId: runId,
      runHistory: [
        ...operation.runHistory,
        {
          attempt: operation.currentAttempt,
          jobId,
          runId,
          status: "queued",
          startedAt: now,
        },
      ],
      steps: initialSteps(now),
      startedAt: undefined,
      finishedAt: undefined,
      terminalMessage: undefined,
      summaryJson: undefined,
    });
    await insertSetupApplyAuditLog({
      ctx,
      userId: access.authed.user._id,
      projectId: args.projectId,
      action: operation.currentAttempt > 1 ? "setup.apply.retry" : "setup.apply.start",
      hostName: operation.hostName,
      runId,
    });
    return { operationId: operation._id, runId, jobId, attempt: operation.currentAttempt };
  },
});

export const abortPreparedStart = mutation({
  args: {
    projectId: v.id("projects"),
    operationId: v.id("setupOperations"),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { projectId, operationId, message }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    const operation = await ctx.db.get(operationId);
    if (!operation || operation.projectId !== projectId) return null;
    if (operation.currentJobId || operation.currentRunId) return null;
    await ctx.db.patch(operation._id, {
      status: "failed",
      finishedAt: Date.now(),
      terminalMessage: sanitizeErrorMessage(message || "setup apply start failed", "setup apply start failed"),
    });
    await insertSetupApplyAuditLog({
      ctx,
      userId: access.authed.user._id,
      projectId,
      action: "setup.apply.fail",
      hostName: operation.hostName,
    });
    return null;
  },
});

export const progressInternal = internalMutation({
  args: {
    jobId: v.id("jobs"),
    leaseId: v.string(),
    step: SetupOperationStep,
  },
  returns: v.null(),
  handler: async (ctx, { jobId, leaseId, step }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.leaseId !== leaseId) return null;
    const operation = await getByCurrentJobId({ ctx, jobId });
    if (!operation) return null;
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "running",
      startedAt: operation.startedAt ?? now,
      steps: replaceStep(operation.steps, {
        ...step,
        safeMessage: ensureBoundedString(step.safeMessage, "step.safeMessage", CONTROL_PLANE_LIMITS.errorMessage),
        detailJson: normalizeOptionalJson(step.detailJson, "step.detailJson", STEP_DETAIL_JSON_MAX_BYTES),
        updatedAt: now,
      }),
      runHistory: operation.runHistory.map((row) => (
        row.attempt === operation.currentAttempt
          ? { ...row, status: "running" as const }
          : row
      )),
    });
    return null;
  },
});

export const finishAttemptInternal = internalMutation({
  args: {
    jobId: v.id("jobs"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    terminalMessage: v.optional(v.string()),
    summaryJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, status, terminalMessage, summaryJson }) => {
    const operation = await getByCurrentJobId({ ctx, jobId });
    if (!operation) return null;
    const now = Date.now();
    const normalizedTerminal =
      status === "failed"
        ? sanitizeErrorMessage(terminalMessage || "setup apply failed", "setup apply failed")
        : terminalMessage ? ensureBoundedString(terminalMessage, "terminalMessage", CONTROL_PLANE_LIMITS.errorMessage) : undefined;
    const normalizedSummaryJson = normalizeOptionalJson(summaryJson, "summaryJson", SUMMARY_JSON_MAX_BYTES);

    await ctx.db.patch(operation._id, {
      status,
      finishedAt: now,
      terminalMessage: normalizedTerminal,
      summaryJson: normalizedSummaryJson,
      runHistory: operation.runHistory.map((row) => (
        row.attempt === operation.currentAttempt
          ? { ...row, status, finishedAt: now }
          : row
      )),
    });

    const draft = await ctx.db
      .query("setupDrafts")
      .withIndex("by_project_host", (q) => q.eq("projectId", operation.projectId).eq("hostName", operation.hostName))
      .unique();
    if (draft) {
      await ctx.db.patch(draft._id, {
        status: status === "succeeded" ? "committed" : "failed",
        version: Math.max(0, Math.trunc(draft.version || 0)) + 1,
        updatedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60_000,
        committedAt: status === "succeeded" ? now : undefined,
        lastError: status === "failed" ? normalizedTerminal : undefined,
      });
    }
    const run = operation.currentRunId ? await ctx.db.get(operation.currentRunId) : null;
    await insertSetupApplyAuditLog({
      ctx,
      userId: run?.initiatedByUserId || operation.createdByUserId,
      projectId: operation.projectId,
      action: status === "succeeded" ? "setup.apply.commit" : "setup.apply.fail",
      hostName: operation.hostName,
      runId: operation.currentRunId,
    });
    return null;
  },
});

export async function __test_finishAttemptInternalHandler(
  ctx: MutationCtx,
  args: {
    jobId: Id<"jobs">;
    status: "succeeded" | "failed";
    terminalMessage?: string;
    summaryJson?: string;
  },
) {
  return await (finishAttemptInternal as any)._handler(ctx, args);
}
