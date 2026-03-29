import { MAX_SELECTOR_DEPTH } from '../constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

// Note: @medv/finder is a browser-only package. This provides a fallback
// for server-side usage and a wrapper interface.
export function generateSelector(element: Element): string {
  try {
    // Dynamic import for @medv/finder (browser only)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { finder } = require('@medv/finder')
    return finder(element, {
      root: document.body,
      idName: (name: string) => !name.match(/^(css-|_|ember|react)/),
      maxNumberOfTries: 500,
    })
  } catch {
    return fallbackSelector(element)
  }
}

function fallbackSelector(element: Element, depth = 0): string {
  if (depth >= MAX_SELECTOR_DEPTH || !element.parentElement) {
    return element.tagName.toLowerCase()
  }

  const tag = element.tagName.toLowerCase()

  if (element.id && !element.id.match(/^(css-|_|ember|react)/)) {
    return `#${CSS.escape(element.id)}`
  }

  const parent = element.parentElement
  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName
  )

  const index = siblings.indexOf(element)
  const nthSelector = siblings.length > 1 ? `:nth-of-type(${index + 1})` : ''
  const parentSelector = fallbackSelector(parent, depth + 1)

  return `${parentSelector} > ${tag}${nthSelector}`
}
