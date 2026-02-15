import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.join(here, ".template");
const clawletsHome = path.join(tmpdir(), "clawlets-core-tests-home");

if (!process.env.CLAWLETS_TEMPLATE_DIR) {
  process.env.CLAWLETS_TEMPLATE_DIR = templateRoot;
}

process.env.CLAWLETS_HOME = clawletsHome;
