import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  SessionMeta,
  HeatmapData,
  ElementAttention,
  ApiResponse,
  SessionsQuery,
  Page,
  SliceListItem,
  SliceGazePoint,
} from '@gazekit/shared'
import api from './client'

/** A slice-list item with the raw gaze points included (`?includePoints=true`).
 *  Heatmaps are built from raw gaze density, so the session-detail view always
 *  requests points; the aggregate list shape omits them. */
export type SliceWithPoints = SliceListItem & { gazePoints?: SliceGazePoint[] }

/** Canonical query key for a page's slice list. The live WS hook appends into
 *  the base-range ([null, null]) entry, so the live view MUST use
 *  useSlicesQuery(sessionId, pageId) with no from/to to share that cache. */
export function slicesQueryKey(
  sessionId: string,
  pageId: string,
  from?: string,
  to?: string,
) {
  return ['slices', sessionId, pageId, from ?? null, to ?? null] as const
}

export function pagesQueryKey(sessionId: string) {
  return ['pages', sessionId] as const
}

interface SessionsResponse {
  sessions: SessionMeta[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export function useSessionsQuery(filters?: SessionsQuery) {
  return useQuery({
    queryKey: ['sessions', filters],
    queryFn: () =>
      api
        .get<ApiResponse<SessionsResponse>>('/api/sessions', { params: filters })
        .then((r) => r.data),
  })
}

export function useSessionQuery(id: string) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () =>
      api
        .get<ApiResponse<SessionMeta>>(`/api/sessions/${id}`)
        .then((r) => r.data),
    enabled: !!id,
  })
}

export function useAggregateHeatmapQuery(
  url: string,
  from?: string,
  to?: string,
) {
  return useQuery({
    queryKey: ['heatmap-aggregate', url, from, to],
    queryFn: () =>
      api
        .get<ApiResponse<HeatmapData>>('/api/heatmap/aggregate', {
          params: { url, from, to },
        })
        .then((r) => r.data),
    enabled: !!url,
  })
}

/** GET /api/sessions/:id/pages → Page[] (real page instances; repeat visits to
 *  the same URL are distinct entries). Replaces deriving tabs from
 *  SessionMeta.pages string URLs. */
export function usePagesQuery(sessionId: string) {
  return useQuery({
    queryKey: pagesQueryKey(sessionId),
    queryFn: () =>
      api
        .get<ApiResponse<Page[]>>(`/api/sessions/${sessionId}/pages`)
        .then((r) => r.data),
    enabled: !!sessionId,
  })
}

/** GET /api/sessions/:id/pages/:pageId/slices → ApiResponse<SliceListItem[]>
 *  ordered by sliceIndex (total row count is in the X-Total-Count header, which
 *  the client doesn't need — it scrubs the fetched list in memory). Each slice
 *  bundles a viewport screenshot and the fixations captured in its window (raw
 *  gazePoints omitted from the list shape), so scrubbing needs no separate
 *  screenshot/gaze join. The live WS hook appends into this same cache.
 *  `from`/`to` are integer sliceIndex cutoffs (inclusive) when supplied. */
export function useSlicesQuery(
  sessionId: string,
  pageId: string | undefined,
  range?: { from?: string; to?: string },
) {
  return useQuery({
    queryKey: slicesQueryKey(sessionId, pageId ?? '', range?.from, range?.to),
    queryFn: () =>
      api
        .get<ApiResponse<SliceWithPoints[]>>(
          `/api/sessions/${sessionId}/pages/${pageId}/slices`,
          // includePoints: the heatmap renders from raw gaze density, not the
          // (sparse) per-slice fixations, so we need the points on the client.
          { params: { from: range?.from, to: range?.to, includePoints: true } },
        )
        .then((r) => r.data),
    enabled: !!sessionId && !!pageId,
  })
}

export function useElementsQuery(sessionId: string) {
  return useQuery({
    queryKey: ['elements', sessionId],
    queryFn: () =>
      api
        .get<ApiResponse<ElementAttention[]>>(
          `/api/sessions/${sessionId}/elements`,
        )
        .then((r) => r.data),
    enabled: !!sessionId,
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/sessions/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

interface ServerStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  mongo: { connected: boolean; state: string }
  websocket: { activeConnections: number }
  uptime: { seconds: number; formatted: string }
  timestamp: string
}

export function useServerStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () =>
      api
        .get<ApiResponse<ServerStatus>>('/api/status')
        .then((r) => r.data),
    refetchInterval: 5000,
  })
}

export function useDeleteAllSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('/api/sessions'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

export function useExportSession(sessionId: string) {
  return useQuery({
    queryKey: ['export', sessionId],
    queryFn: () =>
      api
        .get<ApiResponse<SessionMeta>>(`/api/sessions/${sessionId}`)
        .then((r) => r.data),
    enabled: false,
  })
}
