# Eye Tracking MediaPipe Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WebGazer.js with MediaPipe Face Mesh for eye tracking to fix calibration drift/jitter.

**Architecture:** MediaPipe FaceLandmarker extracts iris landmarks from webcam video in the offscreen document (no sandbox iframe). Normalized iris positions (relative to eye corners horizontally, eyelids vertically) map to screen coordinates via a 6-coefficient quadratic polynomial, calibrated with 6 on-screen points using batch least-squares. The sandbox iframe layer is eliminated entirely — MediaPipe uses WASM, no `unsafe-eval` needed.

**Tech Stack:** `@mediapipe/tasks-vision` (FaceLandmarker), TypeScript, Vite, Chrome Extension Manifest V3, React, vitest

**Design Spec:** `docs/superpowers/specs/2026-04-28-eye-tracking-mediapipe-migration-design.md`

---

## Chunk 1: Core Gaze Math (Testable Pure Logic)

### Task 1: Set Up Test Infrastructure + Polynomial Solver (TDD)

**Files:**
- Create: `packages/extension/vitest.config.ts`
- Create: `packages/extension/src/offscreen/polynomial.ts`
- Create: `packages/extension/src/__tests__/polynomial.test.ts`

- [ ] **Step 1: Create vitest config**

```typescript
// packages/extension/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Write failing tests for polynomial solver**

```typescript
// packages/extension/src/__tests__/polynomial.test.ts
import { describe, it, expect } from 'vitest'
import {
  solvePolynomial,
  predictGaze,
  type CalibrationSample,
} from '../offscreen/polynomial'

describe('solvePolynomial', () => {
  it('fits a linear mapping exactly with 6 points', () => {
    // Pure linear: screenX = 1920 * iris_x, screenY = 1080 * iris_y
    const samples: CalibrationSample[] = [
      { irisX: 0.2, irisY: 0.2, screenX: 384, screenY: 216 },
      { irisX: 0.5, irisY: 0.2, screenX: 960, screenY: 216 },
      { irisX: 0.8, irisY: 0.2, screenX: 1536, screenY: 216 },
      { irisX: 0.5, irisY: 0.5, screenX: 960, screenY: 540 },
      { irisX: 0.2, irisY: 0.8, screenX: 384, screenY: 864 },
      { irisX: 0.8, irisY: 0.8, screenX: 1536, screenY: 864 },
    ]

    const model = solvePolynomial(samples)
    expect(model.coeffsX).toHaveLength(6)
    expect(model.coeffsY).toHaveLength(6)

    // Model should reproduce training data
    for (const s of samples) {
      const pred = predictGaze(model, s.irisX, s.irisY)
      expect(pred.x).toBeCloseTo(s.screenX, 0)
      expect(pred.y).toBeCloseTo(s.screenY, 0)
    }
  })

  it('interpolates between calibration points', () => {
    const samples: CalibrationSample[] = [
      { irisX: 0.0, irisY: 0.0, screenX: 0, screenY: 0 },
      { irisX: 1.0, irisY: 0.0, screenX: 1920, screenY: 0 },
      { irisX: 0.0, irisY: 1.0, screenX: 0, screenY: 1080 },
      { irisX: 1.0, irisY: 1.0, screenX: 1920, screenY: 1080 },
      { irisX: 0.5, irisY: 0.5, screenX: 960, screenY: 540 },
      { irisX: 0.5, irisY: 0.0, screenX: 960, screenY: 0 },
    ]

    const model = solvePolynomial(samples)
    const pred = predictGaze(model, 0.25, 0.25)
    // Should interpolate to roughly (480, 270)
    expect(pred.x).toBeCloseTo(480, -1)
    expect(pred.y).toBeCloseTo(270, -1)
  })

  it('handles noisy samples via least-squares averaging', () => {
    // Multiple noisy samples per calibration point
    const samples: CalibrationSample[] = [
      // Point 1: screen (0, 0), noisy iris around (0.1, 0.1)
      { irisX: 0.09, irisY: 0.10, screenX: 0, screenY: 0 },
      { irisX: 0.11, irisY: 0.10, screenX: 0, screenY: 0 },
      { irisX: 0.10, irisY: 0.09, screenX: 0, screenY: 0 },
      // Point 2: screen (1920, 0)
      { irisX: 0.89, irisY: 0.10, screenX: 1920, screenY: 0 },
      { irisX: 0.91, irisY: 0.10, screenX: 1920, screenY: 0 },
      { irisX: 0.90, irisY: 0.09, screenX: 1920, screenY: 0 },
      // Point 3: screen (0, 1080)
      { irisX: 0.10, irisY: 0.89, screenX: 0, screenY: 1080 },
      { irisX: 0.10, irisY: 0.91, screenX: 0, screenY: 1080 },
      { irisX: 0.09, irisY: 0.90, screenX: 0, screenY: 1080 },
      // Point 4: screen (1920, 1080)
      { irisX: 0.90, irisY: 0.90, screenX: 1920, screenY: 1080 },
      { irisX: 0.91, irisY: 0.91, screenX: 1920, screenY: 1080 },
      { irisX: 0.89, irisY: 0.89, screenX: 1920, screenY: 1080 },
      // Point 5: screen (960, 540)
      { irisX: 0.50, irisY: 0.50, screenX: 960, screenY: 540 },
      { irisX: 0.51, irisY: 0.49, screenX: 960, screenY: 540 },
      { irisX: 0.49, irisY: 0.51, screenX: 960, screenY: 540 },
      // Point 6: screen (960, 0)
      { irisX: 0.50, irisY: 0.10, screenX: 960, screenY: 0 },
      { irisX: 0.51, irisY: 0.09, screenX: 960, screenY: 0 },
      { irisX: 0.49, irisY: 0.11, screenX: 960, screenY: 0 },
    ]

    const model = solvePolynomial(samples)
    // Should still produce reasonable predictions despite noise
    const center = predictGaze(model, 0.5, 0.5)
    expect(center.x).toBeCloseTo(960, -2)
    expect(center.y).toBeCloseTo(540, -2)
  })
})

