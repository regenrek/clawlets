import { z } from "zod";
import { GatewayIdSchema, SecretNameSchema } from "@clawlets/shared/lib/identifiers";
import { isValidTargetHost } from "../ssh-remote.js";
import { DEFAULT_NIX_SUBSTITUTERS, DEFAULT_NIX_TRUSTED_PUBLIC_KEYS } from "../nix-cache.js";
import { HOST_THEME_COLORS, HOST_THEME_DEFAULT_COLOR, HOST_THEME_DEFAULT_EMOJI } from "../host-theme.js";
import { parseCidr, isWorldOpenCidr } from "./helpers.js";
import { AwsHostSchema, HetznerHostSchema, ProvisioningProviderSchema, addProvisioningIssues } from "./providers/index.js";
import { FleetGatewaySchema } from "./schema-gateway.js";

export const SSH_EXPOSURE_MODES = ["tailnet", "bootstrap", "public"] as const;
export const SshExposureModeSchema = z.enum(SSH_EXPOSURE_MODES);
export type SshExposureMode = z.infer<typeof SshExposureModeSchema>;

export const TAILNET_MODES = ["none", "tailscale"] as const;
export const TailnetModeSchema = z.enum(TAILNET_MODES);
export type TailnetMode = z.infer<typeof TailnetModeSchema>;

export { HOST_THEME_COLORS };
export const HostThemeColorSchema = z.enum(HOST_THEME_COLORS);
export type HostThemeColor = z.infer<typeof HostThemeColorSchema>;

