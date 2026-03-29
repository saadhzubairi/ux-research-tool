# Live Heatmap Overlay + Tab Picker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After calibration, let the user pick a tab to track, then show a live heatmap overlay on that tab with per-page screenshots on URL change.

**Architecture:** Tab picker is a new calibration step that queries `chrome.tabs`. Heatmap is a viewport-fixed canvas overlay in the content script, fed by gaze samples at 45Hz. SPA detector triggers heatmap snapshots on navigation.

**Tech Stack:** Chrome Extension APIs (tabs, scripting), Canvas 2D, existing gazeEngine/spaDetector/batchManager infrastructure.

---

## Chunk 1: Types + Tab Picker UI

### Task 1: Add `targetTabId` to message types

**Files:**
- Modify: `packages/extension/src/types/extension.ts`

- [ ] **Step 1: Update PopupMessage union**

In `packages/extension/src/types/extension.ts`, change the `start_session` variant in `PopupMessage`:

```typescript
export type PopupMessage =
  | { type: 'start_session'; targetTabId?: number }
  | { type: 'stop_session' }
  // ... rest unchanged
```

- [ ] **Step 2: Update ContentMessage to include heatmap data**

Add `heatmapDataUrl` to the `page_change` variant:

```typescript
export type ContentMessage =
  | { type: 'gaze_batch'; payload: GazeBatch }
  | { type: 'rrweb_events'; payload: { sessionId: string; events: unknown[] } }
  | { type: 'tracking_status'; status: 'active' | 'paused' | 'error'; error?: string }
  | { type: 'page_change'; url: string; heatmapDataUrl?: string }
```

- [ ] **Step 3: Add `heatmapEnabled` to ServiceWorkerToContentMessage**

```typescript
export type ServiceWorkerToContentMessage =
  | { type: 'start_tracking'; sessionId: string; settings: ExtensionSettings; heatmapEnabled?: boolean }
  | { type: 'stop_tracking' }
  | { type: 'pause_tracking' }
  | { type: 'resume_tracking' }
```

- [ ] **Step 4: Build and verify no type errors**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/types/extension.ts
git commit -m "feat: add targetTabId and heatmap fields to extension message types"
```

---

### Task 2: Create TabPickerStep component

**Files:**
- Create: `packages/extension/src/calibration/steps/TabPickerStep.tsx`

- [ ] **Step 1: Create the component**

Create `packages/extension/src/calibration/steps/TabPickerStep.tsx`:

```tsx
import React, { useState, useEffect } from 'react'

interface TabPickerStepProps {
  onSelectTab: (tabId: number) => void
}

interface TabInfo {
  id: number
  title: string
  url: string
  favIconUrl: string | undefined
}

