import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { StackedField } from "~/components/ui/stacked-field"
import { generateProjectName } from "~/lib/project-name-generator"
import { projectsListQueryOptions, queryKeys } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { projectCreateStart } from "~/sdk/project"

type ProjectCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function shellQuote(value: string): string {
  if (!value) return "''"
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function copyText(label: string, value: string): Promise<void> {
  if (!value.trim()) {
    toast.error(`${label} is empty`)
    return
  }
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard unavailable")
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error("Copy failed")
  }
}

function ProjectCreateDialog({ open, onOpenChange }: ProjectCreateDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [runnerRepoPathInput, setRunnerRepoPathInput] = useState("")
  const [runnerNameInput, setRunnerNameInput] = useState("")
  const [hostInput, setHostInput] = useState("")
  const [templateRepoInput, setTemplateRepoInput] = useState("")
  const [templatePathInput, setTemplatePathInput] = useState("")
  const [templateRefInput, setTemplateRefInput] = useState("")
  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null)
  const [runnerToken, setRunnerToken] = useState("")
  const [runnerRepoPathResolved, setRunnerRepoPathResolved] = useState("")
  const [runnerNameResolved, setRunnerNameResolved] = useState("")
  const [redirected, setRedirected] = useState(false)

  const nameSlug = useMemo(() => slugifyProjectName(name || "project"), [name])
  const defaultRunnerRepoPath = `~/.clawlets/projects/${nameSlug}`
  const defaultRunnerName = `runner-${nameSlug || "project"}`
  const defaultHost = nameSlug || "openclaw-fleet-host"
  const effectiveRunnerRepoPath = (runnerRepoPathInput.trim() || defaultRunnerRepoPath).replace(/\/+$/, "") || "/"
  const effectiveRunnerName = runnerNameInput.trim() || defaultRunnerName
  const effectiveHost = hostInput.trim() || defaultHost
  const projectsListQueryKey = projectsListQueryOptions().queryKey

  const controlPlaneUrl = String(import.meta.env.VITE_CONVEX_SITE_URL || "").trim()
  const dashboardOrigin = typeof window === "undefined" ? "" : String(window.location.origin || "").trim()
  const runnerStartCommand = useMemo(() => {
    const repoRoot = runnerRepoPathResolved || effectiveRunnerRepoPath
    const runnerName = runnerNameResolved || effectiveRunnerName
    const token = runnerToken || "<runner-token>"
    const lines: string[] = []
    lines.push(`mkdir -p ${shellQuote(repoRoot)}`)
    lines.push(`cd ${shellQuote(repoRoot)}`)
    lines.push("clawlets runner start \\")
    lines.push(`  --project ${projectId || "<project-id>"} \\`)
    lines.push(`  --name ${shellQuote(runnerName)} \\`)
    lines.push(`  --token ${shellQuote(token)} \\`)
    lines.push(`  --repoRoot ${shellQuote(repoRoot)} \\`)
    lines.push(`  --control-plane-url ${shellQuote(controlPlaneUrl || "<convex-site-url>")} \\`)
    lines.push(`  --dashboardOrigin ${shellQuote(dashboardOrigin || "<dashboard-origin>")}`)
    return lines.join("\n")
  }, [controlPlaneUrl, dashboardOrigin, effectiveRunnerName, effectiveRunnerRepoPath, projectId, runnerNameResolved, runnerRepoPathResolved, runnerToken])

  const start = useMutation({
    mutationFn: async () =>
      await projectCreateStart({
        data: {
          name,
          runnerRepoPath: effectiveRunnerRepoPath,
          host: effectiveHost,
          runnerName: effectiveRunnerName,
          templateRepo: templateRepoInput.trim(),
          templatePath: templatePathInput.trim(),
          templateRef: templateRefInput.trim(),
        },
      }),
    onSuccess: (res) => {
      setRedirected(false)
      setRunId(res.runId)
      setProjectId(res.projectId)
      setRunnerToken(String(res.token || ""))
      setRunnerRepoPathResolved(String(res.runnerRepoPath || effectiveRunnerRepoPath))
      setRunnerNameResolved(String(res.runnerName || effectiveRunnerName))
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverview })
      void queryClient.invalidateQueries({ queryKey: projectsListQueryKey })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  useEffect(() => {
    if (!open) return
    setName("")
    setRunnerRepoPathInput("")
    setRunnerNameInput("")
    setHostInput("")
    setTemplateRepoInput("")
    setTemplatePathInput("")
    setTemplateRefInput("")
    setRunId(null)
    setProjectId(null)
    setRunnerToken("")
    setRunnerRepoPathResolved("")
    setRunnerNameResolved("")
    setRedirected(false)
    start.reset()
  }, [open]) // oxlint-disable-line react/exhaustive-deps -- reset dialog state on each open

  const hasCreateActivity = start.isPending || Boolean(runId)

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
      return
    }
    if (
      hasCreateActivity &&
      typeof window !== "undefined" &&
      !window.confirm("Close and discard current project creation progress?")
    ) {
      return
    }
    onOpenChange(false)
  }

  const close = (options?: { force?: boolean }) => {
    if (options?.force) {
      onOpenChange(false)
      return
    }
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Queue remote project init on a runner host. Dashboard does not write repo files locally.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <StackedField id="name" label="Project name">
            <InputGroup>
              <InputGroupInput
                id="name"
                placeholder="my-fleet"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="secondary"
                  disabled={start.isPending}
                  onClick={() => setName(generateProjectName())}
                >
                  <ArrowPathIcon />
                  Generate
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </StackedField>

          <StackedField
            id="runner-repo-path"
            label="Runner repo path"
            description={(
              <>
                Default: <code>{defaultRunnerRepoPath}</code>.
              </>
            )}
          >
            <InputGroup>
              <InputGroupInput
                id="runner-repo-path"
                placeholder={defaultRunnerRepoPath}
                value={runnerRepoPathInput}
                onChange={(e) => setRunnerRepoPathInput(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  onClick={() => setRunnerRepoPathInput(defaultRunnerRepoPath)}
                  type="button"
                >
                  Use default
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </StackedField>

          <StackedField
            id="runner-name"
            label="Runner name"
            description={(
              <>
                Token is minted for this runner. Default: <code>{defaultRunnerName}</code>.
              </>
            )}
          >
            <Input
              id="runner-name"
              placeholder={defaultRunnerName}
              value={runnerNameInput}
              onChange={(e) => setRunnerNameInput(e.target.value)}
            />
          </StackedField>

          <Accordion className="rounded-lg border bg-muted/20">
            <AccordionItem value="advanced" className="px-4">
              <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
                Advanced options
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-4">
                  <StackedField
                    id="host"
                    label="Host placeholder"
                    description={(
                      <>
                        Defaults to <code>{defaultHost}</code>.
                      </>
                    )}
                  >
                    <Input
                      id="host"
                      placeholder={defaultHost}
                      value={hostInput}
                      onChange={(e) => setHostInput(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="template-repo"
                    label="Template repo (optional)"
                    description={(
                      <>
                        Format: <code>owner/repo</code>.
                      </>
                    )}
                  >
                    <Input
                      id="template-repo"
                      placeholder="owner/repo"
                      value={templateRepoInput}
                      onChange={(e) => setTemplateRepoInput(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="template-path"
                    label="Template path (optional)"
                    description="Relative path in template repo."
                  >
                    <Input
                      id="template-path"
                      placeholder="templates/default"
                      value={templatePathInput}
                      onChange={(e) => setTemplatePathInput(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="template-ref"
                    label="Template ref (optional)"
                    description="Git branch/tag/commit."
                  >
                    <Input
                      id="template-ref"
                      placeholder="main"
                      value={templateRefInput}
                      onChange={(e) => setTemplateRefInput(e.target.value)}
                    />
                  </StackedField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => close()}
            >
              Cancel
            </Button>
            <AsyncButton
              type="button"
              disabled={start.isPending || !!runId || !name.trim() || !effectiveRunnerRepoPath.trim() || !effectiveRunnerName.trim()}
              pending={start.isPending}
              pendingText="Queueing runner job..."
              onClick={() => start.mutate()}
            >
              Create
            </AsyncButton>
          </div>

          {projectId && runId ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium">Runner token</div>
              <pre className="rounded-md border bg-background p-2 text-xs break-all">{runnerToken}</pre>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyText("Runner token", runnerToken)}>
                  Copy token
                </Button>
              </div>
              <div className="pt-2">
                <div className="mb-2 text-sm font-medium">Runner start command</div>
                <pre className="rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words">{runnerStartCommand}</pre>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copyText("Runner command", runnerStartCommand)}>
                    Copy command
                  </Button>
                  <span className="text-xs text-muted-foreground">Run on the runner host. Job will start after heartbeat.</span>
                </div>
              </div>
            </div>
          ) : null}

          {projectId && runId ? (
            <div className="space-y-3">
              <RunLogTail
                runId={runId}
                onDone={(status) => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverview })
                  void queryClient.invalidateQueries({ queryKey: projectsListQueryKey })
                  if (redirected) return
                  if (status !== "succeeded") return
                  setRedirected(true)
                  close({ force: true })
                  void router.navigate({
                    to: "/$projectSlug/setup/",
                    params: { projectSlug: nameSlug },
                  } as any)
                }}
              />
              <div className="text-xs text-muted-foreground">
                If runner is offline, run remains queued and project stays <code>creating</code>.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    close({ force: true })
                    void router.navigate({
                      to: "/$projectSlug/setup/",
                      params: { projectSlug: nameSlug },
                    } as any)
                  }}
                >
                  Open setup
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    close({ force: true })
                    void router.navigate({
                      to: "/$projectSlug/runs",
                      params: { projectSlug: nameSlug },
                    } as any)
                  }}
                >
                  Runs
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ProjectCreateDialog }
