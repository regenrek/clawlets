import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import { getRepoLayout, safeFileSegment } from "../../repo-layout.js";
import { writeFileAtomic } from "../storage/fs-safe.js";
import { ClawletsConfigSchema, loadFullConfig, writeClawletsConfig } from "../config/clawlets-config.js";
import { updateDeployCredsEnvFile } from "../infra/deploy-creds.js";
import { collectSecretsStatus, summarizeSecretsStatusResults } from "../secrets/status.js";
import { mkpasswdYescryptHash } from "../security/mkpasswd.js";
import { run } from "../runtime/run.js";
import { deleteAtPath, setAtPath } from "../storage/object-path.js";
import { splitDotPath } from "../storage/dot-path.js";

import type { SetupApplyExecutionInput } from "./plan.js";
import { createSetupApplyStepResult, type SetupApplyExecutionResult, type SetupApplyStepId, type SetupApplyStepResult } from "./shared.js";

export type SetupApplyRuntime = {
  repoRoot: string;
  runtimeDir?: string;
  envFile?: string;
  cliEntryPath?: string;
  cliEntry?: string;
  cwd?: string;
  operationId?: string;
  attempt?: number;
  onStep?: (step: SetupApplyStepResult, steps: SetupApplyStepResult[]) => Promise<void> | void;
};

const STEP_ORDER: SetupApplyStepId[] = [
  "plan_validated",
  "workspace_staged",
  "config_written",
  "deploy_creds_written",
  "bootstrap_secrets_initialized",
  "bootstrap_secrets_verified",
  "persist_committed",
];

function initialSteps(): SetupApplyStepResult[] {
  return STEP_ORDER.map((stepId) =>
    createSetupApplyStepResult({
      stepId,
      status: "pending",
      safeMessage: "",
      retryable: true,
      updatedAtMs: Date.now(),
    }))
}

function setupEnv(params: { nixBin: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: "1",
    CLAWLETS_NON_INTERACTIVE: "1",
    NIX_BIN: params.nixBin,
  };
}

async function buildSecretsInitBody(params: {
  bootstrapSecrets: Record<string, string>;
  repoRoot: string;
  nixBin: string;
}): Promise<{
  adminPasswordHash?: string;
  tailscaleAuthKey?: string;
  secrets: Record<string, string>;
}> {
  const adminPasswordHashRaw = String(params.bootstrapSecrets.adminPasswordHash || "").trim();
  const adminPasswordRaw = String(params.bootstrapSecrets.adminPassword || "").trim();
  const tailscaleAuthKey = String(
    params.bootstrapSecrets.tailscaleAuthKey || params.bootstrapSecrets.tailscale_auth_key || "",
  ).trim();
  const adminPasswordHash = adminPasswordHashRaw
    || (adminPasswordRaw
      ? await mkpasswdYescryptHash(adminPasswordRaw, {
          nixBin: params.nixBin,
          cwd: params.repoRoot,
          dryRun: false,
          env: setupEnv({ nixBin: params.nixBin }),
        })
      : "");

  const secrets: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(params.bootstrapSecrets)) {
    if (
      key === "adminPasswordHash" ||
      key === "adminPassword" ||
      key === "tailscaleAuthKey" ||
      key === "tailscale_auth_key"
    ) {
      continue;
    }
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    secrets[normalizedKey] = value;
  }

  return {
    ...(adminPasswordHash ? { adminPasswordHash } : {}),
    ...(tailscaleAuthKey ? { tailscaleAuthKey } : {}),
    secrets,
  };
}

async function copyPathIfExists(sourcePath: string, targetPath: string): Promise<void> {
  try {
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true });
      return;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw error;
  }
}

