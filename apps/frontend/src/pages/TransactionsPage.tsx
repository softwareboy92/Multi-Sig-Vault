import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  Input,
  PageShell,
  PageToolbar,
  SelectMenu,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Pagination,
} from "../components/ui";
import { CopyButton } from "../components/ui/CopyButton";
import { useTranslation } from "../hooks/useTranslation";
import { useTimezone } from "../hooks/useTimezone";
import { useToastStore } from "../stores/useToastStore";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { getNetworks, getWallet, getWalletTransactions } from "../api";
import { formatBalance, getDisplaySymbol } from "../utils/format";
import { truncateAddress } from "../utils/address";
import { formatAbsoluteTime } from "../utils/time";
import { getExplorerUrl } from "../utils/formatters";
import { TX_STATUS_VARIANT, TX_STATUS_DOT } from "../utils/status-variants";
import type { Transaction, TransactionStatus, Wallet } from "../types";
import { useAssetPrices } from "../hooks/useAssetPrices";
import { atomicToNumber, formatUsd } from "../utils/price";

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TransactionsPage: React.FC = () => {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();
  const params = useParams<{ id?: string }>();
  const walletId = params.id;
  const navigate = useNavigate();
  const { showToast } = useToastStore();

  // --- Data state ---
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TransactionStatus>("ALL");
  const [assetFilter, setAssetFilter] = useState<string | null>(searchParams.get('asset'));

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  const [btcNetworks, setBtcNetworks] = useState<Map<string, string>>(new Map());
  const [networkExplorerUrl, setNetworkExplorerUrl] = useState<string | null>(null);
  const [networkChainId, setNetworkChainId] = useState<number | null>(null);

  const priceRequests = useMemo(() => {
    if (!wallet) return [];
    const bySymbol = new Map<string, Transaction>();
    transactions.forEach((tx) => {
      const symbol = getDisplaySymbol(tx.token_symbol, wallet.chain_type, networkChainId).toUpperCase();
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, tx);
    });
    return Array.from(bySymbol.entries()).map(([symbol, tx]) => ({
      chain_type: wallet.chain_type,
      chain_id: networkChainId,
      token_address: tx.token_address,
      symbol,
    }));
  }, [wallet, transactions, networkChainId]);
  const { prices } = useAssetPrices(priceRequests);



  // --- URL param trigger for create → navigate to send page ---
  useEffect(() => {
    if (searchParams.get("create") === "1" && walletId) {
      searchParams.delete("create");
      setSearchParams(searchParams, { replace: true });
      navigate(`/wallet/${walletId}/send`);
    }
  }, [searchParams, setSearchParams, walletId, navigate]);

  // --- Fetch BTC networks (once) + resolve network explorer URL ---
  useEffect(() => {
    getNetworks("BTC")
      .then((list) => {
        const map = new Map<string, string>();
        (list || []).forEach((n) => map.set(n.id, n.btc_network ?? ""));
        setBtcNetworks(map);
      })
      .catch(() => setBtcNetworks(new Map()));
  }, []);

  // --- Data fetching ---
  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!walletId) return;
      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
          setError(null);
        }

        const [walletData, txData] = await Promise.all([
          getWallet(walletId),
          getWalletTransactions(walletId),
        ]);
        setWallet(walletData);
        setTransactions(txData.items || []);

        // Resolve explorer URL from the wallet's network
        if (walletData.network_id) {
          const chainType = walletData.chain_type === "BTC" ? "BTC" : "EVM";
          getNetworks(chainType)
            .then((list) => {
              const net = (list || []).find((n) => n.id === walletData.network_id);
              setNetworkExplorerUrl(net?.explorer_url ?? null);
              setNetworkChainId(net?.chain_id ?? null);
            })
            .catch(() => { setNetworkExplorerUrl(null); setNetworkChainId(null); });
        }

        if (isRefresh) setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : t("transactions.errorLoad");
        if (isRefresh) {
          showToast(message, "error");
        } else {
          setError(message);
        }
        if (!isRefresh) {
          setTransactions([]);
        }
      } finally {
        if (isRefresh) setIsRefreshing(false);
        else setLoading(false);
      }
    },
    [walletId, t, showToast]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Status options ---
  const statusLabelMap: Record<TransactionStatus, string> = useMemo(
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
    [t]
  );

  const statusOptions = useMemo(
    () => [
      { value: "ALL", label: t("allStatus") },
      ...Object.entries(statusLabelMap).map(([value, label]) => ({ value, label })),
    ],
    [statusLabelMap, t]
  );

  // --- Filtering & pagination ---
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const q = searchText.toLowerCase();
      const matchSearch =
        !searchText ||
        tx.to_address.toLowerCase().includes(q) ||
        (tx.from_address || "").toLowerCase().includes(q) ||
        (tx.tx_hash || "").toLowerCase().includes(q) ||
        (tx.description || "").toLowerCase().includes(q);
      const matchStatus = statusFilter === "ALL" || tx.status === statusFilter;
      const matchAsset = !assetFilter || (tx.token_symbol || '').toUpperCase() === assetFilter.toUpperCase();
      return matchSearch && matchStatus && matchAsset;
    });
  }, [transactions, searchText, statusFilter, assetFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));

  const currentPageData = useMemo(
    () =>
      filteredTransactions.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
      ),
    [filteredTransactions, currentPage, pageSize]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, statusFilter, assetFilter]);

  // --- Derived states ---
  const hasTransactions = transactions.length > 0;
  const hasFilteredData = currentPageData.length > 0;
  const isFilterEmpty = hasTransactions && !hasFilteredData;

  const inferDirection = (tx: Transaction): "INCOMING" | "OUTGOING" => {
    if (tx.direction) return tx.direction;
    if (tx.extra?.direction === "IN") return "INCOMING";
    if (wallet?.address && tx.to_address === wallet.address) return "INCOMING";
    return "OUTGOING";
  };

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <PageShell
        title={t("transactions.title")}
        breadcrumbs={
          <Breadcrumb
            items={[
              { label: t("nav.wallets"), href: "/wallet" },
              { label: t("transactions.title") },
            ]}
          />
        }
      >
        <PageToolbar left={<span />} />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[16%]">{t("history.transaction")}</TableHead>
                <TableHead className="w-[26%]">{t("history.toFrom")}</TableHead>
                <TableHead align="right" className="w-[21%]">{t("history.amount")}</TableHead>
                <TableHead align="center" className="w-[16%]">{t("tableHeaders.status")}</TableHead>
                <TableHead align="right" className="w-[21%]">{t("history.time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <span className="inline-block w-16 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-28 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-24 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="center">
                    <span className="inline-block w-16 h-5 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-block w-20 h-3 rounded bg-[var(--row-head-bg)] animate-pulse" />
                      <span className="inline-block w-16 h-3 rounded bg-[var(--row-head-bg)] animate-pulse" />
                    </div>
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
        title={t("transactions.title")}
        breadcrumbs={
          <Breadcrumb
            items={[
              { label: t("nav.wallets"), href: "/wallet" },
              { label: t("transactions.title") },
            ]}
          />
        }
      >
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">
            {error || t("wallet.notFound")}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => fetchData()}>
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
      title={t("transactions.title")}
      description={t("transactions.subtitle", { name: wallet.name })}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("wallet.listTitle"), href: "/wallet" },
            { label: wallet.name, href: `/wallet/${walletId}` },
            { label: t("transactions.title") },
          ]}
        />
      }
    >
      <PageToolbar
        left={
          <>
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("transactions.searchPlaceholder")}
              className="min-w-[220px] h-10"
            />
            <SelectMenu
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as "ALL" | TransactionStatus)}
              options={statusOptions}
              placeholderValue="ALL"
              className="min-w-[170px]"
            />
            {assetFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--row-head-bg)] text-xs font-medium text-[var(--text)]">
                {assetFilter.toUpperCase()}
                <button
                  onClick={() => setAssetFilter(null)}
                  className="ml-0.5 text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
                  aria-label="Clear asset filter"
                >
                  ✕
                </button>
              </span>
            )}
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => fetchData(true)}
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
            {hasTransactions && (
              <Button variant="primary" onClick={() => navigate(`/wallet/${walletId}/send`)}>
                {t("common.create")}
              </Button>
            )}
          </div>
        }
      />

      {/* No transactions at all */}
      {!hasTransactions && (
        <Card>
          <EmptyState
            title={t("common.noData")}
            action={
              <Button onClick={() => navigate(`/wallet/${walletId}/send`)}>
                {t("common.create")}
              </Button>
            }
          />
        </Card>
      )}

      {/* Has transactions but filter yields nothing */}
      {isFilterEmpty && (
        <Card>
          <EmptyState
            title={t("transactions.noFilterResults")}
            description={t("transactions.adjustFilters")}
          />
        </Card>
      )}

      {/* Table with data */}
      {hasFilteredData && (
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[16%]">{t("history.transaction")}</TableHead>
                <TableHead className="w-[26%]">{t("history.toFrom")}</TableHead>
                <TableHead align="right" className="w-[21%]">{t("history.amount")}</TableHead>
                <TableHead align="center" className="w-[16%]">{t("tableHeaders.status")}</TableHead>
                <TableHead align="right" className="w-[21%]">{t("history.time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentPageData.map((tx) => {
                const direction = inferDirection(tx);
                const counterpartyAddress = direction === "INCOMING"
                  ? tx.from_address || tx.to_address
                  : tx.to_address;
                const isCancellation = tx.tx_type === "CANCELLATION";
                const symbol = getDisplaySymbol(tx.token_symbol, wallet.chain_type, networkChainId);
                const displayAmount = isCancellation
                  ? "-"
                  : `${formatBalance(tx.amount, tx.token_decimals ?? 18, 8)} ${symbol}`;
                const price = prices[symbol.toUpperCase()]?.usd;
                const decimals = tx.token_decimals ?? (wallet.chain_type === "BTC" ? 8 : 18);
                const fiatValue = price == null ? null : atomicToNumber(tx.amount, decimals) * price;
                const variant = TX_STATUS_VARIANT[tx.status] || "default";
                const label = statusLabelMap[tx.status] || tx.status;
                const showDot = TX_STATUS_DOT.has(tx.status);
                const btcNetwork = wallet.network_id ? btcNetworks.get(wallet.network_id) : undefined;
                const explorerUrl = tx.tx_hash
                  ? getExplorerUrl(tx.tx_hash, wallet.chain_type, btcNetwork, networkExplorerUrl)
                  : "";

                return (
                  <TableRow
                    key={tx.id}
                    className={`${
                      isCancellation ? "border-l-4 border-l-[var(--warning)]" : ""
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
                      {counterpartyAddress ? (
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[0.86em] text-[var(--muted)] truncate" title={counterpartyAddress}>
                            {truncateAddress(counterpartyAddress)}
                          </span>
                          <CopyButton value={counterpartyAddress} stopPropagation />
                        </div>
                      ) : (
                        <span className="text-[var(--muted)]">-</span>
                      )}
                    </TableCell>

                    {/* Amount */}
                    <TableCell align="right">
                      {isCancellation ? (
                        <span className="text-[var(--muted)]">-</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono font-medium">
                            {displayAmount}
                          </span>
                          {fiatValue != null && (
                            <span className="text-xs tabular-nums text-[var(--muted)]">≈ {formatUsd(fiatValue, language)}</span>
                          )}
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
