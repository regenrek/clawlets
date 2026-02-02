import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { isPlainObject, parseTextList } from "./bot-integrations-helpers"

export function PluginsConfigCard(props: {
  botId: string
  plugins: unknown
  canEdit: boolean
  pending: boolean
  initialAllowText: string
  initialDenyText: string
  initialPathsText: string
  onToggleEnabled: (enabled: boolean) => void
  onSaveAllow: (allow: string[]) => void
  onSaveDeny: (deny: string[]) => void
  onSavePaths: (paths: string[]) => void
}) {
  const pluginsObj = isPlainObject(props.plugins) ? (props.plugins as Record<string, unknown>) : {}
  const pluginsEnabled = pluginsObj["enabled"] === true

  const [allowText, setAllowText] = useState(() => props.initialAllowText)
  const [denyText, setDenyText] = useState(() => props.initialDenyText)
  const [pathsText, setPathsText] = useState(() => props.initialPathsText)

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">Plugins config (first-class)</div>
        <div className="text-xs text-muted-foreground">
          Stored as <code>fleet.bots.{props.botId}.plugins</code>.
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Enabled</div>
          <Switch
            checked={pluginsEnabled}
            disabled={!props.canEdit || props.pending}
            onCheckedChange={(checked) => props.onToggleEnabled(checked)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">allow (one per line)</div>
            <textarea
              className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm"
              value={allowText}
              disabled={!props.canEdit || props.pending}
              onChange={(e) => setAllowText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canEdit || props.pending}
              onClick={() => props.onSaveAllow(parseTextList(allowText))}
            >
              Save allow
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">deny (one per line)</div>
            <textarea
              className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm"
              value={denyText}
              disabled={!props.canEdit || props.pending}
              onChange={(e) => setDenyText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!props.canEdit || props.pending}
              onClick={() => props.onSaveDeny(parseTextList(denyText))}
            >
              Save deny
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">load.paths (one per line)</div>
          <textarea
            className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm"
            value={pathsText}
            disabled={!props.canEdit || props.pending}
            onChange={(e) => setPathsText(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || props.pending}
            onClick={() => props.onSavePaths(parseTextList(pathsText))}
          >
            Save load paths
          </Button>
        </div>
      </div>
    </div>
  )
}

