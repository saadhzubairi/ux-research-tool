import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SliceListItem, DashboardPushMessage } from '@gazekit/shared'
import { WS_CONFIG } from '@gazekit/shared'
import { pagesQueryKey, slicesQueryKey } from './hooks'

/**
 * Resolve the dashboard WS endpoint.
 *
 * Confirmed with backend-slices: the dashboard shares the extension ingestion
 * socket — a single WebSocketServer on WS_CONFIG.PORT (8765), no path. The
 * connection's role is decided by its first message (extensions send
 * session_start; dashboards send subscribe). We derive ws(s)://<api-host>:8765
 * from VITE_API_URL, fully overridable via VITE_WS_URL.
 */
function resolveWsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined
  if (explicit) return explicit

  const apiUrl =
    (import.meta.env.VITE_API_URL as string | undefined) ??
    'http://localhost:4444'
  try {
    const u = new URL(apiUrl)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.port = String(WS_CONFIG.PORT)
    u.pathname = '/'
    return u.toString().replace(/\/$/, '')
  } catch {
    return `ws://localhost:${WS_CONFIG.PORT}`
  }
}

const RECONNECT_DELAY_MS = 3_000
const MAX_RECONNECT_ATTEMPTS = 10

interface LiveSessionState {
  connected: boolean
}

// useSlicesQuery caches the ApiResponse<SliceListItem[]> wrapper it returns.
type SlicesCache = { success: boolean; data: SliceListItem[] } | undefined

/**
 * Opens (or reuses) a WS connection for an *active* session, subscribes to its
 * slice stream, and folds each `slice_ingested` / `slice_updated` push into the
 * TanStack Query cache so the rest of the read path (useSlicesQuery /
 * usePagesQuery) sees the new data with no separate live store. When a slice
 * arrives for a previously unseen pageId (navigation), the pages query is
 * invalidated so HeatmapUrlTabs gains the new tab live.
 *
 * Pass `enabled: false` (e.g. once session.status === 'completed') to tear the
 * subscription down and fall back to plain REST fetches.
 */
export function useLiveSession(
  sessionId: string,
  enabled: boolean,
): LiveSessionState {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  // pageIds we've already seen a slice for — used to detect navigation.
  const knownPagesRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled || !sessionId) return

    let disposed = false
    knownPagesRef.current = new Set()

    const appendSlice = (pageId: string, slice: SliceListItem) => {
      // Append into the base-range slice list (the one the live view reads).
      queryClient.setQueryData(
        slicesQueryKey(sessionId, pageId),
        (prev: SlicesCache) => {
          const list = prev?.data ?? []
          // Guard against duplicate delivery / reconnect replays.
          if (list.some((s) => s.sliceIndex === slice.sliceIndex)) return prev
          const next = [...list, slice].sort((a, b) => a.sliceIndex - b.sliceIndex)
          return { success: true, data: next }
        },
      )

      // New page instance -> refresh the tab list.
      if (!knownPagesRef.current.has(pageId)) {
        knownPagesRef.current.add(pageId)
        queryClient.invalidateQueries({ queryKey: pagesQueryKey(sessionId) })
      }
    }

    // Late-arriving fixations for an already-ingested slice.
    const patchFixations = (
      pageId: string,
      sliceIndex: number,
      fixations: SliceListItem['fixations'],
    ) => {
      queryClient.setQueryData(
        slicesQueryKey(sessionId, pageId),
        (prev: SlicesCache) => {
          if (!prev?.data) return prev
          let changed = false
          const next = prev.data.map((s) => {
            if (s.sliceIndex !== sliceIndex) return s
            changed = true
            return { ...s, fixations }
          })
          return changed ? { success: true, data: next } : prev
        },
      )
    }

    const connect = () => {
      if (disposed) return
      let ws: WebSocket
      try {
        ws = new WebSocket(resolveWsUrl())
      } catch (err) {
        console.error('[useLiveSession] failed to open WS', err)
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) return
        attemptsRef.current = 0
        setConnected(true)
        ws.send(JSON.stringify({ type: 'subscribe', payload: { sessionId } }))
      }

      ws.onmessage = (event) => {
        let msg: DashboardPushMessage
        try {
          msg = JSON.parse(event.data as string)
        } catch {
          return
        }
        if (!msg || msg.payload?.sessionId !== sessionId) return
        if (msg.type === 'slice_ingested') {
          appendSlice(msg.payload.pageId, msg.payload.slice)
        } else if (msg.type === 'slice_updated') {
          patchFixations(
            msg.payload.pageId,
            msg.payload.sliceIndex,
            msg.payload.fixations,
          )
        }
      }

      ws.onclose = () => {
        if (disposed) return
        setConnected(false)
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose will follow and drive the reconnect.
        ws.close()
      }
    }

    const scheduleReconnect = () => {
      if (disposed) return
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return
      attemptsRef.current += 1
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
    }

    connect()

    return () => {
      disposed = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      setConnected(false)
      const ws = wsRef.current
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        // Best-effort unsubscribe before closing.
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'unsubscribe', payload: { sessionId } }))
          } catch {
            /* ignore */
          }
        }
        ws.close()
      }
      wsRef.current = null
    }
  }, [sessionId, enabled, queryClient])

  return { connected }
}
