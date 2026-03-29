// ---------------------------------------------------------------------------
// SPA Detector
// Detects client-side route changes by monkey-patching history.pushState /
// replaceState and listening for popstate events.
// ---------------------------------------------------------------------------

type RouteChangeCallback = (url: string) => void

class SpaDetector {
  private listeners: RouteChangeCallback[] = []
  private currentUrl = ''
  private originalPushState: typeof history.pushState | null = null
  private originalReplaceState: typeof history.replaceState | null = null
  private boundHandlePopState: (() => void) | null = null

  start(): void {
    this.currentUrl = location.href

    // Monkey-patch pushState
    this.originalPushState = history.pushState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this.originalPushState!(...args)
      this.checkRouteChange()
    }

    // Monkey-patch replaceState
    this.originalReplaceState = history.replaceState.bind(history)
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this.originalReplaceState!(...args)
      this.checkRouteChange()
    }

    // Listen for popstate (back/forward navigation)
    this.boundHandlePopState = this.handlePopState.bind(this)
    window.addEventListener('popstate', this.boundHandlePopState)
  }

  stop(): void {
    if (this.originalPushState) {
      history.pushState = this.originalPushState
      this.originalPushState = null
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState
      this.originalReplaceState = null
    }
    if (this.boundHandlePopState) {
      window.removeEventListener('popstate', this.boundHandlePopState)
      this.boundHandlePopState = null
    }
    this.listeners = []
  }

  onRouteChange(callback: RouteChangeCallback): void {
    this.listeners.push(callback)
  }

  offRouteChange(callback: RouteChangeCallback): void {
    this.listeners = this.listeners.filter((cb) => cb !== callback)
  }

  private handlePopState(): void {
    this.checkRouteChange()
  }

  private checkRouteChange(): void {
    const newUrl = location.href
    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl
      for (const cb of this.listeners) {
        try {
          cb(newUrl)
        } catch (err) {
          console.error('[GazeKit] Route change listener error:', err)
        }
      }
    }
  }
}

export const spaDetector = new SpaDetector()