export function TabPickerStep({ onSelectTab }: TabPickerStepProps) {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTabs = async () => {
      const allTabs = await chrome.tabs.query({ currentWindow: true })
      const currentTabId = (await chrome.tabs.getCurrent())?.id

      const filtered: TabInfo[] = allTabs
        .filter((t) => t.id !== undefined && t.id !== currentTabId)
        .filter((t) => !t.url?.startsWith('chrome://') && !t.url?.startsWith('chrome-extension://'))
        .map((t) => ({
          id: t.id!,
          title: t.title || 'Untitled',
          url: t.url || '',
          favIconUrl: t.favIconUrl,
        }))

      setTabs(filtered)
      setLoading(false)
    }

    loadTabs()
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="h-8 w-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500">Loading tabs...</p>
        </div>
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm rounded-xl border border-yellow-200 bg-yellow-50 p-6 text-center">
          <p className="text-sm text-gray-700">No eligible tabs found. Open a website in another tab first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Select a Tab to Track</h1>
        <p className="mt-2 text-sm text-gray-500">Choose which tab to overlay the gaze heatmap on</p>
      </div>

      <div className="w-full max-w-lg space-y-2 px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            {tab.favIconUrl ? (
              <img src={tab.favIconUrl} alt="" className="h-5 w-5 shrink-0 rounded" />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-200 text-xs text-gray-500">
                ?
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{tab.title}</p>
              <p className="truncate text-xs text-gray-400">{tab.url}</p>
            </div>
            <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds. Component is not wired into CalibrationApp yet, but it compiles.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/calibration/steps/TabPickerStep.tsx
git commit -m "feat: add TabPickerStep component for selecting tracking target"
```

---

### Task 3: Wire TabPickerStep into CalibrationApp

**Files:**
- Modify: `packages/extension/src/calibration/CalibrationApp.tsx`
- Modify: `packages/extension/src/calibration/steps/ResultsStep.tsx`

- [ ] **Step 1: Add `tab-picker` stage to CalibrationApp**

In `CalibrationApp.tsx`:

1. Add `'tab-picker'` to the `CalibrationStage` union:
```typescript
type CalibrationStage =
  | 'camera'
  | 'face-check'
  | 'library-check'
  | 'calibration'
  | 'validation'
  | 'results'
  | 'tab-picker'
```

2. Import `TabPickerStep`:
```typescript
import { TabPickerStep } from './steps/TabPickerStep'
```

3. Change `handleStartTracking` to transition to tab-picker instead of starting directly:
```typescript
const handleStartTracking = useCallback(async () => {
  setStage('tab-picker')
}, [])
```

4. Add new handler for tab selection:
```typescript
const handleSelectTab = useCallback(async (tabId: number) => {
  await webgazer.stop()
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
    setStream(null)
  }
  chrome.runtime.sendMessage({ type: 'start_session', targetTabId: tabId })
  window.close()
}, [webgazer, stream])
```

5. Add `tab-picker` to the stage rendering (after the `results` block):
```typescript
{stage === 'tab-picker' && (
  <TabPickerStep onSelectTab={handleSelectTab} />
)}
```

6. Add to `stepIndicators` array:
```typescript
{ key: 'tab-picker', label: 'Pick Tab' },
```

7. Add `'tab-picker'` to `stageOrder` array (after `'results'`).

8. Update `showChrome` to also hide chrome during tab-picker:
```typescript
const showChrome = stage !== 'calibration' && stage !== 'validation' && stage !== 'tab-picker'
```

9. Update the `setPreviewMode` effect — tab-picker should use hidden:
```typescript
} else if (stage === 'calibration' || stage === 'validation' || stage === 'tab-picker') {
  webgazer.setPreviewMode('hidden')
}
```

- [ ] **Step 2: Simplify ResultsStep**

In `ResultsStep.tsx`, the `handleStartTracking` already calls `onStartTracking()` after storing calibration. No changes needed — CalibrationApp's `handleStartTracking` now transitions to `'tab-picker'` instead of sending `start_session`.

- [ ] **Step 3: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds. The calibration flow now shows a tab picker after "Start Tracking".

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/calibration/CalibrationApp.tsx
git commit -m "feat: wire tab picker into calibration flow after results step"
```

---

### Task 4: Update service worker to accept targetTabId

**Files:**
- Modify: `packages/extension/src/background/service-worker.ts`

- [ ] **Step 1: Update startSession to accept targetTabId**

Change the `startSession` function signature and body:

```typescript
async function startSession(targetTabId?: number): Promise<string> {
  const sessionId = crypto.randomUUID()

  await ensureOffscreenDocument()
  await sendToOffscreen({ type: 'connect', port: settings.wsPort })

  let tabId: number

  if (targetTabId) {
    tabId = targetTabId
    // Focus the target tab
    await chrome.tabs.update(tabId, { active: true })
  } else {
    // Fallback: use current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const activeTab = tabs[0]
    if (!activeTab?.id) throw new Error('No active tab found')
    tabId = activeTab.id
  }

  // ... rest of function unchanged, using tabId
```

- [ ] **Step 2: Pass targetTabId from message handler**

In `handleMessage`, update the `start_session` case:

```typescript
case 'start_session': {
  const sessionId = await startSession(message.targetTabId)
  return { sessionId }
}
```

- [ ] **Step 3: Add heatmapEnabled to start_tracking message**

In `startSession`, when sending `start_tracking` to the content script:

```typescript
await sendToContentScript(tabId, {
  type: 'start_tracking',
  sessionId,
  settings,
  heatmapEnabled: true,
})
```

- [ ] **Step 4: Update page_change handler to forward heatmap screenshot**

In `handleMessage`, update the `page_change` case:

