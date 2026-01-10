export function normalizeSshPublicKey(text: string): string | null {
  const line = text.trim();
  const parts = line.split(/\s+/);
  if (parts.length < 2) return null;
  return `${parts[0]} ${parts[1]}`;
}

export function looksLikeSshKeyContents(value: string): boolean {
  return /^ssh-[a-z0-9-]+\s+/.test(value.trim());
}

