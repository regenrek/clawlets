import { describe, expect, it, vi } from "vitest"

function makeCtx(params?: {
  setupOperations?: any[]
  runners?: any[]
}) {
  let idCounter = 0
  const setupOperations = new Map<string, any>((params?.setupOperations ?? []).map((row) => [String(row._id), { ...row }]))
  const runners = new Map<string, any>((params?.runners ?? []).map((row) => [String(row._id), { ...row }]))
  const runs = new Map<string, any>()
  const jobs = new Map<string, any>()
  const auditLogs: any[] = []

  const ctx = {
    db: {
      get: async (id: string) => {
        const key = String(id)
        if (setupOperations.has(key)) return setupOperations.get(key)
        if (runners.has(key)) return runners.get(key)
        if (runs.has(key)) return runs.get(key)
        if (jobs.has(key)) return jobs.get(key)
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
              : []
          const filtered = source.filter((row) =>
            Object.entries(eqFilters).every(([field, value]) => row[field] === value),
          )
          return {
            order: () => ({
              take: async (limit: number) => filtered.slice(0, limit),
            }),
            unique: async () => filtered[0] ?? null,
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
        throw new Error(`missing patch target: ${key}`)
      },
    },
  }

  return { ctx, setupOperations, runs, jobs, auditLogs }
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

describe("setup operations lifecycle", () => {
  it("creates a fresh operation and emits setup.apply.start on finalize", async () => {
    const mod = await loadModule()
    const { ctx, setupOperations, runs, jobs, auditLogs } = makeCtx({
      runners: [{
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
    })

    const prepared = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })

    expect(prepared.reusedOperation).toBe(false)
    expect(prepared.attempt).toBe(1)

    const started = await (mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: prepared.operationId,
      attempt: 1,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })

    const operation = setupOperations.get(String(prepared.operationId))
    expect(operation.currentRunId).toBe(started.runId)
    expect(operation.currentJobId).toBe(started.jobId)
    expect(operation.runHistory).toHaveLength(1)
    expect(runs.get(String(started.runId))?.title).toBe("Setup apply (alpha)")
    expect(jobs.get(String(started.jobId))?.kind).toBe("setup_apply")
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0]).toMatchObject({
      action: "setup.apply.start",
      target: { host: "alpha" },
      data: { runId: started.runId },
    })
  })

  it("reuses a failed operation for retry and emits setup.apply.retry", async () => {
    const mod = await loadModule()
    const { ctx, setupOperations, auditLogs } = makeCtx({
      runners: [{
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
      setupOperations: [{
        _id: "op-existing",
        projectId: "p1",
        hostName: "alpha",
        status: "failed",
        planSchemaVersion: 1,
        planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
        targetRunnerId: "runner-1",
        sealedSecretDrafts: {},
        currentAttempt: 1,
        runHistory: [],
        steps: [],
        createdByUserId: "u1",
        createdAt: 1,
      }],
    })

    const prepared = await (mod.prepareStart as any)._handler(ctx as any, {
      projectId: "p1",
      hostName: "alpha",
      targetRunnerId: "runner-1",
      planSchemaVersion: 1,
      planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
      sealedSecretDrafts: {},
    })

    expect(prepared.reusedOperation).toBe(true)
    expect(prepared.operationId).toBe("op-existing")
    expect(prepared.attempt).toBe(2)

    const started = await (mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: "op-existing",
      attempt: 2,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })

    const operation = setupOperations.get("op-existing")
    expect(operation.currentAttempt).toBe(2)
    expect(operation.runHistory).toHaveLength(1)
    expect(operation.runHistory[0]?.attempt).toBe(2)
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0]).toMatchObject({
      action: "setup.apply.retry",
      target: { host: "alpha" },
      data: { runId: started.runId },
    })
  })

  it("rejects finalizeStart when the prepared operation expired", async () => {
    const mod = await loadModule()
    const { ctx, setupOperations, auditLogs } = makeCtx({
      runners: [{
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
      setupOperations: [{
        _id: "op-expired",
        projectId: "p1",
        hostName: "alpha",
        status: "queued",
        planSchemaVersion: 1,
        planJson: JSON.stringify({ hostName: "alpha", schemaVersion: 1 }),
        targetRunnerId: "runner-1",
        sealedSecretDrafts: {},
        currentAttempt: 1,
        preparedExpiresAt: Date.now() - 1,
        runHistory: [],
        steps: [],
        createdByUserId: "u1",
        createdAt: 1,
      }],
    })

    await expect((mod.finalizeStart as any)._handler(ctx as any, {
      projectId: "p1",
      operationId: "op-expired",
      attempt: 1,
      sealedPlanB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid-1",
    })).rejects.toThrow(/preparation expired/i)

    expect(setupOperations.get("op-expired")?.status).toBe("failed")
    expect(setupOperations.get("op-expired")?.terminalMessage).toBe("setup apply preparation expired")
    expect(auditLogs).toHaveLength(0)
  })
})
