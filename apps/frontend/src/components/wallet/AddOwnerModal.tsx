import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPolicyTransaction } from "@/api/wallets";
import { getSigners } from "@/api/signers";
import { useTranslation } from "@/hooks/useTranslation";
import { useToastStore } from "@/stores/useToastStore";
import { isValidEvmAddress, truncateAddress } from "@/utils/address";
import { SOURCE_ICON_MAP } from "@/utils/signer";
import type { Signer } from "@/types/signer";
import type { Wallet } from "@/types/wallet";
import { Modal, Button, Input } from "../ui";

interface AddOwnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: Wallet;
  onCreated: () => void;
}

export const AddOwnerModal: React.FC<AddOwnerModalProps> = ({
  isOpen,
  onClose,
  wallet,
  onCreated,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToastStore();

  const [newOwner, setNewOwner] = useState("");
  const [newThreshold, setNewThreshold] = useState(wallet.threshold);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evmSigners, setEvmSigners] = useState<Signer[]>([]);

  const ownerCount = wallet.signer_count;
  const maxThreshold = ownerCount + 1;

  const existingAddresses = wallet.signers
    .map((s) => s.address?.toLowerCase())
    .filter(Boolean);

  // Load available EVM signers when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getSigners();
        if (cancelled) return;
        setEvmSigners(
          (res.items || []).filter(
            (s) =>
              s.chain_type === "EVM" &&
              s.address &&
              !existingAddresses.includes(s.address.toLowerCase()),
          ),
        );
      } catch {
        // best effort
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const isImportedAddress =
    newOwner &&
    evmSigners.some(
      (s) => s.address?.toLowerCase() === newOwner.toLowerCase(),
    );

  const showNotImportedWarning =
    newOwner &&
    isValidEvmAddress(newOwner) &&
    !isImportedAddress &&
    !existingAddresses.includes(newOwner.toLowerCase());

  const validate = (): string | null => {
    if (!isValidEvmAddress(newOwner)) return t("wallet.policyInvalidAddress");
    if (existingAddresses.includes(newOwner.toLowerCase()))
      return t("wallet.policyAlreadyOwner");
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tx = await createPolicyTransaction(wallet.id, {
        action: "add_owner",
        new_owner: newOwner,
        new_threshold: newThreshold,
      });
      showToast(t("wallet.policyCreateTransaction"), "success");
      onCreated();
      onClose();
      navigate(`/transactions/${tx.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create transaction");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("wallet.policyAddOwner")}>
      <div className="space-y-4">
        {/* Signer selection */}
        {evmSigners.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
              {t("wallet.policySelectFromSigners")}
            </label>
            <div className="space-y-1 max-h-36 overflow-y-auto rounded-lg border border-[var(--border)] p-1">
              {evmSigners.map((s) => {
                const iconInfo = SOURCE_ICON_MAP[s.device_type];
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      newOwner.toLowerCase() === s.address?.toLowerCase()
                        ? "bg-[var(--accent)]/15 border border-[var(--accent)]"
                        : "hover:bg-[var(--row-head-bg)]"
                    }`}
                    onClick={() => setNewOwner(s.address || "")}
                  >
                    <div className="flex items-center gap-2">
                      {iconInfo ? (
                        <img src={iconInfo.icon} alt={iconInfo.label} className="w-4 h-4 object-contain shrink-0" />
                      ) : (
                        <span className="w-4 h-4 rounded bg-[var(--row-head-bg)] border border-[var(--border)] flex items-center justify-center text-[10px] text-[var(--muted)] shrink-0">?</span>
                      )}
                      <span className="font-medium text-[var(--text)]">{s.name}</span>
                    </div>
                    <div className="text-xs text-[var(--muted)] font-mono ml-6">
                      {truncateAddress(s.address || "")}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-[var(--muted)] mt-2">
              {t("wallet.policyOrEnterManually")}
            </div>
          </div>
        )}

        <Input
          label={t("wallet.policyNewOwnerAddress")}
          value={newOwner}
          onChange={(e) => setNewOwner(e.target.value.trim())}
          placeholder="0x..."
          error={error || undefined}
        />

        {/* Not-imported warning */}
        {showNotImportedWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
            <svg className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
            <span className="text-xs text-[var(--text)]">
              {t("wallet.policyNotImportedWarning")}
            </span>
          </div>
        )}

        {/* Threshold stepper */}
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
            {t("wallet.policyNewThreshold")}
          </label>
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
          <span className="ml-2 text-sm text-[var(--muted)]">/ {maxThreshold}</span>
        </div>

        {/* Preview */}
        <div className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text)]">
          <div className="font-semibold mb-1">{t("wallet.policyPreview")}</div>
          <div>
            {t("wallet.policyOwnersCount")}: {ownerCount} → {ownerCount + 1}
          </div>
          <div>
            {t("wallet.policyThresholdChange")}: {wallet.threshold} →{" "}
            {newThreshold} / {ownerCount + 1}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" className="px-4 py-2 text-sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            className="px-4 py-2 text-sm"
            onClick={handleSubmit}
            loading={loading}
            disabled={!newOwner}
          >
            {t("wallet.policyCreateTransaction")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
