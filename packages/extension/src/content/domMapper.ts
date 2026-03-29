// ---------------------------------------------------------------------------
// DOM Element Mapper
// Maps gaze coordinates (viewport px) to the most semantically meaningful
// DOM element under the gaze point.  Throttled to max 20 calls/second.
// ---------------------------------------------------------------------------

import type { GazeElement, GazeSample } from '@gazekit/shared'
import { MAX_SELECTOR_DEPTH } from '@gazekit/shared'

let lastCallTs = 0
const THROTTLE_MS = 50 // 20 Hz max

const INTERACTIVE_TAGS = new Set([
  'button', 'a', 'input', 'select', 'textarea', 'label',
])

const SEMANTIC_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'img', 'nav', 'main', 'aside', 'footer', 'header',
  'article', 'section', 'figure', 'figcaption', 'li',
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function mapGazeToElement(sample: GazeSample): GazeElement | null {
  const now = performance.now()
  if (now - lastCallTs < THROTTLE_MS) return null
  lastCallTs = now

  try {
    const elements = document.elementsFromPoint(sample.x, sample.y)
    if (!elements || elements.length === 0) return null

    // Also check shadow DOM roots
    const allElements = expandShadowRoots(elements, sample.x, sample.y)
    const element = selectBestElement(allElements)
    if (!element) return null

    const rect = element.getBoundingClientRect()

    return {
      selector: generateSelectorSafe(element),
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || '').trim().slice(0, 80),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Shadow DOM expansion
// ---------------------------------------------------------------------------

function expandShadowRoots(
  elements: Element[],
  x: number,
  y: number,
): Element[] {
  const result: Element[] = [...elements]

  for (const el of elements) {
    if (el.shadowRoot) {
      try {
        const shadowElements = el.shadowRoot.elementsFromPoint(x, y)
        if (shadowElements.length > 0) {
          result.push(...shadowElements)
        }
      } catch {
        // Some shadow roots are closed — skip
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Element selection heuristics
// ---------------------------------------------------------------------------

function selectBestElement(elements: Element[]): Element | null {
  const viewportArea = window.innerWidth * window.innerHeight
  const maxArea = viewportArea * 0.8

  // First pass: interactive elements (buttons, links, inputs)
  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    if (INTERACTIVE_TAGS.has(tag)) {
      const rect = el.getBoundingClientRect()
      if (rect.width * rect.height < maxArea) return el
    }
    // Also check role attribute for custom interactive elements
    const role = el.getAttribute('role')
    if (role === 'button' || role === 'link' || role === 'textbox') {
      const rect = el.getBoundingClientRect()
      if (rect.width * rect.height < maxArea) return el
    }
  }

  // Second pass: semantic elements (headings, paragraphs, etc.)
  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    if (SEMANTIC_TAGS.has(tag)) {
      const rect = el.getBoundingClientRect()
      if (rect.width * rect.height < maxArea) return el
    }
  }

  // Third pass: first non-huge, non-root element
  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'html' || tag === 'body') continue
    const rect = el.getBoundingClientRect()
    if (rect.width * rect.height < maxArea) return el
  }

  return null
}

// ---------------------------------------------------------------------------
// CSS selector generation
// ---------------------------------------------------------------------------

// Cached reference to @medv/finder once loaded
let finderFn: ((el: Element, opts: Record<string, unknown>) => string) | null = null
let finderLoadAttempted = false

function loadFinder(): void {
  if (finderLoadAttempted) return
  finderLoadAttempted = true

  // Eagerly load @medv/finder via dynamic import (non-blocking)
  void import('@medv/finder').then((mod) => {
    if (typeof mod.finder === 'function') {
      finderFn = mod.finder as typeof finderFn
    }
  }).catch(() => {
    // @medv/finder unavailable — fallback selector will be used
  })
}

// Kick off the load immediately on module evaluation
loadFinder()

function generateSelectorSafe(element: Element): string {
  if (finderFn) {
    try {
      return finderFn(element, {
        root: document.body,
        idName: (name: string) => !(/^(css-|_|ember|react)/).test(name),
        maxNumberOfTries: 500,
      })
    } catch {
      // Fall through to fallback
    }
  }
  return fallbackSelector(element, 0)
}

function fallbackSelector(element: Element, depth: number): string {
  if (depth >= MAX_SELECTOR_DEPTH || !element.parentElement) {
    return element.tagName.toLowerCase()
  }

  const tag = element.tagName.toLowerCase()

  if (element.id && !(/^(css-|_|ember|react)/).test(element.id)) {
    return `#${CSS.escape(element.id)}`
  }

  const parent = element.parentElement
  const siblings = Array.from(parent.children).filter(
    (c) => c.tagName === element.tagName,
  )
  const idx = siblings.indexOf(element)
  const nth = siblings.length > 1 ? `:nth-of-type(${idx + 1})` : ''

  return `${fallbackSelector(parent, depth + 1)} > ${tag}${nth}`
}
