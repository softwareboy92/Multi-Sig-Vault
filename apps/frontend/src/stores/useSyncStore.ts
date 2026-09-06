import { create } from "zustand";

interface SyncState {
  isSyncing: boolean;
  syncError: string | null;
  startSync: () => void;
  finishSync: () => void;
  failSync: (error: string) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isSyncing: false,
  syncError: null,
  startSync: () => set({ isSyncing: true, syncError: null }),
  finishSync: () => set({ isSyncing: false, syncError: null }),
  failSync: (error) => set({ isSyncing: false, syncError: error }),
}));
