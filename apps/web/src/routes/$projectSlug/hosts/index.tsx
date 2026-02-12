import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