```typescript
case 'page_change': {
  // Forward heatmap screenshot to server if present
  if (message.heatmapDataUrl && state.currentSessionId) {
    const heatmapMessage: ExtensionMessage = {
      type: 'page_screenshot',
      payload: {
        sessionId: state.currentSessionId,
        url: message.url,
        dataUrl: message.heatmapDataUrl,
        scrollY: 0,
        viewportHeight: 0,
      },
    }
    try {
      await sendToOffscreen({ type: 'send', message: heatmapMessage })
    } catch {
      // Non-fatal — best-effort delivery
    }
  }
  return { received: true }
}
```

- [ ] **Step 5: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/background/service-worker.ts
git commit -m "feat: service worker accepts targetTabId and forwards heatmap screenshots"
```

---

## Chunk 2: Heatmap Overlay + Tracker Integration

### Task 5: Create heatmapOverlay module

**Files:**
- Create: `packages/extension/src/content/heatmapOverlay.ts`

- [ ] **Step 1: Create the heatmap overlay module**

Create `packages/extension/src/content/heatmapOverlay.ts`:

```typescript
// ---------------------------------------------------------------------------
// Heatmap Overlay
// Fixed viewport canvas that accumulates gaze density and renders a color
// heatmap in real-time. Pages assumed non-scrollable.
// ---------------------------------------------------------------------------

// Grid resolution divisor — density grid is 1/SCALE of viewport
const SCALE = 4
// Gaussian kernel radius in grid cells (~40px at SCALE=4 means ~10 cells)
const KERNEL_RADIUS = 10
// Gaussian sigma in grid cells
const KERNEL_SIGMA = 5
// Render throttle — target ~10Hz
const RENDER_INTERVAL_MS = 100
// Canvas opacity so the page remains readable
const CANVAS_OPACITY = 0.45

// Precompute Gaussian kernel weights
const kernelSize = KERNEL_RADIUS * 2 + 1
const kernel = new Float32Array(kernelSize * kernelSize)
;(() => {
  const s2 = 2 * KERNEL_SIGMA * KERNEL_SIGMA
  for (let dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++) {
    for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
      const weight = Math.exp(-(dx * dx + dy * dy) / s2)
      kernel[(dy + KERNEL_RADIUS) * kernelSize + (dx + KERNEL_RADIUS)] = weight
    }
  }
})()

// Color gradient LUT (256 entries, RGBA)
const gradientLUT = new Uint8ClampedArray(256 * 4)
;(() => {
  // Stops: transparent → blue → cyan → green → yellow → red → white
  const stops: Array<[number, number, number, number, number]> = [
    //  pos,   R,   G,   B,   A
    [0.00,   0,   0,   0,   0],
    [0.10,  30,  60, 200, 120],
    [0.25,   0, 150, 220, 180],
    [0.40,   0, 200,  80, 200],
    [0.55, 220, 220,   0, 220],
    [0.70, 240, 120,   0, 230],
    [0.85, 230,  30,  20, 240],
    [1.00, 255, 255, 255, 255],
  ]

  for (let i = 0; i < 256; i++) {
    const t = i / 255
    // Find surrounding stops
    let lo = 0
    for (let s = 1; s < stops.length; s++) {
      if (stops[s][0] >= t) { lo = s - 1; break }
    }
    const hi = Math.min(lo + 1, stops.length - 1)
    const range = stops[hi][0] - stops[lo][0]
    const frac = range > 0 ? (t - stops[lo][0]) / range : 0

    gradientLUT[i * 4 + 0] = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * frac)
    gradientLUT[i * 4 + 1] = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * frac)
    gradientLUT[i * 4 + 2] = Math.round(stops[lo][3] + (stops[hi][3] - stops[lo][3]) * frac)
    gradientLUT[i * 4 + 3] = Math.round(stops[lo][4] + (stops[hi][4] - stops[lo][4]) * frac)
  }
})()

class HeatmapOverlayImpl {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private grid: Float32Array | null = null
  private gridW = 0
  private gridH = 0
  private rafId: number | null = null
  private lastRenderTime = 0
  private dirty = false
  private resizeHandler: (() => void) | null = null

