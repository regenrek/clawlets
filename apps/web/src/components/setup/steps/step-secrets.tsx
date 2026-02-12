import type { Id } from "../../../../convex/_generated/dataModel"
import { HostSecretsPanel } from "~/components/secrets/host-secrets-panel"
import type { SetupDraftView } from "~/sdk/setup"

export function SetupStepSecrets(props: {
  projectId: Id<"projects">
  host: string
  setupDraft: SetupDraftView | null
  isComplete: boolean
  onContinue: () => void
}) {
  return (
    <HostSecretsPanel
      projectId={props.projectId}
      host={props.host}
      scope="bootstrap"
      mode="setup"
      setupDraft={props.setupDraft}
      setupFlow={{
        isComplete: props.isComplete,
        onContinue: props.onContinue,
      }}
    />
  )
}
