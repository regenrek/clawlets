import { describe, expect, it } from "vitest"
import { RUNNER_FRESHNESS_MS, isProjectRunnerOnline, isRunnerFreshOnline } from "../src/lib/setup/runner-status"

describe("runner status helpers", () => {
  it("marks runner online only when status is online and fresh", () => {
    const now = 1_700_000_000_000
    expect(isRunnerFreshOnline({ lastStatus: "online", lastSeenAt: now - 1 }, now)).toBe(true)
    expect(isRunnerFreshOnline({ lastStatus: "online", lastSeenAt: now - RUNNER_FRESHNESS_MS }, now)).toBe(false)
    expect(isRunnerFreshOnline({ lastStatus: "offline", lastSeenAt: now - 1 }, now)).toBe(false)
    expect(isRunnerFreshOnline({ lastStatus: "online", lastSeenAt: null }, now)).toBe(false)
  })

  it("derives project runner online state from runner list", () => {
    const now = 1_700_000_000_000
    expect(isProjectRunnerOnline([], now)).toBe(false)
    expect(isProjectRunnerOnline(null, now)).toBe(false)
    expect(
      isProjectRunnerOnline(
        [
          { lastStatus: "offline", lastSeenAt: now - 1000 },
          { lastStatus: "online", lastSeenAt: now - 1000 },
        ],
        now,
      ),
    ).toBe(true)
    expect(
      isProjectRunnerOnline(
        [
          { lastStatus: "online", lastSeenAt: now - RUNNER_FRESHNESS_MS - 1 },
        ],
        now,
      ),
    ).toBe(false)
  })
})
