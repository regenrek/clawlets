import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { __test_normalizeWorkspaceRef, __test_resolveProjectRuntimeMetadata } from "../convex/projects"

function expectConvexFail(fn: () => void, code: string, message?: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
    if (message) expect((err as any).data?.message).toBe(message)
  }
}

describe("workspaceRef normalization", () => {
  it("builds canonical key with trimmed relPath", () => {
    expect(
      __test_normalizeWorkspaceRef({
        kind: "git",
        id: "repo-123",
        relPath: "  fleet/prod  ",
      }),
    ).toEqual({
      kind: "git",
      id: "repo-123",
      relPath: "fleet/prod",
      key: "git:repo-123:fleet/prod",
    })
  })

  it("rejects missing id", () => {
    expectConvexFail(
      () => __test_normalizeWorkspaceRef({ kind: "local", id: "   " }),
      "conflict",
      "workspaceRef.id required",
    )
  })

  it("rejects oversized relPath", () => {
    expectConvexFail(
      () => __test_normalizeWorkspaceRef({ kind: "git", id: "repo-1", relPath: "a".repeat(257) }),
      "conflict",
      "workspaceRef.relPath too long",
    )
  })

  it("infers local metadata for legacy project rows", () => {
    expect(
      __test_resolveProjectRuntimeMetadata({
        projectId: "legacy-1",
        localPath: " /tmp/legacy ",
      }),
    ).toEqual({
      executionMode: "local",
      workspaceRef: { kind: "local", id: "legacy:legacy-1", relPath: undefined },
      workspaceRefKey: "local:legacy:legacy-1",
      localPath: "/tmp/legacy",
    })
  })

  it("coerces invalid local metadata to remote runner", () => {
    expect(
      __test_resolveProjectRuntimeMetadata({
        projectId: "legacy-2",
        executionMode: "local",
      }),
    ).toEqual({
      executionMode: "remote_runner",
      workspaceRef: { kind: "git", id: "legacy:legacy-2", relPath: undefined },
      workspaceRefKey: "git:legacy:legacy-2",
      localPath: undefined,
    })
  })
})
