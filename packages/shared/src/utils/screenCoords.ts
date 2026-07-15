// ---------------------------------------------------------------------------
// Screen <-> viewport(client) coordinate transforms.
//
// The gaze model is trained in GLOBAL SCREEN pixels so a session survives the
// window being moved/resized or the page being zoomed. Each consumer
// (calibration page, tracked page) converts between its own client
// coordinates and screen coordinates using its live window geometry.
//
// Assumptions (standard browser layout): window borders are split evenly
// left/right, and all remaining vertical chrome (tab strip, URL bar,
// bookmarks) sits ABOVE the viewport. window.screenX/outerWidth are in
// device-independent screen px; window.innerWidth is in CSS px, which differ
// by the page zoom factor.
//
// KNOWN LIMIT: side- or bottom-docked DevTools breaks the even-split/top-only
// assumption. The content script compensates by measuring the TRUE viewport
// origin from real user clicks (MouseEvent.screenX - clientX*zoom) and
// preferring that measurement over this heuristic.
// ---------------------------------------------------------------------------

export interface WindowGeometry {
  screenX: number
  screenY: number
  outerWidth: number
  outerHeight: number
  innerWidth: number
  innerHeight: number
  /** Page zoom factor (chrome.tabs.getZoom). Extension pages are 1. */
  zoom: number
}

/** Top-left corner of the viewport in global screen px. */
export function viewportOriginOnScreen(g: WindowGeometry): { x: number; y: number } {
  const innerScreenW = g.innerWidth * g.zoom
  const innerScreenH = g.innerHeight * g.zoom
  const sideBorder = Math.max(0, (g.outerWidth - innerScreenW) / 2)
  const topChrome = Math.max(0, g.outerHeight - innerScreenH - 0)
  return {
    x: g.screenX + sideBorder,
    y: g.screenY + topChrome,
  }
}

/** Convert client (CSS px, viewport-relative) coordinates to global screen px. */
export function clientToScreen(
  g: WindowGeometry,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const origin = viewportOriginOnScreen(g)
  return {
    x: origin.x + clientX * g.zoom,
    y: origin.y + clientY * g.zoom,
  }
}

/** Convert global screen px to client (CSS px, viewport-relative) coordinates. */
export function screenToClient(
  g: WindowGeometry,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const origin = viewportOriginOnScreen(g)
  return {
    x: (screenX - origin.x) / g.zoom,
    y: (screenY - origin.y) / g.zoom,
  }
}

/** Snapshot the current window's geometry (call from a page context). */
export function captureWindowGeometry(win: Window, zoom = 1): WindowGeometry {
  return {
    screenX: win.screenX,
    screenY: win.screenY,
    outerWidth: win.outerWidth,
    outerHeight: win.outerHeight,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    zoom,
  }
}
