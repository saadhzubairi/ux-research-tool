/**
 * Runs inside a sandboxed extension page where eval/Function() is allowed.
 *
 * Camera access doesn't work in sandbox (opaque origin), so the parent page
 * captures camera frames and transfers them here as ImageBitmaps.
 * We reconstruct a video stream from a canvas and feed it to WebGazer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Replace rAF with setTimeout so WebGazer's processing loop keeps running
// even if Chrome throttles rAF for this sandbox iframe.
window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number
window.cancelAnimationFrame = (id: number): void => clearTimeout(id)

function post(type: string, data?: any) {
  window.parent.postMessage({ source: 'gazekit-sandbox', type, data }, '*')
}

// Catch ALL errors — surface hidden crashes from TF.js / WebGazer loop
window.addEventListener('error', (e) => {
  post('log', `UNCAUGHT: ${e.message}`)
})
window.addEventListener('unhandledrejection', (e) => {
  post('log', `REJECTION: ${e.reason}`)
})
// Intercept console.error to catch WebGazer loop errors
const _origError = console.error
console.error = (...args: any[]) => {
  _origError.apply(console, args)
  const msg = args.map((a: any) => (typeof a === 'object' ? (a?.stack || a?.message || JSON.stringify(a)) : String(a))).join(' ')
  post('log', `ERR: ${msg.slice(0, 600)}`)
}

let webgazer: any = null
let listenerCount = 0
let frameCount = 0

// Canvas to receive video frames from parent
let feedCanvas: HTMLCanvasElement | null = null
let feedCtx: CanvasRenderingContext2D | null = null
let fakeStream: MediaStream | null = null
let firstFrameResolve: (() => void) | null = null
let initStarted = false

function setupFrameReceiver(width: number, height: number) {
  feedCanvas = document.createElement('canvas')
  feedCanvas.width = width
  feedCanvas.height = height
  feedCtx = feedCanvas.getContext('2d')!

  // Draw a non-black frame so captureStream has something initially
  feedCtx.fillStyle = '#111'
  feedCtx.fillRect(0, 0, width, height)

  fakeStream = feedCanvas.captureStream(60) // capture at 60fps from canvas updates
  post('log', `Frame receiver: ${width}x${height}, tracks=${fakeStream.getTracks().length}`)
}

function waitForFirstFrame(): Promise<void> {
  if (frameCount > 0) return Promise.resolve()
  return new Promise((resolve) => { firstFrameResolve = resolve })
}

function handleFrame(bitmap: ImageBitmap) {
  if (!feedCtx || !feedCanvas) return
  feedCtx.drawImage(bitmap, 0, 0)
  bitmap.close()
  frameCount++

  if (frameCount <= 3 || frameCount % 200 === 0) {
    post('log', `Frame #${frameCount} received`)
  }

  if (firstFrameResolve) {
    firstFrameResolve()
    firstFrameResolve = null
  }
}

async function init(videoWidth: number, videoHeight: number) {
  if (initStarted) return
  initStarted = true

  try {
    // 1. Verify eval works
    try {
      const r = new Function('return 42')()
      post('log', `eval/Function() works: ${r} ✓`)
    } catch (e) {
      post('error', 'eval blocked in sandbox: ' + e)
      return
    }

    // 2. Set up frame receiver
    setupFrameReceiver(videoWidth, videoHeight)

    // 3. Wait for at least one real frame from the parent
    post('log', 'Waiting for first camera frame from parent...')
    await waitForFirstFrame()
    post('log', `First frame received ✓ (${frameCount} frames so far)`)

    // 4. Monkey-patch getUserMedia → return our canvas stream
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        post('log', `getUserMedia intercepted (constraints=${JSON.stringify(constraints)}) → canvas stream`)
        return fakeStream!
      }
    } else {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: async () => {
            post('log', 'getUserMedia intercepted (polyfill) → canvas stream')
            return fakeStream!
          },
          enumerateDevices: async () => [],
        },
      })
    }

    // 5. Import and start WebGazer
    post('log', 'Importing WebGazer...')
    const wg = await import('webgazer')
    webgazer = wg.default || wg
    post('log', 'WebGazer imported ✓')

    webgazer.setRegression('weightedRidge')
    webgazer.applyKalmanFilter(true)
    webgazer.params.saveDataAcrossSessions = false // opaque origin has no storage
    post('log', 'Weighted ridge regression + Kalman filter set')

    webgazer.setGazeListener((data: { x: number; y: number } | null) => {
      listenerCount++
      // Face detection is separate from gaze prediction — before calibration,
      // regression returns null even when face IS detected.
      const hasFace = webgazer.getTracker()?.predictionReady === true
      if (listenerCount <= 5 || listenerCount % 100 === 0) {
        post('log', `Gaze #${listenerCount}: ${data ? `(${data.x.toFixed(0)}, ${data.y.toFixed(0)})` : 'null'} face=${hasFace}`)
      }
      post('gaze', {
        prediction: data ? { x: data.x, y: data.y } : null,
        faceDetected: hasFace,
      })
    })
    post('log', 'Gaze listener set')

    post('log', 'Calling webgazer.begin()...')
    // begin() resolves after getUserMedia but before init() finishes
    await webgazer.begin()
    post('log', 'webgazer.begin() resolved (init still running)')

    webgazer.showPredictionPoints(false)

    // Poll for WebGazer to finish init (isReady = videoElementCanvas.width > 0)
    await new Promise<void>((resolve) => {
      let checks = 0
      const poll = () => {
        checks++
        const video = document.getElementById('webgazerVideoFeed') as HTMLVideoElement | null
        const canvas = document.getElementById('webgazerVideoCanvas') as HTMLCanvasElement | null
        const ready = canvas && canvas.width > 0

        if (checks <= 5 || checks % 20 === 0) {
          post('log', `Init poll #${checks}: video=${video?.videoWidth}x${video?.videoHeight} rs=${video?.readyState} canvas=${canvas?.width}x${canvas?.height} ready=${ready}`)
        }

        if (ready) {
          post('log', `WebGazer fully initialized ✓ after ${checks} polls`)
          resolve()
        } else if (checks > 200) { // 10s timeout
          post('log', 'WARNING: WebGazer init poll timed out after 10s')
          resolve()
        } else {
          setTimeout(poll, 50)
        }
      }
      poll()
    })

    // Ensure video is playing
    const video = document.getElementById('webgazerVideoFeed') as HTMLVideoElement | null
    const canvas = document.getElementById('webgazerVideoCanvas') as HTMLCanvasElement | null
    const overlay = document.getElementById('webgazerFaceOverlay') as HTMLCanvasElement | null

    if (video) {
      if (video.paused) {
        try {
          video.muted = true
          await video.play()
          post('log', 'video.play() succeeded ✓')
        } catch (e) {
          post('log', `video.play() failed: ${e}`)
        }
      }
      post('log', `Video: ${video.videoWidth}x${video.videoHeight} rs=${video.readyState} paused=${video.paused}`)
    } else {
      post('log', 'WARNING: webgazerVideoFeed not found in DOM')
    }

    post('log', `WebGazer DOM: video=${video ? 'yes' : 'NONE'}, canvas=${canvas ? `${canvas.width}x${canvas.height}` : 'NONE'}, overlay=${overlay ? 'yes' : 'no'}`)

    // Style WebGazer elements to fill the iframe
    const container = document.getElementById('webgazerVideoContainer')
    if (container) {
      container.style.cssText = `
        position: absolute !important; top: 0; left: 0;
        width: 100% !important; height: 100% !important;
        display: block !important; opacity: 1 !important;
      `
    }

    if (video) {
      video.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%; object-fit: cover;
        display: block !important; opacity: 1 !important;
        transform: scaleX(-1);
      `
    }

    if (overlay) {
      overlay.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%; object-fit: cover;
        transform: scaleX(-1); pointer-events: none; z-index: 10;
      `
    }

    // Hide elements we don't need
    for (const id of ['webgazerVideoCanvas', 'webgazerFaceFeedbackBox', 'webgazerGazeDot']) {
      const el = document.getElementById(id)
      if (el) el.style.display = 'none'
    }

    // feedCanvas as background fallback
    if (feedCanvas) {
      feedCanvas.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%; object-fit: cover;
        transform: scaleX(-1); z-index: -1;
      `
      document.body.appendChild(feedCanvas)
    }

    post('ready', null)

    // Health check every 3s
    setInterval(() => {
      const vid = document.getElementById('webgazerVideoFeed') as HTMLVideoElement | null
      const cvs = document.getElementById('webgazerVideoCanvas') as HTMLCanvasElement | null
      post('log', `Health: gaze=${listenerCount} frames=${frameCount} vid=${vid?.videoWidth}x${vid?.videoHeight} rs=${vid?.readyState} paused=${vid?.paused} cvs=${cvs?.width}x${cvs?.height} ready=${webgazer?.isReady?.()}`)
    }, 3000)
  } catch (err: any) {
    post('log', `INIT ERROR: ${err?.stack || err?.message || err}`)
    post('error', err?.message || String(err))
  }
}

// Handle messages from parent
window.addEventListener('message', (event) => {
  const msg = event.data
  if (msg?.source !== 'gazekit-parent') return

  switch (msg.type) {
    case 'init':
      post('log', `Init: video ${msg.width}x${msg.height}`)
      init(msg.width || 640, msg.height || 480)
      break

    case 'frame':
      if (msg.bitmap) handleFrame(msg.bitmap)
      break

    case 'record':
      if (webgazer) webgazer.recordScreenPosition(msg.x, msg.y, 'click')
      break

    case 'export_model': {
      try {
        const regs = (webgazer as any).getRegression?.() ?? (webgazer as any).regs
        if (!regs || regs.length === 0) {
          post('model_data', { error: 'No regression modules' })
          break
        }
        const reg = regs[0]
        // Convert DataWindow contents to plain arrays for serialization
        const toPlain = (dw: any): any[] => {
          if (!dw?.data) return []
          return dw.data.map((item: any) => {
            if (ArrayBuffer.isView(item)) return Array.from(item as any)
            return item
          })
        }
        const modelData = {
          screenXClicks: toPlain(reg.screenXClicksArray),
          screenYClicks: toPlain(reg.screenYClicksArray),
          eyeFeaturesClicks: toPlain(reg.eyeFeaturesClicks),
          dataClicks: toPlain(reg.dataClicks),
        }
        post('log', `Exported model: ${modelData.screenXClicks.length} training points`)
        post('model_data', modelData)
      } catch (err: any) {
        post('log', `Model export error: ${err?.message || err}`)
        post('model_data', { error: String(err) })
      }
      break
    }

    case 'import_model': {
      try {
        const data = msg.data
        if (!data?.screenXClicks?.length) {
          post('log', 'No model data to import')
          post('model_imported', { success: false })
          break
        }
        const regs = (webgazer as any).getRegression?.() ?? (webgazer as any).regs
        if (!regs || regs.length === 0) {
          post('log', 'No regression modules to import into')
          post('model_imported', { success: false })
          break
        }
        const reg = regs[0]
        for (let i = 0; i < data.screenXClicks.length; i++) {
          reg.screenXClicksArray?.push(data.screenXClicks[i])
          reg.screenYClicksArray?.push(data.screenYClicks[i])
          reg.eyeFeaturesClicks?.push(data.eyeFeaturesClicks[i])
          if (data.dataClicks?.[i] && reg.dataClicks) {
            reg.dataClicks.push(data.dataClicks[i])
          }
        }
        post('log', `Imported ${data.screenXClicks.length} calibration points`)
        post('model_imported', { success: true })
      } catch (err: any) {
        post('log', `Model import error: ${err?.message || err}`)
        post('model_imported', { success: false, error: String(err) })
      }
      break
    }

    case 'stop':
      if (webgazer) {
        try { webgazer.end() } catch { /* ignore */ }
        webgazer = null
      }
      break
  }
})

post('loaded', null)
