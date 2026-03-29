# Live Heatmap Overlay + Tab Picker

## Summary

After calibration, the user picks a tab from a list, and gaze tracking starts on that tab with a live heatmap overlay. When the URL changes (SPA navigation or full navigation), a screenshot of the heatmap is captured before clearing. No scroll handling — pages are assumed non-scrollable.

## Components

### 1. Tab Picker Step

**Location**: New `TabPickerStep` component in `src/calibration/steps/`, inserted after ResultsStep in CalibrationApp.

**Flow**:
- User clicks "Start Tracking" in ResultsStep → stage changes to `'tab-picker'`
- `TabPickerStep` calls `chrome.tabs.query({ currentWindow: true })` to get all tabs
- Displays each tab: favicon (via `chrome.tabs.Tab.favIconUrl`), title, truncated URL
- Current calibration tab is excluded from the list
- User clicks a tab → fires `onSelectTab(tabId)` → CalibrationApp sends `start_session` with `{ targetTabId }` to service worker → calibration window closes

**Props**: `onSelectTab: (tabId: number) => void`

### 2. Service Worker Changes

**`start_session` message** gains an optional `targetTabId` field.

**`startSession(targetTabId?)`**:
1. If `targetTabId` provided, use it. Otherwise fall back to current active tab (existing behavior).
2. Inject content script into the target tab via `chrome.scripting.executeScript`.
3. Focus the target tab via `chrome.tabs.update(tabId, { active: true })`.
4. Send `start_tracking` to content script with `{ heatmapEnabled: true }`.
5. Start screenshot interval (existing 5s).

**`page_change` handler** (from content script):
- Receives `{ heatmapDataUrl, url }` — the final heatmap screenshot before navigation.
- Forwards via existing WebSocket pipeline as a `page_heatmap_screenshot` message.

### 3. Heatmap Overlay (Content Script)

**New file**: `src/content/heatmapOverlay.ts`

**Canvas setup**:
- `<canvas>` with `position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646`
- Canvas resolution matches `window.innerWidth * devicePixelRatio` x `window.innerHeight * devicePixelRatio`
- Handles `resize` events to update dimensions

**Data accumulation**:
- Density grid: `Float32Array` at 1/4 resolution (e.g., 480x270 for a 1920x1080 viewport)
- Each gaze sample at `(x, y)` increments nearby grid cells using a Gaussian kernel (sigma ~20px, radius ~40px)
- Grid values represent cumulative dwell intensity

**Rendering** (requestAnimationFrame, throttled to ~10Hz):
1. Apply a light Gaussian blur pass on the density grid (3x3 kernel, 2 passes)
2. Find the current max density value for dynamic range normalization
3. For each grid cell, map normalized intensity (0–1) to an RGBA color via gradient LUT:
   - 0.0: transparent
   - 0.0–0.2: blue (cold)
   - 0.2–0.4: cyan → green
   - 0.4–0.6: green → yellow
   - 0.6–0.8: yellow → red
   - 0.8–1.0: red → white (hot)
4. Write pixel data to an `ImageData` and `putImageData` to canvas (scaled up from grid resolution)
5. Overall canvas opacity: ~0.45 so the page remains readable beneath

**API**:
```typescript
export interface HeatmapOverlay {
  start(): void           // Create canvas, begin render loop
  addPoint(x: number, y: number): void  // Add a gaze sample
  snapshot(): string      // Returns canvas.toDataURL('image/png')
  clear(): void           // Reset density grid
  stop(): void            // Remove canvas, stop loop
}
```

### 4. Gaze Engine Changes

**Sampling rate**: Increase from 25Hz to 45Hz in `gazeEngine.ts`.

**Heatmap integration**: When heatmap is enabled, each gaze sample is also passed to `heatmapOverlay.addPoint(x, y)` in the tracker's gaze callback. No architectural change — just one extra call in the existing pipeline.

### 5. Per-Page Heatmap Screenshots

**Trigger**: SPA detector's `onPageChange` callback (already exists in `tracker.ts`).

**Flow**:
1. SPA detector fires → tracker receives page change event
2. Tracker calls `heatmapOverlay.snapshot()` to get data URL of current heatmap state
3. Sends `page_change` message to service worker: `{ type: 'page_change', url: oldUrl, heatmapDataUrl }`
4. Calls `heatmapOverlay.clear()` to reset for new page
5. Service worker forwards heatmap screenshot to server via existing WebSocket pipeline

**Full page navigations** (not SPA): The content script gets destroyed on navigation. Before that, the `beforeunload` event fires → capture snapshot and send. If the message doesn't make it (race condition), the 5s periodic screenshot (which includes the visible heatmap overlay) serves as a fallback.

### 6. Tracker Integration

**`tracker.ts` changes**:
- Import and instantiate `heatmapOverlay`
- In `startTracking()`: call `heatmapOverlay.start()` if `heatmapEnabled`
- In gaze callback: call `heatmapOverlay.addPoint(x, y)` for each sample
- In SPA `onPageChange`: snapshot + clear + send
- In `stopTracking()`: call `heatmapOverlay.stop()`
- On `beforeunload`: snapshot + send

## Files to Create

| File | Purpose |
|------|---------|
| `src/calibration/steps/TabPickerStep.tsx` | Tab selection UI |
| `src/content/heatmapOverlay.ts` | Canvas heatmap renderer |

## Files to Modify

| File | Change |
|------|--------|
| `src/calibration/CalibrationApp.tsx` | Add `tab-picker` stage, wire up flow |
| `src/calibration/steps/ResultsStep.tsx` | "Start Tracking" transitions to tab-picker instead of starting directly |
| `src/background/service-worker.ts` | Accept `targetTabId`, handle `page_change` with heatmap data |
| `src/content/tracker.ts` | Integrate heatmapOverlay, wire gaze callback + page change |
| `src/content/gazeEngine.ts` | Change FPS from 25 to 45 |
| `src/types/extension.ts` | Add `targetTabId` to message types |

## Out of Scope

- Scroll-relative heatmaps (pages assumed non-scrollable)
- Server-side heatmap aggregation changes
- Heatmap replay/playback UI
- Heatmap toggle/opacity controls (can be added later)
