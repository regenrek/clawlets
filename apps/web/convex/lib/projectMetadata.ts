import type { Doc } from "../_generated/dataModel";
import { normalizeWorkspaceRef } from "./workspaceRef";

export type ProjectExecutionMode = "local" | "remote_runner";
export type ProjectWorkspaceRef = { kind: "local" | "git"; id: string; relPath?: string };
export type ProjectRuntimeMetadata = {
  executionMode: ProjectExecutionMode;
  workspaceRef: ProjectWorkspaceRef;
  workspaceRefKey: string;
  localPath: string | undefined;
};
export type ProjectWithMetadata = Doc<"projects"> & ProjectRuntimeMetadata;

function normalizeLocalPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next || undefined;
}

function tryNormalizeWorkspaceRef(value: unknown): { kind: "local" | "git"; id: string; relPath?: string; key: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { kind?: unknown; id?: unknown; relPath?: unknown };
  if (candidate.kind !== "local" && candidate.kind !== "git") return null;
  if (typeof candidate.id !== "string") return null;
  if (typeof candidate.relPath !== "string" && typeof candidate.relPath !== "undefined") return null;
  try {
    return normalizeWorkspaceRef({
      kind: candidate.kind,
      id: candidate.id,
      relPath: candidate.relPath,
    });
  } catch {
    return null;
  }
}

export function resolveProjectRuntimeMetadata(input: {
  projectId: string;
  executionMode?: "local" | "remote_runner";
  workspaceRef?: unknown;
  localPath?: string;
}): ProjectRuntimeMetadata {
  const localPath = normalizeLocalPath(input.localPath);
  let executionMode: ProjectExecutionMode =
    input.executionMode === "local" || input.executionMode === "remote_runner"
      ? input.executionMode
      : localPath
        ? "local"
        : "remote_runner";
  if (executionMode === "local" && !localPath) executionMode = "remote_runner";

  const existingWorkspaceRef = tryNormalizeWorkspaceRef(input.workspaceRef);
  const fallbackWorkspaceRef =
    executionMode === "local"
      ? normalizeWorkspaceRef({ kind: "local", id: `legacy:${input.projectId}` })
      : normalizeWorkspaceRef({ kind: "git", id: `legacy:${input.projectId}` });
  const normalizedWorkspaceRef =
    existingWorkspaceRef &&
      ((executionMode === "local" && existingWorkspaceRef.kind === "local") ||
        (executionMode === "remote_runner" && existingWorkspaceRef.kind === "git"))
      ? existingWorkspaceRef
      : fallbackWorkspaceRef;

  return {
    executionMode,
    workspaceRef: {
      kind: normalizedWorkspaceRef.kind,
      id: normalizedWorkspaceRef.id,
      relPath: normalizedWorkspaceRef.relPath,
    },
    workspaceRefKey: normalizedWorkspaceRef.key,
    localPath: executionMode === "local" ? localPath : undefined,
  };
}

export function withResolvedProjectMetadata(project: Doc<"projects">): ProjectWithMetadata {
  const metadata = resolveProjectRuntimeMetadata({
    projectId: String(project._id),
    executionMode: project.executionMode,
    workspaceRef: project.workspaceRef,
    localPath: project.localPath,
  });
  return { ...project, ...metadata };
}
