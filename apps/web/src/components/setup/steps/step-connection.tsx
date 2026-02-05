import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { looksLikeSshPrivateKeyText, looksLikeSshPublicKeyText } from "~/lib/form-utils"
import { singleHostCidrFromIp } from "~/lib/ip-utils"
import { configDotBatch } from "~/sdk/config"

export function SetupStepConnection(props: {
  projectId: Id<"projects">
  config: any | null
  host: string
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const hostCfg = props.config?.hosts?.[props.host] || null

  const [targetHost, setTargetHost] = useState("")
  const [adminCidr, setAdminCidr] = useState("")
  const [sshPubkeyFile, setSshPubkeyFile] = useState("")
  const [sshExposure, setSshExposure] = useState<"tailnet" | "bootstrap" | "public">("bootstrap")

  const [detectingAdminCidr, setDetectingAdminCidr] = useState(false)

  useEffect(() => {
    setTargetHost(String(hostCfg?.targetHost || ""))
    setAdminCidr(String(hostCfg?.provisioning?.adminCidr || ""))
    setSshPubkeyFile(String(hostCfg?.provisioning?.sshPubkeyFile || ""))
    setSshExposure((hostCfg?.sshExposure?.mode as any) || "bootstrap")
  }, [hostCfg, props.host])

  async function detectAdminCidr() {
    setDetectingAdminCidr(true)
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6000)
    try {
      const res = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal })
      if (!res.ok) throw new Error(`ip lookup failed (${res.status})`)
      const json = (await res.json()) as { ip?: unknown }
      const ip = typeof json.ip === "string" ? json.ip : ""
      const cidr = singleHostCidrFromIp(ip)
      setAdminCidr(cidr)
      toast.success(`Admin CIDR set to ${cidr}`)
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "timed out"
          : err instanceof Error
            ? err.message
            : String(err)
      toast.error(`Admin CIDR detect failed: ${msg}`)
    } finally {
      clearTimeout(timeout)
      setDetectingAdminCidr(false)
    }
  }

  const canSave = useMemo(() => {
    if (!props.host.trim()) return false
    if (!targetHost.trim()) return false
    if (!adminCidr.trim()) return false
    if (!sshPubkeyFile.trim()) return false
    return true
  }, [adminCidr, props.host, sshPubkeyFile, targetHost])

  const save = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      const sshTrimmed = sshPubkeyFile.trim()
      if (looksLikeSshPrivateKeyText(sshTrimmed) || looksLikeSshPublicKeyText(sshTrimmed)) {
        throw new Error("SSH pubkey file must be a local file path (not key contents).")
      }
      const ops = [
        { path: `hosts.${props.host}.targetHost`, value: targetHost.trim() },
        { path: `hosts.${props.host}.provisioning.adminCidr`, value: adminCidr.trim() },
        { path: `hosts.${props.host}.provisioning.sshPubkeyFile`, value: sshTrimmed },
        { path: `hosts.${props.host}.sshExposure.mode`, value: sshExposure },
      ]
      return await configDotBatch({ data: { projectId: props.projectId, ops } })
    },
    onSuccess: (res: any) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawletsConfig", props.projectId] })
        props.onContinue()
        return
      }
      const first = Array.isArray(res.issues) ? res.issues[0] : null
      toast.error(first?.message || "Validation failed")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <LabelWithHelp htmlFor="setup-target-host" help={setupFieldHelp.hosts.targetHost}>
            targetHost
          </LabelWithHelp>
          <Input
            id="setup-target-host"
            value={targetHost}
            onChange={(e) => setTargetHost(e.target.value)}
            placeholder="admin@203.0.113.10"
          />
          <div className="text-xs text-muted-foreground">
            SSH destination used by bootstrap and server ops.
          </div>
        </div>

        <div className="space-y-2">
          <LabelWithHelp htmlFor="setup-admin-cidr" help={setupFieldHelp.hosts.adminCidr}>
            provisioning.adminCidr
          </LabelWithHelp>
          <div className="flex items-center gap-2">
            <Input
              id="setup-admin-cidr"
              value={adminCidr}
              onChange={(e) => setAdminCidr(e.target.value)}
              placeholder="203.0.113.10/32"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={detectingAdminCidr}
              onClick={() => void detectAdminCidr()}
            >
              {detectingAdminCidr ? "Detecting…" : "Detect"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Controls which operator IPs are allowed during provisioning.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <LabelWithHelp htmlFor="setup-ssh-exposure" help={setupFieldHelp.hosts.sshExposure}>
            sshExposure.mode
          </LabelWithHelp>
          <NativeSelect
            id="setup-ssh-exposure"
            value={sshExposure}
            onChange={(e) => setSshExposure(e.target.value as any)}
          >
            <NativeSelectOption value="tailnet">tailnet</NativeSelectOption>
            <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
            <NativeSelectOption value="public">public</NativeSelectOption>
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <LabelWithHelp htmlFor="setup-ssh-pubkey-file" help={setupFieldHelp.hosts.sshPubkeyFile}>
            provisioning.sshPubkeyFile
          </LabelWithHelp>
          <Input
            id="setup-ssh-pubkey-file"
            value={sshPubkeyFile}
            onChange={(e) => setSshPubkeyFile(e.target.value)}
            placeholder="~/.ssh/id_ed25519.pub"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => setSshPubkeyFile("~/.ssh/id_ed25519.pub")}
            >
              Use ~/.ssh/id_ed25519.pub
            </Button>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => setSshPubkeyFile("~/.ssh/id_rsa.pub")}
            >
              Use ~/.ssh/id_rsa.pub
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={save.isPending || !canSave} onClick={() => save.mutate()}>
          Save and continue
        </Button>
        {!canSave ? (
          <div className="text-xs text-muted-foreground">
            Fill <code>targetHost</code>, <code>adminCidr</code>, and <code>sshPubkeyFile</code>.
          </div>
        ) : null}
      </div>
    </div>
  )
}

