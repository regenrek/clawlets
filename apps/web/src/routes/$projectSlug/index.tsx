import { createFileRoute, redirect } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { ProjectDashboard } from "~/components/dashboard/project-dashboard"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/")({
  loader: async ({ context, params }) => {
    const projects = (await context.queryClient.ensureQueryData(projectsListQueryOptions())) as Array<any>
    const project = projects.find((item) => slugifyProjectName(String(item?.name || "")) === params.projectSlug) || null
    if (project?.status === "creating" || project?.status === "error") {
      throw redirect({
        to: "/$projectSlug/runner",
        params: { projectSlug: params.projectSlug },
      })
    }
  },
  component: ProjectDashboardRoute,
})

function ProjectDashboardRoute() {
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
    <ProjectDashboard
      projectId={projectQuery.projectId as Id<"projects">}
      projectSlug={projectSlug}
    />
  )
}
