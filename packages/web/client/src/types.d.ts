declare module 'heatmap.js' {
  interface HeatmapConfiguration {
    container: HTMLElement
    radius?: number
    maxOpacity?: number
    minOpacity?: number
    blur?: number
    gradient?: Record<string, string>
  }

  interface HeatmapDataPoint {
    x: number
    y: number
    value: number
  }

  interface HeatmapData {
    max: number
    data: HeatmapDataPoint[]
  }

  interface HeatmapInstance {
    setData(data: HeatmapData): void
    addData(point: HeatmapDataPoint): void
    configure(config: Partial<HeatmapConfiguration>): void
    repaint(): void
    getData(): HeatmapData
    getValueAt(point: { x: number; y: number }): number
  }

  interface HeatmapFactory {
    create(config: HeatmapConfiguration): HeatmapInstance
  }

  const h337: HeatmapFactory
  export default h337
}

declare module 'rrweb-player' {
  interface RRWebPlayerOptions {
    target: HTMLElement
    props: {
      events: unknown[]
      width?: number
      height?: number
      autoPlay?: boolean
      showController?: boolean
      speed?: number
    }
  }

  class RRWebPlayer {
    constructor(options: RRWebPlayerOptions)
    play(): void
    pause(): void
    goto(timeOffset: number): void
  }

  export default RRWebPlayer
}
