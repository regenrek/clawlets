#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function die(msg) {
  console.error(`extract-changelog: ${msg}`);
  process.exit(1);
}

function main() {
  const versionArg = (process.argv[2] || "").trim();
  if (!versionArg) die("missing version (expected X.Y.Z)");
  const version = versionArg.startsWith("v") ? versionArg.slice(1) : versionArg;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$/.test(version)) die(`invalid version: ${versionArg}`);

  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) die("missing CHANGELOG.md");

  const text = fs.readFileSync(changelogPath, "utf8");
  const lines = text.split("\n");
  const header = `## [${version}]`;

  const startIdx = lines.findIndex((l) => l.startsWith(header));
  if (startIdx < 0) die(`missing CHANGELOG section: ${header}`);

  const out = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    if (i !== startIdx && line.startsWith("## [")) break;
    out.push(line);
  }

  process.stdout.write(out.join("\n").trimEnd() + "\n");
}

main();
