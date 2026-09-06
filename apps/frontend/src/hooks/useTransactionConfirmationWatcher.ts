import { useEffect, useRef, useCallback } from "react";
import { getWalletTransactions, getWallets } from "../api";
import type { Wallet } from "../types";
import { useToastStore } from "../stores/useToastStore";
import { usePendingStore } from "../stores/usePendingStore";
import { useTranslation } from "./useTranslation";
import type { TransactionStatus } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHash(hash?: string | null): string {
  if (!hash) return "-";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

const WATCHABLE_STATUSES = new Set<string>(["SIGNED", "BROADCAST"]);
const TERMINAL_STATUSES = new Set<string>(["CONFIRMED", "FAILED", "CANCELLED"]);

/** Split an array into chunks of at most `size` elements. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Adaptive interval logic (C3b)
// ---------------------------------------------------------------------------

const INTERVAL_FAST = 15_000; // pending < 5 min
const INTERVAL_MEDIUM = 30_000; // pending 5–30 min
const INTERVAL_SLOW = 60_000; // pending > 30 min

/** Max concurrent wallet‐polling requests (C3c). */
const WALLET_CONCURRENCY = 3;

/**
 * Decide the next polling delay based on the oldest BROADCAST transaction.
 *
 * - No pending txs → `null` (stop polling; restart via visibilitychange)
 * - Pending < 5 min → 15 s
 * - Pending 5–30 min → 30 s
 * - Pending > 30 min → 60 s
 */
function nextDelay(oldestPendingMs: number | null): number | null {
  if (oldestPendingMs === null) return null;

  const FIVE_MIN = 5 * 60_000;
  const THIRTY_MIN = 30 * 60_000;

  if (oldestPendingMs < FIVE_MIN) return INTERVAL_FAST;
  if (oldestPendingMs < THIRTY_MIN) return INTERVAL_MEDIUM;
  return INTERVAL_SLOW;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransactionConfirmationWatcher(): void {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const { requestRefresh } = usePendingStore();

  const lastStatusByTxIdRef = useRef<Map<string, TransactionStatus>>(new Map());
  const initializedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  // Memoize so the effect dependency is stable.
  const stableShowToast = useCallback(showToast, [showToast]);
  const stableRequestRefresh = useCallback(requestRefresh, [requestRefresh]);
  const stableT = useCallback(t, [t]);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let consecutiveGetWalletsFailures = 0;
    const MAX_FAILURES_BEFORE_NOTIFY = 3;

    // -- C3b: schedule the next poll with adaptive delay ----------------
    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      timerId = setTimeout(() => {
        void pollOnce(true);
      }, delayMs);
    };

    // -------------------------------------------------------------------
    const pollOnce = async (emitNotifications: boolean) => {
      // C3a: skip when tab is hidden
      if (document.hidden) {
        // Don't schedule; the visibilitychange listener will restart.
        return;
      }

      if (inFlightRef.current) return;

      const job = (async () => {
        // Track the oldest pending tx timestamp across all wallets.
        let oldestPendingMs: number | null = null;
        const now = Date.now();

        try {
          let walletsResp: { items: Wallet[] };
          try {
            walletsResp = await getWallets();
            consecutiveGetWalletsFailures = 0;
          } catch (walletsErr) {
            consecutiveGetWalletsFailures++;
            if (consecutiveGetWalletsFailures >= MAX_FAILURES_BEFORE_NOTIFY) {
              stableShowToast(
                stableT("error.confirmationWatcherPaused"),
                "warning",
              );
            }
            // Exponential backoff: 30s, 60s, 120s
            const backoffMs = Math.min(
              30_000 * Math.pow(2, consecutiveGetWalletsFailures - 1),
              120_000,
            );
            scheduleNext(backoffMs);
            return;
          }
          const wallets = walletsResp.items || [];

          const activeWallets = wallets.filter((w) => w.status === "ACTIVE");
          if (activeWallets.length === 0) {
            initializedRef.current = true;
            return;
          }

          // C3c: poll wallets in parallel batches (max WALLET_CONCURRENCY).
          const chunks = chunkArray(activeWallets, WALLET_CONCURRENCY);
          for (const batch of chunks) {
            if (cancelled) return;
            await Promise.all(
              batch.map(async (wallet) => {
                if (cancelled) return;

                let txResp;
                try {
                  txResp = await getWalletTransactions(wallet.id);
                } catch {
                  return;
                }

                const txs = txResp.items || [];
                for (const tx of txs) {
                  if (!tx?.id) continue;

                  const prev = lastStatusByTxIdRef.current.get(tx.id);
                  lastStatusByTxIdRef.current.set(tx.id, tx.status);

                  // C3b: track age of pending (watchable) txs.
                  if (WATCHABLE_STATUSES.has(tx.status) && tx.created_at) {
                    const ageMs = now - new Date(tx.created_at).getTime();
                    if (oldestPendingMs === null || ageMs > oldestPendingMs) {
                      oldestPendingMs = ageMs;
                    }
                  }

                  if (!emitNotifications || !initializedRef.current) {
                    continue;
                  }

                  const wasWatchable = prev ? WATCHABLE_STATUSES.has(prev) : false;
                  const isTerminal = TERMINAL_STATUSES.has(tx.status);

                  if (wasWatchable && isTerminal) {
                    const name = wallet.name || "-";
                    const hash = tx.tx_hash ? shortHash(tx.tx_hash) : tx.id.slice(0, 8);

                    if (tx.status === "CONFIRMED") {
                      const isExternal = prev === "SIGNED";
                      stableShowToast(
                        stableT(
                          isExternal ? "toast.txConfirmedExternal" : "toast.txConfirmed",
                          { name, hash },
                        ),
                        "success",
                      );
                    } else if (tx.status === "FAILED") {
                      stableShowToast(
                        stableT("toast.txFailed", { name, hash }),
                        "error",
                        0,
                      );
                    }
                    // CANCELLED is explicit user action; no automatic toast needed
                    stableRequestRefresh();
                  }
                }
              }),
            );
          }

          initializedRef.current = true;
        } finally {
          inFlightRef.current = null;

          // C3b: schedule next poll with adaptive delay.
          if (!cancelled) {
            const delay = nextDelay(oldestPendingMs);
            if (delay !== null) {
              scheduleNext(delay);
            }
            // If delay is null (no pending txs) we stop scheduling;
            // the visibilitychange listener or a future trigger restarts it.
          }
        }
      })();

      inFlightRef.current = job;
      await job;
    };

    // -- C3a: restart polling when tab becomes visible -------------------
    const onVisibilityChange = () => {
      if (!document.hidden && !cancelled) {
        // Reset failure counter on tab refocus
        consecutiveGetWalletsFailures = 0;
        // Clear any pending timer and poll immediately.
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        void pollOnce(true);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    // Initial poll (silent — no notifications on startup).
    void pollOnce(false);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [stableShowToast, stableT, stableRequestRefresh]);
}
