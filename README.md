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

**Chrome Extension** captures webcam gaze via WebGazer.js, maps gaze to DOM elements, records DOM via rrweb, and streams everything over WebSocket.

**Web App** receives gaze streams, stores sessions in MongoDB, generates heatmaps, provides gaze replay synchronized with DOM recordings, and serves as the researcher dashboard.

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 7+
- Chrome 116+

### Setup

```bash
# Install all dependencies
npm install

# Build the shared types package
npm run build --workspace=packages/shared

# Start the server (needs MongoDB running)
npm run dev --workspace=packages/web/server

# Start the dashboard
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
3. Run calibration (9-point, ~45 seconds)
4. Click "Start Tracking" on any webpage
5. View heatmaps and replay in the dashboard at `http://localhost:3000`

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Extension**: Manifest V3, WebGazer.js, rrweb, @medv/finder
- **Frontend**: React 18, Vite, TailwindCSS, Zustand, Tanstack Query
- **Backend**: Express.js, MongoDB (time series collections), ws
- **Shared**: I-DT fixation detection, coordinate normalization, CSS selector generation

## Features

- **Real eye tracking** via webcam using WebGazer.js (ridge regression + TFFacemesh)
- **DOM-aware gaze mapping** — knows which element you're looking at, not just pixel coordinates
- **9-point calibration** with validation and accuracy scoring
- **rrweb DOM recording** with custom gaze plugin for synchronized replay
- **Fixation detection** via I-DT (Identification by Dispersion Threshold) algorithm
- **Heatmaps** — per-session and aggregated across sessions, with screenshot overlay
- **Gaze replay** — DOM replay with gaze dot overlay and fading trail
- **Element attention ranking** — dwell time, fixation count, and attention percentage per element
- **SPA support** — detects client-side route changes via history API patching
- **Privacy-first** — all data stays on localhost, webcam frames are never stored

## Known Limitations

- Accuracy is ~100-200px (section-level attention, not button-level)
- Glasses significantly degrade accuracy
- Requires good, even facial lighting
- Calibration invalidated by window resize
- One tab tracked at a time
- Cross-origin iframes cannot be pierced
- WebGazer.js is GPLv3

## License

GPL-3.0 (due to WebGazer.js dependency)
