import { create } from 'zustand'
import type { ExtensionStatus, ExtensionSettings } from '../../types/extension'

export interface PopupState {
  status: ExtensionStatus | null
  showSettings: boolean
  trackingStartedAt: number | null
  elapsedSeconds: number
  draftSettings: Partial<ExtensionSettings>
  setStatus: (status: ExtensionStatus) => void
  setShowSettings: (show: boolean) => void
  setTrackingStartedAt: (ts: number | null) => void
  setElapsedSeconds: (seconds: number) => void
  setDraftSettings: (settings: Partial<ExtensionSettings>) => void
  resetDraftSettings: () => void
}

export const usePopupStore = create<PopupState>((set) => ({
  status: null,
  showSettings: false,
  trackingStartedAt: null,
  elapsedSeconds: 0,
  draftSettings: {},
  setStatus: (status) => set({ status }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setTrackingStartedAt: (trackingStartedAt) => set({ trackingStartedAt }),
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
  setDraftSettings: (draftSettings) => set({ draftSettings }),
  resetDraftSettings: () => set({ draftSettings: {} }),
}))
