# Frontend Architecture — Page/Slice Timeline

## Current state (for contrast)

- All data is post-hoc REST fetch (`TanStack Query`, `src/api/hooks.ts`) — nothing live-updates during an active session, confirmed no client WS usage exists.
- `HeatmapCanvas.tsx` renders from a flat `HeatmapData{points: HeatmapPoint[], screenshotUrl}` shape — one screenshot, one point cloud, no notion of a slice sequence.
- `TimelineSlider.tsx` scrubs over `ScreenshotInfo[]` (screenshot-indexed) and drives a timestamp cutoff into `useTimelineHeatmapQuery` — conceptually already close to a slice scrubber, but screenshots and gaze points are separately fetched/joined by timestamp rather than bundled.
- `ReplayPlayer.tsx` + `GazeOverlay.tsx` do rrweb DOM replay with a hand-rolled rAF clock loosely synced to a separately-fetched `gazeTimeline`.
- `HeatmapUrlTabs.tsx` already groups by URL (from `session.pages`) — the closest existing analogue to page grouping.

## New domain layer

Add a proper slice/page domain to `src/api/hooks.ts` and `packages/shared/src/types/api.ts`, mirroring the new server shapes:

```ts
usePagesQuery(sessionId) → Page[]                 // GET /api/sessions/:id/pages
useSlicesQuery(sessionId, pageId, {from,to}) → Slice[]  // GET /api/sessions/:id/pages/:pageId/slices
```

`HeatmapUrlTabs.tsx` switches from deriving tabs off `session.pages` (string URLs) to `usePagesQuery`, giving it real `Page` objects (so revisits to the same URL correctly show as separate tabs instead of merging, fixing a real gap in the current model per database-structure.md).

## Timeline component — unifies `TimelineSlider` and the replay scrub bar

Replace the two independent scrubbers (`TimelineSlider.tsx` for heatmap, the ad-hoc rAF-driven bar inside `ReplayPlayer.tsx`) with one `SliceTimeline.tsx` component operating on `Slice[]` directly instead of `ScreenshotInfo[]`: scrubbing to slice N sets `currentSlice` state, which drives both the screenshot shown (`slice.screenshot`) and the cumulative fixation set (`slices[0..N].flatMap(s => s.fixations)`) fed into `HeatmapCanvas`. This is a strict simplification versus today's two-clock system (`TimelineSlider`'s screenshot index + `ReplayPlayer`'s independent ms clock) because slices already carry both screenshot and fixation data bundled — there's no separate join needed.

Play/pause auto-advance (today: 1fps `setInterval` in `TimelineSlider`) keeps the same mechanism, just iterating slice indices instead of screenshot indices — natural cadence is "advance one slice per real elapsed second" scaled by the existing speed multiplier UI already present in `ReplayPlayer` (0.5/1/2/4x), now unified into one control instead of two separate playback UIs.

## Progressive real-time heatmap

New: a `useLiveSession(sessionId)` hook opens (or reuses) a WS connection, sends `{type: 'subscribe', sessionId}` per backend-structure.md, and on each `slice_ingested` push:

1. Appends the new slice to a local query-cache list via `queryClient.setQueryData(['slices', sessionId, pageId], prev => [...prev, newSlice])` — TanStack Query's cache is the right home for this since the rest of the read path already consumes slices through query hooks; no separate live-data store needed.
2. If a new `pageId` appears (navigation happened), invalidates `usePagesQuery` so the page tabs update.

`SessionDetailPage` gates this: while `session.status === 'active'`, `SliceTimeline` auto-tracks the latest slice (no manual scrubbing needed — "growing" heatmap) and `HeatmapCanvas` re-renders as fixations accumulate, satisfying "heatmap progressively builds up in real time." Once `session.status === 'completed'`, the WS subscription tears down and the view reverts to today's fully-post-hoc scrub-driven mode — no behavior change for reviewing finished sessions beyond the unified timeline.

This is genuinely new infrastructure (no existing client WS hook to extend), but it's additive — `useSlicesQuery`'s REST fetch remains the source of truth for finished sessions and for the initial page load of an active session; the WS hook only appends deltas on top.

## Replay: recommend retiring rrweb, screenshot-scrubbing becomes primary

Since `SliceTimeline` + `HeatmapCanvas` + screenshots already give a scrub-through-the-session view with the gaze overlay, and extension-improvements.md recommends dropping rrweb capture entirely, `ReplayPlayer.tsx`/`GazeOverlay.tsx`/the `/replay` route consumer can be deleted. `GazeOverlay`'s trail-rendering and fixation-circle logic isn't wasted — port it into `SliceTimeline`'s per-slice view (a "trail" of the last few slices' gaze points overlaid on the current screenshot) so the moment-to-moment gaze-dot feel isn't lost, just re-hosted on screenshots instead of a live DOM replay. This also resolves the known sync fragility called out in the current implementation (rrweb-player's internal playback wasn't provably locked to the hand-rolled clock) since there's no second independent player to desync from anymore.

## Unaffected

`SessionList.tsx`, `ElementTable.tsx`/`AttentionChart.tsx` (still read `/api/sessions/:id/elements`, now backed by precomputed `Slice.fixations` server-side per backend-structure.md but same client shape), `HeatmapsPage.tsx` aggregate/compare view (still URL-keyed by design), `SettingsPage`, routing, and the Zustand `appStore` (UI chrome only) are unchanged.
