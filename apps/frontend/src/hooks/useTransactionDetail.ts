import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getBtcDecodedTx,
  getBtcExecution,
  getNetworks,
  getTransaction,
  getWallet,
} from "../api";
import { useTranslation } from "./useTranslation";
import { usePendingStore } from "../stores/usePendingStore";
import { TX_STATUS_VARIANT } from "../utils/status-variants";
import type {
  BtcDecodedTx,
  BtcExecution,
  Transaction,
  TransactionStatus,
  Wallet,
} from "../types";
import type { BadgeVariant } from "../components/ui";

export type TransactionDetailState = "loading" | "error" | "not-found" | "ready";

export interface UseTransactionDetailReturn {
  state: TransactionDetailState;
  error: string | null;
  transaction: Transaction | null;
  wallet: Wallet | null;
  btcExecution: BtcExecution | null;
  btcDecodedTx: BtcDecodedTx | null;
  btcNetwork: string | null;
  networkExplorerUrl: string | null;
  evmChainId: number | null;
  statusConfig: Record<TransactionStatus, { label: string; variant: BadgeVariant }>;
  signedSignerIds: Set<string>;
  broadcastCheckLoading: boolean;
  reload: () => Promise<void>;
  silentReload: () => Promise<void>;
  setTransaction: React.Dispatch<React.SetStateAction<Transaction | null>>;
}

import { getErrorMessage } from "../utils/errorUtils";

export function useTransactionDetail(
  id: string | undefined
): UseTransactionDetailReturn {
  const { t } = useTranslation();
  const { refreshToken } = usePendingStore();

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [state, setState] = useState<TransactionDetailState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [btcExecution, setBtcExecution] = useState<BtcExecution | null>(null);
  const [btcDecodedTx, setBtcDecodedTx] = useState<BtcDecodedTx | null>(null);
  const [btcNetwork, setBtcNetwork] = useState<string | null>(null);
  const [networkExplorerUrl, setNetworkExplorerUrl] = useState<string | null>(
    null
  );
  const [evmChainId, setEvmChainId] = useState<number | null>(null);
  const [broadcastCheckLoading, setBroadcastCheckLoading] = useState(false);

  const statusConfig = useMemo<
    Record<TransactionStatus, { label: string; variant: BadgeVariant }>
  >(
    () => ({
      PENDING_SIGN: {
        label: t("transactions.statusPendingSign"),
        variant: TX_STATUS_VARIANT.PENDING_SIGN ?? "warning",
      },
      PARTIALLY_SIGNED: {
        label: t("transactions.statusPartiallySigned"),
        variant: TX_STATUS_VARIANT.PARTIALLY_SIGNED ?? "warning",
      },
      SIGNED: {
        label: t("transactions.statusSigned"),
        variant: TX_STATUS_VARIANT.SIGNED ?? "info",
      },
      BROADCAST: {
        label: t("transactions.statusBroadcast"),
        variant: TX_STATUS_VARIANT.BROADCAST ?? "info",
      },
      PENDING_CONFIRMATION: {
        label: t("transactions.statusPendingConfirmation"),
        variant: TX_STATUS_VARIANT.PENDING_CONFIRMATION ?? "warning",
      },
      CONFIRMED: {
        label: t("transactions.statusConfirmed"),
        variant: TX_STATUS_VARIANT.CONFIRMED ?? "success",
      },
      FAILED: {
        label: t("transactions.statusFailed"),
        variant: TX_STATUS_VARIANT.FAILED ?? "danger",
      },
      CANCELLED: {
        label: t("transactions.statusCancelled"),
        variant: TX_STATUS_VARIANT.CANCELLED ?? "default",
      },
    }),
    [t]
  );

  const signedSignerIds = useMemo(
    () => new Set(transaction?.signatures.map((sig) => sig.signer_id) || []),
    [transaction?.signatures]
  );

  const fetchData = useCallback(
    async (silent = false) => {
      if (!id) return;
      try {
        if (!silent) {
          setState("loading");
          setError(null);
        }
        const txData = await getTransaction(id, false);
        setTransaction(txData);
        const walletData = await getWallet(txData.wallet_id);
        setWallet(walletData);

        // Resolve network info for explorer URL
        if (walletData.network_id) {
          const chainType =
            walletData.chain_type === "BTC" ? "BTC" : "EVM";
          getNetworks(chainType)
            .then((list) => {
              const net = (list || []).find(
                (n: any) => n.id === walletData.network_id
              );
              if (net) {
                setNetworkExplorerUrl(net.explorer_url ?? null);
                if (chainType === "BTC") {
                  setBtcNetwork(net.btc_network ?? null);
                } else {
                  setEvmChainId(net.chain_id ?? null);
                }
              }
            })
            .catch(() => {
              setNetworkExplorerUrl(null);
              setBtcNetwork(null);
              setEvmChainId(null);
            });
        }

        if (walletData.chain_type === "EVM") {
          setBtcExecution(null);
          setBtcDecodedTx(null);
        } else {
          // Load decoded tx for all BTC statuses (non-blocking)
          getBtcDecodedTx(id)
            .then((decoded) => setBtcDecodedTx(decoded))
            .catch(() => setBtcDecodedTx(null));

          if (["SIGNED"].includes(txData.status)) {
            try {
              setBtcExecution(await getBtcExecution(id));
            } catch {
              setBtcExecution(null);
            }
          } else {
            setBtcExecution(null);
          }
        }

        if (!silent) setState("ready");
      } catch (err) {
        if (!silent) {
          setError(getErrorMessage(err, t));
          setState("error");
        }
      }
    },
    [id, t]
  );

  // Broadcast readiness check for EVM Safe
  useEffect(() => {
    if (
      !id ||
      !transaction ||
      !wallet ||
      wallet.chain_type !== "EVM" ||
      transaction.safe_nonce == null
    )
      return;
    if (
      !["PENDING_SIGN", "PARTIALLY_SIGNED", "SIGNED"].includes(
        transaction.status
      )
    )
      return;
    setBroadcastCheckLoading(true);
    getTransaction(id, true)
      .then((freshTx) => {
        setTransaction((prev) =>
          prev
            ? {
                ...prev,
                can_broadcast: freshTx.can_broadcast,
                blocking_reason: freshTx.blocking_reason,
              }
            : prev
        );
      })
      .catch(() => {})
      .finally(() => setBroadcastCheckLoading(false));
  }, [id, transaction?.status, transaction?.signature_count, wallet?.chain_type]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (id) fetchData(true);
  }, [refreshToken]);

  return {
    state,
    error,
    transaction,
    wallet,
    btcExecution,
    btcDecodedTx,
    btcNetwork,
    networkExplorerUrl,
    evmChainId,
    statusConfig,
    signedSignerIds,
    broadcastCheckLoading,
    reload: () => fetchData(false),
    silentReload: () => fetchData(true),
    setTransaction,
  };
}
