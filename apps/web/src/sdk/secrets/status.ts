import { createServerFn } from "@tanstack/react-start"

import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectHostRequiredInput,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"
import type { Id } from "../../../convex/_generated/dataModel"

export type BootstrapSecretStatusResult = {
  runId: Id<"runs">
  jobId: Id<"jobs">
  statusBySecret: Record<string, { status: string; detail?: string }>
}

function parseBootstrapSecretStatusInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  targetRunnerId?: Id<"runners">
} {
  const base = parseProjectHostRequiredInput(data)
  const row = data as Record<string, unknown>
  const targetRunnerId = typeof row.targetRunnerId === "string" && row.targetRunnerId.trim()
    ? row.targetRunnerId.trim() as Id<"runners">
    : undefined
  return { ...base, targetRunnerId }
}

export const getBootstrapSecretStatus = createServerFn({ method: "POST" })
  .inputValidator(parseBootstrapSecretStatusInput)
  .handler(async ({ data }): Promise<BootstrapSecretStatusResult> => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: `Secrets status (${data.host}, scope=bootstrap)`,
      host: data.host,
      targetRunnerId: data.targetRunnerId,
      args: ["secrets", "status", "--host", data.host, "--scope", "bootstrap", "--json"],
      note: "bootstrap secrets status read",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 45_000,
      pollMs: 700,
    })
    if (terminal.status !== "succeeded") {
      const messages = await listRunMessages({
        client,
        runId: queued.runId,
        limit: 300,
      })
      throw new Error(terminal.errorMessage || lastErrorMessage(messages, "bootstrap secrets status failed"))
    }
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (!parsed) throw new Error("bootstrap secrets status result missing")
    const results = Array.isArray((parsed as Record<string, unknown>).results)
      ? ((parsed as Record<string, unknown>).results as Array<Record<string, unknown>>)
      : []
    const statusBySecret: Record<string, { status: string; detail?: string }> = {}
    for (const row of results) {
      const secret = typeof row.secret === "string" ? row.secret.trim() : ""
      if (!secret) continue
      statusBySecret[secret] = {
        status: typeof row.status === "string" ? row.status : "missing",
        detail: typeof row.detail === "string" ? row.detail : undefined,
      }
    }
    return {
      runId: queued.runId,
      jobId: queued.jobId,
      statusBySecret,
    }
  })
