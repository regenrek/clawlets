import fs from "node:fs/promises";
import path from "node:path";

export function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function backupFile(filePath: string): Promise<string | null> {
  if (!(await pathExists(filePath))) return null;
  const backupPath = `${filePath}.bak.${isoTimestamp()}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

export async function writeFileAtomic(
  filePath: string,
  contents: string,
  opts: { mode?: number } = {},
): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);
  await fs.writeFile(tmp, contents, "utf8");
  if (typeof opts.mode === "number") {
    try {
      await fs.chmod(tmp, opts.mode);
    } catch {
      // best-effort on platforms without POSIX perms
    }
  }
  await fs.rename(tmp, filePath);
}

