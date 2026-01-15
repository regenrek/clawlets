import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function resolveTemplateTestDir(params: { repoRoot: string; destRoot: string }): string {
  const repoReal = fs.realpathSync(params.repoRoot);
  const expected = path.join(repoReal, "packages", "core", "tests", ".template");
  const destAbs = path.resolve(params.destRoot);

  const root = path.parse(destAbs).root;
  if (destAbs === root) throw new Error("template test dir cannot be filesystem root");
  if (destAbs === repoReal) throw new Error("template test dir cannot be repo root");
  if (destAbs === os.homedir()) throw new Error("template test dir cannot be $HOME");

  const suffix = path.join("packages", "core", "tests", ".template");
  if (!destAbs.endsWith(path.sep + suffix) && destAbs !== expected) {
    throw new Error(`template test dir must end with ${suffix}`);
  }

  const parent = path.dirname(destAbs);
  const parentReal = fs.realpathSync(parent);
  const resolved = path.join(parentReal, path.basename(destAbs));

  if (resolved !== expected) {
    throw new Error(`template test dir must resolve to ${expected}`);
  }

  return resolved;
}
