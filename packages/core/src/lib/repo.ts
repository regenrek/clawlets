import fs from "node:fs";
import path from "node:path";

export function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (;;) {
    const flake = path.join(current, "flake.nix");
    const scriptsDir = path.join(current, "scripts");
    if (fs.existsSync(flake) && fs.existsSync(scriptsDir)) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

