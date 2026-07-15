# Execution Plan: Page/Slice Rework (Extension + Backend + Frontend)

## Context

`ux-research-tool` is a monorepo (npm workspaces): a Chrome extension (`packages/extension`, MediaPipe-based gaze tracking) feeding a Node/Express + MongoDB server (`packages/web/server`) that a React/Vite dashboard (`packages/web/client`) reads via REST + TanStack Query. Shared types live in `packages/shared`. The task: replace today's decoupled gaze-batch/screenshot/visit-detection pipeline with a unified "slice" model (one capture tick = gaze points + screenshot, bundled), formalize `Page`/`Slice` as first-class Mongo documents, move fixation (I-DT) computation from request-time to ingest-time, add real-time WS push for a progressively-building live heatmap, and retire rrweb replay in favor of screenshot-scrubbing. Full specs are in `revamp/*.md` (backend-structure.md, extension-improvements.md, database-structure.md, frontend-architecture.md, user-journeys.md) — every task below cites those docs directly; agents should read the relevant doc(s) in full before starting.

## Research Summary

### Tech Stack
- Extension: TypeScript, Chrome MV3, MediaPipe FaceLandmarker (offscreen document), `chrome.tabCapture`/`chrome.tabs.captureVisibleTab`
- Server: TypeScript, Express, MongoDB (Mongoose), `ws` WebSocket server
- Client: TypeScript, React, Vite, TanStack Query, Zustand (`appStore`, UI chrome only)
- Shared: `packages/shared` — types + utils (`fixationDetector.ts`, `urlNormalizer.ts`) consumed by both extension and server

### Relevant Files (by area)

**Shared contracts**
- `packages/shared/src/types/protocol.ts` — WS message types (extension↔server); collapses `gaze_batch`+`page_screenshot`+`page_change` into one `slice` message
- `packages/shared/src/types/gaze.ts`, `api.ts`, `index.ts` — add `Page`/`Slice` shared types for client consumption

**Extension** (`packages/extension/src`)
- `content/batchManager.ts` → replaced by new `content/sliceManager.ts` (slice clock: 100ms normal / 1000ms while scrolling)
- `content/tracker.ts`, `content/spaDetector.ts` — navigation-triggered immediate slice
- `background/service-worker.ts` — drop `captureVisibleTab` polling (`startScreenshotInterval`), add `chrome.tabCapture.getMediaStreamId` on "Start Tracking" gesture, reattach stream on navigation
- `offscreen/offscreen.ts` — add new `offscreen/tabStream.ts` (canvas sampling from tab MediaStream), alongside existing MediaPipe pipeline (`offscreen/faceLandmarker.ts`) — shared CPU budget, needs perf smoke-test
- `manifest.json` — add `tabCapture` permission, drop `activeTab`/`tabs` if unused elsewhere
- To delete: rrweb capture (`domRecorder.ts` if present) and the `rrweb_events` message type

**Backend** (`packages/web/server/src`)
- `ws/wsServer.ts` — collapse `handleGazeBatch`/`handleRrwebEvents`/`handlePageScreenshot` into `handleSlice`; remove the visit-detection heuristic (lines ~213-234); add subscribe/broadcast for live dashboard push
- `models/Session.ts` — remove embedded `pages[]`; add `schemaVersion` field
- New: `models/Page.ts`, `models/Slice.ts` (time-series collection, see database-structure.md for exact schema/indexes)
- `models/GazeEvent.ts`, `models/Screenshot.ts`, `models/RrwebEvent.ts` — kept read-only for old (`schemaVersion: 1`) sessions during the 90-day TTL window, not written by new code
- `services/fixationService.ts` (or wherever `getFixations`/I-DT lives) — move I-DT from on-demand+LRU-cache to ingest-time, called from `handleSlice` step 7
- `routes/sessions.ts` — new `GET /pages`, `GET /pages/:pageId/slices`; delete `/replay` if rrweb dropped; elements route simplified to read precomputed `Slice.fixations`
- `routes/heatmap.ts` — `pageId`-keyed session heatmap query instead of `url`-keyed
- `routes/screenshots.ts` — path scheme `sessionId/pageId/sliceIndex.png`
- `shared/utils/fixationDetector.ts` — algorithm unchanged, only call site moves (owned by shared-contracts agent if touched, otherwise backend agent treats as a stable dependency)

