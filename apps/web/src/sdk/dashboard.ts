import { stat } from "node:fs/promises"
import { createServerFn } from "@tanstack/react-start"
import { loadClawletsConfig } from "@clawlets/core/lib/clawlets-config"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { assertRepoRootPath } from "~/server/paths"

type DashboardProjectConfigSummary = {
  configPath: string | null
  configMtimeMs: number | null
  gatewaysTotal: number
  gatewayIdsPreview: string[]
  hostsTotal: number
  hostsEnabled: number
  defaultHost: string | null
  codexEnabled: boolean
  resticEnabled: boolean
  error: string | null
}

export type DashboardProjectSummary = {
  projectId: Id<"projects">
  name: string
  status: "creating" | "ready" | "error"
  localPath: string
  updatedAt: number
  lastSeenAt: number | null
  cfg: DashboardProjectConfigSummary
}

export const getDashboardOverview = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (data === undefined || data === null) return {}
    if (!data || typeof data !== "object") throw new Error("invalid input")
    return {}
  })
  .handler(async () => {
    const client = createConvexClient()
    const projects = await client.query(api.projects.list, {})

    const summaries = await Promise.all(
      projects.map(async (p): Promise<DashboardProjectSummary> => {
        const base = {
          projectId: p._id as Id<"projects">,
          name: p.name,
          status: p.status,
          localPath: p.localPath,
          updatedAt: p.updatedAt,
          lastSeenAt: typeof p.lastSeenAt === "number" ? p.lastSeenAt : null,
        }

        try {
          const repoRoot = assertRepoRootPath(p.localPath, { allowMissing: false })
          const { configPath, config } = loadClawletsConfig({ repoRoot })

          const hostNames = Object.keys(config.hosts || {})
          const hostsEnabled = hostNames.filter((h) => Boolean((config.hosts as any)?.[h]?.enable)).length
          const gatewayEntries: string[] = []
          for (const host of hostNames) {
            const hostCfg = (config.hosts as any)?.[host] || {}
            const gatewaysOrder = Array.isArray(hostCfg?.gatewaysOrder) ? hostCfg.gatewaysOrder : []
            const gatewaysKeys = Object.keys(hostCfg?.gateways || {})
            const gateways = gatewaysOrder.length > 0 ? gatewaysOrder : gatewaysKeys
            for (const gatewayId of gateways) {
              if (typeof gatewayId === "string" && gatewayId.trim()) gatewayEntries.push(`${host}:${gatewayId}`)
            }
          }

          const mtime = await stat(configPath).then((s) => s.mtimeMs).catch(() => null)

          return {
            ...base,
            cfg: {
              configPath,
              configMtimeMs: mtime,
              gatewaysTotal: gatewayEntries.length,
              gatewayIdsPreview: gatewayEntries.slice(0, 8),
              hostsTotal: hostNames.length,
              hostsEnabled,
              defaultHost: typeof config.defaultHost === "string" ? config.defaultHost : null,
              codexEnabled: Boolean((config as any).fleet?.codex?.enable),
              resticEnabled: Boolean((config as any).fleet?.backups?.restic?.enable),
              error: null,
            },
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            ...base,
            cfg: {
              configPath: null,
              configMtimeMs: null,
              gatewaysTotal: 0,
              gatewayIdsPreview: [],
              hostsTotal: 0,
              hostsEnabled: 0,
              defaultHost: null,
              codexEnabled: false,
              resticEnabled: false,
              error: message,
            },
          }
        }
      }),
    )

    return { projects: summaries }
  })
