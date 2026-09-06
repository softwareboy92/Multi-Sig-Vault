import { create } from "zustand";
import { persist } from "zustand/middleware";

interface GuideState {
  tourCompleted: boolean;
  markTourCompleted: () => void;
  resetAll: () => void;
}

export const useGuideStore = create<GuideState>()(
  persist(
    (set) => ({
      tourCompleted: false,
      markTourCompleted: () => set({ tourCompleted: true }),
      resetAll: () => set({ tourCompleted: false }),
    }),
    { name: "guide-storage" },
  ),
);
