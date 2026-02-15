import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";
import { expandPath } from "../storage/path-expand.js";

const RUNTIME_OUTSIDE_REPO_ERROR = "runtime contains secrets/state; must be outside repoRoot";

function isPathInside(parentAbs: string, childAbs: string): boolean {
  const parent = path.resolve(parentAbs);
  const child = path.resolve(childAbs);
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toRealpathWhenExists(absPath: string): string {
  try {
    return fs.realpathSync(absPath);
  } catch {
    return absPath;
  }
}

function ensureHomePermissions(homeDir: string): void {
  try {
    fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(homeDir, 0o700);
  } catch {
    // best-effort on platforms/filesystems without POSIX perms
  }
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
  const homeDir = path.resolve(expanded);
  ensureHomePermissions(homeDir);
  return homeDir;
}

export function resolveWorkspaceRuntimeDir(repoRoot: string): string {
  const repoRootAbs = path.resolve(repoRoot);
  const repoRootReal = toRealpathWhenExists(repoRootAbs);
  const repoName = safeFileSegment(path.basename(repoRootReal), "repo");
  const repoHash = sha256Hex(repoRootReal).slice(0, 16);
  const workspaceId = `${repoName}-${repoHash}`;
  const runtimeDirAbs = path.resolve(resolveClawletsHomeDir(), "workspaces", workspaceId);
  assertRuntimeDirOutsideRepoRoot(repoRootAbs, runtimeDirAbs);
  assertRuntimeDirOutsideRepoRootReal(repoRootReal, toRealpathWhenExists(runtimeDirAbs));
  return runtimeDirAbs;
}

export function toExistingRealpathOrSelf(absPath: string): string {
  return toRealpathWhenExists(path.resolve(absPath));
}
