import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/deploy")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/hosts/$host/updates",
      params: { projectSlug: params.projectSlug, host: params.host },
    })
  },
})
