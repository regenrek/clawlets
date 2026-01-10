export type AgeKeypair = {
  publicKey: string;
  secretKey: string;
  fileText: string;
};

export function parseAgeKeyFile(text: string): Partial<AgeKeypair> {
  const pub = text.match(/^\s*#\s*public key:\s*(age1[0-9a-z]+)\s*$/m)?.[1];
  const secret = text.match(/^\s*(AGE-SECRET-KEY-[0-9A-Z]+)\s*$/m)?.[1];
  return {
    publicKey: pub,
    secretKey: secret,
    fileText: text,
  };
}

export function parseAgeKeygenOutput(text: string): AgeKeypair {
  const parsed = parseAgeKeyFile(text);
  if (!parsed.publicKey || !parsed.secretKey) {
    throw new Error("failed to parse age-keygen output (missing public/secret key)");
  }
  return {
    publicKey: parsed.publicKey,
    secretKey: parsed.secretKey,
    fileText: text.trimEnd() + "\n",
  };
}

