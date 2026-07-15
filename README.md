# GazeKit

Open-source webcam-based eye tracking for UX research. Real eye tracking via webcam, DOM-aware element mapping, session replay with gaze overlay, and aggregated heatmaps — all local, no cloud dependency.

## Architecture

```
gazekit/
├── packages/
│   ├── shared/             # Shared types, constants, utilities
│   ├── extension/          # Chrome Extension (Manifest V3)
│   └── web/
│       ├── client/         # React dashboard (Vite + TailwindCSS)
│       └── server/         # Express + MongoDB + WebSocket server
```

**Chrome Extension** runs MediaPipe FaceLandmarker in an offscreen document to extract head-invariant eye features from the webcam, maps them to screen coordinates with a per-user ridge regression model, maps gaze to DOM elements, records the DOM via rrweb, and streams everything over WebSocket.

**Web App** receives gaze streams, stores sessions in MongoDB, generates heatmaps, provides gaze replay synchronized with DOM recordings, and serves as the researcher dashboard.

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 7+
- Chrome 116+

### Setup

```bash
# Install all dependencies (also downloads the MediaPipe face landmarker model)
npm install

# Build the shared types package
npm run build --workspace=packages/shared

# Start the server (needs MongoDB running; HTTP on :4444, WebSocket on :8765)
npm run dev --workspace=packages/web/server

# Start the dashboard (Vite dev server on :5173)
npm run dev --workspace=packages/web/client

# Build the Chrome extension
npm run build --workspace=packages/extension
```

### Load the Extension
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select `packages/extension/dist/`

### Usage
1. Start the server and dashboard
2. Click the GazeKit extension icon
3. Run calibration (13-point, ~1 minute) — keep your head still and follow the dot with your eyes
4. If validation passes the quality gate, click "Start Tracking" on any webpage
5. View heatmaps and replay in the dashboard at `http://localhost:5173`

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Extension**: Manifest V3, MediaPipe FaceLandmarker (`@mediapipe/tasks-vision`), rrweb, @medv/finder
- **Frontend**: React 18, Vite, TailwindCSS, Zustand, Tanstack Query
- **Backend**: Express.js, MongoDB (time series collections), ws
- **Shared**: I-DT fixation detection, screen↔viewport coordinate conversion, CSS selector generation

## How the Gaze Pipeline Works

1. **Landmarks** — MediaPipe FaceLandmarker (with blendshapes) runs once per camera frame at 1280×720 via `requestVideoFrameCallback`.
2. **Features** — landmarks are canonicalized into a face-attached frame (removing head translation, scale, and rotation), producing a 17-dimensional feature vector: per-eye iris offsets, eyelid apertures, head pose, blendshape gaze scores, face position/depth proxies, and quadratic iris terms.
3. **Mapping** — closed-form ridge regression per axis, with λ picked per user by leave-one-calibration-point-out cross-validation. Calibration samples are blink-rejected (adaptive eye-aspect-ratio threshold) and MAD-trimmed.
4. **Runtime** — blink gating, saccade-aware jump filtering with One Euro smoothing, click-anchored drift correction, and per-sample confidence from head-pose deviation.
5. **Coordinates** — the model predicts global screen pixels; the content script converts to viewport coordinates using live window geometry and tab zoom, so sessions survive window moves, resizes, zoom changes, and DevTools opening after calibration.

See [docs/EYE_TRACKING_REVAMP.md](docs/EYE_TRACKING_REVAMP.md) for the full design rationale and research sources.

## Features

- **Real eye tracking** via webcam — MediaPipe face/iris landmarks + per-user ridge regression (no third-party gaze library)
- **DOM-aware gaze mapping** — knows which element you're looking at, not just pixel coordinates
- **13-point calibration** with a 5-point validation pass and a hard quality gate (poor calibrations are never saved)
- **Gaze playground** — live dot following your eyes, for sanity-checking a calibration
- **rrweb DOM recording** with custom gaze plugin for synchronized replay
- **Fixation detection** via I-DT (Identification by Dispersion Threshold) algorithm
- **Heatmaps** — per-session and aggregated across sessions, with screenshot overlay
- **Gaze replay** — DOM replay with gaze dot overlay and fading trail
- **Element attention ranking** — dwell time, fixation count, and attention percentage per element
- **SPA support** — detects client-side route changes via history API patching
- **Privacy-first** — all data stays on localhost, webcam frames are never stored

## Known Limitations

- Realistic accuracy is ~1.5–2° (roughly 60–110 px at laptop geometry) with a mostly-still head; free head movement roughly doubles error
- Vertical accuracy is inherently worse than horizontal (eyelids occlude the iris)
- Glasses significantly degrade accuracy
- Requires good, even facial lighting
- One tab tracked at a time
- Cross-origin iframes cannot be pierced
- Heatmaps below the fold are not yet scroll-compensated (server-side follow-up)

## License

TBD — the former GPL-3.0 constraint no longer applies since WebGazer.js was replaced with an in-house pipeline (MediaPipe Tasks is Apache-2.0).
