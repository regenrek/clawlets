import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { isPlainObject, parseTextList } from "./bot-integrations-helpers"

export function ChannelsConfigCard(props: {
  botId: string
  channels: unknown
  canEdit: boolean
  pending: boolean
  initialTelegramAllowFromText: string
  onToggleChannel: (params: { channel: "discord" | "telegram"; enabled: boolean }) => void
  onSaveTelegramAllowFrom: (allowFrom: string[]) => void
}) {
  const channelsObj = isPlainObject(props.channels) ? (props.channels as Record<string, unknown>) : {}
  const discordObj = isPlainObject(channelsObj["discord"]) ? (channelsObj["discord"] as Record<string, unknown>) : {}
  const telegramObj = isPlainObject(channelsObj["telegram"]) ? (channelsObj["telegram"] as Record<string, unknown>) : {}

  const discordEnabled = discordObj["enabled"] !== false
  const telegramEnabled = telegramObj["enabled"] !== false

  const [telegramAllowFromText, setTelegramAllowFromText] = useState(() => props.initialTelegramAllowFromText)

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">Channels config (first-class)</div>
        <div className="text-xs text-muted-foreground">
          Stored as <code>fleet.bots.{props.botId}.channels</code>.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Discord</div>
            <Switch
              checked={discordEnabled}
              disabled={!props.canEdit || props.pending}
              onCheckedChange={(checked) => props.onToggleChannel({ channel: "discord", enabled: checked })}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Discord allowlists are controlled via <code>channels.discord.groupPolicy</code> and related Discord-specific options.
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Telegram</div>
            <Switch
              checked={telegramEnabled}
              disabled={!props.canEdit || props.pending}
              onCheckedChange={(checked) => props.onToggleChannel({ channel: "telegram", enabled: checked })}
            />
          </div>
          <div className="text-xs text-muted-foreground">allowFrom (one per line)</div>
          <textarea
            className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm"
            value={telegramAllowFromText}
            disabled={!props.canEdit || props.pending}
            onChange={(e) => setTelegramAllowFromText(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || props.pending}
            onClick={() => props.onSaveTelegramAllowFrom(parseTextList(telegramAllowFromText))}
          >
            Save Telegram allowFrom
          </Button>
        </div>
      </div>
    </div>
  )
}

