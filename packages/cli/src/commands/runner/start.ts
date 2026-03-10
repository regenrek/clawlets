import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import type { Logger } from "pino";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";
import { redactKnownSecrets } from "@clawlets/core/lib/runtime/redaction";
import { DEPLOY_CREDS_KEYS } from "@clawlets/core/lib/infra/deploy-creds";
import { resolveNixBin } from "@clawlets/core/lib/nix/nix-bin";
import { getRepoLayout } from "@clawlets/core/repo-layout";
import { buildDefaultArgsForJobKind } from "@clawlets/core/lib/runtime/runner-command-policy";
import {
  RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
  RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
} from "@clawlets/core/lib/runtime/runner-command-policy-args";
import { resolveRunnerJobCommand } from "@clawlets/core/lib/runtime/runner-command-policy-resolve";
import { executeSetupApplyPlan } from "@clawlets/core/lib/setup/engine";
import { parseSetupApplyPlan } from "@clawlets/core/lib/setup/plan";
import { buildSetupApplyEnvelopeAad, buildSetupApplyTelemetryMessage, type SetupApplyStepResult } from "@clawlets/core/lib/setup/shared";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";
import { createRunnerLogger, parseLogLevel, resolveRunnerLogFile, safeFileSegment } from "../../lib/logging/logger.js";
import {
  classifyRunnerHttpError,
  RunnerApiClient,
  type RunnerLeaseJob,
  type RunnerMetadataSyncPayload,
} from "./client.js";
import { buildMetadataSnapshot } from "./metadata.js";
import {
  loadOrCreateRunnerSealedInputKeypair,
  resolveRunnerSealedInputKeyPath,
  unsealRunnerInput,
} from "./sealed-input.js";
import { execCaptureStdout, execCaptureTail } from "./exec.js";

function envName(): string {
  const raw = String(process.env["USER"] || process.env["USERNAME"] || "runner").trim();
  return raw || "runner";
}

