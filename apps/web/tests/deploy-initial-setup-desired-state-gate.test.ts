import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup deploy gating uses canonical desired-state resolver", () => {
  it("removes legacy fleet-only SSH gate and setup-mode deploy-creds runner query", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")
    const state = readFile("components/deploy/deploy-initial-setup-state.ts")
    expect(source).toContain("deriveEffectiveSetupDesiredState")
    expect(source).toContain("deriveInfrastructureGate")
    expect(source).toContain("setPredeployCheck(\"infrastructure\", \"failed\"")
    expect(source).toContain("desired.connection.sshAuthorizedKeys")
    expect(source).not.toContain("deriveDeploySshKeyReadiness")
    expect(source).not.toContain("getDeployCredsStatus")
    expect(state).toContain("Infrastructure not created yet. Run predeploy, then deploy to create it.")
  })
})
