import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import { isPlainObject } from "./bot-integrations-helpers"

export function HooksConfigCard(props: {
  botId: string
  hooks: unknown
  canEdit: boolean
  pending: boolean
  initialTokenSecret: string
  initialGmailPushTokenSecret: string
  onToggleEnabled: (enabled: boolean) => void
  onSaveTokenSecret: (value: string) => void
  onSaveGmailPushTokenSecret: (value: string) => void
}) {
  const hooksObj = isPlainObject(props.hooks) ? (props.hooks as Record<string, unknown>) : {}
  const hooksEnabled = hooksObj["enabled"] === true

  const [tokenSecretText, setTokenSecretText] = useState(() => props.initialTokenSecret)
  const [gmailPushTokenSecretText, setGmailPushTokenSecretText] = useState(() => props.initialGmailPushTokenSecret)

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">Hooks config (first-class)</div>
        <div className="text-xs text-muted-foreground">
          Stored as <code>fleet.bots.{props.botId}.hooks</code>.
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Enabled</div>
          <Switch
            checked={hooksEnabled}
            disabled={!props.canEdit || props.pending}
            onCheckedChange={(checked) => props.onToggleEnabled(checked)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">tokenSecret (sops secret name)</div>
            <Input
              value={tokenSecretText}
              disabled={!props.canEdit || props.pending}
              onChange={(e) => setTokenSecretText(e.target.value)}
              placeholder="hooks_token"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canEdit || props.pending}
              onClick={() => props.onSaveTokenSecret(tokenSecretText)}
            >
              Save tokenSecret
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">gmailPushTokenSecret (sops secret name)</div>
            <Input
              value={gmailPushTokenSecretText}
              disabled={!props.canEdit || props.pending}
              onChange={(e) => setGmailPushTokenSecretText(e.target.value)}
              placeholder="hooks_gmail_push_token"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canEdit || props.pending}
              onClick={() => props.onSaveGmailPushTokenSecret(gmailPushTokenSecretText)}
            >
              Save gmailPushTokenSecret
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

