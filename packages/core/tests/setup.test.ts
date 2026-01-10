import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../src/lib/run.js", () => ({
  capture: vi.fn(async () => "nix (mock) 2.0"),
  run: vi.fn(async () => {}),
  captureWithInput: vi.fn(async () => ""),
}));

vi.mock("../src/lib/age-keygen.js", () => ({
  ageKeygen: vi.fn(async () => ({
    publicKey: "age1testkey",
    secretKey: "AGE-SECRET-KEY-TESTKEY",
    fileText: "# public key: age1testkey\nAGE-SECRET-KEY-TESTKEY\n",
  })),
}));

vi.mock("../src/lib/wireguard.js", () => ({
  wgGenKey: vi.fn(async () => "wg_private_key_test"),
}));

vi.mock("../src/lib/mkpasswd.js", () => ({
  mkpasswdYescryptHash: vi.fn(async () => "$y$testhash"),
}));

vi.mock("../src/lib/sops.js", () => ({
  sopsDecryptYamlFile: vi.fn(async () => {
    throw new Error("no secrets yet");
  }),
  sopsEncryptYamlToFile: vi.fn(async (params: { plaintextYaml: string; outPath: string }) => {
    await writeFile(params.outPath, params.plaintextYaml, "utf8");
  }),
}));

