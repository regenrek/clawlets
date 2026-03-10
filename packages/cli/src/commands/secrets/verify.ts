import process from "node:process";
import { defineCommand } from "citty";
import { sanitizeOperatorId } from "@clawlets/shared/lib/identifiers";
import { loadDeployCreds } from "@clawlets/core/lib/infra/deploy-creds";
import { collectSecretsStatus, summarizeSecretsStatusResults } from "@clawlets/core/lib/secrets/status";
import { getLocalOperatorAgeKeyPath } from "@clawlets/core/repo-layout";
import { loadHostContextOrExit } from "@clawlets/core/lib/runtime/context";
import { parseSecretsScope } from "./common.js";

async function readSecretsStatus(args: any) {
  const cwd = process.cwd();
  const ctx = loadHostContextOrExit({ cwd, runtimeDir: args.runtimeDir, hostArg: args.host });
  if (!ctx) return null;
  const { layout, config, hostName } = ctx;

  const deployCreds = loadDeployCreds({ cwd, runtimeDir: args.runtimeDir, envFile: args.envFile });
  if (deployCreds.envFile?.origin === "explicit" && deployCreds.envFile.status !== "ok") {
    throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || deployCreds.envFile.status})`);
  }

  const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));
  const operatorKeyPath =
    (args.ageKeyFile ? String(args.ageKeyFile).trim() : "") ||
    (deployCreds.values.SOPS_AGE_KEY_FILE ? String(deployCreds.values.SOPS_AGE_KEY_FILE).trim() : "") ||
    getLocalOperatorAgeKeyPath(layout, operatorId);

  const nix = {
    nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
    cwd: layout.repoRoot,
    dryRun: false,
  } as const;

  return await collectSecretsStatus({
    layout,
    config,
    hostName,
    scope: parseSecretsScope(args.scope),
    operatorKeyPath,
    nix,
  });
}

export const secretsStatus = defineCommand({
  meta: {
    name: "status",
    description: "Return repo-backed secret status without failing the process on missing secrets.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    scope: { type: "string", description: "Secrets scope (bootstrap|updates|openclaw|all).", default: "all" },
    operator: {
      type: "string",
      description: "Operator id for age key name (default: $USER). Used if SOPS_AGE_KEY_FILE is not set.",
    },
    ageKeyFile: { type: "string", description: "Override SOPS_AGE_KEY_FILE path." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const report = await readSecretsStatus(args as any);
    if (!report) return;
    if ((args as any).json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    for (const row of report.results) {
      console.log(`${row.status}: ${row.secret}${row.detail ? ` (${row.detail})` : ""}`);
    }
  },
});

export const secretsVerify = defineCommand({
  meta: {
    name: "verify",
    description: "Verify secrets decrypt correctly and contain no placeholders.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    scope: { type: "string", description: "Secrets scope (bootstrap|updates|openclaw|all).", default: "all" },
    operator: {
      type: "string",
      description: "Operator id for age key name (default: $USER). Used if SOPS_AGE_KEY_FILE is not set.",
    },
    ageKeyFile: { type: "string", description: "Override SOPS_AGE_KEY_FILE path." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const report = await readSecretsStatus(args as any);
    if (!report) return;
    if ((args as any).json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const row of report.results) {
        console.log(`${row.status}: ${row.secret}${row.detail ? ` (${row.detail})` : ""}`);
      }
    }
    const summary = summarizeSecretsStatusResults(report.results);
    if (summary.missing > 0) process.exitCode = 1;
  },
});
