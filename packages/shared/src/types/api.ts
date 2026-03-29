import type { HeatmapPoint, SessionMeta } from './gaze'

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

export interface SessionsQuery {
  page?: number
  limit?: number
  url?: string
  userId?: string
  from?: string
  to?: string
}

export interface HeatmapData {
  sessionId: string | null
  url: string
  viewportWidth: number
  viewportHeight: number
  points: HeatmapPoint[]
  screenshotUrl: string | null
  sessionCount: number
  totalFixations: number
}

export interface ReplayData {
  session: SessionMeta
  rrwebEvents: any[]
  gazeTimeline: Array<{ ts: number; x: number; y: number; conf: number | null }>
}

export interface ElementAttention {
  selector: string
  tag: string
  text: string
  totalDwellMs: number
  fixationCount: number
  avgFixationMs: number
  firstFixationTs: number
  percentOfTotalDwell: number
}
