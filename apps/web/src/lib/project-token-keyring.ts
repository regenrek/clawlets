export type ProjectTokenKeyringEntry = {
  id: string
  label: string
  value: string
}

export type ProjectTokenKeyring = {
  items: ProjectTokenKeyringEntry[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeLabel(rawLabel: string, value: string): string {
  const next = rawLabel.trim()
  if (next) return next
  const head = value.trim().slice(0, 6)
  const tail = value.trim().slice(-4)
  if (head && tail) return `Key ${head}...${tail}`
  return "Key"
}

export function parseProjectTokenKeyring(raw: unknown): ProjectTokenKeyring {
  const json = trim(raw)
  if (!json) return { items: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { items: [] }
  }

  const root = asRecord(parsed)
  if (!root) return { items: [] }
  const rows = Array.isArray(root.items) ? root.items : []

  const seen = new Set<string>()
  const out: ProjectTokenKeyringEntry[] = []
  for (const row of rows) {
    const obj = asRecord(row)
    if (!obj) continue
    const id = trim(obj.id)
    const value = trim(obj.value)
    if (!id || !value) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label: normalizeLabel(trim(obj.label), value),
      value,
    })
  }

  return { items: out }
}

export function serializeProjectTokenKeyring(keyring: ProjectTokenKeyring): string {
  const normalized = {
    items: keyring.items
      .map((entry) => ({
        id: trim(entry.id),
        label: normalizeLabel(trim(entry.label), trim(entry.value)),
        value: trim(entry.value),
      }))
      .filter((entry) => entry.id.length > 0 && entry.value.length > 0),
  }
  return JSON.stringify(normalized)
}

export function resolveActiveProjectTokenEntry(params: {
  keyring: ProjectTokenKeyring
  activeId: string
}): ProjectTokenKeyringEntry | null {
  const requested = params.activeId.trim()
  const byId = requested
    ? params.keyring.items.find((row) => row.id === requested)
    : undefined
  return byId ?? params.keyring.items[0] ?? null
}

export function maskProjectToken(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return "********"
  return `${trimmed.slice(0, 4)}******${trimmed.slice(-4)}`
}

export function generateProjectTokenKeyId(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)

  const randomPart = (() => {
    const maybeCrypto = globalThis.crypto
    if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
      return maybeCrypto.randomUUID().replace(/-/g, "").slice(0, 8)
    }
    return Math.random().toString(36).slice(2, 10)
  })()

  return `${base || "key"}-${randomPart}`
}
