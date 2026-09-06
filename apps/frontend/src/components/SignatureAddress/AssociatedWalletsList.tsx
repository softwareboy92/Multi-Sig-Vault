import React from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Card, EmptyState } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { SignerWalletBrief } from "../../types";

interface AssociatedWalletsListProps {
  wallets: SignerWalletBrief[];
}

export const AssociatedWalletsList: React.FC<AssociatedWalletsListProps> = ({
  wallets,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[var(--text)] mb-3">
        {t("signatureAddress.associatedWallets")}
        {wallets.length > 0 && (
          <span className="ml-1.5 text-[var(--muted)]">({wallets.length})</span>
        )}
      </h3>
      {wallets.length === 0 ? (
        <EmptyState title={t("signatureAddress.associatedWalletsEmpty")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {wallets.map((w) => (
            <button
              key={w.wallet_id}
              onClick={() => navigate(`/wallet/${w.wallet_id}`)}
              className="flex items-center justify-between gap-2 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent-3)] hover:bg-[var(--surface)] transition-colors text-left"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)] truncate">
                  {w.wallet_name}
                </div>
                <div className="text-xs text-[var(--muted)] flex items-center gap-1.5 mt-0.5">
                  {w.network_name}
                  {w.is_testnet && (
                    <Badge variant="warning" className="text-[10px]">
                      Testnet
                    </Badge>
                  )}
                </div>
              </div>
              <svg
                className="w-3.5 h-3.5 text-[var(--muted)] shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
};
