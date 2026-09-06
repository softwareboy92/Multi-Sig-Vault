import React from "react";
import { Badge, Card } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { formatBalance, getDisplaySymbol } from "../../utils/format";
import { formatAbsoluteTime } from "../../utils/time";
import { truncateAddress } from "../../utils/address";
import { useTranslation } from "../../hooks/useTranslation";
import { useTimezone } from "../../hooks/useTimezone";
import type { Transaction, TransactionStatus, Wallet } from "../../types";
import type { BadgeVariant } from "../ui";

interface TransactionSummaryCardProps {
  transaction: Transaction;
  wallet: Wallet;
  statusConfig: Record<TransactionStatus, { label: string; variant: BadgeVariant }>;
  evmChainId?: number | null;
}

const AddressNode: React.FC<{
  label: string;
  name?: string;
  address: string;
  accent?: boolean;
}> = ({ label, name, address, accent }) => (
  <div className="flex min-w-0 items-center gap-3">
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--field-radius)] border ${
        accent
          ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
      }`}
      aria-hidden="true"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z" />
      </svg>
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</div>
      {name && <div className="mt-0.5 truncate text-sm font-bold text-[var(--text)]">{name}</div>}
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-xs text-[var(--muted)]" title={address}>
          {address ? truncateAddress(address, 10, 8) : "-"}
        </span>
        {address && <CopyButton value={address} toast={false} />}
      </div>
    </div>
  </div>
);

export const TransactionSummaryCard: React.FC<TransactionSummaryCardProps> = ({
  transaction,
  wallet,
  statusConfig,
  evmChainId,
}) => {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();
  const statusInfo = statusConfig[transaction.status];
  const isIncoming =
    transaction.direction === "INCOMING" || transaction.extra?.direction === "IN";
  const fromAddress = isIncoming
    ? transaction.from_address || String(transaction.extra?.from_address || "")
    : wallet.address || "";
  const toAddress = isIncoming ? wallet.address || transaction.to_address : transaction.to_address;
  const assetSymbol = getDisplaySymbol(
    transaction.token_symbol,
    wallet.chain_type,
    evmChainId,
  );
  const feeSymbol = getDisplaySymbol(null, wallet.chain_type, evmChainId);
  const hasFee = transaction.fee_amount != null && Number(transaction.fee_amount) > 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-[var(--card-padding)] py-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-[var(--field-radius)] ${isIncoming ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>
            <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isIncoming ? <><path d="M17 7 7 17" /><path d="M17 17H7V7" /></> : <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>}
            </svg>
          </div>
          <div>
            <div className="text-sm font-extrabold text-[var(--text)]">
              {isIncoming ? t("wallet.receive") : t("wallet.send")}
            </div>
            <div className="text-xs text-[var(--muted)]">{wallet.name}</div>
          </div>
        </div>
        <Badge variant={statusInfo.variant} dot>{statusInfo.label}</Badge>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,1.1fr)]">
        <section className="relative flex min-h-[15rem] flex-col items-center justify-center overflow-hidden border-b border-[var(--border)] px-6 py-8 text-center lg:border-b-0 lg:border-r">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--accent)_9%,transparent),transparent_62%)]" />
          <div className="relative text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
            {t("transactions.amountLabel")}
          </div>
          <div className="relative mt-3 flex max-w-full items-baseline justify-center gap-2">
            <span className="break-all text-[clamp(2.35rem,4.2vw,4.5rem)] font-black leading-none tracking-[-0.045em] text-[var(--text)]">
              {formatBalance(transaction.amount, transaction.token_decimals ?? 18, 8)}
            </span>
            <span className="text-[clamp(1rem,1.3vw,1.35rem)] font-extrabold text-[var(--accent)]">
              {assetSymbol}
            </span>
          </div>

          {hasFee && (
            <div className="relative mt-6 inline-flex items-center gap-3 rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
              <span className="text-xs font-semibold text-[var(--muted)]">{t("transactions.feePaid")}</span>
              <span className="font-mono text-sm font-bold text-[var(--text)]">
                {formatBalance(transaction.fee_amount!, 18, 8)} {feeSymbol}
              </span>
            </div>
          )}
        </section>

        <section className="flex min-h-[15rem] flex-col justify-center p-[clamp(1.25rem,2.4vw,2rem)]">
          <AddressNode
            label={t("common.sender")}
            name={isIncoming ? undefined : wallet.name}
            address={fromAddress}
          />
          <div className="ml-5 flex h-10 items-center border-l border-dashed border-[var(--border)] pl-5 text-[var(--accent)]" aria-hidden="true">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m8 10 4 4 4-4" />
            </svg>
          </div>
          <AddressNode
            label={t("transactions.recipient")}
            name={isIncoming ? wallet.name : undefined}
            address={toAddress}
            accent
          />
          <div className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
            {formatAbsoluteTime(transaction.confirmed_at || transaction.created_at, language, timeZone)}
          </div>
        </section>
      </div>
    </Card>
  );
};
