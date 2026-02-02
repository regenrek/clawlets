import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { isPlainObject, parseTextList } from "./bot-integrations-helpers"

type SkillEntryView = {
  skill: string
  apiKeySecret: string
  hasInlineApiKey: boolean
}

function readSkillEntries(skills: unknown): SkillEntryView[] {
  const skillsObj = isPlainObject(skills) ? (skills as Record<string, unknown>) : {}
  const entriesObj = isPlainObject(skillsObj["entries"]) ? (skillsObj["entries"] as Record<string, unknown>) : {}

  return Object.entries(entriesObj)
    .filter(([, entry]) => isPlainObject(entry))
    .map(([skill, entryRaw]) => {
      const entry = entryRaw as Record<string, unknown>
      const apiKeySecret = typeof entry["apiKeySecret"] === "string" ? (entry["apiKeySecret"] as string) : ""
      const hasInlineApiKey = typeof entry["apiKey"] === "string" && Boolean(String(entry["apiKey"]).trim()) && !apiKeySecret
      return { skill, apiKeySecret, hasInlineApiKey }
    })
    .sort((a, b) => a.skill.localeCompare(b.skill))
}

export function SkillsConfigCard(props: {
  botId: string
  skills: unknown
  canEdit: boolean
  pending: boolean
  skillEntryPending: boolean
  initialAllowBundledText: string
  initialExtraDirsText: string
  onSaveAllowBundled: (allowBundled: string[]) => void
  onSaveExtraDirs: (extraDirs: string[]) => void
  onSaveSkillSecret: (params: { skill: string; apiKeySecret: string; clearInline: boolean }) => Promise<unknown>
  onRemoveSkillEntry: (skill: string) => void
}) {
  const entries = readSkillEntries(props.skills)

  const [allowBundledText, setAllowBundledText] = useState(() => props.initialAllowBundledText)
  const [extraDirsText, setExtraDirsText] = useState(() => props.initialExtraDirsText)

  const [skillSecretDrafts, setSkillSecretDrafts] = useState<Record<string, string>>({})
  const [newSkillId, setNewSkillId] = useState("")
  const [newSkillSecret, setNewSkillSecret] = useState("")

  async function saveSkillSecret(params: {
    skill: string
    apiKeySecret: string
    clearInline: boolean
  }): Promise<boolean> {
    try {
      await props.onSaveSkillSecret(params)
      setSkillSecretDrafts((prev) => {
        const next = { ...prev }
        delete next[params.skill]
        return next
      })
      return true
    } catch {
      // upstream toasts
      return false
    }
  }

  async function addSkillSecret() {
    const skill = newSkillId.trim()
    const apiKeySecret = newSkillSecret.trim()
    if (!skill || !apiKeySecret) return
    const ok = await saveSkillSecret({ skill, apiKeySecret, clearInline: false })
    if (!ok) return
    setNewSkillId("")
    setNewSkillSecret("")
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">Skills config (first-class)</div>
        <div className="text-xs text-muted-foreground">
          Stored as <code>fleet.bots.{props.botId}.skills</code>.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">allowBundled (one per line)</div>
          <textarea
            className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm"
            value={allowBundledText}
            disabled={!props.canEdit || props.pending}
            onChange={(e) => setAllowBundledText(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || props.pending}
            onClick={() => props.onSaveAllowBundled(parseTextList(allowBundledText))}
          >
            Save allowBundled
          </Button>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">load.extraDirs (one per line)</div>
          <textarea
            className="w-full min-h-[96px] rounded-md border bg-background px-3 py-2 text-sm"
            value={extraDirsText}
            disabled={!props.canEdit || props.pending}
            onChange={(e) => setExtraDirsText(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || props.pending}
            onClick={() => props.onSaveExtraDirs(parseTextList(extraDirsText))}
          >
            Save extraDirs
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Skill API key secrets</div>
        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground">No skill entries configured.</div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const draft = (skillSecretDrafts[entry.skill] ?? entry.apiKeySecret).trim()
              return (
                <div key={entry.skill} className="rounded-md border bg-muted/20 p-3 space-y-2">
                  <div className="text-sm font-medium">{entry.skill}</div>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] items-end">
                    <Input
                      value={skillSecretDrafts[entry.skill] ?? entry.apiKeySecret}
                      disabled={!props.canEdit || props.skillEntryPending}
                      onChange={(e) => setSkillSecretDrafts((prev) => ({ ...prev, [entry.skill]: e.target.value }))}
                      placeholder="apiKeySecret"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!props.canEdit || props.skillEntryPending || !draft}
                      onClick={() => void saveSkillSecret({ skill: entry.skill, apiKeySecret: draft, clearInline: entry.hasInlineApiKey })}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!props.canEdit || props.pending}
                      onClick={() => props.onRemoveSkillEntry(entry.skill)}
                    >
                      Remove
                    </Button>
                  </div>
                  {entry.hasInlineApiKey ? (
                    <div className="text-xs text-muted-foreground">
                      Inline apiKey detected; prefer <code>apiKeySecret</code> (inline value not shown).
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-end">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Skill id</div>
            <Input
              value={newSkillId}
              disabled={!props.canEdit || props.skillEntryPending}
              onChange={(e) => setNewSkillId(e.target.value)}
              placeholder="brave-search"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">apiKeySecret</div>
            <Input
              value={newSkillSecret}
              disabled={!props.canEdit || props.skillEntryPending}
              onChange={(e) => setNewSkillSecret(e.target.value)}
              placeholder="brave_api_key"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || props.skillEntryPending || !newSkillId.trim() || !newSkillSecret.trim()}
            onClick={() => void addSkillSecret()}
          >
            Add skill secret
          </Button>
        </div>
      </div>
    </div>
  )
}
