import { createServerFn } from "@tanstack/react-start"
import {
  ClawletsConfigSchema,
  GatewayArchitectureSchema,
  loadClawletsConfigRaw,
  writeClawletsConfig,
} from "@clawlets/core/lib/clawlets-config"
import { GatewayIdSchema, PersonaNameSchema } from "@clawlets/shared/lib/identifiers"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export const addBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      bot: String(d["bot"] || ""),
      architecture: typeof d["architecture"] === "string" ? d["architecture"] : "",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    const botId = data.bot.trim()
    const architecture = data.architecture.trim()
    const parsedBot = GatewayIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid gateway id")
    if (architecture) {
      const parsedArchitecture = GatewayArchitectureSchema.safeParse(architecture)
      if (!parsedArchitecture.success) throw new Error("invalid gateway architecture")
      if (next.fleet.gatewayArchitecture && next.fleet.gatewayArchitecture !== parsedArchitecture.data) {
        throw new Error(`gateway architecture already set to ${next.fleet.gatewayArchitecture}`)
      }
      next.fleet.gatewayArchitecture = parsedArchitecture.data
    }
    next.fleet.gatewayOrder = Array.isArray(next.fleet.gatewayOrder) ? next.fleet.gatewayOrder : []
    next.fleet.gateways =
      next.fleet.gateways && typeof next.fleet.gateways === "object" && !Array.isArray(next.fleet.gateways)
        ? next.fleet.gateways
        : {}
    if (next.fleet.gatewayOrder.includes(botId) || next.fleet.gateways[botId]) return { ok: true as const }
    next.fleet.gatewayOrder = [...next.fleet.gatewayOrder, botId]
    // New bots should be channel-agnostic by default.
    // Integrations can be enabled later via per-bot config (and then wire secrets as needed).
    next.fleet.gateways[botId] = {}

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot add ${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding bot ${botId}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const addGatewayAgent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      gatewayId: String(d["gatewayId"] || ""),
      agentId: String(d["agentId"] || ""),
      name: typeof d["name"] === "string" ? d["name"] : "",
      makeDefault: Boolean(d["makeDefault"]),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const gatewayId = data.gatewayId.trim()
    const agentId = data.agentId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")
    const parsedAgent = PersonaNameSchema.safeParse(agentId)
    if (!parsedAgent.success) throw new Error("invalid agent id")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.gateways =
      next.fleet.gateways && typeof next.fleet.gateways === "object" && !Array.isArray(next.fleet.gateways)
        ? next.fleet.gateways
        : {}
    const gateway = next.fleet.gateways[gatewayId]
    if (!gateway || typeof gateway !== "object") throw new Error(`unknown gateway id: ${gatewayId}`)

    gateway.agents = gateway.agents && typeof gateway.agents === "object" && !Array.isArray(gateway.agents) ? gateway.agents : {}
    gateway.agents.list = Array.isArray(gateway.agents.list) ? gateway.agents.list : []
    const existing = gateway.agents.list.find((entry: any) => entry?.id === agentId)
    if (existing) throw new Error(`agent already exists: ${agentId}`)

    const hasDefault = gateway.agents.list.some((entry: any) => entry?.default === true)
    const makeDefault = data.makeDefault || !hasDefault
    if (makeDefault) {
      gateway.agents.list = gateway.agents.list.map((entry: any) => ({ ...entry, default: false }))
    }
    const entry: Record<string, unknown> = { id: agentId }
    const name = data.name.trim()
    if (name) entry.name = name
    if (makeDefault) entry.default = true
    gateway.agents.list = [...gateway.agents.list, entry]

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `agent add ${gatewayId}/${agentId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding agent ${agentId} to ${gatewayId}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeGatewayAgent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      gatewayId: String(d["gatewayId"] || ""),
      agentId: String(d["agentId"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const gatewayId = data.gatewayId.trim()
    const agentId = data.agentId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")
    const parsedAgent = PersonaNameSchema.safeParse(agentId)
    if (!parsedAgent.success) throw new Error("invalid agent id")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    const gateway = next.fleet.gateways?.[gatewayId]
    if (!gateway || typeof gateway !== "object") throw new Error(`unknown gateway id: ${gatewayId}`)
    const list = Array.isArray(gateway.agents?.list) ? gateway.agents.list : []
    if (!list.some((entry: any) => entry?.id === agentId)) throw new Error(`agent not found: ${agentId}`)
    gateway.agents = gateway.agents && typeof gateway.agents === "object" && !Array.isArray(gateway.agents) ? gateway.agents : {}
    gateway.agents.list = list.filter((entry: any) => entry?.id !== agentId)

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `agent rm ${gatewayId}/${agentId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing agent ${agentId} from ${gatewayId}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const next = structuredClone(raw) as any
    const existingOrder = Array.isArray(next?.fleet?.gatewayOrder) ? next.fleet.gatewayOrder : []
    const existingGateways =
      next?.fleet?.gateways && typeof next.fleet.gateways === "object" && !Array.isArray(next.fleet.gateways)
        ? next.fleet.gateways
        : {}
    if (!existingOrder.includes(botId) && !existingGateways[botId]) throw new Error("bot not found")

    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.gatewayOrder = existingOrder.filter((b: string) => b !== botId)
    const gatewaysRecord = { ...existingGateways }
    delete gatewaysRecord[botId]
    next.fleet.gateways = gatewaysRecord
    if (Array.isArray(next.fleet.codex?.gateways)) {
      next.fleet.codex.gateways = next.fleet.codex.gateways.filter((b: string) => b !== botId)
    }

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot rm ${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing bot ${botId}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const setGatewayArchitecture = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      architecture: String(d["architecture"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const architecture = data.architecture.trim()
    const parsedArchitecture = GatewayArchitectureSchema.safeParse(architecture)
    if (!parsedArchitecture.success) throw new Error("invalid gateway architecture")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.gatewayArchitecture = parsedArchitecture.data

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `gateway architecture ${parsedArchitecture.data}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Setting gateway architecture: ${parsedArchitecture.data}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })
