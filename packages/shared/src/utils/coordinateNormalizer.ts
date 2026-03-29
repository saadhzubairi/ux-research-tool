export function viewportToDocument(x: number, y: number, scrollX: number, scrollY: number) {
  return { x: x + scrollX, y: y + scrollY }
}

export function viewportToNormalized(x: number, y: number, viewportW: number, viewportH: number) {
  return { nx: x / viewportW, ny: y / viewportH }
}

export function normalizedToViewport(nx: number, ny: number, viewportW: number, viewportH: number) {
  return { x: nx * viewportW, y: ny * viewportH }
}
