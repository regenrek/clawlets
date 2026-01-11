import path from "node:path";
import { fileURLToPath } from "node:url";
export function getTemplateDir() {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    return path.join(distDir, "template");
}
//# sourceMappingURL=index.js.map