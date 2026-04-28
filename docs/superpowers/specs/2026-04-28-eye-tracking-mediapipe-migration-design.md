# Eye Tracking: WebGazer to MediaPipe Migration

## Problem

WebGazer.js's weighted ridge regression becomes numerically unstable during calibration. By the 5th–6th calibration point, gaze predictions are wildly jittery. The regression model degrades as training samples accumulate because low-level eye-patch features from different gaze directions produce conflicting, near-identical feature vectors that the ridge regression cannot resolve.

## Solution

Replace WebGazer.js with MediaPipe Face Mesh (with iris refinement) and a custom polynomial calibration. MediaPipe provides high-level iris landmarks that are stable and discriminative, enabling a clean polynomial mapping from iris position to screen coordinates.

## Target Accuracy

100–150px (rough area of attention / element-level). Sufficient for UX research use cases.

## Architecture

### Current (3 layers)

```
Service Worker -> Offscreen Document -> Sandbox Iframe (WebGazer + unsafe-eval)
```

The sandbox exists because WebGazer uses `eval()` / `Function()` internally.

### New (2 layers)

```
Service Worker -> Offscreen Document (MediaPipe Face Mesh via WASM)
```

MediaPipe uses WASM (allowed by default in Chrome extensions), eliminating the sandbox iframe, the postMessage frame-transfer bridge, the fake MediaStream reconstruction, and the `unsafe-eval` CSP declaration.

## Iris-to-Gaze Pipeline

### Landmarks Used

- Iris centers: left (468), right (473)
- Eye corners: left inner/outer (133, 33), right inner/outer (362, 263)
- Upper/lower eyelids: left (159, 145), right (386, 374)

### Step 1: Normalized Iris Position

For each eye, compute iris center relative to eye boundaries:

**Horizontal** (using eye corners — always use leftmost/rightmost ordering to ensure positive denominator for both eyes):

```
left_x  = min(inner_corner.x, outer_corner.x)
right_x = max(inner_corner.x, outer_corner.x)
t_x = (iris_center.x - left_x) / (right_x - left_x)
```

**Vertical** (using upper/lower eyelid landmarks — eye corners are at nearly the same height, making the corner-based y-denominator dangerously small and noisy):

```
t_y = (iris_center.y - upper_eyelid.y) / (lower_eyelid.y - upper_eyelid.y)
```

Average both eyes for stability. This normalization makes the signal largely invariant to head position and camera distance, though significant head rotation (yaw/pitch/roll) can introduce error. For the 100-150px accuracy target this is acceptable.

### Step 2: Polynomial Mapping

Quadratic polynomial maps normalized iris position (ix, iy) to screen coordinates:

```
screen_x = a0 + a1*ix + a2*iy + a3*ix*iy + a4*ix^2 + a5*iy^2
screen_y = b0 + b1*ix + b2*iy + b3*ix*iy + b4*ix^2 + b5*iy^2
```

6 coefficients per axis, solved via least-squares from calibration data. Quadratic terms handle non-linearity at screen edges.

## Calibration Flow

### 6-Point Layout

```
(20%, 20%)    (50%, 20%)    (80%, 20%)


           (50%, 50%)


(20%, 80%)                  (80%, 80%)
```

Four near-corners + top-center + center. 6 points are needed because the quadratic polynomial has 6 coefficients per axis — 5 points would leave the system under-determined. This layout is intentionally top-heavy: the top half has denser coverage (3 points in top row + center) while the bottom has 2 corner points. This is a deliberate tradeoff — most web content and navigation UI sits in the upper portion of the screen, so higher accuracy there is more useful for UX research. The bottom-center is interpolated between the two bottom corners and center, which is sufficient for the 100-150px accuracy target.

### Stages

1. **Camera** - Request webcam permission
2. **Face Check** - Verify MediaPipe face detection
3. **Calibration** - 6-point dwell-based with shrinking dot animation. ~15 iris samples per point. All samples collected first, then polynomial solved once (no incremental training).
4. **Validation** - 3 validation points at positions distinct from calibration points (e.g., (35%, 35%), (65%, 65%), (50%, 75%)). Show average error in pixels.
5. **Results** - Display calibration quality and average error. Handle model export and storage.
6. **Tab Picker** - Select tracking target

