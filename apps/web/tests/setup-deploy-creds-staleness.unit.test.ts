import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup deploy creds source", () => {
  it("keeps setup reads on runner metadata summary and setup draft status", () => {
    const source = readFile("lib/setup/use-setup-model.ts")
    expect(source).toContain("setupDraftDeployCredsSet")
    expect(source).toContain("deployCredsSummary")
    expect(source).not.toContain("getDeployCredsStatus")
    expect(source).not.toContain("deployCredsFallback")
  })
})