function resolveRunnerRuntimeDir(params: {
  runtimeDirArg: unknown;
  projectId: string;
  runnerName: string;
  homeDir?: string;
}): string {
  const explicit = coerceTrimmedString(params.runtimeDirArg);
  if (explicit) return explicit;
  const homeDir = coerceTrimmedString(params.homeDir) || os.homedir();
  return path.join(
    homeDir,
    ".clawlets",
    "runtime",
    "runner",
    safeFileSegment(params.projectId, "project"),
    safeFileSegment(params.runnerName, "runner"),
  );
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeBaseUrl(value: string): string {
  return coerceTrimmedString(value).replace(/\/+$/, "");
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveRunnerMetadataSyncMaxAgeMs(controlPlaneUrl: string): number {
  const overrideRaw = String(process.env["CLAWLETS_RUNNER_METADATA_SYNC_MAX_AGE_MS"] || "").trim();
  if (overrideRaw) {
    const override = Number(overrideRaw);
    if (Number.isFinite(override) && override > 0) return Math.trunc(override);
  }

  try {
    const url = new URL(controlPlaneUrl);
    if (isLocalhostHostname(url.hostname)) return RUNNER_METADATA_SYNC_MAX_AGE_MS_DEV;
  } catch {
    // fall through
  }
  return RUNNER_METADATA_SYNC_MAX_AGE_MS_PROD;
}

function resolveRunnerMaxIdleMs(controlPlaneUrl: string, rawArg: unknown): number {
  const raw = String(rawArg ?? "auto").trim().toLowerCase();
  if (!raw || raw === "auto") {
    try {
      const url = new URL(controlPlaneUrl);
      return isLocalhostHostname(url.hostname) ? RUNNER_MAX_IDLE_MS_DEFAULT_DEV : 0;
    } catch {
      return 0;
    }
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  const value = Math.trunc(parsed);
  if (value <= 0) return 0;
  return Math.min(RUNNER_MAX_IDLE_MS_MAX, value);
}

function resolveControlPlaneUrl(raw: unknown): string {
  const arg = coerceTrimmedString(raw);
  if (arg) return normalizeBaseUrl(arg);
  const env =
    String(process.env["CLAWLETS_CONTROL_PLANE_URL"] || "").trim() ||
    String(process.env["CONVEX_SITE_URL"] || "").trim();
  if (!env) {
    throw new Error("missing control-plane url (--control-plane-url or CLAWLETS_CONTROL_PLANE_URL)");
  }
  return normalizeBaseUrl(env);
}

const NIX_REQUIRED_JOB_KINDS = new Set<string>([
  "doctor",
  "secrets_init",
  "secrets_verify",
  "secrets_verify_bootstrap",
  "secrets_verify_openclaw",
  "secrets_sync",
  "setup_apply",
  "bootstrap",
  "lockdown",
  "deploy",
  "server_update_apply",
  "server_update_status",
  "server_update_logs",
]);

let cachedRunnerNixBin: string | null | undefined;
function resolveRunnerNixBin(): string | null {
  if (cachedRunnerNixBin !== undefined) return cachedRunnerNixBin;
  cachedRunnerNixBin = resolveNixBin({ env: process.env }) ?? null;
  return cachedRunnerNixBin;
}

type RunnerNixCapabilities = {
  hasNix: boolean;
  nixBin?: string;
  nixVersion?: string;
};

async function detectRunnerNixCapabilities(): Promise<RunnerNixCapabilities> {
  const nixBin = resolveRunnerNixBin();
  if (!nixBin) return { hasNix: false };
  try {
    const res = await execCaptureStdout({
      cmd: nixBin,
      args: ["--version"],
      cwd: process.cwd(),
      env: process.env,
      stdin: "ignore",
      timeoutMs: 5_000,
      maxStdoutBytes: 8 * 1024,
      maxStderrBytes: 8 * 1024,
    });
    if (res.exitCode !== 0) return { hasNix: false };
    const nixVersion = res.stdout.trim();
    if (!nixVersion) return { hasNix: false };
    return {
      hasNix: true,
      nixBin,
      nixVersion,
    };
  } catch {
    return { hasNix: false };
  }
}

function runnerCommandEnv(): Record<string, string | undefined> {
  const nixBin = resolveRunnerNixBin();
  return {
    ...process.env,
    CI: "1",
    CLAWLETS_NON_INTERACTIVE: "1",
    ...(nixBin ? { NIX_BIN: nixBin } : {}),
  };
}

function gitJobEnv(): Record<string, string | undefined> {
  return {
    ...runnerCommandEnv(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    GIT_ALLOW_PROTOCOL: "ssh:https",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RUNNER_COMMAND_RESULT_MAX_BYTES = RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES;
const RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES_LIMIT = RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES;
const RUNNER_LOG_CAPTURE_MAX_BYTES = 128 * 1024;
const RUNNER_TEMP_FILE_STALE_MAX_AGE_MS = 24 * 60 * 60_000;
const RUNNER_TEMP_FILE_PREFIXES = ["clawlets-runner-secrets.", "clawlets-runner-input."] as const;
const RUNNER_EMPTY_LEASE_MAX_STREAK = 8;
const RUNNER_EMPTY_LEASE_JITTER_MIN = 0.85;
const RUNNER_EMPTY_LEASE_JITTER_MAX = 1.15;
const RUNNER_METADATA_SYNC_MAX_AGE_MS_PROD = 10 * 60_000;
const RUNNER_METADATA_SYNC_MAX_AGE_MS_DEV = 30 * 60_000;
const RUNNER_METADATA_SYNC_SHUTDOWN_FLUSH_TIMEOUT_MS = 2_000;
const RUNNER_IDLE_LEASE_WAIT_MS_DEFAULT = 15_000;
const RUNNER_IDLE_POLL_MS_DEFAULT = 1_000;
const RUNNER_IDLE_POLL_MAX_MS_DEFAULT = 5_000;
const RUNNER_LEASE_ERROR_BACKOFF_MAX_MS = 60_000;
const RUNNER_MAX_IDLE_MS_DEFAULT_DEV = 90 * 60_000;
const RUNNER_MAX_IDLE_MS_MAX = 7 * 24 * 60 * 60_000;
const TOKEN_KEYRING_MUTATE_ARGS = ["env", "token-keyring-mutate", "--from-json", "__RUNNER_INPUT_JSON__", "--json"] as const;
const TOKEN_KEYRING_MUTATE_ALLOWED_INPUT_KEYS = new Set(["action", "kind", "keyId", "label", "value"]);

// Threat model: this path materializes runtime secrets on disk for execution only.
// Temp files must be short-lived, owner-only readable, and scrubbed on all terminal paths.
const RUNNER_ERROR_AUTH_BEARER_RE = /(Authorization:\s*Bearer\s+)([^\s]+)/gi;
const RUNNER_ERROR_AUTH_BASIC_RE = /(Authorization:\s*Basic\s+)([^\s]+)/gi;
const RUNNER_ERROR_URL_CREDENTIALS_RE = /(https?:\/\/)([^/\s@]+@)/g;
const RUNNER_ERROR_QUERY_SECRET_RE = /([?&](?:access_token|token|auth|api_key|apikey|apiKey)=)([^&\s]+)/gi;
const RUNNER_ERROR_ASSIGNMENT_SECRET_RE =
  /\b((?:access|refresh|id)?_?token|token|api_key|apikey|apiKey|secret|password)\s*[:=]\s*([^\s]+)/gi;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function jitter(value: number, random: () => number): number {
  const rand = Math.min(1, Math.max(0, random()));
  const factor = RUNNER_EMPTY_LEASE_JITTER_MIN + (RUNNER_EMPTY_LEASE_JITTER_MAX - RUNNER_EMPTY_LEASE_JITTER_MIN) * rand;
  return Math.max(1, Math.trunc(value * factor));
}

function computeIdleLeasePollDelayMs(params: {
  pollMs: number;
  pollMaxMs: number;
  emptyLeaseStreak: number;
  random?: () => number;
}): number {
  const pollMs = Math.max(1, Math.trunc(params.pollMs));
  const pollMaxMs = Math.max(pollMs, Math.trunc(params.pollMaxMs));
  const streak = Math.max(0, Math.min(RUNNER_EMPTY_LEASE_MAX_STREAK, Math.trunc(params.emptyLeaseStreak)));
  const baseDelayMs = Math.min(pollMaxMs, pollMs * 2 ** streak);
  return Math.min(pollMaxMs, Math.max(pollMs, jitter(baseDelayMs, params.random ?? Math.random)));
}

function computePostJobIdlePollDelayMs(params: {
  requestedWaitMs: number;
  waitApplied: boolean | undefined;
  pollMs: number;
}): number {
  const wasIdleWakeup = params.requestedWaitMs > 0 && params.waitApplied === true;
  if (!wasIdleWakeup) return 0;
  return Math.max(0, Math.trunc(params.pollMs));
}

function computeLeaseErrorBackoffMs(params: {
  pollMs: number;
  pollMaxMs: number;
  leaseErrorStreak: number;
  kind: ReturnType<typeof classifyRunnerHttpError>;
  random?: () => number;
}): number {
  const pollMs = Math.max(1, Math.trunc(params.pollMs));
  const pollMaxMs = Math.max(pollMs, Math.trunc(params.pollMaxMs));
  const transient = params.kind === "transient" || params.kind === "unknown";
  const cappedMaxMs = transient
    ? Math.max(pollMaxMs, RUNNER_LEASE_ERROR_BACKOFF_MAX_MS)
    : pollMaxMs;
  const streak = Math.max(0, Math.min(12, Math.trunc(params.leaseErrorStreak)));
  const baseDelayMs = Math.min(cappedMaxMs, pollMs * 2 ** streak);
  return Math.min(cappedMaxMs, Math.max(pollMs, jitter(baseDelayMs, params.random ?? Math.random)));
}

function metadataSnapshotFingerprint(payload: RunnerMetadataSyncPayload): string {
  const normalized = {
    deployCredsSummary: payload.deployCredsSummary
        ? {
            schemaVersion: payload.deployCredsSummary.schemaVersion,
            envFileOrigin: payload.deployCredsSummary.envFileOrigin,
            envFileStatus: payload.deployCredsSummary.envFileStatus,
            hasGithubToken: payload.deployCredsSummary.hasGithubToken,
            hasGithubTokenAccess: payload.deployCredsSummary.hasGithubTokenAccess,
            githubTokenAccessMessage: payload.deployCredsSummary.githubTokenAccessMessage,
            hasGitRemoteOrigin: payload.deployCredsSummary.hasGitRemoteOrigin,
            gitRemoteOrigin: payload.deployCredsSummary.gitRemoteOrigin,
            sopsAgeKeyFileSet: payload.deployCredsSummary.sopsAgeKeyFileSet,
            projectTokenKeyrings: payload.deployCredsSummary.projectTokenKeyrings,
            fleetSshAuthorizedKeys: payload.deployCredsSummary.fleetSshAuthorizedKeys,
            fleetSshKnownHosts: payload.deployCredsSummary.fleetSshKnownHosts,
          }
      : null,
    projectConfigs: payload.projectConfigs
      .map((row) => ({
        type: row.type,
        path: row.path,
        sha256: row.sha256,
        error: row.error,
      }))
      .toSorted((a, b) => `${a.type}\0${a.path}`.localeCompare(`${b.type}\0${b.path}`)),
    hosts: payload.hosts
      .map((row) => ({
        hostName: row.hostName,
        patch: {
          provider: row.patch.provider,
          region: row.patch.region,
          lastStatus: row.patch.lastStatus,
          desired: row.patch.desired,
        },
      }))
      .toSorted((a, b) => a.hostName.localeCompare(b.hostName)),
    gateways: payload.gateways
      .map((row) => ({
        hostName: row.hostName,
        gatewayId: row.gatewayId,
        patch: {
          lastStatus: row.patch.lastStatus,
          desired: row.patch.desired,
        },
      }))
      .toSorted((a, b) => `${a.hostName}\0${a.gatewayId}`.localeCompare(`${b.hostName}\0${b.gatewayId}`)),
    secretWiring: payload.secretWiring
      .map((row) => ({
        hostName: row.hostName,
        secretName: row.secretName,
        scope: row.scope,
        status: row.status,
        required: row.required,
      }))
      .toSorted((a, b) => `${a.hostName}\0${a.secretName}\0${a.scope}`.localeCompare(`${b.hostName}\0${b.secretName}\0${b.scope}`)),
  };
  return sha256Hex(JSON.stringify(normalized));
}

function shouldSyncMetadata(params: {
  fingerprint: string;
  now: number;
  lastFingerprint: string | null;
  lastSyncedAt: number | null;
  maxAgeMs: number;
}): boolean {
  if (!params.lastFingerprint) return true;
  if (params.lastFingerprint !== params.fingerprint) return true;
  if (params.lastSyncedAt === null) return true;
  return params.now - params.lastSyncedAt >= Math.max(1, Math.trunc(params.maxAgeMs));
}

function redactRunnerErrorSecrets(input: string): string {
  let output = input;
  output = output.replace(RUNNER_ERROR_AUTH_BEARER_RE, "$1<redacted>");
  output = output.replace(RUNNER_ERROR_AUTH_BASIC_RE, "$1<redacted>");
  output = output.replace(RUNNER_ERROR_URL_CREDENTIALS_RE, "$1<redacted>@");
  output = output.replace(RUNNER_ERROR_QUERY_SECRET_RE, "$1<redacted>");
  output = output.replace(RUNNER_ERROR_ASSIGNMENT_SECRET_RE, "$1=<redacted>");
  return output;
}

function sanitizeRunnerControlPlaneErrorMessage(raw: unknown, fallback: string): string {
  const message = raw instanceof Error ? raw.message : String(raw || "");
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  const redacted = redactRunnerErrorSecrets(trimmed);
  return redacted || fallback;
}

function currentUidOrNull(): number | null {
  if (typeof process.getuid !== "function") return null;
  return process.getuid();
}

async function assertSecureRunnerTempFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("runner temp file invalid");
  const ownerUid = currentUidOrNull();
  if (ownerUid !== null && typeof stat.uid === "number" && stat.uid !== ownerUid) {
    throw new Error("runner temp file ownership mismatch");
  }
  if ((stat.mode & 0o777) !== 0o600) throw new Error("runner temp file mode must be 0600");
}

function extractRunnerTempPid(fileName: string): number | null {
  const match = fileName.match(/\.(\d+)\.[^.]+\.json$/);
  if (!match?.[1]) return null;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ESRCH") return false;
    return true;
  }
}

async function cleanupRunnerTempFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // best effort
  }
}

async function cleanupStaleRunnerTempFiles(now = Date.now()): Promise<void> {
  const tempDir = os.tmpdir();
  const ownerUid = currentUidOrNull();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(tempDir);
  } catch {
    return;
  }

  for (const fileName of entries) {
    if (!fileName.endsWith(".json")) continue;
    if (!RUNNER_TEMP_FILE_PREFIXES.some((prefix) => fileName.startsWith(prefix))) continue;
    const filePath = path.join(tempDir, fileName);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (ownerUid !== null && typeof stat.uid === "number" && stat.uid !== ownerUid) continue;
    const pid = extractRunnerTempPid(fileName);
    if (pid !== null && isProcessAlive(pid)) continue;
    if (pid === null) {
      const ageMs = Math.max(0, now - stat.mtimeMs);
      if (ageMs < RUNNER_TEMP_FILE_STALE_MAX_AGE_MS) continue;
    }
    await cleanupRunnerTempFile(filePath);
  }
}

function parseStructuredJsonObject(raw: string, maxBytes: number): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("runner command output missing JSON payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("runner command output is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("runner command JSON payload must be an object");
  }
  const normalized = JSON.stringify(parsed);
  const normalizedBytes = Buffer.byteLength(normalized, "utf8");
  if (!normalized || normalizedBytes > maxBytes) {
    throw new Error("runner command JSON payload too large");
  }
  return normalized;
}

