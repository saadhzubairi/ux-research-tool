declare module 'webgazer' {
  interface WebGazerTracker {
    getPositions(): unknown
  }

  interface WebGazer {
    setRegression(type: string): WebGazer
    setTracker(type: string): WebGazer
    applyKalmanFilter(apply: boolean): WebGazer
    showVideoPreview(show: boolean): WebGazer
    showPredictionPoints(show: boolean): WebGazer
    showVideo(show: boolean): WebGazer
    showFaceOverlay(show: boolean): WebGazer
    showFaceFeedbackBox(show: boolean): WebGazer
    setGazeListener(
      cb: (data: { x: number; y: number } | null, elapsedTime: number) => void,
    ): WebGazer
    begin(): Promise<void>
    end(): void
    pause(): void
    resume(): void
    getTracker(): WebGazerTracker | null
    getCurrentPrediction(): Promise<{ x: number; y: number } | null>
    recordScreenPosition(x: number, y: number, eventType: string): void
  }

  const webgazer: WebGazer
  export default webgazer
}
