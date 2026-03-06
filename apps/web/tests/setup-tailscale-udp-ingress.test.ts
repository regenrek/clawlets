import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup tailscale UDP ingress", () => {
  it("keeps the UDP ingress control in tailscale lockdown, not infrastructure", () => {
    const infra = readFile("components/setup/steps/step-infrastructure.tsx")
    const tailscale = readFile("components/setup/steps/step-tailscale-lockdown.tsx")

    expect(infra).not.toContain("Allow Tailscale UDP ingress")
    expect(tailscale).toContain("Allow Tailscale UDP ingress")
    expect(tailscale).toContain("onAllowTailscaleUdpIngressChange")
    expect(tailscale).toContain("Advanced options")
    expect(tailscale).toContain("TailscaleAuthKeyCard")
    expect(tailscale).not.toContain("setup-tailscale-key-label")
    expect(tailscale).not.toContain("setup-tailscale-key-value")
  })

  it("auto-enables UDP ingress when tailscale lockdown is turned on", () => {
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(setupRoute).toContain("onUseTailscaleLockdownChange={(value) => {")
    expect(setupRoute).toContain("allowTailscaleUdpIngress: true")
  })

  it("merges infrastructure draft updates so cross-step edits do not clobber each other", () => {
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(setupRoute).toContain("const updatePendingInfrastructureDraft = React.useCallback(")
    expect(setupRoute).toContain("setPendingInfrastructureDraft((prev) => {")
    expect(setupRoute).toContain("const merged = {")
    expect(setupRoute).toContain("...(prev ?? {}),")
    expect(setupRoute).toContain("...next,")
  })

  it("uses a modal tailscale key add flow and removes legacy inline key input ids", () => {
    const tailscaleAuthKeyCard = readFile("components/hosts/tailscale-auth-key-card.tsx")

    expect(tailscaleAuthKeyCard).toContain("Dialog")
    expect(tailscaleAuthKeyCard).toContain("DialogContent")
    expect(tailscaleAuthKeyCard).toContain("DialogTitle")
    expect(tailscaleAuthKeyCard).toContain("DialogFooter")
    expect(tailscaleAuthKeyCard).toContain("Add key")
    expect(tailscaleAuthKeyCard).toContain("actionLabel")
    expect(tailscaleAuthKeyCard).toContain("setKeyDialogOpen(true)")
    expect(tailscaleAuthKeyCard).toContain("Close")
    expect(tailscaleAuthKeyCard).not.toContain("setup-tailscale-key-label")
    expect(tailscaleAuthKeyCard).not.toContain("setup-tailscale-key-value")
  })

  it("explains that deploy performs the tailnet switch and lockdown", () => {
    const tailscale = readFile("components/setup/steps/step-tailscale-lockdown.tsx")

    expect(tailscale).toContain("Deploy sets tailnet mode, then switches SSH exposure to tailnet and runs lockdown.")
    expect(tailscale).toContain("Ready. Deploy will switch SSH access to tailnet and queue lockdown automatically.")
  })
})
