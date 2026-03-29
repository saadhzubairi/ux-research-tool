// ---------------------------------------------------------------------------
// Heatmap Overlay
// Fixed viewport canvas that accumulates gaze density and renders a color
// heatmap in real-time. Pages assumed non-scrollable.
// ---------------------------------------------------------------------------

// Grid resolution divisor — density grid is 1/SCALE of viewport
const SCALE = 4
// Gaussian kernel radius in grid cells (~40px at SCALE=4 means ~10 cells)
const KERNEL_RADIUS = 10
// Gaussian sigma in grid cells
const KERNEL_SIGMA = 5
// Render throttle — target ~10Hz
const RENDER_INTERVAL_MS = 100
// Canvas opacity so the page remains readable
const CANVAS_OPACITY = 0.45

// Precompute Gaussian kernel weights
const kernelSize = KERNEL_RADIUS * 2 + 1
const kernel = new Float32Array(kernelSize * kernelSize)
;(() => {
  const s2 = 2 * KERNEL_SIGMA * KERNEL_SIGMA
  for (let dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++) {
    for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
      const weight = Math.exp(-(dx * dx + dy * dy) / s2)
      kernel[(dy + KERNEL_RADIUS) * kernelSize + (dx + KERNEL_RADIUS)] = weight
    }
  }
})()

// Color gradient LUT (256 entries, RGBA)
const gradientLUT = new Uint8ClampedArray(256 * 4)
;(() => {
  // Stops: transparent → blue → cyan → green → yellow → red → white
  const stops: Array<[number, number, number, number, number]> = [
    //  pos,   R,   G,   B,   A
    [0.00,   0,   0,   0,   0],
    [0.10,  30,  60, 200, 120],
    [0.25,   0, 150, 220, 180],
    [0.40,   0, 200,  80, 200],
    [0.55, 220, 220,   0, 220],
    [0.70, 240, 120,   0, 230],
    [0.85, 230,  30,  20, 240],
    [1.00, 255, 255, 255, 255],
  ]

  for (let i = 0; i < 256; i++) {
    const t = i / 255
    // Find surrounding stops
    let lo = 0
    for (let s = 1; s < stops.length; s++) {
      if (stops[s][0] >= t) { lo = s - 1; break }
    }
    const hi = Math.min(lo + 1, stops.length - 1)
    const range = stops[hi][0] - stops[lo][0]
    const frac = range > 0 ? (t - stops[lo][0]) / range : 0

    gradientLUT[i * 4 + 0] = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * frac)
    gradientLUT[i * 4 + 1] = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * frac)
    gradientLUT[i * 4 + 2] = Math.round(stops[lo][3] + (stops[hi][3] - stops[lo][3]) * frac)
    gradientLUT[i * 4 + 3] = Math.round(stops[lo][4] + (stops[hi][4] - stops[lo][4]) * frac)
  }
})()

class HeatmapOverlayImpl {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private grid: Float32Array | null = null
  private gridW = 0
  private gridH = 0
  private rafId: number | null = null
  private lastRenderTime = 0
  private dirty = false
  private resizeHandler: (() => void) | null = null

  start(): void {
    if (this.canvas) return

    const canvas = document.createElement('canvas')
    canvas.id = '__gazekit-heatmap'
    canvas.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 2147483646;
      opacity: ${CANVAS_OPACITY};
    `
    document.body.appendChild(canvas)
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!

    this.resize()

    this.resizeHandler = () => this.resize()
    window.addEventListener('resize', this.resizeHandler)

    this.renderLoop()
  }

  addPoint(x: number, y: number): void {
    if (!this.grid) return

    // Map viewport pixel to grid cell
    const gx = Math.round(x / SCALE)
    const gy = Math.round(y / SCALE)

    // Stamp Gaussian kernel centered at (gx, gy)
    for (let dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++) {
      const row = gy + dy
      if (row < 0 || row >= this.gridH) continue
      for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
        const col = gx + dx
        if (col < 0 || col >= this.gridW) continue
        const weight = kernel[(dy + KERNEL_RADIUS) * kernelSize + (dx + KERNEL_RADIUS)]
        this.grid[row * this.gridW + col] += weight
      }
    }

    this.dirty = true
  }

  snapshot(): string {
    if (!this.canvas) return ''
    // Force a render before snapshot
    this.render()
    return this.canvas.toDataURL('image/png')
  }

  clear(): void {
    if (this.grid) this.grid.fill(0)
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
    this.dirty = false
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
    this.ctx = null
    this.grid = null
  }

  private resize(): void {
    if (!this.canvas || !this.ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight

    this.canvas.width = w * dpr
    this.canvas.height = h * dpr
    this.ctx.scale(dpr, dpr)

    this.gridW = Math.ceil(w / SCALE)
    this.gridH = Math.ceil(h / SCALE)

    // Preserve existing data if possible, otherwise allocate fresh
    const newGrid = new Float32Array(this.gridW * this.gridH)
    if (this.grid) {
      const copyLen = Math.min(this.grid.length, newGrid.length)
      newGrid.set(this.grid.subarray(0, copyLen))
    }
    this.grid = newGrid
    this.dirty = true
  }

  private renderLoop = (): void => {
    this.rafId = requestAnimationFrame(this.renderLoop)

    const now = performance.now()
    if (now - this.lastRenderTime < RENDER_INTERVAL_MS) return
    if (!this.dirty) return

    this.lastRenderTime = now
    this.render()
  }

  private render(): void {
    if (!this.ctx || !this.canvas || !this.grid) return

    const w = this.gridW
    const h = this.gridH

    // Find max for normalization
    let maxVal = 0
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] > maxVal) maxVal = this.grid[i]
    }
    if (maxVal === 0) return

    // Build RGBA image from grid
    const imgData = this.ctx.createImageData(w, h)
    const pixels = imgData.data

    for (let i = 0; i < this.grid.length; i++) {
      const normalized = this.grid[i] / maxVal
      const lutIndex = Math.min(255, Math.round(normalized * 255))
      const pi = i * 4
      const li = lutIndex * 4
      pixels[pi] = gradientLUT[li]
      pixels[pi + 1] = gradientLUT[li + 1]
      pixels[pi + 2] = gradientLUT[li + 2]
      pixels[pi + 3] = gradientLUT[li + 3]
    }

    // Clear and draw scaled up
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Use a temp canvas at grid resolution, then drawImage scaled
    const tmp = new OffscreenCanvas(w, h)
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.putImageData(imgData, 0, 0)

    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
    this.ctx.drawImage(tmp, 0, 0, window.innerWidth, window.innerHeight)

    this.dirty = false
  }
}

export const heatmapOverlay = new HeatmapOverlayImpl()
