import { create } from "zustand";
import { persist } from "zustand/middleware";

export const WALLET_TAG_COLORS = [
  "#247eea",
  "#16856f",
  "#b87310",
  "#d9435f",
  "#7c3aed",
  "#526f8c",
] as const;

export interface WalletTag {
  id: string;
  name: string;
  color: string;
}

interface WalletTagState {
  tags: WalletTag[];
  walletTags: Record<string, string[]>;
  createTag: (name: string, color: string) => string;
  deleteTag: (tagId: string) => void;
  setWalletTags: (walletId: string, tagIds: string[]) => void;
}

export const useWalletTagStore = create<WalletTagState>()(
  persist(
    (set) => ({
      tags: [],
      walletTags: {},
      createTag: (name, color) => {
        const id = crypto.randomUUID();
        set((state) => ({
          tags: [...state.tags, { id, name: name.trim(), color }],
        }));
        return id;
      },
      deleteTag: (tagId) =>
        set((state) => ({
          tags: state.tags.filter((tag) => tag.id !== tagId),
          walletTags: Object.fromEntries(
            Object.entries(state.walletTags)
              .map(([walletId, tagIds]) => [
                walletId,
                tagIds.filter((id) => id !== tagId),
              ])
              .filter(([, tagIds]) => tagIds.length > 0),
          ),
        })),
      setWalletTags: (walletId, tagIds) =>
        set((state) => {
          const walletTags = { ...state.walletTags };
          if (tagIds.length > 0) walletTags[walletId] = tagIds;
          else delete walletTags[walletId];
          return { walletTags };
        }),
    }),
    { name: "wallet-tag-storage" },
  ),
);
