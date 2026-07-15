// ---------------------------------------------------------------------------
// Tab Capture Stream
// ---------------------------------------------------------------------------
// Holds a continuous chrome.tabCapture MediaStream of the tracked tab, piped
// into a hidden <video>. Each slice tick, grabFrame() draws the video's latest
// decoded frame into a downscaled canvas and exports a compressed JPEG — a
// cheap canvas read, NOT a per-tick capture API call (which Chrome rate-limits
// to ~2/s via captureVisibleTab). This is what makes a 10fps slice cadence
// achievable.
//
// Runs in the offscreen document, sharing the CPU budget with the MediaPipe
// gaze pipeline — hence the aggressive downscale/compress defaults below.
// ---------------------------------------------------------------------------

// Longest edge of the exported frame, in px. The viewport is downscaled to
// this before JPEG encode to bound disk/bandwidth on scroll-heavy sessions.
const MAX_FRAME_EDGE_PX = 1280
const JPEG_QUALITY = 0.7

let tabVideo: HTMLVideoElement | null = null
let tabStream: MediaStream | null = null
let frameCanvas: HTMLCanvasElement | null = null
let frameCtx: CanvasRenderingContext2D | null = null

/**
 * Acquire a tab-capture MediaStream from a streamId minted by the service
 * worker (chrome.tabCapture.getMediaStreamId, which must run in response to a
 * user gesture). Idempotent: a second call tears the previous stream down first.
 */
export async function startTabStream(streamId: string): Promise<void> {
  stopTabStream()

  // chromeMediaSource:'tab' constraints are not in the standard typings, hence
  // the cast — this is the documented shape for extension tab capture.
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  } as unknown as MediaStreamConstraints

  tabStream = await navigator.mediaDevices.getUserMedia(constraints)

  tabVideo = document.createElement('video')
  tabVideo.srcObject = tabStream
  tabVideo.autoplay = true
  tabVideo.playsInline = true
  tabVideo.muted = true
  tabVideo.style.position = 'fixed'
  tabVideo.style.opacity = '0'
  tabVideo.style.pointerEvents = 'none'
  document.body.appendChild(tabVideo)
  await tabVideo.play()

  frameCanvas = document.createElement('canvas')
  frameCtx = frameCanvas.getContext('2d')

  console.log('[GazeKit Offscreen] Tab-capture stream started')
}

/**
 * Draw the latest decoded video frame into a downscaled canvas and export a
 * compressed JPEG data URL. Returns null if the stream isn't ready yet (e.g.
 * first ticks before the video has any decoded frames).
 */
export function grabFrame(): string | null {
  if (!tabVideo || !frameCanvas || !frameCtx) return null
  const vw = tabVideo.videoWidth
  const vh = tabVideo.videoHeight
  if (vw === 0 || vh === 0) return null

  const scale = Math.min(1, MAX_FRAME_EDGE_PX / Math.max(vw, vh))
  const dw = Math.max(1, Math.round(vw * scale))
  const dh = Math.max(1, Math.round(vh * scale))

  if (frameCanvas.width !== dw || frameCanvas.height !== dh) {
    frameCanvas.width = dw
    frameCanvas.height = dh
  }

  frameCtx.drawImage(tabVideo, 0, 0, dw, dh)
  return frameCanvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

export function stopTabStream(): void {
  if (tabVideo) {
    tabVideo.remove()
    tabVideo = null
  }
  if (tabStream) {
    tabStream.getTracks().forEach((t) => t.stop())
    tabStream = null
  }
  frameCanvas = null
  frameCtx = null
}

/** Whether a live tab-capture stream is currently held. */
export function hasTabStream(): boolean {
  return tabStream !== null
}