describe("setup", () => {
  let repoRoot = "";
  let sshPub = "";

  const createRepoWithBots = async (bots: string[]) => {
    const root = await mkdtemp(path.join(tmpdir(), "clawdlets-setup-case-"));
    const ssh = path.join(root, "id_ed25519.pub");
    await writeFile(path.join(root, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(path.join(root, "infra", "terraform"), { recursive: true });
    await mkdir(path.join(root, "infra", "configs"), { recursive: true });
    await mkdir(path.join(root, "infra", "nix", "hosts"), { recursive: true });
    await mkdir(path.join(root, "infra", "secrets"), { recursive: true });
    await writeFile(ssh, "ssh-ed25519 AAAATEST test\n", "utf8");
    await writeFile(
      path.join(root, "infra", "configs", "fleet.nix"),
      `{ bots = [ ${bots.map((b) => `"${b}"`).join(" ")} ]; }`,
      "utf8",
    );
    await writeFile(
      path.join(root, "infra", "nix", "hosts", "bots01.nix"),
      [
        "users.users.admin = {",
        "  openssh.authorizedKeys.keys = [",
        '    "ssh-ed25519 AAAAOTHER other"',
        "  ];",
        "};",
        "services.clawdbotFleet = { bootstrapSsh = false; };",
        "",
      ].join("\n"),
      "utf8",
    );
    return { repoRoot: root, sshPub: ssh };
  };

  beforeAll(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-setup-"));
    sshPub = path.join(repoRoot, "id_ed25519.pub");

    await writeFile(path.join(repoRoot, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "terraform"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "nix", "hosts"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "secrets"), { recursive: true });

    await writeFile(sshPub, "ssh-ed25519 AAAATEST test\n", "utf8");
    await writeFile(
      path.join(repoRoot, "infra", "configs", "fleet.nix"),
      ' { bots = [ "alpha" "beta" ]; } ',
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "nix", "hosts", "bots01.nix"),
      [
        "users.users.admin = {",
        "  openssh.authorizedKeys.keys = [",
        '    "ssh-ed25519 AAAAOTHER other"',
        "  ];",
        "};",
        "services.clawdbotFleet = { bootstrapSsh = false; };",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterAll(async () => {
    try {
      await rm(repoRoot, { recursive: true, force: true });
    } catch {}
  });

  it("writes env + secrets + keys and passes doctor", async () => {
    const { runSetup } = await import("../src/setup");
    await runSetup({
      cwd: repoRoot,
      dryRun: false,
      answers: {
        host: "bots01",
        operatorId: "tester",
        env: {
          HCLOUD_TOKEN: "hcloud_token_test",
          ADMIN_CIDR: "203.0.113.10/32",
          SSH_PUBKEY_FILE: sshPub,
          SERVER_TYPE: "cx43",
        },
        secrets: {
          adminPassword: "supersecurepassword",
          discordTokens: {
            alpha: "discord_alpha",
            beta: "discord_beta",
          },
        },
        patchHostNix: {
          addAdminAuthorizedKey: true,
          enableBootstrapSsh: true,
        },
      },
    });

    const envText = await readFile(path.join(repoRoot, ".env"), "utf8");
    expect(envText).toContain("HCLOUD_TOKEN=");
    expect(envText).toContain("SOPS_AGE_KEY_FILE=");

    const sopsCfg = await readFile(path.join(repoRoot, "infra", "secrets", ".sops.yaml"), "utf8");
    expect(sopsCfg).toContain("^bots01\\.yaml$");

    const secretsText = await readFile(path.join(repoRoot, "infra", "secrets", "bots01.yaml"), "utf8");
    expect(secretsText).toContain("wg_private_key:");
    expect(secretsText).toContain("admin_password_hash:");
    expect(secretsText).toContain("discord_token_alpha:");
    expect(secretsText).toContain("discord_token_beta:");

    const extraKey = await readFile(
      path.join(repoRoot, "infra", "secrets", "extra-files", "bots01", "var", "lib", "sops-nix", "key.txt"),
      "utf8",
    );
    expect(extraKey).toContain("AGE-SECRET-KEY-TESTKEY");

    const hostNix = await readFile(path.join(repoRoot, "infra", "nix", "hosts", "bots01.nix"), "utf8");
    expect(hostNix).toContain("ssh-ed25519 AAAATEST test");
    expect(hostNix).toContain("bootstrapSsh = true;");
  });

  it("errors when admin password is missing", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      await writeFile(path.join(root, "infra", "secrets", "bots01.yaml"), "placeholder: yes\n", "utf8");
      await expect(
        runSetup({
          cwd: root,
          dryRun: false,
          answers: {
            host: "bots01",
            operatorId: "tester",
            env: {
              HCLOUD_TOKEN: "hcloud_token_test",
              ADMIN_CIDR: "203.0.113.10/32",
              SSH_PUBKEY_FILE: ssh,
              SERVER_TYPE: "cx43",
            },
            secrets: {
              discordTokens: {
                alpha: "discord_alpha",
              },
            },
            patchHostNix: {
              addAdminAuthorizedKey: false,
              enableBootstrapSsh: false,
            },
          },
        }),
      ).rejects.toThrow("missing admin password");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("errors when a Discord token is missing", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha", "beta"]);
    try {
      await expect(
        runSetup({
          cwd: root,
          dryRun: false,
          answers: {
            host: "bots01",
            operatorId: "tester",
            env: {
              HCLOUD_TOKEN: "hcloud_token_test",
              ADMIN_CIDR: "203.0.113.10/32",
              SSH_PUBKEY_FILE: ssh,
              SERVER_TYPE: "cx43",
            },
            secrets: {
              adminPassword: "supersecurepassword",
              discordTokens: {
                alpha: "discord_alpha",
              },
            },
            patchHostNix: {
              addAdminAuthorizedKey: false,
              enableBootstrapSsh: false,
            },
          },
        }),
      ).rejects.toThrow("missing Discord token for beta");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports dryRun without admin password", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      const result = await runSetup({
        cwd: root,
        dryRun: true,
        answers: {
          host: "bots01",
          operatorId: "tester",
          env: {
            HCLOUD_TOKEN: "hcloud_token_test",
            ADMIN_CIDR: "203.0.113.10/32",
            SSH_PUBKEY_FILE: ssh,
            SERVER_TYPE: "cx43",
          },
          secrets: {
            discordTokens: {
              alpha: "discord_alpha",
            },
          },
          patchHostNix: {
            addAdminAuthorizedKey: false,
            enableBootstrapSsh: false,
          },
        },
      });
      expect(result.bots).toEqual(["alpha"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses existing string secrets", async () => {
    const { runSetup } = await import("../src/setup");
    const { sopsDecryptYamlFile } = await import("../src/lib/sops");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      await writeFile(path.join(root, "infra", "secrets", "bots01.yaml"), "admin_password_hash: $y$old\n", "utf8");
      vi.mocked(sopsDecryptYamlFile).mockResolvedValueOnce("admin_password_hash: $y$old\n");
      const result = await runSetup({
        cwd: root,
        dryRun: false,
        answers: {
          host: "bots01",
          operatorId: "tester",
          env: {
            HCLOUD_TOKEN: "hcloud_token_test",
            ADMIN_CIDR: "203.0.113.10/32",
            SSH_PUBKEY_FILE: ssh,
            SERVER_TYPE: "cx43",
          },
          secrets: {
            discordTokens: {
              alpha: "discord_alpha",
            },
          },
          patchHostNix: {
            addAdminAuthorizedKey: false,
            enableBootstrapSsh: false,
          },
        },
      });
      expect(result.bots).toEqual(["alpha"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid ADMIN_CIDR format", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      await expect(
        runSetup({
          cwd: root,
          dryRun: false,
          answers: {
            host: "bots01",
            operatorId: "tester",
            env: {
              HCLOUD_TOKEN: "hcloud_token_test",
              ADMIN_CIDR: "not-a-cidr",
              SSH_PUBKEY_FILE: ssh,
              SERVER_TYPE: "cx43",
            },
            secrets: {
              adminPassword: "supersecurepassword",
              discordTokens: {
                alpha: "discord_alpha",
              },
            },
            patchHostNix: {
              addAdminAuthorizedKey: false,
              enableBootstrapSsh: false,
            },
          },
        }),
      ).rejects.toThrow("ADMIN_CIDR must be an IPv4 CIDR");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid ADMIN_CIDR address", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      await expect(
        runSetup({
          cwd: root,
          dryRun: false,
          answers: {
            host: "bots01",
            operatorId: "tester",
            env: {
              HCLOUD_TOKEN: "hcloud_token_test",
              ADMIN_CIDR: "999.0.0.1/32",
              SSH_PUBKEY_FILE: ssh,
              SERVER_TYPE: "cx43",
            },
            secrets: {
              adminPassword: "supersecurepassword",
              discordTokens: {
                alpha: "discord_alpha",
              },
            },
            patchHostNix: {
              addAdminAuthorizedKey: false,
              enableBootstrapSsh: false,
            },
          },
        }),
      ).rejects.toThrow("ADMIN_CIDR has invalid IPv4 address");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid host id", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      await expect(
        runSetup({
          cwd: root,
          dryRun: false,
          answers: {
            host: "bad host",
            operatorId: "tester",
            env: {
              HCLOUD_TOKEN: "hcloud_token_test",
              ADMIN_CIDR: "203.0.113.10/32",
              SSH_PUBKEY_FILE: ssh,
              SERVER_TYPE: "cx43",
            },
            secrets: {
              adminPassword: "supersecurepassword",
              discordTokens: {
                alpha: "discord_alpha",
              },
            },
            patchHostNix: {
              addAdminAuthorizedKey: false,
              enableBootstrapSsh: false,
            },
          },
        }),
      ).rejects.toThrow("invalid host");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid operator age key files", async () => {
    const { runSetup } = await import("../src/setup");
    const { repoRoot: root, sshPub: ssh } = await createRepoWithBots(["alpha"]);
    try {
      const operatorsDir = path.join(root, "infra", "secrets", "operators");
      await mkdir(operatorsDir, { recursive: true });
      await writeFile(path.join(operatorsDir, "tester.agekey"), "# public key: age1bad\n", "utf8");
      await writeFile(path.join(operatorsDir, "tester.age.pub"), "age1bad\n", "utf8");

      await expect(
        runSetup({
          cwd: root,
          dryRun: false,
          answers: {
            host: "bots01",
            operatorId: "tester",
            env: {
              HCLOUD_TOKEN: "hcloud_token_test",
              ADMIN_CIDR: "203.0.113.10/32",
              SSH_PUBKEY_FILE: ssh,
              SERVER_TYPE: "cx43",
            },
            secrets: {
              adminPassword: "supersecurepassword",
              discordTokens: {
                alpha: "discord_alpha",
              },
            },
            patchHostNix: {
              addAdminAuthorizedKey: false,
              enableBootstrapSsh: false,
            },
          },
        }),
      ).rejects.toThrow("invalid age key");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
