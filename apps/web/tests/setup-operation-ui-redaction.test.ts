import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup operation UI redaction", () => {
  it("renders only safe step messages for setup apply diagnostics", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(source).toContain("Setup apply operation")
    expect(source).toContain("{step.safeMessage}")
    expect(source).not.toContain("{step.detailJson}")
    expect(source).not.toContain("{setupOperationQuery.data.summaryJson}")
    expect(source).not.toContain("sealedPlanB64")
  })
})
