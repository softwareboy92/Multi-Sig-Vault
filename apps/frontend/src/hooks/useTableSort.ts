import { useCallback, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string = string> {
  key: K | null;
  direction: SortDirection;
}

export interface UseTableSortReturn<K extends string = string> {
  sortState: SortState<K>;
  toggleSort: (key: K) => void;
  resetSort: () => void;
}

export function useTableSort<K extends string = string>(
  defaultKey: K | null = null,
  defaultDirection: SortDirection = "asc",
): UseTableSortReturn<K> {
  const [sortState, setSortState] = useState<SortState<K>>({
    key: defaultKey,
    direction: defaultDirection,
  });

  const toggleSort = useCallback((key: K) => {
    setSortState((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  }, []);

  const resetSort = useCallback(() => {
    setSortState({ key: defaultKey, direction: defaultDirection });
  }, [defaultKey, defaultDirection]);

  return { sortState, toggleSort, resetSort };
}

/**
 * Pure sort comparator. Apply to arrays before rendering.
 * Returns a new sorted array (does not mutate input).
 */
export function applySortComparator<T>(
  items: T[],
  sortState: SortState,
  comparators: Record<string, (a: T, b: T) => number>,
): T[] {
  if (!sortState.key || !comparators[sortState.key]) return items;
  const cmp = comparators[sortState.key];
  const sorted = [...items].sort(cmp);
  return sortState.direction === "desc" ? sorted.reverse() : sorted;
}
