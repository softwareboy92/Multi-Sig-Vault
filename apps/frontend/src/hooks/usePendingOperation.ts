// apps/frontend/src/hooks/usePendingOperation.ts

const STORAGE_KEY = "multivault:pending-ops";
const TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PendingOperation =
  | {
      type: "signature";
      txId: string;
      data: { signature: string; signerId: string; signerIndex: number };
      savedAt: number;
    }
  | {
      type: "broadcast";
      txId: string;
      txHash: string;
      savedAt: number;
    }
  | {
      type: "activation";
      walletId: string;
      txHash: string;
      params: { address: string; salt: string; factory_address: string };
      savedAt: number;
    };

// ---------------------------------------------------------------------------
// Pure helpers (no React dependency — testable standalone)
// ---------------------------------------------------------------------------

function readAll(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const ops: PendingOperation[] = JSON.parse(raw);
    if (!Array.isArray(ops)) return [];
    return ops;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeAll(ops: PendingOperation[]): void {
  if (ops.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
  }
}

function filterExpired(ops: PendingOperation[]): PendingOperation[] {
  const now = Date.now();
  return ops.filter((op) => now - op.savedAt < TTL_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Save a pending operation (replaces existing op with same type+id). */
export function savePendingOp(op: Omit<PendingOperation, "savedAt">): void {
  const ops = filterExpired(readAll());
  // Remove any existing op with same type + id
  const key = "txId" in op ? op.txId : (op as Extract<PendingOperation, { type: "activation" }>).walletId;
  const filtered = ops.filter(
    (existing) =>
      !(existing.type === op.type &&
        ("txId" in existing ? existing.txId : (existing as Extract<PendingOperation, { type: "activation" }>).walletId) === key),
  );
  filtered.push({ ...op, savedAt: Date.now() } as PendingOperation);
  writeAll(filtered);
}

/** Remove a pending operation by type + id. */
export function removePendingOp(type: PendingOperation["type"], id: string): void {
  const ops = filterExpired(readAll());
  const filtered = ops.filter(
    (op) =>
      !(op.type === type &&
        ("txId" in op ? op.txId : (op as Extract<PendingOperation, { type: "activation" }>).walletId) === id),
  );
  writeAll(filtered);
}

/** Get pending ops for a given transaction ID. */
export function getPendingOpsByTxId(txId: string): PendingOperation[] {
  return filterExpired(readAll()).filter(
    (op) => "txId" in op && op.txId === txId,
  );
}

/** Get pending activation op for a given wallet ID. */
export function getPendingActivation(walletId: string): Extract<PendingOperation, { type: "activation" }> | null {
  const ops = filterExpired(readAll());
  return (
    (ops.find(
      (op) => op.type === "activation" && op.walletId === walletId,
    ) as Extract<PendingOperation, { type: "activation" }>) ?? null
  );
}

/** Remove all expired entries (call on app init). */
export function clearExpiredOps(): void {
  writeAll(filterExpired(readAll()));
}
