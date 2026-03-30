import { detectFixations } from '@gazekit/shared'
import type { Fixation, GazeSample } from '@gazekit/shared'
import { GazeEvent } from '../models/GazeEvent'

interface CacheEntry {
  fixations: Fixation[]
  cachedAt: number
}

const LRU_MAX = 50
const cache = new Map<string, CacheEntry>()

function cacheKey(sessionId: string, url: string, fromTs?: number, toTs?: number): string {
  return `${sessionId}::${url}::${fromTs ?? ''}::${toTs ?? ''}`
}

function evictIfNeeded(): void {
  if (cache.size >= LRU_MAX) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) {
      cache.delete(oldestKey)
    }
  }
}

export async function getFixations(
  sessionId: string,
  url: string,
  fromTs?: number,
  toTs?: number,
): Promise<Fixation[]> {
  const key = cacheKey(sessionId, url, fromTs, toTs)

  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached.fixations
  }

  const query: Record<string, unknown> = {
    'meta.sid': sessionId,
    'ctx.url': url,
  }

  if (fromTs !== undefined || toTs !== undefined) {
    const tsFilter: Record<string, Date> = {}
    if (fromTs !== undefined) tsFilter.$gte = new Date(fromTs)
    if (toTs !== undefined) tsFilter.$lte = new Date(toTs)
    query.ts = tsFilter
  }

  const gazeEvents = await GazeEvent.find(query).sort({ ts: 1 }).lean()

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
