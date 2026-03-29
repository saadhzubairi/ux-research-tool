import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  SessionMeta,
  HeatmapData,
  ReplayData,
  ElementAttention,
  ApiResponse,
  SessionsQuery,
} from '@gazekit/shared'
import api from './client'

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

export function useHeatmapQuery(sessionId: string, url?: string) {
  return useQuery({
    queryKey: ['heatmap', sessionId, url],
    queryFn: () =>
      api
        .get<ApiResponse<HeatmapData>>(`/api/heatmap/${sessionId}`, {
          params: { url },
        })
        .then((r) => r.data),
    enabled: !!sessionId && !!url,
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

export function useReplayQuery(sessionId: string) {
  return useQuery({
    queryKey: ['replay', sessionId],
    queryFn: () =>
      api
        .get<ApiResponse<ReplayData>>(`/api/sessions/${sessionId}/replay`)
        .then((r) => r.data),
    enabled: !!sessionId,
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