function placeholderIndex(args: string[], placeholder: "__RUNNER_SECRETS_JSON__" | "__RUNNER_INPUT_JSON__"): number {
  let index = -1;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== placeholder) continue;
    if (index >= 0) throw new Error(`job args cannot include ${placeholder} more than once`);
    index = i;
  }
  return index;
}

async function writeSecretsJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  const adminPasswordHash = String(values["adminPasswordHash"] || "").trim();
  const tailscaleAuthKey = String(values["tailscaleAuthKey"] || "").trim();
  const secrets: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(values)) {
    if (key === "adminPasswordHash") continue;
    if (key === "tailscaleAuthKey") continue;
    const name = key.trim();
    if (!name) continue;
    secrets[name] = value;
  }
  const body = {
    ...(adminPasswordHash ? { adminPasswordHash } : {}),
    ...(tailscaleAuthKey ? { tailscaleAuthKey } : {}),
    secrets,
  };
  const filePath = path.join(os.tmpdir(), `clawlets-runner-secrets.${jobId}.${process.pid}.${randomUUID()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await assertSecureRunnerTempFile(filePath);
  return filePath;
}

async function writeInputJsonTemp(jobId: string, values: unknown): Promise<string> {
  const filePath = path.join(os.tmpdir(), `clawlets-runner-input.${jobId}.${process.pid}.${randomUUID()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await assertSecureRunnerTempFile(filePath);
  return filePath;
}

function defaultArgsForJob(job: RunnerLeaseJob): string[] {
  const args = buildDefaultArgsForJobKind({
    kind: job.kind,
    payloadMeta: job.payloadMeta,
  });
  if (!args || args.length === 0) throw new Error(`job ${job.kind} requires payloadMeta.args`);
  return args;
}

export function __test_defaultArgsForJob(job: RunnerLeaseJob): string[] {
  return defaultArgsForJob(job);
}

function shouldStopOnCompletionError(kind: ReturnType<typeof classifyRunnerHttpError>): boolean {
  return kind === "auth" || kind === "permanent";
}

export function __test_shouldStopOnCompletionError(kind: ReturnType<typeof classifyRunnerHttpError>): boolean {
  return shouldStopOnCompletionError(kind);
}

export async function __test_writeSecretsJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  return await writeSecretsJsonTemp(jobId, values);
}

export async function __test_writeInputJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  return await writeInputJsonTemp(jobId, values);
}

export async function __test_assertSecureRunnerTempFile(filePath: string): Promise<void> {
  await assertSecureRunnerTempFile(filePath);
}

export function __test_sanitizeRunnerControlPlaneErrorMessage(raw: unknown, fallback: string): string {
  return sanitizeRunnerControlPlaneErrorMessage(raw, fallback);
}

export async function __test_cleanupStaleRunnerTempFiles(now?: number): Promise<void> {
  await cleanupStaleRunnerTempFiles(now ?? Date.now());
}

export function __test_parseStructuredJsonObject(raw: string, maxBytes: number): string {
  return parseStructuredJsonObject(raw, maxBytes);
}

export function __test_computeIdleLeasePollDelayMs(params: {
  pollMs: number;
  pollMaxMs: number;
  emptyLeaseStreak: number;
  random?: () => number;
}): number {
  return computeIdleLeasePollDelayMs(params);
}

export function __test_computePostJobIdlePollDelayMs(params: {
  requestedWaitMs: number;
  waitApplied: boolean | undefined;
  pollMs: number;
}): number {
  return computePostJobIdlePollDelayMs(params);
}

export function __test_metadataSnapshotFingerprint(payload: RunnerMetadataSyncPayload): string {
  return metadataSnapshotFingerprint(payload);
}

export function __test_shouldSyncMetadata(params: {
  fingerprint: string;
  now: number;
  lastFingerprint: string | null;
  lastSyncedAt: number | null;
  maxAgeMs: number;
}): boolean {
  return shouldSyncMetadata(params);
}

function parseSealedInputStringMap(rawJson: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("sealed input plaintext is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sealed input plaintext must be an object");
  }
  const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const name = key.trim();
    if (!name) continue;
    if (forbiddenKeys.has(name)) throw new Error(`sealed input key forbidden: ${name}`);
    if (typeof value !== "string") throw new Error(`sealed input field ${name} must be string`);
    out[name] = value;
  }
  return out;
}

function payloadMetaArgs(job: RunnerLeaseJob): string[] {
  return Array.isArray(job.payloadMeta?.args)
    ? job.payloadMeta.args.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
    : [];
}

function isTokenKeyringMutateInputJob(job: RunnerLeaseJob): boolean {
  const args = payloadMetaArgs(job);
  if (args.length !== TOKEN_KEYRING_MUTATE_ARGS.length) return false;
  for (let i = 0; i < TOKEN_KEYRING_MUTATE_ARGS.length; i += 1) {
    if (args[i] !== TOKEN_KEYRING_MUTATE_ARGS[i]) return false;
  }
  return true;
}

function validateSealedInputKeysForJob(params: {
  job: RunnerLeaseJob;
  values: Record<string, string>;
  secretsPlaceholder: boolean;
  inputPlaceholder: boolean;
}): void {
  if (params.secretsPlaceholder && params.inputPlaceholder) {
    throw new Error("job args cannot include both __RUNNER_SECRETS_JSON__ and __RUNNER_INPUT_JSON__");
  }
  if (!params.secretsPlaceholder && !params.inputPlaceholder) return;

  const seen = Object.keys(params.values);
  if (params.inputPlaceholder) {
    const allowed = new Set<string>();
    const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

    const sealedInputKeys = Array.isArray(params.job.payloadMeta?.sealedInputKeys)
      ? params.job.payloadMeta?.sealedInputKeys?.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
      : [];

    if (sealedInputKeys.length > 0) {
      if (!isTokenKeyringMutateInputJob(params.job)) {
        throw new Error("payloadMeta.sealedInputKeys only supported for env token-keyring-mutate jobs");
      }
      for (const key of sealedInputKeys) {
        if (forbiddenKeys.has(key)) throw new Error(`payloadMeta.sealedInputKeys forbids: ${key}`);
        if (!TOKEN_KEYRING_MUTATE_ALLOWED_INPUT_KEYS.has(key)) {
          throw new Error(`payloadMeta.sealedInputKeys invalid entry: ${key}`);
        }
        allowed.add(key);
      }
    } else {
      const updatedKeys = Array.isArray(params.job.payloadMeta?.updatedKeys)
        ? params.job.payloadMeta?.updatedKeys?.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
        : [];
      if (updatedKeys.length === 0) {
        throw new Error("payloadMeta.updatedKeys or payloadMeta.sealedInputKeys required for __RUNNER_INPUT_JSON__ job");
      }
      const deployKeySet = new Set<string>(DEPLOY_CREDS_KEYS);
      for (const key of updatedKeys) {
        if (!deployKeySet.has(key)) throw new Error(`invalid updatedKeys entry: ${key}`);
        allowed.add(key);
      }
    }

    for (const key of seen) {
      if (!allowed.has(key)) throw new Error(`sealed input key not allowlisted: ${key}`);
    }
    return;
  }

  const secretNames = Array.isArray(params.job.payloadMeta?.secretNames)
    ? params.job.payloadMeta?.secretNames?.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
    : [];
  const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
  const allowed = new Set<string>(["adminPasswordHash", "tailscaleAuthKey", ...secretNames]);
  for (const key of seen) {
    if (forbiddenKeys.has(key)) throw new Error(`sealed input secret forbids: ${key}`);
    if (!allowed.has(key)) throw new Error(`sealed input secret not allowlisted: ${key}`);
  }
}

