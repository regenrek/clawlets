import { afterEach, describe, expect, it, vi } from "vitest"
import { generateProjectName, PROJECT_NAME_ADJECTIVES, PROJECT_NAME_DBZ_TERMS } from "../src/lib/project-name-generator"

describe("project name generator", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("generates lowercase adjective-dbz slugs", () => {
    for (let i = 0; i < 50; i += 1) {
      const generated = generateProjectName()
      expect(generated).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
      const [adjective, dbzTerm] = generated.split("-")
      expect(PROJECT_NAME_ADJECTIVES.includes(adjective as (typeof PROJECT_NAME_ADJECTIVES)[number])).toBe(true)
      expect(PROJECT_NAME_DBZ_TERMS.includes(dbzTerm as (typeof PROJECT_NAME_DBZ_TERMS)[number])).toBe(true)
    }
  })

  it("falls back to Math.random when crypto api is unavailable", () => {
    vi.stubGlobal("crypto", undefined)
    const randomSpy = vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)

    const generated = generateProjectName()

    expect(generated).toBe(`${PROJECT_NAME_ADJECTIVES[0]}-${PROJECT_NAME_DBZ_TERMS[0]}`)
    expect(randomSpy).toHaveBeenCalledTimes(2)
  })
})