describe('predictGaze', () => {
  it('evaluates the polynomial correctly', () => {
    const model = {
      coeffsX: [100, 200, 50, 10, 5, 3], // a0 + a1*x + a2*y + a3*xy + a4*x² + a5*y²
      coeffsY: [50, 30, 300, 8, 2, 7],
    }

    // At (0, 0): should return (a0, b0) = (100, 50)
    const origin = predictGaze(model, 0, 0)
    expect(origin.x).toBeCloseTo(100)
    expect(origin.y).toBeCloseTo(50)

    // At (1, 0): a0 + a1 + a4 = 100 + 200 + 5 = 305
    const right = predictGaze(model, 1, 0)
    expect(right.x).toBeCloseTo(305)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/extension && npx vitest run --reporter=verbose`
Expected: FAIL — module `../offscreen/polynomial` not found

- [ ] **Step 4: Implement polynomial solver**

```typescript
// packages/extension/src/offscreen/polynomial.ts

export interface CalibrationSample {
  irisX: number
  irisY: number
  screenX: number
  screenY: number
}

export interface PolynomialModel {
  coeffsX: number[] // [a0, a1, a2, a3, a4, a5]
  coeffsY: number[] // [b0, b1, b2, b3, b4, b5]
}

/** Build design matrix row: [1, ix, iy, ix*iy, ix², iy²] */
function designRow(ix: number, iy: number): number[] {
  return [1, ix, iy, ix * iy, ix * ix, iy * iy]
}

/** Solve Ax = b via Gaussian elimination with partial pivoting (for small N). */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  const aug = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    }
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n]
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j]
    }
    x[i] /= aug[i][i]
  }
  return x
}

/**
 * Fit a quadratic polynomial mapping (irisX, irisY) → (screenX, screenY)
 * using least-squares on calibration samples.
 *
 * Requires at least 6 samples spanning 6 distinct iris positions.
 */
export function solvePolynomial(samples: CalibrationSample[]): PolynomialModel {
  const NC = 6
  const A = samples.map((s) => designRow(s.irisX, s.irisY))
  const bx = samples.map((s) => s.screenX)
  const by = samples.map((s) => s.screenY)

  // Normal equations: (A^T A) coeffs = A^T b
  const ATA: number[][] = Array.from({ length: NC }, () => new Array(NC).fill(0))
  const ATbx = new Array(NC).fill(0)
  const ATby = new Array(NC).fill(0)

  for (let i = 0; i < NC; i++) {
    for (let j = 0; j < NC; j++) {
      for (let k = 0; k < samples.length; k++) {
        ATA[i][j] += A[k][i] * A[k][j]
      }
    }
    for (let k = 0; k < samples.length; k++) {
      ATbx[i] += A[k][i] * bx[k]
      ATby[i] += A[k][i] * by[k]
    }
  }

  return {
    coeffsX: solveLinearSystem(ATA, ATbx),
    coeffsY: solveLinearSystem(ATA, ATby),
  }
}

