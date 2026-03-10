import { describe, expect, it } from "vitest"

import { progressInternal } from "../convex/controlPlane/setupOperations"
import { __test_finishAttemptInternalHandler } from "../convex/controlPlane/setupOperations"

function makeCtx() {
  const initialSteps = [
    "plan_validated",
    "workspace_staged",
    "config_written",
    "deploy_creds_written",
    "bootstrap_secrets_initialized",
    "bootstrap_secrets_verified",
    "persist_committed",
  ].map((stepId) => ({
    stepId,
    status: "pending",
    safeMessage: "Pending",
    retryable: stepId !== "persist_committed",
    updatedAt: 1,
  }))
  const jobs = new Map<string, any>([
    ["job1", {
      _id: "job1",
      leaseId: "lease1",
      projectId: "p1",
    }],
  ])
  const setupOperations = new Map<string, any>([
    ["op1", {
      _id: "op1",
      projectId: "p1",
      hostName: "alpha",
      status: "running",
      planSchemaVersion: 1,
      planJson: "{\"hostName\":\"alpha\"}",
      targetRunnerId: "r1",
      sealedSecretDrafts: {},
      currentAttempt: 1,
      currentJobId: "job1",
      currentRunId: "run1",
      runHistory: [
        {
          attempt: 1,
          jobId: "job1",
          runId: "run1",
          status: "running",
          startedAt: 1,
        },
      ],
      steps: initialSteps,
      createdByUserId: "u1",
      createdAt: 1,
    }],
  ])
  const setupDrafts = new Map<string, any>([
    ["draft1", {
      _id: "draft1",
      projectId: "p1",
      hostName: "alpha",
      status: "committing",
      version: 3,
      nonSecretDraft: {},
      sealedSecretDrafts: {},
      updatedAt: 1,
      expiresAt: Date.now() + 60_000,
    }],
  ])
  const runs = new Map<string, any>([
    ["run1", {
      _id: "run1",
      projectId: "p1",
      initiatedByUserId: "u-run",
    }],
  ])
  const auditLogs: any[] = []

  const ctx = {
    db: {
      get: async (id: string) => {
        const key = String(id)
        if (jobs.has(key)) return jobs.get(key)
        if (setupOperations.has(key)) return setupOperations.get(key)
        if (setupDrafts.has(key)) return setupDrafts.get(key)
        if (runs.has(key)) return runs.get(key)
        return null
      },
      query: (table: string) => ({
        withIndex: (_index: string, fn: any) => {
          const eqFilters: Record<string, any> = {}
          const q: any = {
            eq: (field: string, value: any) => {
              eqFilters[field] = value
              return q
            },
          }
          fn(q)
          const rows =
            table === "setupOperations"
              ? [...setupOperations.values()]
              : table === "setupDrafts"
                ? [...setupDrafts.values()]
                : []
          const filtered = rows.filter((row) =>
            Object.entries(eqFilters).every(([field, value]) => row[field] === value),
          )
          return {
            unique: async () => filtered[0] ?? null,
            collect: async () => filtered,
            take: async (limit: number) => filtered.slice(0, limit),
            order: () => ({
              take: async (limit: number) => filtered.slice(0, limit),
            }),
          }
        },
      }),
      patch: async (id: string, update: any) => {
        const key = String(id)
        if (setupOperations.has(key)) {
          setupOperations.set(key, { ...setupOperations.get(key), ...update })
          return
        }
        if (setupDrafts.has(key)) {
          setupDrafts.set(key, { ...setupDrafts.get(key), ...update })
          return
        }
        if (runs.has(key)) {
          runs.set(key, { ...runs.get(key), ...update })
          return
        }
        throw new Error(`missing patch target: ${key}`)
      },
      insert: async (table: string, value: any) => {
        if (table !== "auditLogs") throw new Error(`unexpected insert table: ${table}`)
        auditLogs.push(value)
        return `audit-${auditLogs.length}`
      },
    },
  }

  return { ctx, setupOperations, setupDrafts, auditLogs }
}

describe("setup operations failure sanitization", () => {
  it("stores structured setup apply step progress on the operation row", async () => {
    const { ctx, setupOperations } = makeCtx()

    await (progressInternal as any)._handler(ctx as any, {
      jobId: "job1",
      leaseId: "lease1",
      step: {
        stepId: "config_written",
        status: "failed",
        safeMessage: "Config validation failed",
        detailJson: JSON.stringify({ path: "hosts.alpha.provisioning.provider" }),
        retryable: true,
        updatedAt: 1,
      },
    })

    const operation = setupOperations.get("op1")
    const step = operation.steps.find((row: any) => row.stepId === "config_written")
    expect(operation.status).toBe("running")
    expect(step).toMatchObject({
      stepId: "config_written",
      status: "failed",
      safeMessage: "Config validation failed",
      detailJson: JSON.stringify({ path: "hosts.alpha.provisioning.provider" }),
      retryable: true,
    })
  })

  it("redacts terminal failure detail and records a fail audit log", async () => {
    const { ctx, setupOperations, setupDrafts, auditLogs } = makeCtx()

    await __test_finishAttemptInternalHandler(ctx as any, {
      jobId: "job1" as any,
      status: "failed",
      terminalMessage: "Authorization: Bearer supersecret DISCORD_TOKEN=abc123",
    })

    const operation = setupOperations.get("op1")
    expect(operation.status).toBe("failed")
    expect(String(operation.terminalMessage || "")).toBe("setup apply failed")
    expect(String(operation.terminalMessage || "")).not.toContain("supersecret")
    expect(String(operation.terminalMessage || "")).not.toContain("abc123")

    const draft = setupDrafts.get("draft1")
    expect(draft.status).toBe("failed")
    expect(String(draft.lastError || "")).toBe("setup apply failed")
    expect(String(draft.lastError || "")).not.toContain("supersecret")
    expect(String(draft.lastError || "")).not.toContain("abc123")

    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0]).toMatchObject({
      projectId: "p1",
      userId: "u-run",
      action: "setup.apply.fail",
      target: { host: "alpha" },
      data: { runId: "run1" },
    })
  })
})
