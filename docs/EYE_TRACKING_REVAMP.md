# Eye-Tracking Accuracy Revamp

**Date:** July 14–15, 2026
**Branch:** `feat/mediapipe-migration`
**Version:** 1.0.0

This document describes the full revamp of GazeKit's webcam eye-tracking pipeline — what was wrong, what the research said, what was rebuilt, and what remains as follow-up work.

---

## 1. Why the old pipeline was inaccurate

A code audit of the previous pipeline (MediaPipe FaceLandmarker → 2 hand-crafted features → unregularized quadratic polynomial) found five root causes:

1. **The vertical gaze feature didn't measure the eyes.** It was computed as nose-tip position relative to the eyes, normalized by face height — i.e. pure **head pitch**. A user scanning a page by moving only their eyes (the normal reading pattern) produced almost zero vertical signal. This was the single largest accuracy killer and the reason heatmaps smeared vertically.
2. **MediaPipe's best signals were disabled.** `outputFaceBlendshapes` (which includes the trained `eyeLookUp/Down/In/Out` gaze-direction outputs) was off, and the eyelid landmarks — a strong vertical-gaze cue — were extracted but never used.
3. **Calibration data was polluted.** All ~30 samples per dot were recorded blindly over a 1.5 s window: blinks, saccades to the target, and face-loss frames (which silently duplicated a stale value) all entered an unregularized least-squares fit with no pivot/NaN checks. A single blink could shift the whole mapping by tens of pixels; a degenerate fit could silently persist NaN coefficients.
4. **The 1200 px outlier gate deadlocked.** Rejected samples never updated the reference point, so after one legitimate large saccade (corner-to-corner on 1080p is ~2200 px) every subsequent sample was rejected forever — silently losing minutes of data.
5. **Coordinates were fragile.** The model learned the calibration tab's viewport pixels and sessions assumed the tracked tab's viewport was identical. Moving or resizing the window, changing page zoom, or opening DevTools introduced a systematic offset that no amount of gaze-model quality could fix. Validation measured error but gated nothing — even a 999 px sentinel failure saved the model.

## 2. What the research said

Five parallel research passes (academic literature, MediaPipe-specific techniques, open-source trackers, commercial platforms, and gaze signal processing) converged on a consistent recipe:

- **Canonicalize landmarks into a face-attached frame** (origin = midpoint of the outer eye corners 33/263, X-axis = corner-to-corner, Y from the top-of-head landmark, unit = inter-ocular distance). This removes head translation, scale, and rotation from the iris features by construction — the approach used by EyeTrax / EMC-Gaze (arXiv 2603.12388) and the Sherbrooke geometry paper (arXiv 2401.00406, 1.45° horizontal / 1.95° vertical from plain linear regression on 8 features).
- **Vertical gaze needs multiple cues**: canonical iris-Y relative to the eye corners, eyelid apertures as *features* (the lids track vertical gaze), and the blendshape gaze scores. The eyelids occlude the limbus, so vertical is fundamentally the harder axis (~1.2–1.5× the horizontal error).
- **Blendshapes are auxiliary, not primary.** MediaPipe's 52 blendshapes are computed by a small net whose only input is a 146-landmark 2D subset — they contain no information beyond the landmarks, but are a useful learned, head-normalized re-encoding.
- **Ridge regression beats polynomial least squares** by ~15–20 % MSE in calibration studies; degree > 2 always overfits 9–13 point calibrations. λ should be picked per-user (leave-one-point-out CV).
- **Calibration hygiene is the cheapest big win**: discard the saccade/settle window, reject blinks with an *adaptive* eye-aspect-ratio threshold (a fixed threshold misfires when looking down), MAD-trim outliers per point.
- **Commercial platforms (RealEye, iMotions, Tobii Sticky) win through protocol, not models**: 13+ calibration points to the screen edges, hard validation gates with forced recalibration, head-position monitoring, drift correction (accuracy decays ~40 % within 5 minutes), fixation-level heatmap aggregation, and per-session quality scores.
- **Filtering**: saccade-aware two-mode filtering beats a plain One Euro filter (Feit et al. CHI 2017, Manakhov et al. CHI 2024); at 30 Hz use dispersion-based (I-DT) fixation detection, never velocity-based.
- **Realistic accuracy floor**: ~1.5–2° (roughly 60–110 px at laptop geometry) with a mostly-still head; free head movement roughly doubles error.

## 3. The new architecture

### 3.1 Feature extraction — `packages/extension/src/offscreen/features.ts`

Every frame produces a **17-dimensional feature vector**:

