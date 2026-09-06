import React, { useState } from "react";
import { Badge, Button, Spinner } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "../../hooks/useTranslation";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import type { Transaction, Wallet, WalletSigner } from "../../types";

interface TransactionActionBarProps {
  transaction: Transaction;
  wallet: Wallet;
  signedSignerIds: Set<string>;
  actionLoading: boolean;
  broadcastCheckLoading: boolean;
  canSign: boolean;
  canExecute: boolean;
  canCancel: boolean;
  signingSignerId: string | null;
  onSignerSign: (signer: WalletSigner) => void;
  onExecute: () => void;
  onCancel: () => void;
}

export const TransactionActionBar: React.FC<TransactionActionBarProps> = ({
  transaction,
  wallet,
  signedSignerIds,
  actionLoading,
  broadcastCheckLoading,
  canSign,
  canExecute,
  canCancel,
  signingSignerId,
  onSignerSign,
  onExecute,
  onCancel,
}) => {
  const [expanded, setExpanded] = useState(true);
  const { t } = useTranslation();
  const loading = actionLoading || broadcastCheckLoading;

  // Derive contextual status label for the bottom bar
  const remaining = Math.max(0, transaction.threshold - transaction.signature_count);
  const statusLabel = (() => {
    if (transaction.signature_count >= transaction.threshold) {
      return t("transactions.actionBarReady");
    }
    if (transaction.signature_count === 0) {
      return t("transactions.actionBarNoSig");
    }
    return t("transactions.actionBarRemaining", { count: remaining });
  })();
  const badgeVariant =
    transaction.signature_count >= transaction.threshold ? "success" : "warning";

  return (
    <div className="shrink-0 mt-auto">
      <div className="transaction-action-surface flex flex-col-reverse overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          {/* Always-visible bottom bar (rendered first in DOM, visually at bottom via flex-col-reverse) */}
          <div
            className={`flex flex-col items-stretch gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4 sm:py-4 ${
              expanded ? "border-t border-[var(--border)]" : ""
            }`}
          >
            {/* Left: progress info + toggle */}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex min-w-0 w-full shrink-0 cursor-pointer items-center gap-2.5 text-xs transition-colors hover:text-[var(--text)] sm:w-auto"
            >
              <Badge variant={badgeVariant} dot>
                {transaction.signature_count}/{transaction.threshold}
              </Badge>
              <span className="text-[var(--text)] font-medium truncate">
                {statusLabel}
              </span>
              <svg
                className={`w-4 h-4 text-[var(--muted)] transition-transform duration-200 shrink-0 ${
                  expanded ? "rotate-180" : ""
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>

            {/* Right: action buttons */}
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto sm:items-center">
              {canExecute && (
                <Button
                  variant="primary"
                  onClick={onExecute}
                  disabled={loading}
                  className="flex-1 sm:flex-none"
                >
                  {wallet.chain_type === "BTC"
                    ? t("transactions.broadcast")
                    : t("transactions.execute")}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={onCancel}
                disabled={!canCancel || loading}
                className="flex-1 sm:flex-none"
              >
                {t("transactions.cancelTransaction")}
              </Button>
            </div>
          </div>

        {/* Collapsible panel (rendered second in DOM, visually above bar via flex-col-reverse) */}
        <div
          className={`transition-[max-height] duration-300 ease-in-out overflow-hidden ${
            expanded ? "max-h-[50vh]" : "max-h-0"
          }`}
        >
          <div className="max-h-[50vh] overflow-y-auto px-4 pt-3 pb-1">
            {/* Panel header */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--text)]">
                  {t("transactions.signersTitle")}
                </h3>
                {canSign && (
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {t("transactions.signerDirectHint")}
                  </p>
                )}
              </div>
              <span className="text-xs text-[var(--muted)]">
                {transaction.signature_count} / {transaction.threshold}
              </span>
            </div>

            {broadcastCheckLoading && (
              <div className="flex items-center gap-2 mb-2 text-xs text-[var(--muted)]">
                <Spinner size="sm" />
                <span>{t("transactions.checkingBroadcastStatus")}</span>
              </div>
            )}

            {/* Signers list */}
            <div className="divide-y divide-[var(--border)]">
              {wallet.signers.map((signer) => {
                const isSigned = signedSignerIds.has(signer.id);
                const signerDisplay = signer.address || signer.xpub || signer.public_key || "-";
                const showPath = wallet.chain_type === "BTC" && !signer.address && signer.xpub && signer.derivation_path;
                const deviceInfo = SOURCE_ICON_MAP[signer.device_type];
                const isSigning = signingSignerId === signer.id;
                const canSignerSign = canSign && !isSigned;
                return (
                  <div
                    key={signer.id}
                    className="flex items-center gap-2 py-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => canSignerSign && onSignerSign(signer)}
                      disabled={!canSignerSign || loading}
                      className={`group min-w-0 flex-1 rounded-[var(--field-radius)] border px-3 py-2.5 text-left transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        !canSignerSign
                          ? "cursor-default border-transparent bg-transparent"
                          : "cursor-pointer border-[var(--border)] bg-[var(--panel)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                      } disabled:opacity-65`}
                      aria-label={
                        isSigned
                          ? t("transactions.signed")
                          : canSignerSign
                            ? t("transactions.signWithSigner", { name: signer.name })
                            : t("transactions.pending")
                      }
                    >
                      <div className="flex items-start gap-3">
                        {deviceInfo && (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--row-head-bg)]">
                            <img src={deviceInfo.icon} alt={deviceInfo.label} className="h-5 w-5 object-contain" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-[var(--text)]">
                            <span>{signer.name}</span>
                            {deviceInfo && <span className="text-xs font-normal text-[var(--muted)]">{deviceInfo.label}</span>}
                          </span>
                          <span className="mt-0.5 block break-all font-mono text-xs text-[var(--muted)]">{signerDisplay}</span>
                          {showPath && <span className="mt-0.5 block text-xs text-[var(--muted)]">{signer.derivation_path}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 self-center">
                          {isSigning && <Spinner size="sm" />}
                          <Badge variant={isSigned ? "success" : "warning"}>
                            {isSigned
                              ? t("transactions.signed")
                              : isSigning
                                ? t("transactions.signing")
                                : canSignerSign
                                  ? t("transactions.signNow")
                                  : t("transactions.pending")}
                          </Badge>
                          {canSignerSign && !isSigning && (
                            <svg className="h-4 w-4 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          )}
                        </span>
                      </div>
                    </button>
                    <div className="shrink-0">
                      <CopyButton value={signerDisplay} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Blocking reason */}
            {transaction.status === "SIGNED" &&
              transaction.can_broadcast === false &&
              transaction.blocking_reason && (
                <div className="p-3 mt-2 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded text-sm text-[var(--warning)]">
                  <div className="flex items-start gap-2">
                    <span>⚠️</span>
                    <div>
                      <div className="font-medium">
                        {t("transactions.cannotBroadcast")}
                      </div>
                      <div className="mt-1 opacity-80">
                        {transaction.blocking_reason}
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </div>
          </div>
      </div>
    </div>
  );
};
