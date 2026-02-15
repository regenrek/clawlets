import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";
import { expandPath } from "../storage/path-expand.js";

const RUNTIME_OUTSIDE_REPO_ERROR = "runtime contains secrets/state; must be outside repoRoot";
const workspaceRuntimeDirCache = new Map<string, string>();

function isPathInside(parentAbs: string, childAbs: string): boolean {
  const parent = path.resolve(parentAbs);
  const child = path.resolve(childAbs);
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toRealpathWithExistingParent(absPath: string): string {
  const resolved = path.resolve(absPath);
  const suffix: string[] = [];
  let cursor = resolved;
  while (true) {
    try {
      const realParent = fs.realpathSync(cursor);
      let joined = realParent;
      for (let index = suffix.length - 1; index >= 0; index -= 1) {
        joined = path.join(joined, suffix[index]!);
      }
      return path.resolve(joined);
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return resolved;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isPosixPlatform(): boolean {
  return process.platform !== "win32";
}

export function ensurePrivateRuntimeDir(dirPath: string): string {
  const absDir = path.resolve(dirPath);
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(absDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  if (stat) {
    if (stat.isSymbolicLink()) {
      throw new Error(`runtime directory must not be a symlink: ${absDir}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`runtime path is not a directory: ${absDir}`);
    }
  } else {
    fs.mkdirSync(absDir, { recursive: true, mode: 0o700 });
    const created = fs.lstatSync(absDir);
    if (created.isSymbolicLink()) {
      throw new Error(`runtime directory must not be a symlink: ${absDir}`);
    }
    if (!created.isDirectory()) {
      throw new Error(`runtime path is not a directory: ${absDir}`);
    }
  }

  if (!isPosixPlatform()) return absDir;

  fs.chmodSync(absDir, 0o700);
  const mode = fs.statSync(absDir).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`insecure runtime directory permissions (expected 700): ${absDir} (mode ${mode.toString(8)})`);
  }
  return absDir;
}

export function safeFileSegment(raw: unknown, fallback: string, maxLen = 80): string {
  const text = coerceTrimmedString(raw);
  const normalized = text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  const clipped = normalized.slice(0, Math.max(1, maxLen));
  return clipped || fallback;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function assertRuntimeDirOutsideRepoRoot(repoRootAbs: string, runtimeDirAbs: string): void {
  if (!isPathInside(repoRootAbs, runtimeDirAbs)) return;
  throw new Error(
    `${RUNTIME_OUTSIDE_REPO_ERROR} (repoRoot=${path.resolve(repoRootAbs)}, runtimeDir=${path.resolve(runtimeDirAbs)})`,
  );
}

export function assertRuntimeDirOutsideRepoRootReal(repoRootReal: string, runtimeDirReal: string): void {
  if (!isPathInside(repoRootReal, runtimeDirReal)) return;
  throw new Error(
    `${RUNTIME_OUTSIDE_REPO_ERROR} after realpath normalization (repoRoot=${repoRootReal}, runtimeDir=${runtimeDirReal})`,
  );
}

export function resolveClawletsHomeDir(): string {
  const configured = coerceTrimmedString(process.env.CLAWLETS_HOME);
  const expanded = configured ? expandPath(configured) : path.join(os.homedir(), ".clawlets");
  return path.resolve(expanded);
}

export function resolveWorkspaceRuntimeDir(repoRoot: string): string {
  const repoRootAbs = path.resolve(repoRoot);
  const repoRootReal = toRealpathWithExistingParent(repoRootAbs);
  const clawletsHome = resolveClawletsHomeDir();
  const cacheKey = `${repoRootReal}\u0000${clawletsHome}`;
  const cached = workspaceRuntimeDirCache.get(cacheKey);
  if (cached) return cached;

  const repoName = safeFileSegment(path.basename(repoRootReal), "repo");
  const repoHash = sha256Hex(repoRootReal).slice(0, 16);
  const workspaceId = `${repoName}-${repoHash}`;
  const runtimeDirAbs = path.resolve(clawletsHome, "workspaces", workspaceId);
  assertRuntimeDirOutsideRepoRoot(repoRootAbs, runtimeDirAbs);
  assertRuntimeDirOutsideRepoRootReal(repoRootReal, toRealpathWithExistingParent(runtimeDirAbs));
  workspaceRuntimeDirCache.set(cacheKey, runtimeDirAbs);
  return runtimeDirAbs;
}

export function toExistingRealpathOrSelf(absPath: string): string {
  return toRealpathWithExistingParent(path.resolve(absPath));
}
