import { randomBytes } from "node:crypto"
import type { Id } from "~/convex/_generated/dataModel"
import type { ClawdbotSchemaArtifact } from "@clawdlets/core/lib/clawdbot-schema"
import { buildClawdbotBotConfig } from "@clawdlets/core/lib/clawdbot-config-invariants"
import { loadClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
import { fetchNixClawdbotSourceInfo, getNixClawdbotRevFromFlakeLock } from "@clawdlets/core/lib/nix-clawdbot"
import { shellQuote, sshCapture, validateTargetHost } from "@clawdlets/core/lib/ssh-remote"
import { createConvexClient } from "~/server/convex"
import { getRepoRoot } from "~/sdk/repo-root"

const SOURCE_TTL_MS = 5 * 60 * 1000
const STATUS_TTL_MS = 60 * 1000
const LIVE_SCHEMA_TTL_MS = 15 * 1000
const SOURCE_CACHE_MAX = 64
const STATUS_CACHE_MAX = 128
const LIVE_SCHEMA_CACHE_MAX = 256
const MAX_JSON_SEGMENT_BYTES = 2 * 1024 * 1024
const SCHEMA_MARKER_BEGIN = "__CLAWDBOT_SCHEMA_BEGIN__"
const SCHEMA_MARKER_END = "__CLAWDBOT_SCHEMA_END__"
const SCHEMA_MARKER_BYTES_MAX = 2 * 1024 * 1024

type SourceCacheEntry = {
  expiresAt: number
  value: Awaited<ReturnType<typeof fetchNixClawdbotSourceInfo>>
}

const sourceCache = new Map<string, SourceCacheEntry>()
const statusCache = new Map<string, { expiresAt: number; value: ClawdbotSchemaStatusResult }>()
const liveSchemaCache = new Map<string, { expiresAt: number; value: ClawdbotSchemaLiveResult }>()

function pruneExpired<T extends { expiresAt: number }>(cache: Map<string, T>, now: number) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

function capCache<T>(cache: Map<string, T>, maxSize: number) {
  if (cache.size <= maxSize) return
  const overflow = cache.size - maxSize
  let removed = 0
  for (const key of cache.keys()) {
    cache.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

async function fetchNixClawdbotSourceInfoCached(params: {
  ref: string
}): Promise<Awaited<ReturnType<typeof fetchNixClawdbotSourceInfo>>> {
  const key = params.ref.trim() || "main"
  const now = Date.now()
  pruneExpired(sourceCache, now)
  const cached = sourceCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value
  const value = await fetchNixClawdbotSourceInfo({ ref: key })
  sourceCache.set(key, { expiresAt: now + SOURCE_TTL_MS, value })
  capCache(sourceCache, SOURCE_CACHE_MAX)
  return value
}

function extractJsonBlock(raw: string, nonce: string): string {
  const begin = `${SCHEMA_MARKER_BEGIN}${nonce}__`
  const end = `${SCHEMA_MARKER_END}${nonce}__`
  const lines = raw.split(/\r?\n/)
  let start = -1
  let finish = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? ""
    if (line === begin) start = i + 1
    if (line === end && start !== -1) {
      finish = i
      break
    }
  }
  if (start === -1 || finish === -1 || finish < start) {
    throw new Error("missing schema markers in output")
  }
  const between = lines.slice(start, finish).join("\n").trim()
  if (!between) throw new Error("empty schema payload in output")
  if (Buffer.byteLength(between, "utf8") > SCHEMA_MARKER_BYTES_MAX) {
    throw new Error("schema payload too large")
  }
  return between
}

export function __test_extractJsonBlock(raw: string, nonce: string): string {
  return extractJsonBlock(raw, nonce)
}

function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim())
}

function buildGatewaySchemaCommand(params: { botId: string; port: number; sudo: boolean; nonce: string }): string {
  const envFile = `/srv/clawdbot/${params.botId}/credentials/gateway.env`
  const url = `ws://127.0.0.1:${params.port}`
  const begin = `${SCHEMA_MARKER_BEGIN}${params.nonce}__`
  const end = `${SCHEMA_MARKER_END}${params.nonce}__`
  const beginQuoted = shellQuote(begin)
  const endQuoted = shellQuote(end)
  const script = [
    "set -euo pipefail",
    `source ${envFile}`,
    `printf '%s\\n' ${beginQuoted}`,
    `clawdbot gateway call config.schema --url ${url} --json`,
    `printf '%s\\n' ${endQuoted}`,
  ].join(" && ")
  const args = [
    ...(params.sudo ? ["sudo", "-u", `bot-${params.botId}`] : []),
    "bash",
    "-lc",
    script,
  ]
  return args.map((a) => shellQuote(a)).join(" ")
}

export type ClawdbotSchemaLiveResult =
  | { ok: true; schema: ClawdbotSchemaArtifact }
  | { ok: false; message: string }

