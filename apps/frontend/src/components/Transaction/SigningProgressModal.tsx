import React from "react";
import { Modal } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import type { WalletSigner } from "../../types";

interface SigningProgressModalProps {
  signer: WalletSigner | null;
}

export const SigningProgressModal: React.FC<SigningProgressModalProps> = ({
  signer,
}) => {
  const { t } = useTranslation();
  const sourceKey = signer?.device_type === "HOT" ? "METAMASK" : signer?.device_type;
  const device = sourceKey ? SOURCE_ICON_MAP[sourceKey] : undefined;
  const deviceName = device?.label || signer?.device_type || "";
  const signerAddress = signer?.address || signer?.public_key || signer?.xpub || "-";

  return (
    <Modal
      isOpen={Boolean(signer)}
      onClose={() => {}}
      title={t("transactions.signingModalTitle")}
      maxWidth="28rem"
    >
      <div
        className="flex flex-col items-center px-1 py-3 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] border-r-[var(--accent)] motion-reduce:animate-none" />
          <div className="flex h-18 w-18 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--row-head-bg)] shadow-[var(--card-shadow)]">
            {device?.icon ? (
              <img
                src={device.icon}
                alt={deviceName}
                className="h-11 w-11 object-contain"
              />
            ) : (
              <span className="text-lg font-bold text-[var(--accent)]">
                {deviceName.slice(0, 1)}
              </span>
            )}
          </div>
        </div>

        <h4 className="text-base font-bold text-[var(--text)]">
          {t("transactions.signingModalWaiting", { device: deviceName })}
        </h4>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
          {t("transactions.signingModalInstruction", { device: deviceName })}
        </p>

        <div className="mt-5 w-full rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] px-4 py-3 text-left">
          <div className="text-xs font-semibold text-[var(--muted)]">
            {t("transactions.signingModalAddress")}
          </div>
          <div className="mt-1 break-all font-mono text-sm font-semibold text-[var(--text)]">
            {signerAddress}
          </div>
        </div>

        <p className="mt-4 text-xs text-[var(--muted)]">
          {t("transactions.signingModalKeepOpen")}
        </p>
      </div>
    </Modal>
  );
};
