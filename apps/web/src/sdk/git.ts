import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"

export const gitRepoStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
    }
  })
  .handler(async ({ data }) => {
    const { fetchGitRepoStatus } = await import("~/server/git.server")
    return await fetchGitRepoStatus({ projectId: data.projectId })
  })

export const gitPushExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return {
      projectId: d["projectId"] as Id<"projects">,
    }
  })
  .handler(async ({ data }) => {
    const { executeGitPush } = await import("~/server/git.server")
    return await executeGitPush({ projectId: data.projectId })
  })
