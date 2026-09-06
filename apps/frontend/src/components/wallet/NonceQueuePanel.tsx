import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Card, EmptyState, ListSkeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui";
import { useTranslation } from "@/hooks/useTranslation";
import { formatRelativeTime } from "@/utils/time";
import { TX_STATUS_VARIANT } from "@/utils/status-variants";
import { truncateAddress } from "@/utils/address";
import { getWalletNonceQueue } from "@/api/wallets";
import type { NonceQueueInfo, Wallet } from "@/types";

interface NonceQueuePanelProps {
  wallet: Wallet;
}

/**
 * Nonce Queue Panel Component
 * Displays Safe wallet nonce queue status and pending transactions
 * Only shown for EVM Safe wallets
 */
export const NonceQueuePanel: React.FC<NonceQueuePanelProps> = ({ wallet }) => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [queueInfo, setQueueInfo] = useState<NonceQueueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only show for EVM Safe wallets
  if (wallet.chain_type !== "EVM") {
    return null;
  }

  useEffect(() => {
    let mounted = true;

    const fetchNonceQueue = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getWalletNonceQueue(wallet.id);
        if (mounted) {
          setQueueInfo(data);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load nonce queue");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchNonceQueue();

    return () => {
      mounted = false;
    };
  }, [wallet.id]);

  const statusConfig: Record<
    string,
    { label: string; variant: "default" | "success" | "warning" | "danger" | "info" }
  > = {
    PENDING_SIGN: { label: t("transactions.statusPendingSign"), variant: TX_STATUS_VARIANT.PENDING_SIGN ?? "warning" },
    PARTIALLY_SIGNED: { label: t("transactions.statusPartiallySigned"), variant: TX_STATUS_VARIANT.PARTIALLY_SIGNED ?? "warning" },
    SIGNED: { label: t("transactions.statusSigned"), variant: TX_STATUS_VARIANT.SIGNED ?? "info" },
    BROADCAST: { label: t("transactions.statusBroadcast"), variant: TX_STATUS_VARIANT.BROADCAST ?? "info" },
    PENDING_CONFIRMATION: { label: t("transactions.statusPendingConfirmation"), variant: TX_STATUS_VARIANT.PENDING_CONFIRMATION ?? "warning" },
    CONFIRMED: { label: t("transactions.statusConfirmed"), variant: TX_STATUS_VARIANT.CONFIRMED ?? "success" },
    FAILED: { label: t("transactions.statusFailed"), variant: TX_STATUS_VARIANT.FAILED ?? "danger" },
    CANCELLED: { label: t("transactions.statusCancelled"), variant: TX_STATUS_VARIANT.CANCELLED ?? "default" },
  };

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold">Nonce Queue</h3>
        </div>
        <ListSkeleton rows={3} />
      </Card>
    );
  }

  if (error || !queueInfo) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold">Nonce Queue</h3>
        </div>
        <EmptyState title={error || "Failed to load queue info"} />
      </Card>
    );
  }

  const { on_chain_nonce, next_allocatable_nonce, pending_transactions } = queueInfo;
  const queueDepth = pending_transactions.length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-extrabold">Safe Nonce Queue</h3>
        <Badge variant={queueDepth > 0 ? "warning" : "success"}>
          {queueDepth} Pending
        </Badge>
      </div>

      {/* Nonce status summary */}
      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-[var(--surface)] rounded-lg">
        <div>
          <div className="text-sm text-[var(--muted)] mb-1">On-chain Nonce</div>
          <div className="text-2xl font-bold">{on_chain_nonce}</div>
        </div>
        <div>
          <div className="text-sm text-[var(--muted)] mb-1">Next Allocatable</div>
          <div className="text-2xl font-bold">{next_allocatable_nonce}</div>
        </div>
        <div>
          <div className="text-sm text-[var(--muted)] mb-1">Queue Depth</div>
          <div className="text-2xl font-bold">{queueDepth}</div>
        </div>
      </div>

      {/* Pending transactions table */}
      {pending_transactions.length === 0 ? (
        <EmptyState 
          title="No pending transactions" 
          description="All transactions are confirmed"
        />
      ) : (
        <div className="overflow-x-auto">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[10%]">Nonce</TableHead>
                <TableHead className="w-[25%]">To Address</TableHead>
                <TableHead className="w-[15%]">Amount</TableHead>
                <TableHead className="w-[15%]">Status</TableHead>
                <TableHead className="w-[18%]">Can Broadcast</TableHead>
                <TableHead className="w-[17%]">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending_transactions.map((tx) => {
                const config = statusConfig[tx.status] || statusConfig.PENDING_SIGN;
                return (
                  <TableRow
                    key={tx.id}
                    onClick={() => navigate(`/transactions/${tx.id}`)}
                  >
                    <TableCell>
                      <span className="font-mono font-semibold">{tx.safe_nonce}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-[var(--muted)]">{truncateAddress(tx.to_address)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono font-medium">{tx.amount}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {tx.can_broadcast ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <Badge variant="warning">Blocked</Badge>
                          {tx.blocking_reason && (
                            <span className="text-xs text-[var(--muted)]">{tx.blocking_reason}</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-[var(--muted)]">
                        {formatRelativeTime(tx.created_at, language)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Info notice */}
      <div className="mt-4 p-3 bg-[var(--info)]/10 border border-[var(--info)]/20 rounded-lg">
        <p className="text-sm text-[var(--info)]">
          <strong>Note:</strong> Safe contracts require transactions to execute in nonce order. 
          Only the transaction with the lowest pending nonce can be broadcast.
        </p>
      </div>
    </Card>
  );
};
