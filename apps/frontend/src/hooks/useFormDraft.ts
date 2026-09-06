import { useCallback, useRef } from "react";

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const DEBOUNCE_MS = 500;

interface DraftEnvelope<T> {
  data: T;
  savedAt: number;
}

export interface UseFormDraftReturn<T> {
  load: () => T | null;
  save: (data: T) => void;
  clear: () => void;
}

export function useFormDraft<T>(key: string): UseFormDraftReturn<T> {
  const storageKey = `draft:${key}`;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((): T | null => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const envelope: DraftEnvelope<T> = JSON.parse(raw);
      if (Date.now() - envelope.savedAt > EXPIRY_MS) {
        sessionStorage.removeItem(storageKey);
        return null;
      }
      return envelope.data;
    } catch {
      sessionStorage.removeItem(storageKey);
      return null;
    }
  }, [storageKey]);

  const save = useCallback(
    (data: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          const envelope: DraftEnvelope<T> = { data, savedAt: Date.now() };
          sessionStorage.setItem(storageKey, JSON.stringify(envelope));
        } catch {
          // Storage full or unavailable — silently ignore
        }
      }, DEBOUNCE_MS);
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  return { load, save, clear };
}