| Features | What they capture |
|---|---|
| `irisLx, irisLy, irisRx, irisRy` | Per-eye iris offsets (mean of the 4 iris-boundary landmarks) relative to each eye's corner midpoint, in the canonical face frame — head-invariant eye-in-socket rotation |
| `lidGapL, lidGapR` | Eyelid apertures (canonical) — vertical gaze cue |
| `yaw, pitch, roll` | Head pose from the canonical basis (Euler decomposition) |
| `bsX, bsY` | Blendshape gaze re-encoding from `eyeLookIn/Out/Up/Down` |
| `faceX, faceY, interocular` | Face position in frame + inter-ocular distance (translation / depth proxies) |
| `irisXSq, irisYSq, irisXY` | Quadratic terms of the averaged iris offset (screen-plane flattening) |

Unit tests verify the canonical iris features are invariant to face translation, scale, and in-plane roll, and that they respond to actual iris movement on both axes.

Blink detection (`BlinkDetector`) uses an **adaptive EAR threshold** (80 % of a 50-frame rolling baseline, absolute fallback 0.2) with a 120 ms hold after recovery. All frames feed the baseline — a sustained look-down legitimately lowers the EAR and must pull the threshold down with it.

### 3.2 Mapping model — `packages/extension/src/offscreen/regression.ts`

- Closed-form **ridge regression** per axis on z-scored features (bias unregularized).
- **λ chosen by leave-one-calibration-point-out cross-validation** over a grid (1e-3 … 10).
- **MAD trimming** per calibration point (samples > 3.5 robust sigmas from the point median on the core iris features are dropped).
- Rows weighted so every calibration point contributes equally regardless of sample count.
- Features that were **constant during calibration are excluded** (std = 0) — their coefficients would be unidentifiable and a tiny stored std would amplify runtime variation into wild predictions.
- Degenerate-fit detection throughout: singular systems, non-finite coefficients, and too-few-points all **throw**, routing the user back to calibration instead of persisting garbage.

The model (v2, stored under `chrome.storage.local['gazekit:model']`) predicts **global screen pixels** and carries everything the runtime needs: weights, normalization stats, λ, calibration screen/window geometry, calibration-target bounding box (`calibBounds`), reference head pose, inter-ocular reference, camera device ID **and capture resolution**, and the validation metrics. `isValidGazeModel()` structurally validates every field the runtime dereferences before a stored model is accepted.

### 3.3 Calibration protocol — `packages/extension/src/calibration/`

