import net from "node:net";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatPathLabel(segments: Array<string | number>): string {
  let out = "";
  for (const seg of segments) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
      continue;
    }
    out = out ? `${out}.${seg}` : seg;
  }
  return out || "(root)";
}

export function stripPathPrefix(message: string): string {
  const idx = message.indexOf(":");
  if (idx === -1) return message.trim();
  return message.slice(idx + 1).trim() || message.trim();
}

export function parseCidr(value: string): { ip: string; prefix: number; family: 4 | 6 } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [ip, prefixRaw] = trimmed.split("/");
  if (!ip || !prefixRaw) return null;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix)) return null;
  const family = net.isIP(ip);
  if (family === 4 && prefix >= 0 && prefix <= 32) return { ip, prefix, family: 4 };
  if (family === 6 && prefix >= 0 && prefix <= 128) return { ip, prefix, family: 6 };
  return null;
}

export function isWorldOpenCidr(parsed: { ip: string; prefix: number; family: 4 | 6 }): boolean {
  if (parsed.family === 4) return parsed.ip === "0.0.0.0" && parsed.prefix === 0;
  return (parsed.ip === "::" || parsed.ip === "0:0:0:0:0:0:0:0") && parsed.prefix === 0;
}
