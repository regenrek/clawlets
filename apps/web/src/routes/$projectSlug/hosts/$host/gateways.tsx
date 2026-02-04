import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/gateways")({
  component: GatewaysLayout,
})

function GatewaysLayout() {
  return <Outlet />
}

