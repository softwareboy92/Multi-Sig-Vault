import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageShell,
  PageToolbar,
  Pagination,
  SelectMenu,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import { AlertBanner } from "../components/ui/AlertBanner";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { getWallets, getWalletAssets, getNetworks, getWalletTransactions } from "../api";
import { formatBalance, sumBigIntBalances } from "../utils/format";
import { getWalletChainLabel, isWalletTestnet } from "../utils/wallet";
import type { Asset, Transaction, Wallet } from "../types";
import { useAssetPrices } from "../hooks/useAssetPrices";
import { atomicToNumber, formatUsd } from "../utils/price";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssetWithWallet extends Asset {
  wallet_id: string;
  wallet_name: string;
  wallet_chain_label: string;
  wallet_chain_type: "BTC" | "EVM";
  wallet_is_testnet: boolean;
  network_id: string;
  chain_id: number | null;
}

/** One row in the aggregated asset table. */
interface AggregatedAsset {
  groupKey: string;
  symbol: string;
  is_native: boolean;
  token_address: string | null;
  decimals: number;
  chain_type: "BTC" | "EVM";
  chain_label: string;
  total_balance: string;
  wallet_count: number;
  all_testnet: boolean;
  network_id: string;
  chain_id: number | null;
}

interface DashboardTransaction extends Transaction {
  wallet_address: string;
}

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const CHAIN_DOT_COLOR: Record<string, string> = {
  BTC: "bg-[var(--warning)]",
  EVM: "bg-[var(--accent-3)]",
};

