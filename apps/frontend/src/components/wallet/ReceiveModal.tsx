import React from "react";
import { Modal, QRCode } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../stores/useToastStore";
import type { Wallet } from "../../types";

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: Wallet | null;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  wallet,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  const chainName =
    wallet?.chain_type === "EVM"
      ? t("common.ethereum")
      : t("common.bitcoin");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("wallet.receive")}
      showCloseButton
    >
      <div className="flex flex-col gap-5">
        <div className="notice-warn flex items-center gap-3 rounded-2xl px-4 py-3">
          <div className="notice-warn-icon w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold">
            !
          </div>
          <div className="text-sm font-semibold">
            {t("wallet.receiveNotice", { chain: chainName })}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="w-[180px] h-[180px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center">
            {wallet?.address ? (
              <QRCode value={wallet.address} size={150} />
            ) : (
              <div className="text-sm text-[var(--muted)]">QR</div>
            )}
          </div>
          <div className="text-sm font-semibold">
            {t("wallet.receiveAddressTitle", {
              name: wallet?.name || "-",
            })}
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 rounded-2xl bg-[var(--row-head-bg)] px-4 py-3">
          <div className="text-xs text-[var(--text)] font-mono break-all">
            {wallet?.address ? (
              <>
                <span className="text-[var(--accent)] font-semibold">
                  <span className="text-sm font-bold">
                    {wallet.address.slice(0, 6).toUpperCase()}
                  </span>
                </span>
                <span className="text-[var(--muted)]">
                  {wallet.address.slice(6, -4)}
                </span>
                <span className="text-[var(--accent)] font-semibold">
                  <span className="text-sm font-bold">
                    {wallet.address.slice(-4).toUpperCase()}
                  </span>
                </span>
              </>
            ) : (
              "-"
            )}
          </div>
          <button
            type="button"
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[var(--row-head-bg)] transition-colors"
            onClick={() => {
              if (wallet?.address) {
                navigator.clipboard.writeText(wallet.address);
                showToast(t("toast.copySuccess"), "success");
              }
            }}
            aria-label={t("common.copy")}
            title={t("common.copy")}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 refresh-icon" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h9a2 2 0 012 2v9a2 2 0 01-2 2H10a2 2 0 01-2-2v-9a2 2 0 012-2z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V7a2 2 0 00-2-2H7a2 2 0 00-2 2v7a2 2 0 002 2h1" />
            </svg>
          </button>
        </div>
      </div>
    </Modal>
  );
};
