import { DeployInitialInstall } from "~/components/deploy/deploy-initial"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type { SetupDraftConnection, SetupDraftInfrastructure, SetupDraftView } from "~/sdk/setup"

type SetupPendingBootstrapSecrets = {
  adminPassword: string
  tailscaleAuthKey: string
  useTailscaleLockdown: boolean
}

export function SetupStepDeploy(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  onContinue: () => void
  stepStatus: SetupStepStatus
  setupDraft: SetupDraftView | null
  pendingInfrastructureDraft: SetupDraftInfrastructure | null
  pendingConnectionDraft: SetupDraftConnection | null
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets
  hasProjectGithubToken: boolean
  projectSopsAgeKeyPath: string
  hasActiveTailscaleAuthKey: boolean
  activeTailscaleAuthKey: string
}) {
  return (
    <DeployInitialInstall
      projectSlug={props.projectSlug}
      host={props.host}
      variant="setup"
      hasBootstrapped={props.hasBootstrapped}
      onBootstrapped={props.onContinue}
      headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
      setupDraft={props.setupDraft}
      pendingInfrastructureDraft={props.pendingInfrastructureDraft}
      pendingConnectionDraft={props.pendingConnectionDraft}
      pendingBootstrapSecrets={props.pendingBootstrapSecrets}
      hasProjectGithubToken={props.hasProjectGithubToken}
      projectSopsAgeKeyPath={props.projectSopsAgeKeyPath}
      hasActiveTailscaleAuthKey={props.hasActiveTailscaleAuthKey}
      activeTailscaleAuthKey={props.activeTailscaleAuthKey}
      showRunnerStatusBanner={false}
    />
  )
}
