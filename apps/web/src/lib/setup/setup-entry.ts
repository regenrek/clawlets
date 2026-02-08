export const RUNNER_SETUP_PLACEHOLDER_HOST = "setup-runner"

export function resolveSetupHost(hostNames: Iterable<string>): string {
  const normalized = Array.from(hostNames)
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b))
  return normalized[0] || RUNNER_SETUP_PLACEHOLDER_HOST
}
