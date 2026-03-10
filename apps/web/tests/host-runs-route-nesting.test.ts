import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("host runs route nesting", () => {
  it("renders the runs list and an Outlet for nested run detail routes", () => {
    const source = readFile("routes/$projectSlug/hosts/$host/runs.tsx")

    expect(source).toContain('import { Outlet, createFileRoute } from "@tanstack/react-router"')
    expect(source).toContain("<RunsList projectSlug={projectSlug} projectId={projectId} host={host} />")
    expect(source).toContain("<Outlet />")
  })
})