const CHART_COLORS = [
  "var(--accent)",
  "var(--accent-3)",
  "var(--warning)",
  "var(--success)",
  "var(--danger)",
  "var(--muted)",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a stable grouping key for an asset across wallets. */
function buildGroupKey(
  chainType: string,
  networkId: string,
  tokenAddress: string | null,
  symbol: string
): string {
  return `${chainType}:${networkId}:${tokenAddress || "native"}:${symbol}`;
}

const DashboardMetric: React.FC<{
  label: string;
  value: number | string;
  unit: string;
  tone: "all" | "btc" | "evm" | "asset";
  featured?: boolean;
}> = ({ label, value, unit, tone, featured = false }) => {
  const toneClass = {
    all: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/25",
    btc: "bg-[color-mix(in_srgb,var(--warning)_12%,var(--panel))] text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_28%,var(--border))]",
    evm: "bg-[color-mix(in_srgb,var(--accent-3)_12%,var(--panel))] text-[var(--accent-3)] border-[color-mix(in_srgb,var(--accent-3)_28%,var(--border))]",
    asset: "bg-[color-mix(in_srgb,var(--success)_12%,var(--panel))] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_28%,var(--border))]",
  }[tone];

  return (
    <Card className={`relative overflow-hidden !p-5 ${featured ? "xl:col-span-2 border-[color-mix(in_srgb,var(--accent)_38%,var(--border))] bg-[color-mix(in_srgb,var(--accent-soft)_35%,var(--panel))]" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
          <div className="mt-3 flex items-end gap-2">
            <strong className={`font-mono font-extrabold tracking-tight text-[var(--text)] ${featured ? "text-4xl" : "text-3xl"}`}>
              {value}
            </strong>
            <span className="pb-1 text-xs font-semibold text-[var(--muted)]">{unit}</span>
          </div>
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}>
          {tone === "all" && (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16v12H4zM7 7V5h10v2M8 12h8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
          {tone === "btc" && <span className="text-lg font-extrabold">B</span>}
          {tone === "evm" && <span className="text-lg font-extrabold">E</span>}
          {tone === "asset" && (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 8 4-8 4-8-4 8-4Zm-8 9 8 4 8-4M4 17l8 4 8-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </span>
      </div>
    </Card>
  );
};

const SummaryRow: React.FC<{ label: string; value: number | string; tone?: string }> = ({ label, value, tone = "text-[var(--text)]" }) => (
  <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-0">
    <dt className="text-sm text-[var(--muted)]">{label}</dt>
    <dd className={`font-mono text-base font-bold tabular-nums ${tone}`}>{value}</dd>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DashboardPage: React.FC = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { showTestnets } = usePreferenceStore();

  // --- Data state ---
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [rawAssets, setRawAssets] = useState<AssetWithWallet[]>([]);
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [networkFilter, setNetworkFilter] = useState<string>("ALL");
  const [failedWalletCount, setFailedWalletCount] = useState(0);

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  // --- Data fetching ---
  const fetchAssets = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
          setError(null);
        }

        const [firstWalletPage, evmNetworks, btcNetworks] = await Promise.all([
          getWallets({ page: 1, pageSize: 100 }),
          getNetworks("EVM"),
          getNetworks("BTC"),
        ]);
        const remainingWalletPages = firstWalletPage.total_pages > 1
          ? await Promise.all(
              Array.from({ length: firstWalletPage.total_pages - 1 }, (_, index) =>
                getWallets({ page: index + 2, pageSize: 100 }),
              ),
            )
          : [];
        const allWallets = [
          ...firstWalletPage.items,
          ...remainingWalletPages.flatMap((page) => page.items),
        ];

        const evmMap = new Map<string, { name: string; is_testnet: boolean; chain_id: number | null }>();
        const btcMap = new Map<string, { btc_network: string | undefined; is_testnet: boolean }>();
        (evmNetworks || []).forEach((n) => evmMap.set(n.id, { name: n.name, is_testnet: n.is_testnet, chain_id: n.chain_id ?? null }));
        (btcNetworks || []).forEach((n) =>
          btcMap.set(n.id, { btc_network: n.btc_network ?? undefined, is_testnet: n.is_testnet })
        );

        const walletsData = showTestnets
          ? allWallets
          : allWallets.filter(
              (wallet) => !isWalletTestnet(wallet, evmMap, btcMap),
            );
        setWallets(walletsData);

        const all: AssetWithWallet[] = [];
        const failedWalletIds = new Set<string>();
        await Promise.all(
          walletsData.map(async (wallet) => {
            try {
              const walletAssets = await getWalletAssets(wallet.id);
              const chainLabel = getWalletChainLabel(wallet, evmMap, btcMap);
              const isTestnet = wallet.chain_type === "EVM"
                ? evmMap.get(wallet.network_id)?.is_testnet ?? false
                : btcMap.get(wallet.network_id)?.is_testnet ?? false;
              walletAssets.forEach((asset) => {
                all.push({
                  ...asset,
                  wallet_id: wallet.id,
                  wallet_name: wallet.name,
                  wallet_chain_label: chainLabel,
                  wallet_chain_type: wallet.chain_type,
                  wallet_is_testnet: isTestnet,
                  network_id: wallet.network_id,
                  chain_id: wallet.chain_type === "EVM" ? evmMap.get(wallet.network_id)?.chain_id ?? null : null,
                });
              });
            } catch {
              failedWalletIds.add(wallet.id);
            }
          })
        );

        const transactionResults = await Promise.all(
          walletsData.map(async (wallet) => {
            try {
              const firstPage = await getWalletTransactions(wallet.id, { page: 1, pageSize: 100 });
              const remainingPages = firstPage.total_pages > 1
                ? await Promise.all(
                    Array.from({ length: firstPage.total_pages - 1 }, (_, index) =>
                      getWalletTransactions(wallet.id, { page: index + 2, pageSize: 100 }),
                    ),
                  )
                : [];
              return [
                ...firstPage.items,
                ...remainingPages.flatMap((page) => page.items),
              ].map((transaction) => ({
                ...transaction,
                wallet_address: wallet.address || "",
              }));
            } catch {
              failedWalletIds.add(wallet.id);
              return [] as DashboardTransaction[];
            }
          }),
        );

        setFailedWalletCount(failedWalletIds.size);
        setRawAssets(all);
        setTransactions(transactionResults.flat());
        if (isRefresh) setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("wallet.loadFailed");
        if (isRefresh) {
          showToast(message, "error");
        } else {
          setError(message);
        }
        if (!isRefresh) {
          setWallets([]);
          setRawAssets([]);
          setTransactions([]);
        }
      } finally {
        if (isRefresh) setIsRefreshing(false);
        else setLoading(false);
      }
    },
    [t, showToast, showTestnets]
  );

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // --- Aggregate by asset ---
  const aggregated = useMemo(() => {
    const map = new Map<
      string,
      AggregatedAsset & { balances: string[]; walletIds: Set<string>; hasMainnet: boolean }
    >();

    for (const a of rawAssets) {
      const key = buildGroupKey(a.wallet_chain_type, a.network_id, a.token_address, a.symbol);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          groupKey: key,
          symbol: a.symbol,
          is_native: a.is_native,
          token_address: a.token_address,
          decimals: a.decimals,
          chain_type: a.wallet_chain_type,
          chain_label: a.wallet_chain_label,
          total_balance: "0",
          wallet_count: 0,
          all_testnet: true,
          network_id: a.network_id,
          chain_id: a.chain_id,
          balances: [],
          walletIds: new Set(),
          hasMainnet: false,
        };
        map.set(key, entry);
      }
      entry.balances.push(a.balance);
      entry.walletIds.add(a.wallet_id);
      if (!a.wallet_is_testnet) entry.hasMainnet = true;
      // Use the most descriptive chain label
      if (a.wallet_chain_label.length > entry.chain_label.length) {
        entry.chain_label = a.wallet_chain_label;
      }
    }

    const result: AggregatedAsset[] = [];
    for (const v of map.values()) {
      result.push({
        groupKey: v.groupKey,
        symbol: v.symbol,
        is_native: v.is_native,
        token_address: v.token_address,
        decimals: v.decimals,
        chain_type: v.chain_type,
        chain_label: v.chain_label,
        total_balance: sumBigIntBalances(v.balances),
        wallet_count: v.walletIds.size,
        all_testnet: !v.hasMainnet,
        network_id: v.network_id,
        chain_id: v.chain_id,
      });
    }

    // Sort: by chain_type (BTC first) then symbol alphabetically
    result.sort((a, b) => {
      if (a.chain_type !== b.chain_type)
        return a.chain_type === "BTC" ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });

    return result;
  }, [rawAssets]);

  const priceRequests = useMemo(
    () => aggregated.map((asset) => ({
      chain_type: asset.chain_type,
      chain_id: asset.chain_id,
      token_address: asset.token_address,
      symbol: asset.symbol,
    })),
    [aggregated],
  );
  const { prices, stale: pricesStale, loading: pricesLoading } = useAssetPrices(priceRequests);
  const valuation = useMemo(() => {
    const holdings = rawAssets.filter((asset) => BigInt(asset.balance || "0") > 0n);
    const testnetKeys = new Set(
      rawAssets
        .filter((asset) => asset.wallet_is_testnet && BigInt(asset.balance || "0") > 0n)
        .map((asset) => buildGroupKey(asset.wallet_chain_type, asset.network_id, asset.token_address, asset.symbol)),
    );
    const assetKeys = new Set<string>();
    const pricedKeys = new Set<string>();
    let total = 0;
    let testnetTotal = 0;
    for (const asset of holdings) {
      const key = buildGroupKey(asset.wallet_chain_type, asset.network_id, asset.token_address, asset.symbol);
      if (!asset.wallet_is_testnet) assetKeys.add(key);
      const price = prices[asset.symbol.toUpperCase()]?.usd;
      if (price != null && Number.isFinite(price)) {
        if (!asset.wallet_is_testnet) pricedKeys.add(key);
        const value = atomicToNumber(asset.balance, asset.decimals) * price;
        if (asset.wallet_is_testnet) testnetTotal += value;
        else total += value;
      }
    }
    return { total, testnetTotal, mainnetAssets: assetKeys.size, priced: pricedKeys.size, unpriced: assetKeys.size - pricedKeys.size, testnet: testnetKeys.size };
  }, [rawAssets, prices]);

  const walletStats = useMemo(
    () => ({
      active: wallets.filter((wallet) => wallet.status === "ACTIVE").length,
      pending: wallets.filter((wallet) => wallet.status === "PENDING_DEPLOY").length,
      archived: wallets.filter((wallet) => wallet.status === "ARCHIVED").length,
      btc: wallets.filter((wallet) => wallet.chain_type === "BTC").length,
      evm: wallets.filter((wallet) => wallet.chain_type === "EVM").length,
    }),
    [wallets],
  );

  const assetDistributionData = useMemo(() => {
    const values = new Map<string, number>();
    const useTestnet = valuation.mainnetAssets === 0;
    for (const asset of rawAssets) {
      if (asset.wallet_is_testnet !== useTestnet) continue;
      const price = prices[asset.symbol.toUpperCase()]?.usd;
      if (price == null || !Number.isFinite(price)) continue;
      values.set(asset.symbol, (values.get(asset.symbol) ?? 0) + atomicToNumber(asset.balance, asset.decimals) * price);
    }
    return [...values].map(([name, value]) => ({ name, value }))
      .filter((asset) => asset.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rawAssets, prices, valuation.mainnetAssets]);

  const assetInsights = useMemo(() => {
    const useTestnet = valuation.mainnetAssets === 0;
    const holdings = aggregated.filter((asset) =>
      asset.all_testnet === useTestnet && BigInt(asset.total_balance || "0") > 0n,
    );
    const priced = holdings.map((asset) => {
      const price = prices[asset.symbol.toUpperCase()]?.usd;
      return { ...asset, value: price != null && Number.isFinite(price)
        ? atomicToNumber(asset.total_balance, asset.decimals) * price
        : null };
    });
    const chainValues = { BTC: 0, EVM: 0 };
    for (const asset of priced) {
      if (asset.value != null) chainValues[asset.chain_type] += asset.value;
    }
    const topAssets = priced.filter((asset) => asset.value != null && asset.value > 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 3);
    const unpriced = priced.filter((asset) => asset.value == null);
    return { chainValues, topAssets, unpriced };
  }, [aggregated, prices, valuation.mainnetAssets]);

  const pendingTransactionCount = useMemo(
    () => transactions.filter((transaction) => ["PENDING_SIGN", "PARTIALLY_SIGNED", "SIGNED", "BROADCAST", "PENDING_CONFIRMATION"].includes(transaction.status)).length,
    [transactions],
  );
  const confirmedSevenDayCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return transactions.filter((transaction) => {
      if (transaction.status !== "CONFIRMED") return false;
      const timestamp = new Date(transaction.confirmed_at || transaction.created_at).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    }).length;
  }, [transactions]);

  const sevenDayTransfers = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return {
        key,
        date: date.toLocaleDateString(language, { month: "2-digit", day: "2-digit" }),
        incoming: 0,
        outgoing: 0,
      };
    });
    const dayMap = new Map(days.map((day) => [day.key, day]));

    transactions.forEach((transaction) => {
      if (!['TRANSFER', 'TOKEN_TRANSFER'].includes(transaction.tx_type)) return;
      if (!['BROADCAST', 'CONFIRMED'].includes(transaction.status)) return;
      const timestamp = transaction.confirmed_at || transaction.created_at;
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const day = dayMap.get(key);
      if (!day) return;

      const isIncoming =
        transaction.direction === "INCOMING" ||
        transaction.extra?.direction === "IN" ||
        Boolean(
          transaction.wallet_address &&
          transaction.to_address &&
          transaction.wallet_address.toLowerCase() === transaction.to_address.toLowerCase(),
        );
      if (isIncoming) day.incoming += 1;
      else day.outgoing += 1;
    });

    return days;
  }, [language, transactions]);

  const hasTransferActivity = sevenDayTransfers.some(
    (day) => day.incoming > 0 || day.outgoing > 0,
  );



  // --- Network filter options (derived from aggregated data) ---
  const networkOptions = useMemo(() => {
    const labels = new Set(aggregated.map((a) => a.chain_label));
    return [
      { value: "ALL", label: t("wallet.allNetworks") },
      ...Array.from(labels)
        .sort()
        .map((label) => ({ value: label, label })),
    ];
  }, [aggregated, t]);

  // --- Filtering & pagination ---
  const filteredData = useMemo(() => {
    return aggregated.filter((asset) => {
      const q = searchText.toLowerCase();
      const matchSearch =
        !searchText ||
        asset.symbol.toLowerCase().includes(q) ||
        asset.chain_label.toLowerCase().includes(q) ||
        (asset.token_address || "").toLowerCase().includes(q);
      const matchNetwork =
        networkFilter === "ALL" || asset.chain_label === networkFilter;
      return matchSearch && matchNetwork;
    });
  }, [aggregated, searchText, networkFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));

  const currentPageData = useMemo(
    () =>
      filteredData.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
      ),
    [filteredData, currentPage, pageSize]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, networkFilter]);

  // --- Derived states ---
  const hasAssets = aggregated.length > 0;
  const hasFilteredData = currentPageData.length > 0;
  const isFilterEmpty = hasAssets && !hasFilteredData;

  // ---------------------------------------------------------------------------
  // Skeleton
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <PageShell
        title={t("assets.dashboardTitle")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("assets.dashboardTitle")}
          </span>
        }
      >
        <PageToolbar left={<span />} />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">
                  {t("common.asset")}
                </TableHead>
                <TableHead className="w-[20%]">
                  {t("tableHeaders.wallet")}
                </TableHead>
                <TableHead align="right" className="w-[35%]">
                  {t("wallet.balance")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                      <span className="inline-block w-28 h-3 rounded bg-[var(--row-head-bg)] animate-pulse" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-16 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="right">
                    <span className="inline-block w-24 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Error
  // ---------------------------------------------------------------------------
  if (error) {
    return (
      <PageShell
        title={t("assets.dashboardTitle")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("assets.dashboardTitle")}
          </span>
        }
      >
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">{error}</div>
          <Button variant="primary" onClick={() => fetchAssets()}>
            {t("common.retry")}
          </Button>
        </Card>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <PageShell
      title={t("assets.dashboardTitle")}
      breadcrumbs={
        <span className="title-h2 text-[var(--text)]">
          {t("assets.dashboardTitle")}
        </span>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <DashboardMetric
          label={valuation.mainnetAssets === 0 && valuation.testnet > 0 ? t("assets.testnetReferenceValue") : t("assets.totalValue")}
          value={pricesLoading || (valuation.mainnetAssets === 0 && valuation.testnet === 0) ? "—" : formatUsd(valuation.mainnetAssets > 0 ? valuation.total : valuation.testnetTotal, language)}
          unit={pricesStale ? t("assets.stalePrice") : "USD"}
          tone="asset"
          featured
        />
        <DashboardMetric
          label={t("assets.totalWallets")}
          value={walletStats.active}
          unit={t("assets.walletUnit")}
          tone="all"
        />
        <DashboardMetric
          label={t("assets.pendingTransactions")}
          value={pendingTransactionCount}
          unit={t("assets.transactionUnit")}
          tone="btc"
        />
        <DashboardMetric
          label={t("assets.confirmedSevenDays")}
          value={confirmedSevenDayCount}
          unit={t("assets.transactionUnit")}
          tone="evm"
        />
        <DashboardMetric
          label={t("assets.mergedAssets")}
          value={aggregated.length}
          unit={t("assets.assetUnit")}
          tone="asset"
        />
      </div>

      <p className="text-xs leading-5 text-[var(--muted)]">{valuation.mainnetAssets === 0 && valuation.testnet > 0 ? t("assets.testnetReferenceHint") : valuation.mainnetAssets === 0 ? t("assets.noMainnetHoldings") : t("assets.valuationScope")}</p>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="!p-5">
          <h2 className="title-h3 text-[var(--text)]">{t("assets.chainAllocation")}</h2>
          <dl className="mt-2">
            <SummaryRow label="BTC" value={pricesLoading ? "—" : formatUsd(assetInsights.chainValues.BTC, language)} />
            <SummaryRow label="EVM" value={pricesLoading ? "—" : formatUsd(assetInsights.chainValues.EVM, language)} />
          </dl>
          <p className="mt-2 text-xs text-[var(--muted)]">{valuation.mainnetAssets === 0 && valuation.testnet > 0 ? t("assets.testnetAllocationHint") : t("assets.chainAllocationHint")}</p>
        </Card>

        <Card className="!p-5">
          <h2 className="title-h3 text-[var(--text)]">{t("assets.topHoldings")}</h2>
          {pricesLoading ? <p className="mt-4 text-sm text-[var(--muted)]">{t("assets.priceLoading")}</p> : assetInsights.topAssets.length === 0
            ? <p className="mt-4 text-sm text-[var(--muted)]">{t("assets.noValuationData")}</p>
            : <div className="mt-2">{assetInsights.topAssets.map((asset) => (
                <button key={asset.groupKey} type="button" onClick={() => navigate(`/assets/${encodeURIComponent(asset.groupKey)}`)} className="flex w-full items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 text-left last:border-0 hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                  <span className="min-w-0 truncate text-sm">{asset.symbol} <span className="text-xs text-[var(--muted)]">{asset.chain_label}</span></span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{formatUsd(asset.value ?? 0, language)}</span>
                </button>
              ))}</div>}
        </Card>

        <Card className="!p-5">
          <h2 className="title-h3 text-[var(--text)]">{t("assets.unpricedHoldings")}</h2>
          {pricesLoading ? <p className="mt-4 text-sm text-[var(--muted)]">{t("assets.priceLoading")}</p> : assetInsights.unpriced.length === 0
            ? <p className="mt-4 text-sm text-[var(--muted)]">{t("assets.allHoldingsPriced")}</p>
            : <><p className="mt-2 text-sm text-[var(--warning)]">{t("assets.unpricedHoldingsCount", { count: String(assetInsights.unpriced.length) })}</p>
                <ul className="mt-2 space-y-2">{assetInsights.unpriced.slice(0, 3).map((asset) => (
                  <li key={asset.groupKey} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{asset.symbol} <span className="text-[var(--muted)]">{asset.chain_label}</span></span><span className="shrink-0 font-mono tabular-nums">{formatBalance(asset.total_balance, asset.decimals)} {asset.symbol}</span></li>
                ))}</ul></>}
          <p className="mt-3 text-xs text-[var(--muted)]">{pricesStale ? t("assets.priceDataStale") : t("assets.unpricedHoldingsHint")}</p>
        </Card>
      </div>

      <div className="order-2 flex flex-col gap-1">
        <h2 className="title-h3 text-[var(--text)]">{t("assets.mergedAssetsTitle")}</h2>
        <p className="text-sm leading-6 text-[var(--muted)]">{t("assets.mergedAssetsHint")}</p>
      </div>

      <div className="order-2">
        <PageToolbar
          left={
            <>
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("assets.searchPlaceholder")}
                className="min-w-[220px] h-10"
              />
              <SelectMenu
                value={networkFilter}
                onChange={setNetworkFilter}
                options={networkOptions}
                placeholderValue="ALL"
                className="min-w-[240px]"
              />
            </>
          }
          right={
            <Button
              variant="ghost"
              onClick={() => fetchAssets(true)}
              disabled={isRefreshing}
              className="p-0 flex items-center justify-center border-transparent bg-transparent hover:bg-transparent rounded-none"
              aria-label={t("common.refresh")}
              title={t("common.refresh")}
            >
              <img
                src="/brand/icon_refe.svg"
                alt=""
                className={`w-5 h-5 refresh-icon ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          }
        />
      </div>



      {failedWalletCount > 0 && (
        <div className="order-2 mb-4">
          <AlertBanner
            severity="warning"
            action={{
              label: t("common.retry"),
              onClick: () => fetchAssets(true),
            }}
          >
            {t("assets.partialLoadFailed", { count: String(failedWalletCount) })}
          </AlertBanner>
        </div>
      )}

      {/* No assets at all */}
      {!hasAssets && (
        <Card className="order-2">
          <EmptyState title={t("common.noData")} />
        </Card>
      )}

      {/* Has assets but filter yields nothing */}
      {isFilterEmpty && (
        <Card className="order-2">
          <EmptyState
            title={t("assets.noFilterResults")}
            description={t("assets.adjustSearch")}
          />
        </Card>
      )}

      {/* Table with data */}
      {hasFilteredData && (
        <Card className="order-2">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">
                  {t("common.asset")}
                </TableHead>
                <TableHead className="w-[20%]">
                  {t("tableHeaders.wallet")}
                </TableHead>
                <TableHead align="right" className="w-[35%]">
                  {t("wallet.balance")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentPageData.map((asset) => {
                const dotColor =
                  CHAIN_DOT_COLOR[asset.chain_type] || "bg-[var(--muted)]";
                const displayBalance = formatBalance(
                  asset.total_balance,
                  asset.decimals,
                  8
                );

                return (
                  <TableRow
                    key={asset.groupKey}
                    className="cursor-pointer hover:bg-[var(--row-head-bg)]"
                    onClick={() => navigate(`/assets/${encodeURIComponent(asset.groupKey)}`)}
                  >
                    {/* Asset — dual row */}
                    <TableCell>
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--field-radius)] border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-sm font-extrabold text-[var(--accent)]">
                          {asset.symbol.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-[1.04em] font-bold">
                            {asset.symbol}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
                            />
                            <span className="text-[0.82em] text-[var(--muted)]">
                              {asset.chain_label}
                            </span>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Wallets count */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <svg
                          className="w-4 h-4 text-[var(--muted)] shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect
                            x="2"
                            y="6"
                            width="20"
                            height="14"
                            rx="3"
                          />
                          <path d="M2 10h20" />
                          <circle cx="17" cy="15" r="1.5" />
                        </svg>
                        <span className="font-medium">
                          &times;{asset.wallet_count}
                        </span>
                      </div>
                    </TableCell>

                    {/* Balance */}
                    <TableCell align="right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-mono">{displayBalance} {asset.symbol}</span>
                        {prices[asset.symbol.toUpperCase()]?.usd != null && (
                          <span className="text-xs tabular-nums text-[var(--muted)]">
                            {formatUsd(atomicToNumber(asset.total_balance, asset.decimals) * prices[asset.symbol.toUpperCase()].usd, language)}
                            {" · "}{formatUsd(prices[asset.symbol.toUpperCase()].usd, language)}/{asset.symbol}
                            {asset.all_testnet && ` · ${t("assets.testnetReferenceShort")}`}
                          </span>
                        )}
                      </div>
                    </TableCell>

                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            prevLabel={t("common.prev")}
            nextLabel={t("common.next")}
          />
        </Card>
      )}

      <div className="order-1 grid gap-4 xl:grid-cols-2">
        <Card className="!p-5 sm:!p-6">
          <div>
            <h2 className="title-h3 text-[var(--text)]">{t("assets.distributionTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{valuation.mainnetAssets === 0 && valuation.testnet > 0 ? t("assets.testnetDistributionHint") : t("assets.distributionHint")}</p>
          </div>
          <div className="mt-3 h-[280px] w-full">
            {assetDistributionData.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState title={valuation.mainnetAssets === 0 && valuation.testnet > 0 ? t("assets.noPricedTestnetAssets") : t("assets.noValuationData")} />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={assetDistributionData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={3}
                    stroke="var(--panel)"
                    strokeWidth={3}
                  >
                    {assetDistributionData.map((entry, index) => (
                      <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [
                      formatUsd(Number(value), language),
                      t("assets.estimatedValue"),
                    ]}
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      color: "var(--text)",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ color: "var(--muted)", fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="!p-5 sm:!p-6">
          <div>
            <h2 className="title-h3 text-[var(--text)]">{t("assets.transferActivityTitle")}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("assets.transferActivityHint")}</p>
          </div>
          <div className="mt-3 h-[280px] w-full">
            {!hasTransferActivity ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState title={t("assets.noTransferActivity")} />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sevenDayTransfers} margin={{ top: 14, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--muted)" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      color: "var(--text)",
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    wrapperStyle={{ color: "var(--muted)", fontSize: "12px", paddingBottom: "12px" }}
                  />
                  <Bar dataKey="incoming" name={t("assets.incomingTransfers")} fill="var(--success)" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="outgoing" name={t("assets.outgoingTransfers")} fill="var(--accent)" radius={[6, 6, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
};

// Keep the legacy export for integrations that still import AssetsPage directly.
export const AssetsPage = DashboardPage;
