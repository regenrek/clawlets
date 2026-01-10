import { capture, run, type RunOpts } from "./run.js";

export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildSshArgs(targetHost: string, opts: { tty?: boolean } = {}): string[] {
  return [...(opts.tty ? ["-t"] : []), targetHost];
}

export async function sshRun(
  targetHost: string,
  remoteCmd: string,
  opts: RunOpts & { tty?: boolean } = {},
): Promise<void> {
  const sshArgs = [...buildSshArgs(targetHost, { tty: opts.tty }), remoteCmd];
  await run("ssh", sshArgs, opts);
}

export async function sshCapture(
  targetHost: string,
  remoteCmd: string,
  opts: RunOpts & { tty?: boolean } = {},
): Promise<string> {
  const sshArgs = [...buildSshArgs(targetHost, { tty: opts.tty }), remoteCmd];
  return await capture("ssh", sshArgs, opts);
}

