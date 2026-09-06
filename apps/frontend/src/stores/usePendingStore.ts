import { create } from "zustand";
import type { PendingActionItem } from "../api/pending";
import { getPendingActions } from "../api/pending";

type ChainFilter = string;
type StatusFilter = string;
export type TimeFilter = "ALL" | "24H" | "7D" | "30D";

interface PendingState {
  // Data
  items: PendingActionItem[];
  total: number;
  loading: boolean;
  error: string | null;

  // Filters
  chainFilter: ChainFilter;
  statusFilter: StatusFilter;
  timeFilter: TimeFilter;

  // Drawer open state
  isOpen: boolean;

  // External refresh trigger (bumped by action handlers after mutations)
  refreshToken: number;

  // Actions
  setOpen: (open: boolean) => void;
  setChainFilter: (v: ChainFilter) => void;
  setStatusFilter: (v: StatusFilter) => void;
  setTimeFilter: (v: TimeFilter) => void;
  resetFilters: () => void;
  fetchPending: (silent?: boolean) => Promise<void>;
  requestRefresh: () => void;
}

export const usePendingStore = create<PendingState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  error: null,

  chainFilter: "ALL",
  statusFilter: "ALL",
  timeFilter: "ALL",

  isOpen: false,
  refreshToken: 0,

  setOpen: (open) => {
    set({ isOpen: open });
    if (open) {
      // Reset filters and fetch fresh data when opening
      set({ chainFilter: "ALL", statusFilter: "ALL", timeFilter: "ALL" });
      get().fetchPending(false);
    }
  },

  setChainFilter: (v) => set({ chainFilter: v }),
  setStatusFilter: (v) => set({ statusFilter: v }),
  setTimeFilter: (v) => set({ timeFilter: v }),
  resetFilters: () => set({ chainFilter: "ALL", statusFilter: "ALL", timeFilter: "ALL" }),

  fetchPending: async (silent = false) => {
    if (!silent) set({ loading: true });
    set({ error: null });
    try {
      const resp = await getPendingActions();
      set({ items: resp.items, total: resp.total });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load pending actions",
        items: [],
        total: 0,
      });
    } finally {
      if (!silent) set({ loading: false });
    }
  },

  requestRefresh: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
}));
