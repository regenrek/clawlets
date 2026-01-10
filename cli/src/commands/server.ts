import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { shellQuote, sshCapture, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { type Stack, type StackHost, loadStack, loadStackEnv, resolveStackBaseFlake } from "@clawdbot/clawdlets-core/stack";

function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim());
}

function requireTargetHost(targetHost: string, hostName: string): string {
  const v = targetHost.trim();
  if (v) return v;
  throw new Error(
    [
      `missing target host for ${hostName}`,
      "set it in .clawdlets/stack.json (hosts.<host>.targetHost) or pass --target-host",
      "recommended: use an SSH config alias (e.g. botsmj)",
    ].join("; "),
  );
}

function requireHost(stack: Stack, host: string): StackHost {
  const h = stack.hosts[host];
  if (!h) throw new Error(`unknown host: ${host}`);
  return h;
}

function normalizeSince(value: string): string {
  const v = value.trim();
  const m = v.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return v;
  const n = Number(m[1]);
  const unit = String(m[2]).toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return v;
  if (unit === "s") return `${n} sec ago`;
  if (unit === "m") return `${n} min ago`;
  if (unit === "h") return `${n} hour ago`;
  if (unit === "d") return `${n} day ago`;
  return v;
}

function resolveHostFromFlake(flakeBase: string): string | null {
  const hashIndex = flakeBase.indexOf("#");
  if (hashIndex === -1) return null;
  const host = flakeBase.slice(hashIndex + 1).trim();
  return host.length > 0 ? host : null;
}

const serverStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show systemd status for Clawdbot services.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const { stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = requireHost(stack, hostName);
    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const cmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "list-units",
      "--all",
      "--plain",
      "--legend=false",
      "--no-pager",
      "clawdbot-*.service",
    ].join(" ");
    const out = await sshCapture(targetHost, cmd);
    console.log(out);
  },
});

const serverLogs = defineCommand({
  meta: {
    name: "logs",
    description: "Stream or print logs via journalctl.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    unit: {
      type: "string",
      description: "systemd unit (default: clawdbot-*.service).",
      default: "clawdbot-*.service",
    },
    since: { type: "string", description: "Time window (supports 5m/1h/2d or journalctl syntax)." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const { stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = requireHost(stack, hostName);
    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const unit = String(args.unit || "clawdbot-*.service").trim() || "clawdbot-*.service";
    const since = args.since ? normalizeSince(String(args.since)) : "";

    const cmdArgs = [
      ...(sudo ? ["sudo"] : []),
      "journalctl",
      "--no-pager",
      ...(args.follow ? ["-f"] : []),
      ...(since ? ["--since", shellQuote(since)] : []),
      "-u",
      shellQuote(unit),
    ];
    const remoteCmd = cmdArgs.join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverRebuild = defineCommand({
  meta: {
    name: "rebuild",
    description: "Run nixos-rebuild switch on the host using a pinned git rev/ref.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    flake: { type: "string", description: "Flake base override (default: stack.base.flake)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = requireHost(stack, hostName);
    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const env = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile }).env;
    const baseResolved = await resolveStackBaseFlake({ repoRoot: layout.repoRoot, stack });
    const flakeBase = String(args.flake || baseResolved.flake || "").trim();
    if (!flakeBase) throw new Error("missing base flake (set stack.base.flake, set git origin, or pass --flake)");

    const requestedHost = String(host.flakeHost || hostName).trim() || hostName;
    const hostFromFlake = resolveHostFromFlake(flakeBase);
    if (hostFromFlake && hostFromFlake !== requestedHost) {
      throw new Error(`flake host mismatch: ${hostFromFlake} vs ${requestedHost}`);
    }
    const flakeWithHost = flakeBase.includes("#") ? flakeBase : `${flakeBase}#${requestedHost}`;

    const rev = String(args.rev || "").trim();
    const ref = String(args.ref || "").trim();
    if (rev && ref) throw new Error("use either --rev or --ref (not both)");

    const hashIndex = flakeWithHost.indexOf("#");
    const flakeBasePath = hashIndex === -1 ? flakeWithHost : flakeWithHost.slice(0, hashIndex);
    const flakeFragment = hashIndex === -1 ? "" : flakeWithHost.slice(hashIndex);
    if ((rev || ref) && /(^|[?&])(rev|ref)=/.test(flakeBasePath)) {
      throw new Error("flake already includes ?rev/?ref; drop --rev/--ref");
    }

    let flake = flakeWithHost;
    if (rev) {
      const resolved = await resolveGitRev(layout.repoRoot, rev);
      if (!resolved) throw new Error(`unable to resolve git rev: ${rev}`);
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flake = `${flakeBasePath}${sep}rev=${resolved}${flakeFragment}`;
    } else if (ref) {
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flake = `${flakeBasePath}${sep}ref=${ref}${flakeFragment}`;
    }

    const sudo = needsSudo(targetHost);
    const remoteArgs: string[] = [];
    if (sudo) remoteArgs.push("sudo");
    remoteArgs.push("env");
    if (env.GITHUB_TOKEN) {
      remoteArgs.push(`NIX_CONFIG=access-tokens = github.com=${env.GITHUB_TOKEN}`);
    }
    remoteArgs.push("nixos-rebuild", "switch", "--flake", flake);

    const remoteCmd = remoteArgs.map(shellQuote).join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverRestart = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a systemd unit (default: clawdbot-*.service).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    unit: { type: "string", description: "systemd unit (default: clawdbot-*.service).", default: "clawdbot-*.service" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const { stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = requireHost(stack, hostName);
    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const unit = String(args.unit || "clawdbot-*.service").trim() || "clawdbot-*.service";
    const sudo = needsSudo(targetHost);
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "restart",
      shellQuote(unit),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

export const server = defineCommand({
  meta: {
    name: "server",
    description: "Server operations via SSH (rebuild/logs/status).",
  },
  subCommands: {
    status: serverStatus,
    logs: serverLogs,
    restart: serverRestart,
    rebuild: serverRebuild,
  },
});
