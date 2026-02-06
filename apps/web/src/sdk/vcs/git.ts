import { createServerFn } from "@tanstack/react-start"
import { executeGitPush, fetchGitRepoStatus } from "~/server/git.server"
import { parseProjectIdInput } from "~/sdk/runtime"

export const gitRepoStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    return await fetchGitRepoStatus({ projectId: data.projectId })
  })

export const gitPushExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    return await executeGitPush({ projectId: data.projectId })
  })
