import { useEffect, useMemo, useRef } from "react"
import type { editor as MonacoEditor } from "monaco-editor"
import { DiagnosticSeverity } from "vscode-languageserver-types"
import { TextDocument } from "vscode-languageserver-textdocument"
import { getLanguageService } from "vscode-json-languageservice"
import { setupMonacoEnvironment } from "~/lib/monaco-env"
import { createDebouncedIdleRunner } from "~/lib/idle-debounce"
import "monaco-editor/min/vs/editor/editor.main.css"

export type JsonEditorDiagnostic = {
  message: string
  severity: "error" | "warning"
  line: number
  column: number
  endLine: number
  endColumn: number
}

type MonacoJsonEditorProps = {
  value: string
  onChange: (value: string) => void
  schema: Record<string, unknown>
  schemaId: string
  readOnly?: boolean
  onDiagnostics?: (diagnostics: JsonEditorDiagnostic[]) => void
}

type MonacoModule = typeof import("monaco-editor")

const schemaCache = new Map<string, string>()
const SCHEMA_CACHE_MAX = 24

function normalizeSchemaUri(uri: string): string {
  return uri.trim()
}

const MAX_SCHEMA_BYTES = 512 * 1024
const SCHEMA_TIMEOUT_MS = 3000

function getAllowedOrigin(): string | null {
  if (typeof window === "undefined") return null
  return window.location.origin
}

async function schemaRequestService(uri: string): Promise<string> {
  const normalized = normalizeSchemaUri(uri)
  if (schemaCache.has(normalized)) return schemaCache.get(normalized)!
  if (!/^https?:\/\//i.test(normalized)) throw new Error(`unsupported schema uri: ${normalized}`)
  const allowedOrigin = getAllowedOrigin()
  let targetOrigin = ""
  try {
    targetOrigin = new URL(normalized).origin
  } catch {
    throw new Error("invalid schema uri")
  }
  if (!allowedOrigin || targetOrigin !== allowedOrigin) {
    throw new Error("schema fetch blocked by origin policy")
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), SCHEMA_TIMEOUT_MS)
  try {
    const res = await fetch(normalized, { signal: controller.signal, redirect: "error" })
    if (!res.ok) throw new Error(`schema fetch failed: ${res.status}`)
    const text = await res.text()
    if (text.length > MAX_SCHEMA_BYTES) throw new Error("schema too large")
    schemaCache.set(normalized, text)
    if (schemaCache.size > SCHEMA_CACHE_MAX) {
      const overflow = schemaCache.size - SCHEMA_CACHE_MAX
      let removed = 0
      for (const key of schemaCache.keys()) {
        schemaCache.delete(key)
        removed += 1
        if (removed >= overflow) break
      }
    }
    return text
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message)
  } finally {
    window.clearTimeout(timer)
  }
}

export async function __test_schemaRequestService(uri: string): Promise<string> {
  return await schemaRequestService(uri)
}

