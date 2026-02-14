export const OPEN_RUNNER_STATUS_DIALOG_EVENT = "clawlets:open-runner-status-dialog"

export function requestOpenRunnerStatusDialog(params: { fallbackHref?: string | null } = {}): void {
  if (typeof window === "undefined") return

  const event = new CustomEvent(OPEN_RUNNER_STATUS_DIALOG_EVENT, { cancelable: true })
  window.dispatchEvent(event)

  const fallbackHref = String(params.fallbackHref || "").trim()
  if (!event.defaultPrevented && fallbackHref) {
    window.location.assign(fallbackHref)
  }
}
