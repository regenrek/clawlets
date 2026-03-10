import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { buildSetupApplyPlan, createSetupApplyExecutionInput } from "@clawlets/core/lib/setup/plan";
import { buildSetupApplyEnvelopeAad } from "@clawlets/core/lib/setup/shared";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { createConvexClient } from "~/server/convex";
import { requireAdminProjectAccess } from "~/sdk/project";
import { parseProjectHostRequiredInput } from "~/sdk/runtime";

const SEALED_INPUT_ALGORITHM = "rsa-oaep-3072/aes-256-gcm";

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function sealForRunnerNode(params: {
  runnerPubSpkiB64: string;
  keyId: string;
  aad: string;
  plaintextJson: string;
  alg?: string;
}): string {
  const alg = String(params.alg || SEALED_INPUT_ALGORITHM).trim();
  if (alg !== SEALED_INPUT_ALGORITHM) throw new Error(`unsupported sealed-input alg: ${alg}`);
  const runnerPubSpkiB64 = String(params.runnerPubSpkiB64 || "").trim();
  if (!runnerPubSpkiB64) throw new Error("runner public key missing");
  const keyId = String(params.keyId || "").trim();
  if (!keyId) throw new Error("runner key id missing");
  const aad = String(params.aad || "").trim();
  if (!aad) throw new Error("aad required");

  const publicKey = createPublicKey({ key: fromBase64Url(runnerPubSpkiB64), format: "der", type: "spki" });
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(params.plaintextJson, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapped = publicEncrypt(
    {
      key: publicKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    aesKey,
  );

  return toBase64Url(Buffer.from(JSON.stringify({
    v: 1,
    alg,
    kid: keyId,
    iv: toBase64Url(iv),
    w: toBase64Url(wrapped),
    ct: toBase64Url(Buffer.concat([ciphertext, tag])),
  }), "utf8"));
}

function parseSetupApplyOperationStartInput(data: unknown): {
  projectId: Id<"projects">;
  host: string;
  deployCreds: Record<string, string>;
  bootstrapSecrets: Record<string, string>;
} {
  const base = parseProjectHostRequiredInput(data);
  const row = data as Record<string, unknown>;
  const deployCreds =
    row.deployCreds && typeof row.deployCreds === "object" && !Array.isArray(row.deployCreds)
      ? row.deployCreds as Record<string, string>
      : {};
  const bootstrapSecrets =
    row.bootstrapSecrets && typeof row.bootstrapSecrets === "object" && !Array.isArray(row.bootstrapSecrets)
      ? row.bootstrapSecrets as Record<string, string>
      : {};
  return { projectId: base.projectId, host: base.host, deployCreds, bootstrapSecrets };
}

export const startSetupApplyOperation = createServerFn({ method: "POST" })
  .inputValidator(parseSetupApplyOperationStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient();
    await requireAdminProjectAccess(client, data.projectId);

    const draft = await client.mutation(api.controlPlane.setupDrafts.getCommitPayload, {
      projectId: data.projectId,
      hostName: data.host,
    });

    let preparedOperationId: Id<"setupOperations"> | null = null;
    try {
      const plan = buildSetupApplyPlan({
        hostName: data.host,
        draft: draft.nonSecretDraft,
        targetRunnerId: String(draft.targetRunnerId),
      });
      const previewPlanJson = JSON.stringify({
        schemaVersion: plan.schemaVersion,
        hostName: plan.hostName,
        targetRunnerId: plan.targetRunnerId,
        configMutations: plan.configMutations,
      });
      const executionPlan = createSetupApplyExecutionInput({
        hostName: plan.hostName,
        configMutations: plan.configMutations,
        deployCreds: data.deployCreds,
        bootstrapSecrets: data.bootstrapSecrets,
      });
      const sealedPlanJson = JSON.stringify(executionPlan);
      const prepared = await client.mutation(api.controlPlane.setupOperations.prepareStart, {
        projectId: data.projectId,
        hostName: data.host,
        targetRunnerId: draft.targetRunnerId,
        planSchemaVersion: plan.schemaVersion,
        planJson: previewPlanJson,
        sealedSecretDrafts: draft.sealedSecretDrafts,
      });
      preparedOperationId = prepared.operationId;

      const aad = buildSetupApplyEnvelopeAad({
        projectId: data.projectId,
        operationId: String(prepared.operationId),
        targetRunnerId: String(prepared.targetRunnerId),
      });
      const sealedPlanB64 = sealForRunnerNode({
        runnerPubSpkiB64: prepared.sealedInputPubSpkiB64,
        keyId: prepared.sealedInputKeyId,
        aad,
        plaintextJson: sealedPlanJson,
        alg: prepared.sealedInputAlg,
      });

      const started = await client.mutation(api.controlPlane.setupOperations.finalizeStart, {
        projectId: data.projectId,
        operationId: prepared.operationId,
        attempt: prepared.attempt,
        sealedPlanB64,
        sealedInputAlg: prepared.sealedInputAlg,
        sealedInputKeyId: prepared.sealedInputKeyId,
      });

      return {
        ok: true as const,
        operationId: started.operationId,
        runId: started.runId,
        jobId: started.jobId,
        attempt: started.attempt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (preparedOperationId) {
        try {
          await client.mutation(api.controlPlane.setupOperations.abortPreparedStart, {
            projectId: data.projectId,
            operationId: preparedOperationId,
            message,
          });
        } catch {
          // best effort
        }
      }
      try {
        await client.mutation(api.controlPlane.setupDrafts.finishCommit, {
          projectId: data.projectId,
          hostName: data.host,
          status: "failed",
          errorMessage: message,
        });
      } catch {
        // best effort
      }
      throw error;
    }
  });
