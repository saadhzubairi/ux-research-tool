import { describe, it, expect } from 'vitest'
import {
  clientToScreen,
  screenToClient,
  viewportOriginOnScreen,
  type WindowGeometry,
} from '@gazekit/shared'

const MAXIMIZED: WindowGeometry = {
  screenX: 0,
  screenY: 0,
  outerWidth: 1920,
  outerHeight: 1080,
  innerWidth: 1920,
  innerHeight: 993, // 87px of tab strip + URL bar
  zoom: 1,
}

const MOVED: WindowGeometry = {
  screenX: 240,
  screenY: 130,
  outerWidth: 1200,
  outerHeight: 800,
  innerWidth: 1200,
  innerHeight: 713,
  zoom: 1,
}

const ZOOMED: WindowGeometry = {
  screenX: 0,
  screenY: 0,
  outerWidth: 1920,
  outerHeight: 1080,
  innerWidth: 1536, // 1920 / 1.25
  innerHeight: 794.4, // 993 / 1.25
  zoom: 1.25,
}

describe('screenCoords', () => {
  it('places the viewport origin below the browser chrome', () => {
    const origin = viewportOriginOnScreen(MAXIMIZED)
    expect(origin.x).toBe(0)
    expect(origin.y).toBe(87)
  })

  it('round-trips client -> screen -> client', () => {
    for (const g of [MAXIMIZED, MOVED, ZOOMED]) {
      const screen = clientToScreen(g, 400, 300)
      const client = screenToClient(g, screen.x, screen.y)
      expect(client.x).toBeCloseTo(400, 6)
      expect(client.y).toBeCloseTo(300, 6)
    }
  })

  it('maps the same physical screen point to different client coords after a window move', () => {
    // Calibration-tab client point -> screen px
    const screen = clientToScreen(MAXIMIZED, 500, 400)
    // The same physical point seen from a moved/resized window
    const client = screenToClient(MOVED, screen.x, screen.y)
    expect(client.x).toBeCloseTo(500 - 240, 6)
    expect(client.y).toBeCloseTo(400 + 87 - 130 - 87, 6)
  })

  it('accounts for page zoom (CSS px vs screen px)', () => {
    // A gaze sample at screen (960, 500): the zoomed page's CSS px are 1.25x
    // larger, so client coords shrink by that factor
    const client = screenToClient(ZOOMED, 960, 500)
    expect(client.x).toBeCloseTo(960 / 1.25, 6)
    const chromeTop = 1080 - 794.4 * 1.25
    expect(client.y).toBeCloseTo((500 - chromeTop) / 1.25, 6)
  })
})
