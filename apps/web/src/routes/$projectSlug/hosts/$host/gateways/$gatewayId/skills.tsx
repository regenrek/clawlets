import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/gateways/$gatewayId/skills")({
  component: GatewaySkills,
})

function GatewaySkills() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      Skills placeholder. Skills management will land here.
    </div>
  )
}

