export function coerceString(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  return ""
}

export function coerceTrimmedString(value: unknown): string {
  return coerceString(value).trim()
}

export function formatUnknown(value: unknown, fallback = ""): string {
  if (value instanceof Error) {
    const message = value.message.trim()
    if (message) return message
  }
  const primitive = coerceString(value)
  if (primitive) return primitive
  if (value === null || value === undefined) return fallback
  try {
    const json = JSON.stringify(value)
    return typeof json === "string" ? json : fallback
  } catch {
    return fallback
  }
}
