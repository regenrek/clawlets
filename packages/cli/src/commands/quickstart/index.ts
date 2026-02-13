import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { resolveNixBin } from "@clawlets/core/lib/nix/nix-bin";
import { updateDeployCredsEnvFile } from "@clawlets/core/lib/infra/deploy-creds";
import { parseDotenv, upsertDotenv } from "@clawlets/core/lib/storage/dotenv-file";
import { capture, run } from "@clawlets/core/lib/runtime/run";

type InstallNixMode = "auto" | "always" | "never";
type UiMode = "dev" | "prod" | "none";
type NixResultStatus = "already_installed" | "installed" | "skipped";
type ConvexResultStatus = "configured" | "skipped";
type UiResultStatus = "started" | "skipped";

type QuickstartSummary = {
  ok: true;
  repoRoot: string;
  platform: string;
  nodeVersion: string;
  nix: {
    status: NixResultStatus;
    nixBin: string;
    nixVersion?: string;
  };
  convex: {
    status: ConvexResultStatus;
    convexDir: string;
    envFile?: string;
    deployment?: string;
    convexUrl?: string;
    convexSiteUrl?: string;
    siteUrl?: string;
  };
  ui: {
    status: UiResultStatus;
    mode: UiMode;
    url?: string;
    port?: number;
  };
};

type ConvexBootstrapResult = {
  envFilePath: string;
  deployment: string;
  convexUrl: string;
  convexSiteUrl: string;
  siteUrl: string;
};

function normalizeInstallNixMode(
  modeRaw: unknown,
  skipNixRaw: unknown,
): InstallNixMode {
  if (Boolean(skipNixRaw)) return "never";
  const mode = String(modeRaw || "auto").trim().toLowerCase();
  if (mode === "auto" || mode === "always" || mode === "never") return mode;
  throw new Error("--install-nix must be one of: auto, always, never");
}

function normalizeUiMode(modeRaw: unknown, skipUiRaw: unknown): UiMode {
  if (Boolean(skipUiRaw)) return "none";
  const mode = String(modeRaw || "dev").trim().toLowerCase();
  if (mode === "dev" || mode === "prod" || mode === "none") return mode;
  throw new Error("--ui must be one of: dev, prod, none");
}

function parseUiPort(value: unknown): number {
  const raw = String(value ?? "").trim();
  const parsed = raw ? Number(raw) : 3000;
  if (!Number.isFinite(parsed)) throw new Error("--ui-port must be a number");
  const port = Math.trunc(parsed);
  if (port < 1 || port > 65535) throw new Error("--ui-port must be in range 1-65535");
  return port;
}

