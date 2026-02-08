export function coerceString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

export function coerceTrimmedString(value: unknown): string {
  return coerceString(value).trim()
}
