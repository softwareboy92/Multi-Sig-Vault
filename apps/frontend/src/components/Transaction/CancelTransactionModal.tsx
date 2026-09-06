import React from "react";
import { Badge, Button, Input, Modal, Spinner } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { Transaction, Wallet } from "../../types";
import type { CancelOptions } from "../../api";

interface CancelTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  wallet: Wallet;
  cancelOptions: CancelOptions | null;
  cancelReason: string;
  onCancelReasonChange: (v: string) => void;
  onConfirm: (onChain: boolean) => void;
  loading: boolean;
}

export const CancelTransactionModal: React.FC<CancelTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
  wallet,
  cancelOptions,
  cancelReason,
  onCancelReasonChange,
  onConfirm,
  loading,
}) => {
  const { t } = useTranslation();

  const handleClose = () => {
    onClose();
    onCancelReasonChange("");
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t("transactions.cancelTransaction")}>
      <div className="space-y-4">
        {/* Cancel options info */}
        {cancelOptions && wallet.chain_type !== "BTC" && (
          <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
            <div className="text-sm text-[var(--muted)] mb-2">
              {cancelOptions.reason}
            </div>
            {transaction.safe_nonce !== null && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">
                  Nonce: {transaction.safe_nonce}
                </span>
                {cancelOptions.is_latest_nonce && (
                  <Badge variant="success" className="text-xs">
                    {t("transactions.latestNonce")}
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reason input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            {t("transactions.cancelReason")} ({t("transactions.optional")})
          </label>
          <Input
            type="text"
            value={cancelReason}
            onChange={(e) => onCancelReasonChange(e.target.value)}
            placeholder={t("transactions.cancelReasonPlaceholder")}
            disabled={loading}
          />
        </div>

        {/* Branch 1: BTC */}
        {wallet.chain_type === "BTC" ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} disabled={loading} className="flex-1">
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => onConfirm(false)} disabled={loading} className="flex-1">
              {loading ? <Spinner size="sm" /> : t("common.confirm")}
            </Button>
          </div>
        ) : cancelOptions?.can_cancel_offchain && cancelOptions?.can_cancel_onchain ? (
          /* Branch 2: Both options */
          <div className="space-y-3">
            <div className="text-sm font-medium mb-2">
              {t("transactions.selectCancelMethod")}:
            </div>
            <button
              onClick={() => onConfirm(false)}
              disabled={loading}
              className="w-full p-4 text-left rounded-xl border-2 border-[var(--border)] hover:border-[var(--primary)] transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-bold text-sm">{t("transactions.cancelOffchain")}</div>
                <Badge variant="success" className="text-xs">{t("transactions.recommended")}</Badge>
              </div>
              <div className="text-xs text-[var(--muted)] space-y-1">
                <div>✓ {t("transactions.cancelOffchainBenefit1")}</div>
                <div>✓ {t("transactions.cancelOffchainBenefit2")}</div>
                <div>✓ {t("transactions.cancelOffchainBenefit3")}</div>
              </div>
            </button>
            <button
              onClick={() => onConfirm(true)}
              disabled={loading}
              className="w-full p-4 text-left rounded-xl border-2 border-[var(--border)] hover:border-[var(--warning)] transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-bold text-sm">{t("transactions.cancelOnchain")}</div>
                <Badge variant="warning" className="text-xs">{t("transactions.costsGas")}</Badge>
              </div>
              <div className="text-xs text-[var(--muted)] space-y-1">
                <div>• {t("transactions.cancelOnchainNote1")}</div>
                <div>• {t("transactions.cancelOnchainNote2")}</div>
                <div>• {t("transactions.cancelOnchainNote3")}</div>
              </div>
            </button>
          </div>
        ) : cancelOptions?.can_cancel_offchain ? (
          /* Branch 3: Offchain only */
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
              <div className="font-bold text-sm mb-1">{t("transactions.cancelOffchain")}</div>
              <div className="text-xs text-[var(--muted)] space-y-1">
                <div>✓ {t("transactions.cancelOffchainBenefit1")}</div>
                <div>✓ {t("transactions.cancelOffchainBenefit2")}</div>
                <div>✓ {t("transactions.cancelOffchainBenefit3")}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={loading} className="flex-1">
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={() => onConfirm(false)} disabled={loading} className="flex-1">
                {loading ? <Spinner size="sm" /> : t("common.confirm")}
              </Button>
            </div>
          </div>
        ) : cancelOptions?.can_cancel_onchain ? (
          /* Branch 4: Onchain only */
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-[var(--warning-bg)] border border-[var(--warning)]">
              <div className="flex items-start gap-2">
                <span className="text-[var(--warning)] text-xl">⚠️</span>
                <div className="flex-1">
                  <div className="font-bold text-sm mb-1">{t("transactions.onchainCancelRequired")}</div>
                  <div className="text-xs text-[var(--muted)] space-y-1">
                    <div>• {t("transactions.onchainCancelReason1")}</div>
                    <div>• {t("transactions.onchainCancelReason2")}</div>
                    <div>• {t("transactions.onchainCancelReason3")}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={loading} className="flex-1">
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={() => onConfirm(true)} disabled={loading} className="flex-1">
                {loading ? <Spinner size="sm" /> : t("transactions.createCancellationTx")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
