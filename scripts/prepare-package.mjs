#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function die(msg) {
  console.error(`prepare-package: ${msg}`);
  process.exit(1);
}

function rmForce(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function cpDir(src, dest) {
  rmForce(dest);
  fs.cpSync(src, dest, { recursive: true });
}

function cpFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function removeTsBuildInfoFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      removeTsBuildInfoFiles(p);
      continue;
    }
    if (e.isFile() && e.name.endsWith(".tsbuildinfo")) rmForce(p);
  }
}

function removeSourceMaps(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      removeSourceMaps(p);
      continue;
    }
    if (e.isFile() && e.name.endsWith(".map")) rmForce(p);
  }
}

function resolveRepoSlugFromPackageJson(pkg) {
  const url = pkg?.repository?.url;
  if (!url) return "";
  const m = String(url).match(/github\.com\/(.+?)\.git$/);
  return m ? m[1] : "";
}

function rewriteReadmeForNpm(readme, repoSlug) {
  if (!repoSlug) return readme;
  return readme.replace(/\]\(\.\/public\//g, `](https://raw.githubusercontent.com/${repoSlug}/main/public/`);
}

function isWorkspaceProtocol(v) {
  return String(v || "").startsWith("workspace:");
}

function rewriteWorkspaceDepsToVersions(pkg, workspacePkgs) {
  const next = { ...pkg };
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

  for (const section of sections) {
    const deps = { ...(next[section] || {}) };
    let changed = false;
    for (const [depName, depVersion] of Object.entries(deps)) {
      if (!isWorkspaceProtocol(depVersion)) continue;
      const info = workspacePkgs.get(depName);
      if (!info) die(`workspace dependency not found: ${String(pkg.name)} -> ${depName}`);
      const resolved = String(info.pkg?.version || "").trim();
      if (!resolved) die(`workspace dependency missing version: ${depName}`);

      // Keep the common workspace protocol semantics while producing an npm-installable spec.
      const spec = String(depVersion || "");
      if (spec === "workspace:^") deps[depName] = `^${resolved}`;
      else if (spec === "workspace:~") deps[depName] = `~${resolved}`;
      else deps[depName] = resolved;
      changed = true;
    }
    if (changed) next[section] = deps;
  }

  return next;
}

function collectWorkspacePackages(root) {
  const out = new Map();
  const ignore = new Set(["node_modules", "dist", "coverage", ".git", ".turbo"]);
  const rootDir = path.join(root, "packages");
  if (!fs.existsSync(rootDir)) return out;

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ignore.has(ent.name)) continue;
      const next = path.join(dir, ent.name);
      const pkgPath = path.join(next, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = readJson(pkgPath);
        const name = String(pkg.name || "").trim();
        if (name) out.set(name, { dir: next, pkg });
      }
      walk(next);
    }
  };

  walk(rootDir);
  return out;
}

function resolveDefaultOutDir(pkgDir, pkg) {
  const defaultCliDir = path.join(repoRoot, "packages", "cli");
  if (pkgDir === defaultCliDir) return path.join(repoRoot, "dist", "npm", "clawdlets");
  const name = String(pkg?.name || "").trim();
  const safe = name ? name.replace(/\//g, "-") : "package";
  return path.join(repoRoot, "dist", "npm", safe);
}

function isPathWithin(baseDir, candidate) {
  const rel = path.relative(baseDir, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function main() {
  const args = process.argv.slice(2);
  let outDir = "";
  let pkgDir = path.join(repoRoot, "packages", "cli");
  let allowUnsafeOut = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--out") {
      const v = args[i + 1];
      if (!v) die("missing value for --out");
      outDir = path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
      i += 1;
      continue;
    }
    if (a === "--pkg") {
      const v = args[i + 1];
      if (!v) die("missing value for --pkg");
      pkgDir = path.isAbsolute(v) ? v : path.resolve(repoRoot, v);
      i += 1;
      continue;
    }
    if (a === "--allow-unsafe-out") {
      allowUnsafeOut = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      console.log("Usage: node scripts/prepare-package.mjs [--pkg <dir>] [--out <dir>] [--allow-unsafe-out]");
      process.exit(0);
    }
    die(`unknown arg: ${a}`);
  }

  const pkgPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgPath)) die(`missing package.json at ${pkgPath}`);

  const pkg = readJson(pkgPath);
  const pkgVersion = String(pkg?.version || "").trim();
  if (!pkgVersion) die("package.json missing version");

  if (!outDir) outDir = resolveDefaultOutDir(pkgDir, pkg);
  const distRoot = path.join(repoRoot, "dist");
  if (!allowUnsafeOut && !isPathWithin(distRoot, outDir)) {
    die(`--out must be under ${distRoot} (pass --allow-unsafe-out to override)`);
  }

  const distDir = path.join(pkgDir, "dist");
  if (!fs.existsSync(distDir)) die(`missing dist/ (run build): ${distDir}`);

  const workspacePkgs = collectWorkspacePackages(repoRoot);

  const outPkgDir = outDir;
  rmForce(outPkgDir);
  ensureDir(outPkgDir);

  // Copy build output.
  cpDir(distDir, path.join(outPkgDir, "dist"));
  removeTsBuildInfoFiles(path.join(outPkgDir, "dist"));
  removeSourceMaps(path.join(outPkgDir, "dist"));

  // README + LICENSE for npm page.
  const repoPkg = readJson(path.join(repoRoot, "package.json"));
  const repoSlug = resolveRepoSlugFromPackageJson(pkg) || resolveRepoSlugFromPackageJson(repoPkg);
  const readmeCandidates = [path.join(pkgDir, "README.md"), path.join(repoRoot, "README.md")];
  for (const readmeSrc of readmeCandidates) {
    if (!fs.existsSync(readmeSrc)) continue;
    const readme = fs.readFileSync(readmeSrc, "utf8");
    fs.writeFileSync(path.join(outPkgDir, "README.md"), rewriteReadmeForNpm(readme, repoSlug));
    break;
  }
  const licenseSrc = path.join(repoRoot, "LICENSE");
  if (fs.existsSync(licenseSrc)) cpFile(licenseSrc, path.join(outPkgDir, "LICENSE"));

  // Publishable package.json (no workspace: protocol).
  const nextPkg = rewriteWorkspaceDepsToVersions(pkg, workspacePkgs);
  nextPkg.private = false;
  nextPkg.publishConfig = { ...(nextPkg.publishConfig || {}), access: "public" };
  nextPkg.files = Array.from(
    new Set(["dist", "README.md", "LICENSE", ...(Array.isArray(nextPkg.files) ? nextPkg.files : [])]),
  ).filter((x) => x !== "node_modules");

  delete nextPkg.bundledDependencies;
  delete nextPkg.bundleDependencies;

  // Guard: output manifest must be installable from npm across package managers (npm/pnpm/yarn).
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = nextPkg[section] || {};
    for (const [k, v] of Object.entries(deps)) {
      const spec = String(v || "");
      if (spec.startsWith("workspace:")) die(`output package.json still contains workspace protocol: ${section}.${k}=${v}`);
      if (spec.startsWith("file:") || spec.startsWith("link:")) {
        die(`output package.json contains unsupported local protocol: ${section}.${k}=${v}`);
      }
    }
  }

  writeJson(path.join(outPkgDir, "package.json"), nextPkg);

  console.log(`Prepared npm package dir: ${outPkgDir}`);
}

main();
