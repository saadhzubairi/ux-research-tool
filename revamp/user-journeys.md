# User Journeys — Page/Slice Rework

Researcher-facing flows, referencing the concrete UI/backend pieces described in the other revamp docs.

## 1. First-time setup & calibration

Unchanged by this rework (see extension-improvements.md — calibration/offscreen pipeline untouched). Researcher installs the extension, runs the 13-point calibration (`calibration/CalibrationApp.tsx`), validation gate blocks a poor calibration from being saved. Worth restating here only because every downstream journey depends on it: slice quality is bounded by calibration quality, nothing in the rework changes that dependency.

## 2. Starting a session and watching it live

1. Researcher clicks "Start Tracking" on the target app's tab. `session_start` fires, `Session` doc created.
2. First `slice` message arrives (`trigger: 'navigation'`, since every session starts by "entering" its first page) → server opens `Page` 0, ingests `Slice` 0.
3. Researcher opens the dashboard (`SessionDetailPage` for this session, `session.status === 'active'`). `useLiveSession` subscribes over WS (frontend-architecture.md). The heatmap tab shows the current screenshot with **zero fixation points**, then visibly gains points as slices stream in — this is the core new capability the rework is built around: today the researcher gets nothing until the session ends and they refresh.
4. As the test user navigates within the target app (SPA route change or full navigation), `spaDetector`/`onUpdated` fires an immediate `trigger: 'navigation'` slice, the server closes the prior `Page` and opens a new one, and `HeatmapUrlTabs` in the dashboard gains a new tab live (via the `usePagesQuery` invalidation on `pageId` change).
5. As the test user scrolls, cadence drops to 1s/slice (extension-improvements.md) — researcher doesn't need to know this is happening, but it means the live heatmap updates less frequently during scroll and catches back up once scrolling stops.
6. Researcher clicks "Stop Tracking." `session_end` fires, `session.status → 'completed'`, the dashboard's live WS subscription tears down, view falls back to the standard post-hoc fetch (same component, no visible transition beyond "no longer growing").

## 3. Reviewing a completed session

1. Researcher opens the session from `SessionList` (unchanged).
2. Lands on the Heatmap tab: `HeatmapUrlTabs` lists every `Page` visited (now correctly showing repeat visits to the same URL as separate tabs, per database-structure.md — previously these silently merged).
3. Selects a page tab → `SliceTimeline` loads that page's slices, defaulting to the final slice (full-session heatmap for that page). Researcher scrubs backward to see the heatmap build up progressively after the fact, or forward again to the end — same unified control now drives both the heatmap accumulation and the screenshot shown underneath it (frontend-architecture.md).
4. Researcher switches to a moment-by-moment view (formerly "Replay," now screenshot-scrubbing with the gaze trail overlay) to watch individual fixations land on specific elements, using the same `SliceTimeline` — no second desynced player to reconcile, unlike today's rrweb-based replay.
5. Researcher checks the Elements tab for dwell-time ranking (`ElementTable`/`AttentionChart`) — same UI, now backed by precomputed fixations so the tab loads instantly instead of paying an I-DT compute pass on first request.

## 4. Comparing across sessions on the same page

1. Researcher goes to the aggregate Heatmaps view (`HeatmapsPage`, unchanged — still URL-keyed by design since aggregation is explicitly "all sessions that visited this URL," not page-instance-scoped).
2. Picks a URL, sees the combined heatmap across every session/page-visit that hit it, screenshot drawn from a representative slice.
3. Optionally enters compare mode to view two URLs (or two date ranges) side by side — same as today.

## 5. Deleting a session

`DELETE /api/sessions/:id` cascades: today deletes `Session`, `GazeEvent`, `RrwebEvent`, `Screenshot` docs plus on-disk screenshot files. Post-rework: cascades `Session`, `Page`, `Slice` docs (fixations are embedded in `Slice`, nothing separate to clean up) plus on-disk screenshot files referenced by `Slice.screenshot.filePath` — same shape of operation, fewer collections to touch since gaze points are no longer a separate top-level collection.

## 6. Data aging out

Researcher isn't directly involved, but should understand: raw slice data (screenshots + gaze points + fixations) expires after 90 days (TTL, carried over from today's `gazeevents` policy per database-structure.md) while `Session` and `Page` metadata (which URLs were visited, when, calibration quality) persists indefinitely. A session older than 90 days still shows up in `SessionList` with its metadata intact, but its Heatmap/Replay tabs will be empty — this mirrors a known trap already documented from the current system ("phantom `totalGazePoints` with 0 docs") and the rework doesn't remove that trap, just carries the same policy forward until retention is explicitly redesigned.
