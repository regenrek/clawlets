import type { lintOpenclawSecurityConfig } from "@clawlets/core/lib/openclaw/security-lint"
import type { JsonEditorDiagnostic } from "~/components/editor/monaco-json-editor"
import { Badge } from "~/components/ui/badge"

type PathIssue = { path: string; message: string }

type SchemaDiff = {
  added: string[]
  removed: string[]
  changed: Array<{ path: string; oldType: string; newType: string }>
}

export function InlineSecretWarnings(props: {
  findings: Array<{ id: string; detail: string }>
}) {
  if (props.findings.length === 0) return null
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
      <div className="font-medium">Inline secret warnings</div>
      <div className="text-xs text-muted-foreground">
        Do not paste tokens/API keys into OpenClaw config. Use env var refs (for example <code>{"${OPENCLAW_GATEWAY_TOKEN}"}</code>) and
        wire them via secrets.
      </div>
      <ul className="list-disc pl-5 text-muted-foreground">
        {props.findings.slice(0, 6).map((finding) => (
          <li key={finding.id}>{finding.detail}</li>
        ))}
      </ul>
    </div>
  )
}

export function GatewayOpenclawDiagnostics(props: {
  parsedError: string | null
  schemaDiagnostics: JsonEditorDiagnostic[]
  schemaDiff: SchemaDiff | null
  liveIssues: PathIssue[] | null
  securityReport: ReturnType<typeof lintOpenclawSecurityConfig> | null
  serverIssues: PathIssue[] | null
}) {
  return (
    <>
      {props.parsedError ? <div className="text-sm text-destructive">{props.parsedError}</div> : null}

      {props.schemaDiagnostics.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Schema issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {props.schemaDiagnostics.map((issue, idx) => (
              <li key={`${idx}-${issue.line}-${issue.column}`}>
                <code>
                  {issue.line}:{issue.column}
                </code>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.schemaDiff && (props.schemaDiff.added.length + props.schemaDiff.removed.length + props.schemaDiff.changed.length > 0) ? (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="text-sm font-medium">Schema changes (pinned vs live)</div>
          <ul className="text-xs text-muted-foreground space-y-1">
            {props.schemaDiff.added.slice(0, 10).map((path) => (
              <li key={`add-${path}`}>
                <code>+ {path}</code>
              </li>
            ))}
            {props.schemaDiff.removed.slice(0, 10).map((path) => (
              <li key={`rm-${path}`}>
                <code>- {path}</code>
              </li>
            ))}
            {props.schemaDiff.changed.slice(0, 10).map((entry) => (
              <li key={`chg-${entry.path}`}>
                <code>~ {entry.path}</code> ({entry.oldType} → {entry.newType})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.liveIssues && props.liveIssues.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Live schema issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {props.liveIssues.map((issue, idx) => (
              <li key={`${idx}-${issue.path}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.securityReport ? (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Security audit</div>
            <div className="text-xs text-muted-foreground">
              critical={props.securityReport.summary.critical} warn={props.securityReport.summary.warn} info={props.securityReport.summary.info}
            </div>
          </div>
          {props.securityReport.findings.length > 0 ? (
            <ul className="space-y-2 text-sm text-muted-foreground">
              {props.securityReport.findings.map((finding) => (
                <li key={finding.id} className="rounded-md border bg-background/60 p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={finding.severity === "critical" ? "destructive" : finding.severity === "warn" ? "default" : "secondary"}>
                      {finding.severity}
                    </Badge>
                    <span className="font-medium">{finding.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{finding.detail}</div>
                  {finding.remediation ? (
                    <div className="text-xs text-foreground">Recommendation: {finding.remediation}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-muted-foreground">No security findings.</div>
          )}
        </div>
      ) : null}

      {props.serverIssues && props.serverIssues.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Save validation issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {props.serverIssues.map((issue, idx) => (
              <li key={`${idx}-${issue.path}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