export type ClawdbotSchemaStatusResult =
  | {
      ok: true
      pinned?: { nixClawdbotRev: string; clawdbotRev: string }
      upstream?: { nixClawdbotRef: string; clawdbotRev: string }
      warnings?: string[]
    }
  | { ok: false; message: string }

export async function fetchClawdbotSchemaLive(params: {
  projectId: Id<"projects">
  host: string
  botId: string
}): Promise<ClawdbotSchemaLiveResult> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)
  const { config } = loadClawdletsConfig({ repoRoot })

  const host = params.host || config.defaultHost || ""
  if (!host) throw new Error("missing host")
  if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)
  if (!config.fleet.bots[params.botId]) throw new Error(`unknown bot: ${params.botId}`)

  const cacheKey = `${params.projectId}:${host}:${params.botId}`
  const now = Date.now()
  pruneExpired(liveSchemaCache, now)
  const cached = liveSchemaCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value

  const targetHostRaw = String((config.hosts[host] as any)?.targetHost || "").trim()
  if (!targetHostRaw) {
    throw new Error(
      `missing targetHost for ${host}. Set hosts.${host}.targetHost (Hosts → Settings → Target host), save, reload.`,
    )
  }
  const targetHost = validateTargetHost(targetHostRaw)

  const botConfig = buildClawdbotBotConfig({ config, bot: params.botId })
  const gateway = (botConfig.invariants as any)?.gateway || {}
  const port = typeof gateway.port === "number" ? gateway.port : Number(gateway.port || 0)
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid gateway port for bot ${params.botId}`)

  try {
    const nonce = randomBytes(8).toString("hex")
    const remoteCmd = buildGatewaySchemaCommand({ botId: params.botId, port, sudo: needsSudo(targetHost), nonce })
    const raw = await sshCapture(targetHost, remoteCmd, {
      cwd: repoRoot,
      timeoutMs: 15_000,
      maxOutputBytes: 5 * 1024 * 1024,
    })
    const payload = extractJsonBlock(raw || "", nonce)
    const parsed = JSON.parse(payload) as ClawdbotSchemaArtifact
    const schemaValue = (parsed as any)?.schema
    const hasSchema =
      parsed &&
      typeof parsed === "object" &&
      schemaValue &&
      typeof schemaValue === "object" &&
      !Array.isArray(schemaValue) &&
      typeof (parsed as any).version === "string" &&
      typeof (parsed as any).generatedAt === "string" &&
      typeof (parsed as any).clawdbotRev === "string"
    if (!hasSchema) {
      throw new Error("schema payload missing required fields")
    }
    const result = { ok: true as const, schema: parsed } satisfies ClawdbotSchemaLiveResult
    liveSchemaCache.set(cacheKey, { expiresAt: now + LIVE_SCHEMA_TTL_MS, value: result })
    capCache(liveSchemaCache, LIVE_SCHEMA_CACHE_MAX)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const result = { ok: false as const, message } satisfies ClawdbotSchemaLiveResult
    liveSchemaCache.set(cacheKey, { expiresAt: now + LIVE_SCHEMA_TTL_MS, value: result })
    capCache(liveSchemaCache, LIVE_SCHEMA_CACHE_MAX)
    return result
  }
}

export async function fetchClawdbotSchemaStatus(params: {
  projectId: Id<"projects">
}): Promise<ClawdbotSchemaStatusResult> {
  try {
    const now = Date.now()
    const cacheKey = String(params.projectId)
    pruneExpired(statusCache, now)
    const cached = statusCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.value

    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, params.projectId)
    const nixClawdbotRev = getNixClawdbotRevFromFlakeLock(repoRoot)
    const warnings: string[] = []

    const pinnedPromise = nixClawdbotRev ? fetchNixClawdbotSourceInfoCached({ ref: nixClawdbotRev }) : Promise.resolve(null)
    const upstreamPromise = fetchNixClawdbotSourceInfoCached({ ref: "main" })
    const [pinnedResult, upstreamResult] = await Promise.all([pinnedPromise, upstreamPromise])

    const pinned =
      nixClawdbotRev && pinnedResult && pinnedResult.ok
        ? { nixClawdbotRev, clawdbotRev: pinnedResult.info.rev }
        : undefined
    if (nixClawdbotRev && pinnedResult && !pinnedResult.ok) {
      warnings.push(`pinned nix-clawdbot fetch failed: ${pinnedResult.error}`)
    }

    const upstream =
      upstreamResult.ok ? { nixClawdbotRef: "main", clawdbotRev: upstreamResult.info.rev } : undefined
    if (!upstreamResult.ok) {
      warnings.push(`upstream nix-clawdbot fetch failed: ${upstreamResult.error}`)
    }

    const result = {
      ok: true as const,
      pinned,
      upstream,
      warnings: warnings.length > 0 ? warnings : undefined,
    } satisfies ClawdbotSchemaStatusResult
    statusCache.set(cacheKey, { expiresAt: now + STATUS_TTL_MS, value: result })
    capCache(statusCache, STATUS_CACHE_MAX)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false as const, message } satisfies ClawdbotSchemaStatusResult
  }
}
