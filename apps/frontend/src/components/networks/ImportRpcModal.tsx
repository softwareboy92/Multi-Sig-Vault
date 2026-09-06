import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Modal, Button } from '../ui';
import { testNetwork, createNode } from '../../api/networks';
import { lookupChain, getPublicRpcs, normalizeRpcUrl } from '../../services/chainRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RpcCandidate {
  url: string;
  status: 'pending' | 'available' | 'unavailable';
  latencyMs: number | null;
  selected: boolean;
}

export interface ImportRpcModalProps {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
  networkId: string;
  existingEndpoints: string[];
  onImported: (success: number, failed: number) => void;
}

// Priority values for imported nodes (decreasing).
const IMPORT_PRIORITIES = [400, 300, 200, 100, 50];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportRpcModal({
  isOpen,
  onClose,
  chainId,
  networkId,
  existingEndpoints,
  onImported,
}: ImportRpcModalProps) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<RpcCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Load candidates & run health checks on open ──────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      setLoading(true);
      setCandidates([]);

      // Ensure cache is warm
      await lookupChain(chainId);
      const rpcs = getPublicRpcs(chainId);

      // Dedup against existing endpoints
      const existingNorm = new Set(existingEndpoints.map(normalizeRpcUrl));
      const filtered = rpcs.filter((url) => !existingNorm.has(normalizeRpcUrl(url)));

      if (filtered.length === 0) {
        setCandidates([]);
        setLoading(false);
        return;
      }

      // Initialize candidates
      const initial: RpcCandidate[] = filtered.map((url) => ({
        url,
        status: 'pending',
        latencyMs: null,
        selected: false,
      }));
      setCandidates(initial);
      setLoading(false);

      // Fire parallel health checks
      filtered.forEach((url, idx) => {
        if (controller.signal.aborted) return;

        const timeoutId = setTimeout(() => {
          // 15s timeout — mark as unavailable
          setCandidates((prev) =>
            prev.map((c, i) => (i === idx && c.status === 'pending' ? { ...c, status: 'unavailable' } : c)),
          );
        }, 15000);

        testNetwork('EVM', {
          node_type: 'JSON_RPC',
          endpoint_url: url,
          extra: { chain_id: chainId },
        })
          .then((result) => {
            clearTimeout(timeoutId);
            if (controller.signal.aborted) return;
            setCandidates((prev) =>
              prev.map((c, i) =>
                i === idx
                  ? {
                      ...c,
                      status: result.success ? 'available' : 'unavailable',
                      latencyMs: result.latency_ms,
                    }
                  : c,
              ),
            );
          })
          .catch(() => {
            clearTimeout(timeoutId);
            if (controller.signal.aborted) return;
            setCandidates((prev) =>
              prev.map((c, i) => (i === idx && c.status === 'pending' ? { ...c, status: 'unavailable' } : c)),
            );
          });
      });
    })();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [isOpen, chainId, existingEndpoints]);

  // ── Selection toggle ─────────────────────────────────────────────────
  const toggleSelect = useCallback((idx: number) => {
    setCandidates((prev) => prev.map((c, i) => (i === idx ? { ...c, selected: !c.selected } : c)));
  }, []);

  const selectedCount = candidates.filter((c) => c.selected).length;

  // ── Import handler ───────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length === 0) return;

    setImporting(true);
    let success = 0;

    for (let i = 0; i < selected.length; i++) {
      try {
        await createNode('EVM', networkId, {
          node_type: 'JSON_RPC',
          endpoint_url: selected[i].url,
          priority: IMPORT_PRIORITIES[i] ?? 50,
        });
        success++;
      } catch {
        // Skip failed, continue
      }
    }

    setImporting(false);

    const failed = selected.length - success;
    if (success > 0) {
      onImported(success, failed);
      onClose();
    } else {
      // All failed — stay open, notify parent
      onImported(0, failed);
    }
  }, [candidates, networkId, onImported, onClose]);

  // ── Render ───────────────────────────────────────────────────────────
  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const isEmpty = !loading && candidates.length === 0;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('networks.importRpcTitle')}>
      <div className="flex flex-col gap-3">
        {loading && (
          <div className="text-center py-6 text-[var(--muted)]">{t('common.loading')}</div>
        )}

        {isEmpty && (
          <div className="text-center py-6">
            <p className="text-[var(--muted)]">{t('networks.noPublicRpcs')}</p>
            <p className="text-xs text-[var(--muted)] mt-1">{t('networks.noPublicRpcsHint')}</p>
          </div>
        )}

        {!loading && candidates.length > 0 && (
          <ul className="flex flex-col gap-2">
            {candidates.map((c, idx) => (
              <li
                key={c.url}
                className="flex items-start gap-3 p-3 rounded-lg border border-[var(--field-border)] hover:bg-[var(--row-head-bg)] transition-colors cursor-pointer"
                onClick={() => toggleSelect(idx)}
              >
                <input
                  type="checkbox"
                  checked={c.selected}
                  onChange={() => toggleSelect(idx)}
                  className="accent-[var(--accent)] mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate text-[var(--text)]">{c.url}</p>
                  <div className="flex items-center gap-1.5 mt-1 text-xs">
                    {c.status === 'pending' && (
                      <span className="text-[var(--muted)]">⏳ {t('networks.rpcChecking')}</span>
                    )}
                    {c.status === 'available' && (
                      <span className="text-[var(--success)]">
                        ✅ {t('networks.rpcAvailable')}
                        {c.latencyMs != null && ` (${Math.round(c.latencyMs)}ms)`}
                      </span>
                    )}
                    {c.status === 'unavailable' && (
                      <span className="text-[var(--danger)]" title={t('networks.rpcUnavailableHint')}>
                        ❌ {t('networks.rpcUnavailable')}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={handleClose} disabled={importing}>
            {t('common.cancel')}
          </Button>
          {!isEmpty && (
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={selectedCount === 0 || importing}
            >
              {importing
                ? t('common.loading')
                : `${t('networks.importSelected')} (${selectedCount})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