/** Predict screen coordinates from normalized iris position using a fitted model. */
export function predictGaze(
  model: PolynomialModel,
  irisX: number,
  irisY: number,
): { x: number; y: number } {
  const row = designRow(irisX, irisY)
  let x = 0
  let y = 0
  for (let i = 0; i < 6; i++) {
    x += model.coeffsX[i] * row[i]
    y += model.coeffsY[i] * row[i]
  }
  return { x, y }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run --reporter=verbose`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/extension/vitest.config.ts packages/extension/src/offscreen/polynomial.ts packages/extension/src/__tests__/polynomial.test.ts
git commit -m "feat: add polynomial least-squares solver for gaze calibration (TDD)"
```

---

### Task 2: Implement Iris Normalization (TDD)

**Files:**
- Create: `packages/extension/src/offscreen/iris.ts`
- Create: `packages/extension/src/__tests__/iris.test.ts`

- [ ] **Step 1: Write failing tests for iris normalization**

```typescript
// packages/extension/src/__tests__/iris.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeIrisPosition, type IrisData } from '../offscreen/iris'

describe('normalizeIrisPosition', () => {
  /** Helper: builds IrisData with iris centered in both eyes. */
  function centered(): IrisData {
    return {
      leftIrisCenter: { x: 0.60, y: 0.35, z: 0 },
      rightIrisCenter: { x: 0.40, y: 0.35, z: 0 },
      // Left eye (right side of image): outer.x > inner.x
      leftOuterCorner: { x: 0.65, y: 0.35, z: 0 },
      leftInnerCorner: { x: 0.55, y: 0.35, z: 0 },
      // Right eye (left side of image): outer.x < inner.x
      rightOuterCorner: { x: 0.35, y: 0.35, z: 0 },
      rightInnerCorner: { x: 0.45, y: 0.35, z: 0 },
      // Eyelids
      leftUpperEyelid: { x: 0.60, y: 0.32, z: 0 },
      leftLowerEyelid: { x: 0.60, y: 0.38, z: 0 },
      rightUpperEyelid: { x: 0.40, y: 0.32, z: 0 },
      rightLowerEyelid: { x: 0.40, y: 0.38, z: 0 },
    }
  }

  it('returns ~0.5 when iris is centered in both eyes', () => {
    const result = normalizeIrisPosition(centered())
    expect(result.x).toBeCloseTo(0.5, 1)
    expect(result.y).toBeCloseTo(0.5, 1)
  })

  it('produces consistent x when both eyes look right', () => {
    const data = centered()
    // Shift both irises rightward (toward outer corner of left eye)
    data.leftIrisCenter = { x: 0.63, y: 0.35, z: 0 }
    data.rightIrisCenter = { x: 0.43, y: 0.35, z: 0 }

    const result = normalizeIrisPosition(data)
    // Both eyes looking right → t_x > 0.5
    expect(result.x).toBeGreaterThan(0.5)
  })

  it('produces consistent x when both eyes look left', () => {
    const data = centered()
    data.leftIrisCenter = { x: 0.57, y: 0.35, z: 0 }
    data.rightIrisCenter = { x: 0.37, y: 0.35, z: 0 }

    const result = normalizeIrisPosition(data)
    expect(result.x).toBeLessThan(0.5)
  })

  it('uses eyelids for vertical normalization', () => {
    const data = centered()
    // Move iris up (toward upper eyelid)
    data.leftIrisCenter = { x: 0.60, y: 0.33, z: 0 }
    data.rightIrisCenter = { x: 0.40, y: 0.33, z: 0 }

    const result = normalizeIrisPosition(data)
    // Looking up → t_y < 0.5
    expect(result.y).toBeLessThan(0.5)
  })

  it('handles right eye corner reversal via min/max', () => {
    const data = centered()
    // Right eye: inner (362) has larger x than outer (263)
    // This is the normal case for camera-native (non-mirrored) coordinates
    // min/max should handle it transparently
    const result = normalizeIrisPosition(data)
    expect(result.x).toBeCloseTo(0.5, 1)
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/extension && npx vitest run --reporter=verbose`
Expected: FAIL — module `../offscreen/iris` not found

- [ ] **Step 3: Implement iris normalization**

```typescript
// packages/extension/src/offscreen/iris.ts

export interface Landmark {
  x: number
  y: number
  z: number
}

export interface IrisData {
  leftIrisCenter: Landmark   // landmark 468
  rightIrisCenter: Landmark  // landmark 473
  leftInnerCorner: Landmark  // landmark 133
  leftOuterCorner: Landmark  // landmark 33
  rightInnerCorner: Landmark // landmark 362
  rightOuterCorner: Landmark // landmark 263
  leftUpperEyelid: Landmark  // landmark 159
  leftLowerEyelid: Landmark  // landmark 145
  rightUpperEyelid: Landmark // landmark 386
  rightLowerEyelid: Landmark // landmark 374
}

/**
 * Compute normalized iris position (0–1) from face landmarks.
 *
 * Horizontal: iris center relative to eye corners (min/max for sign consistency).
 * Vertical: iris center relative to upper/lower eyelids.
 * Both eyes averaged for stability.
 */
export function normalizeIrisPosition(data: IrisData): { x: number; y: number } {
  // Left eye — horizontal
  const lMinX = Math.min(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lMaxX = Math.max(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lTx = (data.leftIrisCenter.x - lMinX) / (lMaxX - lMinX)

  // Left eye — vertical (eyelids)
  const lTy =
    (data.leftIrisCenter.y - data.leftUpperEyelid.y) /
    (data.leftLowerEyelid.y - data.leftUpperEyelid.y)

  // Right eye — horizontal
  const rMinX = Math.min(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rMaxX = Math.max(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rTx = (data.rightIrisCenter.x - rMinX) / (rMaxX - rMinX)

  // Right eye — vertical (eyelids)
  const rTy =
    (data.rightIrisCenter.y - data.rightUpperEyelid.y) /
    (data.rightLowerEyelid.y - data.rightUpperEyelid.y)

  return {
    x: (lTx + rTx) / 2,
    y: (lTy + rTy) / 2,
  }
}

/** MediaPipe landmark indices used for iris tracking. */
export const IRIS_LANDMARKS = {
  leftIrisCenter: 468,
  rightIrisCenter: 473,
  leftInnerCorner: 133,
  leftOuterCorner: 33,
  rightInnerCorner: 362,
  rightOuterCorner: 263,
  leftUpperEyelid: 159,
  leftLowerEyelid: 145,
  rightUpperEyelid: 386,
  rightLowerEyelid: 374,
} as const

/** Extract IrisData from a MediaPipe NormalizedLandmark array (478 landmarks). */
export function extractIrisData(landmarks: Landmark[]): IrisData {
  const L = IRIS_LANDMARKS
  return {
    leftIrisCenter: landmarks[L.leftIrisCenter],
    rightIrisCenter: landmarks[L.rightIrisCenter],
    leftInnerCorner: landmarks[L.leftInnerCorner],
    leftOuterCorner: landmarks[L.leftOuterCorner],
    rightInnerCorner: landmarks[L.rightInnerCorner],
    rightOuterCorner: landmarks[L.rightOuterCorner],
    leftUpperEyelid: landmarks[L.leftUpperEyelid],
    leftLowerEyelid: landmarks[L.leftLowerEyelid],
    rightUpperEyelid: landmarks[L.rightUpperEyelid],
    rightLowerEyelid: landmarks[L.rightLowerEyelid],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run --reporter=verbose`
Expected: All iris tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/offscreen/iris.ts packages/extension/src/__tests__/iris.test.ts
git commit -m "feat: add iris normalization utilities for MediaPipe landmarks (TDD)"
```

---

## Chunk 2: Dependencies, Types, Build Config, and Offscreen Rewrite

### Task 3: Update Dependencies and Build Config

**Files:**
- Modify: `packages/extension/package.json:20` — swap webgazer for @mediapipe/tasks-vision
- Modify: `packages/extension/vite.config.ts:13-68,83-85,95` — remove patchWebGazer, TF.js aliases, sandbox input; add MediaPipe file copy
- Modify: `packages/extension/manifest.json:33-38` — remove unsafe-eval CSP + sandbox pages

- [ ] **Step 1: Update package.json — remove webgazer, add @mediapipe/tasks-vision**

In `packages/extension/package.json`, replace the `"webgazer": "^2.1.0"` dependency with `"@mediapipe/tasks-vision": "^0.10.14"`.

Also add `"vite-plugin-static-copy": "^2.2.0"` to devDependencies for WASM file copying.

- [ ] **Step 2: Run npm install**

Run: `cd packages/extension && npm install`
Expected: Clean install with no webgazer, @mediapipe/tasks-vision added

- [ ] **Step 3: Download MediaPipe face_landmarker model**

The model file is not included in the npm package and must be downloaded separately.

Run:
```bash
mkdir -p packages/extension/public/mediapipe/models
curl -L -o packages/extension/public/mediapipe/models/face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
```

Add `packages/extension/public/mediapipe/models/face_landmarker.task` to `.gitignore` (binary, ~2.5MB). Add a postinstall script to `package.json` to automate this download:

```json
"scripts": {
  "postinstall": "node scripts/download-mediapipe-model.js"
}
```

Create `packages/extension/scripts/download-mediapipe-model.js`:
```javascript
const fs = require('fs')
const path = require('path')
const https = require('https')

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const OUT_DIR = path.join(__dirname, '..', 'public', 'mediapipe', 'models')
const OUT_PATH = path.join(OUT_DIR, 'face_landmarker.task')

if (fs.existsSync(OUT_PATH)) {
  console.log('[MediaPipe] Model already downloaded.')
  process.exit(0)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
console.log('[MediaPipe] Downloading face_landmarker.task ...')

function download(url, dest, maxRedirects = 5) {
  if (maxRedirects <= 0) {
    console.error('[MediaPipe] Too many redirects')
    process.exit(1)
  }
  https.get(url, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      download(res.headers.location, dest, maxRedirects - 1)
      return
    }
    if (res.statusCode !== 200) {
      console.error(`[MediaPipe] HTTP ${res.statusCode}`)
      process.exit(1)
    }
    const file = fs.createWriteStream(dest)
    res.pipe(file)
    file.on('finish', () => {
      file.close()
      const size = fs.statSync(dest).size
      if (size < 100000) {
        fs.unlinkSync(dest)
        console.error('[MediaPipe] Downloaded file too small — likely an error page')
        process.exit(1)
      }
      console.log(`[MediaPipe] Model downloaded (${(size / 1e6).toFixed(1)} MB).`)
    })
  }).on('error', (err) => {
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
    console.error('[MediaPipe] Download failed:', err.message)
    process.exit(1)
  })
}

