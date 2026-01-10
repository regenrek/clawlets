import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nixShellCapture, type NixToolOpts } from "./nix-tools.js";
import { run } from "./run.js";
import { ensureDir, writeFileAtomic } from "./fs-safe.js";

export async function sopsDecryptYamlFile(params: {
  filePath: string;
  filenameOverride: string;
  sopsConfigPath: string;
  ageKeyFile?: string;
  nix: NixToolOpts;
}): Promise<string> {
  const env = {
    ...params.nix.env,
    ...(params.ageKeyFile ? { SOPS_AGE_KEY_FILE: params.ageKeyFile } : {}),
  };
  return await nixShellCapture(
    "sops",
    "sops",
    [
      "--config",
      params.sopsConfigPath,
      "decrypt",
      "--input-type",
      "yaml",
      "--output-type",
      "yaml",
      "--filename-override",
      params.filenameOverride,
      params.filePath,
    ],
    { ...params.nix, env },
  );
}

export async function sopsEncryptYamlToFile(params: {
  plaintextYaml: string;
  outPath: string;
  filenameOverride: string;
  sopsConfigPath: string;
  nix: NixToolOpts;
}): Promise<void> {
  const outDir = path.dirname(params.outPath);
  await ensureDir(outDir);

  const nixArgs = [
    "shell",
    "nixpkgs#sops",
    "-c",
    "sops",
    "--config",
    params.sopsConfigPath,
    "encrypt",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
    "--filename-override",
    params.filenameOverride,
  ];
  if (params.nix.dryRun) {
    await run(params.nix.nixBin, [...nixArgs, "--output", params.outPath, "<plaintext>"], params.nix);
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdlets-sops-"));
  try {
    const tmpPlain = path.join(tmpDir, "secrets.yaml");
    const tmpEnc = path.join(tmpDir, "secrets.enc.yaml");
    await writeFileAtomic(
      tmpPlain,
      params.plaintextYaml.endsWith("\n")
        ? params.plaintextYaml
        : `${params.plaintextYaml}\n`,
    );

    await run(params.nix.nixBin, [...nixArgs, "--output", tmpEnc, tmpPlain], params.nix);

    const encrypted = await fs.readFile(tmpEnc, "utf8");
    await writeFileAtomic(params.outPath, encrypted);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
