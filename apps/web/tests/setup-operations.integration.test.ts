import { describe, expect, it, vi } from "vitest"

function makeCtx() {
  let idCounter = 0
  const setupOperations = new Map<string, any>()
  const runners = new Map<string, any>([
    ["runner-1", {
      _id: "runner-1",
      projectId: "p1",
      lastStatus: "online",
      capabilities: {
        supportsSealedInput: true,
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: "kid-1",
        sealedInputPubSpkiB64: "pub-1",
      },
    }],
  ])
  const runs = new Map<string, any>()
  const jobs = new Map<string, any>()
  const setupDrafts = new Map<string, any>([
    ["draft-1", {
      _id: "draft-1",
      projectId: "p1",
      hostName: "alpha",
      status: "committing",
      version: 1,
      nonSecretDraft: {},
      sealedSecretDrafts: {},
      updatedAt: 1,
      expiresAt: Date.now() + 60_000,
    }],
  ])
  const auditLogs: any[] = []

  const ctx = {
    db: {
      get: async (id: string) => {
        const key = String(id)
        if (setupOperations.has(key)) return setupOperations.get(key)
        if (runners.has(key)) return runners.get(key)
        if (runs.has(key)) return runs.get(key)
        if (jobs.has(key)) return jobs.get(key)
        if (setupDrafts.has(key)) return setupDrafts.get(key)
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
          const source =
            table === "setupOperations"
              ? [...setupOperations.values()]
              : table === "setupDrafts"
                ? [...setupDrafts.values()]
                : []
          const filtered = source.filter((row) =>
            Object.entries(eqFilters).every(([field, value]) => row[field] === value),
          )
          return {
            unique: async () => filtered[0] ?? null,
            order: () => ({
              take: async (limit: number) => filtered.slice(0, limit),
            }),
          }
        },
      }),
      insert: async (table: string, value: any) => {
        idCounter += 1
        const id = `${table}-${idCounter}`
        const row = { _id: id, ...value }
        if (table === "setupOperations") setupOperations.set(id, row)
        else if (table === "runs") runs.set(id, row)
        else if (table === "jobs") jobs.set(id, row)
        else if (table === "auditLogs") auditLogs.push(row)
        else throw new Error(`unexpected insert table: ${table}`)
        return id
      },
      patch: async (id: string, update: any) => {
        const key = String(id)
        if (setupOperations.has(key)) {
          setupOperations.set(key, { ...setupOperations.get(key), ...update })
          return
        }
        if (runs.has(key)) {
          runs.set(key, { ...runs.get(key), ...update })
          return
        }
        if (jobs.has(key)) {
          jobs.set(key, { ...jobs.get(key), ...update })
          return
        }
        if (setupDrafts.has(key)) {
          setupDrafts.set(key, { ...setupDrafts.get(key), ...update })
          return
        }
        throw new Error(`missing patch target: ${key}`)
      },
    },
  }

  return { ctx, setupOperations, runs, jobs, setupDrafts, auditLogs }
}

async function loadModule() {
  vi.resetModules()
  vi.doMock("../convex/shared/auth", () => ({
    requireProjectAccessMutation: vi.fn(async () => ({
      authed: { user: { _id: "u1" } },
      role: "admin",
    })),
    requireProjectAccessQuery: vi.fn(async () => ({
      authed: { user: { _id: "u1" } },
      role: "admin",
    })),
    requireAdmin: vi.fn(() => {}),
  }))
  vi.doMock("../convex/shared/rateLimit", () => ({
    rateLimit: vi.fn(async () => {}),
  }))
  return await import("../convex/controlPlane/setupOperations")
}

describe("setup operations integration", () => {
  it("runs a full prepare -> finalize -> progress -> finish success lifecycle", async () => {
    const mod = await loadModule()
    const { ctx, setupOperations, runs, jobs, auditLogs, setupDrafts } = makeCtx()

    const prepared = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })
    const started = await (mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: prepared.operationId,
      attempt: prepared.attempt,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })

    jobs.get(String(started.jobId)).leaseId = "lease-1"
    await (mod.progressInternal as any)._handler(ctx as any, {
      jobId: started.jobId,
      leaseId: "lease-1",
      step: {
        stepId: "config_written",
        status: "succeeded",
        safeMessage: "Staged config written",
        retryable: true,
        updatedAt: 1,
      },
    })
    await mod.__test_finishAttemptInternalHandler(ctx as any, {
      jobId: started.jobId,
      status: "succeeded",
      summaryJson: JSON.stringify({ ok: true }),
    })

    const operation = setupOperations.get(String(prepared.operationId))
    expect(operation.status).toBe("succeeded")
    expect(operation.currentRunId).toBe(started.runId)
    expect(operation.runHistory).toHaveLength(1)
    expect(runs.get(String(started.runId))?.title).toBe("Setup apply (alpha)")
    expect(jobs.get(String(started.jobId))?.payload?.operationId).toBe(prepared.operationId)
    expect(setupDrafts.get("draft-1")?.status).toBe("committed")
    expect(auditLogs.map((row) => row.action)).toEqual(["setup.apply.start", "setup.apply.commit"])
  })

  it("reuses the same operation id after a failed attempt and appends a retry run", async () => {
    const mod = await loadModule()
    const { ctx, setupOperations, jobs, auditLogs } = makeCtx()

    const prepared = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })
    const first = await (mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: prepared.operationId,
      attempt: prepared.attempt,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })
    jobs.get(String(first.jobId)).leaseId = "lease-1"
    await mod.__test_finishAttemptInternalHandler(ctx as any, {
      jobId: first.jobId,
      status: "failed",
      terminalMessage: "setup apply failed",
    })

    const retriedPrepare = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })
    const second = await (mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: retriedPrepare.operationId,
      attempt: retriedPrepare.attempt,
      sealedPlanB64: "ciphertext-2",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })

    const operation = setupOperations.get(String(prepared.operationId))
    expect(retriedPrepare.operationId).toBe(prepared.operationId)
    expect(retriedPrepare.attempt).toBe(2)
    expect(operation.currentAttempt).toBe(2)
    expect(operation.runHistory).toHaveLength(2)
    expect(operation.runHistory[0]?.status).toBe("failed")
    expect(operation.runHistory[1]?.runId).toBe(second.runId)
    expect(auditLogs.map((row) => row.action)).toEqual(["setup.apply.start", "setup.apply.fail", "setup.apply.retry"])
  })

  it("rejects expired or replayed finalizeStart attempts", async () => {
    const mod = await loadModule()
    const { ctx, setupOperations } = makeCtx()

    const prepared = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })
    const operation = setupOperations.get(String(prepared.operationId))
    operation.preparedExpiresAt = Date.now() - 1

    await expect((mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: prepared.operationId,
      attempt: prepared.attempt,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })).rejects.toThrow(/preparation expired/i)

    const freshPrepared = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })
    const freshOperation = setupOperations.get(String(freshPrepared.operationId))
    freshOperation.currentJobId = "existing-job"
    freshOperation.currentRunId = "existing-run"

    await expect((mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: freshPrepared.operationId,
      attempt: freshPrepared.attempt,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })).rejects.toThrow(/already finalized/i)
  })
})
