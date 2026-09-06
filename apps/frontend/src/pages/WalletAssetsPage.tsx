import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  Input,
  PageShell,
  PageToolbar,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { getWallet, getWalletAssets, syncWalletAssets } from "../api";
import { formatBalance } from "../utils/format";
import type { Asset, Wallet } from "../types";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WalletAssetsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showToast, removeToast } = useToastStore();

  // --- Data state ---
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchText, setSearchText] = useState("");

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  // --- Data fetching ---
  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!id) return;
      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
          setError(null);
        }

        const [walletData, assetsData] = await Promise.all([
          getWallet(id),
          getWalletAssets(id),
        ]);
        setWallet(walletData);
        setAssets(assetsData);
        if (isRefresh) setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : t("wallet.loadFailed");
        if (isRefresh) {
          showToast(message, "error");
        } else {
          setError(message);
        }
        if (!isRefresh) setAssets([]);
      } finally {
        if (isRefresh) setIsRefreshing(false);
        else setLoading(false);
      }
    },
    [id, t, showToast]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);



  // --- Sync handler ---
  const handleSync = useCallback(async () => {
    if (!id) return;
    setSyncing(true);
    const toastId = showToast(
      t("toast.syncingWalletAssets", { name: wallet?.name || t("wallet.assets") }),
      "info",
      0
    );
    try {
      await syncWalletAssets(id);
      const assetsData = await getWalletAssets(id);
      setAssets(assetsData);
      removeToast(toastId);
      showToast(t("toast.syncSuccess"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      removeToast(toastId);
      showToast(t("toast.syncFailed", { error: message }), "error");
    } finally {
      setSyncing(false);
    }
  }, [id, wallet?.name, t, showToast, removeToast]);

  // --- Filtering & pagination ---
  const filteredAssets = useMemo(() => {
    if (!searchText) return assets;
    const q = searchText.toLowerCase();
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) ||
        (a.token_address || "").toLowerCase().includes(q)
    );
  }, [assets, searchText]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize));

  const currentPageData = useMemo(
    () => filteredAssets.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredAssets, currentPage, pageSize]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText]);

  // --- Derived state ---
  const hasAssets = assets.length > 0;
  const hasFilteredData = currentPageData.length > 0;
  const isFilterEmpty = hasAssets && !hasFilteredData;

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <PageShell
        title={t("wallet.assets")}
        breadcrumbs={
          <Breadcrumb
            items={[
              { label: t("nav.wallets"), href: "/wallet" },
              { label: t("wallet.assets") },
            ]}
          />
        }
      >
        <PageToolbar left={<span />} />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60%]">{t("common.asset")}</TableHead>
                <TableHead align="right" className="w-[40%]">{t("wallet.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
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
  // Error state
  // ---------------------------------------------------------------------------
  if (error || !wallet) {
    return (
      <PageShell
        title={t("wallet.assets")}
        breadcrumbs={
          <Breadcrumb
            items={[
              { label: t("nav.wallets"), href: "/wallet" },
              { label: t("wallet.assets") },
            ]}
          />
        }
      >
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">
            {error || t("wallet.notFound")}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => loadData()}>
              {t("common.retry")}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/wallet")}>
              {t("common.back")}
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <PageShell
      title={t("wallet.assets")}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("wallet.listTitle"), href: "/wallet" },
            { label: wallet.name, href: `/wallet/${id}` },
            { label: t("wallet.assets") },
          ]}
        />
      }
    >
      <PageToolbar
        left={
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t("assets.searchPlaceholder")}
            className="min-w-[220px] h-10"
          />
        }
        right={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => loadData(true)}
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
            <Button variant="ghost" onClick={handleSync} disabled={syncing}>
              {syncing ? t("wallet.syncing") : t("topbar.syncData")}
            </Button>
          </div>
        }
      />

      {/* No assets at all */}
      {!hasAssets && (
        <Card>
          <EmptyState title={t("common.noData")} />
        </Card>
      )}

      {/* Has assets but filter yields nothing */}
      {isFilterEmpty && (
        <Card>
          <EmptyState
            title={t("assets.noFilterResults")}
            description={t("assets.adjustSearch")}
          />
        </Card>
      )}

      {/* Table with data */}
      {hasFilteredData && (
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60%]">{t("common.asset")}</TableHead>
                <TableHead align="right" className="w-[40%]">{t("wallet.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentPageData.map((asset) => {
                const displayBalance = formatBalance(asset.balance, asset.decimals, 8);

                return (
                  <TableRow
                    key={asset.id}
                  >
                    {/* Asset */}
                    <TableCell>
                      <span className="font-semibold">
                        {asset.symbol}
                      </span>
                    </TableCell>

                    {/* Balance */}
                    <TableCell align="right">
                      <span className="font-mono">
                        {displayBalance}
                      </span>
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
    </PageShell>
  );
};
