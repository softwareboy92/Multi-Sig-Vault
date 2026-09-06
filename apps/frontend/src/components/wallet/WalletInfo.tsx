import React from "react";
import { Card } from "../ui";
import { useTranslation } from "@/hooks/useTranslation";
import { copyToClipboard } from "@/utils/formatters";
import { useToastStore } from "@/stores/useToastStore";
import type { Wallet } from "@/types";

interface WalletInfoProps {
  wallet: Wallet;
  onCopy: () => void;
}

/**
 * Wallet basic information card
 * Displays wallet details with tags and address
 */
export const WalletInfo: React.FC<WalletInfoProps> = ({
  wallet,
  onCopy,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  const handleCopy = async () => {
    if (wallet.address) {
      const success = await copyToClipboard(wallet.address);
      if (success) {
        showToast(t("wallet.copiedToClipboard"), "success");
      }
    }
    onCopy();
  };

  return (
    <Card>
      {/* Wallet Address */}
      <div className="p-5 rounded-xl bg-[var(--row-head-bg)]">
        <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
          {t("wallet.address")}
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-sm break-all flex-1 text-[var(--text)]">
            {wallet.address || "-"}
          </div>
          <button
            onClick={handleCopy}
            className="p-2.5 hover:bg-[var(--row-head-bg)] rounded-lg transition-colors flex-shrink-0 border border-[var(--border)]"
            title={t("wallet.copyAddress")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
        {/* Badges */}
        {wallet.source === 'IMPORTED' && (
          <div className="mt-3">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
              {t('wallet.imported') || 'Imported'}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
};
