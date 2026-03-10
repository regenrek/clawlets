import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { executeSetupApplyPlan } from "@clawlets/core/lib/setup/engine";
import { parseSetupApplyPlan } from "@clawlets/core/lib/setup/plan";

const setupApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply setup plan JSON in one non-interactive pass.",
  },
  args: {
    runtimeDir: {
      type: "string",
      description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>).",
    },
    envFile: { type: "string", description: "Deploy creds env file (default: <runtimeDir>/env)." },
    fromJson: { type: "string", required: true, description: "Path to setup plan JSON." },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const runtimeDir = typeof (args as any).runtimeDir === "string" ? String((args as any).runtimeDir) : undefined;
    const envFile = typeof (args as any).envFile === "string" ? String((args as any).envFile) : undefined;
    const fromJsonRaw = String((args as any).fromJson || "").trim();
    if (!fromJsonRaw) throw new Error("missing --from-json");
    const fromJsonPath = path.isAbsolute(fromJsonRaw) ? fromJsonRaw : path.resolve(cwd, fromJsonRaw);
    const plan = parseSetupApplyPlan(await fs.readFile(fromJsonPath, "utf8"));
    const cliEntry = process.argv[1];
    if (!cliEntry) throw new Error("unable to resolve CLI entry path");

    const result = await executeSetupApplyPlan(plan, {
      cliEntry,
      repoRoot,
      cwd,
      runtimeDir,
      envFile,
    });
    const summary = {
      ok: true as const,
      hostName: result.summary.hostName,
      config: {
        updatedPaths: result.summary.configUpdatedPaths,
        updatedCount: result.summary.configUpdatedPaths.length,
      },
      deployCreds: {
        updatedKeys: result.summary.deployCredsUpdatedKeys,
      },
      bootstrapSecrets: {
        submittedCount: Object.keys(plan.bootstrapSecrets).length,
        verify: result.summary.verifiedSecrets,
      },
      steps: result.steps,
    };
    if ((args as any).json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log(`ok: setup apply completed for ${summary.hostName}`);
    console.log(`- config paths updated: ${summary.config.updatedCount}`);
    console.log(`- deploy creds updated: ${summary.deployCreds.updatedKeys.join(", ")}`);
    console.log(
      `- secrets verify: ok=${summary.bootstrapSecrets.verify.ok} missing=${summary.bootstrapSecrets.verify.missing} warn=${summary.bootstrapSecrets.verify.warn}`,
    );
  },
});

export const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Setup helper commands.",
  },
  subCommands: {
    apply: setupApply,
  },
});
