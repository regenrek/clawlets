import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/setup/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/runner",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
