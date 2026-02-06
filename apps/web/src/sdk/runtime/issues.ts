export type ValidationIssue = { code: string; path: Array<string | number>; message: string }

export function mapValidationIssues(issues: unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    const i = issue as { code?: unknown; path?: unknown; message?: unknown }
    return {
      code: String(i.code ?? "invalid"),
      path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
      message: String(i.message ?? "Invalid"),
    }
  })
}
