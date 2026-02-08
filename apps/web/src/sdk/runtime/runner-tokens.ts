import { createServerFn } from "@tanstack/react-start"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import { parseProjectIdInput } from "~/sdk/runtime/validators"

function parseCreateRunnerTokenInput(data: unknown): { projectId: Id<"projects">; runnerName: string } {
  const base = parseProjectIdInput(data)
  const d = data as Record<string, unknown>
  const runnerName = typeof d["runnerName"] === "string" ? d["runnerName"].trim() : ""
  if (!runnerName) throw new Error("runnerName required")
  return { ...base, runnerName }
}

export const createRunnerToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => parseCreateRunnerTokenInput(data))
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    return await client.mutation(api.controlPlane.runnerTokens.create, {
      projectId: data.projectId,
      runnerName: data.runnerName,
    })
  })