  start(): void {
    if (this.canvas) return

    const canvas = document.createElement('canvas')
    canvas.id = '__gazekit-heatmap'
    canvas.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 2147483646;
      opacity: ${CANVAS_OPACITY};
    `
    document.body.appendChild(canvas)
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!

    this.resize()

    this.resizeHandler = () => this.resize()
    window.addEventListener('resize', this.resizeHandler)

    this.renderLoop()
  }

  addPoint(x: number, y: number): void {
    if (!this.grid) return

    // Map viewport pixel to grid cell
    const gx = Math.round(x / SCALE)
    const gy = Math.round(y / SCALE)

    // Stamp Gaussian kernel centered at (gx, gy)
    for (let dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++) {
      const row = gy + dy
      if (row < 0 || row >= this.gridH) continue
      for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
        const col = gx + dx
        if (col < 0 || col >= this.gridW) continue
        const weight = kernel[(dy + KERNEL_RADIUS) * kernelSize + (dx + KERNEL_RADIUS)]
        this.grid[row * this.gridW + col] += weight
      }
    }

    this.dirty = true
  }

  snapshot(): string {
    if (!this.canvas) return ''
    // Force a render before snapshot
    this.render()
    return this.canvas.toDataURL('image/png')
  }

  clear(): void {
    if (this.grid) this.grid.fill(0)
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
    this.dirty = false
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
    this.ctx = null
    this.grid = null
  }

  private resize(): void {
    if (!this.canvas || !this.ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight

    this.canvas.width = w * dpr
    this.canvas.height = h * dpr
    this.ctx.scale(dpr, dpr)

    this.gridW = Math.ceil(w / SCALE)
    this.gridH = Math.ceil(h / SCALE)

    // Preserve existing data if possible, otherwise allocate fresh
    const newGrid = new Float32Array(this.gridW * this.gridH)
    if (this.grid) {
      // Copy what fits
      const copyLen = Math.min(this.grid.length, newGrid.length)
      newGrid.set(this.grid.subarray(0, copyLen))
    }
    this.grid = newGrid
    this.dirty = true
  }

  private renderLoop = (): void => {
    this.rafId = requestAnimationFrame(this.renderLoop)

    const now = performance.now()
    if (now - this.lastRenderTime < RENDER_INTERVAL_MS) return
    if (!this.dirty) return

    this.lastRenderTime = now
    this.render()
  }

  private render(): void {
    if (!this.ctx || !this.canvas || !this.grid) return

    const w = this.gridW
    const h = this.gridH

    // Find max for normalization
    let maxVal = 0
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] > maxVal) maxVal = this.grid[i]
    }
    if (maxVal === 0) return

    // Build RGBA image from grid
    const imgData = this.ctx.createImageData(w, h)
    const pixels = imgData.data

    for (let i = 0; i < this.grid.length; i++) {
      const normalized = this.grid[i] / maxVal
      const lutIndex = Math.min(255, Math.round(normalized * 255))
      const pi = i * 4
      const li = lutIndex * 4
      pixels[pi] = gradientLUT[li]
      pixels[pi + 1] = gradientLUT[li + 1]
      pixels[pi + 2] = gradientLUT[li + 2]
      pixels[pi + 3] = gradientLUT[li + 3]
    }

    // Clear and draw scaled up
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Use a temp canvas at grid resolution, then drawImage scaled
    const tmp = new OffscreenCanvas(w, h)
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.putImageData(imgData, 0, 0)

    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
    this.ctx.drawImage(tmp, 0, 0, window.innerWidth, window.innerHeight)

    this.dirty = false
  }
}

export const heatmapOverlay = new HeatmapOverlayImpl()
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds. Module compiles but isn't imported anywhere yet.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/content/heatmapOverlay.ts
git commit -m "feat: add heatmap overlay canvas renderer with Gaussian accumulation"
```

---

### Task 6: Integrate heatmap into tracker + bump gaze rate to 45Hz

**Files:**
- Modify: `packages/extension/src/content/tracker.ts`
- Modify: `packages/extension/src/content/gazeEngine.ts`

- [ ] **Step 1: Bump gaze engine tracking loss threshold for 45Hz**

In `packages/extension/src/content/gazeEngine.ts`, line 55, the tracking loss threshold is `75` (3s at 25fps). At 45fps, 3 seconds = 135:

```typescript
// Change:
if (this.trackingLossCount > 75) {
// To:
if (this.trackingLossCount > 135) {
```

No explicit FPS config exists — WebGazer runs as fast as it can via rAF. The `75 → 135` change just adjusts the loss detection threshold for the higher actual rate.

- [ ] **Step 2: Integrate heatmapOverlay into tracker.ts**

In `packages/extension/src/content/tracker.ts`:

1. Add import at the top:
```typescript
import { heatmapOverlay } from './heatmapOverlay'
```

2. Add a `heatmapEnabled` flag alongside `isTracking`:
```typescript
let heatmapEnabled = false
```

3. Update the gaze callback to feed heatmap:
```typescript
const gazeCallback = (sample: GazeSample): void => {
  batchManager.addSample(sample)
  gazeEmitter.emit(sample)
  if (heatmapEnabled) {
    heatmapOverlay.addPoint(sample.x, sample.y)
  }
}
```

4. Update the route change callback to snapshot heatmap before sending:
```typescript
const routeChangeCallback = (url: string): void => {
  let heatmapDataUrl: string | undefined
  if (heatmapEnabled) {
    heatmapDataUrl = heatmapOverlay.snapshot()
    heatmapOverlay.clear()
  }
  chrome.runtime.sendMessage({ type: 'page_change', url, heatmapDataUrl }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[GazeKit] Failed to send page_change:', chrome.runtime.lastError.message)
    }
  })
}
```

5. Update `startTracking` to accept and use `heatmapEnabled`:
```typescript
async function startTracking(
  sid: string,
  _settings: ExtensionSettings,
  enableHeatmap?: boolean,
): Promise<void> {
  if (isTracking) return

  sessionId = sid
  isTracking = true
  isPaused = false
  heatmapEnabled = enableHeatmap ?? false

  // ... existing subsystem starts ...

  // After gazeEngine.start(), start heatmap if enabled
  if (heatmapEnabled) {
    heatmapOverlay.start()
  }

  console.log('[GazeKit] Tracking started for session', sessionId, heatmapEnabled ? '(heatmap ON)' : '')
}
```

6. Update `stopTracking` to stop heatmap:
```typescript
function stopTracking(): void {
  if (!isTracking && !sessionId) return

  // Snapshot heatmap before teardown
  if (heatmapEnabled) {
    try {
      const heatmapDataUrl = heatmapOverlay.snapshot()
      if (heatmapDataUrl) {
        chrome.runtime.sendMessage({ type: 'page_change', url: location.href, heatmapDataUrl }, () => {
          if (chrome.runtime.lastError) { /* non-fatal */ }
        })
      }
    } catch { /* non-fatal */ }
    heatmapOverlay.stop()
  }

  // ... existing teardown ...

  heatmapEnabled = false
}
```

7. Update the `start_tracking` message handler to pass `heatmapEnabled`:
```typescript
case 'start_tracking': {
  startTracking(message.sessionId, message.settings, message.heatmapEnabled)
    .then(() => sendResponse({ success: true }))
    // ...
}
```

8. Add `beforeunload` handler for full-page navigations:
```typescript
// Add after the message listener setup:
window.addEventListener('beforeunload', () => {
  if (heatmapEnabled && isTracking) {
    try {
      const heatmapDataUrl = heatmapOverlay.snapshot()
      if (heatmapDataUrl) {
        chrome.runtime.sendMessage({ type: 'page_change', url: location.href, heatmapDataUrl })
      }
    } catch { /* race — best effort */ }
  }
})
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/content/tracker.ts packages/extension/src/content/gazeEngine.ts
git commit -m "feat: integrate heatmap overlay into tracker, bump tracking loss threshold"
```

---

## Chunk 3: Final Integration + Manual Test

### Task 7: End-to-end integration and build verification

**Files:** (no new changes — verification only)

- [ ] **Step 1: Full build**

Run: `cd packages/extension && npm run build`
Expected: Clean build with no errors.

- [ ] **Step 2: Verify the complete flow**

Manual test plan (load the unpacked extension in Chrome):

1. Open the extension popup → click "Calibrate"
2. Complete calibration flow (camera → face check → library check → calibrate → validate → results)
3. On the Results screen, click "Start Tracking"
4. Verify: tab picker appears showing all open tabs (excluding chrome:// and the calibration tab)
5. Click a tab → verify: calibration window closes, selected tab becomes active
6. Open DevTools console on the tracked tab → verify `[GazeKit] Tracking started for session ... (heatmap ON)` appears
7. Verify: a semi-transparent heatmap canvas overlay appears on the page
8. Look around the page → verify heatmap builds up color (blue → green → yellow → red → white)

- [ ] **Step 3: Commit all together if any fixes needed**

```bash
git add -A
git commit -m "feat: complete heatmap overlay + tab picker integration"
```