export function MonacoJsonEditor(props: MonacoJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const monacoRef = useRef<MonacoModule | null>(null)
  const applyingExternalChange = useRef(false)
  const currentSchemaId = useRef("")
  const schemaRef = useRef(props.schema)
  const schemaIdRef = useRef(props.schemaId)
  const onChangeRef = useRef(props.onChange)
  const onDiagnosticsRef = useRef(props.onDiagnostics)
  const validationRunner = useRef<ReturnType<typeof createDebouncedIdleRunner> | null>(null)

  const languageService = useMemo(
    () =>
      getLanguageService({
        schemaRequestService,
        workspaceContext: {
          resolveRelativePath: (relative, resource) => {
            try {
              const base = new URL(resource)
              return new URL(relative, base).toString()
            } catch {
              return relative
            }
          },
        },
      }),
    [],
  )

  const scheduleValidation = () => {
    if (!monacoRef.current || !modelRef.current) return
    if (!validationRunner.current) {
      validationRunner.current = createDebouncedIdleRunner({
        fn: () => void validateNow(),
        delayMs: 400,
        timeoutMs: 1000,
      })
    }
    validationRunner.current.schedule()
  }

  const validateNow = async () => {
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model) return
    const schema = schemaRef.current
    const schemaId = schemaIdRef.current
    if (!schema || !schemaId) return

    if (currentSchemaId.current !== schemaId) {
      languageService.configure({
        validate: true,
        allowComments: false,
        schemas: [
          {
            uri: `inmemory://schema/${schemaId}`,
            fileMatch: [model.uri.toString()],
            schema,
          },
        ],
      })
      currentSchemaId.current = schemaId
    }

    const document = TextDocument.create(model.uri.toString(), "json", model.getVersionId(), model.getValue())
    const jsonDocument = languageService.parseJSONDocument(document)
    const diagnostics = await languageService.doValidation(document, jsonDocument)

    const markers = diagnostics.map((diag) => {
      const severity =
        diag.severity === DiagnosticSeverity.Error ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
      return {
        severity,
        message: diag.message,
        startLineNumber: diag.range.start.line + 1,
        startColumn: diag.range.start.character + 1,
        endLineNumber: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1,
      } satisfies MonacoEditor.IMarkerData
    })

    monaco.editor.setModelMarkers(model, "clawdbot-schema", markers)

    const onDiagnostics = onDiagnosticsRef.current
    if (onDiagnostics) {
      const list = diagnostics.map((diag) => ({
        message: diag.message,
        severity: diag.severity === DiagnosticSeverity.Error ? "error" : "warning",
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        endLine: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1,
      })) satisfies JsonEditorDiagnostic[]
      onDiagnostics(list)
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!containerRef.current) return

    let disposed = false
    setupMonacoEnvironment()

    void (async () => {
      const monaco = await import("monaco-editor")
      if (disposed) return
      monacoRef.current = monaco

      ;(monaco.languages as any).json?.jsonDefaults?.setDiagnosticsOptions({ validate: false })

      const model = monaco.editor.createModel(props.value, "json", monaco.Uri.parse("inmemory://clawdbot/config.json"))
      modelRef.current = model

      const editor = monaco.editor.create(containerRef.current!, {
        model,
        readOnly: props.readOnly ?? false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        automaticLayout: true,
      })

      editorRef.current = editor

      editor.onDidChangeModelContent(() => {
        if (applyingExternalChange.current) return
        const value = model.getValue()
        onChangeRef.current(value)
        scheduleValidation()
      })

      scheduleValidation()

      const updateTheme = () => {
        const isDark = document.documentElement.classList.contains("dark")
        monaco.editor.setTheme(isDark ? "vs-dark" : "vs")
      }
      updateTheme()
      const observer = new MutationObserver(updateTheme)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

      const cleanup = () => observer.disconnect()
      ;(editor as any).__monacoCleanup = cleanup
    })()

    return () => {
      disposed = true
      validationRunner.current?.cancel()
      const editor = editorRef.current
      const model = modelRef.current
      if (editor && (editor as any).__monacoCleanup) (editor as any).__monacoCleanup()
      editor?.dispose()
      model?.dispose()
      editorRef.current = null
      modelRef.current = null
      monacoRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ readOnly: props.readOnly ?? false })
  }, [props.readOnly])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    if (model.getValue() === props.value) return
    applyingExternalChange.current = true
    model.setValue(props.value)
    applyingExternalChange.current = false
    scheduleValidation()
  }, [props.value])

  useEffect(() => {
    schemaRef.current = props.schema
    schemaIdRef.current = props.schemaId
    onChangeRef.current = props.onChange
    onDiagnosticsRef.current = props.onDiagnostics
    scheduleValidation()
  }, [props.schema, props.schemaId, props.onChange, props.onDiagnostics])

  return <div ref={containerRef} className="h-full w-full" />
}
