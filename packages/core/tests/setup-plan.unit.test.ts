import { describe, expect, it } from "vitest";

import {
  buildSetupApplyPlan,
  createSetupApplyExecutionInput,
} from "../src/lib/setup/plan";

describe("setup apply plan", () => {
  it("builds canonical config mutations from setup draft state", () => {
    const plan = buildSetupApplyPlan({
      hostName: "alpha",
      draft: {
        infrastructure: {
          serverType: "cpx22",
          image: "ubuntu-24.04",
          location: "nbg1",
          allowTailscaleUdpIngress: true,
          volumeEnabled: true,
          volumeSizeGb: 80,
        },
        connection: {
          adminCidr: "203.0.113.10/32",
          sshExposureMode: "bootstrap",
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST alpha"],
        },
      },
      targetRunnerId: "runner-1",
    });

    expect(plan.schemaVersion).toBe(1);
    expect(plan.targetRunnerId).toBe("runner-1");
    expect(plan.configMutations).toMatchInlineSnapshot(`
      [
        {
          "del": false,
          "path": "hosts.alpha.provisioning.provider",
          "value": "hetzner",
        },
        {
          "del": false,
          "path": "hosts.alpha.hetzner.serverType",
          "value": "cpx22",
        },
        {
          "del": false,
          "path": "hosts.alpha.hetzner.image",
          "value": "ubuntu-24.04",
        },
        {
          "del": false,
          "path": "hosts.alpha.hetzner.location",
          "value": "nbg1",
        },
        {
          "del": false,
          "path": "hosts.alpha.hetzner.allowTailscaleUdpIngress",
          "valueJson": "true",
        },
        {
          "del": false,
          "path": "hosts.alpha.hetzner.volumeSizeGb",
          "valueJson": "80",
        },
        {
          "del": false,
          "path": "hosts.alpha.provisioning.adminCidr",
          "value": "203.0.113.10/32",
        },
        {
          "del": false,
          "path": "hosts.alpha.sshExposure.mode",
          "value": "bootstrap",
        },
        {
          "del": false,
          "path": "fleet.sshAuthorizedKeys",
          "valueJson": "["ssh-ed25519 AAAATEST alpha"]",
        },
      ]
    `);
  });

  it("rejects non-allowlisted deploy creds keys", () => {
    expect(() =>
      createSetupApplyExecutionInput({
        hostName: "alpha",
        configMutations: [
          { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
        ],
        deployCreds: {
          NOT_ALLOWED: "x",
        } as any,
        bootstrapSecrets: {},
      })
    ).toThrow(/not allowlisted/i);
  });

  it("rejects non-allowlisted config mutation paths", () => {
    expect(() =>
      createSetupApplyExecutionInput({
        hostName: "alpha",
        configMutations: [
          { path: "hosts.alpha.__proto__.polluted", value: "x", del: false },
        ],
        deployCreds: {
          GITHUB_TOKEN: "ghp_test",
        } as any,
        bootstrapSecrets: {},
      }),
    ).toThrow(/not allowlisted/i)
  })
});
