# Database Structure — Page/Slice Rework

## Why this changes

Today there is no first-class `Page` or `Slice` document. What exists instead:

- `Session.pages[]` (`packages/web/server/src/models/Session.ts:3-59`) — an embedded array pushed to only when `handlePageScreenshot` sees `index === 0` for a new "visit" (`wsServer.ts:213-234`). `leftAt` is a dead field, never written.
- `GazeEvent` (`models/GazeEvent.ts`) — one document per raw gaze sample, associated to a URL only via `ctx.url` on each point.
- `Screenshot` (`models/Screenshot.ts`) — one document per captured PNG, associated to a "visit" via a fragile most-recent-screenshot heuristic (same URL → `index++`; different URL → new `visitIndex`).

Screenshots and gaze points are two independent streams joined after the fact by nearest-timestamp matching (`heatmapService.ts`). There's no atomic unit that says "this screenshot and these N gaze points belong together." That's exactly what a slice is, and formalizing it removes a whole class of "which screenshot goes with which gaze points" bugs, plus enables real-time progressive heatmaps (a slice is the natural unit to push over the wire as it completes).

## New schemas

### `Page`

One document per URL-visit within a session (not per unique URL — revisiting a URL later in the same session creates a new `Page`, matching how `pages: [{url,enteredAt,leftAt}]` was already conceptually scoped, just now made real and queryable).

```ts
// packages/web/server/src/models/Page.ts
{
  _id: ObjectId,
  sessionId: string,        // indexed
  pageIndex: number,        // 0-based order within the session
  url: string,               // normalized via shared/utils/urlNormalizer.ts (strip #fragment)
  enteredAt: Date,
  leftAt: Date | null,       // set when the next Page is created or session ends
  sliceCount: number,        // denormalized, incremented as slices land — avoids a COUNT query for the timeline UI
  viewport: { width: number, height: number, dpr: number }, // at page entry, for slice coordinate context
  status: 'active' | 'complete',
}
```

Indexes: `{sessionId: 1, pageIndex: 1}` (unique compound, timeline ordering), `{sessionId: 1, url: 1}` (URL tab grouping, replaces the `pages.url` query currently done against the embedded array in `sessions.ts` list filter).

### `Slice`

One document per capture tick. Replaces `Screenshot` and reframes `GazeEvent` as a child array embedded in the slice rather than a separate top-level collection — a slice's gaze points are always read together (there is no query pattern today or planned that wants gaze points independent of their screenshot), so embedding avoids a join on every heatmap/replay read. Raw high-frequency gaze events at 0.1s cadence times an average session (~5-10 min) times however many gaze samples arrive per 100ms window (multiple per tick, since the webcam loop runs faster than the slice cadence) stays small enough per-slice (dozens of points, not thousands) to embed safely under MongoDB's 16MB doc cap.

```ts
// packages/web/server/src/models/Slice.ts
{
  _id: ObjectId,
  sessionId: string,          // indexed
  pageId: ObjectId,            // ref Page, indexed
  sliceIndex: number,          // 0-based order within the page
  capturedAt: Date,
  trigger: 'interval' | 'scroll' | 'navigation', // why this slice was taken — see extension-improvements.md
  screenshot: {
    filePath: string,          // on-disk path, same storage scheme as today's Screenshot.filePath
    scrollX: number,
    scrollY: number,           // finally populated — today hardcoded to 0, see gazekit-accuracy-revamp follow-ups
    viewportWidth: number,
    viewportHeight: number,
  },
  gazePoints: [{
    ts: Date,
    x: number, y: number,      // viewport px at capture time
    conf: number,
    el: { sel: string, tag: string, txt: string, rect: {x,y,w,h} } | null,
  }],
  fixations: [{                // precomputed at slice-close time, see backend-structure.md §Fixation computation
    x: number, y: number, startTs: Date, durationMs: number,
  }] | null,                   // null until computed; avoids blocking slice ingest on I-DT
}
```

Indexes: `{sessionId: 1, pageId: 1, sliceIndex: 1}` (unique compound — timeline read + progressive-append ordering), `{pageId: 1, capturedAt: 1}` (heatmap range queries, replaces `GazeEvent`'s `{meta.sid, ctx.url, ts}` index).

Slices are a MongoDB **time-series collection** (`timeseries: {timeField: 'capturedAt', metaField: 'pageId', granularity: 'seconds'}`) — same choice the current `gazeevents` collection already made (per README's "MongoDB (time series collections)"), still appropriate here since slices are strictly append-only, time-ordered, and read back in time ranges.

### `Session` (trimmed)

`Session.pages[]` embedded array is **removed** — `Page` documents are now the source of truth; anything that read `session.pages` (the sessions list URL filter, `HeatmapUrlTabs` page grouping) queries `Page` by `sessionId` instead. Everything else on `Session` (device, webcam, calibration, tracking, stats, status) is unchanged.

### `RrwebEvent`

Kept as-is if DOM replay is retained (see frontend-architecture.md for the recommendation to deprecate rrweb replay in favor of slice-scrubbing) — otherwise dropped entirely. Not part of the slice/page model either way; it was always a parallel stream.

## Migration path

This is additive, not a breaking rename — old sessions keep their `Screenshot`/`GazeEvent` docs and old `Session.pages` embeds; new sessions write `Page`/`Slice`. The server's read paths (`heatmapService`, `sessions.ts` routes) need a branch on `session.schemaVersion` (new field, default `1`, new sessions write `2`) until old sessions age out, or a one-time backfill script that groups existing `Screenshot`+`GazeEvent` docs by `(sessionId, visitIndex)` into synthesized `Page`/`Slice` docs. Given the 90-day `gazeevents` TTL already in place (per the gazekit-accuracy-revamp memory), old data ages out on its own — a version branch that expires after 90 days is simpler than a backfill script and avoids writing migration code that's immediately dead weight.

## Retention

The existing 90-day TTL on `gazeevents` was called out as an undecided policy in prior work. Carry the same TTL to `slices` (`expireAfterSeconds` on `capturedAt`) but NOT to `pages` or `sessions` — page/session metadata (URLs visited, durations, calibration quality) is cheap to keep indefinitely and useful for longitudinal researcher queries ("show me all sessions on `/checkout` in the last 6 months") even after the raw slice data has expired. Screenshot files on disk need a matching cleanup job (cron or TTL-triggered) since Mongo TTL only deletes the document, not the PNG referenced by `screenshot.filePath` — this mirrors the existing gap where `DELETE /api/sessions/:id` already has to manually unlink screenshot files (`sessions.ts` route) precisely because file storage isn't Mongo-managed.
