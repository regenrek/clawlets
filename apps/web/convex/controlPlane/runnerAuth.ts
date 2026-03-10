import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type RunnerTouchCtx = {
  runMutation: (...args: any[]) => Promise<unknown>;
};

const RUNNER_TOKEN_TOUCH_MIN_INTERVAL_MS = 5 * 60_000;

export async function touchRunnerTokenLastUsed(
  ctx: RunnerTouchCtx,
  params: { tokenId: Id<"runnerTokens">; now: number; minIntervalMs?: number; runnerName?: string },
): Promise<void> {
  const runnerName = typeof params.runnerName === "string" ? params.runnerName.trim() : "";
  try {
    await ctx.runMutation(internal.controlPlane.runnerTokens.touchLastUsedIfStaleInternal, {
      tokenId: params.tokenId,
      now: params.now,
      minIntervalMs: Math.max(0, Math.trunc(params.minIntervalMs ?? RUNNER_TOKEN_TOUCH_MIN_INTERVAL_MS)),
      ...(runnerName ? { runnerName } : {}),
    });
  } catch {
    // best-effort write; auth should not fail due to touch telemetry.
  }
}
