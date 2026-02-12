import type { HostSetupContextMode } from "~/lib/setup/host-setup-context"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"

const COPY: Record<HostSetupContextMode, { title: string; body: string }> = {
  first_host: {
    title: "Set up your first host",
    body: "Runner setup is complete. Configure this first host so deploy and runtime operations can proceed for this project.",
  },
  host_setup: {
    title: "Set up host",
    body: "Complete setup for this host to enable deploy and runtime operations for this project.",
  },
}

export function HostSetupContextCard(props: {
  mode: HostSetupContextMode
  hostName: string
}) {
  const content = COPY[props.mode]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{content.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{content.body}</p>
        <p className="text-xs text-muted-foreground">
          Host: <span className="font-medium text-foreground">{props.hostName}</span>
        </p>
      </CardContent>
    </Card>
  )
}