export const HostSchema = z
  .object({
    enable: z.boolean().default(false),
    gatewaysOrder: z.array(GatewayIdSchema).default(() => []),
    gateways: z.record(GatewayIdSchema, FleetGatewaySchema).default(() => ({})),
    openclaw: z
      .object({
        enable: z.boolean().default(false),
      })
      .default(() => ({ enable: false })),
    diskDevice: z.string().trim().default("/dev/sda"),
    flakeHost: z.string().trim().default(""),
    targetHost: z
      .string()
      .trim()
      .min(1)
      .optional()
      .refine((v) => (v ? isValidTargetHost(v) : true), {
        message: "invalid targetHost (expected ssh alias or user@host)",
      }),
    theme: z
      .object({
        emoji: z.string().trim().min(1).default(HOST_THEME_DEFAULT_EMOJI),
        color: HostThemeColorSchema.default(HOST_THEME_DEFAULT_COLOR),
      })
      .default(() => ({ emoji: HOST_THEME_DEFAULT_EMOJI, color: HOST_THEME_DEFAULT_COLOR })),
    hetzner: HetznerHostSchema,
    aws: AwsHostSchema,
    provisioning: z
      .object({
        provider: ProvisioningProviderSchema.default("hetzner"),
        adminCidr: z.string().trim().default(""),
        adminCidrAllowWorldOpen: z.boolean().default(false),
        // Local path on the operator machine that runs provisioning.
        // Intentionally default empty to avoid silently persisting a guessed path in shared config.
        sshPubkeyFile: z.string().trim().default(""),
      })
      .superRefine((value, ctx) => {
        const adminCidr = value.adminCidr.trim();
        if (!adminCidr) return;
        const parsed = parseCidr(adminCidr);
        if (!parsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "provisioning.adminCidr must be a valid CIDR (e.g. 203.0.113.10/32)",
            path: ["adminCidr"],
          });
          return;
        }
        if (isWorldOpenCidr(parsed) && !value.adminCidrAllowWorldOpen) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "provisioning.adminCidr cannot be world-open unless adminCidrAllowWorldOpen is true",
            path: ["adminCidr"],
          });
        }
      })
      .default(() => ({
        provider: "hetzner" as const,
        adminCidr: "",
        adminCidrAllowWorldOpen: false,
        sshPubkeyFile: "",
      })),
    sshExposure: z
      .object({
        mode: SshExposureModeSchema.default("bootstrap"),
      })
      .default(() => ({ mode: "bootstrap" as const })),
    tailnet: z
      .object({
        mode: TailnetModeSchema.default("tailscale"),
      })
      .default(() => ({ mode: "tailscale" as const })),
    cache: z
      .object({
        substituters: z
          .array(z.string().trim().min(1))
          .min(1, { message: "cache.substituters must not be empty" })
          .default(() => Array.from(DEFAULT_NIX_SUBSTITUTERS)),
        trustedPublicKeys: z
          .array(z.string().trim().min(1))
          .min(1, { message: "cache.trustedPublicKeys must not be empty" })
          .default(() => Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS)),
        netrc: z
          .object({
            enable: z.boolean().default(false),
            secretName: SecretNameSchema.default("garnix_netrc"),
            path: z.string().trim().default("/etc/nix/netrc"),
            narinfoCachePositiveTtl: z.number().int().positive().default(3600),
          })
          .default(() => ({
            enable: false,
            secretName: "garnix_netrc",
            path: "/etc/nix/netrc",
            narinfoCachePositiveTtl: 3600,
          })),
      })
      .superRefine((cache, ctx) => {
        if (cache.netrc.enable && !cache.netrc.secretName.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["netrc", "secretName"],
            message: "cache.netrc.secretName must be set when cache.netrc.enable is true",
          });
        }
        if (cache.netrc.enable && !cache.netrc.path.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["netrc", "path"],
            message: "cache.netrc.path must be set when cache.netrc.enable is true",
          });
        }
      })
      .default(() => ({
        substituters: Array.from(DEFAULT_NIX_SUBSTITUTERS),
        trustedPublicKeys: Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS),
        netrc: {
          enable: false,
          secretName: "garnix_netrc",
          path: "/etc/nix/netrc",
          narinfoCachePositiveTtl: 3600,
        },
      })),
    operator: z
      .object({
        deploy: z
          .object({
            enable: z.boolean().default(false),
          })
          .default(() => ({ enable: false })),
      })
      .default(() => ({ deploy: { enable: false } })),
    selfUpdate: z
      .object({
        enable: z.boolean().default(false),
        interval: z.string().trim().default("30min"),
        baseUrls: z.array(z.string().trim().min(1)).default([]),
        channel: z
          .string()
          .trim()
          .default("prod")
          .refine((v) => /^[a-z][a-z0-9-]*$/.test(v), { message: "invalid selfUpdate.channel (use [a-z][a-z0-9-]*)" }),
        publicKeys: z.array(z.string().trim().min(1)).default([]),
        previousPublicKeys: z.array(z.string().trim().min(1)).default([]),
        previousPublicKeysValidUntil: z.string().trim().default(""),
        allowUnsigned: z.boolean().default(false),
        allowRollback: z.boolean().default(false),
        healthCheckUnit: z.string().trim().default(""),
      })
      .superRefine((v, ctx) => {
        if (v.enable && v.baseUrls.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["baseUrls"],
            message: "selfUpdate.baseUrls must be set when enabled",
          });
        }
        if (v.enable && !v.allowUnsigned && v.publicKeys.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["publicKeys"],
            message: "selfUpdate.publicKeys must be set when enabled",
          });
        }
        if (v.previousPublicKeysValidUntil && v.previousPublicKeys.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeys"],
            message: "selfUpdate.previousPublicKeys is required when previousPublicKeysValidUntil is set",
          });
        }
        if (v.previousPublicKeysValidUntil && Number.isNaN(Date.parse(v.previousPublicKeysValidUntil))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeysValidUntil"],
            message: "invalid selfUpdate.previousPublicKeysValidUntil (expected ISO timestamp)",
          });
        }
        const allKeys = new Set([...v.publicKeys, ...v.previousPublicKeys]);
        if (allKeys.size !== v.publicKeys.length + v.previousPublicKeys.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeys"],
            message: "selfUpdate.previousPublicKeys must not overlap selfUpdate.publicKeys",
          });
        }
        if (v.healthCheckUnit && !/^[A-Za-z0-9@._:-]+(\.service)?$/.test(v.healthCheckUnit)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["healthCheckUnit"],
            message: "invalid selfUpdate.healthCheckUnit",
          });
        }
      })
      .default(() => ({
        enable: false,
        interval: "30min",
        baseUrls: [],
        channel: "prod",
        publicKeys: [],
        previousPublicKeys: [],
        previousPublicKeysValidUntil: "",
        allowUnsigned: false,
        allowRollback: false,
        healthCheckUnit: "",
      })),
    agentModelPrimary: z.string().trim().default("anthropic/claude-opus-4-5"),
  })
  .superRefine((host, ctx) => {
    addProvisioningIssues({ host, ctx });

    const gatewayIds = Object.keys(host.gateways || {});
    const gatewaysOrder = host.gatewaysOrder || [];
    const seen = new Set<string>();
    for (let i = 0; i < gatewaysOrder.length; i++) {
      const id = gatewaysOrder[i]!;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gatewaysOrder", i],
          message: `duplicate gateway id: ${id}`,
        });
        continue;
      }
      seen.add(id);
      if (!host.gateways[id]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gatewaysOrder", i],
          message: `unknown gateway id: ${id}`,
        });
      }
    }

    if (gatewayIds.length > 0 && gatewaysOrder.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gatewaysOrder"],
        message: "gatewaysOrder must be set (deterministic order for ports/services)",
      });
      return;
    }

    const missing = gatewayIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gatewaysOrder"],
        message: `gatewaysOrder missing gateways: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` (+${missing.length - 6})` : ""}`,
      });
    }

    if (host.openclaw?.enable && gatewayIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openclaw", "enable"],
        message: "openclaw.enable requires at least one gateway",
      });
    }
  });

export type ClawletsHostConfig = z.infer<typeof HostSchema>;
