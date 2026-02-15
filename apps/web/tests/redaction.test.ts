import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { getRepoLayout } from "@clawlets/core/repo-layout"

import { readClawletsEnvTokens, redactLine } from "../src/server/redaction"

const savedClawletsHome = process.env.CLAWLETS_HOME

afterEach(() => {
  if (savedClawletsHome === undefined) delete process.env.CLAWLETS_HOME
  else process.env.CLAWLETS_HOME = savedClawletsHome
})

describe("readClawletsEnvTokens", () => {
  it("extracts unique values from <runtimeDir>/env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawlets-web-redaction-"))
    const home = await mkdtemp(path.join(tmpdir(), "clawlets-web-home-"))
    process.env.CLAWLETS_HOME = home
    const envPath = getRepoLayout(root).envFilePath
    await mkdir(path.dirname(envPath), { recursive: true })
    await writeFile(
      envPath,
      [
        "# comment",
        "",
        "HCLOUD_TOKEN=abc12345",
        "EMPTY=",
        "SPACED =  abc12345  ",
        "SHORT=abc",
      ].join("\n"),
      "utf8",
    )

    const tokens = await readClawletsEnvTokens(root)
    expect(tokens).toEqual(["abc12345", "abc"])
  })

  it("reads tokens only from layout.envFilePath", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawlets-web-redaction-layout-"))
    const home = await mkdtemp(path.join(tmpdir(), "clawlets-web-home-layout-"))
    process.env.CLAWLETS_HOME = home

    await mkdir(path.join(root, ".clawlets"), { recursive: true })
    await writeFile(path.join(root, ".clawlets", "env"), "HCLOUD_TOKEN=repo-local-token\n", "utf8")

    const envPath = getRepoLayout(root).envFilePath
    await mkdir(path.dirname(envPath), { recursive: true })
    await writeFile(envPath, "HCLOUD_TOKEN=layout-token\n", "utf8")

    const tokens = await readClawletsEnvTokens(root)
    expect(tokens).toContain("layout-token")
    expect(tokens).not.toContain("repo-local-token")
  })
})

describe("redactLine", () => {
  it("redacts tokens >= 4 chars", () => {
    expect(redactLine("token abc12345 here", ["abc12345"])).toBe("token <redacted> here")
    expect(redactLine("abc", ["abc"])).toBe("abc")
    expect(redactLine("abc12345 abc12345", ["abc12345"])).toBe("<redacted> <redacted>")
  })

  it("scrubs url credentials", () => {
    const input = "fetch https://user:pass123@github.com/org/repo.git"
    expect(redactLine(input, [])).toBe("fetch https://<redacted>@github.com/org/repo.git")
  })

  it("preserves separators for key-value redaction", () => {
    const input = "token: abc apiKey = xyz password=secret"
    expect(redactLine(input, [])).toBe("token: <redacted> apiKey = <redacted> password=<redacted>")
  })

  it("redacts token-like blobs even with unknown key names", () => {
    const input = "custom=AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789"
    expect(redactLine(input, [])).toBe("custom=<redacted>")
  })
})