**Frontend** (`packages/web/client/src`)
- `api/hooks.ts` — new `usePagesQuery`, `useSlicesQuery`, `useLiveSession` (WS subscribe + TanStack Query cache append)
- New: `components/timeline/SliceTimeline.tsx` — replaces `TimelineSlider.tsx` + the rAF scrub bar inside `ReplayPlayer.tsx`
- `components/heatmap/HeatmapCanvas.tsx` — consumes cumulative `Slice[].fixations` instead of flat `HeatmapPoint[]`
- `components/heatmap/HeatmapUrlTabs.tsx` — switch from `session.pages` (strings) to `usePagesQuery` (real `Page` objects)
- To delete: `ReplayPlayer.tsx`, `GazeOverlay.tsx` as standalone — port trail/fixation-circle rendering logic into `SliceTimeline.tsx`
- `SessionDetailPage` (wherever it lives) — gate live vs. post-hoc mode on `session.status`
- Unaffected: `SessionList.tsx`, `ElementTable.tsx`/`AttentionChart.tsx` (same client shape), `HeatmapsPage.tsx` aggregate view, `SettingsPage`, routing, `appStore`

### Conventions Observed
- Server routes are grouped by resource under `routes/`, models under `models/`, one Mongoose schema per file
- Shared types re-exported through `packages/shared/src/index.ts`
- Client uses TanStack Query hooks colocated in `api/hooks.ts`, components grouped by feature folder (`components/heatmap/`, `components/common/`, `components/elements/`)
- Extension is organized by execution context (`content/`, `background/`, `offscreen/`, `calibration/`)

## Task Breakdown

### Task Group A — Shared Contracts (blocking, do first)
- **Description**: Define the `slice` WS message type in `protocol.ts` (exact shape in extension-improvements.md §Message protocol changes) and `Page`/`Slice` shared TS types in `gaze.ts`/`api.ts` mirroring the Mongo schemas in database-structure.md §New schemas. Export via `index.ts`.
- **Files**: `packages/shared/src/types/protocol.ts`, `gaze.ts`, `api.ts`, `index.ts`
- **Dependencies**: none — this unblocks extension/backend/frontend agents
- **Acceptance criteria**: types compile; extension, server, and client packages can import `SliceMessage`, `Page`, `Slice` types without circular deps

### Task Group B — Extension Capture Rework
- **Description**: Implement the slice clock and tab-stream screenshot capture per extension-improvements.md in full. Replace `batchManager.ts` with `sliceManager.ts` (100ms/1000ms cadence, scroll-triggered slowdown, navigation-triggered immediate slice). Replace `captureVisibleTab` polling with `chrome.tabCapture` stream + offscreen canvas sampling. Update manifest permissions. Remove rrweb capture entirely.
- **Files**: `packages/extension/src/content/{batchManager.ts→sliceManager.ts,tracker.ts,spaDetector.ts}`, `background/service-worker.ts`, `offscreen/{offscreen.ts,tabStream.ts (new)}`, `manifest.json`, deletion of rrweb-related files
- **Dependencies**: Task Group A (shared `slice` message type)
- **Acceptance criteria**: extension emits one `slice` WS message per tick matching the new protocol shape; screenshot cadence achieves ~10fps outside scroll, 1fps during scroll; navigation triggers an immediate slice; `tabCapture` permission present, unused `captureVisibleTab`-only permissions removed if safe

### Task Group C — Backend Ingestion & API Rework
- **Description**: Implement `Page`/`Slice` Mongoose models, collapse WS handlers into `handleSlice`, move fixation computation to ingest-time, rewrite REST routes, add WS live-push subscribe/broadcast. Full detail in backend-structure.md and database-structure.md (schemas, indexes, retention/TTL, migration/versioning approach via `schemaVersion`).
- **Files**: `packages/web/server/src/models/{Page.ts (new),Slice.ts (new),Session.ts}`, `ws/wsServer.ts`, `routes/{sessions.ts,heatmap.ts,screenshots.ts}`, fixation service (move call site)
- **Dependencies**: Task Group A (shared types)
- **Acceptance criteria**: `handleSlice` creates/reuses `Page` and inserts `Slice` per the pseudocode in backend-structure.md; fixations computed at ingest, `Slice.fixations` populated; new REST endpoints return documented shapes; WS subscribe/broadcast delivers `slice_ingested` to a connected dashboard client; old `schemaVersion: 1` sessions remain readable