export function __test_parseSealedInputStringMap(rawJson: string): Record<string, string> {
  return parseSealedInputStringMap(rawJson);
}

export function __test_validateSealedInputKeysForJob(params: {
  job: RunnerLeaseJob;
  values: Record<string, string>;
  secretsPlaceholder: boolean;
  inputPlaceholder: boolean;
}): void {
  validateSealedInputKeysForJob(params);
}

type RunnerJobExec = "clawlets" | "git";

const RUNNER_SENSITIVE_ARG_FLAGS = new Set<string>([
  "--token",
  "--access-token",
  "--auth-token",
  "--auth",
  "--authorization",
  "--bearer-token",
  "--password",
  "--secret",
  "--client-secret",
  "--client-token",
  "--api-key",
  "--apikey",
  "--apiKey",
]);

function redactRunnerArgSecrets(input: string): string {
  let output = input;
  output = output.replace(RUNNER_ERROR_AUTH_BEARER_RE, "$1<redacted>");
  output = output.replace(RUNNER_ERROR_AUTH_BASIC_RE, "$1<redacted>");
  output = output.replace(RUNNER_ERROR_URL_CREDENTIALS_RE, "$1<redacted>@");
  output = output.replace(RUNNER_ERROR_QUERY_SECRET_RE, "$1<redacted>");
  output = output.replace(RUNNER_ERROR_ASSIGNMENT_SECRET_RE, "$1=<redacted>");
  return output;
}

function sanitizeArgvForLogs(params: { exec: RunnerJobExec; args: string[]; tempSecretsPath?: string }): string[] {
  const out: string[] = [params.exec];
  const tempSecretsPath = String(params.tempSecretsPath || "").trim();
  for (let i = 0; i < params.args.length; i += 1) {
    const rawArg = params.args[i] ?? "";
    if (tempSecretsPath && rawArg === tempSecretsPath) {
      out.push("<runner_temp_secret_file>");
      continue;
    }
    const assignmentIdx = rawArg.indexOf("=");
    const flagToken = (assignmentIdx > 0 ? rawArg.slice(0, assignmentIdx) : rawArg).trim();
    const normalizedFlag = flagToken.toLowerCase();
    if (RUNNER_SENSITIVE_ARG_FLAGS.has(normalizedFlag)) {
      if (assignmentIdx > 0) {
        out.push(`${flagToken}=<redacted>`);
        continue;
      }
      out.push(rawArg);
      const next = params.args[i + 1];
      if (typeof next === "string" && next.trim() && !next.startsWith("-")) {
        out.push("<redacted>");
        i += 1;
      }
      continue;
    }

    let candidate = String(rawArg || "");
    if (tempSecretsPath && candidate.includes(tempSecretsPath)) {
      candidate = candidate.split(tempSecretsPath).join("<runner_temp_secret_file>");
    }
    candidate = redactRunnerArgSecrets(candidate);
    const redacted = redactKnownSecrets(candidate).text;
    out.push(redacted.length > 512 ? `${redacted.slice(0, 512)}...(truncated)` : redacted);
  }
  return out;
}

export function __test_sanitizeArgvForLogs(params: { exec: RunnerJobExec; args: string[]; tempSecretsPath?: string }): string[] {
  return sanitizeArgvForLogs(params);
}

class RunnerJobExecutionError extends Error {
  readonly exec: RunnerJobExec;
  readonly argv: string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;

  constructor(params: {
    exec: RunnerJobExec;
    argv: string[];
    cwd: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
    stdoutTail?: string;
    stderrTail?: string;
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
  }) {
    super(`${params.exec} exited with code ${params.exitCode ?? "null"}`);
    this.name = "RunnerJobExecutionError";
    this.exec = params.exec;
    this.argv = params.argv;
    this.cwd = params.cwd;
    this.exitCode = params.exitCode;
    this.signal = params.signal;
    this.durationMs = params.durationMs;
    this.stdoutTail = params.stdoutTail;
    this.stderrTail = params.stderrTail;
    this.stdoutTruncated = params.stdoutTruncated;
    this.stderrTruncated = params.stderrTruncated;
  }
}

function pickRunnerErrorDetail(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0];
  if (!firstLine) return null;

  const interestingRe = /timed out|timeout|permission denied|host key|connection refused|no route|could not|missing|invalid|error:/i;
  const candidates = lines.filter((line) => interestingRe.test(line));
  const picked = candidates.find((line) => /^error:/i.test(line)) ?? candidates[0] ?? firstLine;
  const bounded = picked.length > 500 ? `${picked.slice(0, 500)}...(truncated)` : picked;
  return bounded.trim() ? bounded : null;
}

