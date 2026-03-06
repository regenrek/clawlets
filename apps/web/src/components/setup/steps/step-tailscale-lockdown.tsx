import { useEffect, useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { SetupSaveStateBadge } from "~/components/setup/steps/setup-save-state-badge"
import { Switch } from "~/components/ui/switch"
import { DOCS_TAILSCALE_AUTH_KEY_URL } from "~/lib/docs-links"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type { SetupDraftView } from "~/sdk/setup"

export function SetupStepTailscaleLockdown(props: {
  stepStatus: SetupStepStatus
  setupDraft: SetupDraftView | null
  hasTailscaleAuthKey: boolean
  tailscaleAuthKey: string
  allowTailscaleUdpIngress: boolean
  useTailscaleLockdown: boolean
  onTailscaleAuthKeyChange: (value: string) => void
  onAllowTailscaleUdpIngressChange: (value: boolean) => void
  onUseTailscaleLockdownChange: (value: boolean) => void
}) {
  const [tailscaleUnlocked, setTailscaleUnlocked] = useState(false)

  const hasPendingTailscaleAuthKey = props.tailscaleAuthKey.trim().length > 0
  const tailscaleLocked = props.hasTailscaleAuthKey && !tailscaleUnlocked && !hasPendingTailscaleAuthKey
  const hasTailscaleAuthKeyReady = props.hasTailscaleAuthKey || hasPendingTailscaleAuthKey

  useEffect(() => {
    if (hasPendingTailscaleAuthKey) return
    setTailscaleUnlocked(false)
  }, [hasPendingTailscaleAuthKey, props.hasTailscaleAuthKey, props.useTailscaleLockdown])

  const statusText =
    !props.useTailscaleLockdown
      ? "Disabled. Deploy keeps bootstrap SSH access until you run lockdown manually."
      : hasTailscaleAuthKeyReady
        ? "Ready. Deploy will switch SSH access to tailnet and queue lockdown automatically."
        : "Missing tailscale_auth_key for this host."
  const saveState = props.setupDraft?.status === "failed"
    ? "error"
    : !props.useTailscaleLockdown || hasTailscaleAuthKeyReady
      ? "saved"
      : "not_saved"

  return (
    <SettingsSection
      title="Tailscale lockdown"
      description="Prepare automatic post-bootstrap SSH lockdown via Tailscale."
      headerBadge={<SetupSaveStateBadge state={saveState} />}
      statusText={statusText}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Use tailscale + lockdown (recommended)</div>
            <div className="text-xs text-muted-foreground">
              Deploy sets tailnet mode, then switches SSH exposure to tailnet and runs lockdown.
            </div>
          </div>
          <Switch
            checked={props.useTailscaleLockdown}
            onCheckedChange={props.onUseTailscaleLockdownChange}
          />
        </div>
        {props.useTailscaleLockdown ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Add a host-scoped Tailscale auth key so the machine can join your tailnet during bootstrap.{" "}
              <a
                className="underline underline-offset-4 hover:text-foreground"
                href={DOCS_TAILSCALE_AUTH_KEY_URL}
                target="_blank"
                rel="noreferrer"
              >
                How to create a Tailscale auth key
              </a>
            </div>
            <div className="space-y-2 rounded-md border bg-muted/10 p-3">
              <LabelWithHelp htmlFor="setup-tailscale-auth-key" help={setupFieldHelp.secrets.tailscaleAuthKey}>
                Tailscale auth key
              </LabelWithHelp>
              {tailscaleLocked ? (
                <InputGroup>
                  <InputGroupInput id="setup-tailscale-auth-key" readOnly value="Saved for this host" />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setTailscaleUnlocked(true)
                        props.onTailscaleAuthKeyChange("")
                      }}
                    >
                      Remove
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <InputGroup>
                  <InputGroupInput
                    id="setup-tailscale-auth-key"
                    type="password"
                    value={props.tailscaleAuthKey}
                    onChange={(event) => props.onTailscaleAuthKeyChange(event.target.value)}
                    placeholder={props.hasTailscaleAuthKey ? "Enter new tailscale auth key" : "tskey-auth-..."}
                  />
                  {props.tailscaleAuthKey.trim() ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        variant="outline"
                        onClick={() => props.onTailscaleAuthKeyChange("")}
                      >
                        Remove
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              )}
              <div className="text-xs text-muted-foreground">
                {tailscaleLocked
                  ? "Already saved for this host. Click Remove to rotate."
                  : "Value stays in encrypted setup draft and is written once during install."}
              </div>
            </div>
          </div>
        ) : null}

        <Accordion className="rounded-lg border bg-muted/20">
          <AccordionItem value="advanced" className="px-4">
            <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
              Advanced options
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                <LabelWithHelp
                  htmlFor="setup-tailscale-udp-ingress"
                  help={setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}
                >
                  Allow Tailscale UDP ingress
                </LabelWithHelp>
                <div className="mt-1 flex items-center gap-3">
                  <Switch
                    id="setup-tailscale-udp-ingress"
                    checked={props.allowTailscaleUdpIngress}
                    onCheckedChange={props.onAllowTailscaleUdpIngressChange}
                  />
                  <span className="text-sm text-muted-foreground">
                    Default: enabled. Disable for relay-only mode.
                  </span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </SettingsSection>
  )
}
