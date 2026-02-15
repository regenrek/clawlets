export function SetupStepVerify() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div>
            <div className="text-lg font-medium">Post-bootstrap verification</div>
            <div className="text-xs text-muted-foreground">Continue host security checks from the setup flow.</div>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          Use the host setup stepper for lock-down and verification actions.
        </div>
      </div>
    </div>
  )
}
