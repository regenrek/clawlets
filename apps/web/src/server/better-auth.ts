import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";

import { isAuthError } from "~/lib/auth-utils";
import { assertAuthEnv } from "./env";

function getConvexUrl(): string {
  const url = String(process.env["VITE_CONVEX_URL"] || process.env["CONVEX_URL"] || "").trim();
  if (!url) throw new Error("missing VITE_CONVEX_URL");
  return url;
}

function getConvexSiteUrl(): string {
  const url = String(
    process.env["VITE_CONVEX_SITE_URL"] || process.env["CONVEX_SITE_URL"] || "",
  ).trim();
  if (!url) {
    throw new Error(
      "missing VITE_CONVEX_SITE_URL (must be your Convex Site URL ending in .convex.site)",
    );
  }
  return url;
}

type BetterAuthStart = ReturnType<typeof convexBetterAuthReactStart>;

let cachedStart: BetterAuthStart | null = null;
function getStart(): BetterAuthStart {
  // Keep import side-effect free. Validate env at first use.
  assertAuthEnv();
  if (cachedStart) return cachedStart;
  cachedStart = convexBetterAuthReactStart({
    convexUrl: getConvexUrl(),
    convexSiteUrl: getConvexSiteUrl(),
    jwtCache: { enabled: true, isAuthError },
  });
  return cachedStart;
}

export function getToken(...args: Parameters<BetterAuthStart["getToken"]>) {
  return getStart().getToken(...args);
}

export function handler(...args: Parameters<BetterAuthStart["handler"]>) {
  return getStart().handler(...args);
}

export function fetchAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args?: OptionalRestArgs<Query>[0],
): Promise<FunctionReturnType<Query>> {
  return getStart().fetchAuthQuery(query, args);
}

export function fetchAuthMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  args?: OptionalRestArgs<Mutation>[0],
): Promise<FunctionReturnType<Mutation>> {
  return getStart().fetchAuthMutation(mutation, args);
}

export function fetchAuthAction<Action extends FunctionReference<"action">>(
  action: Action,
  args?: OptionalRestArgs<Action>[0],
): Promise<FunctionReturnType<Action>> {
  return getStart().fetchAuthAction(action, args);
}
