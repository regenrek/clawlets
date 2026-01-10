import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../src/lib/run.js", () => ({
  capture: vi.fn(async () => "nix (mock) 2.0"),
  run: vi.fn(async () => {}),
  captureWithInput: vi.fn(async () => ""),
}));

vi.mock("../src/lib/git.js", () => ({
  tryGetOriginFlake: vi.fn(async () => null),
}));

vi.mock("../src/lib/github.js", () => ({
  tryParseGithubFlakeUri: vi.fn((flakeBase: string) => {
    const m = flakeBase.trim().match(/^github:([^/]+)\/([^/]+)(?:\/.*)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  }),
  checkGithubRepoVisibility: vi.fn(async () => ({ ok: true, status: "public" })),
}));

describe("doctor", () => {
  let repoRoot = "";
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-doctor-"));
    await writeFile(path.join(repoRoot, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "terraform"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "nix", "hosts"), { recursive: true });
    await mkdir(path.join(repoRoot, "infra", "secrets", "extra-files", "bots01", "var", "lib", "sops-nix"), { recursive: true });

    const sshPub = path.join(repoRoot, "id_ed25519.pub");
    await writeFile(sshPub, "ssh-ed25519 AAAATEST test\n", "utf8");

    const operatorKey = path.join(repoRoot, "infra", "secrets", "operators", "tester.agekey");
    await mkdir(path.dirname(operatorKey), { recursive: true });
    await writeFile(operatorKey, "AGE-SECRET-KEY-TEST\n", "utf8");

    await writeFile(
      path.join(repoRoot, ".env"),
      [
        "HCLOUD_TOKEN=abc",
        "ADMIN_CIDR=203.0.113.10/32",
        `SSH_PUBKEY_FILE=${sshPub}`,
        `SOPS_AGE_KEY_FILE=${operatorKey}`,
        "SERVER_TYPE=cx43",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "configs", "fleet.nix"),
      ' { bots = [ "alpha" "beta" ]; } ',
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "secrets", ".sops.yaml"),
      [
        "creation_rules:",
        "  - path_regex: ^bots01\\.yaml$",
        "    age: age1a, age1b",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "secrets", "bots01.yaml"),
      [
        "wg_private_key: x",
        "admin_password_hash: y",
        "discord_token_alpha: z",
        "discord_token_beta: z2",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "secrets", "extra-files", "bots01", "var", "lib", "sops-nix", "key.txt"),
      "AGE-SECRET-KEY-TEST\n",
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "infra", "nix", "hosts", "bots01.nix"),
      [
        "users.users.admin = {",
        '  openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAATEST test" ];',
        "};",
        "services.clawdbotFleet = { bootstrapSsh = true; };",
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

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("passes with a fully seeded repo", async () => {
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    expect(checks.some((c) => c.status === "missing")).toBe(false);
  });

  it("flags SSH_PUBKEY_FILE contents as invalid", async () => {
    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({
      cwd: repoRoot,
      envFile: path.join(repoRoot, ".env"),
      host: "bots01",
    });

    expect(checks.some((c) => c.label === "SSH_PUBKEY_FILE" && c.status === "missing")).toBe(false);

    await writeFile(
      path.join(repoRoot, ".env"),
      [
        "HCLOUD_TOKEN=abc",
        "ADMIN_CIDR=203.0.113.10/32",
        "SSH_PUBKEY_FILE=ssh-ed25519 AAAATEST test",
        "",
      ].join("\n"),
      "utf8",
    );

    const checks2 = await collectDoctorChecks({
      cwd: repoRoot,
      envFile: path.join(repoRoot, ".env"),
      host: "bots01",
    });
    expect(
      checks2.some(
        (c) =>
          c.label === "SSH_PUBKEY_FILE" &&
          c.status === "missing" &&
          String(c.detail || "").includes("must be a path"),
      ),
    ).toBe(true);
  });

  it("requires GITHUB_TOKEN when repo is private", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/private-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "private-or-missing" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("missing");
  });

  it("accepts GITHUB_TOKEN when repo is public", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/public-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "public" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("ok");
  });

  it("warns when GitHub API is rate-limited", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "rate-limited" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when token set but GitHub check fails", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: false, status: "network", detail: "boom" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when API is rate-limited without token", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "rate-limited" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when API check fails without token", async () => {
    const git = await import("../src/lib/git");
    const github = await import("../src/lib/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: false, status: "network", detail: "boom" });

    const { collectDoctorChecks } = await import("../src/doctor");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "bots01" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });
});
