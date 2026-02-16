import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircleIcon, SparklesIcon } from "@heroicons/react/24/solid"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import { configDotSet } from "~/sdk/config"
import { getHostPublicIpv4, probeHostTailscaleIpv4 } from "~/sdk/host"
import { bootstrapExecute, bootstrapStart, generateSopsAgeKey, lockdownExecute, lockdownStart, runDoctor } from "~/sdk/infra"
import { useProjectBySlug } from "~/lib/project-data"
import { deriveProjectRunnerNixReadiness, isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state"
import { setupConfigProbeQueryKey, setupConfigProbeQueryOptions } from "~/lib/setup/repo-probe"
import { deriveSshKeyGateUi } from "~/lib/setup/ssh-key-gate"
import { sealForRunner } from "~/lib/security/sealed-input"
import { gitRepoStatus } from "~/sdk/vcs"
import { serverUpdateApplyExecute, serverUpdateApplyStart } from "~/sdk/server"
import {
  buildSetupDraftSectionAad,
  setupDraftCommit,
  setupDraftSaveNonSecret,
  setupDraftSaveSealedSection,
  type SetupDraftConnection,
  type SetupDraftInfrastructure,
  type SetupDraftView,
} from "~/sdk/setup"
import {
  deriveDeployReadiness,
  extractIssueMessage,
  initialFinalizeSteps,
  stepBadgeLabel,
  stepBadgeVariant,
  type FinalizeState,
  type FinalizeStep,
  type FinalizeStepId,
  type FinalizeStepStatus,
} from "~/components/deploy/deploy-setup-model"

type SetupPendingBootstrapSecrets = {
  adminPassword: string
  useTailscaleLockdown: boolean
}

type PredeployCheckId =
  | "runner"
  | "repo"
  | "ssh"
  | "adminPassword"
  | "projectCreds"
  | "sealedDrafts"
  | "setupApply"

type PredeployCheckState = "pending" | "passed" | "failed"
type PredeployState = "idle" | "running" | "failed" | "ready"

type PredeployCheck = {
  id: PredeployCheckId
  label: string
  state: PredeployCheckState
  detail?: string
}

function initialPredeployChecks(): PredeployCheck[] {
  return [
    { id: "runner", label: "Runner ready", state: "pending" },
    { id: "repo", label: "Repo ready", state: "pending" },
    { id: "ssh", label: "SSH setup ready", state: "pending" },
    { id: "adminPassword", label: "Admin password ready", state: "pending" },
    { id: "projectCreds", label: "Project creds ready", state: "pending" },
    { id: "sealedDrafts", label: "Host secrets written", state: "pending" },
    { id: "setupApply", label: "Setup apply queued", state: "pending" },
  ]
}

export function DeployInitialInstallSetup(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  onContinue?: () => void
  headerBadge?: ReactNode
  setupDraft: SetupDraftView | null
  pendingInfrastructureDraft: SetupDraftInfrastructure | null
  pendingConnectionDraft: SetupDraftConnection | null
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets
  hasProjectGithubToken: boolean
  hasActiveTailscaleAuthKey: boolean
  showRunnerStatusBanner?: boolean
}) {
  const projectQuery = useProjectBySlug(props.projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, projectId ? {
      projectId,
    } : "skip"),
  })
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, projectId ? { projectId } : "skip"),
  })
  const secretWiringQuery = useQuery({
    ...convexQuery(
      api.controlPlane.secretWiring.listByProjectHost,
      projectId ? { projectId, hostName: props.host } : "skip",
    ),
    enabled: Boolean(projectId && props.host),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])
  const runnerNixReadiness = useMemo(
    () => deriveProjectRunnerNixReadiness(runnersQuery.data ?? []),
    [runnersQuery.data],
  )
  const sealedRunners = useMemo(
    () =>
      (runnersQuery.data ?? [])
        .filter(
          (runner) =>
            runner.lastStatus === "online"
            && runner.capabilities?.supportsSealedInput === true
            && typeof runner.capabilities?.sealedInputPubSpkiB64 === "string"
            && runner.capabilities.sealedInputPubSpkiB64.trim().length > 0
            && typeof runner.capabilities?.sealedInputKeyId === "string"
            && runner.capabilities.sealedInputKeyId.trim().length > 0
            && typeof runner.capabilities?.sealedInputAlg === "string"
            && runner.capabilities.sealedInputAlg.trim().length > 0,
        )
        .toSorted((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0)),
    [runnersQuery.data],
  )

  const hostSummary = useMemo(
    () => (hostsQuery.data ?? []).find((row) => row.hostName === props.host) ?? null,
    [hostsQuery.data, props.host],
  )
  const tailnetMode = String(hostSummary?.desired?.tailnetMode || "none")
  const isTailnet = tailnetMode === "tailscale"
  const desiredSshExposureMode = String(hostSummary?.desired?.sshExposureMode || "").trim()
  const hasProjectTailscaleAuthKey = props.hasActiveTailscaleAuthKey
  const adminPasswordConfigured = useMemo(
    () =>
      (secretWiringQuery.data ?? []).some(
        (row) => row.secretName === "admin_password_hash" && row.status === "configured",
      ),
    [secretWiringQuery.data],
  )
  const adminPasswordRequired = !adminPasswordConfigured
  const adminPassword = props.pendingBootstrapSecrets.adminPassword.trim()
  const adminPasswordGateBlocked = adminPasswordRequired && !adminPassword
  const adminPasswordGateMessage = adminPasswordGateBlocked
    ? "Server access incomplete. Set admin password."
    : null

  const repoStatus = useQuery({
    queryKey: ["gitRepoStatus", projectId],
    queryFn: async () =>
      await gitRepoStatus({ data: { projectId: projectId as Id<"projects"> } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(projectId && runnerOnline),
  })
  const setupConfigQuery = useQuery({
    ...setupConfigProbeQueryOptions(projectId),
    enabled: Boolean(projectId && runnerOnline),
  })
  const desired = useMemo(
    () =>
      deriveEffectiveSetupDesiredState({
        config: setupConfigQuery.data ?? null,
        host: props.host,
        setupDraft: props.setupDraft,
        pendingNonSecretDraft: {
          infrastructure: props.pendingInfrastructureDraft ?? undefined,
          connection: props.pendingConnectionDraft ?? undefined,
        },
      }),
    [
      setupConfigQuery.data,
      props.host,
      props.pendingConnectionDraft,
      props.pendingInfrastructureDraft,
      props.setupDraft,
    ],
  )

  const projectGithubTokenSet = props.hasProjectGithubToken
  const effectiveDeployCredsReady = projectGithubTokenSet

  const selectedRev = repoStatus.data?.originHead
  const missingRev = !selectedRev
  const needsPush = Boolean(repoStatus.data?.needsPush)
  const readiness = deriveDeployReadiness({
    runnerOnline,
    repoPending: repoStatus.isPending,
    repoError: repoStatus.error,
    missingRev,
    needsPush,
    localSelected: false,
    allowLocalDeploy: false,
  })
  const repoGateBlocked = readiness.blocksDeploy
  const statusReason = readiness.message

  const hasDesiredSshKeys = desired.connection.sshAuthorizedKeys.length > 0
  const nixGateBlocked = runnerOnline && !runnerNixReadiness.ready
  const nixGateMessage = !runnerOnline
    ? null
    : runnerNixReadiness.ready
      ? null
      : "Runner is online but Nix is missing. Install Nix on the runner host, then restart the runner."
  const sshKeyGateUi = deriveSshKeyGateUi({
    runnerOnline,
    hasDesiredSshKeys,
    probePending: setupConfigQuery.isPending,
    probeError: setupConfigQuery.isError,
  })
  const sshKeyGateBlocked = sshKeyGateUi.blocked
  const sshKeyGateMessage = sshKeyGateUi.message

  const credsGateBlocked = runnerOnline && !effectiveDeployCredsReady
  const credsGateMessage = !runnerOnline
    ? null
    : !effectiveDeployCredsReady
      ? "Missing credentials. Add GitHub token in Hetzner setup."
      : null

  const deployGateBlocked =
    repoGateBlocked || nixGateBlocked || sshKeyGateBlocked || adminPasswordGateBlocked || credsGateBlocked
  const deployStatusReason = repoGateBlocked
    ? statusReason
    : nixGateMessage || sshKeyGateMessage || adminPasswordGateMessage || credsGateMessage || statusReason

  const wantsTailscaleLockdown = props.pendingBootstrapSecrets.useTailscaleLockdown
  const canAutoLockdown = wantsTailscaleLockdown && hasProjectTailscaleAuthKey
  const adminCidr = String(desired.connection.adminCidr || "").trim()
  const adminCidrWorldOpen = adminCidr === "0.0.0.0/0" || adminCidr === "::/0"
  const autoLockdownMissingTailscaleKey = !hasProjectTailscaleAuthKey

  const [bootstrapRunId, setBootstrapRunId] = useState<Id<"runs"> | null>(null)
  const [setupApplyRunId, setSetupApplyRunId] = useState<Id<"runs"> | null>(null)
  const [bootstrapStatus, setBootstrapStatus] = useState<"idle" | "running" | "succeeded" | "failed">("idle")
  const [predeployState, setPredeployState] = useState<PredeployState>("idle")
  const [predeployChecks, setPredeployChecks] = useState<PredeployCheck[]>(() => initialPredeployChecks())
  const [predeployError, setPredeployError] = useState<string | null>(null)
  const [predeployReadyFingerprint, setPredeployReadyFingerprint] = useState<string | null>(null)
  const [predeployUpdatedAt, setPredeployUpdatedAt] = useState<number | null>(null)
  const [finalizeState, setFinalizeState] = useState<FinalizeState>("idle")
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [finalizeSteps, setFinalizeSteps] = useState<FinalizeStep[]>(() => initialFinalizeSteps())
  const [lockdownRunId, setLockdownRunId] = useState<Id<"runs"> | null>(null)
  const [applyRunId, setApplyRunId] = useState<Id<"runs"> | null>(null)
  const finalizeStartedRef = useRef(false)

  function setStepStatus(id: FinalizeStepId, status: FinalizeStepStatus, detail?: string): void {
    setFinalizeSteps((prev) => prev.map((row) => (
      row.id === id ? { ...row, status, detail } : row
    )))
  }

  function setPredeployCheck(id: PredeployCheckId, state: PredeployCheckState, detail?: string): void {
    setPredeployChecks((prev) =>
      prev.map((row) => (row.id === id ? { ...row, state, detail } : row)),
    )
  }

  const predeployFingerprint = useMemo(
    () =>
      JSON.stringify({
        host: props.host,
        selectedRev: selectedRev ?? "",
        runnerOnline,
        runnerNixReady: runnerNixReadiness.ready,
        infra: desired.infrastructure,
        connection: desired.connection,
        hasProjectGithubToken: props.hasProjectGithubToken,
        hasProjectTailscaleAuthKey,
        useTailscaleLockdown: wantsTailscaleLockdown,
        adminPasswordRequired,
        adminPasswordSet: Boolean(props.pendingBootstrapSecrets.adminPassword.trim()),
      }),
    [
      desired.connection,
      desired.infrastructure,
      props.hasProjectGithubToken,
      hasProjectTailscaleAuthKey,
      props.host,
      props.pendingBootstrapSecrets.adminPassword,
      adminPasswordRequired,
      runnerNixReadiness.ready,
      runnerOnline,
      selectedRev,
      wantsTailscaleLockdown,
    ],
  )
  const predeployFingerprintRef = useRef(predeployFingerprint)

  useEffect(() => {
    predeployFingerprintRef.current = predeployFingerprint
  }, [predeployFingerprint])

  useEffect(() => {
    if (predeployState !== "ready") return
    if (predeployReadyFingerprint === predeployFingerprint) return
    setPredeployState("idle")
    setPredeployChecks(initialPredeployChecks())
    setPredeployError("Predeploy summary is stale. Re-run checks.")
    setPredeployReadyFingerprint(null)
    setPredeployUpdatedAt(null)
  }, [predeployFingerprint, predeployReadyFingerprint, predeployState])

  async function runFinalizeStep(params: {
    id: FinalizeStepId
    run: () => Promise<string | undefined>
    onError?: (message: string) => void
  }): Promise<void> {
    setStepStatus(params.id, "running")
    try {
      const detail = await params.run()
      setStepStatus(params.id, "succeeded", detail)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStepStatus(params.id, "failed", message)
      params.onError?.(message)
      throw error
    }
  }

  const startFinalize = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      setFinalizeState("running")
      setFinalizeError(null)
      setFinalizeSteps(initialFinalizeSteps())

      let targetHost = String(hostSummary?.desired?.targetHost || "").trim()
      await runFinalizeStep({
        id: "enableHost",
        run: async () => {
          const result = await configDotSet({
            data: {
              projectId: projectId as Id<"projects">,
              path: `hosts.${props.host}.enable`,
              valueJson: "true",
            },
          })
          if (!result.ok) throw new Error(extractIssueMessage(result, "Could not enable host"))
          return "Enabled"
        },
      })

      if (targetHost) {
        setStepStatus("setTargetHost", "skipped", `Already set: ${targetHost}`)
      } else {
        await runFinalizeStep({
          id: "setTargetHost",
          run: async () => {
            const ipv4 = await getHostPublicIpv4({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
              },
            })
            if (!ipv4.ok) throw new Error(ipv4.error || "Could not find public IPv4")
            if (!ipv4.ipv4) throw new Error("Could not find public IPv4")
            targetHost = `admin@${ipv4.ipv4}`
            const result = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.targetHost`,
                value: targetHost,
              },
            })
            if (!result.ok) throw new Error(extractIssueMessage(result, "Could not set target host"))
            return targetHost
          },
        })
      }

      if (!wantsTailscaleLockdown) {
        setStepStatus("switchTailnetTarget", "skipped", "Auto-lockdown disabled")
        setStepStatus("switchSshExposure", "skipped", "Auto-lockdown disabled")
        setStepStatus("lockdown", "skipped", "Auto-lockdown disabled")
      } else if (!hasProjectTailscaleAuthKey) {
        setStepStatus("switchTailnetTarget", "skipped", "Tailscale auth key missing")
        setStepStatus("switchSshExposure", "skipped", "Tailscale auth key missing")
        setStepStatus("lockdown", "skipped", "Tailscale auth key missing")
      } else {
        await runFinalizeStep({
          id: "switchTailnetTarget",
          run: async () => {
            if (!targetHost.trim()) throw new Error("targetHost missing")
            const probe = await probeHostTailscaleIpv4({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
                targetHost,
              },
            })
            if (!probe.ok) throw new Error(probe.error || "Could not resolve tailnet IPv4")
            if (!probe.ipv4) throw new Error("Could not resolve tailnet IPv4")
            targetHost = `admin@${probe.ipv4}`
            const result = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.targetHost`,
                value: targetHost,
              },
            })
            if (!result.ok) throw new Error(extractIssueMessage(result, "Could not set tailnet targetHost"))
            return targetHost
          },
        })

        await runFinalizeStep({
          id: "switchSshExposure",
          run: async () => {
            const setTailnetMode = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.tailnet.mode`,
                value: "tailscale",
              },
            })
            if (!setTailnetMode.ok) throw new Error(extractIssueMessage(setTailnetMode, "Could not set tailnet mode"))
            const setSshExposure = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.sshExposure.mode`,
                value: "tailnet",
              },
            })
            if (!setSshExposure.ok) throw new Error(extractIssueMessage(setSshExposure, "Could not switch SSH exposure"))
            return "tailnet"
          },
        })

        await runFinalizeStep({
          id: "lockdown",
          run: async () => {
            const start = await lockdownStart({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
              },
            })
            setLockdownRunId(start.runId)
            await lockdownExecute({
              data: {
                projectId: projectId as Id<"projects">,
                runId: start.runId,
                host: props.host,
              },
            })
            return "Queued"
          },
        })
      }

      await runFinalizeStep({
        id: "applyUpdates",
        run: async () => {
          const start = await serverUpdateApplyStart({
            data: {
              projectId: projectId as Id<"projects">,
              host: props.host,
            },
          })
          setApplyRunId(start.runId)
          await serverUpdateApplyExecute({
            data: {
              projectId: projectId as Id<"projects">,
              runId: start.runId,
              host: props.host,
              targetHost,
              confirm: `apply updates ${props.host}`,
            },
          })
          return targetHost ? `Queued (${targetHost})` : "Queued"
        },
      })

      return true
    },
    onSuccess: () => {
      setFinalizeState("succeeded")
      toast.success("Server hardening queued")
      void queryClient.invalidateQueries({
        queryKey: ["gitRepoStatus", projectId],
      })
      void queryClient.invalidateQueries({
        queryKey: setupConfigProbeQueryKey(projectId),
      })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setFinalizeState("failed")
      setFinalizeError(message)
      toast.error(message)
    },
  })

  async function saveDraftAndQueuePredeploy(): Promise<void> {
    if (!projectId) throw new Error("Project not ready")

    const infrastructurePatch: SetupDraftInfrastructure = {
      serverType: desired.infrastructure.serverType,
      image: desired.infrastructure.image,
      location: desired.infrastructure.location,
      allowTailscaleUdpIngress: desired.infrastructure.allowTailscaleUdpIngress,
    }
    const connectionPatch: SetupDraftConnection = {
      adminCidr: desired.connection.adminCidr,
      sshExposureMode: desired.connection.sshExposureMode,
      sshKeyCount: desired.connection.sshKeyCount,
      sshAuthorizedKeys: desired.connection.sshAuthorizedKeys,
    }

    if (!infrastructurePatch.serverType?.trim() || !infrastructurePatch.location?.trim()) {
      throw new Error("Host settings incomplete. Set server type and location.")
    }
    if (!connectionPatch.adminCidr?.trim()) {
      throw new Error("Server access incomplete. Set admin CIDR.")
    }
    if (!connectionPatch.sshAuthorizedKeys?.length) {
      throw new Error("Server access incomplete. Add at least one SSH key.")
    }
    if (adminPasswordRequired && !adminPassword) {
      throw new Error("Server access incomplete. Set admin password.")
    }

    const savedNonSecretDraft = await setupDraftSaveNonSecret({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        patch: {
          infrastructure: infrastructurePatch,
          connection: {
            ...connectionPatch,
            sshKeyCount: connectionPatch.sshAuthorizedKeys.length,
          },
        },
      },
    })

    const preferredRunnerId = savedNonSecretDraft?.sealedSecretDrafts?.hostBootstrapCreds?.targetRunnerId
      || props.setupDraft?.sealedSecretDrafts?.hostBootstrapCreds?.targetRunnerId
    const targetRunner = preferredRunnerId
      ? sealedRunners.find((runner) => String(runner._id) === String(preferredRunnerId))
      : sealedRunners[0] ?? null
    if (!targetRunner) throw new Error("No sealed-capable runner online. Start runner and retry.")

    const targetRunnerId = String(targetRunner._id) as Id<"runners">
    const runnerPub = String(targetRunner.capabilities?.sealedInputPubSpkiB64 || "").trim()
    const keyId = String(targetRunner.capabilities?.sealedInputKeyId || "").trim()
    const alg = String(targetRunner.capabilities?.sealedInputAlg || "").trim()
    if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

    const ensuredHostSopsKey = await generateSopsAgeKey({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
      },
    })
    if (!ensuredHostSopsKey.ok) {
      throw new Error(ensuredHostSopsKey.message || "Could not prepare host-scoped SOPS key for setup.")
    }
    const hostScopedSopsAgeKeyPath = String(ensuredHostSopsKey.keyPath || "").trim()
    if (!hostScopedSopsAgeKeyPath) throw new Error("Could not prepare host-scoped SOPS key for setup.")

    let currentDraftVersion = savedNonSecretDraft?.version
    const deployCredsPayload: Record<string, string> = {
      SOPS_AGE_KEY_FILE: hostScopedSopsAgeKeyPath,
    }
    const deployCredsAad = buildSetupDraftSectionAad({
      projectId: projectId as Id<"projects">,
      host: props.host,
      section: "hostBootstrapCreds",
      targetRunnerId,
    })
    const deployCredsSealedInputB64 = await sealForRunner({
      runnerPubSpkiB64: runnerPub,
      keyId,
      alg,
      aad: deployCredsAad,
      plaintextJson: JSON.stringify(deployCredsPayload),
    })
    const savedDeployCredsDraft = await setupDraftSaveSealedSection({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        section: "hostBootstrapCreds",
        targetRunnerId,
        sealedInputB64: deployCredsSealedInputB64,
        sealedInputAlg: alg,
        sealedInputKeyId: keyId,
        aad: deployCredsAad,
        expectedVersion: currentDraftVersion,
      },
    })
    currentDraftVersion = savedDeployCredsDraft.version

    const bootstrapSecretsPayload: Record<string, string> = {}
    if (adminPassword) bootstrapSecretsPayload.adminPassword = adminPassword

    const bootstrapSecretsAad = buildSetupDraftSectionAad({
      projectId: projectId as Id<"projects">,
      host: props.host,
      section: "hostBootstrapSecrets",
      targetRunnerId,
    })
    const bootstrapSecretsSealedInputB64 = await sealForRunner({
      runnerPubSpkiB64: runnerPub,
      keyId,
      alg,
      aad: bootstrapSecretsAad,
      plaintextJson: JSON.stringify(bootstrapSecretsPayload),
    })
    await setupDraftSaveSealedSection({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        section: "hostBootstrapSecrets",
        targetRunnerId,
        sealedInputB64: bootstrapSecretsSealedInputB64,
        sealedInputAlg: alg,
        sealedInputKeyId: keyId,
        aad: bootstrapSecretsAad,
        expectedVersion: currentDraftVersion,
      },
    })

    await queryClient.invalidateQueries({ queryKey: ["setupDraft", projectId, props.host] })
    setPredeployCheck("sealedDrafts", "passed", "Host bootstrap secrets queued")

    const setupApply = await setupDraftCommit({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
      },
    })
    setSetupApplyRunId(setupApply.runId)

    const doctor = await runDoctor({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        scope: "bootstrap",
      },
    })
    setPredeployCheck(
      "setupApply",
      "passed",
      `setup_apply ${String(setupApply.runId)}; doctor ${String(doctor.runId)}`,
    )
  }

  const runPredeploy = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      setPredeployState("running")
      setPredeployError(null)
      setPredeployChecks(initialPredeployChecks())
      setPredeployReadyFingerprint(null)

      if (!runnerOnline) {
        setPredeployCheck("runner", "failed", "Runner offline")
        throw new Error("Runner offline. Start runner first.")
      }
      if (!runnerNixReadiness.ready) {
        setPredeployCheck("runner", "failed", nixGateMessage || "Runner missing Nix")
        throw new Error(nixGateMessage || "Runner is online but Nix is missing.")
      }
      if (sealedRunners.length === 0) {
        setPredeployCheck("runner", "failed", "No sealed-capable runner online")
        throw new Error("No sealed-capable runner online. Start runner and retry.")
      }
      setPredeployCheck("runner", "passed", "Runner online and sealed-capable")

      if (repoGateBlocked) {
        setPredeployCheck("repo", "failed", deployStatusReason || "Repo not ready")
        throw new Error(deployStatusReason || "Repo not ready for deploy.")
      }
      setPredeployCheck("repo", "passed", selectedRev ? `revision ${selectedRev.slice(0, 7)}` : "ready")

      if (sshKeyGateBlocked) {
        setPredeployCheck("ssh", "failed", sshKeyGateMessage || "SSH setup incomplete")
        throw new Error(sshKeyGateMessage || "SSH setup incomplete.")
      }
      setPredeployCheck("ssh", "passed", `${desired.connection.sshAuthorizedKeys.length} key(s)`)

      if (adminPasswordGateBlocked) {
        setPredeployCheck("adminPassword", "failed", adminPasswordGateMessage || "Admin password missing")
        throw new Error(adminPasswordGateMessage || "Server access incomplete. Set admin password.")
      }
      setPredeployCheck(
        "adminPassword",
        "passed",
        adminPasswordRequired ? "provided for bootstrap" : "existing admin_password_hash configured",
      )

      if (credsGateBlocked) {
        setPredeployCheck("projectCreds", "failed", credsGateMessage || "Project credentials missing")
        throw new Error(credsGateMessage || "Project credentials missing.")
      }
      setPredeployCheck("projectCreds", "passed", "GitHub token configured")

      await saveDraftAndQueuePredeploy()
      setPredeployState("ready")
      setPredeployReadyFingerprint(predeployFingerprintRef.current)
      setPredeployUpdatedAt(Date.now())
      return true
    },
    onSuccess: () => {
      toast.success("Predeploy checks passed")
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setPredeployState("failed")
      setPredeployError(message)
      toast.error(message)
    },
  })

  const startDeploy = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (predeployState !== "ready" || predeployReadyFingerprint !== predeployFingerprint) {
        throw new Error("Run predeploy checks first and confirm green summary.")
      }
      if (!selectedRev) throw new Error("No pushed revision found.")
      if (canAutoLockdown && !isTailnet) {
        const setTailnetMode = await configDotSet({
          data: {
            projectId: projectId as Id<"projects">,
            path: `hosts.${props.host}.tailnet.mode`,
            value: "tailscale",
          },
        })
        if (!setTailnetMode.ok) throw new Error(extractIssueMessage(setTailnetMode, "Could not set tailnet mode"))
      }

      const started = await bootstrapStart({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
          mode: "nixos-anywhere",
        },
      })
      setBootstrapRunId(started.runId)
      setBootstrapStatus("running")
      await bootstrapExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: started.runId,
          host: props.host,
          mode: "nixos-anywhere",
          force: false,
          dryRun: false,
          lockdownAfter: canAutoLockdown,
          rev: selectedRev,
        },
      })
      return started
    },
    onSuccess: () => {
      toast.info("Deploy started")
    },
    onError: (error) => {
      setBootstrapStatus("failed")
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  const isBootstrapped = props.hasBootstrapped || bootstrapStatus === "succeeded"
  const predeployReady = predeployState === "ready" && predeployReadyFingerprint === predeployFingerprint
  const canRunPredeploy = !isBootstrapped
    && !runPredeploy.isPending
    && !startDeploy.isPending
    && runnerOnline
    && Boolean(projectId)
  const canStartDeploy = !isBootstrapped
    && !startDeploy.isPending
    && predeployReady
    && runnerOnline
    && Boolean(projectId)
  const cardStatus = !isBootstrapped
    ? predeployState === "running"
      ? "Running predeploy checks..."
      : predeployReady
        ? "Predeploy checks are green. Review summary, then deploy."
        : predeployState === "failed"
          ? predeployError || "Predeploy checks failed."
          : deployStatusReason
    : finalizeState === "running"
      ? "Auto-hardening running..."
      : finalizeState === "failed"
        ? finalizeError || "Automatic hardening failed."
        : "Server deployed. Continue setup."

  const showSuccessBanner = isBootstrapped && (finalizeState === "succeeded" || finalizeState === "idle")
  const successMessage = finalizeState === "succeeded"
    ? "Initial install succeeded and post-bootstrap hardening was queued automatically."
    : bootstrapStatus === "succeeded"
      ? "Initial install succeeded."
      : "Server already deployed for this host."

  return (
    <SettingsSection
      title="Install server"
      description="Deploy this host with safe defaults. Advanced controls stay on the full deploy page."
      headerBadge={props.headerBadge}
      statusText={cardStatus}
      actions={!isBootstrapped ? (
        predeployReady ? (
          <AsyncButton
            type="button"
            disabled={!canStartDeploy}
            pending={startDeploy.isPending}
            pendingText="Deploying..."
            onClick={() => startDeploy.mutate()}
          >
            Deploy now
          </AsyncButton>
        ) : (
          <AsyncButton
            type="button"
            disabled={!canRunPredeploy}
            pending={runPredeploy.isPending}
            pendingText="Checking..."
            onClick={() => runPredeploy.mutate()}
          >
            Run predeploy
          </AsyncButton>
        )
      ) : finalizeState === "running" ? (
        <AsyncButton type="button" disabled pending pendingText="Finishing...">
          Finalizing
        </AsyncButton>
      ) : (
        <Button type="button" onClick={props.onContinue}>
          Continue
        </Button>
      )}
    >
      <div className="space-y-4">
        {props.showRunnerStatusBanner !== false ? (
          <RunnerStatusBanner
            projectId={projectId as Id<"projects">}
            setupHref={`/${props.projectSlug}/hosts/${props.host}/setup`}
            runnerOnline={runnerOnline}
            isChecking={runnersQuery.isPending}
          />
        ) : null}

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          Host: <code>{props.host}</code>
        </div>

        {isBootstrapped && desiredSshExposureMode !== "tailnet" ? (
          <Alert variant="destructive">
            <AlertTitle>SSH may still be publicly exposed</AlertTitle>
            <AlertDescription>
              <div>SSH exposure is not set to <code>tailnet</code> (current: <code>{desiredSshExposureMode || "unknown"}</code>).</div>
              <div className="pt-1">Enable tailnet mode and run lockdown to close public SSH access.</div>
            </AlertDescription>
          </Alert>
        ) : !isBootstrapped && !canAutoLockdown && wantsTailscaleLockdown ? (
          <Alert
            variant={adminCidrWorldOpen ? "destructive" : "default"}
            className={adminCidrWorldOpen
              ? undefined
              : "border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"}
          >
            <AlertTitle>{adminCidrWorldOpen ? "Auto-lockdown pending (SSH world-open)" : "Auto-lockdown pending"}</AlertTitle>
            <AlertDescription>
              <div>
                Current SSH mode: <code>{desiredSshExposureMode || "bootstrap"}</code>.
                Admin CIDR: <code>{adminCidr || "unset"}</code>.
              </div>
              {autoLockdownMissingTailscaleKey ? (
                <div className="pt-1">Add an active project Tailscale auth key to enable automatic lockdown.</div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          {!isBootstrapped && nixGateMessage && !repoGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>Nix missing on runner</AlertTitle>
              <AlertDescription>
                <div>{nixGateMessage}</div>
                <div className="pt-1">
                  Install command: <code>curl -fsSL https://install.determinate.systems/nix | sh -s -- install --no-confirm</code>
                </div>
                <div className="pt-1">
                  Runner: <code>{runnerNixReadiness.runnerName || "unknown"}</code>.
                  {runnerNixReadiness.nixBin ? <> NIX_BIN: <code>{runnerNixReadiness.nixBin}</code>.</> : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && sshKeyGateMessage && !repoGateBlocked && !nixGateBlocked ? (
            <Alert
              variant={sshKeyGateUi.variant}
            >
              <AlertTitle>
                {sshKeyGateUi.title || "SSH key required"}
              </AlertTitle>
              <AlertDescription>
                <div>{sshKeyGateMessage}</div>
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && adminPasswordGateMessage && !repoGateBlocked && !nixGateBlocked && !sshKeyGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>Admin password required</AlertTitle>
              <AlertDescription>
                <div>{adminPasswordGateMessage}</div>
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && credsGateMessage && !repoGateBlocked && !nixGateBlocked && !sshKeyGateBlocked && !adminPasswordGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>Provider token required</AlertTitle>
              <AlertDescription>
                <div>{credsGateMessage}</div>
              </AlertDescription>
            </Alert>
          ) : null}
          {!isBootstrapped && readiness.reason !== "ready" && readiness.reason !== "repo_pending" ? (
            <Alert
              variant={readiness.severity === "error" ? "destructive" : "default"}
              className={readiness.severity === "warning"
                ? "border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"
                : undefined}
            >
              <AlertTitle>{readiness.title || "Deploy blocked"}</AlertTitle>
              <AlertDescription>
                {readiness.detail || readiness.message}
                {readiness.reason === "repo_error" && repoStatus.error ? (
                  <div className="mt-1 font-mono text-xs">{String(repoStatus.error)}</div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        {!isBootstrapped && predeployState === "failed" && predeployError ? (
          <Alert variant="destructive">
            <AlertTitle>Predeploy failed</AlertTitle>
            <AlertDescription>{predeployError}</AlertDescription>
          </Alert>
        ) : null}

        {!isBootstrapped && predeployState !== "idle" ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Predeploy summary</div>
              <Badge variant={predeployReady ? "secondary" : predeployState === "failed" ? "destructive" : "outline"}>
                {predeployReady ? "Green" : predeployState === "failed" ? "Failed" : "Running"}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {predeployChecks.map((check) => (
                <div key={check.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-2 py-1.5">
                  <div className="min-w-0 text-xs">
                    <div className="font-medium">{check.label}</div>
                    {check.detail ? <div className="truncate text-muted-foreground">{check.detail}</div> : null}
                  </div>
                  <Badge
                    variant={
                      check.state === "passed"
                        ? "secondary"
                        : check.state === "failed"
                          ? "destructive"
                          : "outline"
                    }
                    className="shrink-0"
                  >
                    {check.state === "pending" && predeployState === "running" ? <Spinner className="mr-1 size-3" /> : null}
                    {check.state === "passed" ? "Passed" : check.state === "failed" ? "Failed" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
            {predeployUpdatedAt ? (
              <div className="text-xs text-muted-foreground">
                Last update: {new Date(predeployUpdatedAt).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
        ) : null}

        {showSuccessBanner ? (
          <div className="relative overflow-hidden rounded-md border border-emerald-300/50 bg-emerald-50/60 p-3">
            <span className="absolute -top-3 -right-3 size-14 rounded-full bg-emerald-300/30 motion-safe:animate-ping motion-reduce:animate-none" />
            <div className="relative flex items-start gap-2">
              <CheckCircleIcon className="mt-0.5 size-5 text-emerald-700" />
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-emerald-900">
                  <SparklesIcon className="size-4 text-emerald-700" />
                  Server deployed
                </div>
                <div className="text-xs text-emerald-900/90">
                  {successMessage}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {finalizeState !== "idle" ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-sm font-medium">Post-bootstrap automation</div>
            <div className="space-y-1.5">
              {finalizeSteps.map((step) => (
                <div key={step.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-2 py-1.5">
                  <div className="min-w-0 text-xs">
                    <div className="font-medium">{step.label}</div>
                    {step.detail ? <div className="truncate text-muted-foreground">{step.detail}</div> : null}
                  </div>
                  <Badge variant={stepBadgeVariant(step.status)} className="shrink-0">
                    {step.status === "running" ? <Spinner className="mr-1 size-3" /> : null}
                    {stepBadgeLabel(step.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {bootstrapRunId ? (
          <RunLogTail
            runId={bootstrapRunId}
            onDone={(status) => {
              if (status === "succeeded") {
                setBootstrapStatus("succeeded")
                if (!finalizeStartedRef.current) {
                  finalizeStartedRef.current = true
                  startFinalize.mutate()
                }
              } else if (status === "failed" || status === "canceled") {
                setBootstrapStatus("failed")
              }
            }}
          />
        ) : null}

        {setupApplyRunId ? <RunLogTail runId={setupApplyRunId} /> : null}
        {lockdownRunId ? <RunLogTail runId={lockdownRunId} /> : null}
        {applyRunId ? <RunLogTail runId={applyRunId} /> : null}
      </div>
    </SettingsSection>
  )
}
