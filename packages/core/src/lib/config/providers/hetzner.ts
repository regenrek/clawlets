import { z, type RefinementCtx } from "zod";

export const HetznerHostSchema = z
  .object({
    serverType: z.string().trim().min(1).default("cx43"),
    image: z.string().trim().default(""),
    location: z.string().trim().min(1).default("nbg1"),
    allowTailscaleUdpIngress: z.boolean().default(true),
  })
  .default(() => ({ serverType: "cx43", image: "", location: "nbg1", allowTailscaleUdpIngress: true }));

export type HetznerHostConfig = z.infer<typeof HetznerHostSchema>;

export function addHetznerProvisioningIssues(params: {
  host: { hetzner: HetznerHostConfig };
  ctx: RefinementCtx;
}): void {
  const hetzner = params.host.hetzner;
  if (!hetzner.serverType.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hetzner", "serverType"],
      message: "hetzner.serverType must be set when provisioning.provider is hetzner",
    });
  }
  if (!hetzner.location.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hetzner", "location"],
      message: "hetzner.location must be set when provisioning.provider is hetzner",
    });
  }
}