### Key Difference

WebGazer trains incrementally per point (causing instability by point 5). The new approach collects all samples, then fits the model in a single least-squares solve. No accumulation problem.

Total calibration time: ~30 seconds (6 points x ~5s each), down from ~45.

### Model Storage

The polynomial model is stored in `chrome.storage.local` under key `gazekit:model`. The new format replaces WebGazer's regression arrays with polynomial coefficients:

```
{
  coeffsX: [a0, a1, a2, a3, a4, a5],  // 6 coefficients for screen_x
  coeffsY: [b0, b1, b2, b3, b4, b5],  // 6 coefficients for screen_y
  calibratedAt: ISO timestamp,
  screenWidth: number,
  screenHeight: number
}
```

On first load after migration, any existing WebGazer model data is cleared.

## Smoothing & Filtering

- **Keep**: One Euro Filter (60Hz, minCutoff 1.5, beta 0.007) - model-agnostic jitter smoothing
- **Keep**: Outlier rejection (>400px jump detection)
- **Remove**: WebGazer's internal Kalman filter (goes away with WebGazer)

No additional smoothing needed. MediaPipe iris landmarks are already stable frame-to-frame.

## WASM / Model Bundling

MediaPipe's `@mediapipe/tasks-vision` npm package includes WASM and `.tflite` model files. These will be bundled with the extension (adds ~5-8MB to extension size). This avoids CDN dependency and ensures offline capability. The WASM files need to be included in the extension's `web_accessible_resources` or loaded from the extension's own origin within the offscreen document.

## Files Affected

### Removed

- `webgazer` npm dependency (and its transitive TensorFlow.js deps)
- `sandbox.html`, `sandbox-entry.ts` - entire sandbox iframe layer
- `webgazer.d.ts` - WebGazer type definitions
- `gazeEngine.ts` - legacy, already unused
- `useWebGazer.ts` - replaced by `useMediaPipe.ts`
- `unsafe-eval` CSP in `manifest.json`
- `patchWebGazer()` Vite plugin in `vite.config.ts`

### Replaced / Rewritten

- `offscreen.ts` - run MediaPipe directly, keep One Euro filter + outlier rejection + batching. Remove `IFRAME_SCRIPTING` from offscreen document reasons.
- `CalibrationApp.tsx` - fewer stages (drop LibraryCheckStep), update model export to polynomial format
- `CalibrationStep.tsx` - 6 points, collect-then-solve
- `ValidationStep.tsx` - adapt to new model, 3 distinct validation points
- `ResultsStep.tsx` - adapt to display polynomial model quality instead of WebGazer model info
- `constants.ts` - update `CALIBRATION_POINTS` to 6-point layout
- `packages/shared/src/types/gaze.ts` - update `CalibrationResult.method` to include `'6-point-polynomial'`, update `SessionMeta.tracking` to `library: 'mediapipe'` and `regressionModel: 'polynomial'`
- `service-worker.ts` - update hardcoded tracking metadata (`library`, `regressionModel`), remove sandbox-related message handlers
- `vite.config.ts` - remove `patchWebGazer()` plugin, remove TF.js resolve aliases, remove `sandbox` rollup input entry, add WASM/tflite file copy config
- `package.json` - remove `webgazer` dependency, add `@mediapipe/tasks-vision`

### New

- `mediapipe.ts` - Face Mesh initialization, iris extraction, polynomial solver
- `useMediaPipe.ts` - React hook for calibration UI

### Unchanged

- `CalibrationDot.tsx` - shrinking dot animation
- `batchManager.ts` - gaze event batching
- `heatmapOverlay.ts` - consumes (x, y) samples
- `domMapper.ts`, `domRecorder.ts`, `spaDetector.ts` - downstream consumers
- `coordinateNormalizer.ts`, `fixationDetector.ts` - model-agnostic utilities
- `tracker.ts` - routes gaze callbacks (update stale comments referencing WebGazer/sandbox)
- Service worker - minor message cleanup
- All server/web code - untouched
