import { convexQuery } from "@convex-dev/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"

export type SetupOperationView = {
  _id: Id<"setupOperations">
  status: "queued" | "running" | "succeeded" | "failed"
  currentRunId?: Id<"runs">
  terminalMessage?: string
  summaryJson?: string
  steps: Array<{
    stepId: string
    status: "pending" | "running" | "succeeded" | "failed"
    safeMessage: string
    detailJson?: string
    retryable: boolean
    updatedAt: number
  }>
}

export function isSetupOperationTerminal(status: SetupOperationView["status"]): boolean {
  return status === "succeeded" || status === "failed"
}

export function getActiveSetupOperationStep(operation: SetupOperationView | null): SetupOperationView["steps"][number] | null {
  if (!operation) return null
  return operation.steps.find((step) => step.status === "running")
    || operation.steps.find((step) => step.status === "failed")
    || operation.steps.findLast((step) => step.status === "succeeded")
    || null
}

export function summarizeSetupOperation(operation: SetupOperationView | null): string {
  if (!operation) return "Waiting for setup apply..."
  if (operation.status === "failed") {
    return operation.terminalMessage?.trim() || getActiveSetupOperationStep(operation)?.safeMessage || "Setup apply failed"
  }
  if (operation.status === "succeeded") {
    const active = getActiveSetupOperationStep(operation)
    return active?.safeMessage || "Setup apply completed."
  }
  const active = getActiveSetupOperationStep(operation)
  return active?.safeMessage || "Setup apply queued..."
}

export async function fetchSetupOperation(params: {
  queryClient: QueryClient
  operationId: Id<"setupOperations">
}): Promise<SetupOperationView | null> {
  return await params.queryClient.fetchQuery({
    ...convexQuery(api.controlPlane.setupOperations.get, {
      operationId: params.operationId,
    }),
    staleTime: 0,
  }) as SetupOperationView | null
}

export async function waitForSetupOperation(params: {
  queryClient: QueryClient
  operationId: Id<"setupOperations">
  sleep: (ms: number) => Promise<void>
  onUpdate?: (operation: SetupOperationView | null) => void | Promise<void>
  timeoutMs?: number
  pollMs?: number
}): Promise<SetupOperationView> {
  const timeoutMs = params.timeoutMs ?? 240_000
  const pollMs = params.pollMs ?? 1_000
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const operation = await fetchSetupOperation({
      queryClient: params.queryClient,
      operationId: params.operationId,
    })
    await params.onUpdate?.(operation)
    if (!operation) throw new Error("setup apply operation not found")
    if (isSetupOperationTerminal(operation.status)) return operation
    await params.sleep(pollMs)
  }
  throw new Error("setup apply timed out waiting for completion")
}
