import { AsyncLocalStorage } from "node:async_hooks"
import { createHash, generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

function startContext() {
  return {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function makeRunnerKeyMaterial() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
  const spki = pair.publicKey.export({ type: "spki", format: "der" })
  const spkiBuf = Buffer.isBuffer(spki) ? spki : Buffer.from(spki)
  return {
    publicKeySpkiB64: toBase64Url(spkiBuf),
    keyId: toBase64Url(createHash("sha256").update(spkiBuf).digest()),
  }
}

describe("setup sdk", () => {
  it("blocks setup draft + operation APIs without admin access", async () => {
    vi.resetModules()
    const mutation = vi.fn(async () => null)
    const query = vi.fn(async () => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))
    vi.doMock("~/sdk/project", () => ({
      requireAdminProjectAccess: async () => {
        throw new Error("admin required")
      },
    }))
    const drafts = await import("~/sdk/setup/drafts")
    const ops = await import("~/sdk/setup/operations")

    await expect(runWithStartContext(startContext(), async () =>
      drafts.setupDraftGet({ data: { projectId: "p1" as any, host: "alpha" } }),
    )).rejects.toThrow(/admin required/i)
    await expect(runWithStartContext(startContext(), async () =>
      drafts.setupDraftSaveNonSecret({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          patch: { infrastructure: { serverType: "cpx22", location: "nbg1" } },
        },
      }),
    )).rejects.toThrow(/admin required/i)
    await expect(runWithStartContext(startContext(), async () =>
      drafts.setupDraftSaveSealedSection({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          section: "hostBootstrapCreds",
          targetRunnerId: "r1" as any,
          sealedInputB64: "cipher",
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputKeyId: "kid",
          aad: "p1:alpha:setupDraft:hostBootstrapCreds:r1",
        },
      }),
    )).rejects.toThrow(/admin required/i)
    await expect(runWithStartContext(startContext(), async () =>
      drafts.setupDraftDiscard({ data: { projectId: "p1" as any, host: "alpha" } }),
    )).rejects.toThrow(/admin required/i)
    await expect(runWithStartContext(startContext(), async () =>
      ops.startSetupApplyOperation({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          deployCreds: {},
          bootstrapSecrets: {},
        },
      }),
    )).rejects.toThrow(/admin required/i)

    expect(mutation).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it("rejects unknown non-secret patch keys before convex mutation", async () => {
    vi.resetModules()
    const mutation = vi.fn(async () => null)
    const query = vi.fn(async () => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))
    vi.doMock("~/sdk/project", () => ({
      requireAdminProjectAccess: async () => ({ role: "admin" }),
    }))
    const drafts = await import("~/sdk/setup/drafts")

    await expect(runWithStartContext(startContext(), async () =>
      drafts.setupDraftSaveNonSecret({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          patch: {
            infrastructure: {
              serverType: "cpx22",
              location: "nbg1",
            },
            unexpected: true,
          } as any,
        },
      }),
    )).rejects.toThrow(/unsupported keys/i)

    expect(mutation).not.toHaveBeenCalled()
  })

  it("rejects invalid sealed-section metadata before convex mutation", async () => {
    vi.resetModules()
    const mutation = vi.fn(async () => null)
    const query = vi.fn(async () => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))
    vi.doMock("~/sdk/project", () => ({
      requireAdminProjectAccess: async () => ({ role: "admin" }),
    }))
    const drafts = await import("~/sdk/setup/drafts")

    await expect(runWithStartContext(startContext(), async () =>
      drafts.setupDraftSaveSealedSection({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          section: "not-a-section",
          targetRunnerId: "r1" as any,
          sealedInputB64: "",
          sealedInputAlg: "",
          sealedInputKeyId: "",
          aad: "",
        } as any,
      }),
    )).rejects.toThrow()

    expect(mutation).not.toHaveBeenCalled()
  })

  it("step-save APIs do not enqueue runner jobs", async () => {
    vi.resetModules()
    const mutation = vi.fn(async (_mutation: unknown, payload: any) => {
      if (payload?.section) {
        return {
          draftId: "d1",
          hostName: payload.hostName,
          status: "draft",
          version: 2,
          nonSecretDraft: {},
          sealedSecretDrafts: {
            hostBootstrapCreds: { status: "set" },
            hostBootstrapSecrets: { status: "missing" },
          },
          updatedAt: 1,
          expiresAt: 2,
        }
      }
      return {
        draftId: "d1",
        hostName: payload.hostName,
        status: "draft",
        version: 1,
        nonSecretDraft: payload.patch || {},
        sealedSecretDrafts: {
          hostBootstrapCreds: { status: "missing" },
          hostBootstrapSecrets: { status: "missing" },
        },
        updatedAt: 1,
        expiresAt: 2,
      }
    })
    const query = vi.fn(async () => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))
    vi.doMock("~/sdk/project", () => ({
      requireAdminProjectAccess: async () => ({ role: "admin" }),
    }))
    const drafts = await import("~/sdk/setup/drafts")

    await runWithStartContext(startContext(), async () =>
      drafts.setupDraftSaveNonSecret({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          patch: { infrastructure: { serverType: "cpx22", location: "nbg1" } },
        },
      }),
    )
    await runWithStartContext(startContext(), async () =>
      drafts.setupDraftSaveSealedSection({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          section: "hostBootstrapCreds",
          targetRunnerId: "r1" as any,
          sealedInputB64: "ciphertext",
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputKeyId: "kid-1",
          aad: "p1:alpha:setupDraft:hostBootstrapCreds:r1",
        },
      }),
    )

    const payloads = mutation.mock.calls.map((call) => call[1])
    expect(payloads.some((payload) => payload?.kind === "setup_apply")).toBe(false)
    expect(payloads.some((payload) => payload?.args)).toBe(false)
    expect(payloads.some((payload) => payload?.sealedPlanB64)).toBe(false)
  })

  it("startSetupApplyOperation uses prepareStart/finalizeStart instead of legacy job reserve flow", async () => {
    vi.resetModules()
    const { publicKeySpkiB64, keyId } = makeRunnerKeyMaterial()
    const mutation = vi.fn()
      .mockResolvedValueOnce({
        draftId: "d1",
        hostName: "alpha",
        status: "committing",
        version: 4,
        targetRunnerId: "r1",
        nonSecretDraft: {
          infrastructure: { serverType: "cpx22", location: "nbg1", allowTailscaleUdpIngress: true },
          connection: {
            adminCidr: "203.0.113.10/32",
            sshExposureMode: "bootstrap",
            sshAuthorizedKeys: ["ssh-ed25519 AAAA"],
            sshKeyCount: 1,
          },
        },
        sealedSecretDrafts: {
          hostBootstrapCreds: {
            alg: "rsa-oaep-3072/aes-256-gcm",
            keyId,
            targetRunnerId: "r1",
            sealedInputB64: "deploy_cipher",
            aad: "p1:alpha:setupDraft:hostBootstrapCreds:r1",
            updatedAt: 1,
            expiresAt: Date.now() + 60_000,
          },
          hostBootstrapSecrets: {
            alg: "rsa-oaep-3072/aes-256-gcm",
            keyId,
            targetRunnerId: "r1",
            sealedInputB64: "bootstrap_cipher",
            aad: "p1:alpha:setupDraft:hostBootstrapSecrets:r1",
            updatedAt: 1,
            expiresAt: Date.now() + 60_000,
          },
        },
      })
      .mockResolvedValueOnce({
        operationId: "op_setup_1",
        attempt: 1,
        reusedOperation: false,
        targetRunnerId: "r1",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: keyId,
        sealedInputPubSpkiB64: publicKeySpkiB64,
      })
      .mockResolvedValueOnce({
        operationId: "op_setup_1",
        runId: "run_setup_1",
        jobId: "job_setup_1",
        attempt: 1,
      })
    const query = vi.fn(async () => null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))
    vi.doMock("~/sdk/project", () => ({
      requireAdminProjectAccess: async () => ({ role: "admin" }),
    }))
    const ops = await import("~/sdk/setup/operations")

    const result = await runWithStartContext(startContext(), async () =>
      ops.startSetupApplyOperation({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          deployCreds: {
            SOPS_AGE_KEY_FILE: "/tmp/key.age",
          },
          bootstrapSecrets: {
            adminPasswordHash: "$y$hash",
          },
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.operationId).toBe("op_setup_1")
    expect(result.runId).toBe("run_setup_1")
    expect(result.jobId).toBe("job_setup_1")

    const payloads = mutation.mock.calls.map((call) => call[1])
    expect(payloads.some((payload) => payload?.targetRunnerId === "r1" && payload?.planSchemaVersion === 1)).toBe(true)
    expect(payloads.some((payload) => payload?.operationId === "op_setup_1" && payload?.sealedPlanB64)).toBe(true)
    expect(payloads.some((payload) => payload?.kind === "setup_apply")).toBe(false)
    expect(payloads.some((payload) => payload?.payloadMeta?.args)).toBe(false)
  })
})
