import path from "node:path";
import { tmpdir } from "node:os";

process.env.CLAWLETS_HOME = path.join(tmpdir(), "clawlets-cli-tests-home");
