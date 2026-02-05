import { normalizeSshPublicKey } from "../security/ssh.js";

export function escapeNixString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function upsertAdminAuthorizedKey(params: {
  hostNix: string;
  sshPubkey: string;
}): string | null {
  const normalized = normalizeSshPublicKey(params.sshPubkey);
  if (!normalized) return null;
  if (params.hostNix.includes(normalized)) return params.hostNix;

  const rx =
    /(^\s*openssh\.authorizedKeys\.keys\s*=\s*\[\s*\n)([\s\S]*?)(^\s*\];)/m;
  const m = params.hostNix.match(rx);
  if (!m) return null;

  const indent = m[1]?.match(/^\s*/)?.[0] ?? "";
  const itemIndent = `${indent}  `;
  const keyLine = `${itemIndent}"${escapeNixString(params.sshPubkey.trim())}"\n`;

  const body = m[2] ?? "";
  const bodyTrimEnd = body.replace(/\s*$/, "");
  const bodyNext = bodyTrimEnd.length > 0 ? `${bodyTrimEnd}\n${keyLine}` : keyLine;

  return params.hostNix.replace(rx, `${m[1]}${bodyNext}${m[3]}`);
}
