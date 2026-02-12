import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { HostSetupContextCard } from "~/components/setup/host-setup-context-card"

describe("HostSetupContextCard", () => {
  it("renders first host onboarding copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(HostSetupContextCard, {
        mode: "first_host",
        hostName: "openclaw-fleet-host",
      }),
    )
    expect(html).toContain("Set up your first host")
    expect(html).toContain("Runner setup is complete")
    expect(html).toContain("Host:")
    expect(html).toContain("openclaw-fleet-host")
  })

  it("renders generic host setup copy for non-first-host flows", () => {
    const html = renderToStaticMarkup(
      React.createElement(HostSetupContextCard, {
        mode: "host_setup",
        hostName: "edge-2",
      }),
    )
    expect(html).toContain("Set up host")
    expect(html).toContain("Complete setup for this host")
    expect(html).toContain("edge-2")
  })
})
