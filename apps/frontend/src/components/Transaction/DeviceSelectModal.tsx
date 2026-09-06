import React from "react";
import { Button, Modal } from "../ui";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import { useTranslation } from "../../hooks/useTranslation";
import type { DeviceType } from "../../types";

interface DeviceSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (deviceType: DeviceType) => void;
}

export const DeviceSelectModal: React.FC<DeviceSelectModalProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("transactions.selectDevice")}
      showCloseButton={false}
    >
      <div className="flex flex-col w-full max-w-2xl gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold text-[var(--text)]">
            {t("wallet.deployWalletProvider")}
          </label>
          <div className="flex flex-row flex-wrap gap-2.5 justify-center">
            {(["METAMASK", "WALLETCONNECT"] as const).map((option) => (
              <div
                key={option}
                onClick={() => onSelect(option)}
                className="flex items-center gap-2.5 w-[160px] px-3 py-2.5 rounded-xl border cursor-pointer transition-colors border-[var(--field-border)] bg-[var(--panel)] hover:border-[var(--accent-3)]"
              >
                <img
                  src={SOURCE_ICON_MAP[option]?.icon}
                  alt={SOURCE_ICON_MAP[option]?.label}
                  className="w-8 h-8 object-contain"
                />
                <span className="text-xs font-semibold text-[var(--text)]">
                  {option === "METAMASK"
                    ? t("wallet.providerMetamask")
                    : t("wallet.providerWalletConnect")}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
