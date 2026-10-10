import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  PageShell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import { CopyButton } from "../components/ui/CopyButton";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { getWallets, getWalletAssets, getNetworks } from "../api";
import { formatBalance, sumBigIntBalances } from "../utils/format";
import { truncateAddress } from "../utils/address";
import { formatRelativeTime } from "../utils/time";
import { getWalletChainLabel, isWalletTestnet } from "../utils/wallet";
import type { Asset } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletHolding {
  wallet_id: string;
  wallet_name: string;
  balance: string;
  last_synced_at: string | null;
}

interface AssetSummary {
  symbol: string;
  is_native: boolean;
  token_address: string | null;
  decimals: number;
  chain_type: "BTC" | "EVM";
  chain_label: string;
  total_balance: string;
  wallets: WalletHolding[];
  all_testnet: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AssetDetailPage: React.FC = () => {
  const { groupKey: rawGroupKey } = useParams<{ groupKey: string }>();
  const groupKey = rawGroupKey ? decodeURIComponent(rawGroupKey) : "";
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { showTestnets } = usePreferenceStore();

  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parse groupKey → (chainType, networkId, tokenAddress, symbol).
  // The old three-part URLs remain readable for existing bookmarks.
  const parsed = useMemo(() => {
    if (!groupKey) return null;
    const parts = groupKey.split(":");
    if (parts.length < 3) return null;
    const chainType = parts[0] as "BTC" | "EVM";
    const hasNetwork = parts.length >= 4;
    const networkId = hasNetwork ? parts[1] : null;
    const tokenPart = parts[hasNetwork ? 2 : 1];
    const tokenAddress = tokenPart === "native" ? null : tokenPart;
    const symbol = parts.slice(hasNetwork ? 3 : 2).join(":"); // symbol may contain ":"
    return { chainType, networkId, tokenAddress, symbol };
  }, [groupKey]);

  const loadData = useCallback(async () => {
    if (!parsed) {
      setError("Invalid asset key");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [walletsResponse, evmNetworks, btcNetworks] = await Promise.all([
        getWallets({ page: 1, pageSize: 100 }),
        getNetworks("EVM"),
        getNetworks("BTC"),
      ]);
      const remainingWalletPages = walletsResponse.total_pages > 1
        ? await Promise.all(
            Array.from({ length: walletsResponse.total_pages - 1 }, (_, index) =>
              getWallets({ page: index + 2, pageSize: 100 }),
            ),
          )
        : [];
      const allWallets = [
        ...walletsResponse.items,
        ...remainingWalletPages.flatMap((page) => page.items),
      ];

      const evmMap = new Map<string, { name: string; is_testnet: boolean }>();
      const btcMap = new Map<string, { btc_network: string | undefined; is_testnet: boolean }>();
      (evmNetworks || []).forEach((n) => evmMap.set(n.id, { name: n.name, is_testnet: n.is_testnet }));
      (btcNetworks || []).forEach((n) =>
        btcMap.set(n.id, { btc_network: n.btc_network ?? undefined, is_testnet: n.is_testnet })
      );

      const walletsData = showTestnets
        ? allWallets
        : allWallets.filter(
            (wallet) => !isWalletTestnet(wallet, evmMap, btcMap),
          );

      const holdings: WalletHolding[] = [];
      let matchedAsset: Asset | null = null;
      let chainLabel = "";
      let hasMainnetWallet = false;

      await Promise.all(
        walletsData
          .filter((w) => w.chain_type === parsed.chainType && (!parsed.networkId || w.network_id === parsed.networkId))
          .map(async (wallet) => {
            try {
              const assets = await getWalletAssets(wallet.id);
              const label = getWalletChainLabel(wallet, evmMap, btcMap);
              const isTestnet = wallet.chain_type === "EVM"
                ? evmMap.get(wallet.network_id)?.is_testnet ?? false
                : btcMap.get(wallet.network_id)?.is_testnet ?? false;

              for (const asset of assets) {
                const addressMatch = parsed.tokenAddress
                  ? asset.token_address?.toLowerCase() ===
                    parsed.tokenAddress.toLowerCase()
                  : asset.token_address === null;
                const symbolMatch =
                  asset.symbol.toLowerCase() === parsed.symbol.toLowerCase();

                if (addressMatch && symbolMatch) {
                  holdings.push({
                    wallet_id: wallet.id,
                    wallet_name: wallet.name,
                    balance: asset.balance,
                    last_synced_at: asset.last_synced_at,
                  });
                  if (!isTestnet) hasMainnetWallet = true;
                  if (!matchedAsset) {
                    matchedAsset = asset;
                    chainLabel = label;
                  }
                  // Prefer longer (more descriptive) chain label
                  if (label.length > chainLabel.length) {
                    chainLabel = label;
                  }
                }
              }
            } catch {
              // skip failed wallet
            }
          })
      );

      if (!matchedAsset || holdings.length === 0) {
        setError(t("common.noData"));
        setLoading(false);
        return;
      }

      // Sort by balance descending
      holdings.sort((a, b) => {
        try {
          const diff = BigInt(b.balance || "0") - BigInt(a.balance || "0");
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        } catch {
          return 0;
        }
      });

      const asset = matchedAsset as Asset;
      setSummary({
        symbol: asset.symbol,
        is_native: asset.is_native,
        token_address: asset.token_address,
        decimals: asset.decimals,
        chain_type: parsed.chainType,
        chain_label: chainLabel,
        total_balance: sumBigIntBalances(holdings.map((h) => h.balance)),
        wallets: holdings,
        all_testnet: !hasMainnetWallet,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("common.error");
      setError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [parsed, t, showToast, showTestnets]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Breadcrumbs ---
  const breadcrumbs = (
    <Breadcrumb
      items={[
        { label: t("nav.dashboard"), href: "/dashboard" },
        {
          label: summary
            ? t("assets.assetOnChain", {
                symbol: summary.symbol,
                chain: summary.chain_label,
              })
            : t("assets.assetDetail"),
        },
      ]}
    />
  );

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <PageShell title={t("assets.assetDetail")} breadcrumbs={breadcrumbs}>
        <Card>
          <div className="space-y-4 py-6">
            <span className="inline-block w-48 h-6 rounded bg-[var(--row-head-bg)] animate-pulse" />
            <span className="inline-block w-36 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
            <span className="inline-block w-64 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
          </div>
        </Card>
        <Card>
          <div className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <span className="inline-block w-32 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                <span className="inline-block w-24 h-4 rounded bg-[var(--row-head-bg)] animate-pulse flex-1" />
                <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
              </div>
            ))}
          </div>
        </Card>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Error
  // ---------------------------------------------------------------------------
  if (error || !summary) {
    return (
      <PageShell title={t("assets.assetDetail")} breadcrumbs={breadcrumbs}>
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">
            {error || t("common.noData")}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => loadData()}>
              {t("common.retry")}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/dashboard")}>
              {t("nav.dashboard")}
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  const dotColor =
    summary.chain_type === "BTC"
      ? "bg-[var(--warning)]"
      : "bg-[var(--accent-3)]";
  const displayTotal = formatBalance(
    summary.total_balance,
    summary.decimals,
    8
  );

  return (
    <PageShell title={t("assets.assetDetail")} breadcrumbs={breadcrumbs}>
      {/* --- Overview card --- */}
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="title-h2 text-[var(--text)]">
              {summary.symbol}
            </span>
            <Badge variant={summary.is_native ? "default" : "info"}>
              {summary.is_native
                ? summary.chain_type === "BTC"
                  ? "BTC"
                  : "ETH"
                : summary.chain_type === "EVM"
                  ? "ERC-20"
                  : "Token"}
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {/* Chain */}
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">
                {t("tableHeaders.chain")}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                />
                <span className="text-sm font-semibold text-[var(--text)]">
                  {summary.chain_label}
                </span>
              </div>
            </div>

            {/* Total balance */}
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">
                {t("assets.totalBalance")}
              </div>
              <span className="font-mono text-sm font-bold text-[var(--text)]">
                {displayTotal} {summary.symbol}
              </span>
            </div>

            {/* Wallets */}
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">
                {t("assets.holdingWallets")}
              </div>
              <span className="text-sm font-semibold text-[var(--text)]">
                {t("assets.walletCount", {
                  count: String(summary.wallets.length),
                })}
              </span>
            </div>

            {/* Contract address */}
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">
                {t("assets.contractAddress")}
              </div>
              {summary.token_address ? (
                <div className="flex items-center gap-1">
                  <span
                    className="font-mono text-xs text-[var(--text)]"
                    title={summary.token_address}
                  >
                    {truncateAddress(summary.token_address)}
                  </span>
                  <CopyButton value={summary.token_address} />
                </div>
              ) : (
                <span className="text-sm text-[var(--muted)]">
                  {t("assets.nativeToken")}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* --- Wallet breakdown table --- */}
      <Card>
        <div className="mb-4">
          <span className="title-h3 text-[var(--text)]">
            {t("assets.walletBreakdown")}
          </span>
        </div>

        {/* Bar chart for wallet distribution */}


        {summary.wallets.length === 0 ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[35%]">
                  {t("assets.walletName")}
                </TableHead>
                <TableHead align="right" className="w-[30%]">
                  {t("wallet.balance")}
                </TableHead>
                <TableHead className="w-[20%]">
                  {t("assets.lastSynced")}
                </TableHead>
                <TableHead align="center" className="w-[15%]">
                  {t("tableHeaders.action")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.wallets.map((w) => {
                const displayBalance = formatBalance(
                  w.balance,
                  summary.decimals,
                  8
                );
                return (
                  <TableRow
                    key={w.wallet_id}
                    className="group"
                  >
                    <TableCell>
                      <span className="font-semibold">
                        {w.wallet_name}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-mono">
                        {displayBalance}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-[var(--muted)]">
                        {w.last_synced_at
                          ? formatRelativeTime(w.last_synced_at, language)
                          : "-"}
                      </span>
                    </TableCell>
                    <TableCell align="center">
                      <button
                        type="button"
                        className="px-3 py-1 rounded-md text-xs font-medium text-[var(--accent)] opacity-0 group-hover:opacity-100 hover:bg-[var(--row-head-bg)] transition-all cursor-pointer"
                        onClick={() => navigate(`/wallet/${w.wallet_id}`)}
                      >
                        {t("assets.viewWallet")}
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageShell>
  );
};
