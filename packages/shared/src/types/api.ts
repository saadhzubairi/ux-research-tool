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

export interface SlicesQuery {
  from?: string // slice-index or timestamp cutoff (inclusive)
  to?: string
  includePoints?: boolean // include raw gaze `points` (omitted by default)
}

// NOTE: the slices endpoint returns `ApiResponse<SliceListItem[]>` (bare
// array) with an `X-Total-Count` response header — matching the `/elements`
// precedent. There is intentionally no `{total, slices}` wrapper type.

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

export interface ScreenshotInfo {
  index: number
  visitIndex: number
  url: string
  capturedAt: string
  screenshotUrl: string
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