async function executeJob(params: {
  job: RunnerLeaseJob;
  repoRoot: string;
  projectId: string;
  runnerPrivateKeyPem: string;
}): Promise<{ output?: string; redactedOutput?: boolean; commandResultJson?: string; commandResultLargeJson?: string }> {
  const entry = process.argv[1];
  if (!entry) throw new Error("unable to resolve cli entry path");
  const resolved = await resolveRunnerJobCommand({
    kind: params.job.kind,
    payloadMeta: params.job.payloadMeta,
    repoRoot: params.repoRoot,
  });
  if (!resolved.ok) throw new Error(resolved.error);
  if (resolved.exec === "clawlets" && NIX_REQUIRED_JOB_KINDS.has(params.job.kind)) {
    if (!resolveRunnerNixBin()) {
      throw new Error("nix not found (install Nix first)");
    }
  }
  const args = [...resolved.args];
  if (args.length === 0) throw new Error("job args empty");
  const secretsPlaceholderIdx = placeholderIndex(args, "__RUNNER_SECRETS_JSON__");
  const inputPlaceholderIdx = placeholderIndex(args, "__RUNNER_INPUT_JSON__");
  if (secretsPlaceholderIdx >= 0 && inputPlaceholderIdx >= 0) {
    throw new Error("job args cannot include both __RUNNER_SECRETS_JSON__ and __RUNNER_INPUT_JSON__");
  }
  const secretBearingJob = secretsPlaceholderIdx >= 0 || inputPlaceholderIdx >= 0;
  let tempSecretsPath = "";
  try {
    if (secretBearingJob) {
      if (!params.job.sealedInputB64) {
        throw new Error("sealed input missing for placeholder job");
      }
      const targetRunnerId = String(params.job.targetRunnerId || "").trim();
      if (!targetRunnerId) throw new Error("target runner missing for placeholder job");
      const aad = `${params.projectId}:${params.job.jobId}:${params.job.kind}:${targetRunnerId}`;
      const plaintextJson = unsealRunnerInput({
        runnerPrivateKeyPem: params.runnerPrivateKeyPem,
        aad,
        envelopeB64: params.job.sealedInputB64,
        expectedAlg: params.job.sealedInputAlg,
        expectedKeyId: params.job.sealedInputKeyId,
      });
      const secrets = parseSealedInputStringMap(plaintextJson);
      validateSealedInputKeysForJob({
        job: params.job,
        values: secrets,
        secretsPlaceholder: secretsPlaceholderIdx >= 0,
        inputPlaceholder: inputPlaceholderIdx >= 0,
      });
      tempSecretsPath =
        secretsPlaceholderIdx >= 0
          ? await writeSecretsJsonTemp(params.job.jobId, secrets)
          : await writeInputJsonTemp(params.job.jobId, secrets);
      if (secretsPlaceholderIdx >= 0) args[secretsPlaceholderIdx] = tempSecretsPath;
      if (inputPlaceholderIdx >= 0) args[inputPlaceholderIdx] = tempSecretsPath;
    }

    if (resolved.exec === "git") {
      const res = await execCaptureTail({
        cmd: "git",
        args,
        cwd: params.repoRoot,
        env: gitJobEnv(),
        stdin: "ignore",
        maxStdoutBytes: secretBearingJob ? 0 : RUNNER_LOG_CAPTURE_MAX_BYTES,
        maxStderrBytes: secretBearingJob ? 0 : RUNNER_LOG_CAPTURE_MAX_BYTES,
      });
      if (res.exitCode !== 0) {
        throw new RunnerJobExecutionError({
          exec: "git",
          argv: sanitizeArgvForLogs({ exec: "git", args }),
          cwd: params.repoRoot,
          exitCode: res.exitCode,
          signal: res.signal,
          durationMs: res.durationMs,
          stdoutTail: res.stdoutTail ? redactKnownSecrets(res.stdoutTail).text : undefined,
          stderrTail: res.stderrTail ? redactKnownSecrets(res.stderrTail).text : undefined,
          stdoutTruncated: res.stdoutTruncated,
          stderrTruncated: res.stderrTruncated,
        });
      }
      return {};
    }

    if (secretBearingJob && params.job.kind === "custom") {
      const res = await execCaptureTail({
        cmd: process.execPath,
        args: [entry, ...args],
        cwd: params.repoRoot,
        env: runnerCommandEnv(),
        stdin: "ignore",
        maxStdoutBytes: 0,
        maxStderrBytes: 0,
      });
      if (res.exitCode !== 0) {
        throw new RunnerJobExecutionError({
          exec: "clawlets",
          argv: sanitizeArgvForLogs({ exec: "clawlets", args, tempSecretsPath }),
          cwd: params.repoRoot,
          exitCode: res.exitCode,
          signal: res.signal,
          durationMs: res.durationMs,
          stdoutTruncated: res.stdoutTruncated,
          stderrTruncated: res.stderrTruncated,
        });
      }
      return {};
    }

    const structuredSmallResult = resolved.resultMode === "json_small";
    const structuredLargeResult = resolved.resultMode === "json_large";
    if (structuredSmallResult || structuredLargeResult) {
      const captureLimit = structuredLargeResult
        ? Math.max(
            1,
            Math.min(
              RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES_LIMIT,
              Math.trunc(resolved.resultMaxBytes ?? RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES_LIMIT),
            ),
          )
        : RUNNER_COMMAND_RESULT_MAX_BYTES;
      const res = await execCaptureStdout({
        cmd: process.execPath,
        args: [entry, ...args],
        cwd: params.repoRoot,
        env: runnerCommandEnv(),
        stdin: "ignore",
        maxStdoutBytes: captureLimit,
        maxStderrBytes: secretBearingJob ? 0 : RUNNER_LOG_CAPTURE_MAX_BYTES,
      });
      if (res.exitCode !== 0) {
        throw new RunnerJobExecutionError({
          exec: "clawlets",
          argv: sanitizeArgvForLogs({ exec: "clawlets", args, tempSecretsPath }),
          cwd: params.repoRoot,
          exitCode: res.exitCode,
          signal: res.signal,
          durationMs: res.durationMs,
          stderrTail: secretBearingJob ? undefined : res.stderrTail ? redactKnownSecrets(res.stderrTail).text : undefined,
          stdoutTruncated: res.stdoutTruncated,
          stderrTruncated: res.stderrTruncated,
        });
      }
      const output = res.stdout;
      if (structuredSmallResult) {
        const normalized = parseStructuredJsonObject(output, RUNNER_COMMAND_RESULT_MAX_BYTES);
        if (secretBearingJob) return { commandResultJson: normalized };
        return { redactedOutput: true, commandResultJson: normalized };
      }
      const normalized = parseStructuredJsonObject(output, captureLimit);
      if (secretBearingJob) return { commandResultLargeJson: normalized };
      return { redactedOutput: true, commandResultLargeJson: normalized };
    }

    if (params.job.kind === "custom") {
      const res = await execCaptureStdout({
        cmd: process.execPath,
        args: [entry, ...args],
        cwd: params.repoRoot,
        env: runnerCommandEnv(),
        stdin: "ignore",
        maxStdoutBytes: RUNNER_LOG_CAPTURE_MAX_BYTES,
        maxStderrBytes: RUNNER_LOG_CAPTURE_MAX_BYTES,
      });
      if (res.exitCode !== 0) {
        throw new RunnerJobExecutionError({
          exec: "clawlets",
          argv: sanitizeArgvForLogs({ exec: "clawlets", args, tempSecretsPath }),
          cwd: params.repoRoot,
          exitCode: res.exitCode,
          signal: res.signal,
          durationMs: res.durationMs,
          stdoutTail: res.stdout ? redactKnownSecrets(res.stdout).text : undefined,
          stderrTail: res.stderrTail ? redactKnownSecrets(res.stderrTail).text : undefined,
          stdoutTruncated: res.stdoutTruncated,
          stderrTruncated: res.stderrTruncated,
        });
      }
      return { output: res.stdout.trim() || undefined };
    }

    const res = await execCaptureTail({
      cmd: process.execPath,
      args: [entry, ...args],
      cwd: params.repoRoot,
      env: runnerCommandEnv(),
      stdin: "ignore",
      maxStdoutBytes: secretBearingJob ? 0 : RUNNER_LOG_CAPTURE_MAX_BYTES,
      maxStderrBytes: secretBearingJob ? 0 : RUNNER_LOG_CAPTURE_MAX_BYTES,
    });
    if (res.exitCode !== 0) {
      throw new RunnerJobExecutionError({
        exec: "clawlets",
        argv: sanitizeArgvForLogs({ exec: "clawlets", args, tempSecretsPath }),
        cwd: params.repoRoot,
        exitCode: res.exitCode,
        signal: res.signal,
        durationMs: res.durationMs,
        stdoutTail: secretBearingJob ? undefined : res.stdoutTail ? redactKnownSecrets(res.stdoutTail).text : undefined,
        stderrTail: secretBearingJob ? undefined : res.stderrTail ? redactKnownSecrets(res.stderrTail).text : undefined,
        stdoutTruncated: res.stdoutTruncated,
        stderrTruncated: res.stderrTruncated,
      });
    }
    return {};
  } finally {
    if (tempSecretsPath) {
      await cleanupRunnerTempFile(tempSecretsPath);
    }
  }
}

export async function __test_executeJob(params: Parameters<typeof executeJob>[0]) {
  return await executeJob(params);
}

export function __test_resolveRunnerRuntimeDir(params: {
  runtimeDirArg?: unknown;
  projectId: string;
  runnerName: string;
  homeDir?: string;
}): string {
  return resolveRunnerRuntimeDir({
    runtimeDirArg: params.runtimeDirArg,
    projectId: params.projectId,
    runnerName: params.runnerName,
    homeDir: params.homeDir,
  });
}

type RunnerAppendRunEventsArgs = Parameters<RunnerApiClient["appendRunEvents"]>[0];
type RunnerSetupOperationUpdateArgs = Parameters<RunnerApiClient["updateSetupOperation"]>[0];
type RunnerAppendEventsClient = Pick<RunnerApiClient, "appendRunEvents">
  & Partial<Pick<RunnerApiClient, "updateSetupOperation">>;

async function appendRunEventsBestEffort(params: {
  logger: Logger;
  client: RunnerAppendEventsClient;
  projectId: string;
  runId: string;
  events: RunnerAppendRunEventsArgs["events"];
  context: "command_start" | "command_output" | "command_end" | "command_end_error";
}): Promise<void> {
  try {
    await params.client.appendRunEvents({
      projectId: params.projectId,
      runId: params.runId,
      events: params.events,
    });
  } catch (err) {
    const message = sanitizeRunnerControlPlaneErrorMessage(err, "run-events append failed");
    params.logger.warn({ context: params.context, error: message }, "runner run-events append failed");
  }
}

async function updateSetupOperationBestEffort(params: {
  logger: Logger;
  client: RunnerAppendEventsClient;
  projectId: string;
  jobId: string;
  leaseId: string;
  step: RunnerSetupOperationUpdateArgs["step"];
}): Promise<void> {
  if (!params.client.updateSetupOperation) return;
  try {
    await params.client.updateSetupOperation({
      projectId: params.projectId,
      jobId: params.jobId,
      leaseId: params.leaseId,
      step: params.step,
    });
  } catch (err) {
    const message = sanitizeRunnerControlPlaneErrorMessage(err, "setup-operation update failed");
    params.logger.warn({ jobId: params.jobId, error: message }, "runner setup-operation update failed");
  }
}

function setupApplyStepEvent(step: SetupApplyStepResult): RunnerAppendRunEventsArgs["events"][number] {
  return {
    ts: Date.now(),
    level: step.status === "failed" ? "error" : "info",
    message: buildSetupApplyTelemetryMessage(step),
  };
}

