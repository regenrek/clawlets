import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup operation retry cta", () => {
  it("shows an explicit retry setup apply action for retryable operation failures", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(source).toContain("const hasRetryableSetupOperationFailure")
    expect(source).toContain('step.status === "failed" && step.retryable')
    expect(source).toContain('pendingText={hasRetryableSetupOperationFailure ? "Retrying..." : "Checking..."}')
    expect(source).toContain('{hasRetryableSetupOperationFailure ? "Retry setup apply" : "Run predeploy"}')
  })
})