function normalizeSiteUrl(siteUrlRaw: unknown, uiPort: number): string {
  const raw = String(siteUrlRaw || "").trim() || "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid --site-url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--site-url must use http or https");
  }
  const defaultProvided = raw === "http://localhost:3000";
  if (defaultProvided && uiPort !== 3000) {
    url = new URL(`http://localhost:${uiPort}`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

function requireSupportedPlatform(): string {
  const platform = os.platform();
  if (platform === "darwin" || platform === "linux") return platform;
  throw new Error(`unsupported platform: ${platform} (supported: darwin, linux)`);
}

function requireNode22OrNewer(): string {
  const raw = process.versions.node;
  const major = Number(raw.split(".")[0] || "0");
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node 22+ required (current: ${raw})`);
  }
  return raw;
}

function requireTtyForPrompt(confirm: boolean): void {
  if (!confirm) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("interactive confirmation requires a TTY (use --no-confirm for non-interactive)");
  }
}

async function confirmOrAbort(params: {
  confirm: boolean;
  message: string;
  initialValue?: boolean;
}): Promise<void> {
  if (!params.confirm) return;
  requireTtyForPrompt(true);
  const confirmed = await p.confirm({
    message: params.message,
    initialValue: params.initialValue ?? true,
  });
  if (p.isCancel(confirmed) || !confirmed) throw new Error("canceled");
}

function printHuman(jsonMode: boolean, message: string): void {
  if (jsonMode) return;
  console.log(message);
}

function deriveConvexSiteUrl(convexUrl: string): string | null {
  const raw = String(convexUrl || "").trim();
  if (!raw) return null;
  if (raw.includes(".convex.cloud")) return raw.replace(".convex.cloud", ".convex.site");
  return null;
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function installNixInstructions(): string {
  return [
    "Install Nix (Determinate):",
    "  curl -fsSL https://install.determinate.systems/nix | sh -s -- install --no-confirm",
    "Then set NIX_BIN if needed (example):",
    "  NIX_BIN=/nix/var/nix/profiles/default/bin/nix",
  ].join("\n");
}

async function nixVersion(nixBin: string): Promise<string> {
  const out = await capture(nixBin, ["--version"], {
    stdin: "ignore",
    maxOutputBytes: 8 * 1024,
  });
  return out.trim();
}

async function ensureNix(params: {
  installMode: InstallNixMode;
  confirm: boolean;
  json: boolean;
  explicitNixBin?: string;
}): Promise<{ status: NixResultStatus; nixBin: string; version: string }> {
  const explicitNixBin = String(params.explicitNixBin || "").trim();
  if (explicitNixBin) {
    const resolved = resolveNixBin({ env: process.env, nixBin: explicitNixBin });
    if (!resolved) {
      throw new Error(`--nix-bin not executable: ${explicitNixBin}`);
    }
    process.env.NIX_BIN = resolved;
  }

  const discovered = resolveNixBin({ env: process.env, nixBin: explicitNixBin || undefined });
  if (discovered && params.installMode !== "always") {
    process.env.NIX_BIN = discovered;
    return {
      status: "already_installed",
      nixBin: discovered,
      version: await nixVersion(discovered),
    };
  }

  if (params.installMode === "never") {
    throw new Error(`nix not found (install Nix first)\n${installNixInstructions()}`);
  }

  await confirmOrAbort({
    confirm: params.confirm,
    message: "Nix is missing. Install Determinate Nix now? (requires admin privileges)",
    initialValue: true,
  });

  printHuman(params.json, "step: installing nix (determinate)");
  await run(
    "bash",
    [
      "-lc",
      "curl -fsSL https://install.determinate.systems/nix | sh -s -- install --no-confirm",
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  await run(
    "bash",
    [
      "-lc",
      ". /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh && nix --version",
    ],
    {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const resolved = resolveNixBin({ env: process.env, nixBin: explicitNixBin || undefined });
  if (!resolved) {
    throw new Error(`nix install completed but nix is still not discoverable\n${installNixInstructions()}`);
  }
  process.env.NIX_BIN = resolved;
  return {
    status: "installed",
    nixBin: resolved,
    version: await nixVersion(resolved),
  };
}

async function ensurePnpmInstall(params: {
  repoRoot: string;
  json: boolean;
}): Promise<void> {
  printHuman(params.json, "step: enabling corepack");
  await run("corepack", ["enable"], {
    cwd: params.repoRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  printHuman(params.json, "step: installing workspace dependencies");
  await run("pnpm", ["install", "--frozen-lockfile"], {
    cwd: params.repoRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function ensureConvexLogin(params: {
  convexDir: string;
  confirm: boolean;
}): Promise<void> {
  try {
    await capture("npx", ["convex", "whoami"], {
      cwd: params.convexDir,
      stdin: "ignore",
      maxOutputBytes: 16 * 1024,
    });
    return;
  } catch {
    if (!params.confirm) {
      throw new Error("convex auth required; run `cd apps/web && npx convex login` first");
    }
    await run("npx", ["convex", "login"], {
      cwd: params.convexDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  }
}

async function bootstrapConvex(params: {
  repoRoot: string;
  convexDirArg: string;
  siteUrl: string;
  confirm: boolean;
  json: boolean;
}): Promise<ConvexBootstrapResult> {
  const convexDir = path.isAbsolute(params.convexDirArg)
    ? params.convexDirArg
    : path.resolve(params.repoRoot, params.convexDirArg);
  const envFilePath = path.join(convexDir, ".env.local");

  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    stat = await fs.stat(convexDir);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) throw new Error(`convex dir not found: ${convexDir}`);

  printHuman(params.json, "step: checking convex auth");
  await ensureConvexLogin({ convexDir, confirm: params.confirm });

  printHuman(params.json, "step: bootstrapping convex deployment");
  await run("npx", ["convex", "dev", "--once"], {
    cwd: convexDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  let currentText = "";
  try {
    currentText = await fs.readFile(envFilePath, "utf8");
  } catch {
    currentText = "";
  }
  const parsed = parseDotenv(currentText);
  const deployment = String(parsed["CONVEX_DEPLOYMENT"] || "").trim();
  const convexUrl = String(parsed["VITE_CONVEX_URL"] || "").trim();
  const existingSiteUrl = String(parsed["VITE_CONVEX_SITE_URL"] || "").trim();
  const derivedSiteUrl = deriveConvexSiteUrl(convexUrl);
  const convexSiteUrl = existingSiteUrl || derivedSiteUrl || "";
  const betterAuthSecret = String(parsed["BETTER_AUTH_SECRET"] || "").trim() || randomSecret();
  if (!deployment) {
    throw new Error(`CONVEX_DEPLOYMENT missing in ${envFilePath}; run \`npx convex dev --once\` in ${convexDir}`);
  }
  if (!convexUrl) {
    throw new Error(`VITE_CONVEX_URL missing in ${envFilePath}; run \`npx convex dev --once\` in ${convexDir}`);
  }
  if (!convexSiteUrl) {
    throw new Error(`cannot derive VITE_CONVEX_SITE_URL from VITE_CONVEX_URL (${convexUrl})`);
  }

  const merged = upsertDotenv(currentText, {
    VITE_SITE_URL: params.siteUrl,
    SITE_URL: params.siteUrl,
    CONVEX_DEPLOYMENT: deployment,
    VITE_CONVEX_URL: convexUrl,
    VITE_CONVEX_SITE_URL: convexSiteUrl,
    BETTER_AUTH_SECRET: betterAuthSecret,
  });
  if (merged !== currentText) {
    await fs.writeFile(envFilePath, merged, "utf8");
  }

  printHuman(params.json, "step: syncing convex env vars");
  await run("npx", ["convex", "env", "set", "SITE_URL", params.siteUrl], {
    cwd: convexDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await run("npx", ["convex", "env", "set", "CONVEX_SITE_URL", convexSiteUrl], {
    cwd: convexDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await run("npx", ["convex", "env", "set", "BETTER_AUTH_SECRET", betterAuthSecret], {
    cwd: convexDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return {
    envFilePath,
    deployment,
    convexUrl,
    convexSiteUrl,
    siteUrl: params.siteUrl,
  };
}

async function startUi(params: {
  repoRoot: string;
  convexDirArg: string;
  mode: UiMode;
  uiPort: number;
  siteUrl: string;
  json: boolean;
}): Promise<void> {
  if (params.mode === "none") return;
  const convexDir = path.isAbsolute(params.convexDirArg)
    ? params.convexDirArg
    : path.resolve(params.repoRoot, params.convexDirArg);
  const env = {
    ...process.env,
    SITE_URL: params.siteUrl,
    VITE_SITE_URL: params.siteUrl,
    PORT: String(params.uiPort),
  };

  if (params.mode === "prod") {
    printHuman(params.json, "step: building web app");
    await run("pnpm", ["-C", convexDir, "build"], {
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    printHuman(params.json, "step: starting web app (prod)");
    await run("pnpm", ["-C", convexDir, "start"], {
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return;
  }

  const devArgs =
    params.uiPort === 3000
      ? ["-C", convexDir, "dev"]
      : ["-C", convexDir, "dev:web", "--", "--port", String(params.uiPort)];
  printHuman(params.json, `step: starting web app (${params.mode})`);
  await run("pnpm", devArgs, {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

export const quickstart = defineCommand({
  meta: {
    name: "quickstart",
    description: "Set up Nix + Convex + dashboard dev server on a fresh machine.",
  },
  args: {
    confirm: { type: "boolean", description: "Confirm before installing or writing files.", default: true },
    installNix: { type: "string", description: "Nix install policy: auto|always|never.", default: "auto" },
    nixBin: { type: "string", description: "Override nix binary path and persist to .clawlets/env." },
    skipNix: { type: "boolean", description: "Alias for --install-nix=never.", default: false },
    setupConvex: { type: "boolean", description: "Run Convex bootstrap.", default: true },
    skipConvex: { type: "boolean", description: "Skip Convex bootstrap.", default: false },
    convexDir: { type: "string", description: "Web app dir containing Convex config.", default: "apps/web" },
    siteUrl: { type: "string", description: "Site URL for local auth/callback config.", default: "http://localhost:3000" },
    ui: { type: "string", description: "UI mode: dev|prod|none.", default: "dev" },
    skipUi: { type: "boolean", description: "Alias for --ui=none.", default: false },
    uiPort: { type: "string", description: "UI port.", default: "3000" },
    json: { type: "boolean", description: "Emit machine-readable summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const jsonMode = Boolean((args as any).json);
    const confirm = Boolean((args as any).confirm);
    const installNixMode = normalizeInstallNixMode((args as any).installNix, (args as any).skipNix);
    const uiMode = normalizeUiMode((args as any).ui, (args as any).skipUi);
    const uiPort = parseUiPort((args as any).uiPort);
    const siteUrl = normalizeSiteUrl((args as any).siteUrl, uiPort);
    const convexDirArg = String((args as any).convexDir || "apps/web").trim() || "apps/web";
    const setupConvex = !Boolean((args as any).skipConvex) && Boolean((args as any).setupConvex);
    const explicitNixBin = String((args as any).nixBin || "").trim();

    const platform = requireSupportedPlatform();
    const nodeVersion = requireNode22OrNewer();
    requireTtyForPrompt(confirm);

    await confirmOrAbort({
      confirm,
      message: `Run quickstart in ${repoRoot}? This may install dependencies and write local env files.`,
      initialValue: true,
    });

    printHuman(jsonMode, `step: preflight ok (platform=${platform}, node=${nodeVersion})`);
    const nix = await ensureNix({
      installMode: installNixMode,
      confirm,
      json: jsonMode,
      explicitNixBin: explicitNixBin || undefined,
    });
    printHuman(jsonMode, `ok: nix ${nix.version} (${nix.nixBin})`);

    await updateDeployCredsEnvFile({
      repoRoot,
      updates: { NIX_BIN: nix.nixBin },
    });
    printHuman(jsonMode, "ok: persisted NIX_BIN to .clawlets/env");

    await ensurePnpmInstall({
      repoRoot,
      json: jsonMode,
    });
    printHuman(jsonMode, "ok: workspace dependencies installed");

    let convex: ConvexBootstrapResult | null = null;
    if (setupConvex) {
      convex = await bootstrapConvex({
        repoRoot,
        convexDirArg,
        siteUrl,
        confirm,
        json: jsonMode,
      });
      printHuman(
        jsonMode,
        `ok: convex ready (${convex.deployment}) and env written (${path.relative(repoRoot, convex.envFilePath) || convex.envFilePath})`,
      );
    } else {
      printHuman(jsonMode, "ok: skipped Convex bootstrap");
    }

    const summary: QuickstartSummary = {
      ok: true,
      repoRoot,
      platform,
      nodeVersion,
      nix: {
        status: nix.status,
        nixBin: nix.nixBin,
        nixVersion: nix.version,
      },
      convex: convex
        ? {
            status: "configured",
            convexDir: path.isAbsolute(convexDirArg) ? convexDirArg : path.join(repoRoot, convexDirArg),
            envFile: convex.envFilePath,
            deployment: convex.deployment,
            convexUrl: convex.convexUrl,
            convexSiteUrl: convex.convexSiteUrl,
            siteUrl: convex.siteUrl,
          }
        : {
            status: "skipped",
            convexDir: path.isAbsolute(convexDirArg) ? convexDirArg : path.join(repoRoot, convexDirArg),
            siteUrl,
          },
      ui: uiMode === "none"
        ? {
            status: "skipped",
            mode: uiMode,
            url: siteUrl,
            port: uiPort,
          }
        : {
            status: "started",
            mode: uiMode,
            url: siteUrl,
            port: uiPort,
          },
    };

    if (jsonMode) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`ok: quickstart prepared ${siteUrl}`);
      console.log("next: open UI -> Setup -> Runner -> create token -> start runner");
    }

    if (uiMode !== "none") {
      await startUi({
        repoRoot,
        convexDirArg,
        mode: uiMode,
        uiPort,
        siteUrl,
        json: jsonMode,
      });
    }
  },
});
