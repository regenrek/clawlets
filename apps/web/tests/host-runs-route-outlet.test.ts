import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8")
}

describe("host runs route", () => {
  it("renders an outlet for nested run detail routes", () => {
    const source = readFile("routes/$projectSlug/hosts/$host/runs.tsx")
    expect(source).toContain("import { Outlet, createFileRoute }")
    expect(source).toContain("<Outlet />")
  })
})
