import {
  ErrorComponent,
  Link,
  rootRouteId,
  useMatch,
  useRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { useEffect, useRef } from "react"
import type { MouseEvent } from "react"

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  const row = error as Record<string, unknown>
  if (typeof row.code === "number") return String(row.code)
  if (typeof row.code === "string") return row.code.trim()
  const cause = row.cause
  if (cause && typeof cause === "object") {
    const causeCode = (cause as Record<string, unknown>).code
    if (typeof causeCode === "number") return String(causeCode)
    if (typeof causeCode === "string") return causeCode.trim()
  }
  return ""
}

function isDisconnectErrorCode(code: string): boolean {
  return code === "5" || code === "1005"
}

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  })
  const errorCode = readErrorCode(error)
  const showDisconnectHint = isDisconnectErrorCode(errorCode)
  const invalidateInFlightRef = useRef<Promise<void> | null>(null)
  const lastRecoverConnectionCountRef = useRef<number | null>(null)

  console.error(error)

  useEffect(() => {
    if (!showDisconnectHint) return
    const convexClient = router.options.context?.convexQueryClient?.convexClient
    if (!convexClient) return

    const attemptInvalidate = (snapshot?: { isWebSocketConnected: boolean; connectionCount: number }) => {
      if (invalidateInFlightRef.current) return
      let state: { isWebSocketConnected: boolean; connectionCount: number } | null = snapshot ?? null
      try {
        state ||= convexClient.connectionState()
      } catch {
        state = null
      }
      if (!state?.isWebSocketConnected) return

      if (lastRecoverConnectionCountRef.current === state.connectionCount) return
      lastRecoverConnectionCountRef.current = state.connectionCount

      const promise = router.invalidate().catch(() => null).then(() => undefined)
      invalidateInFlightRef.current = promise
      void promise.finally(() => {
        if (invalidateInFlightRef.current === promise) invalidateInFlightRef.current = null
      })
    }

    attemptInvalidate()
    const unsubscribe = convexClient.subscribeToConnectionState((next) =>
      attemptInvalidate({ isWebSocketConnected: next.isWebSocketConnected, connectionCount: next.connectionCount }),
    )
    return () => unsubscribe()
  }, [router, showDisconnectHint])

  return (
    <div className="min-w-0 flex-1 p-4 flex flex-col items-center justify-center gap-6">
      <ErrorComponent error={error} />
      {showDisconnectHint ? (
        <div className="max-w-xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Connection dropped (error code {errorCode}). Reconnecting automatically. If this persists, check runner process logs for heartbeat/control-plane failures, then retry.
        </div>
      ) : null}
      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={() => {
            void router.invalidate()
          }}
          className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
        >
          Try Again
        </button>
        {isRoot ? (
          <Link
            to="/"
            className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
          >
            Home
          </Link>
        ) : (
          <Link
            to="/"
            className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              e.preventDefault()
              window.history.back()
            }}
          >
            Go Back
          </Link>
        )}
      </div>
    </div>
  )
}
