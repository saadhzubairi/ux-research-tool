# Extension Improvements — Slice Capture Rework

## Scope

Only the capture-cadence/batching layer changes: `content/batchManager.ts`, `content/tracker.ts`, `content/spaDetector.ts`, and screenshot triggering in `background/service-worker.ts`. Calibration, MediaPipe face landmarking, and the regression model (`offscreen/*`) are untouched — the slice rework is purely about how already-produced gaze samples and screenshots get grouped and cadenced.

## Current state (for contrast)

- Gaze batching: `BatchManager` flushes on a fixed 250ms timer (`WS_CONFIG.BATCH_INTERVAL_MS`), independent of anything happening on the page.
- Screenshots: `service-worker.ts` `startScreenshotInterval()` fires `captureScreenshot()` every `settings.screenshotIntervalMs` (default 1000ms) — **fully decoupled** from gaze batching, so a screenshot and the "matching" gaze points are joined after the fact by nearest-timestamp, not captured together.
- No scroll listener exists anywhere in the capture pipeline — scrolling doesn't change any cadence today.
- SPA route changes (`spaDetector.ts`) already trigger an immediate screenshot via `page_change` → `handlePageScreenshot`, so the "immediate slice on URL change" requirement is partially built.
- rrweb (`domRecorder.ts`) runs as a fully separate DOM-mutation recording stream, flushing every 2s, unrelated to either gaze or screenshots.

## New capture model

A single **slice clock**, owned by the content script (not the service worker — content script has direct, low-latency access to scroll state and DOM), replaces the two independent timers:

```
content/sliceManager.ts (new, replaces batchManager.ts's timer role)

state: cadenceMs = 100  // normal
       cadenceMs = 1000 // while scrolling (see below)

on each tick:
  1. drain gaze points accumulated since last tick (same accumulation batchManager already does)
  2. read the latest frame already sitting in the offscreen document's tab-capture canvas (see below —
     no per-tick capture *call*, just a canvas read)
  3. bundle { gazePoints, screenshot, trigger: 'interval' } and hand to background for send
```

### Screenshots: `chrome.tabCapture` stream instead of `captureVisibleTab` polling

`chrome.tabs.captureVisibleTab` (used today in `service-worker.ts`) is rate-limited by Chrome to a hardcoded ~2 calls/second per tab (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) — not a permission or manifest setting, so there's no way to raise it while still calling the API per-frame. A literal 0.1s (10/s) screenshot cadence is not achievable by calling `captureVisibleTab` more often.

The actual fix, and the mechanism this doc now specifies: `chrome.tabCapture` gives a **continuous `MediaStream`** of the tab (the same primitive Meet-style screen-share extensions use), which sidesteps the quota entirely — you request the stream once, then sample frames from it client-side at any rate, since you're reading a canvas, not calling a rate-limited API.

```
1. background/service-worker.ts, on the "Start Tracking" user gesture (already required for calibration,
   so no new UX friction): chrome.tabCapture.getMediaStreamId({ targetTabId }) → streamId
2. hand streamId to the offscreen document (the one that already exists for MediaPipe — no new document type)
3. offscreen/tabStream.ts (new):
     const stream = await navigator.mediaDevices.getUserMedia({
       video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
     })
     pipe stream into a hidden <video>, draw it into a canvas on every slice tick (100ms/1000ms,
     driven by the same cadence signal the content script's sliceManager is using), export to
     JPEG/PNG, send to background alongside that tick's gaze points
```

This makes the 0.1s screenshot cadence genuinely achievable (10fps, or higher) — no ticks need to fall back to reusing a stale screenshot, unlike a `captureVisibleTab`-polling design.

