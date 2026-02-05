import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "config", "workspace-boundaries.json");

const configRaw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(configRaw);
const rules = config.packages ?? {};

const workspaceRoots = ["packages", "apps"];
const ignoreDirs = new Set(["node_modules", "dist", "coverage", ".git"]);

const packageFiles = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.isFile() && entry.name === "package.json") {
      packageFiles.push(full);
    }
  }
}

for (const rootDir of workspaceRoots) {
  const full = path.join(root, rootDir);
  if (fs.existsSync(full)) {
    walk(full);
  }
}

const workspace = new Map();
for (const file of packageFiles) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!json.name) continue;
  if (workspace.has(json.name)) {
    throw new Error(`duplicate package name ${json.name} in ${file}`);
  }
  workspace.set(json.name, { file, json });
}

const workspaceNames = new Set(workspace.keys());
const ruleNames = new Set(Object.keys(rules));

const missingRules = [];
const orphanRules = [];
const invalidAllows = [];
const violations = [];

for (const name of workspaceNames) {
  if (!rules[name]) {
    missingRules.push(name);
  }
}

for (const name of ruleNames) {
  if (!workspaceNames.has(name)) {
    orphanRules.push(name);
  }
}

function collectWorkspaceDeps(pkgJson) {
  const deps = new Set();
  const blocks = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies"
  ];
  for (const block of blocks) {
    const entries = Object.keys(pkgJson[block] ?? {});
    for (const dep of entries) {
      if (workspaceNames.has(dep)) {
        deps.add(dep);
      }
    }
  }
  return deps;
}

for (const [name, { json }] of workspace.entries()) {
  const rule = rules[name];
  if (!rule) continue;
  const allowed = new Set(rule.allow ?? []);
  for (const allowedName of allowed) {
    if (!workspaceNames.has(allowedName)) {
      invalidAllows.push(`${name} -> ${allowedName}`);
    }
  }
  const deps = collectWorkspaceDeps(json);
  for (const dep of deps) {
    if (!allowed.has(dep)) {
      violations.push(`${name} depends on ${dep}`);
    }
  }
}

const errors = [];
if (missingRules.length) {
  errors.push(`Missing boundary rules: ${missingRules.join(", ")}`);
}
if (orphanRules.length) {
  errors.push(`Rules reference missing packages: ${orphanRules.join(", ")}`);
}
if (invalidAllows.length) {
  errors.push(`Rules allow unknown packages: ${invalidAllows.join(", ")}`);
}
if (violations.length) {
  errors.push(`Workspace boundary violations:\n- ${violations.join("\n- ")}`);
}

if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}

console.log("workspace boundaries ok");
