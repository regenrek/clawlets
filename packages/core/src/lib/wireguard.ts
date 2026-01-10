import { nixShellCapture, type NixToolOpts } from "./nix-tools.js";

export async function wgGenKey(opts: NixToolOpts): Promise<string> {
  if (opts.dryRun) return "<wg_private_key>";
  const key = await nixShellCapture("wireguard-tools", "wg", ["genkey"], opts);
  const trimmed = key.trim();
  if (!/^[A-Za-z0-9+/]{42,}=?=?$/.test(trimmed)) {
    throw new Error("wg genkey returned unexpected output");
  }
  return trimmed;
}
