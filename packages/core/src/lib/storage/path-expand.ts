import os from "node:os";
import path from "node:path";
import process from "node:process";

export function expandPath(input: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  const home = process.env.HOME?.trim();
  if (home && (trimmed.startsWith("$HOME/") || trimmed.startsWith("${HOME}/"))) {
    return path.join(home, trimmed.replace(/^\$\{?HOME\}?\//, ""));
  }

  return trimmed;
}

