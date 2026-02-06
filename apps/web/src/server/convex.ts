import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";

import { fetchAuthAction, fetchAuthMutation, fetchAuthQuery } from "~/server/better-auth";

export type ConvexClient = {
  query: <Query extends FunctionReference<"query">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  mutation: <Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
  action: <Action extends FunctionReference<"action">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ) => Promise<FunctionReturnType<Action>>;
};

function getConvexUrl(): string {
  const url = String(process.env["VITE_CONVEX_URL"] || process.env["CONVEX_URL"] || "").trim();
  if (!url) throw new Error("missing VITE_CONVEX_URL");
  return url;
}

export function createConvexClient(): ConvexClient {
  return {
    query: async (query, ...args) => {
      return await fetchAuthQuery(query, args[0]);
    },
    mutation: async (mutation, ...args) => {
      return await fetchAuthMutation(mutation, args[0]);
    },
    action: async (action, ...args) => {
      return await fetchAuthAction(action, args[0]);
    },
  };
}