async function stageWorkspace(params: {
  repoRoot: string;
  runtimeDir?: string;
  operationId?: string;
  attempt?: number;
}): Promise<{ stageRepoRoot: string; stageRuntimeDir: string; stageRoot: string }> {
  const liveLayout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const stageName = `${safeFileSegment(params.operationId || "setup-apply", "operation")}-a${Math.max(1, Math.trunc(params.attempt ?? 1))}-${randomUUID()}`;
  const stageRoot = path.join(os.tmpdir(), "clawlets-setup-apply", stageName);
  const stageRepoRoot = path.join(stageRoot, "repo");
  const stageRuntimeDir = path.join(stageRoot, "runtime");

  await fs.mkdir(stageRepoRoot, { recursive: true });
  await fs.mkdir(stageRuntimeDir, { recursive: true });
  await copyPathIfExists(path.join(params.repoRoot, "flake.nix"), path.join(stageRepoRoot, "flake.nix"));
  await copyPathIfExists(path.join(params.repoRoot, "scripts"), path.join(stageRepoRoot, "scripts"));
  await copyPathIfExists(liveLayout.fleetDir, path.join(stageRepoRoot, "fleet"));
  await copyPathIfExists(liveLayout.secretsDir, path.join(stageRepoRoot, "secrets"));
  await copyPathIfExists(liveLayout.localKeysDir, path.join(stageRuntimeDir, "keys"));
  await copyPathIfExists(liveLayout.extraFilesDir, path.join(stageRuntimeDir, "extra-files"));
  await copyPathIfExists(liveLayout.envFilePath, path.join(stageRuntimeDir, "env"));

  return { stageRepoRoot, stageRuntimeDir, stageRoot };
}

async function writeConfigMutations(params: {
  repoRoot: string;
  runtimeDir?: string;
  mutations: SetupApplyExecutionInput["configMutations"];
}): Promise<string[]> {
  const loaded = loadFullConfig({ repoRoot: params.repoRoot, runtimeDir: params.runtimeDir });
  const next = structuredClone(loaded.config) as any;
  const updatedPaths: string[] = [];
  for (const mutation of params.mutations) {
    const parts = splitDotPath(mutation.path);
    const pathKey = parts.join(".");
    if (mutation.del) {
      const removed = deleteAtPath(next, parts);
      if (removed) updatedPaths.push(pathKey);
      continue;
    }
    if (typeof mutation.valueJson === "string") {
      setAtPath(next, parts, JSON.parse(mutation.valueJson));
      updatedPaths.push(pathKey);
      continue;
    }
    if (typeof mutation.value === "string") {
      setAtPath(next, parts, mutation.value);
      updatedPaths.push(pathKey);
      continue;
    }
    throw new Error(`config mutation missing value for ${pathKey}`);
  }
  const validated = ClawletsConfigSchema.parse(next);
  await writeClawletsConfig({ configPath: loaded.infraConfigPath, config: validated });
  return updatedPaths;
}

async function collectFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true }) as Dirent[];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(nextPath);
        continue;
      }
      if (!entry.isFile()) continue;
      output.push(nextPath);
    }
  }
  await visit(root);
  return output;
}

async function syncTreeTextFiles(params: {
  sourceRoot: string;
  targetRoot: string;
}): Promise<void> {
  const files = await collectFiles(params.sourceRoot);
  for (const sourcePath of files) {
    const relative = path.relative(params.sourceRoot, sourcePath);
    const targetPath = path.join(params.targetRoot, relative);
    const sourceStat = await fs.stat(sourcePath);
    const contents = await fs.readFile(sourcePath, "utf8");
    await writeFileAtomic(targetPath, contents, { mode: sourceStat.mode & 0o777 });
  }
}

