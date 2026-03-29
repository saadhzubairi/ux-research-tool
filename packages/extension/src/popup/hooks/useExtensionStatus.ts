import { useEffect, useRef, useState } from 'react'
import type { ExtensionStatus, PopupMessage } from '../../types/extension'
import { usePopupStore } from '../store/popupStore'

function sendToServiceWorker(message: PopupMessage): Promise<ExtensionStatus | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: ExtensionStatus | undefined) => {
      resolve(response)
    })
  })
}

export { sendToServiceWorker }

export function useExtensionStatus() {
  const { status, setStatus } = usePopupStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      const response = await sendToServiceWorker({ type: 'get_status' })
      if (response && 'isTracking' in response && 'settings' in response) {
        setStatus(response)
      }
    }

    fetchStatus()

    intervalRef.current = setInterval(fetchStatus, 1000)

    const handleMessage = (
      message: { type: string } & Partial<ExtensionStatus>,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void
    ) => {
      if (message.type === 'status_update') {
        const { type: _, ...rest } = message
        setStatus(rest as ExtensionStatus)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [setStatus])

  return status
}

/** Pings the server HTTP endpoint to check if it's reachable */
export function useServerReachable(port: number) {
  const [reachable, setReachable] = useState<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`http://localhost:${port === 8765 ? 4444 : port}/api/status`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        })
        setReachable(res.ok)
      } catch {
        setReachable(false)
      }
    }

    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [port])

  return reachable
}
