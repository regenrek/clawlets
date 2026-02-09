import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

type MutationPayload = {
  executionMode?: string
  kind?: string
  workspaceRef?: { kind?: string; id?: string }
  payloadMeta?: { args?: unknown } & Record<string, unknown>
} & Record<string, unknown>

async function loadProjectsModule() {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: Record<string, unknown>) => {
    if (payload?.executionMode) return { projectId: "p1" }
    if (typeof payload?.kind === "string" && !("payloadMeta" in (payload || {}))) return { runId: "r1" }
    if (typeof payload?.kind === "string" && "payloadMeta" in (payload || {})) return { runId: "r1", jobId: "j1" }
    if (typeof payload?.runnerName === "string") return { token: "tok_1" }
    return null
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation }) as any,
  }))

  const mod = await import("~/sdk/project")
  return { mod, mutation }
}

describe("project create/import runner queue", () => {
  it("queues remote project_init with structured payload and no args", async () => {
    const { mod, mutation } = await loadProjectsModule()
    const result = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.projectCreateStart({
          data: {
            name: "Fleet A",
            runnerRepoPath: " ~/.clawlets//projects\\Fleet-A/ ",
            host: "alpha",
            runnerName: "runner-alpha",
            templateRepo: "owner/repo",
            templatePath: "templates/default",
            templateRef: "main",
          },
        }),
    )

	    expect(result).toMatchObject({
	      projectId: "p1",
	      runId: "r1",
      token: "tok_1",
      runnerName: "runner-alpha",
      runnerRepoPath: "~/.clawlets/projects/Fleet-A",
      host: "alpha",
    })

	    const payloads = mutation.mock.calls.map(([, payload]) => (payload ?? {}) as MutationPayload)
	    const createPayload = payloads
	      .find((payload) => payload?.executionMode === "remote_runner")
    expect(createPayload).toMatchObject({
      executionMode: "remote_runner",
      runnerRepoPath: "~/.clawlets/projects/Fleet-A",
      workspaceRef: { kind: "git" },
    })
    expect(createPayload?.workspaceRef?.id).toMatch(/^seeded:sha256:[a-f0-9]{64}$/)

	    const runPayload = payloads
	      .find((payload) => payload?.kind === "project_init" && payload?.payloadMeta === undefined)
    expect(runPayload).toMatchObject({
      kind: "project_init",
      title: "Create project",
      host: "alpha",
    })

	    const enqueuePayload = payloads
	      .find((payload) => payload?.kind === "project_init" && payload?.payloadMeta)
    expect(enqueuePayload).toMatchObject({
      kind: "project_init",
      payloadMeta: {
        hostName: "alpha",
        templateRepo: "owner/repo",
        templatePath: "templates/default",
        templateRef: "main",
      },
    })
    expect(enqueuePayload?.payloadMeta?.args).toBeUndefined()
  })

  it("queues remote project_import with structured payload and canonical workspaceRef", async () => {
    const { mod, mutation } = await loadProjectsModule()
    const result = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.projectImport({
          data: {
            name: "Fleet B",
            repoUrl: "git@GitHub.com:Owner/Repo.git",
            runnerRepoPath: "~/.clawlets/projects/fleet-b/",
            runnerName: "runner-beta",
            branch: "main",
            depth: "1",
          },
        }),
    )

	    expect(result).toMatchObject({
	      projectId: "p1",
	      runId: "r1",
      token: "tok_1",
      runnerName: "runner-beta",
      runnerRepoPath: "~/.clawlets/projects/fleet-b",
      repoUrl: "git@GitHub.com:Owner/Repo.git",
    })

	    const payloads = mutation.mock.calls.map(([, payload]) => (payload ?? {}) as MutationPayload)
	    const createPayload = payloads
	      .find((payload) => payload?.executionMode === "remote_runner")
    expect(createPayload).toMatchObject({
      executionMode: "remote_runner",
      runnerRepoPath: "~/.clawlets/projects/fleet-b",
      workspaceRef: { kind: "git", id: "git@github.com:Owner/Repo" },
    })

	    const runPayload = payloads
	      .find((payload) => payload?.kind === "project_import" && payload?.payloadMeta === undefined)
    expect(runPayload).toMatchObject({
      kind: "project_import",
      title: "Import project",
    })

	    const enqueuePayload = payloads
	      .find((payload) => payload?.kind === "project_import" && payload?.payloadMeta)
    expect(enqueuePayload).toMatchObject({
      kind: "project_import",
      payloadMeta: {
        repoUrl: "git@GitHub.com:Owner/Repo.git",
        branch: "main",
        depth: 1,
      },
    })
    expect(enqueuePayload?.payloadMeta?.args).toBeUndefined()
  })

  it("rejects project import for insecure repo protocols", async () => {
    const { mod } = await loadProjectsModule()
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectImport({
            data: {
              name: "Fleet C",
              repoUrl: "http://github.com/owner/repo.git",
              runnerRepoPath: "~/.clawlets/projects/fleet-c",
              runnerName: "runner-gamma",
            },
          }),
      ),
    ).rejects.toThrow(/invalid protocol/i)

    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectImport({
            data: {
              name: "Fleet C",
              repoUrl: "git://github.com/owner/repo.git",
              runnerRepoPath: "~/.clawlets/projects/fleet-c",
              runnerName: "runner-gamma",
            },
          }),
      ),
    ).rejects.toThrow(/invalid protocol/i)
  })

  it("rejects project import for loopback and link-local repo hosts", async () => {
    const { mod } = await loadProjectsModule()
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectImport({
            data: {
              name: "Fleet D",
              repoUrl: "https://localhost/owner/repo.git",
              runnerRepoPath: "~/.clawlets/projects/fleet-d",
              runnerName: "runner-delta",
            },
          }),
      ),
    ).rejects.toThrow(/host is not allowed/i)

    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectImport({
            data: {
              name: "Fleet D",
              repoUrl: "git@[::1]:owner/repo.git",
              runnerRepoPath: "~/.clawlets/projects/fleet-d",
              runnerName: "runner-delta",
            },
          }),
      ),
    ).rejects.toThrow(/host is not allowed/i)

    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectImport({
            data: {
              name: "Fleet D",
              repoUrl: "https://169.254.169.254/owner/repo.git",
              runnerRepoPath: "~/.clawlets/projects/fleet-d",
              runnerName: "runner-delta",
            },
          }),
      ),
    ).rejects.toThrow(/host is not allowed/i)
  })

  it("rejects runnerRepoPath traversal in create/import inputs", async () => {
    const { mod } = await loadProjectsModule()

    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectCreateStart({
            data: {
              name: "Fleet E",
              runnerRepoPath: "~/.clawlets/projects/../escape",
              host: "alpha",
              runnerName: "runner-echo",
            },
          }),
      ),
    ).rejects.toThrow(/cannot contain '\.\.' path segments/i)

    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.projectImport({
            data: {
              name: "Fleet E",
              repoUrl: "https://github.com/owner/repo.git",
              runnerRepoPath: "~/.clawlets/projects/../escape",
              runnerName: "runner-echo",
            },
          }),
      ),
    ).rejects.toThrow(/cannot contain '\.\.' path segments/i)
  })
})
