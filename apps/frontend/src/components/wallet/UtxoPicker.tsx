import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type { WalletUtxo, UtxoSelection } from "@/types";

interface UtxoPickerProps {
  utxos: WalletUtxo[];
  selected: UtxoSelection[];
  onChange: (selected: UtxoSelection[]) => void;
  /** Number of UTXOs locked by pending transactions (shown as hint) */
  lockedCount?: number;
  /** Extra content rendered at the right side of the header row */
  extra?: React.ReactNode;
}

/** Shorten a txid for display: first8…last6 */
function shortTxid(txid: string): string {
  if (txid.length <= 16) return txid;
  return `${txid.slice(0, 8)}…${txid.slice(-6)}`;
}

export const UtxoPicker: React.FC<UtxoPickerProps> = ({
  utxos,
  selected,
  onChange,
  lockedCount = 0,
  extra,
}) => {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(
    () => new Set(selected.map((s) => `${s.txid}:${s.vout}`)),
    [selected]
  );

  const totalSelected = useMemo(
    () =>
      utxos
        .filter((u) => selectedSet.has(`${u.txid}:${u.vout}`))
        .reduce((sum, u) => sum + u.value, 0),
    [utxos, selectedSet]
  );

  const toggleUtxo = useCallback(
    (utxo: WalletUtxo) => {
      const key = `${utxo.txid}:${utxo.vout}`;
      if (selectedSet.has(key)) {
        onChange(selected.filter((s) => `${s.txid}:${s.vout}` !== key));
      } else {
        onChange([...selected, { txid: utxo.txid, vout: utxo.vout }]);
      }
    },
    [selected, selectedSet, onChange]
  );

  const selectAll = useCallback(() => {
    onChange(utxos.map((u) => ({ txid: u.txid, vout: u.vout })));
  }, [utxos, onChange]);

  const selectNone = useCallback(() => {
    onChange([]);
  }, [onChange]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  // Summary text for the trigger button
  const isAllSelected = selected.length === utxos.length && utxos.length > 0;
  const triggerText = useMemo(() => {
    if (selected.length === 0) return t("transactions.utxoPickPlaceholder");
    if (isAllSelected) {
      return t("transactions.utxoAllSelected", {
        count: String(utxos.length),
        amount: totalSelected.toLocaleString(),
      });
    }
    return t("transactions.utxoSelected", {
      count: String(selected.length),
      amount: totalSelected.toLocaleString(),
    });
  }, [selected.length, utxos.length, isAllSelected, totalSelected, t]);

  return (
    <div className="flex flex-col gap-2" ref={containerRef}>
      <div className="flex items-center justify-between gap-3">
        <label className="field-label">{t("transactions.utxoSelection")}</label>
        <div className="flex items-center gap-3">
          {lockedCount > 0 && (
            <span className="text-xs text-[var(--warning)]">
              {t("transactions.utxoLockedCount", { count: String(lockedCount) })}
            </span>
          )}
          {extra}
        </div>
      </div>

      <div className="relative">
          {/* Dropdown trigger */}
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm transition-colors hover:border-[var(--primary)]"
            onClick={() => setDropdownOpen((v) => !v)}
          >
            <span
              className={
                selected.length > 0
                  ? "text-[var(--text)]"
                  : "text-[var(--muted)]"
              }
            >
              {triggerText}
            </span>
            <svg
              className={`w-4 h-4 text-[var(--muted)] transition-transform ${
                dropdownOpen ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown panel */}
          {dropdownOpen && (
            <div className="overlay-surface absolute z-50 mt-1 w-full rounded-xl border border-[var(--border)] shadow-[var(--shadow-overlay)]">
              {/* Quick actions bar */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
                <span className="text-xs text-[var(--muted)]">
                  {t("transactions.utxoAvailable", {
                    count: String(utxos.length),
                  })}
                </span>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-[var(--primary)] hover:underline"
                    onClick={selectAll}
                  >
                    {t("transactions.utxoSelectAll")}
                  </button>
                  <button
                    type="button"
                    className="text-[var(--muted)] hover:underline"
                    onClick={selectNone}
                  >
                    {t("transactions.utxoSelectNone")}
                  </button>
                </div>
              </div>

              {/* UTXO list */}
              {utxos.length === 0 ? (
                <div className="text-sm text-[var(--muted)] py-4 text-center">
                  {t("transactions.utxoNoneAvailable")}
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-[var(--border)]">
                  {utxos.map((utxo) => {
                    const key = `${utxo.txid}:${utxo.vout}`;
                    const isSelected = selectedSet.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[var(--primary)]/5"
                            : "hover:bg-[var(--row-head-bg)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleUtxo(utxo)}
                          className="accent-[var(--primary)] shrink-0"
                        />
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-xs truncate text-[var(--text)]">
                              {shortTxid(utxo.txid)}:{utxo.vout}
                            </div>
                            {utxo.height ? (
                              <div className="text-[10px] text-[var(--muted)]">
                                {t("transactions.utxoHeight", {
                                  height: String(utxo.height),
                                })}
                              </div>
                            ) : null}
                          </div>
                          <span className="text-xs font-semibold text-[var(--text)] whitespace-nowrap">
                            {utxo.value.toLocaleString()} sats
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Footer summary */}
              {selected.length > 0 && (
                <div className="px-3 py-2 border-t border-[var(--border)] text-xs text-[var(--primary)] font-medium">
                  {t("transactions.utxoSelected", {
                    count: String(selected.length),
                    amount: totalSelected.toLocaleString(),
                  })}
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  );
};
