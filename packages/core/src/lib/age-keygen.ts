import { parseAgeKeygenOutput, type AgeKeypair } from "./age.js";
import { nixShellCapture, type NixToolOpts } from "./nix-tools.js";

export async function ageKeygen(opts: NixToolOpts): Promise<AgeKeypair> {
  if (opts.dryRun) {
    const publicKey =
      "age1dryrundryrundryrundryrundryrundryrundryrundryrundryrun0l9p4";
    const secretKey =
      "AGE-SECRET-KEY-DRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUN";
    const fileText = `# created: dry-run\n# public key: ${publicKey}\n${secretKey}\n`;
    return { publicKey, secretKey, fileText };
  }
  const out = await nixShellCapture("age", "age-keygen", [], opts);
  return parseAgeKeygenOutput(out);
}
