export function parseBotsFromFleetNix(text: string): string[] {
  const m = text.match(/\bbots\s*=\s*\[([\s\S]*?)\];/);
  const body = m?.[1];
  if (!body) return [];
  const bots = Array.from(body.matchAll(/"([^"]+)"/g)).map((x) => x[1]!.trim());
  return Array.from(new Set(bots.filter(Boolean)));
}
