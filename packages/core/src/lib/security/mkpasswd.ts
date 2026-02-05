import { nixShellCaptureWithInput, type NixToolOpts } from "../nix/nix-tools.js";

export async function mkpasswdYescryptHash(
  password: string,
  opts: NixToolOpts,
): Promise<string> {
  if (opts.dryRun) return "<admin_password_hash>";
  const out = await nixShellCaptureWithInput(
    "mkpasswd",
    "mkpasswd",
    ["-m", "yescrypt", "--stdin"],
    `${password}\n`,
    {
      ...opts,
      redact: [...(opts.redact ?? []), password],
    },
  );
  const hash = out
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("$y$"));
  if (!hash) throw new Error("mkpasswd returned no yescrypt hash");
  return hash;
}
