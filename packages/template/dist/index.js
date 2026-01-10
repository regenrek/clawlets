import path from "node:path";
import { fileURLToPath } from "node:url";
export function getTemplateDir() {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgRoot = path.resolve(distDir, "..");
    return path.join(pkgRoot, "template");
}
//# sourceMappingURL=index.js.map