async function reportSetupApplyStepBestEffort(params: {
  logger: Logger;
  client: RunnerAppendEventsClient;
  projectId: string;
  jobId: string;
  leaseId: string;
  runId: string;
  step: SetupApplyStepResult;
}): Promise<void> {
  await appendRunEventsBestEffort({
    logger: params.logger,
    client: params.client,
    projectId: params.projectId,
    runId: params.runId,
    context: params.step.status === "failed" ? "command_end_error" : "command_output",
    events: [setupApplyStepEvent(params.step)],
  });
  await updateSetupOperationBestEffort({
    logger: params.logger,
    client: params.client,
    projectId: params.projectId,
    jobId: params.jobId,
    leaseId: params.leaseId,
    step: {
      stepId: params.step.stepId,
      status: params.step.status,
      safeMessage: params.step.safeMessage,
      detailJson: params.step.detail ? JSON.stringify(params.step.detail) : undefined,
      retryable: params.step.retryable,
    },
  });
}

async function executeSetupApplyJobWithProgress(params: {
  logger: Logger;
  client: RunnerAppendEventsClient;
  projectId: string;
  job: RunnerLeaseJob;
  repoRoot: string;
  runtimeDir: string;
  runnerPrivateKeyPem: string;
  executeSetupApplyPlanFn?: typeof executeSetupApplyPlan;
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string; commandResultJson?: string }> {
  const executeSetupApplyPlanFn = params.executeSetupApplyPlanFn ?? executeSetupApplyPlan;
  const targetRunnerId = String(params.job.targetRunnerId || "").trim();
  if (!targetRunnerId) throw new Error("setup_apply target runner missing");
  if (!params.job.sealedInputB64) throw new Error("setup_apply sealed input missing");
  const operationId = String(params.job.payloadMeta?.operationId || "").trim();
  if (!operationId) throw new Error("setup_apply operationId missing");
  const aad = buildSetupApplyEnvelopeAad({
    projectId: params.projectId,
    operationId,
    targetRunnerId,
  });
  try {
    const envelopeJson = unsealRunnerInput({
      runnerPrivateKeyPem: params.runnerPrivateKeyPem,
      aad,
      envelopeB64: params.job.sealedInputB64,
      expectedAlg: params.job.sealedInputAlg,
      expectedKeyId: params.job.sealedInputKeyId,
    });
    const plan = parseSetupApplyPlan(envelopeJson);
    const cliEntry = process.argv[1] || (params.executeSetupApplyPlanFn ? "__test_cli_entry__" : "");
    if (!cliEntry) throw new Error("unable to resolve CLI entry path");
    const result = await executeSetupApplyPlanFn(plan, {
      cliEntry,
      repoRoot: params.repoRoot,
      runtimeDir: params.runtimeDir,
      operationId: operationId || undefined,
      attempt: params.job.attempt,
      onStep: async (step) => {
        await reportSetupApplyStepBestEffort({
          logger: params.logger,
          client: params.client,
          projectId: params.projectId,
          jobId: params.job.jobId,
          leaseId: params.job.leaseId,
          runId: params.job.runId,
          step,
        });
      },
    });
    return {
      terminal: "succeeded",
      commandResultJson: JSON.stringify(result.summary),
    };
  } catch (error) {
    const message = sanitizeErrorMessage(error, "setup apply failed");
    await updateSetupOperationBestEffort({
      logger: params.logger,
      client: params.client,
      projectId: params.projectId,
      jobId: params.job.jobId,
      leaseId: params.job.leaseId,
      step: {
        stepId: "plan_validated",
        status: "failed",
        safeMessage: message,
        detailJson: undefined,
        retryable: true,
      },
    });
    throw new Error(message);
  }
}

async function executeLeasedJobWithRunEvents(params: {
  logger: Logger;
  client: RunnerAppendEventsClient;
  projectId: string;
  job: RunnerLeaseJob;
  repoRoot: string;
  runtimeDir: string;
  runnerPrivateKeyPem: string;
  maxAttempts: number;
  executeJobFn?: typeof executeJob;
  executeSetupApplyPlanFn?: typeof executeSetupApplyPlan;
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string; commandResultJson?: string; commandResultLargeJson?: string }> {
  const executeJobFn = params.executeJobFn ?? executeJob;
  const startedAt = Date.now();
  try {
    if (params.job.attempt > params.maxAttempts) {
      throw new Error(`attempt cap exceeded (${params.job.attempt}/${params.maxAttempts})`);
    }
    params.logger.info({ attempt: params.job.attempt }, "job started");
	    await appendRunEventsBestEffort({
	      logger: params.logger,
	      client: params.client,
	      projectId: params.projectId,
	      runId: params.job.runId,
      context: "command_start",
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: `Runner leased job ${params.job.jobId} kind=${params.job.kind} attempt=${params.job.attempt}`,
          meta: { kind: "phase", phase: "command_start" },
        },
      ],
    });
    if (params.job.kind === "setup_apply") {
      const result = await executeSetupApplyJobWithProgress({
        logger: params.logger,
        client: params.client,
        projectId: params.projectId,
        job: params.job,
        repoRoot: params.repoRoot,
        runtimeDir: params.runtimeDir,
        runnerPrivateKeyPem: params.runnerPrivateKeyPem,
        executeSetupApplyPlanFn: params.executeSetupApplyPlanFn,
      });
      await appendRunEventsBestEffort({
        logger: params.logger,
        client: params.client,
        projectId: params.projectId,
        runId: params.job.runId,
        context: "command_end",
        events: [
          {
            ts: Date.now(),
            level: "info",
            message: `Runner completed job ${params.job.jobId}`,
            meta: { kind: "phase", phase: "command_end" },
          },
        ],
      });
      const durationMs = Math.max(0, Date.now() - startedAt);
      params.logger.info({ terminal: "succeeded", durationMs }, "job completed");
      return result;
    }
    const result = await executeJobFn({
      job: params.job,
      repoRoot: params.repoRoot,
      projectId: params.projectId,
      runnerPrivateKeyPem: params.runnerPrivateKeyPem,
    });
	    if (result.redactedOutput) {
	      await appendRunEventsBestEffort({
	        logger: params.logger,
	        client: params.client,
	        projectId: params.projectId,
	        runId: params.job.runId,
        context: "command_output",
        events: [
          {
            ts: Date.now(),
            level: "info",
            message: "Runner command output redacted (structured JSON result stored ephemerally).",
            redacted: true,
          },
        ],
      });
	    } else if (result.output) {
	      const sanitizedOutput = redactKnownSecrets(result.output);
	      await appendRunEventsBestEffort({
	        logger: params.logger,
	        client: params.client,
	        projectId: params.projectId,
	        runId: params.job.runId,
        context: "command_output",
        events: [
          {
            ts: Date.now(),
            level: "info",
            message: sanitizedOutput.text,
            redacted: sanitizedOutput.redacted ? true : undefined,
          },
        ],
      });
	    }
    await appendRunEventsBestEffort({
      logger: params.logger,
      client: params.client,
      projectId: params.projectId,
      runId: params.job.runId,
      context: "command_end",
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: `Runner completed job ${params.job.jobId}`,
          meta: { kind: "phase", phase: "command_end" },
        },
	      ],
	    });
	    const durationMs = Math.max(0, Date.now() - startedAt);
	    params.logger.info({ terminal: "succeeded", durationMs }, "job completed");
	    return {
	      terminal: "succeeded",
	      commandResultJson: result.commandResultJson,
	      commandResultLargeJson: result.commandResultLargeJson,
	    };
  } catch (err) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const errorMessage = sanitizeErrorMessage(err, "runner job failed");
    let errorDetail: string | null = null;
    if (err instanceof RunnerJobExecutionError) {
      errorDetail = pickRunnerErrorDetail(err.stderrTail || err.stdoutTail || "");
      params.logger.error(
        {
          terminal: "failed",
          durationMs: err.durationMs || durationMs,
          exec: err.exec,
          cwd: err.cwd,
          argv: err.argv,
          exitCode: err.exitCode,
          signal: err.signal,
          stdoutTail: err.stdoutTail,
          stderrTail: err.stderrTail,
          stdoutTruncated: err.stdoutTruncated ? true : undefined,
          stderrTruncated: err.stderrTruncated ? true : undefined,
          error: errorMessage,
        },
        "job failed",
      );
    } else {
      const detail = redactKnownSecrets(err instanceof Error ? err.message : String(err || "")).text.trim();
      errorDetail = pickRunnerErrorDetail(detail);
      params.logger.error(
        {
          terminal: "failed",
          durationMs,
          error: errorMessage,
          ...(detail ? { detail } : {}),
        },
        "job failed",
      );
    }
    await appendRunEventsBestEffort({
      logger: params.logger,
      client: params.client,
      projectId: params.projectId,
      runId: params.job.runId,
      context: "command_end_error",
        events: [
          {
            ts: Date.now(),
            level: "error",
            message: errorMessage,
            meta: { kind: "phase", phase: "command_end" },
          },
          ...(errorDetail ? [
            {
              ts: Date.now(),
              level: "error" as const,
              message: errorDetail,
            },
          ] : []),
        ],
      });
    return { terminal: "failed", errorMessage };
  }
}

