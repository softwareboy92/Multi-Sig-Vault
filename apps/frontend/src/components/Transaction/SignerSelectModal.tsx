import React from "react";
import { Modal } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import type { WalletSigner } from "../../types";

interface SignerSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingSigners: WalletSigner[];
  onSelect: (signer: WalletSigner) => void;
  chainType?: string;
}

export const SignerSelectModal: React.FC<SignerSelectModalProps> = ({
  isOpen,
  onClose,
  pendingSigners,
  onSelect,
  chainType,
}) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("transactions.selectSigner")}>
      <div className="space-y-3">
        {pendingSigners.map((signer) => (
          <button
            key={signer.id}
            onClick={() => onSelect(signer)}
            className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--row-head-bg)]"
          >
            <div className="flex items-center gap-2">
              {SOURCE_ICON_MAP[signer.device_type] && (
                <img
                  src={SOURCE_ICON_MAP[signer.device_type].icon}
                  alt={SOURCE_ICON_MAP[signer.device_type].label}
                  className="w-5 h-5 object-contain"
                />
              )}
              <span className="font-bold text-sm">{signer.name}</span>
              {SOURCE_ICON_MAP[signer.device_type] && (
                <span className="text-xs text-[var(--muted)]">
                  {SOURCE_ICON_MAP[signer.device_type].label}
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--muted)] font-mono mt-1 break-all">
              {signer.address || signer.xpub || signer.public_key}
            </div>
            {chainType === "BTC" && !signer.address && signer.xpub && signer.derivation_path && (
              <div className="text-xs text-[var(--muted)] mt-0.5">
                {signer.derivation_path}
              </div>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
};
