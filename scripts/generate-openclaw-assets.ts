import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type ProviderInfo = {
  auth: "apiKey" | "oauth" | "mixed";
  credentials: Array<{ id: string; anyOfEnv: string[] }>;
  aliases?: string[];
};

type OpenclawSchemaArtifact = {
  schema?: unknown;
  uiHints?: unknown;
  version?: unknown;
  openclawRev?: unknown;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const argValue = (flag: string): string | null => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1] ?? null;
};

const readText = (p: string): string => fs.readFileSync(p, "utf8");
const readJson = <T = unknown>(p: string): T => JSON.parse(readText(p)) as T;

const parseEnvMap = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const block = text.split("export function resolveEnvApiKey")[1]?.split("export function resolveModelAuthMode")[0] ?? "";
  const ifRegex = /if\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = ifRegex.exec(block))) {
    const condition = match[1] ?? "";
    const body = match[2] ?? "";
    const envs = Array.from(body.matchAll(/pick\("([^"]+)"\)/g)).map((m) => String(m[1] || "").trim()).filter(Boolean);
    const providers = Array.from(condition.matchAll(/(?:provider|normalized)\s*===\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
    if (providers.length === 0 || envs.length === 0) continue;
    for (const provider of providers) {
      out[provider] = Array.from(new Set([...(out[provider] ?? []), ...envs]));
    }
  }

  const envMapMatch = block.match(/const\s+envMap:[^{]*\{([\s\S]*?)\};/);
  if (envMapMatch) {
    const envMapBody = envMapMatch[1] ?? "";
    const entryRegex = /["']?([A-Za-z0-9-_]+)["']?\s*:\s*"([^"]+)"/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRegex.exec(envMapBody))) {
      const provider = entry[1] ?? "";
      const envVar = entry[2] ?? "";
      if (!provider || !envVar) continue;
      out[provider] = Array.from(new Set([...(out[provider] ?? []), envVar]));
    }
  }
  return out;
};

const readOAuthProviders = async (src: string): Promise<string[]> => {
  try {
    const oauthModuleUrl = pathToFileURL(
      path.join(src, "node_modules", "@mariozechner", "pi-ai", "dist", "utils", "oauth", "index.js"),
    ).href;
    const mod = await import(oauthModuleUrl);
    const raw = typeof mod.getOAuthProviders === "function" ? mod.getOAuthProviders() : [];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object" && "id" in entry) {
          return String((entry as { id?: unknown }).id || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const parseProviderAliases = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const block = text.split("export function normalizeProviderId")[1] ?? "";
  const ifRegex = /if\s*\(([^)]*normalized[^)]*)\)\s*return\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = ifRegex.exec(block))) {
    const condition = match[1] ?? "";
    const canonical = match[2] ?? "";
    if (!canonical) continue;
    const aliases = Array.from(condition.matchAll(/normalized\s*===\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
    if (aliases.length === 0) continue;
    out[canonical] = Array.from(new Set([...(out[canonical] ?? []), ...aliases]));
  }
  return out;
};

const parseEnvAliases = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const assignRegex = /process\.env\.([A-Z0-9_]+)\s*=\s*process\.env\.([A-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = assignRegex.exec(text))) {
    const canonical = match[1] ?? "";
    const alias = match[2] ?? "";
    if (!canonical || !alias || canonical === alias) continue;
    out[canonical] = Array.from(new Set([...(out[canonical] ?? []), alias]));
  }
  return out;
};

const buildProviderInfo = (params: {
  envMap: Record<string, string[]>;
  oauthProviders: string[];
  aliases: Record<string, string[]>;
}): Record<string, ProviderInfo> => {
  const providers = new Set<string>([
    ...Object.keys(params.envMap),
    ...params.oauthProviders,
    ...Object.keys(params.aliases),
  ]);
  const out: Record<string, ProviderInfo> = {};

  for (const provider of Array.from(providers).sort()) {
    const envVars = (params.envMap[provider] ?? []).slice().sort();
    const oauthVars = envVars.filter((v) => v.includes("OAUTH_TOKEN"));
    const apiVars = envVars.filter((v) => !v.includes("OAUTH_TOKEN"));

    let auth: ProviderInfo["auth"] = "apiKey";
    if (oauthVars.length > 0 && apiVars.length > 0) auth = "mixed";
    else if (oauthVars.length > 0 && apiVars.length === 0) auth = "oauth";
    else if (params.oauthProviders.includes(provider)) auth = envVars.length > 0 ? "mixed" : "oauth";

    const credentials: ProviderInfo["credentials"] = [];
    if (apiVars.length > 0) credentials.push({ id: "api_key", anyOfEnv: apiVars });
    if (oauthVars.length > 0) credentials.push({ id: "oauth_token", anyOfEnv: oauthVars });

    const info: ProviderInfo = { auth, credentials };
    const aliases = params.aliases[provider];
    if (aliases && aliases.length > 0) info.aliases = aliases;
    out[provider] = info;
  }

  return out;
};

const writeJson = (outPath: string, payload: unknown) => {
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const ensureDir = (p: string) => fs.mkdirSync(p, { recursive: true });

const ensureOpenclawDeps = (src: string) => {
  const zodPkg = path.join(src, "node_modules", "zod", "package.json");
  if (!fs.existsSync(zodPkg)) {
    console.error(`error: missing openclaw dependencies in ${src}`);
    console.error("hint: run `pnpm install --frozen-lockfile --ignore-scripts` in the openclaw source first");
    process.exit(1);
  }
};

function isValidSchemaArtifact(input: OpenclawSchemaArtifact): boolean {
  return Boolean(
    input &&
      typeof input === "object" &&
      input.schema &&
      typeof input.schema === "object" &&
      input.uiHints &&
      typeof input.uiHints === "object" &&
      typeof input.version === "string" &&
      input.version.trim() &&
      typeof input.openclawRev === "string" &&
      input.openclawRev.trim(),
  );
}

function syncSchemaAsset(params: { schemaSource: string; schemaOut: string }): void {
  if (!fs.existsSync(params.schemaSource)) {
    console.error(`error: missing pinned openclaw schema: ${params.schemaSource}`);
    console.error("hint: run `nix run .#update-openclaw-schema` first");
    process.exit(1);
  }
  const schemaArtifact = readJson<OpenclawSchemaArtifact>(params.schemaSource);
  if (!isValidSchemaArtifact(schemaArtifact)) {
    console.error(`error: invalid pinned openclaw schema payload: ${params.schemaSource}`);
    process.exit(1);
  }
  writeJson(params.schemaOut, schemaArtifact);
}

const main = async () => {
  const src = argValue("--src") ?? process.env.OPENCLAW_SRC;
  const schemaSource =
    argValue("--schema-source") ??
    path.join(repoRoot, "packages", "core", "src", "generated", "openclaw-config.schema.json");
  const schemaOut =
    argValue("--schema-out") ?? path.join(repoRoot, "packages", "core", "src", "assets", "openclaw-config.schema.json");
  const providersOut =
    argValue("--providers-out") ??
    path.join(repoRoot, "packages", "core", "src", "assets", "llm-providers.json");

  ensureDir(path.dirname(schemaOut));
  ensureDir(path.dirname(providersOut));

  syncSchemaAsset({
    schemaSource: path.resolve(schemaSource),
    schemaOut: path.resolve(schemaOut),
  });

  if (!src) {
    console.error("error: missing --src <openclaw repo path> (or set OPENCLAW_SRC)");
    process.exit(1);
  }

  const sourceDir = path.resolve(src);
  ensureOpenclawDeps(sourceDir);

  const modelAuthText = readText(path.join(sourceDir, "src", "agents", "model-auth.ts"));
  const modelSelectionText = readText(path.join(sourceDir, "src", "agents", "model-selection.ts"));
  const envText = readText(path.join(sourceDir, "src", "infra", "env.ts"));
  const envMap = parseEnvMap(modelAuthText);
  const aliases = parseProviderAliases(modelSelectionText);
  const envAliases = parseEnvAliases(envText);
  for (const [provider, envs] of Object.entries(envMap)) {
    const expanded = new Set(envs);
    for (const envVar of envs) {
      const more = envAliases[envVar];
      if (!more) continue;
      for (const alias of more) expanded.add(alias);
    }
    envMap[provider] = Array.from(expanded);
  }

  const oauthProviders = await readOAuthProviders(sourceDir);
  if (oauthProviders.length === 0) {
    console.error("error: failed to resolve OAuth providers (pi-ai utils/oauth)");
    process.exit(1);
  }

  const providerInfo = buildProviderInfo({ envMap, aliases, oauthProviders });
  writeJson(path.resolve(providersOut), providerInfo);

  console.log(`ok: wrote ${path.relative(repoRoot, path.resolve(schemaOut))}`);
  console.log(`ok: wrote ${path.relative(repoRoot, path.resolve(providersOut))}`);
};

main().catch((err) => {
  console.error(`error: ${String((err as Error)?.message || err)}`);
  process.exit(1);
});
