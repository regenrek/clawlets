import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import { parseProjectHostRequiredInput } from "~/sdk/runtime"

export const SETUP_DRAFT_SECRET_SECTIONS = ["hostBootstrapCreds", "hostBootstrapSecrets"] as const
export type SetupDraftSecretSection = (typeof SETUP_DRAFT_SECRET_SECTIONS)[number]

export type SetupDraftInfrastructure = {
  serverType?: string
  image?: string
  location?: string
  allowTailscaleUdpIngress?: boolean
  volumeEnabled?: boolean
  volumeSizeGb?: number
}

export type SetupDraftConnection = {
  adminCidr?: string
  sshExposureMode?: "bootstrap" | "tailnet" | "public"
  sshKeyCount?: number
  sshAuthorizedKeys?: string[]
}

export type SetupDraftNonSecretPatch = {
  infrastructure?: SetupDraftInfrastructure
  connection?: SetupDraftConnection
}

type SetupDraftSectionView = {
  status: "set" | "missing"
  updatedAt?: number
  expiresAt?: number
  targetRunnerId?: Id<"runners">
}

export type SetupDraftView = {
  draftId: Id<"setupDrafts">
  hostName: string
  status: "draft" | "committing" | "committed" | "failed"
  version: number
  nonSecretDraft: SetupDraftNonSecretPatch
  sealedSecretDrafts: {
    hostBootstrapCreds: SetupDraftSectionView
    hostBootstrapSecrets: SetupDraftSectionView
  }
  updatedAt: number
  expiresAt: number
  committedAt?: number
  lastError?: string
}

function ensureNoExtraKeys(value: Record<string, unknown>, field: string, keys: string[]): void {
  const extra = Object.keys(value).filter((key) => !keys.includes(key))
  if (extra.length > 0) throw new Error(`${field} contains unsupported keys: ${extra.join(",")}`)
}

function parseSection(raw: unknown): SetupDraftSecretSection {
  if (typeof raw !== "string") throw new Error("section required")
  const section = raw.trim() as SetupDraftSecretSection
  if (!SETUP_DRAFT_SECRET_SECTIONS.includes(section)) throw new Error("section invalid")
  return section
}

function parseSetupDraftSaveNonSecretInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  expectedVersion?: number
  patch: SetupDraftNonSecretPatch
} {
  const base = parseProjectHostRequiredInput(data)
  const row = data as Record<string, unknown>
  const expectedVersionRaw = row.expectedVersion
  const expectedVersion =
    typeof expectedVersionRaw === "number" && Number.isFinite(expectedVersionRaw)
      ? Math.max(0, Math.trunc(expectedVersionRaw))
      : undefined
  const patchRaw = row.patch
  if (!patchRaw || typeof patchRaw !== "object" || Array.isArray(patchRaw)) {
    throw new Error("patch required")
  }
  const patchObj = patchRaw as Record<string, unknown>
  ensureNoExtraKeys(patchObj, "patch", ["infrastructure", "connection"])
  const patch: SetupDraftNonSecretPatch = {}

  if (patchObj.infrastructure !== undefined) {
    if (!patchObj.infrastructure || typeof patchObj.infrastructure !== "object" || Array.isArray(patchObj.infrastructure)) {
      throw new Error("patch.infrastructure invalid")
    }
    const infrastructureRaw = patchObj.infrastructure as Record<string, unknown>
    ensureNoExtraKeys(infrastructureRaw, "patch.infrastructure", [
      "serverType",
      "image",
      "location",
      "allowTailscaleUdpIngress",
      "volumeEnabled",
      "volumeSizeGb",
    ])
    patch.infrastructure = {
      serverType: typeof infrastructureRaw.serverType === "string" ? infrastructureRaw.serverType : undefined,
      image: typeof infrastructureRaw.image === "string" ? infrastructureRaw.image : undefined,
      location: typeof infrastructureRaw.location === "string" ? infrastructureRaw.location : undefined,
      allowTailscaleUdpIngress:
        typeof infrastructureRaw.allowTailscaleUdpIngress === "boolean"
          ? infrastructureRaw.allowTailscaleUdpIngress
          : undefined,
      volumeEnabled:
        typeof infrastructureRaw.volumeEnabled === "boolean"
          ? infrastructureRaw.volumeEnabled
          : undefined,
      volumeSizeGb:
        typeof infrastructureRaw.volumeSizeGb === "number" && Number.isFinite(infrastructureRaw.volumeSizeGb)
          ? Math.max(0, Math.trunc(infrastructureRaw.volumeSizeGb))
          : undefined,
    }
  }

  if (patchObj.connection !== undefined) {
    if (!patchObj.connection || typeof patchObj.connection !== "object" || Array.isArray(patchObj.connection)) {
      throw new Error("patch.connection invalid")
    }
    const connectionRaw = patchObj.connection as Record<string, unknown>
    ensureNoExtraKeys(connectionRaw, "patch.connection", [
      "adminCidr",
      "sshExposureMode",
      "sshKeyCount",
      "sshAuthorizedKeys",
    ])
    const sshAuthorizedKeys = Array.isArray(connectionRaw.sshAuthorizedKeys)
      ? Array.from(
          new Set(
            connectionRaw.sshAuthorizedKeys
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .filter(Boolean),
          ),
        )
      : undefined
    const exposureMode = typeof connectionRaw.sshExposureMode === "string" ? connectionRaw.sshExposureMode.trim() : ""
    patch.connection = {
      adminCidr: typeof connectionRaw.adminCidr === "string" ? connectionRaw.adminCidr : undefined,
      sshExposureMode:
        exposureMode === "bootstrap" || exposureMode === "tailnet" || exposureMode === "public"
          ? exposureMode
          : exposureMode
            ? (() => {
                throw new Error("patch.connection.sshExposureMode invalid")
              })()
            : undefined,
      sshKeyCount:
        typeof connectionRaw.sshKeyCount === "number" && Number.isFinite(connectionRaw.sshKeyCount)
          ? Math.max(0, Math.trunc(connectionRaw.sshKeyCount))
          : undefined,
      sshAuthorizedKeys,
    }
  }

  if (!patch.infrastructure && !patch.connection) throw new Error("patch required")
  return {
    projectId: base.projectId,
    host: base.host,
    expectedVersion,
    patch,
  }
}

function parseSetupDraftSaveSealedSectionInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  section: SetupDraftSecretSection
  targetRunnerId: Id<"runners">
  sealedInputB64: string
  sealedInputAlg: string
  sealedInputKeyId: string
  aad: string
  expectedVersion?: number
} {
  const base = parseProjectHostRequiredInput(data)
  const row = data as Record<string, unknown>
  const targetRunnerId = typeof row.targetRunnerId === "string" ? row.targetRunnerId.trim() : ""
  const sealedInputB64 = typeof row.sealedInputB64 === "string" ? row.sealedInputB64.trim() : ""
  const sealedInputAlg = typeof row.sealedInputAlg === "string" ? row.sealedInputAlg.trim() : ""
  const sealedInputKeyId = typeof row.sealedInputKeyId === "string" ? row.sealedInputKeyId.trim() : ""
  const aad = typeof row.aad === "string" ? row.aad.trim() : ""
  const expectedVersionRaw = row.expectedVersion
  const expectedVersion =
    typeof expectedVersionRaw === "number" && Number.isFinite(expectedVersionRaw)
      ? Math.max(0, Math.trunc(expectedVersionRaw))
      : undefined
  if (!targetRunnerId) throw new Error("targetRunnerId required")
  if (!sealedInputB64) throw new Error("sealedInputB64 required")
  if (!sealedInputAlg) throw new Error("sealedInputAlg required")
  if (!sealedInputKeyId) throw new Error("sealedInputKeyId required")
  if (!aad) throw new Error("aad required")
  return {
    projectId: base.projectId,
    host: base.host,
    section: parseSection(row.section),
    targetRunnerId: targetRunnerId as Id<"runners">,
    sealedInputB64,
    sealedInputAlg,
    sealedInputKeyId,
    aad,
    expectedVersion,
  }
}

function parseSetupDraftDiscardInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const base = parseProjectHostRequiredInput(data)
  return { projectId: base.projectId, host: base.host }
}

function listNonSecretPatchKeys(patch: SetupDraftNonSecretPatch): string[] {
  const keys: string[] = []
  if (patch.infrastructure) {
    if (patch.infrastructure.serverType !== undefined) keys.push("infrastructure.serverType")
    if (patch.infrastructure.image !== undefined) keys.push("infrastructure.image")
    if (patch.infrastructure.location !== undefined) keys.push("infrastructure.location")
    if (patch.infrastructure.allowTailscaleUdpIngress !== undefined) keys.push("infrastructure.allowTailscaleUdpIngress")
    if (patch.infrastructure.volumeEnabled !== undefined) keys.push("infrastructure.volumeEnabled")
    if (patch.infrastructure.volumeSizeGb !== undefined) keys.push("infrastructure.volumeSizeGb")
  }
  if (patch.connection) {
    if (patch.connection.adminCidr !== undefined) keys.push("connection.adminCidr")
    if (patch.connection.sshExposureMode !== undefined) keys.push("connection.sshExposureMode")
    if (patch.connection.sshKeyCount !== undefined) keys.push("connection.sshKeyCount")
    if (patch.connection.sshAuthorizedKeys !== undefined) keys.push("connection.sshAuthorizedKeys")
  }
  return keys.length > 0 ? keys : ["nonSecretDraft"]
}

export function buildSetupDraftSectionAad(params: {
  projectId: Id<"projects">
  host: string
  section: SetupDraftSecretSection
  targetRunnerId: Id<"runners">
}): string {
  return `${params.projectId}:${params.host}:setupDraft:${params.section}:${params.targetRunnerId}`
}

export const setupDraftGet = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftDiscardInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    return (await client.query(api.controlPlane.setupDrafts.get, {
      projectId: data.projectId,
      hostName: data.host,
    })) as SetupDraftView | null
  })

export const setupDraftSaveNonSecret = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftSaveNonSecretInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const draft = (await client.mutation(api.controlPlane.setupDrafts.saveNonSecret, {
      projectId: data.projectId,
      hostName: data.host,
      expectedVersion: data.expectedVersion,
      patch: data.patch,
    })) as SetupDraftView
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "setup.draft.save_non_secret",
      target: { host: data.host },
      data: { updatedKeys: listNonSecretPatchKeys(data.patch) },
    })
    return draft
  })

export const setupDraftSaveSealedSection = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftSaveSealedSectionInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const draft = (await client.mutation(api.controlPlane.setupDrafts.saveSealedSection, {
      projectId: data.projectId,
      hostName: data.host,
      section: data.section,
      targetRunnerId: data.targetRunnerId,
      sealedInputB64: data.sealedInputB64,
      sealedInputAlg: data.sealedInputAlg,
      sealedInputKeyId: data.sealedInputKeyId,
      aad: data.aad,
      expectedVersion: data.expectedVersion,
    })) as SetupDraftView
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "setup.draft.save_sealed_section",
      target: { host: data.host },
      data: { updatedKeys: [data.section] },
    })
    return draft
  })

export const setupDraftDiscard = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftDiscardInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    await client.mutation(api.controlPlane.setupDrafts.discard, {
      projectId: data.projectId,
      hostName: data.host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "setup.draft.discard",
      target: { host: data.host },
    })
    return { ok: true as const }
  })
