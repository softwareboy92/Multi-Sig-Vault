import React, { memo, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "@/hooks/useTranslation";
import { useTimezone } from "@/hooks/useTimezone";
import { formatBalance, getDisplaySymbol } from "@/utils/format";
import { formatAbsoluteTime } from "@/utils/time";
import { TX_STATUS_VARIANT, TX_STATUS_DOT } from "@/utils/status-variants";
import { truncateAddress } from "@/utils/address";
import { getExplorerUrl } from "@/utils/formatters";
import { getPolicyActionLabel } from "@/utils/policy";
import type { Transaction, Wallet } from "@/types";

// ---------------------------------------------------------------------------
// Row component (memoized)
// ---------------------------------------------------------------------------

interface WalletTransactionRowProps {
  tx: Transaction;
  walletAddress?: string | null;
  walletChainType: string;
  walletNetworkId?: string | null;
  btcNetworks: Map<string, { network: string | null; name: string }>;
  networkExplorerUrl?: string | null;
  statusLabelMap: Record<string, string>;
}

const WalletTransactionRow = memo(function WalletTransactionRow({
  tx,
  walletAddress,
  walletChainType,
  walletNetworkId,
  btcNetworks,
  networkExplorerUrl,
  statusLabelMap,
}: WalletTransactionRowProps) {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();
  const navigate = useNavigate();

  const direction: "INCOMING" | "OUTGOING" = (() => {
    if (tx.direction) return tx.direction;
    if (walletAddress && tx.to_address === walletAddress) return "INCOMING";
    return "OUTGOING";
  })();

  const isCancellation = tx.tx_type === "CANCELLATION";
  const isPolicyChange = tx.tx_type === "SAFE_POLICY_CHANGE";
  const symbol = getDisplaySymbol(tx.token_symbol, walletChainType);
  const displayAmount = isCancellation || isPolicyChange
    ? "-"
    : `${formatBalance(tx.amount, tx.token_decimals ?? 18, 8)} ${symbol}`;
  const variant = TX_STATUS_VARIANT[tx.status] || "default";
  const label = statusLabelMap[tx.status] || tx.status;
  const showDot = TX_STATUS_DOT.has(tx.status);
  const btcEntry = walletNetworkId ? btcNetworks.get(walletNetworkId) : undefined;
  const explorerUrl = tx.tx_hash
    ? getExplorerUrl(tx.tx_hash, walletChainType, btcEntry?.network, networkExplorerUrl)
    : "";

  return (
    <TableRow
      className={`hover:bg-[var(--row-head-bg)] transition-colors cursor-pointer ${
        isCancellation ? "border-l-4 border-l-[var(--warning)]" : isPolicyChange ? "border-l-4 border-l-[var(--info)]" : ""
      }`}
      onClick={() => navigate(`/transactions/${tx.id}`)}
    >
      {/* Direction */}
      <TableCell>
        {isCancellation ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="warning">{t("transactions.cancellationTransaction")}</Badge>
            <span className="text-xs text-[var(--muted)]">Nonce {tx.safe_nonce}</span>
          </div>
        ) : isPolicyChange ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="info">{t("transactions.policyChangeTransaction")}</Badge>
            {tx.safe_nonce != null && (
              <span className="text-xs text-[var(--muted)]">Nonce {tx.safe_nonce}</span>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1 font-semibold">
            {direction === "OUTGOING" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--danger)] shrink-0"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--success)] shrink-0"><path d="M17 7L7 17"/><path d="M17 17H7V7"/></svg>
            )}
            {direction === "OUTGOING" ? t("wallet.send") : t("wallet.receive")}
          </span>
        )}
      </TableCell>

      {/* From / To */}
      <TableCell>
        {isPolicyChange ? (
          <span className="text-xs text-[var(--text)]">
            {getPolicyActionLabel(tx.extra?.policy_action as string, t)}
          </span>
        ) : direction === "OUTGOING" && tx.to_address ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs text-[var(--muted)] truncate" title={tx.to_address}>
              {truncateAddress(tx.to_address)}
            </span>
            <CopyButton value={tx.to_address} stopPropagation />
          </div>
        ) : (
          <span className="text-[var(--muted)]">-</span>
        )}
      </TableCell>

      {/* Amount */}
      <TableCell>
        {isCancellation || isPolicyChange ? (
          <span className="text-[var(--muted)]">-</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-medium">
              {displayAmount}
            </span>
          </div>
        )}
      </TableCell>

      {/* Status */}
      <TableCell align="center">
        <Badge variant={variant} dot={showDot}>
          {label}
        </Badge>
      </TableCell>

      {/* Time + tx_hash */}
      <TableCell align="right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-xs text-[var(--muted)]" title={tx.confirmed_at || tx.created_at}>
            {formatAbsoluteTime(tx.confirmed_at || tx.created_at, language, timeZone)}
          </span>
          {tx.tx_hash ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-[var(--accent)] hover:underline"
              onClick={(e) => e.stopPropagation()}
              title={tx.tx_hash}
            >
              {truncateAddress(tx.tx_hash, 4, 4)}
            </a>
          ) : (
            <span className="font-mono text-xs text-[var(--muted)]">-</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WalletTransactionTableProps {
  walletId: string;
  wallet: Wallet;
  transactions: Transaction[];
  btcNetworks: Map<string, { network: string | null; name: string }>;
  networkExplorerUrl?: string | null;
  maxDisplay?: number;
}

/**
 * Transaction table for wallet detail page.
 * 5 columns aligned with global /transactions:
 *   Direction | From/To | Amount | Status | Time (dual-row with tx_hash)
 */
export const WalletTransactionTable: React.FC<WalletTransactionTableProps> = ({
  walletId,
  wallet,
  transactions,
  btcNetworks,
  networkExplorerUrl,
  maxDisplay = 10,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const statusLabelMap: Record<string, string> = useMemo(
    () => ({
      PENDING_SIGN: t("transactions.statusPendingSign"),
      PARTIALLY_SIGNED: t("transactions.statusPartiallySigned"),
      SIGNED: t("transactions.statusSigned"),
      BROADCAST: t("transactions.statusBroadcast"),
      PENDING_CONFIRMATION: t("transactions.statusPendingConfirmation"),
      CONFIRMED: t("transactions.statusConfirmed"),
      FAILED: t("transactions.statusFailed"),
      CANCELLED: t("transactions.statusCancelled"),
    }),
    [t],
  );

  const displayTxs = transactions.slice(0, maxDisplay);
  const showViewAll = transactions.length > maxDisplay;



  return (
    <Card>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 min-h-[44px] gap-3">
        <h3 className="text-lg font-extrabold">{t("wallet.recentTransactions")}</h3>
        <div className="flex items-center gap-3">
          {showViewAll && (
            <Button
              variant="ghost"
              onClick={() => navigate(`/wallet/${walletId}/transactions`)}
            >
              {t("common.viewAll")}
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {transactions.length === 0 ? (
        <EmptyState title={t("common.noData")} />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[16%]">{t("history.transaction")}</TableHead>
              <TableHead className="w-[26%]">{t("history.toFrom")}</TableHead>
              <TableHead className="w-[21%]">{t("history.amount")}</TableHead>
              <TableHead align="center" className="w-[16%]">{t("tableHeaders.status")}</TableHead>
              <TableHead align="right" className="w-[21%]">{t("history.time")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayTxs.map((tx) => {
              return (
                <WalletTransactionRow
                  key={tx.id}
                  tx={tx}
                  walletAddress={wallet.address}
                  walletChainType={wallet.chain_type}
                  walletNetworkId={wallet.network_id}
                  btcNetworks={btcNetworks}
                  networkExplorerUrl={networkExplorerUrl}
                  statusLabelMap={statusLabelMap}
                />
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Footer view all */}
      {showViewAll && transactions.length > 0 && (
        <div className="mt-4 text-center border-t border-[var(--border)] pt-4">
          <Button
            variant="ghost"
            className="text-sm"
            onClick={() => navigate(`/wallet/${walletId}/transactions`)}
          >
            {t("common.viewAll")} ({transactions.length})
          </Button>
        </div>
      )}
    </Card>
  );
};
