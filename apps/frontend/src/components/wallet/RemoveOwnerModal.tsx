import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPolicyTransaction } from "@/api/wallets";
import { useTranslation } from "@/hooks/useTranslation";
import { useToastStore } from "@/stores/useToastStore";
import { truncateAddress } from "@/utils/address";
import type { Wallet } from "@/types/wallet";
import { Modal, Button } from "../ui";

interface RemoveOwnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: Wallet;
  ownerAddress: string;
  onCreated: () => void;
}

export const RemoveOwnerModal: React.FC<RemoveOwnerModalProps> = ({
  isOpen,
  onClose,
  wallet,
  ownerAddress,
  onCreated,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToastStore();

  const ownerCount = wallet.signer_count;
  const maxThreshold = ownerCount - 1;
  const defaultThreshold = Math.min(wallet.threshold, maxThreshold);
  const [newThreshold, setNewThreshold] = useState(defaultThreshold);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerName =
    wallet.signers.find(
      (s) => s.address?.toLowerCase() === ownerAddress.toLowerCase()
    )?.name || "Unknown";

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const tx = await createPolicyTransaction(wallet.id, {
        action: "remove_owner",
        removed_owner: ownerAddress,
        new_threshold: newThreshold,
      });
      showToast(t("wallet.policyCreateTransaction"), "success");
      onCreated();
      onClose();
      navigate(`/transactions/${tx.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("wallet.policyRemoveOwner")}>
      <div className="space-y-4">
        {/* Owner being removed */}
        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="font-semibold text-[var(--text)]">{ownerName}</div>
          <div className="text-xs text-[var(--muted)] font-mono">
            {truncateAddress(ownerAddress)}
          </div>
        </div>

        {/* Threshold stepper */}
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
            {t("wallet.policyNewThreshold")}
          </label>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] overflow-hidden">
              <button
                type="button"
                className="w-10 h-10 flex items-center justify-center text-lg font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-40"
                onClick={() => setNewThreshold((v) => Math.max(1, v - 1))}
                disabled={newThreshold <= 1}
              >
                −
              </button>
              <div className="w-12 h-10 flex items-center justify-center font-semibold">
                {newThreshold}
              </div>
              <button
                type="button"
                className="w-10 h-10 flex items-center justify-center text-lg font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-40"
                onClick={() => setNewThreshold((v) => Math.min(maxThreshold, v + 1))}
                disabled={newThreshold >= maxThreshold}
              >
                +
              </button>
            </div>
            <span className="text-sm text-[var(--muted)]">/ {maxThreshold}</span>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text)]">
          <div className="font-semibold mb-1">{t("wallet.policyPreview")}</div>
          <div>
            {t("wallet.policyOwnersCount")}: {ownerCount} → {ownerCount - 1}
          </div>
          <div>
            {t("wallet.policyThresholdChange")}: {wallet.threshold} →{" "}
            {newThreshold} / {ownerCount - 1}
          </div>
        </div>

        <p className="text-sm text-[var(--muted)]">
          {t("wallet.policyRequiresSignatures", {
            threshold: wallet.threshold,
            count: wallet.signer_count,
          })}
        </p>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" className="px-4 py-2 text-sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" className="px-4 py-2 text-sm" onClick={handleSubmit} loading={loading}>
            {t("wallet.policyCreateTransaction")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
