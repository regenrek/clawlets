import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup plan preview", () => {
  it("uses the core setup plan builder for predeploy preview", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(source).toContain('import { buildSetupApplyPlan } from "@clawlets/core/lib/setup/plan"')
    expect(source).toContain("const setupApplyPlanPreview = useMemo(() => {")
    expect(source).toContain("buildSetupApplyPlan({")
    expect(source).toContain("Setup apply preview")
    expect(source).toContain("setupApplyPlanPreview.configMutations.length")
  })
})
