import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { ProjectTokenKeyringCard } from "~/components/setup/project-token-keyring-card"
import { useProjectBySlug } from "~/lib/project-data"

export const Route = createFileRoute("/$projectSlug/security/api-keys")({
  component: SecurityApiKeys,
})

function SecurityApiKeys() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectQuery.projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Project credentials</h2>
        <p className="text-sm text-muted-foreground">
          Operator tokens and deploy tooling settings used across the project.
        </p>
      </div>

      <ProjectTokenKeyringCard
        projectId={projectQuery.projectId as Id<"projects">}
        kind="hcloud"
        setupHref={`/${projectSlug}/runner`}
        title="Hetzner API keys"
        description="Project-wide keyring. Add multiple tokens and select the active one."
      />

      <ProjectTokenKeyringCard
        projectId={projectQuery.projectId as Id<"projects">}
        kind="tailscale"
        setupHref={`/${projectSlug}/runner`}
        title="Tailscale API keys"
        description="Project-wide keyring used by setup and tailnet bootstrap."
      />

      <DeployCredsCard
        projectId={projectQuery.projectId as Id<"projects">}
        setupHref={`/${projectSlug}/runner`}
        visibleKeys={["GITHUB_TOKEN", "SOPS_AGE_KEY_FILE"]}
      />
    </div>
  )
}
