import type { GazeSample, Fixation } from '../types/gaze'
import { FIXATION_DISPERSION_THRESHOLD_PX, FIXATION_DURATION_THRESHOLD_MS } from '../constants'

interface FixationOptions {
  dispersionThreshold?: number
  durationThreshold?: number
}

export function detectFixations(
  samples: GazeSample[],
  options?: FixationOptions
): Fixation[] {
  const dispersionThreshold = options?.dispersionThreshold ?? FIXATION_DISPERSION_THRESHOLD_PX
  const durationThreshold = options?.durationThreshold ?? FIXATION_DURATION_THRESHOLD_MS

  if (samples.length < 2) return []

  const fixations: Fixation[] = []
  let windowStart = 0
  let windowEnd = 0

  while (windowStart < samples.length) {
    windowEnd = windowStart + 1

    // Expand window until duration threshold is met
    while (
      windowEnd < samples.length &&
      samples[windowEnd]!.ts - samples[windowStart]!.ts < durationThreshold
    ) {
      windowEnd++
    }

    if (windowEnd >= samples.length) break

    // Check dispersion of current window
    const window = samples.slice(windowStart, windowEnd + 1)
    let dispersion = computeDispersion(window)

    if (dispersion <= dispersionThreshold) {
      // Expand window while dispersion stays below threshold
      while (windowEnd + 1 < samples.length) {
        const nextSample = samples[windowEnd + 1]!
        const extendedWindow = [...window, nextSample]
        const newDispersion = computeDispersion(extendedWindow)
        if (newDispersion > dispersionThreshold) break
        window.push(nextSample)
        dispersion = newDispersion
        windowEnd++
      }

      // Create fixation from window
      const centerX = window.reduce((sum, s) => sum + s.x, 0) / window.length
      const centerY = window.reduce((sum, s) => sum + s.y, 0) / window.length

      fixations.push({
        x: centerX,
        y: centerY,
        startTs: window[0]!.ts,
        endTs: window[window.length - 1]!.ts,
        durationMs: window[window.length - 1]!.ts - window[0]!.ts,
        sampleCount: window.length,
        element: null,
        url: '',
        scrollY: 0,
      })

      windowStart = windowEnd + 1
    } else {
      windowStart++
    }
  }

  return fixations
}

function computeDispersion(samples: GazeSample[]): number {
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity

  for (const s of samples) {
    if (s.x < minX) minX = s.x
    if (s.x > maxX) maxX = s.x
    if (s.y < minY) minY = s.y
    if (s.y > maxY) maxY = s.y
  }

  return (maxX - minX) + (maxY - minY)
}
