import { detectFixations } from '@gazekit/shared'
import type { Fixation, GazeSample } from '@gazekit/shared'
import { GazeEvent } from '../models/GazeEvent'

interface CacheEntry {
  fixations: Fixation[]
  cachedAt: number
}

const LRU_MAX = 50
const cache = new Map<string, CacheEntry>()

function cacheKey(sessionId: string, url: string): string {
  return `${sessionId}::${url}`
}

function evictIfNeeded(): void {
  if (cache.size >= LRU_MAX) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) {
      cache.delete(oldestKey)
    }
  }
}

export async function getFixations(sessionId: string, url: string): Promise<Fixation[]> {
  const key = cacheKey(sessionId, url)

  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached.fixations
  }

  const gazeEvents = await GazeEvent.find({
    'meta.sid': sessionId,
    'ctx.url': url,
  }).sort({ ts: 1 }).lean()

  const samples: GazeSample[] = gazeEvents.map(e => ({
    x: e.x ?? 0,
    y: e.y ?? 0,
    ts: e.ts ? new Date(e.ts).getTime() : 0,
    conf: e.conf ?? null,
  }))

  const fixations = detectFixations(samples)

  const enrichedFixations = fixations.map((f, i) => {
    const matchingEvent = gazeEvents.find(e => {
      const eventTs = e.ts ? new Date(e.ts).getTime() : 0
      return eventTs >= f.startTs && eventTs <= f.endTs
    })
    return {
      ...f,
      url,
      scrollY: matchingEvent?.ctx?.sy ?? 0,
      element: matchingEvent?.el ? {
        selector: matchingEvent.el.sel ?? '',
        tag: matchingEvent.el.tag ?? '',
        text: matchingEvent.el.txt ?? '',
        rect: {
          x: matchingEvent.el.rect?.x ?? 0,
          y: matchingEvent.el.rect?.y ?? 0,
          w: matchingEvent.el.rect?.w ?? 0,
          h: matchingEvent.el.rect?.h ?? 0,
        },
      } : null,
    } satisfies Fixation
  })

  evictIfNeeded()
  cache.set(key, { fixations: enrichedFixations, cachedAt: Date.now() })

  return enrichedFixations
}

export function clearFixationCache(): void {
  cache.clear()
}
