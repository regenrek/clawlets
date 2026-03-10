import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup connection save state", () => {
  it("does not mark server access as saved when required inputs are still missing", () => {
    const source = readFile("components/setup/steps/step-connection.tsx")

    expect(source).toContain('if (selectedKeys.length === 0) return "not_saved" as const')
    expect(source).toContain('if (!adminCidr.trim() && !props.adminCidrDetecting) return "not_saved" as const')
    expect(source).toContain('if (adminPasswordRequired && !props.adminPassword.trim()) return "not_saved" as const')
  })
})
