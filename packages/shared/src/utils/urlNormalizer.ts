/**
 * Canonical URL key for gaze data, screenshots, and session page entries.
 *
 * Heatmap/fixation lookups join gaze `ctx.url` against screenshot/page URLs
 * byte-for-byte, so every write path MUST key URLs through this function —
 * a one-sided transform produces "screenshot renders, Points: 0" pages.
 *
 * Strips the #fragment: anchor jumps are same-page scrolls, not new pages.
 * Tradeoff: hash-ROUTED SPAs collapse into one page entry — acceptable until
 * routing-aware normalization exists, and strictly better than the silent
 * gaze/screenshot key mismatch it replaces.
 */
export function normalizeGazeUrl(url: string): string {
  const hashIndex = url.indexOf('#')
  return hashIndex === -1 ? url : url.slice(0, hashIndex)
}
