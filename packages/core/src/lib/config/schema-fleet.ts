import { z } from "zod";
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers";
import { SecretEnvSchema, SecretFilesSchema } from "../secret-wiring.js";

export const GATEWAY_ARCHITECTURES = ["multi", "single"] as const;
export const GatewayArchitectureSchema = z.enum(GATEWAY_ARCHITECTURES);
export type GatewayArchitecture = z.infer<typeof GatewayArchitectureSchema>;

export const FleetSchema = z
  .object({
    secretEnv: SecretEnvSchema,
    secretFiles: SecretFilesSchema,
    sshAuthorizedKeys: z.array(z.string().trim().min(1)).default(() => []),
    sshKnownHosts: z.array(z.string().trim().min(1)).default(() => []),
    gatewayArchitecture: GatewayArchitectureSchema.optional(),
    codex: z
      .object({
        enable: z.boolean().default(false),
        gateways: z.array(GatewayIdSchema).default(() => []),
      })
      .default(() => ({ enable: false, gateways: [] }))
      .superRefine((codex, ctx) => {
        if ((codex as any).bots !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bots"],
            message: "fleet.codex.bots was removed; use fleet.codex.gateways",
          });
        }
      }),
    backups: z
      .object({
        restic: z
          .object({
            enable: z.boolean().default(false),
            repository: z.string().trim().default(""),
          })
          .default(() => ({ enable: false, repository: "" })),
      })
      .default(() => ({ restic: { enable: false, repository: "" } })),
  })
  .passthrough()
  .superRefine((fleet, ctx) => {
    if ((fleet as any).gatewayOrder !== undefined || (fleet as any).gateways !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "fleet.gateways and fleet.gatewayOrder were removed; use hosts.<host>.gateways and hosts.<host>.gatewaysOrder",
      });
      return;
    }
    if ((fleet as any).botOrder !== undefined || (fleet as any).bots !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "fleet.bots and fleet.botOrder were removed; use hosts.<host>.gateways and hosts.<host>.gatewaysOrder",
      });
      return;
    }
  });
