import { spawn } from "node:child_process";

async function capture(cmd: string, args: string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (buf) => chunks.push(Buffer.from(buf)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8").trim());
      else reject(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}

export async function tryGetOriginFlake(repoRoot: string): Promise<string | null> {
  try {
    const origin = await capture("git", ["remote", "get-url", "origin"], repoRoot);

    const ssh = origin.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (ssh) return `github:${ssh[1]}/${ssh[2]}`;

    const https = origin.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (https) return `github:${https[1]}/${https[2]}`;

    return null;
  } catch {
    return null;
  }
}

export async function resolveGitRev(repoRoot: string, rev: string): Promise<string | null> {
  const trimmed = rev.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed;
  try {
    return await capture("git", ["rev-parse", "--verify", `${trimmed}^{commit}`], repoRoot);
  } catch {
    return null;
  }
}
