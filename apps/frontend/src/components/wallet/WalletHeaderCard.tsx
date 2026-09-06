import React from "react";
import { Button, Card, Dropdown, DropdownItem } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { InlineEditName } from "./InlineEditName";
import { ChainBadge, ThresholdBadge, WalletStatusBadge } from "./WalletStatusBadge";
import { useTranslation } from "../../hooks/useTranslation";
import { truncateAddress } from "../../utils/address";
import type { Asset, Wallet } from "../../types";

interface WalletHeaderCardProps {
  wallet: Wallet;
  walletId: string;
  assets: Asset[];
  chainLabel: string;
  statusLabelMap: Record<string, string>;
  networkExplorerUrl: string | null;
  onRenamed: (updated: Wallet) => void;
  transactionCount: number;
  sendDisabled: boolean;
  isPendingDeploy: boolean;
  onSend: () => void;
  onReceive: () => void;
  onDeploy: () => void;
  onArchive?: () => void;
  onActivate?: () => void;
  onDelete: () => void;
}

const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
}> = ({ label, value, hint }) => (
  <div className="relative min-w-0 overflow-hidden rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
    <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent)]" aria-hidden="true" />
    <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
    <div className="mt-1.5 truncate text-xl font-bold tracking-tight text-[var(--text)]">{value}</div>
    {hint && <div className="mt-1 truncate text-[11px] text-[var(--muted)]">{hint}</div>}
  </div>
);

export const WalletHeaderCard: React.FC<WalletHeaderCardProps> = ({
  wallet,
  walletId,
  assets,
  chainLabel,
  statusLabelMap,
  networkExplorerUrl,
  onRenamed,
  transactionCount,
  sendDisabled,
  isPendingDeploy,
  onSend,
  onReceive,
  onDeploy,
  onArchive,
  onActivate,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <Card className="overflow-visible p-0">
      <div className="h-px rounded-t-[var(--radius-card)] bg-[var(--wallet-primary)]" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-4">
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-[var(--field-radius)] border border-[color-mix(in_srgb,var(--wallet-primary)_35%,transparent)] bg-[var(--wallet-primary-soft)] text-[var(--wallet-primary)] sm:flex" aria-hidden="true">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M16 10h5v4h-5a2 2 0 0 1 0-4Z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                  {t("wallet.details")}
                </div>
                <InlineEditName
                  walletId={walletId}
                  currentName={wallet.name}
                  onRenamed={onRenamed}
                  className="min-w-0"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <WalletStatusBadge
                    status={wallet.status}
                    label={statusLabelMap[wallet.status] || wallet.status}
                  />
                  <ChainBadge chainType={wallet.chain_type} chainLabel={chainLabel} />
                  <ThresholdBadge threshold={wallet.threshold} signerCount={wallet.signer_count} />
                </div>
              </div>
            </div>

            <div className="mt-5 flex min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] px-3 py-2.5 text-xs text-[var(--muted)]">
              <span className="shrink-0 font-medium text-[var(--text)]">{t("wallet.address")}</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={wallet.address || undefined}>
                {wallet.address ? truncateAddress(wallet.address, 14, 12) : t("wallet.statusPendingDeploy")}
              </span>
              {wallet.address && <CopyButton value={wallet.address} />}
              {wallet.address && networkExplorerUrl && (
                <a
                  href={`${networkExplorerUrl}/address/${wallet.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--wallet-primary)]"
                  aria-label="Explorer"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6" /><path d="m10 14 11-11" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                </a>
              )}
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[360px] xl:items-end">
            <div className="flex w-full flex-wrap gap-2 xl:justify-end">
              {isPendingDeploy ? (
                <Button variant="primary" onClick={onDeploy} className="min-w-[112px] justify-center">
                  {t("wallet.deploy")}
                </Button>
              ) : (
                <>
                  <Button variant="primary" onClick={onSend} disabled={sendDisabled} className="min-w-[112px] justify-center">
                    {t("wallet.send")}
                  </Button>
                  <Button variant="secondary" onClick={onReceive} disabled={!wallet.address} className="min-w-[112px] justify-center">
                    {t("wallet.receive")}
                  </Button>
                </>
              )}
              <Dropdown
                trigger={
                  <button className="inline-flex min-h-11 min-w-[112px] items-center justify-center rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--row-head-bg)]">
                    {t("common.more")}
                  </button>
                }
                align="right"
              >
                {onArchive && <DropdownItem onClick={onArchive}>{t("wallet.archive")}</DropdownItem>}
                {onActivate && <DropdownItem onClick={onActivate}>{t("wallet.activate")}</DropdownItem>}
                <DropdownItem onClick={onDelete}>
                  <span className="text-[var(--danger)]">{t("common.delete")}</span>
                </DropdownItem>
              </Dropdown>
            </div>
            <div className="text-xs text-[var(--muted)]">
              {isPendingDeploy ? t("wallet.statusPendingDeploy") : chainLabel}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={t("wallet.assets")}
            value={assets.length}
            hint={chainLabel}
          />
          <Stat
            label={t("wallet.deploySigners")}
            value={`${wallet.verified_signer_count ?? 0}/${wallet.signer_count}`}
            hint={`${wallet.threshold}/${wallet.signer_count}`}
          />
          <Stat
            label={t("wallet.tabTransactions")}
            value={isPendingDeploy ? "--" : transactionCount}
            hint={statusLabelMap[wallet.status] || wallet.status}
          />
        </div>
      </div>
    </Card>
  );
};
