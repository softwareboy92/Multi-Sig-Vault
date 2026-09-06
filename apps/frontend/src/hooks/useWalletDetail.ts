import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "./useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { getWalletChainLabel } from "../utils/wallet";
import {
  getNetworks,
  getWallet,
  getWalletAssets,
  getWalletTransactions,
  importToken as apiImportToken,
  syncWalletAssets,
} from "../api";
import type { Asset, Transaction, Wallet } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletDetailState = "loading" | "error" | "not-found" | "ready";

export interface UseWalletDetailReturn {
  state: WalletDetailState;
  error: string | null;

  wallet: Wallet | null;
  assets: Asset[];
  transactions: Transaction[];
  chainLabel: string;
  evmNetworks: Map<string, { name: string; chain_id: number | null; explorer_url: string | null; is_testnet: boolean }>;
  btcNetworks: Map<string, { network: string | null; name: string; explorer_url: string | null; is_testnet: boolean }>;

  reload: () => Promise<void>;
  syncAssets: () => Promise<void>;
  importToken: (contractAddress: string) => Promise<void>;
  isSyncing: boolean;

  isEvmPendingDeploy: boolean;
  statusLabelMap: Record<string, string>;
  setWallet: React.Dispatch<React.SetStateAction<Wallet | null>>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletDetail(id: string | undefined): UseWalletDetailReturn {
  const { t } = useTranslation();
  const { showToast, removeToast } = useToastStore();

  // Data
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [evmNetworks, setEvmNetworks] = useState<Map<string, { name: string; chain_id: number | null; explorer_url: string | null; is_testnet: boolean }>>(new Map());
  const [btcNetworks, setBtcNetworks] = useState<Map<string, { network: string | null; name: string; explorer_url: string | null; is_testnet: boolean }>>(new Map());

  // State
  const [state, setState] = useState<WalletDetailState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // ---------------------------------------------------------------------------
  // Network loading
  // ---------------------------------------------------------------------------
  const loadNetworks = useCallback(async () => {
    try {
      const [evmList, btcList] = await Promise.all([
        getNetworks("EVM"),
        getNetworks("BTC"),
      ]);
      const evmMap = new Map<string, { name: string; chain_id: number | null; explorer_url: string | null; is_testnet: boolean }>();
      (evmList || []).forEach((n) => evmMap.set(n.id, { name: n.name, chain_id: n.chain_id, explorer_url: n.explorer_url, is_testnet: n.is_testnet }));
      const btcMap = new Map<string, { network: string | null; name: string; explorer_url: string | null; is_testnet: boolean }>();
      (btcList || []).forEach((n) => btcMap.set(n.id, { network: n.btc_network, name: n.name, explorer_url: n.explorer_url, is_testnet: n.is_testnet }));
      setEvmNetworks(evmMap);
      setBtcNetworks(btcMap);
    } catch {
      setEvmNetworks(new Map());
      setBtcNetworks(new Map());
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Wallet + assets + transactions loading
  // ---------------------------------------------------------------------------
  const loadWallet = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!id) return;

    setState("loading");
    setError(null);
    try {
      const [walletData, assetsData, transactionsData] = await Promise.all([
        getWallet(id),
        getWalletAssets(id),
        getWalletTransactions(id),
      ]);

      if (signal?.cancelled) return;

      if (!walletData) {
        setState("not-found");
        return;
      }

      setWallet(walletData);
      setAssets(assetsData);
      setTransactions(transactionsData.items || []);
      setState("ready");
    } catch (err) {
      if (signal?.cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      // Detect 404 from API
      if (message.includes("404") || message.toLowerCase().includes("not found")) {
        setState("not-found");
      } else {
        setError(message);
        setState("error");
      }
    }
  }, [id]);

  // ---------------------------------------------------------------------------
  // Initial load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const signal = { cancelled: false };
    loadWallet(signal);
    loadNetworks();
    return () => { signal.cancelled = true; };
  }, [loadWallet, loadNetworks]);

  // ---------------------------------------------------------------------------
  // Sync assets
  // ---------------------------------------------------------------------------
  const syncAssets = useCallback(async () => {
    if (!id) return;
    setIsSyncing(true);
    const toastId = showToast(
      t("toast.syncingWalletAssets", { name: wallet?.name || t("wallet.assets") }),
      "info",
      0,
    );
    try {
      await syncWalletAssets(id);
      const [assetsData, walletData] = await Promise.all([
        getWalletAssets(id),
        getWallet(id),
      ]);
      setAssets(assetsData);
      setWallet(walletData);
      removeToast(toastId);
      showToast(t("toast.syncSuccess"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      removeToast(toastId);
      showToast(t("toast.syncFailed", { error: message }), "error");
    } finally {
      setIsSyncing(false);
    }
  }, [id, showToast, removeToast, t, wallet?.name]);

  // ---------------------------------------------------------------------------
  // Import token
  // ---------------------------------------------------------------------------
  const importTokenFn = useCallback(async (contractAddress: string) => {
    if (!id) return;
    await apiImportToken(id, contractAddress);
    const assetsData = await getWalletAssets(id);
    setAssets(assetsData);
  }, [id]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const chainLabel = useMemo(() => {
    if (!wallet) return "-";
    return getWalletChainLabel(
      wallet,
      evmNetworks as Map<string, { name: string }>,
      btcNetworks as Map<string, { btc_network?: string; network?: string }>,
    );
  }, [wallet, evmNetworks, btcNetworks]);

  const isEvmPendingDeploy = wallet?.chain_type === "EVM" && wallet.status === "PENDING_DEPLOY";

  const statusLabelMap: Record<string, string> = useMemo(() => ({
    ACTIVE: t("wallet.statusActive"),
    PENDING_DEPLOY: t("wallet.statusPendingDeploy"),
    ARCHIVED: t("wallet.statusArchived"),
  }), [t]);

  return {
    state,
    error,
    wallet,
    assets,
    transactions,
    chainLabel,
    evmNetworks,
    btcNetworks,
    reload: loadWallet,
    syncAssets,
    importToken: importTokenFn,
    isSyncing,
    isEvmPendingDeploy,
    statusLabelMap,
    setWallet,
  };
}
