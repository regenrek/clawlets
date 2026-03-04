type SelfUpdateFromDesired = {
  enabled?: boolean
  baseUrlCount?: number
  publicKeyCount?: number
  allowUnsigned?: boolean
}

export type HostSelfUpdateState = {
  enabled: boolean
  baseUrlCount: number
  publicKeyCount: number
  allowUnsigned: boolean
  configured: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.trunc(value))
}

function readSelfUpdateFromDesired(hostDesired: unknown): SelfUpdateFromDesired {
  const desired = asRecord(hostDesired) ?? {}
  const enabled = typeof desired.selfUpdateEnabled === "boolean" ? desired.selfUpdateEnabled : undefined
  const baseUrlCount = toNonNegativeInteger(desired.selfUpdateBaseUrlCount)
  const publicKeyCount = toNonNegativeInteger(desired.selfUpdatePublicKeyCount)
  const allowUnsigned = typeof desired.selfUpdateAllowUnsigned === "boolean"
    ? desired.selfUpdateAllowUnsigned
    : undefined
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(baseUrlCount === undefined ? {} : { baseUrlCount }),
    ...(publicKeyCount === undefined ? {} : { publicKeyCount }),
    ...(allowUnsigned === undefined ? {} : { allowUnsigned }),
  }
}

function readSelfUpdateFromConfig(hostCfg: unknown): Omit<HostSelfUpdateState, "configured"> {
  const hostCfgRecord = asRecord(hostCfg) ?? {}
  const selfUpdate = asRecord(hostCfgRecord.selfUpdate) ?? {}
  const baseUrls = Array.isArray(selfUpdate.baseUrls) ? selfUpdate.baseUrls : []
  const publicKeys = Array.isArray(selfUpdate.publicKeys) ? selfUpdate.publicKeys : []
  return {
    enabled: Boolean(selfUpdate.enable),
    baseUrlCount: baseUrls.length,
    publicKeyCount: publicKeys.length,
    allowUnsigned: Boolean(selfUpdate.allowUnsigned),
  }
}

export function deriveHostSelfUpdateState(params: {
  hostDesired?: unknown
  hostCfg?: unknown
}): HostSelfUpdateState {
  const fromDesired = readSelfUpdateFromDesired(params.hostDesired)
  const fromConfig = readSelfUpdateFromConfig(params.hostCfg)
  const enabled = fromDesired.enabled ?? fromConfig.enabled
  const baseUrlCount = fromDesired.baseUrlCount ?? fromConfig.baseUrlCount
  const publicKeyCount = fromDesired.publicKeyCount ?? fromConfig.publicKeyCount
  const allowUnsigned = fromDesired.allowUnsigned ?? fromConfig.allowUnsigned
  return {
    enabled,
    baseUrlCount,
    publicKeyCount,
    allowUnsigned,
    configured: enabled && baseUrlCount > 0 && (allowUnsigned || publicKeyCount > 0),
  }
}

export function readHostConfigFromSetupConfig(params: {
  setupConfig: unknown
  host: string
}): Record<string, unknown> | null {
  const config = asRecord(params.setupConfig)
  if (!config) return null
  const hosts = asRecord(config.hosts)
  if (!hosts) return null
  return asRecord(hosts[params.host])
}