async function persistFromStage(params: {
  stageRepoRoot: string;
  stageRuntimeDir: string;
  liveRepoRoot: string;
  liveRuntimeDir?: string;
  operationId?: string;
  attempt?: number;
}): Promise<void> {
  const liveLayout = getRepoLayout(params.liveRepoRoot, params.liveRuntimeDir);
  const stageLayout = getRepoLayout(params.stageRepoRoot, params.stageRuntimeDir);

  await syncTreeTextFiles({
    sourceRoot: stageLayout.fleetDir,
    targetRoot: liveLayout.fleetDir,
  });
  await syncTreeTextFiles({
    sourceRoot: stageLayout.secretsDir,
    targetRoot: liveLayout.secretsDir,
  });
  await syncTreeTextFiles({
    sourceRoot: stageLayout.localKeysDir,
    targetRoot: liveLayout.localKeysDir,
  });
  await syncTreeTextFiles({
    sourceRoot: stageLayout.extraFilesDir,
    targetRoot: liveLayout.extraFilesDir,
  });
  try {
    const envText = await fs.readFile(stageLayout.envFilePath, "utf8");
    await writeFileAtomic(liveLayout.envFilePath, envText, { mode: 0o600 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }

  const markerDir = path.join(liveLayout.runtimeDir, "setup-operations");
  await fs.mkdir(markerDir, { recursive: true });
  const markerPath = path.join(
    markerDir,
    `${safeFileSegment(params.operationId || "setup-apply", "operation")}.json`,
  );
  await writeFileAtomic(
    markerPath,
    `${JSON.stringify({
      operationId: params.operationId ?? null,
      attempt: Math.max(1, Math.trunc(params.attempt ?? 1)),
      committedAt: Date.now(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function runSecretsInit(params: {
  cliEntryPath: string;
  repoRoot: string;
  runtimeDir: string;
  envFile?: string;
  hostName: string;
  secretsInitBody: Record<string, unknown>;
  nixBin: string;
  sopsAgeKeyFile?: string;
}): Promise<void> {
  const inputPath = path.join(
    params.runtimeDir,
    `setup-apply.${safeFileSegment(params.hostName, "host")}.${randomUUID()}.json`,
  );
  try {
    await writeFileAtomic(inputPath, `${JSON.stringify(params.secretsInitBody, null, 2)}\n`, { mode: 0o600 });
    const ageKeyArgs = params.sopsAgeKeyFile ? ["--ageKeyFile", params.sopsAgeKeyFile] : [];
    await run(
      process.execPath,
      [
        params.cliEntryPath,
        "secrets",
        "init",
        "--runtimeDir",
        params.runtimeDir,
        "--host",
        params.hostName,
        "--scope",
        "bootstrap",
        "--from-json",
        inputPath,
        "--allowMissingAdminPasswordHash",
        ...ageKeyArgs,
        "--yes",
      ],
      {
        cwd: params.repoRoot,
        env: setupEnv({ nixBin: params.nixBin }),
        stdin: "ignore",
        stdout: "ignore",
      },
    );
  } finally {
    await fs.rm(inputPath, { force: true });
  }
}

async function runSecretsVerify(params: {
  repoRoot: string;
  runtimeDir: string;
  hostName: string;
  nixBin: string;
  sopsAgeKeyFile?: string;
}): Promise<{
  summary: {
    ok: number;
    missing: number;
    warn: number;
    total: number;
  };
  firstMissing?: { secret: string; detail?: string };
}> {
  const { layout, config } = loadFullConfig({
    repoRoot: params.repoRoot,
    runtimeDir: params.runtimeDir,
  });
  const report = await collectSecretsStatus({
    layout,
    config,
    hostName: params.hostName,
    scope: "bootstrap",
    operatorKeyPath: params.sopsAgeKeyFile,
    nix: {
      nixBin: params.nixBin,
      cwd: params.repoRoot,
      dryRun: false,
    },
  });
  const summary = summarizeSecretsStatusResults(report.results);
  const firstMissing = report.results.find((row) => row.status === "missing");
  return {
    summary,
    ...(firstMissing ? { firstMissing: { secret: firstMissing.secret, detail: firstMissing.detail } } : {}),
  };
}

export async function executeSetupApplyPlan(
  input: SetupApplyExecutionInput,
  runtime: SetupApplyRuntime,
): Promise<SetupApplyExecutionResult> {
  const cliEntryPath = String(runtime.cliEntryPath || runtime.cliEntry || "").trim();
  if (!cliEntryPath) throw new Error("cli entry path required");
  const steps = initialSteps();
  const attempt = Math.max(1, Math.trunc(runtime.attempt ?? 1));
  const emitStep = async (next: SetupApplyStepResult): Promise<void> => {
    const index = steps.findIndex((row) => row.stepId === next.stepId);
    if (index >= 0) steps[index] = next;
    if (runtime.onStep) await runtime.onStep(next, steps);
  };
  const updateStep = async (
    stepId: SetupApplyStepId,
    status: SetupApplyStepResult["status"],
    safeMessage: string,
    detail?: Record<string, unknown>,
    retryable = true,
  ) => {
    await emitStep(createSetupApplyStepResult({
      stepId,
      status,
      safeMessage,
      detail,
      retryable,
      updatedAtMs: Date.now(),
    }));
  };

  let stageRoot = "";
  try {
    await updateStep("plan_validated", "running", "Validating setup apply plan");
    await updateStep("plan_validated", "succeeded", "Setup apply plan validated", {
      hostName: input.hostName,
      configMutationCount: input.configMutations.length,
    });

    await updateStep("workspace_staged", "running", "Creating staging workspace");
    const staged = await stageWorkspace({
      repoRoot: runtime.repoRoot,
      runtimeDir: runtime.runtimeDir,
      operationId: runtime.operationId,
      attempt,
    });
    stageRoot = staged.stageRoot;
    await updateStep("workspace_staged", "succeeded", "Staging workspace ready", {
      stageRepoRoot: staged.stageRepoRoot,
      stageRuntimeDir: staged.stageRuntimeDir,
    });

    await updateStep("config_written", "running", "Writing staged config");
    const configUpdatedPaths = await writeConfigMutations({
      repoRoot: staged.stageRepoRoot,
      runtimeDir: staged.stageRuntimeDir,
      mutations: input.configMutations,
    });
    await updateStep("config_written", "succeeded", "Staged config written", {
      updatedPaths: configUpdatedPaths,
      updatedCount: configUpdatedPaths.length,
    });

    await updateStep("deploy_creds_written", "running", "Writing staged deploy credentials");
    const deployCredsResult = await updateDeployCredsEnvFile({
      repoRoot: staged.stageRepoRoot,
      runtimeDir: staged.stageRuntimeDir,
      envFile: runtime.envFile,
      updates: input.deployCreds,
    });
    await updateStep("deploy_creds_written", "succeeded", "Staged deploy credentials written", {
      updatedKeys: deployCredsResult.updatedKeys,
      envPath: deployCredsResult.envPath,
    });

    const nixBin = String(input.deployCreds.NIX_BIN || process.env.NIX_BIN || "nix").trim() || "nix";
    const sopsAgeKeyFile = String(input.deployCreds.SOPS_AGE_KEY_FILE || "").trim() || undefined;
    const secretsInitBody = await buildSecretsInitBody({
      bootstrapSecrets: input.bootstrapSecrets,
      repoRoot: staged.stageRepoRoot,
      nixBin,
    });

    await updateStep("bootstrap_secrets_initialized", "running", "Initializing staged bootstrap secrets");
    await runSecretsInit({
      cliEntryPath,
      repoRoot: staged.stageRepoRoot,
      runtimeDir: staged.stageRuntimeDir,
      envFile: runtime.envFile,
      hostName: input.hostName,
      secretsInitBody,
      nixBin,
      sopsAgeKeyFile,
    });
    await updateStep("bootstrap_secrets_initialized", "succeeded", "Staged bootstrap secrets initialized", {
      submittedSecretCount: Object.keys(input.bootstrapSecrets).length,
    });

    await updateStep("bootstrap_secrets_verified", "running", "Verifying staged bootstrap secrets");
    const verifyStatus = await runSecretsVerify({
      repoRoot: staged.stageRepoRoot,
      runtimeDir: staged.stageRuntimeDir,
      hostName: input.hostName,
      nixBin,
      sopsAgeKeyFile,
    });
    if (verifyStatus.summary.missing > 0) {
      const detail = verifyStatus.firstMissing?.detail?.trim();
      const message = detail
        ? `${verifyStatus.firstMissing?.secret}: ${detail}`
        : verifyStatus.firstMissing?.secret
          ? `Missing bootstrap secret: ${verifyStatus.firstMissing.secret}`
          : `bootstrap secrets verify failed: missing=${verifyStatus.summary.missing}`;
      throw new Error(message);
    }
    await updateStep("bootstrap_secrets_verified", "succeeded", "Staged bootstrap secrets verified", verifyStatus.summary);

    await updateStep("persist_committed", "running", "Persisting staged setup artifacts");
    await persistFromStage({
      stageRepoRoot: staged.stageRepoRoot,
      stageRuntimeDir: staged.stageRuntimeDir,
      liveRepoRoot: runtime.repoRoot,
      liveRuntimeDir: runtime.runtimeDir,
      operationId: runtime.operationId,
      attempt,
    });
    const summary = {
      hostName: input.hostName,
      configUpdatedPaths,
      deployCredsUpdatedKeys: deployCredsResult.updatedKeys,
      verifiedSecrets: verifyStatus.summary,
    };
    await updateStep("persist_committed", "succeeded", "Setup apply committed", {
      ...summary,
      operationId: runtime.operationId ?? null,
      attempt,
    });

    return {
      terminal: "succeeded",
      steps,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failingStep =
      steps.find((row) => row.status === "running")?.stepId
      || steps.find((row) => row.status === "pending")?.stepId
      || "persist_committed";
    await updateStep(failingStep, "failed", message, undefined, true);
    throw error;
  } finally {
    if (stageRoot) {
      await fs.rm(stageRoot, { recursive: true, force: true });
    }
  }
}
