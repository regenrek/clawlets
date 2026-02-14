import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("runner setup open action", () => {
  it("uses runner dialog event from offline banner instead of self-link anchor", () => {
    const source = readSource("components/fleet/runner-status-banner.tsx")
    expect(source).toContain("requestOpenRunnerStatusDialog")
    expect(source).toContain("onClick={() => requestOpenRunnerStatusDialog({ fallbackHref: props.setupHref })}")
    expect(source).not.toContain("render={<a href={props.setupHref}>Open setup</a>}")
  })

  it("listens for runner dialog open event in header control", () => {
    const source = readSource("components/layout/runner-status-control.tsx")
    expect(source).toContain("OPEN_RUNNER_STATUS_DIALOG_EVENT")
    expect(source).toContain("window.addEventListener(OPEN_RUNNER_STATUS_DIALOG_EVENT, onOpenRunnerDialog)")
    expect(source).toContain("setOpen(true)")
  })
})
