import type { SetupDraftInfrastructure } from "~/sdk/setup"

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim()
  }
  return ""
}

export function deriveInfrastructureGate(params: {
  runnerOnline: boolean
  hasActiveHcloudToken: boolean
  infrastructure: SetupDraftInfrastructure
}): {
  ready: boolean
  blocked: boolean
  message: string | null
  passedDetail: string
} {
  const serverType = asTrimmedString(params.infrastructure.serverType)
  const location = asTrimmedString(params.infrastructure.location)
  const configReady = serverType.length > 0 && location.length > 0
  const ready = params.hasActiveHcloudToken && configReady
  const message = !params.runnerOnline
    ? null
    : !params.hasActiveHcloudToken
      ? "Missing active Hetzner API key. Add one in Hetzner Setup."
      : !configReady
        ? "Hetzner setup incomplete. Choose server type and location in Hetzner Setup."
        : null

  return {
    ready,
    blocked: params.runnerOnline && !ready,
    message,
    passedDetail: `Hetzner ready (${serverType}/${location})`,
  }
}

export function deriveInstallCardStatus(params: {
  infraExists?: boolean
  infraMissingDetail: string | null
  bootstrapInProgress: boolean
  predeployState: "idle" | "running" | "failed" | "ready"
  predeployReady: boolean
  predeployError: string | null
  deployStatusReason: string | null
  hadSuccessfulBootstrap: boolean
}): string | null {
  if (params.bootstrapInProgress) return "Deploy in progress..."
  if (params.infraExists === false) {
    if (params.hadSuccessfulBootstrap) {
      return params.infraMissingDetail
        ? `Infrastructure missing. ${params.infraMissingDetail}`
        : "Infrastructure missing (likely destroyed). Redeploy required."
    }
    return "Infrastructure not created yet. Run predeploy, then deploy to create it."
  }
  if (params.predeployState === "running") return "Running predeploy checks..."
  if (params.predeployReady) return "Predeploy checks are green. Review summary, then deploy."
  if (params.predeployState === "failed") return params.predeployError || "Predeploy checks failed."
  return params.deployStatusReason
}
