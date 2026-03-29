import { useState, useCallback, useRef, useEffect } from 'react'

interface WebGazerPrediction {
  x: number
  y: number
}

type PreviewMode = 'pip' | 'large' | 'hidden'

interface UseWebGazerReturn {
  isReady: boolean
  faceDetected: boolean
  prediction: WebGazerPrediction | null
  listenerCount: number
  error: string | null
  logs: string[]
  start: (existingStream?: MediaStream) => Promise<void>
  stop: () => Promise<void>
  getPrediction: () => Promise<WebGazerPrediction | null>
  recordScreenPosition: (x: number, y: number) => void
  setPreviewMode: (mode: PreviewMode) => void
  exportModel: () => Promise<Record<string, unknown> | null>
}

export function useWebGazer(): UseWebGazerReturn {
  const [isReady, setIsReady] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [prediction, setPrediction] = useState<WebGazerPrediction | null>(null)
  const [listenerCount, setListenerCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const predictionRef = useRef<WebGazerPrediction | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const gazeHandlerRef = useRef<((e: MessageEvent) => void) | null>(null)
  const frameLoopRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const listenerCountRef = useRef(0)

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const line = `[${ts}] ${msg}`
    console.log('[GazeKit]', msg)
    setLogs((prev) => [...prev.slice(-50), line]) // keep last 50 lines
  }, [])

  const start = useCallback(async (existingStream?: MediaStream) => {
    try {
      // 1. Get camera stream
      let stream: MediaStream
      if (existingStream) {
        stream = existingStream
        addLog('Reusing existing camera stream')
      } else {
        addLog('Requesting camera...')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        })
      }
      streamRef.current = stream

      // Hidden video element to read frames from
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      video.style.display = 'none'
      document.body.appendChild(video)
      await video.play()
      videoRef.current = video

      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 480
      addLog(`Camera ready: ${vw}x${vh}`)

      // 2. Create sandbox iframe
      addLog('Creating sandbox iframe...')
      const iframe = document.createElement('iframe')
      iframe.src = chrome.runtime.getURL('src/calibration/sandbox.html')
      iframe.style.cssText = `
        position: fixed; bottom: 16px; right: 16px;
        width: 240px; height: 180px; z-index: 99999;
        border: 2px solid rgba(99,102,241,0.6); border-radius: 12px;
        overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        background: #000;
      `
      document.body.appendChild(iframe)
      iframeRef.current = iframe

      // 3. Message handler
      const gazeHandler = (event: MessageEvent) => {
        if (event.data?.source !== 'gazekit-sandbox') return
        switch (event.data.type) {
          case 'gaze': {
            listenerCountRef.current++
            if (listenerCountRef.current % 10 === 0) {
              setListenerCount(listenerCountRef.current)
            }
            const d = event.data.data
            // Face detection is reported separately from gaze prediction
            setFaceDetected(d?.faceDetected === true)
            if (d?.prediction) {
              const p = { x: d.prediction.x, y: d.prediction.y }
              setPrediction(p)
              predictionRef.current = p
            } else {
              setPrediction(null)
              predictionRef.current = null
            }
            break
          }
          case 'log': {
            const logMsg: string = event.data.data || ''
            addLog(`[sandbox] ${logMsg}`)
            // Surface errors to the UI
            if (logMsg.startsWith('ERR:') || logMsg.startsWith('UNCAUGHT:') || logMsg.startsWith('REJECTION:')) {
              setError(logMsg)
            }
            break
          }
        }
      }
      window.addEventListener('message', gazeHandler)
      gazeHandlerRef.current = gazeHandler

      // 4. Frame transfer canvas
      const txCanvas = document.createElement('canvas')
      txCanvas.width = vw
      txCanvas.height = vh
      const txCtx = txCanvas.getContext('2d')!

      let framesSent = 0
      const sendFrame = () => {
        if (!iframeRef.current || !videoRef.current) return
        frameLoopRef.current = requestAnimationFrame(sendFrame)

        txCtx.drawImage(videoRef.current, 0, 0)
        createImageBitmap(txCanvas).then((bitmap) => {
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
              { source: 'gazekit-parent', type: 'frame', bitmap },
              '*',
              [bitmap],
            )
            framesSent++
            if (framesSent <= 3 || framesSent % 200 === 0) {
              addLog(`Sent frame #${framesSent}`)
            }
          } else {
            bitmap.close()
          }
        }).catch(() => {})
      }

      // 5. Wait for sandbox ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Sandbox init timed out (30s)')), 30000)

        const initHandler = (event: MessageEvent) => {
          if (event.data?.source !== 'gazekit-sandbox') return
          if (event.data.type === 'ready') {
            clearTimeout(timeout)
            window.removeEventListener('message', initHandler)
            resolve()
          }
          if (event.data.type === 'error') {
            clearTimeout(timeout)
            window.removeEventListener('message', initHandler)
            reject(new Error(event.data.data))
          }
        }
        window.addEventListener('message', initHandler)

        iframe.onload = () => {
          addLog('Sandbox iframe loaded, starting frame transfer...')
          // Start sending frames BEFORE sending init, so sandbox has frames ready
          frameLoopRef.current = requestAnimationFrame(sendFrame)

          // Small delay to let some frames arrive before init
          setTimeout(() => {
            addLog('Sending init to sandbox...')
            iframe.contentWindow?.postMessage(
              { source: 'gazekit-parent', type: 'init', width: vw, height: vh },
              '*',
            )
          }, 200)
        }
      })

      setIsReady(true)
      setError(null)
      addLog('WebGazer ready ✓')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`START FAILED: ${msg}`)
      setError(msg)
      setIsReady(false)
      cleanup()
    }
  }, [addLog])

  const cleanup = useCallback(() => {
    if (frameLoopRef.current) {
      cancelAnimationFrame(frameLoopRef.current)
      frameLoopRef.current = null
    }
    if (iframeRef.current) {
      try {
        iframeRef.current.contentWindow?.postMessage(
          { source: 'gazekit-parent', type: 'stop' }, '*',
        )
      } catch { /* ignore */ }
      iframeRef.current.remove()
      iframeRef.current = null
    }
    if (gazeHandlerRef.current) {
      window.removeEventListener('message', gazeHandlerRef.current)
      gazeHandlerRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.remove()
      videoRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const stop = useCallback(async () => {
    cleanup()
    setIsReady(false)
    setFaceDetected(false)
    setPrediction(null)
    predictionRef.current = null
    listenerCountRef.current = 0
    setListenerCount(0)
  }, [cleanup])

  const getPrediction = useCallback(async (): Promise<WebGazerPrediction | null> => {
    return predictionRef.current
  }, [])

  const recordScreenPosition = useCallback((x: number, y: number) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'gazekit-parent', type: 'record', x, y }, '*',
    )
  }, [])

  const exportModel = useCallback((): Promise<Record<string, unknown> | null> => {
    return new Promise((resolve) => {
      if (!iframeRef.current?.contentWindow) {
        resolve(null)
        return
      }
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler)
        resolve(null)
      }, 5000)
      const handler = (event: MessageEvent) => {
        if (event.data?.source !== 'gazekit-sandbox') return
        if (event.data.type !== 'model_data') return
        clearTimeout(timeout)
        window.removeEventListener('message', handler)
        const data = event.data.data
        if (data?.error) {
          addLog(`Model export failed: ${data.error}`)
          resolve(null)
        } else {
          addLog(`Model exported: ${data?.screenXClicks?.length ?? 0} points`)
          resolve(data)
        }
      }
      window.addEventListener('message', handler)
      iframeRef.current.contentWindow.postMessage(
        { source: 'gazekit-parent', type: 'export_model' },
        '*',
      )
    })
  }, [addLog])

  const setPreviewMode = useCallback((mode: PreviewMode) => {
    if (!iframeRef.current) return
    const base = `border: 2px solid rgba(99,102,241,0.6); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.5); background: #000;`
    switch (mode) {
      case 'large':
        iframeRef.current.style.cssText = `position: fixed; top: 80px; left: 50%; transform: translateX(-50%); width: 520px; height: 390px; z-index: 99999; ${base}`
        break
      case 'hidden':
        // Must stay IN the viewport — Chrome throttles rAF for off-screen iframes
        // (even with real dimensions). Tiny + near-transparent so user doesn't notice.
        iframeRef.current.style.cssText = `position: fixed; top: 0; left: 0; width: 80px; height: 60px; pointer-events: none; z-index: 1; opacity: 0.01; border: none; overflow: hidden; background: #000;`
        break
      default: // pip
        iframeRef.current.style.cssText = `position: fixed; bottom: 16px; right: 16px; width: 240px; height: 180px; z-index: 99999; ${base}`
        break
    }
  }, [])

  useEffect(() => {
    return () => { cleanup() }
  }, [cleanup])

  return {
    isReady,
    faceDetected,
    prediction,
    listenerCount,
    error,
    logs,
    start,
    stop,
    getPrediction,
    recordScreenPosition,
    setPreviewMode,
    exportModel,
  }
}