export async function __test_appendRunEventsBestEffort(params: {
  client: RunnerAppendEventsClient;
  projectId: string;
  runId: string;
  events: RunnerAppendRunEventsArgs["events"];
  context: "command_start" | "command_output" | "command_end" | "command_end_error";
}): Promise<void> {
  const logger = createRunnerLogger({ level: "fatal", logToFile: false });
  await appendRunEventsBestEffort({ logger, ...params });
}

export async function __test_executeLeasedJobWithRunEvents(params: {
  client: RunnerAppendEventsClient;
  projectId: string;
  job: RunnerLeaseJob;
  maxAttempts: number;
  executeJobFn: typeof executeJob;
  executeSetupApplyPlanFn?: typeof executeSetupApplyPlan;
  runnerPrivateKeyPem?: string;
  repoRoot?: string;
  runtimeDir?: string;
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string; commandResultJson?: string; commandResultLargeJson?: string }> {
  const logger = createRunnerLogger({ level: "fatal", logToFile: false });
  return await executeLeasedJobWithRunEvents({
    logger,
    client: params.client,
    projectId: params.projectId,
    job: params.job,
    repoRoot: params.repoRoot || process.cwd(),
    runtimeDir: params.runtimeDir || process.cwd(),
    runnerPrivateKeyPem: params.runnerPrivateKeyPem || "test",
    maxAttempts: params.maxAttempts,
    executeJobFn: params.executeJobFn,
    executeSetupApplyPlanFn: params.executeSetupApplyPlanFn,
  });
}

export const runnerStart = defineCommand({
  meta: {
    name: "start",
    description: "Start Model C runner agent (leases jobs, executes locally, reports metadata).",
  },
  args: {
    project: { type: "string", required: true, description: "Project id." },
    token: { type: "string", required: true, description: "Runner bearer token." },
    name: { type: "string", description: "Runner name." },
    repoRoot: { type: "string", description: "Repo root path (defaults to detected root)." },
    runtimeDir: { type: "string", description: "Runtime dir (default: ~/.clawlets/runtime/runner/<projectId>/<runnerName>)." },
    controlPlaneUrl: { type: "string", description: "Control plane base URL." },
    logLevel: { type: "string", description: "Log level (fatal|error|warn|info|debug|trace)." },
    logFile: { type: "string", description: "Log file path (default: <runtimeDir>/logs/runner/<projectId>-<runnerName>.jsonl)." },
    noLogFile: { type: "boolean", description: "Disable file logging.", default: false },
    pollMs: { type: "string", description: "Idle poll interval ms.", default: String(RUNNER_IDLE_POLL_MS_DEFAULT) },
    pollMaxMs: { type: "string", description: "Maximum idle poll interval ms.", default: String(RUNNER_IDLE_POLL_MAX_MS_DEFAULT) },
    leaseWaitMs: {
      type: "string",
      description: "Idle lease long-poll window ms (0 disables).",
      default: String(RUNNER_IDLE_LEASE_WAIT_MS_DEFAULT),
    },
    leaseTtlMs: { type: "string", description: "Lease TTL ms.", default: "30000" },
    heartbeatMs: { type: "string", description: "Runner heartbeat interval ms.", default: "30000" },
    maxAttempts: { type: "string", description: "Maximum lease attempts before failing a job.", default: "3" },
    maxIdleMs: {
      type: "string",
      description: "Stop runner after idle ms. Use 'auto' for localhost default; 0 disables.",
      default: "auto",
    },
    once: { type: "boolean", description: "Process at most one leased job.", default: false },
  },
	  async run({ args }) {
	    const projectId = String((args as any).project || "").trim();
	    const token = String((args as any).token || "").trim();
	    if (!projectId) throw new Error("missing --project");
	    if (!token) throw new Error("missing --token");

	    const controlPlaneUrl = resolveControlPlaneUrl((args as any).controlPlaneUrl);
	    const metadataSyncMaxAgeMs = resolveRunnerMetadataSyncMaxAgeMs(controlPlaneUrl);
	    const runnerName = String((args as any).name || `${envName()}-${os.hostname()}`).trim() || `runner-${os.hostname()}`;
	    const runOnce = Boolean((args as any).once);
	    const pollMs = toInt((args as any).pollMs, RUNNER_IDLE_POLL_MS_DEFAULT, 50, 30_000);
	    const pollMaxMs = Math.max(pollMs, toInt((args as any).pollMaxMs, RUNNER_IDLE_POLL_MAX_MS_DEFAULT, pollMs, 120_000));
	    const leaseWaitMs = toInt((args as any).leaseWaitMs, RUNNER_IDLE_LEASE_WAIT_MS_DEFAULT, 0, 60_000);
	    const leaseTtlMs = toInt((args as any).leaseTtlMs, 30_000, 5_000, 120_000);
	    const heartbeatMs = toInt((args as any).heartbeatMs, 30_000, 2_000, 120_000);
	    const maxAttempts = toInt((args as any).maxAttempts, 3, 1, 25);
	    const maxIdleMs = resolveRunnerMaxIdleMs(controlPlaneUrl, (args as any).maxIdleMs);
	    const repoRoot = String((args as any).repoRoot || "").trim() || findRepoRoot(process.cwd());
	    const runtimeDir = resolveRunnerRuntimeDir({
	      runtimeDirArg: (args as any).runtimeDir,
	      projectId,
	      runnerName,
	    });

	    const layout = getRepoLayout(repoRoot, runtimeDir);
	    const logLevel = parseLogLevel((args as any).logLevel ?? process.env["CLAWLETS_LOG_LEVEL"], "info");
	    const logToFile = !Boolean((args as any).noLogFile);
	    const resolvedLogFilePath = logToFile
	      ? coerceTrimmedString((args as any).logFile) ||
	        coerceTrimmedString(process.env["CLAWLETS_LOG_FILE"]) ||
	        resolveRunnerLogFile({ runtimeDir: layout.runtimeDir, projectId, runnerName })
	      : undefined;
	    const logger = createRunnerLogger({
	      level: logLevel,
	      logToFile,
	      logFilePath: resolvedLogFilePath,
	      bindings: {
	        projectId,
	        runnerName,
	      },
	    });
	    try {
	      await cleanupStaleRunnerTempFiles();
	    } catch (err) {
	      const message = sanitizeRunnerControlPlaneErrorMessage(err, "temp file cleanup failed");
	      logger.warn({ error: message }, "runner temp-file cleanup failed");
	    }
	    const sealedKeyPath = await resolveRunnerSealedInputKeyPath({
	      runtimeDir,
	      projectId,
	      runnerName,
	    });
	    const sealedKeyPair = await loadOrCreateRunnerSealedInputKeypair({ privateKeyPath: sealedKeyPath });

	    const client = new RunnerApiClient(controlPlaneUrl, token);
	    logger.info(
	      {
	        ok: true,
	        runner: {
	          projectId,
	          runnerName,
	          controlPlaneUrl,
	          repoRoot,
	          runtimeDir: layout.runtimeDir,
	          sealedInput: {
	            alg: sealedKeyPair.alg,
	            keyId: sealedKeyPair.keyId,
	          },
	        },
	        log: {
	          level: logLevel,
	          file: logToFile ? path.resolve(String(resolvedLogFilePath)) : undefined,
	        },
	      },
	      "runner started",
	    );

    let running = true;
    const stop = () => {
      running = false;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const runnerNixCapabilities = await detectRunnerNixCapabilities();

    const sendHeartbeat = async (status: "online" | "offline") => {
      try {
        await client.heartbeat({
          projectId,
          runnerName,
          status,
          capabilities: {
            supportsSealedInput: true,
            sealedInputAlg: sealedKeyPair.alg,
            sealedInputPubSpkiB64: sealedKeyPair.publicKeySpkiB64,
            sealedInputKeyId: sealedKeyPair.keyId,
            supportsInfraApply: true,
            hasNix: runnerNixCapabilities.hasNix,
            nixBin: runnerNixCapabilities.nixBin,
            nixVersion: runnerNixCapabilities.nixVersion,
          },
        });
	      } catch (err) {
	        const message = sanitizeRunnerControlPlaneErrorMessage(err, "heartbeat failed");
	        logger.error({ error: message }, "runner heartbeat error");
	      }
	    };

    await sendHeartbeat("online");
    const ticker = setInterval(() => {
      void sendHeartbeat("online");
    }, heartbeatMs);

    let metadataLastFingerprint: string | null = null;
    let metadataLastSyncedAt: number | null = null;
    const syncMetadataIfNeeded = async (params: {
      lastRunId?: string;
      lastRunStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled";
      context: "startup" | "job";
      jobId?: string;
    }) => {
      try {
        const snapshot = await buildMetadataSnapshot({
          repoRoot,
          lastRunId: params.lastRunId,
          lastRunStatus: params.lastRunStatus,
        });
        const now = Date.now();
        const fingerprint = metadataSnapshotFingerprint(snapshot);
        if (
          !shouldSyncMetadata({
            fingerprint,
            now,
            lastFingerprint: metadataLastFingerprint,
            lastSyncedAt: metadataLastSyncedAt,
            maxAgeMs: metadataSyncMaxAgeMs,
          })
        ) {
          return;
        }
        await client.syncMetadata({
          projectId,
          payload: snapshot,
        });
        metadataLastFingerprint = fingerprint;
        metadataLastSyncedAt = now;
	      } catch (err) {
	        const message = sanitizeRunnerControlPlaneErrorMessage(err, "metadata sync failed");
	        if (params.context === "job" && params.jobId) {
	          logger.warn({ jobId: params.jobId, error: message }, "metadata sync failed");
	          return;
	        }
	        logger.warn({ context: params.context, error: message }, "metadata sync failed");
	      }
	    };
    let metadataSyncInFlight = false;
    let metadataSyncWorker: Promise<void> | null = null;
    let pendingMetadataSync:
      | {
          lastRunId?: string;
          lastRunStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled";
          context: "startup" | "job";
          jobId?: string;
        }
      | null = null;
    const scheduleMetadataSync = (params: {
      lastRunId?: string;
      lastRunStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled";
      context: "startup" | "job";
      jobId?: string;
    }) => {
      pendingMetadataSync = params;
      if (metadataSyncInFlight) return;
      metadataSyncInFlight = true;
      metadataSyncWorker = (async () => {
        while (pendingMetadataSync) {
          const next = pendingMetadataSync;
          pendingMetadataSync = null;
          await syncMetadataIfNeeded(next);
        }
      })().finally(() => {
        metadataSyncInFlight = false;
        metadataSyncWorker = null;
      });
    };
    const flushPendingMetadataSync = async () => {
      if (!metadataSyncInFlight && !pendingMetadataSync) return;
      if (!metadataSyncInFlight && pendingMetadataSync) {
        scheduleMetadataSync(pendingMetadataSync);
      }
      if (!metadataSyncWorker) return;
      await Promise.race([
        metadataSyncWorker.catch(() => undefined),
        sleep(RUNNER_METADATA_SYNC_SHUTDOWN_FLUSH_TIMEOUT_MS),
      ]);
    };
    scheduleMetadataSync({ context: "startup" });
    let lastRunId: string | undefined;
    let lastRunStatus: "queued" | "running" | "succeeded" | "failed" | "canceled" | undefined;
    const metadataTicker = setInterval(() => {
      scheduleMetadataSync({
        context: "startup",
        ...(lastRunId ? { lastRunId } : {}),
        ...(lastRunStatus ? { lastRunStatus } : {}),
      });
    }, metadataSyncMaxAgeMs);

    try {
      let leaseErrorStreak = 0;
      let emptyLeaseStreak = 0;
      let lastActiveAtMs = Date.now();
      while (running) {
        let lease: Awaited<ReturnType<RunnerApiClient["leaseNext"]>>;
        const requestedWaitMs = runOnce ? 0 : leaseWaitMs;
        try {
          lease = await client.leaseNext({
            projectId,
            leaseTtlMs,
            waitMs: requestedWaitMs,
            waitPollMs: Math.max(50, pollMs),
          });
          leaseErrorStreak = 0;
        } catch (err) {
	          const kind = classifyRunnerHttpError(err);
	          const message = sanitizeRunnerControlPlaneErrorMessage(err, "lease request failed");
	          if (kind === "auth" || kind === "permanent") {
	            logger.error({ kind, error: message }, "runner lease failed; stopping");
	            break;
	          }
          leaseErrorStreak += 1;
	          const backoffMs = computeLeaseErrorBackoffMs({
	            pollMs,
	            pollMaxMs,
	            leaseErrorStreak,
	            kind,
	          });
	          logger.warn({ kind, backoffMs, error: message }, "runner lease failed; retrying");
	          await sleep(backoffMs);
	          continue;
	        }
        const job = lease.job;
        if (!job) {
          if (runOnce) break;
          emptyLeaseStreak = Math.min(RUNNER_EMPTY_LEASE_MAX_STREAK, emptyLeaseStreak + 1);
          const serverHonoredWait = requestedWaitMs > 0 && lease.waitApplied === true;
          if (!serverHonoredWait) {
            await sleep(
              computeIdleLeasePollDelayMs({
                pollMs,
                pollMaxMs,
                emptyLeaseStreak,
              }),
            );
          }
          if (maxIdleMs > 0 && Date.now() - lastActiveAtMs >= maxIdleMs) {
            logger.info({ maxIdleMs }, "runner idle timeout reached; stopping");
            break;
          }
          continue;
        }
        emptyLeaseStreak = 0;
        lastActiveAtMs = Date.now();

        const beat = setInterval(() => {
	          void client
	            .heartbeatJob({ projectId, jobId: job.jobId, leaseId: job.leaseId, leaseTtlMs })
	            .catch((err) => {
	              const message = sanitizeRunnerControlPlaneErrorMessage(err, "job heartbeat failed");
	              logger.warn({ jobId: job.jobId, error: message }, "runner job heartbeat failed");
	            });
	        }, Math.max(2000, Math.floor(leaseTtlMs / 2)));

        let terminal: "succeeded" | "failed" | "canceled" = "failed";
	        let errorMessage: string | undefined;
	        let commandResultJson: string | undefined;
	        let commandResultLargeJson: string | undefined;
	        try {
	          const jobLogger = logger.child({ jobId: job.jobId, runId: job.runId, jobKind: job.kind });
          const execution = await executeLeasedJobWithRunEvents({
            logger: jobLogger,
            client,
            projectId,
            job,
            repoRoot,
            runtimeDir: layout.runtimeDir,
            runnerPrivateKeyPem: sealedKeyPair.privateKeyPem,
            maxAttempts,
          });
          terminal = execution.terminal;
          errorMessage = execution.errorMessage;
          commandResultJson = execution.commandResultJson;
          commandResultLargeJson = execution.commandResultLargeJson;
        } finally {
          clearInterval(beat);
        }

        let stopAfterCompletionError = false;
        try {
          const completion = await client.completeJob({
            projectId,
            jobId: job.jobId,
            leaseId: job.leaseId,
            status: terminal,
            errorMessage,
            ...(commandResultJson ? { commandResultJson } : {}),
            ...(commandResultLargeJson ? { commandResultLargeJson } : {}),
	          });
	          if (!completion.ok) {
	            logger.error({ jobId: job.jobId }, "runner completion rejected: lease/status mismatch");
	          }
	        } catch (err) {
	          const kind = classifyRunnerHttpError(err);
	          const message = sanitizeRunnerControlPlaneErrorMessage(err, "completion failed");
	          if (shouldStopOnCompletionError(kind)) {
	            stopAfterCompletionError = true;
	            logger.error({ jobId: job.jobId, kind, error: message }, "runner completion failed; stopping");
	          } else {
	            logger.warn({ jobId: job.jobId, kind, error: message }, "runner completion failed; continuing");
	          }
	        }

        scheduleMetadataSync({
          context: "job",
          jobId: job.jobId,
          lastRunId: job.runId,
          lastRunStatus: terminal,
        });
        lastRunId = job.runId;
        lastRunStatus = terminal;
        const postJobIdlePollDelayMs = computePostJobIdlePollDelayMs({
          requestedWaitMs,
          waitApplied: lease.waitApplied,
          pollMs,
        });
        if (postJobIdlePollDelayMs > 0) {
          await sleep(postJobIdlePollDelayMs);
        }
        lastActiveAtMs = Date.now();

        if (stopAfterCompletionError) {
          running = false;
        }

        if (runOnce) break;
      }
    } finally {
      clearInterval(ticker);
      clearInterval(metadataTicker);
      await flushPendingMetadataSync();
      await sendHeartbeat("offline");
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  },
});
