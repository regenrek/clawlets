import { createServerFn } from "@tanstack/react-start"
import {
  fetchOpenclawSchemaLive,
  fetchOpenclawSchemaStatus,
  type OpenclawSchemaLiveResult,
  type OpenclawSchemaStatusResult,
} from "~/server/openclaw-schema.server"
import { parseProjectHostGatewayInput, parseProjectIdInput } from "~/sdk/serverfn-validators"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"

export const getOpenclawSchemaLive = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostGatewayInput)
  .handler(async ({ data }) => {
    try {
      return await fetchOpenclawSchemaLive({ projectId: data.projectId, host: data.host, gatewayId: data.gatewayId })
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema. Check logs.")
      return { ok: false as const, message } satisfies OpenclawSchemaLiveResult
    }
  })

export const getOpenclawSchemaStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    try {
      return await fetchOpenclawSchemaStatus({ projectId: data.projectId })
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema status. Check logs.")
      return { ok: false as const, message } satisfies OpenclawSchemaStatusResult
    }
  })

export type { OpenclawSchemaLiveResult, OpenclawSchemaStatusResult }
