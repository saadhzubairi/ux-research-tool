import type { Page, SliceListItem } from '@gazekit/shared'
import { Screenshot } from '../models/Screenshot'

// Read-time synthesis of Page/Slice shapes from legacy (schemaVersion 1)
// Screenshot docs, so pre-rework sessions remain viewable in the new
// Page/Slice client without a written backfill. A legacy "page" is a visit
// folder (`{sanitizedUrl}-visit-{n}`), which is unique per URL-visit within a
// session and doubles as the synthetic pageId.

export async function getLegacyPages(sessionId: string): Promise<Page[]> {
  const screenshots = await Screenshot.find({ sessionId })
    .sort({ capturedAt: 1 })
    .lean()

  const byVisit = new Map<
    string,
    { url: string; enteredAt: Date; count: number; viewportHeight: number }
  >()
  for (const s of screenshots) {
    const key = s.visitFolder ?? `${s.url}-visit-${s.visitIndex ?? 1}`
    const existing = byVisit.get(key)
    if (!existing) {
      byVisit.set(key, {
        url: s.url ?? '',
        enteredAt: s.capturedAt ? new Date(s.capturedAt) : new Date(0),
        count: 1,
        viewportHeight: s.viewportHeight ?? 1080,
      })
    } else {
      existing.count += 1
    }
  }

  let pageIndex = 0
  const pages: Page[] = []
  for (const [key, v] of byVisit) {
    pages.push({
      _id: key,
      sessionId,
      pageIndex: pageIndex++,
      url: v.url,
      enteredAt: v.enteredAt.toISOString(),
      leftAt: null,
      sliceCount: v.count,
      viewport: { width: 1920, height: v.viewportHeight, dpr: 1 },
      status: 'complete',
    })
  }
  return pages
}

export async function getLegacySlices(
  sessionId: string,
  pageId: string, // = visitFolder
): Promise<SliceListItem[]> {
  const screenshots = await Screenshot.find({ sessionId, visitFolder: pageId })
    .sort({ index: 1, capturedAt: 1 })
    .lean()

  return screenshots.map((s, i) => ({
    _id: String(s._id),
    sessionId,
    pageId,
    sliceIndex: s.index ?? i,
    capturedAt: s.capturedAt ? new Date(s.capturedAt).toISOString() : '',
    trigger: 'interval',
    screenshot: {
      url: s.filename
        ? `/api/screenshots/${sessionId}/${s.visitFolder}/${s.filename}`
        : '',
      scrollX: 0,
      scrollY: s.scrollY ?? 0,
      viewportWidth: 1920,
      viewportHeight: s.viewportHeight ?? 1080,
    },
    // Legacy fixations are served via the url-keyed heatmap path, not per-slice.
    fixations: null,
  }))
}

/** Resolve the URL behind a legacy synthetic pageId (visit folder). */
export async function legacyPageUrl(
  sessionId: string,
  pageId: string,
): Promise<string | null> {
  const s = await Screenshot.findOne({ sessionId, visitFolder: pageId })
    .select({ url: 1 })
    .lean()
  return s?.url ?? null
}
