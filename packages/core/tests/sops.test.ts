import { describe, it, expect, vi, beforeEach } from "vitest";

const nixToolsState: {
  lastShellArgs: string[] | null;
} = {
  lastShellArgs: null,
};

const runState: {
  lastArgs: string[] | null;
} = {
  lastArgs: null,
};

vi.mock("../src/lib/nix-tools.js", () => ({
  nixShellCapture: vi.fn(async (_pkg: string, _cmd: string, args: string[]) => {
    nixToolsState.lastShellArgs = args;
    return "<decrypted>";
  }),
}));

vi.mock("../src/lib/run.js", () => ({
  run: vi.fn(async (_cmd: string, args: string[]) => {
    runState.lastArgs = args;
  }),
}));

beforeEach(() => {
  nixToolsState.lastShellArgs = null;
  runState.lastArgs = null;
  vi.resetModules();
});

describe("sops args", () => {
  it("passes --config before decrypt subcommand", async () => {
    const { sopsDecryptYamlFile } = await import("../src/lib/sops");
    await sopsDecryptYamlFile({
      filePath: "/tmp/hosts/bots01.yaml",
      filenameOverride: "bots01.yaml",
      sopsConfigPath: "/tmp/.sops.yaml",
      ageKeyFile: "/tmp/operator.agekey",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(nixToolsState.lastShellArgs).not.toBeNull();
    const args = nixToolsState.lastShellArgs!;
    expect(args[0]).toBe("--config");
    expect(args[1]).toBe("/tmp/.sops.yaml");
    expect(args[2]).toBe("decrypt");
  });

  it("passes --config before encrypt subcommand", async () => {
    const { sopsEncryptYamlToFile } = await import("../src/lib/sops");
    await sopsEncryptYamlToFile({
      plaintextYaml: "hello: world\n",
      outPath: "/tmp/hosts/bots01.yaml",
      filenameOverride: "bots01.yaml",
      sopsConfigPath: "/tmp/.sops.yaml",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(runState.lastArgs).not.toBeNull();
    const args = runState.lastArgs!;
    const idxConfig = args.indexOf("--config");
    const idxEncrypt = args.indexOf("encrypt");
    expect(idxConfig).toBeGreaterThanOrEqual(0);
    expect(idxEncrypt).toBeGreaterThanOrEqual(0);
    expect(idxConfig).toBeLessThan(idxEncrypt);
  });
});

