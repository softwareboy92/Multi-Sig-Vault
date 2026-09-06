import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// "auto" = follow browser locale; otherwise IANA timezone string
type TimezonePreference = "auto" | string;

interface PreferenceState {
  showTestnets: boolean;
  setShowTestnets: (value: boolean) => void;
  addressBookOnlyTransfers: boolean;
  setAddressBookOnlyTransfers: (value: boolean) => void;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (value: boolean) => void;
  autoSyncIntervalMinutes: 1 | 5 | 10;
  setAutoSyncIntervalMinutes: (value: 1 | 5 | 10) => void;
  timezone: TimezonePreference;
  setTimezone: (value: TimezonePreference) => void;
  uiScalePercent: number;
  setUiScalePercent: (value: number) => void;
}

export const usePreferenceStore = create<PreferenceState>()(
  persist(
    (set) => ({
      showTestnets: false,
      setShowTestnets: (value) => set({ showTestnets: value }),
      addressBookOnlyTransfers: false,
      setAddressBookOnlyTransfers: (value) => set({ addressBookOnlyTransfers: value }),
      autoSyncEnabled: false,
      setAutoSyncEnabled: (value) => set({ autoSyncEnabled: value }),
      autoSyncIntervalMinutes: 1,
      setAutoSyncIntervalMinutes: (value) => set({ autoSyncIntervalMinutes: value }),
      timezone: "auto",
      setTimezone: (value) => set({ timezone: value }),
      uiScalePercent: 100,
      setUiScalePercent: (value) =>
        set({ uiScalePercent: Math.min(125, Math.max(80, value)) }),
    }),
    {
      name: 'preference-storage',
    }
  )
);

export type { TimezonePreference };