- **13 points** (border sweep with corners at 6–8 % margins + inner ring + center) instead of 9 at 15 % margins — regression models extrapolate poorly outside the calibrated hull.
- Per point: 1.5 s settle (covers saccade latency) → 1.2 s shrink → **adaptive recording** that counts only quality samples (fresh, face detected, not blinking) and stops early at 25 or retries the point at the end of the queue if fewer than 10 were captured.
- The live prediction dot is **not** rendered during recording — it pulls the user's gaze off the target and bakes the previous model's error into the new fit.
- Instruction copy now says **"keep your head still, follow the dot with your eyes"** — with head-pose features excluded-if-constant, a still head yields the cleanest fit.
- **Validation**: 5 points including corner regions (the old 3 were all central), a 1 s settle discard per point, per-point **median** error, real **precision** (RMS dispersion around each point's own centroid), 95th-percentile error, and sample coverage.
- **Quality gate**: tiers are computed as fractions of the viewport diagonal (good < 5 %, usable < 9 %). A **"poor" calibration is never saved** — Start Tracking is disabled and Recalibrate becomes the primary action. The session-facing calibration record is likewise only persisted when the model was saved.

### 3.4 Runtime engine — `packages/extension/src/offscreen/offscreen.ts`

- **`requestVideoFrameCallback` loop** — exactly one inference per camera frame (the old `setTimeout(16)` loop re-inferred duplicate frames), with a timer fallback. The next frame is always scheduled *before* processing so a thrown frame (GPU context loss, camera unplug) can never kill the loop.
- **1280×720 capture** — the FaceLandmarker's face crop is resized to 256×256 internally; at 640×480 a face at sitting distance was being *upscaled* into the model. Both calibration and session use identical constraints (see §5).
- **Blink gating** — gaze is held during blinks + a 120 ms pad (the iris is occluded while the lid re-opens).
- **Saccade-aware gate** replacing the deadlocking 1200 px gate: a single far jump is held back one frame; if the next frame lands near it, that's a real saccade — it's accepted and the One Euro filters are **reset** so the cursor snaps instead of lagging across the screen. One-frame spikes are rejected.
- **One Euro retune**: minCutoff 0.8, beta 0.02 (fixation-stability biased; responsiveness comes from the saccade reset, per the CHI 2017/2024 findings).
- **Click-anchored drift correction**: users look where they click. Each click (forwarded from the content script in screen px) is compared to the median of the emitted gaze in the preceding 300 ms; a bounded, conservative screen-space bias (gain 0.3, ±200 px cap, outliers > 350 px ignored) absorbs the slow drift that otherwise dominates session-length error.
- **Real confidence values** per sample, from head-rotation deviation and inter-ocular scale change vs the calibration reference — downstream consumers can gate or weight by it (threshold 0.15 drops only samples where both penalties saturated).
- Predictions are validated finite and **clamped to the calibration-target bounding box** (+10 % margin).

### 3.5 Coordinate handling — `packages/shared/src/utils/screenCoords.ts`

The model is trained and predicts in **global screen pixels**:

- The calibration page converts dot positions client→screen using live window geometry and its **actual tab zoom** (fetched via `chrome.tabs.getZoom` — extension pages honor the user's default page zoom too).
- The content script converts each incoming sample screen→viewport using its own live geometry and the tab zoom pushed by the service worker (`chrome.tabs.getZoom` at session start + `onZoomChange` updates).
- Sessions therefore survive **window moves, resizes, zoom changes, and DevTools opening** after calibration.
- Real clicks reveal the *true* viewport origin (`MouseEvent.screenX − clientX·zoom`), which supersedes the chrome-height heuristic while the window geometry is unchanged — this covers side/bottom-docked DevTools, which break the even-split assumption.
- Samples landing more than 50 px outside the viewport (gaze at browser chrome or another window) are dropped, and samples are ignored entirely while the tracked tab is not visible — previously, minutes of gaze aimed at another tab were baked into the page's heatmap.

### 3.6 Data-path fixes

- **Fixation detection** (`shared/utils/fixationDetector.ts`): I-DT windows now split across sample gaps > 250 ms — previously a "fixation" could bridge a tracking-loss gap or two separate visits, producing a minutes-long duration that washed out heatmap normalization.
- **Heatmap kernel** default raised to 80 px (matching realistic gaze error) and the dashboard kernel now scales with the render size instead of being fixed in display px.
- Live heatmap overlay resize no longer shears accumulated heat diagonally (row-by-row grid copy).
- Server: session-wide `avgConfidence` is now a true weighted mean (accumulators) rather than the last batch's average.

### 3.7 Physical screen geometry — `packages/shared/src/utils/visualAngle.ts`

Gaze accuracy is angular (~1.5–2° floor for webcam trackers), so pixel thresholds mean different things on different screens. Screen size/resolution add nothing as regression inputs (they are constants within a calibration, and the px targets already encode them) — but they make thresholds and metrics *comparable across setups*:

- The calibration Camera step asks for the **physical screen diagonal** (optional, presets + custom, remembered in `chrome.storage.local['gazekit:screenDiagonalIn']`). This is the one physical fact no browser API exposes.
- **Viewing distance is estimated** from the model's `refInterocular` (median inter-ocular distance in frame-width units) via a pinhole model with an assumed 63 mm IPD and 60° webcam hFOV, clamped to 300–1200 mm. Estimate quality is ±10–20% — good enough for thresholds, not for optics.
- `derivePhysicalScreen()` bundles `{screenDiagonalMm, pxPerMm, viewingDistanceMm, pxPerDeg}` into `GazeModel.physical` (optional field — old stored models stay valid) and onto `CalibrationResult` (`pxPerDeg`, `avgErrorDeg`, …) so the server receives it with session metadata.
- **Quality tiers gate on degrees when available** (`CALIBRATION_QUALITY_DEG`: good < 2.2°, usable < 4.0°, matching the px gates at ~52 px/deg laptop geometry) and fall back to viewport-diagonal fractions otherwise. ResultsStep reports errors in degrees with px in parentheses.
- `FIXATION_DISPERSION_THRESHOLD_DEG = 1.0` (I-DT literature standard) is exported for consumers that have `pxPerDeg`; the 50 px constant remains the fallback. `fixationService.getFixations` uses the degree threshold when the session's `calibration.pxPerDeg` is present (schema fields added to the Mongoose `Session` model).

### 3.8 URL keying — `packages/shared/src/utils/urlNormalizer.ts`

Heatmap/fixation lookups join gaze `ctx.url` against screenshot/page URLs byte-for-byte, but the gaze context stripped `#fragments` while screenshots and page entries used the raw tab URL — any `#`-fragment URL silently produced "screenshot renders, Points: 0". All four write paths (gaze context in `batchManager`, interval screenshots, `page_change` heatmap snapshots, and the initial session `pages` entry in the service worker) now key through a single `normalizeGazeUrl()` (strips the fragment; hash-routed SPAs collapse into one page entry — the lesser evil vs. silent key mismatches).

## 4. Adversarial review

A 31-agent review workflow (5 dimensions — math, coordinate spaces, extension runtime, React lifecycle, data-path regressions — with independent adversarial verification of every claim) confirmed **21 real defects** in the first implementation, all fixed:

Highlights:

- **Calibration captured at 640×480 while sessions ran at 1280×720** — features are frame-normalized, so the 4:3 → 16:9 aspect change shifted the whole feature space between fit and predict, and validation (running on the calibration stream) could never catch it. Both now use identical constraints, the model stores the actual capture resolution, sessions request it, and an aspect mismatch is flagged.
- **The server's Mongoose enum rejected the new `'13-point-ridge'` method** — every session insert would have failed validation. Enum updated.
- **The prediction clamp assumed the calibrated monitor's origin was (0,0)** — on a multi-monitor desktop, calibrating on a secondary monitor would have pinned every sample to the clamp edge. The clamp is now anchored to the stored calibration-target bounding box.
- **ResultsStep persisted the calibration record even for rejected calibrations**, letting the popup enable Start Tracking with no (or a stale) model. The record is now gated on the model actually being saved.
- **One thrown frame permanently killed the rvfc loop** (re-registration happened after processing). Reordered + wrapped.
- **The old confidence threshold (0.4) silently dropped all samples at ~18° of head turn**; lowered to 0.15 so moderate deviations keep their samples with low confidence attached.
- Plus: extension-page zoom handling in calibration, double-start stream leaks, `start_gaze` failures silently ignored by the service worker (sessions now abort instead of running empty), MV3 service-worker revival racing state hydration, point grouping fragmenting when the window is nudged mid-calibration, stale predictions being sampled during blinks, and more.

## 5. Verification

- **30/30 unit tests pass** — ridge fitting/recovery, feature invariances (translation/scale/roll), blink detector adaptation, screen↔client round-trips with zoom and window moves, model validation (including the NaN-becomes-null JSON round-trip), fixation gap-splitting.
- **`tsc --noEmit`: 0 errors** across the extension (previously failing with 26 pre-existing errors, also fixed).
- **Full workspace build passes** (shared, extension, web client, web server).
- All package versions bumped **0.1.0 → 1.0.0** (including the extension `manifest.json`).

**Note:** v1 models are intentionally rejected at load — every user must recalibrate once after this update.

## 6. Remaining follow-ups (not done, highest impact first)

1. **Server-side scroll compensation.** Gaze is stored in viewport coordinates and `ctx.sy` (scroll offset) is never applied anywhere — heatmaps below the fold are misattributed to whatever the screenshot happens to show, regardless of gaze quality. Needs document-space fixation detection + full-page or scroll-matched screenshots (the screenshot `scrollY` is currently hardcoded to 0 in the service worker).
2. **Aggregate heatmap viewport mixing** — sessions with different viewports are merged in normalized space against one arbitrary screenshot.
3. **Virtual chinrest / mid-session drift check** — pause and re-align when head position deviates from the calibration pose (RealEye's recovery flow); currently head deviation only lowers confidence.
4. **Timestamp alignment** — element attribution and scroll context are captured at delivery (~100–150 ms after gaze); a scroll-state ring buffer would fix attribution during fast scrolling.
5. **Gaze-event retention policy** — the `gazeevents` collection has a 90-day TTL while Session/Screenshot docs live forever: old sessions keep a phantom `stats.totalGazePoints` count with zero surviving gaze docs (same "screenshot renders, Points: 0" symptom as a pipeline failure). Decide retention explicitly; don't treat `totalGazePoints` as proof gaze docs exist.
6. **Neural upgrade path** — WebEyeTrack (TF.js, 670 KB BlazeGaze + few-shot personalization) is the researched ceiling-raiser if the feature-based pipeline ever plateaus.

## 7. Key sources

- Ye et al., *Gaze estimation from MediaPipe landmarks* — arXiv 2401.00406 (1.45°/1.95° with linear regression on 8 features)
- EyeTrax — github.com/ck-zhang/EyeTrax; EMC-Gaze — arXiv 2603.12388 (canonicalization recipe, adaptive EAR, head-motion residual correction)
- RealEye white paper 2025 (calibration protocol, validation gates, virtual chinrest, I-VT parameters, accuracy decay data)
- Feit et al., CHI 2017 & Manakhov et al., CHI 2024 (saccade-aware filtering beats One Euro alone)
- WebEyeTrack — arXiv 2508.19544 (browser-native neural gaze estimation)
- MediaPipe FaceLandmarker internals: blendshapes are landmark-derived (no extra image info); the face crop is 256×256, so capture gains saturate at ~720p
