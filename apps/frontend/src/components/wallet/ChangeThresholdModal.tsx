import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPolicyTransaction } from "@/api/wallets";
import { useTranslation } from "@/hooks/useTranslation";
import { useToastStore } from "@/stores/useToastStore";
import type { Wallet } from "@/types/wallet";
import { Modal, Button } from "../ui";

interface ChangeThresholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: Wallet;
  onCreated: () => void;
}

export const ChangeThresholdModal: React.FC<ChangeThresholdModalProps> = ({
  isOpen,
  onClose,
  wallet,
  onCreated,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToastStore();

  const ownerCount = wallet.signer_count;
  const initial =
    wallet.threshold === 1 && ownerCount > 1
      ? 2
      : wallet.threshold > 1
        ? wallet.threshold - 1
        : 1;
  const [newThreshold, setNewThreshold] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (newThreshold === wallet.threshold) return;
    setLoading(true);
    setError(null);
    try {
      const tx = await createPolicyTransaction(wallet.id, {
        action: "change_threshold",
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("wallet.policyChangeThreshold")}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">
          {t("wallet.policyCurrentThreshold")}: {wallet.threshold} / {ownerCount}
        </p>

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
                onClick={() => setNewThreshold((v) => Math.min(ownerCount, v + 1))}
                disabled={newThreshold >= ownerCount}
              >
                +
              </button>
            </div>
            <span className="text-sm text-[var(--muted)]">/ {ownerCount}</span>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text)]">
          <div className="font-semibold mb-1">{t("wallet.policyPreview")}</div>
          <div>
            {t("wallet.policyThresholdChange")}: {wallet.threshold} →{" "}
            {newThreshold} / {ownerCount}
          </div>
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" className="px-4 py-2 text-sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            className="px-4 py-2 text-sm"
            onClick={handleSubmit}
            loading={loading}
            disabled={newThreshold === wallet.threshold}
          >
            {t("wallet.policyCreateTransaction")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