Caveats to carry into implementation, not blockers but worth planning for:
- **New permission**: `tabCapture` in the manifest (see Manifest section below).
- **User-gesture requirement**: Chrome only grants a tab-capture stream in direct response to a genuine user gesture (extension action click, matching how "Start Tracking" already works) — it cannot be silently (re)acquired later, e.g. on MV3 service-worker wake.
- **Stream continuity across navigation is not guaranteed** — Chrome can tear down the stream on a cross-origin navigation. The existing `reattachTracking()` full-navigation path (`chrome.tabs.onUpdated`) needs to also re-request a stream (`getMediaStreamId`) when the old one dies, not just re-inject tracking.
- **Shared CPU budget**: the offscreen document already runs MediaPipe face-landmark inference in real time; continuously decoding a second video stream (the tab) in the same document is two concurrent real-time pipelines sharing one budget. Worth a perf smoke-test (dropped frames, latency) before assuming this is free, especially on lower-end hardware.
- **Downscale before writing to disk**: true 10fps frames at full viewport resolution will burn disk/bandwidth fast on longer or scroll-heavy sessions — resize/compress in the canvas export step, not as an afterthought.

### Scroll-triggered cadence change

New: a `scroll` listener in `sliceManager.ts` (content script has full access; nothing like this exists today). On `scroll` (debounced ~50ms to detect "scrolling is happening" vs. single jump), switch `cadenceMs` from 100 → 1000 and mark the next slice's `trigger: 'scroll'`; on scroll-idle (no scroll event for ~300ms), switch back to 100ms. This directly reduces the Chrome screenshot-rate pressure noted above during scroll, which is also when content is changing fastest, aligning capture cost with what's actually useful (a fixation mid-scroll is 1s of near-identical viewport, no value in bursting screenshots).

### Navigation-triggered immediate slice

Extends the existing `spaDetector.ts` → `page_change` path and the existing `chrome.tabs.onUpdated` → `reattachTracking()` full-navigation path: both already fire an immediate screenshot capture. Change: instead of sending a bare `page_screenshot`, they now emit `trigger: 'navigation'` which server-side closes the current `Page` (sets `leftAt`) and opens a new one (see backend-structure.md), and the slice clock resets its interval timer so the next `interval`-triggered slice is a full 100ms/1000ms later, not immediately re-firing.

### rrweb — recommend deprecating

Given the move to screenshot-based slices as the primary visual record, rrweb's DOM-mutation recording becomes redundant for the core heatmap/replay use case (see frontend-architecture.md — screenshot-scrubbing replaces rrweb replay as the default view) and its independent 2s-interval flush is one more moving part with no slice awareness. Recommend removing `domRecorder.ts` and the `rrweb_events` message type entirely rather than trying to reconcile two DOM-record systems; this also drops the `rrweb` dependency and the `RrwebEvent` collection. If pixel-perfect DOM replay (as opposed to screenshot scrubbing) turns out to be a hard requirement later, it's a separable follow-up, not a blocker for the slice model.

## Message protocol changes

Replace `gaze_batch` + `page_screenshot` + `page_change` with a single `slice` message type in `packages/shared/src/types/protocol.ts`:

```ts
{
  type: 'slice',
  payload: {
    sessionId: string,
    trigger: 'interval' | 'scroll' | 'navigation',
    capturedAt: number,           // epoch ms
    url: string,                  // normalized client-side too, belt-and-suspenders with server normalizer
    scrollX: number, scrollY: number,
    viewportWidth: number, viewportHeight: number,
    gazePoints: GazePoint[],      // same shape as today's GazeEvent, minus the per-point ctx (now slice-level)
    screenshotDataUrl: string,    // always fresh — sampled from the tabCapture stream, no throttle fallback needed
  }
}
```

This is a strict simplification of the message surface — three message types collapse to one, and every field that used to be duplicated per-gaze-point (`ctx.url`, `ctx.sx/sy`, `ctx.vw/vh`) moves to the slice envelope since it's now genuinely constant across the points in a slice (they were captured in the same 100ms/1000ms window).

## Manifest

- **New**: `"tabCapture"` permission, required for `chrome.tabCapture.getMediaStreamId` — this is the one real manifest change in this rework.
- `chrome.tabs.captureVisibleTab` and its `activeTab`/`tabs` permission grant are no longer needed once the stream-based approach replaces it, and can be dropped if nothing else in the extension relies on them.
- Scroll listening needs no new permission (content script already runs at `document_idle` on `<all_urls>`).
