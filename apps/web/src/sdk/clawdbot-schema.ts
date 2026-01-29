import { createServerFn } from "@tanstack/react-start"
import type { ClawdbotSchemaLiveResult, ClawdbotSchemaStatusResult } from "~/server/clawdbot-schema.server"
import type { Id } from "~/convex/_generated/dataModel"
import { parseProjectHostBotInput } from "~/sdk/serverfn-validators"

export const getClawdbotSchemaLive = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostBotInput)
  .handler(async ({ data }) => {
    try {
      const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
      return await fetchClawdbotSchemaLive({ projectId: data.projectId, host: data.host, botId: data.botId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, message } satisfies ClawdbotSchemaLiveResult
    }
  })

export const getClawdbotSchemaStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects"> }
  })
  .handler(async ({ data }) => {
    try {
      const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
      return await fetchClawdbotSchemaStatus({ projectId: data.projectId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, message } satisfies ClawdbotSchemaStatusResult
    }
  })