download(MODEL_URL, OUT_PATH)
```

- [ ] **Step 4: Rewrite vite.config.ts**

Remove `patchWebGazer()` plugin (lines 13-68), TF.js aliases (lines 83-85), and the `sandbox` input (line 95). Add `viteStaticCopy` to copy MediaPipe WASM files and model to the build output.

The complete replacement file (based on the actual current `vite.config.ts`):

```typescript
// packages/extension/vite.config.ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    // patchWebGazer() — REMOVED (no longer using WebGazer)
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'mediapipe/wasm',
        },
        {
          src: 'public/mediapipe/models/*',
          dest: 'mediapipe/models',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@gazekit/shared': resolve(__dirname, '../shared/src'),
      // TF.js aliases — REMOVED (MediaPipe uses its own WASM runtime)
    },
  },
  build: {
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        calibration: resolve(__dirname, 'src/calibration/calibration.html'),
        // sandbox — REMOVED (no more sandbox iframe)
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
})
```

- [ ] **Step 5: Update manifest.json**

Remove the `content_security_policy.sandbox` entry and the `sandbox.pages` array. Remove `unsafe-eval` from CSP since MediaPipe uses WASM (allowed by default).

The offscreen document loads MediaPipe files from the extension's own origin via `chrome.runtime.getURL()`, so `web_accessible_resources` entries for MediaPipe files are **not needed** (they would unnecessarily expose internal files to all websites). Only add them if you encounter loading errors during manual testing.

- [ ] **Step 6: Verify build compiles**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds (there may be unused import warnings for removed sandbox references — those will be fixed in subsequent tasks)

- [ ] **Step 7: Commit**

```bash
git add packages/extension/package.json packages/extension/vite.config.ts packages/extension/manifest.json packages/extension/scripts/ packages/extension/public/mediapipe/ .gitignore
git commit -m "chore: swap webgazer for @mediapipe/tasks-vision, update build config"
```

---

### Task 4: Update Shared Types and Constants

**Files:**
- Modify: `packages/shared/src/types/gaze.ts:42,70-73`
- Modify: `packages/shared/src/constants.ts:5-15`

- [ ] **Step 1: Update CalibrationResult.method and SessionMeta.tracking types**

In `packages/shared/src/types/gaze.ts`:

Update `CalibrationResult.method` (around line 42) to include the new method:
```typescript
method: '9-point' | '13-point' | '21-point' | '9-point-dwell' | '6-point-polynomial'
```

Update `SessionMeta.tracking` (around lines 70-73) to accept MediaPipe:
```typescript
tracking: {
  library: 'webgazer' | 'mediapipe'
  version: string
  regressionModel: 'ridge' | 'polynomial'
  avgFps: number
}
```

- [ ] **Step 2: Update CALIBRATION_POINTS to 6-point layout**

In `packages/shared/src/constants.ts`, replace the 9-point grid (lines 5-15) with:

```typescript
export const CALIBRATION_POINTS = [
  // Top row (3 points)
  { x: 0.2, y: 0.2 },
  { x: 0.5, y: 0.2 },
  { x: 0.8, y: 0.2 },
  // Center
  { x: 0.5, y: 0.5 },
  // Bottom corners (2 points)
  { x: 0.2, y: 0.8 },
  { x: 0.8, y: 0.8 },
]
```

Also add validation points:
```typescript
export const VALIDATION_POINTS = [
  { x: 0.35, y: 0.35 },
  { x: 0.65, y: 0.65 },
  { x: 0.50, y: 0.75 },
]
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/gaze.ts packages/shared/src/constants.ts
git commit -m "feat: update types and calibration points for 6-point polynomial method"
```

---

### Task 5: Create MediaPipe FaceLandmarker Wrapper

**Files:**
- Create: `packages/extension/src/offscreen/faceLandmarker.ts`

- [ ] **Step 1: Implement FaceLandmarker wrapper**

This module initializes MediaPipe and provides a clean interface for the offscreen document and calibration hook.

```typescript
// packages/extension/src/offscreen/faceLandmarker.ts
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { extractIrisData, normalizeIrisPosition, type IrisData } from './iris'

