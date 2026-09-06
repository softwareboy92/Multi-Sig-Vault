import { create } from "zustand";
import { persist } from "zustand/middleware";

export const TRANSACTION_TAG_COLORS = [
  "#247eea",
  "#16856f",
  "#b87310",
  "#d9435f",
  "#7c3aed",
  "#526f8c",
] as const;

export interface TransactionTag {
  id: string;
  name: string;
  color: string;
}

interface TransactionTagState {
  tags: TransactionTag[];
  transactionTags: Record<string, string[]>;
  createTag: (name: string, color: string) => string;
  deleteTag: (tagId: string) => void;
  toggleTransactionTag: (transactionId: string, tagId: string) => void;
  setTransactionTags: (transactionId: string, tagIds: string[]) => void;
}

export const useTransactionTagStore = create<TransactionTagState>()(
  persist(
    (set) => ({
      tags: [],
      transactionTags: {},
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
          transactionTags: Object.fromEntries(
            Object.entries(state.transactionTags)
              .map(([transactionId, tagIds]) => [
                transactionId,
                tagIds.filter((id) => id !== tagId),
              ])
              .filter(([, tagIds]) => tagIds.length > 0),
          ),
        })),
      toggleTransactionTag: (transactionId, tagId) =>
        set((state) => {
          const current = state.transactionTags[transactionId] || [];
          const next = current.includes(tagId)
            ? current.filter((id) => id !== tagId)
            : [...current, tagId];
          const transactionTags = { ...state.transactionTags };
          if (next.length > 0) transactionTags[transactionId] = next;
          else delete transactionTags[transactionId];
          return { transactionTags };
        }),
      setTransactionTags: (transactionId, tagIds) =>
        set((state) => {
          const transactionTags = { ...state.transactionTags };
          if (tagIds.length > 0) transactionTags[transactionId] = tagIds;
          else delete transactionTags[transactionId];
          return { transactionTags };
        }),
    }),
    {
      name: "transaction-tag-storage",
    },
  ),
);
