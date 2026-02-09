export const RUNNER_FRESHNESS_MS = 30_000

export type RunnerPresence = {
  lastStatus?: string | null
  lastSeenAt?: number | null
}

export function isRunnerFreshOnline(runner: RunnerPresence, now = Date.now()): boolean {
  if (runner.lastStatus !== "online") return false
  if (typeof runner.lastSeenAt !== "number" || !Number.isFinite(runner.lastSeenAt)) return false
  return now - runner.lastSeenAt < RUNNER_FRESHNESS_MS
}

export function isProjectRunnerOnline(runners: RunnerPresence[] | null | undefined, now = Date.now()): boolean {
  if (!Array.isArray(runners) || runners.length === 0) return false
  return runners.some((runner) => isRunnerFreshOnline(runner, now))
}
