import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("runner status control manual refresh", () => {
  it("refreshes runner state when the header control is opened and keeps freshness ticking while open", () => {
    const source = readSource("components/layout/runner-status-control.tsx")

    expect(source).toContain("const [statusNowMs, setStatusNowMs] = useState(() => Date.now())")
    expect(source).toContain("const refreshRunnerState = useCallback(async () => {")
    expect(source).toContain("await runnersQuery.refetch()")
    expect(source).toContain("}, [runnersQuery.refetch])")
    expect(source).not.toContain("}, [runnersQuery])")
    expect(source).toContain("if (!open) return")
    expect(source).toContain("setStatusNowMs(Date.now())")
    expect(source).toContain("window.setInterval(() => {")
    expect(source).toContain("onOpenChange={(nextOpen) => {")
    expect(source).toContain("if (nextOpen) {")
    expect(source).toContain("void refreshRunnerState()")
  })
})
