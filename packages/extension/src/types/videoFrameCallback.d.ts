// requestVideoFrameCallback is shipped in Chrome but missing from the TS DOM
// lib at our TypeScript version.
interface VideoFrameCallbackMetadata {
  presentationTime: number
  expectedDisplayTime: number
  width: number
  height: number
  mediaTime: number
  presentedFrames: number
  processingDuration?: number
}

interface HTMLVideoElement {
  requestVideoFrameCallback(
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
  ): number
  cancelVideoFrameCallback(handle: number): void
}
