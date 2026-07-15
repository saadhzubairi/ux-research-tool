# Backend Structure — Page/Slice Rework

## WebSocket ingestion (`packages/web/server/src/ws/wsServer.ts`)

Today's five relevant handlers (`handleGazeBatch`, `handleRrwebEvents`, `handlePageScreenshot`, plus the visit-detection heuristic embedded in the screenshot handler) collapse into one: `handleSlice`, matching the single `slice` message type defined in extension-improvements.md.

```
handleSlice({ sessionId, trigger, capturedAt, url, scrollX, scrollY, viewportWidth, viewportHeight, gazePoints, screenshotDataUrl }):
  1. normalizeGazeUrl(url)  // existing shared/utils/urlNormalizer.ts, unchanged
  2. resolve current Page for this session:
     - trigger === 'navigation' OR no active Page OR active Page.url !== normalized url:
         close active Page (leftAt = capturedAt), create new Page (pageIndex = prevCount, url, enteredAt = capturedAt)
     - else: reuse active Page
  3. decode screenshotDataUrl + write to disk (same path scheme as today's Screenshot storage, now keyed
     by pageId/sliceIndex instead of the old visitIndex heuristic) — every slice carries a fresh screenshot
     now that the extension sources frames from a chrome.tabCapture stream instead of polling
     captureVisibleTab, so there's no throttle-fallback/reuse case to handle here (see extension-improvements.md)
  4. insert Slice doc (sliceIndex = Page.sliceCount, gazePoints embedded, fixations: null)
  5. $inc Page.sliceCount, $inc Session.stats.totalGazePoints (same accumulation as today)
  6. broadcast to any subscribed dashboard WS clients watching this session (see "Live push" below)
  7. enqueue async fixation computation for this slice (see below) — does not block the ack
```

This removes the fragile "compare against most-recent screenshot" visit-detection heuristic (`wsServer.ts:213-234`) entirely — page boundaries are now explicit (`trigger === 'navigation'`, or a URL mismatch as a safety net for missed SPA transitions) rather than inferred from screenshot arrival order.

## Fixation computation — moves from request-time to ingest-time

Today, `fixationService.getFixations` runs I-DT on-demand per API request, with an in-memory LRU cache (`fixationService.ts:10-29`) keyed by session+url+range — meaning the very first heatmap request for a session pays the full dispersion-threshold pass over every gaze point, and the cache is cold again after any server restart.

New: fixation detection runs once per slice, at ingest time (step 7 above), over that slice's own gaze points plus a small trailing window from the previous 1-2 slices (I-DT needs temporal continuity across the boundary — a fixation can span a slice edge). Store the result in `Slice.fixations`. This is a genuine architecture shift, not just a cache-warming trick: it means the heatmap/replay read path becomes a pure aggregation query (`Slice.find({pageId, capturedAt: {$lte: X}})` → flatten `.fixations`) instead of a compute pass, which is what makes real-time progressive heatmaps on the frontend tractable — there's no per-request recomputation cost gating how often the client can ask "give me the heatmap so far."

`shared/utils/fixationDetector.ts`'s I-DT algorithm itself is unchanged; only its call site and trigger move. The `pxPerDeg`-based dispersion threshold (from `Session.calibration`) still applies the same way.

## REST API changes

`packages/web/server/src/routes/sessions.ts` and `heatmap.ts`:

- `GET /api/sessions/:id/pages` (new) — list `Page` docs for a session, replacing reads of the old embedded `session.pages[]`.
- `GET /api/sessions/:id/pages/:pageId/slices?from=&to=` (new) — paginated/range slice fetch for the timeline UI; returns `{sliceIndex, capturedAt, trigger, screenshot, fixations}` (gaze `points` omitted by default, heavy and rarely needed raw on the client — add `?includePoints=true` if a future feature needs raw dots).
- `GET /api/heatmap/:id?pageId=&to=` — same shape as today's `getSessionHeatmap`, but now `pageId` replaces `url` as the primary key (a session can revisit the same URL as two distinct pages, which the old `url`-keyed query conflated) and `to` is a slice-index or timestamp cutoff, unchanged in spirit from today's timeline heatmap query — just now backed by the precomputed `Slice.fixations` aggregation instead of live I-DT.
- `GET /api/heatmap/aggregate?url=&from=&to=` — unchanged in shape (cross-session, still URL-keyed since that's the whole point of aggregation), but now sources from `Page`+`Slice` instead of `Session.pages`+`GazeEvent`.
- `GET /api/sessions/:id/elements` — unchanged logic, but the ad-hoc 200ms fixation-gap grouping it currently does inline can be deleted in favor of reading `Slice.fixations` directly, now that fixations are precomputed.
- `GET /api/sessions/:id/replay` — only relevant if rrweb replay is kept (extension-improvements.md recommends dropping it); if dropped, this route is deleted along with `RrwebEvent`.
- Screenshot static serving (`routes/screenshots.ts`) — path scheme changes from `sessionId/visitFolder/filename` to `sessionId/pageId/sliceIndex.png`, a strict simplification since page/slice identity is now explicit instead of inferred.

## Live push — new infrastructure

Nothing today streams to the dashboard client during an active session (confirmed: no WS usage on the client beyond a REST status poll). For "heatmap progressively builds in real time on frontend," the server needs to fan out ingested slices to subscribed dashboard clients, not just accept them from the extension.

Simplest correct approach: reuse the existing `ws` server (`wsServer.ts` already runs a WebSocket server for extension ingestion) with a second connection role — the dashboard client opens a WS connection and sends `{type: 'subscribe', sessionId}`; `handleSlice` step 6 above looks up subscribers for that `sessionId` and pushes `{type: 'slice_ingested', pageId, slice: {sliceIndex, capturedAt, screenshot, fixations}}`. This avoids standing up a second real-time channel (SSE, socket.io) when the ingestion WS server already exists and already has per-session routing context. Reconnect/backoff on the client side mirrors the extension's existing `RECONNECT_DELAY_MS`/`MAX_RECONNECT_ATTEMPTS` pattern (`offscreen.ts`) rather than inventing a new scheme.

## What's unaffected

`Session` document (minus the `pages[]` embed), calibration handling, `session_start`/`session_end`/`calibration_update`/`heartbeat` message handlers, and the `/api/status` health route are all unchanged — this rework is scoped to the gaze/screenshot ingestion and read path, not session lifecycle or calibration.