### Task Group D — Frontend Timeline & Live Heatmap
- **Description**: Build `usePagesQuery`/`useSlicesQuery`/`useLiveSession` hooks, the unified `SliceTimeline` component (replacing `TimelineSlider` + `ReplayPlayer`'s scrub bar), update `HeatmapCanvas`/`HeatmapUrlTabs` to consume `Page`/`Slice` shapes, gate `SessionDetailPage` on `session.status` for live vs. post-hoc mode, port `GazeOverlay` trail rendering into `SliceTimeline`, delete retired replay components/routes.
- **Files**: `packages/web/client/src/api/hooks.ts`, new `components/timeline/SliceTimeline.tsx`, `components/heatmap/{HeatmapCanvas.tsx,HeatmapUrlTabs.tsx}`, `SessionDetailPage`, deletion of `ReplayPlayer.tsx`/`GazeOverlay.tsx` (with logic ported first)
- **Dependencies**: Task Group A (shared types); soft dependency on Task Group C's REST/WS shapes matching exactly — coordinate via messaging once C's route shapes are drafted, don't block on full completion
- **Acceptance criteria**: page tabs driven by `usePagesQuery` show repeat visits as separate tabs; `SliceTimeline` drives both screenshot and cumulative heatmap from one scrub position; live session shows a growing heatmap with zero manual refresh; completed sessions fall back to post-hoc mode with no visible behavior change beyond the unified timeline; rrweb replay UI removed

## Agent Team Structure

### Team Size: 4 agents

Justification: four genuinely independent file-ownership boundaries (shared types, extension, backend, frontend) matching the monorepo's package boundaries, each with enough scope (multiple files, a cohesive subsystem) to stay productive. Group A is small and blocking, so it goes first and reports done before B/C/D need its output — but B/C/D can start reading/scaffolding immediately since the shapes are already fully specified in the docs, only importing the final types is blocked.

### Agent Roles

#### Agent 1: shared-contracts
- **Responsibilities**: Task Group A
- **Key files**: `packages/shared/src/types/{protocol.ts,gaze.ts,api.ts,index.ts}`
- **Spawn prompt summary**: Full text of extension-improvements.md §Message protocol changes and database-structure.md §New schemas, with exact TS shapes to write. Instructed to message agents 2-4 the moment types are exported so they can switch from scaffolding to real imports.

#### Agent 2: extension-capture
- **Responsibilities**: Task Group B
- **Key files**: `packages/extension/src/content/*`, `background/service-worker.ts`, `offscreen/*`, `manifest.json`
- **Spawn prompt summary**: Full text of extension-improvements.md, plus the current-state file locations from Phase 1 research. Told to wait for agent 1's `slice` type export (message-driven, not polling) before finalizing the message-send call, but to scaffold `sliceManager.ts`/`tabStream.ts` structure in the meantime.

#### Agent 3: backend-slices
- **Responsibilities**: Task Group C
- **Key files**: `packages/web/server/src/models/*`, `ws/wsServer.ts`, `routes/{sessions.ts,heatmap.ts,screenshots.ts}`
- **Spawn prompt summary**: Full text of backend-structure.md and database-structure.md. Told to message agent 4 once REST route response shapes are finalized (even before full implementation) so frontend hooks can be written against a stable contract.
- **Needs plan approval**: yes — this task deletes/restructures core data models (`Session.pages[]` removal, new time-series collection, TTL policy) and rewrites the ingestion hot path; architectural enough to warrant a checkpoint before implementation.

#### Agent 4: frontend-timeline
- **Responsibilities**: Task Group D
- **Key files**: `packages/web/client/src/api/hooks.ts`, `components/timeline/*`, `components/heatmap/*`, `SessionDetailPage`
- **Spawn prompt summary**: Full text of frontend-architecture.md and user-journeys.md (journeys 2-4 describe the live/scrub UX this agent is building). Told to scaffold `SliceTimeline` against the documented shapes first, then reconcile with agent 3's actual route shapes once messaged.

### Coordination Notes
- Agent 1 runs first-ish but not strictly blocking — agents 2-4 read the specs and scaffold in parallel, then message-sync with agent 1 for final type imports.
- Agent 3 messages agent 4 when REST/WS response shapes stabilize, since frontend hooks are written against those shapes.
- No two agents touch the same file — package boundaries are the file-ownership boundaries.
- Agent 3 (backend) requires plan approval before implementing, given the scope of the data-model change (new collections, retention policy, hot-path rewrite).
- rrweb removal spans three packages (extension capture, server model/route, client component) — each agent deletes their own package's rrweb pieces independently; no coordination needed since they don't share files.

## Risk & Edge Cases
- `chrome.tabCapture` stream teardown on cross-origin navigation (extension-improvements.md caveat) — agent 2 must handle reattachment, not just assume the stream survives.
- Shared CPU budget between MediaPipe inference and tab-stream canvas sampling in the offscreen document — flagged as needing a perf smoke-test, not provably free.
- Time-series collection + embedded gaze-point-array-per-slice document size — spec argues it stays well under 16MB/doc, but agent 3 should sanity-check against realistic session lengths.
- Backward compatibility: old `schemaVersion: 1` sessions must remain readable through their 90-day TTL window — agent 3's route changes need a version branch, not a hard cutover.
- Frontend/backend contract drift: since agents 3 and 4 work in parallel against a spec rather than a running API, response-shape mismatches are the most likely integration bug — the messaging checkpoint (agent 3 → agent 4) mitigates but doesn't eliminate this; a final integration pass after both report done is worth doing.

## Rollback Strategy
All work happens on the current branch (`feat/mediapipe-migration`) or a new branch off it — recommend each agent commits incrementally so any single package's changes can be reverted independently (`git revert`/`git checkout -- packages/<pkg>`) without unwinding the others, given the clean package-boundary split.