let faceLandmarker: FaceLandmarker | null = null

/** Initialize the MediaPipe FaceLandmarker with WASM from local extension files. */
export async function initFaceLandmarker(
  wasmPath: string,
  modelPath: string,
): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(wasmPath)
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  })
}

export interface GazePredictionRaw {
  faceDetected: boolean
  irisData: IrisData | null
  normalizedIris: { x: number; y: number } | null
}

/** Run face landmark detection on a video frame and extract iris data. */
export function detectGaze(
  video: HTMLVideoElement,
  timestampMs: number,
): GazePredictionRaw {
  if (!faceLandmarker) {
    return { faceDetected: false, irisData: null, normalizedIris: null }
  }

  const result = faceLandmarker.detectForVideo(video, timestampMs)

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { faceDetected: false, irisData: null, normalizedIris: null }
  }

  const landmarks = result.faceLandmarks[0]
  if (landmarks.length < 478) {
    // No iris landmarks available
    return { faceDetected: true, irisData: null, normalizedIris: null }
  }

  const irisData = extractIrisData(landmarks)
  const normalizedIris = normalizeIrisPosition(irisData)

  return { faceDetected: true, irisData, normalizedIris }
}

/** Clean up MediaPipe resources. */
export function closeFaceLandmarker(): void {
  faceLandmarker?.close()
  faceLandmarker = null
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds (confirms @mediapipe/tasks-vision imports resolve and iris.ts integration works)

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/offscreen/faceLandmarker.ts
git commit -m "feat: add MediaPipe FaceLandmarker wrapper with iris extraction"
```

---

### Task 6: Rewrite Offscreen Gaze Engine

**Files:**
- Modify: `packages/extension/src/offscreen/offscreen.ts` — heavy rewrite

This is the largest single change. The sandbox iframe relay is replaced with direct MediaPipe processing. The One Euro Filter, outlier rejection, WebSocket client, and batch flushing are kept.

- [ ] **Step 1: Rewrite offscreen.ts**

**Preserve unchanged:**
- `OneEuroFilter` class (lines 9-61)
- `WebSocketClient` class (lines 67-215)
- `startGazeFlush()` function (lines 375-391) — keep the 100ms batching
- `chrome.runtime.onMessage` listener (lines 480-541) — keep ping/connect/disconnect/send/start_gaze/stop_gaze handlers
- Module-level variables: `gazeVideo`, `gazeStream`, `gazeBuffer`, `gazeFilterX`, `gazeFilterY`, `gazeFlushTimer`, `gazeFlushCount`, `gazeFrameLoop`, `lastAcceptedX`, `lastAcceptedY`, `nullPredictionCount`

**Remove entirely:**
- `loadAndImportModel()` (lines 243-264)
- `handleSandboxMessage()` (lines 266-354)
- `startFrameLoop()` (lines 356-373)
- `window.addEventListener('message', handleSandboxMessage)` from `startGazeEngine`
- Module-level variables: `gazeIframe`, `gazeCanvas`, `gazeCtx` (no longer needed — sandbox removed)

**Add imports at top:**
```typescript
import { initFaceLandmarker, detectGaze, closeFaceLandmarker } from './faceLandmarker'
import { predictGaze, type PolynomialModel } from './polynomial'
```

**Add module-level variable:**
```typescript
let polynomialModel: PolynomialModel | null = null
```

**Replace `loadAndImportModel` with:**
```typescript
async function loadPolynomialModel(): Promise<void> {
  const stored = await chrome.storage.local.get('gazekit:model')
  const data = stored['gazekit:model']
  if (data?.coeffsX && data?.coeffsY) {
    polynomialModel = { coeffsX: data.coeffsX, coeffsY: data.coeffsY }
    console.log('[GazeKit Offscreen] Polynomial model loaded')
  } else {
    console.warn('[GazeKit Offscreen] No calibration model found')
  }
}
```

**Note on `chrome.storage.local`:** The existing code routed model loading through the service worker (`chrome.runtime.sendMessage({ type: 'get_calibration_model' })`). This was unnecessary — offscreen documents in Manifest V3 have direct `chrome.storage` access when the `storage` permission is declared. The new code uses `chrome.storage.local.get()` directly.

**Replace `startFrameLoop` + `handleSandboxMessage` gaze processing with:**
```typescript
function startDetectionLoop(): void {
  const detect = () => {
    if (!gazeVideo || gazeVideo.readyState < 2) {
      gazeFrameLoop = setTimeout(detect, 16)
      return
    }

    const raw = detectGaze(gazeVideo, performance.now())

    if (!raw.faceDetected || !raw.normalizedIris || !polynomialModel) {
      nullPredictionCount++
      if (nullPredictionCount === 50) {
        console.warn('[GazeKit Offscreen] 50 consecutive null predictions — check calibration')
      }
      gazeFrameLoop = setTimeout(detect, 16)
      return
    }

    nullPredictionCount = 0
    const pred = predictGaze(polynomialModel, raw.normalizedIris.x, raw.normalizedIris.y)
    const now = Date.now()

    // Outlier rejection (>400px jump)
    if (lastAcceptedX !== null && lastAcceptedY !== null) {
      const dx = pred.x - lastAcceptedX
      const dy = pred.y - lastAcceptedY
      if (Math.sqrt(dx * dx + dy * dy) > 400) {
        gazeFrameLoop = setTimeout(detect, 16)
        return
      }
    }

    // One Euro Filter expects millisecond timestamps (it divides by 1000 internally).
    // Pass Date.now() directly — do NOT divide by 1000 here.
    const filteredX = gazeFilterX.filter(pred.x, now)
    const filteredY = gazeFilterY.filter(pred.y, now)
    lastAcceptedX = filteredX
    lastAcceptedY = filteredY

    gazeBuffer.push({ x: filteredX, y: filteredY, ts: now, conf: null })
    gazeFrameLoop = setTimeout(detect, 16)
  }

  detect()
}
```

**Replace `startGazeEngine` with:**
```typescript
async function startGazeEngine(): Promise<void> {
  try {
    // Get camera stream (same as before)
    gazeStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    })

    // Create hidden video element (same as before)
    gazeVideo = document.createElement('video')
    gazeVideo.srcObject = gazeStream
    gazeVideo.width = 640
    gazeVideo.height = 480
    gazeVideo.autoplay = true
    gazeVideo.playsInline = true
    gazeVideo.muted = true
    gazeVideo.style.position = 'fixed'
    gazeVideo.style.opacity = '0'
    gazeVideo.style.pointerEvents = 'none'
    document.body.appendChild(gazeVideo)
    await gazeVideo.play()

    // Initialize MediaPipe (replaces sandbox iframe creation)
    const wasmPath = chrome.runtime.getURL('mediapipe/wasm')
    const modelPath = chrome.runtime.getURL('mediapipe/models/face_landmarker.task')
    await initFaceLandmarker(wasmPath, modelPath)

    // Load calibration model
    await loadPolynomialModel()

    // Start gaze prediction loop and flush timer
    startDetectionLoop()
    startGazeFlush()

    console.log('[GazeKit Offscreen] Gaze engine started (MediaPipe)')
  } catch (err) {
    console.error('[GazeKit Offscreen] Failed to start gaze engine:', err)
  }
}
```

**Replace `stopGazeEngine` with:**
```typescript
function stopGazeEngine(): void {
  // Stop detection loop
  if (gazeFrameLoop) clearTimeout(gazeFrameLoop)
  gazeFrameLoop = null

  // Stop flush timer
  if (gazeFlushTimer) clearInterval(gazeFlushTimer)
  gazeFlushTimer = null

  // Clean up MediaPipe
  closeFaceLandmarker()
  polynomialModel = null

  // Clean up video + camera stream
  if (gazeVideo) {
    gazeVideo.remove()
    gazeVideo = null
  }
  if (gazeStream) {
    gazeStream.getTracks().forEach((t) => t.stop())
    gazeStream = null
  }

  // Reset state
  gazeBuffer = []
  lastAcceptedX = null
  lastAcceptedY = null
  nullPredictionCount = 0

  console.log('[GazeKit Offscreen] Gaze engine stopped')
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/offscreen/offscreen.ts
git commit -m "feat: rewrite offscreen gaze engine to use MediaPipe directly (no sandbox)"
```

---

### Task 7: Update Service Worker

**Files:**
- Modify: `packages/extension/src/background/service-worker.ts`

- [ ] **Step 1: Remove IFRAME_SCRIPTING from offscreen reasons**

At line 81-84, update `ensureOffscreenDocument()`:

Change reasons from:
```typescript
reasons: [
  chrome.offscreen.Reason.WORKERS,
  chrome.offscreen.Reason.USER_MEDIA,
  chrome.offscreen.Reason.IFRAME_SCRIPTING,
],
```
to:
```typescript
reasons: [
  chrome.offscreen.Reason.WORKERS,
  chrome.offscreen.Reason.USER_MEDIA,
],
```

Update the `justification` string to remove sandbox references (e.g., `"WebSocket connection and webcam gaze tracking"`).

- [ ] **Step 2: Update session metadata**

At line 324, change:
```typescript
tracking: {
  library: 'webgazer',
  version: '',
  regressionModel: 'ridge',
  avgFps: 0,
}
```
to:
```typescript
tracking: {
  library: 'mediapipe',
  version: '',
  regressionModel: 'polynomial',
  avgFps: 0,
}
```

Also update the fallback `CalibrationResult` (around line 314) — change `method: '9-point'` to `method: '6-point-polynomial'`.

- [ ] **Step 3: Remove dead `get_calibration_model` handler**

At line 580-583, the `case 'get_calibration_model'` handler is now dead code — the offscreen document loads the model directly from `chrome.storage.local` instead of asking the service worker. Remove this handler:

```typescript
// DELETE this block:
case 'get_calibration_model': {
  const stored = await chrome.storage.local.get('gazekit:model')
  return { model: stored['gazekit:model'] ?? null }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/background/service-worker.ts
git commit -m "fix: update service worker for MediaPipe (remove sandbox refs, update metadata, remove dead handler)"
```

---

## Chunk 3: Calibration UI and Cleanup

### Task 8: Create useMediaPipe Hook

**Files:**
- Create: `packages/extension/src/calibration/hooks/useMediaPipe.ts`

This hook replaces `useWebGazer.ts`. It initializes MediaPipe FaceLandmarker, runs a prediction loop, collects calibration samples, and solves the polynomial model.

- [ ] **Step 1: Implement useMediaPipe hook**

```typescript
// packages/extension/src/calibration/hooks/useMediaPipe.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  initFaceLandmarker,
  detectGaze,
  closeFaceLandmarker,
} from '../../offscreen/faceLandmarker'
import { solvePolynomial, predictGaze, type CalibrationSample, type PolynomialModel } from '../../offscreen/polynomial'

export interface UseMediaPipeReturn {
  isReady: boolean
  faceDetected: boolean
  prediction: { x: number; y: number } | null
  error: string | null
  start: (stream: MediaStream) => Promise<void>
  stop: () => void
  recordScreenPosition: (x: number, y: number) => void
  exportModel: () => Promise<PolynomialModel | null>
  getPrediction: () => { x: number; y: number } | null
}

export function useMediaPipe(): UseMediaPipeReturn {
  const [isReady, setIsReady] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [prediction, setPrediction] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const predictionRef = useRef<{ x: number; y: number } | null>(null)
  const samplesRef = useRef<CalibrationSample[]>([])
  const modelRef = useRef<PolynomialModel | null>(null)

  const start = useCallback(async (stream: MediaStream) => {
    try {
      streamRef.current = stream

      // Create hidden video element
      const video = document.createElement('video')
      video.srcObject = stream
      video.width = 640
      video.height = 480
      video.autoplay = true
      video.playsInline = true
      video.muted = true
      video.style.position = 'fixed'
      video.style.opacity = '0'
      video.style.pointerEvents = 'none'
      document.body.appendChild(video)
      await video.play()
      videoRef.current = video

      // Initialize MediaPipe
      const wasmPath = chrome.runtime.getURL('mediapipe/wasm')
      const modelPath = chrome.runtime.getURL('mediapipe/models/face_landmarker.task')
      await initFaceLandmarker(wasmPath, modelPath)

      setIsReady(true)

      // Start prediction loop
      const loop = () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(loop)
          return
        }

        const raw = detectGaze(videoRef.current, performance.now())
        setFaceDetected(raw.faceDetected)

        if (raw.normalizedIris && modelRef.current) {
          const pred = predictGaze(modelRef.current, raw.normalizedIris.x, raw.normalizedIris.y)
          predictionRef.current = pred
          setPrediction(pred)
        } else if (raw.normalizedIris) {
          // During calibration (no model yet), still update prediction ref
          // with raw normalized values for face detection feedback
          predictionRef.current = null
          setPrediction(null)
        }

        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const recordScreenPosition = useCallback((x: number, y: number) => {
    if (!videoRef.current || videoRef.current.readyState < 2) return

    const raw = detectGaze(videoRef.current, performance.now())
    if (raw.normalizedIris) {
      samplesRef.current.push({
        irisX: raw.normalizedIris.x,
        irisY: raw.normalizedIris.y,
        screenX: x,
        screenY: y,
      })
    }
  }, [])

  const exportModel = useCallback(async (): Promise<PolynomialModel | null> => {
    if (samplesRef.current.length < 6) {
      console.warn('[useMediaPipe] Not enough samples to solve polynomial')
      return null
    }

    const model = solvePolynomial(samplesRef.current)
    modelRef.current = model
    return model
  }, [])

  const getPrediction = useCallback(() => predictionRef.current, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    closeFaceLandmarker()
    if (videoRef.current) {
      videoRef.current.remove()
      videoRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setIsReady(false)
    setFaceDetected(false)
    setPrediction(null)
    samplesRef.current = []
    modelRef.current = null
  }, [])

  useEffect(() => {
    return () => { stop() }
  }, [stop])

  return {
    isReady,
    faceDetected,
    prediction,
    error,
    start,
    stop,
    recordScreenPosition,
    exportModel,
    getPrediction,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/calibration/hooks/useMediaPipe.ts
git commit -m "feat: add useMediaPipe hook replacing useWebGazer for calibration"
```

---

### Task 9: Update Calibration Flow

**Files:**
- Modify: `packages/extension/src/calibration/CalibrationApp.tsx`
- Modify: `packages/extension/src/calibration/steps/CalibrationStep.tsx`
- Modify: `packages/extension/src/calibration/steps/ValidationStep.tsx:12-22`
- Modify: `packages/extension/src/calibration/steps/ResultsStep.tsx:21`

- [ ] **Step 1: Update CalibrationApp.tsx**

Full list of changes (be thorough — the old file has many WebGazer-specific references):

1. **Import:** Replace `import { useWebGazer }` → `import { useMediaPipe }` from `./hooks/useMediaPipe`
2. **Import:** Remove `import LibraryCheckStep` entirely
3. **Type:** Remove `'library-check'` from the `CalibrationStage` union type (note: the actual code uses kebab-case `'library-check'`, not camelCase)
4. **Hook binding:** Rename `const webgazer = useWebGazer()` → `const mediapipe = useMediaPipe()`, then find-and-replace all `webgazer.` → `mediapipe.` in the file
5. **Stage flow:** In `handleFaceCheckNext`, change next stage from `'library-check'` to `'calibration'`
6. **Delete `handleLibraryCheckNext` callback** (around line 46-48) — dead code
7. **Remove `setPreviewMode` effect:** Delete the entire `useEffect` block (lines 121-129) that calls `webgazer.setPreviewMode(...)` — there is no sandbox iframe to preview with MediaPipe
8. **Update `stepIndicators` array** (around lines 99-107): remove the `'library-check'`/`'Eye Track'` entry
9. **Update `stageOrder` array** (around lines 109-117): remove `'library-check'` entry so `currentStageIndex` calculation stays correct
10. **Remove `listenerCount` references:** Remove any prop passing of `listenerCount` to child components, and remove the `${webgazer.listenerCount} samples` text from the status bar (around line 245)
11. **Update error banner text:** Change `"WebGazer Error"` → `"Eye Tracking Error"` (around line 139)
12. **Update status bar text:** Change `"Loading WebGazer..."` → `"Loading eye tracker..."` (around line 243)
13. **Update `handleValidationComplete`** to export polynomial model (keep the ref pattern for stable callback identity):

```typescript
const handleValidationComplete = useCallback(async (avgError: number) => {
  setAvgErrorPx(avgError)
  const modelData = await exportModelRef.current()
  if (modelData) {
    await chrome.storage.local.set({
      'gazekit:model': {
        coeffsX: modelData.coeffsX,
        coeffsY: modelData.coeffsY,
        calibratedAt: new Date().toISOString(),
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      },
    })
  }
  setStage('results')
}, [])
```

Keep `exportModelRef` pointed at `mediapipe.exportModel` via the existing ref-sync pattern.

14. **Remove LibraryCheckStep rendering block** from the JSX (the `stage === 'library-check' && (...)` block)

- [ ] **Step 2: Update CalibrationStep.tsx**

No code changes needed — this component already reads `CALIBRATION_POINTS` from shared constants (which we updated to 6 points in Task 4). It renders dots dynamically based on that array. The progress bar will automatically show "1/6" instead of "1/9".

Verify that the import resolves correctly: `import { CALIBRATION_POINTS } from '@gazekit/shared'`

- [ ] **Step 3: Update ValidationStep.tsx**

Three changes:

1. **Replace validation points:** Replace the inline 9-point `VALIDATION_POINTS` array (lines 12-22) with the import from shared constants:
```typescript
import { VALIDATION_POINTS } from '@gazekit/shared'
```
Remove the local `VALIDATION_POINTS` constant.

2. **Fix `getPrediction` signature:** The existing `ValidationStepProps` declares `getPrediction` as async (`() => Promise<...>`). The new `useMediaPipe` hook returns it as synchronous (`() => { x, y } | null`). Update the props interface:
```typescript
getPrediction: () => { x: number; y: number } | null
```
And in `collectSamples`, change `const pred = await getPrediction()` to `const pred = getPrediction()` (remove `await`).

3. **Remove `listenerCount` prop:** Remove `listenerCount` from `ValidationStepProps` interface and remove its usage in the debug overlay (around line 193-194).

- [ ] **Step 4: Update ResultsStep.tsx**

Change the calibration method from `'9-point-dwell'` to `'6-point-polynomial'` (line 21):

```typescript
method: '6-point-polynomial',
```

- [ ] **Step 5: Verify build compiles**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/calibration/CalibrationApp.tsx packages/extension/src/calibration/steps/CalibrationStep.tsx packages/extension/src/calibration/steps/ValidationStep.tsx packages/extension/src/calibration/steps/ResultsStep.tsx
git commit -m "feat: update calibration flow for 6-point polynomial (drop LibraryCheck)"
```

---

### Task 10: Delete Old Files and Clean Up

**Files:**
- Delete: `packages/extension/src/calibration/sandbox.html`
- Delete: `packages/extension/src/calibration/sandbox-entry.ts`
- Delete: `packages/extension/src/types/webgazer.d.ts`
- Delete: `packages/extension/src/content/gazeEngine.ts`
- Delete: `packages/extension/src/calibration/hooks/useWebGazer.ts`
- Delete: `packages/extension/src/calibration/steps/LibraryCheckStep.tsx`
- Modify: `packages/extension/src/content/tracker.ts:11-12` — update stale comments

- [ ] **Step 1: Delete old files**

```bash
rm packages/extension/src/calibration/sandbox.html
rm packages/extension/src/calibration/sandbox-entry.ts
rm packages/extension/src/types/webgazer.d.ts
rm packages/extension/src/content/gazeEngine.ts
rm packages/extension/src/calibration/hooks/useWebGazer.ts
rm packages/extension/src/calibration/steps/LibraryCheckStep.tsx
```

- [ ] **Step 2: Update stale comments in tracker.ts**

In `packages/extension/src/content/tracker.ts`, lines 11-12, update the comment from:
```
// Gaze samples arrive via messages from the offscreen document
// (where WebGazer runs inside a sandboxed iframe to satisfy CSP requirements).
```
to:
```
// Gaze samples arrive via messages from the offscreen document
// (where MediaPipe Face Mesh runs for gaze prediction).
```

- [ ] **Step 3: Verify build compiles with no dangling imports**

Run: `cd packages/extension && npm run build`
Expected: Build succeeds with no missing module errors

- [ ] **Step 4: Run all tests**

Run: `cd packages/extension && npx vitest run --reporter=verbose`
Expected: All polynomial and iris tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/calibration/sandbox.html packages/extension/src/calibration/sandbox-entry.ts packages/extension/src/types/webgazer.d.ts packages/extension/src/content/gazeEngine.ts packages/extension/src/calibration/hooks/useWebGazer.ts packages/extension/src/calibration/steps/LibraryCheckStep.tsx packages/extension/src/content/tracker.ts
git commit -m "chore: remove WebGazer files (sandbox, types, legacy gazeEngine, useWebGazer, LibraryCheckStep)"
```

---

## Post-Implementation Checklist

After all tasks are complete:

- [ ] Full build succeeds: `cd packages/extension && npm run build`
- [ ] All tests pass: `cd packages/extension && npx vitest run`
- [ ] Manual test: Load unpacked extension, run calibration flow with 6 dots
- [ ] Manual test: Verify gaze tracking on a real page after calibration
- [ ] Manual test: Verify heatmap overlay still works
- [ ] Manual test: Check that recalibration works (polynomial model is replaced)
- [ ] Verify no `webgazer` references remain: `grep -r "webgazer" packages/ --include="*.ts" --include="*.tsx" --include="*.json"`
- [ ] Verify no `sandbox` references remain in runtime code (build config references are OK to keep if needed)
