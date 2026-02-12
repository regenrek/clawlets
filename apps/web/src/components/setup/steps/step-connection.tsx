import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { AdminCidrField } from "~/components/hosts/admin-cidr-field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { resolveConnectionStepMissingRequirements, shouldShowConnectionSshKeyEditor } from "~/lib/setup/connection-step"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import { setupDraftSaveNonSecret, type SetupDraftView } from "~/sdk/setup"

function parseSshPublicKeysFromText(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (!/^ssh-(ed25519|rsa|ecdsa)/.test(line)) continue
    out.push(line)
  }
  return Array.from(new Set(out))
}

export function SetupStepConnection(props: {
  projectId: Id<"projects">
  config: any | null
  setupDraft: SetupDraftView | null
  host: string
  stepStatus: SetupStepStatus
  onContinue: () => void
}) {
  const hostCfg = props.config?.hosts?.[props.host] || null
  const fleetSshKeys = Array.isArray(props.config?.fleet?.sshAuthorizedKeys)
    ? (props.config?.fleet?.sshAuthorizedKeys as string[])
    : []
  if (!hostCfg) {
    return (
      <div className="text-sm text-muted-foreground">
        Host config not loaded yet. Ensure runner is online, then retry.
      </div>
    )
  }
  return (
    <SetupStepConnectionForm
      key={props.host}
      projectId={props.projectId}
      host={props.host}
      hostCfg={hostCfg}
      fleetSshKeys={fleetSshKeys}
      setupDraft={props.setupDraft}
      stepStatus={props.stepStatus}
      onContinue={props.onContinue}
    />
  )
}

function SetupStepConnectionForm(props: {
  projectId: Id<"projects">
  host: string
  hostCfg: any
  fleetSshKeys: string[]
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const draftConnection = props.setupDraft?.nonSecretDraft?.connection
  const [adminCidr, setAdminCidr] = useState(() => String(draftConnection?.adminCidr || props.hostCfg?.provisioning?.adminCidr || ""))
  const knownSshKeys = Array.from(
    new Set([
      ...props.fleetSshKeys,
      ...(Array.isArray(draftConnection?.sshAuthorizedKeys) ? draftConnection.sshAuthorizedKeys : []),
    ]),
  )
  const hasProjectSshKeys = knownSshKeys.length > 0
  const [showKeyEditor, setShowKeyEditor] = useState(() => !hasProjectSshKeys)
  const [keyText, setKeyText] = useState("")

  const missingRequirements = useMemo(() => {
    return resolveConnectionStepMissingRequirements({
      host: props.host,
      adminCidr,
      hasProjectSshKeys,
      keyText,
    })
  }, [adminCidr, hasProjectSshKeys, keyText, props.host])
  const canSave = missingRequirements.length === 0
  const showSshKeyEditor = shouldShowConnectionSshKeyEditor({
    hasProjectSshKeys,
    showKeyEditor,
    keyText,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      const parsedNewKeys = parseSshPublicKeysFromText(keyText)
      const mergedKeys = Array.from(new Set([...knownSshKeys, ...parsedNewKeys]))
      if (mergedKeys.length === 0) {
        throw new Error("Add at least one SSH public key to continue.")
      }
      const existingMode = String(
        draftConnection?.sshExposureMode
        || props.hostCfg?.sshExposure?.mode
        || "bootstrap",
      ).trim() || "bootstrap"
      return await setupDraftSaveNonSecret({
        data: {
          projectId: props.projectId,
          host: props.host,
          expectedVersion: props.setupDraft?.version,
          patch: {
            connection: {
              adminCidr: adminCidr.trim(),
              sshExposureMode: props.stepStatus === "done"
                ? (existingMode as "bootstrap" | "tailnet" | "public")
                : "bootstrap",
              sshKeyCount: mergedKeys.length,
              sshAuthorizedKeys: mergedKeys,
            },
          },
        },
      })
    },
    onSuccess: async () => {
      toast.success("Draft saved")
      setKeyText("")
      setShowKeyEditor(false)
      await queryClient.invalidateQueries({
        queryKey: ["setupDraft", props.projectId, props.host],
      })
      props.onContinue()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <SettingsSection
      title="Server access"
      description="Network and SSH settings required for bootstrap."
      statusText={!canSave ? `Missing: ${missingRequirements.join(", ")}.` : undefined}
      actions={(
        <AsyncButton
          type="button"
          disabled={save.isPending || !canSave}
          pending={save.isPending}
          pendingText="Saving..."
          onClick={() => save.mutate()}
        >
          Save and continue
        </AsyncButton>
      )}
    >
      <div className="space-y-4">
        <AdminCidrField
          id="setup-admin-cidr"
          label="Allowed admin IP (CIDR)"
          help={setupFieldHelp.hosts.adminCidr}
          value={adminCidr}
          onValueChange={setAdminCidr}
          autoDetectIfEmpty
          description="Who can SSH during bootstrap/provisioning (usually your current IP with /32)."
        />

        <div className="space-y-2">
          <LabelWithHelp htmlFor="setup-ssh-key-text" help={setupFieldHelp.hosts.sshKeyPaste}>
            SSH public key {hasProjectSshKeys ? "(optional)" : "(required)"}
          </LabelWithHelp>
          {hasProjectSshKeys && !showSshKeyEditor ? (
            <>
              <InputGroup>
                <InputGroupInput
                  id="setup-ssh-key-text"
                  readOnly
                  value={`${knownSshKeys.length} project SSH key${knownSshKeys.length === 1 ? "" : "s"} configured`}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowKeyEditor(true)}
                  >
                    Add key
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <div className="text-xs text-muted-foreground">
                Existing keys satisfy this step. Continue without pasting a new key.
              </div>
            </>
          ) : (
            <>
              <Textarea
                id="setup-ssh-key-text"
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                className="font-mono min-h-[90px]"
                placeholder="ssh-ed25519 AAAA... user@host"
              />

              {hasProjectSshKeys ? (
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Already configured: <strong>{knownSshKeys.length}</strong> project SSH key(s).
                    {Array.isArray(draftConnection?.sshAuthorizedKeys) && draftConnection.sshAuthorizedKeys.length > props.fleetSshKeys.length
                      ? " (includes pending draft updates)"
                      : null}
                    {keyText.trim() ? " Pasted keys will be added too." : null}
                  </span>
                  {showKeyEditor ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setKeyText("")
                        setShowKeyEditor(false)
                      }}
                    >
                      Done editing
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  If you don’t have one yet, generate it with{" "}
                  <a
                    className="underline underline-offset-3 hover:text-foreground"
                    href="https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub’s guide
                  </a>
                  .
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}
