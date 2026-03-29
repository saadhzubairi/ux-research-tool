// ---------------------------------------------------------------------------
// DOM Version Tracker
// Tracks significant DOM mutations (large element additions/removals) and
// increments a monotonic version counter consumed by GazeContext.
// ---------------------------------------------------------------------------

let domVersion = 0
let observer: MutationObserver | null = null
const MIN_AREA = 100 * 100 // 10 000 sq px

export function startDomVersionTracking(): void {
  domVersion = 0

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue

      for (const node of mutation.addedNodes) {
        if (isSignificantNode(node)) {
          domVersion++
          return // Only increment once per batch
        }
      }

      for (const node of mutation.removedNodes) {
        if (isSignificantNode(node)) {
          domVersion++
          return
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
}

export function stopDomVersionTracking(): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}

export function getDomVersion(): number {
  return domVersion
}

function isSignificantNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as Element

  const tag = el.tagName.toLowerCase()
  if (tag === 'style' || tag === 'script' || tag === 'link') return false

  try {
    const rect = el.getBoundingClientRect()
    return rect.width * rect.height > MIN_AREA
  } catch {
    return false
  }
}
