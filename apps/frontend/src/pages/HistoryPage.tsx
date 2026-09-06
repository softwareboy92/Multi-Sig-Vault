import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
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
import { CopyButton } from "../components/ui/CopyButton";
import { TransactionTagModal } from "../components/Transaction/TransactionTagModal";
import { useTranslation } from "../hooks/useTranslation";
import { useTimezone } from "../hooks/useTimezone";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { usePendingStore } from "../stores/usePendingStore";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { useToastStore } from "../stores/useToastStore";
import { useTransactionTagStore } from "../stores/useTransactionTagStore";
import { getWalletTransactions, getWallets, getNetworks } from "../api";
import { formatBalance, getDisplaySymbol } from "../utils/format";
import { formatAbsoluteTime } from "../utils/time";
import { TX_STATUS_VARIANT, TX_STATUS_DOT } from "../utils/status-variants";
import { getExplorerUrl } from "../utils/formatters";
import { truncateAddress } from "../utils/address";
import type { Transaction, TransactionStatus, Wallet } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransactionRow = Transaction & {
  wallet_id: string;
  wallet_name: string;
  wallet_chain: string;
  wallet_chain_label: string;
  wallet_address: string;
  wallet_btc_network?: string | null;
  wallet_explorer_url?: string | null;
  wallet_chain_id?: number | null;
  wallet_is_testnet?: boolean;
};

// ---------------------------------------------------------------------------
// Constants — align with TransactionsPage
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a display label for the chain/network. */
function buildChainLabel(
  wallet: Wallet,
  evmMap: Map<string, string>,
  btcMap: Map<string, string>,
): string {
  if (wallet.chain_type === "BTC") {
    const network = (
      (wallet.network_id ? btcMap.get(wallet.network_id) : undefined) ||
      "mainnet"
    ).toLowerCase();
    if (network === "testnet4") return "BTC Testnet4";
    if (network === "testnet3" || network === "testnet") return "BTC Testnet3";
    return "BTC Mainnet";
  }
  if (wallet.network_id && evmMap.has(wallet.network_id)) {
    return evmMap.get(wallet.network_id) || "EVM";
  }
  return "EVM";
}

/** Infer direction when the backend field is absent. */
function inferDirection(
  tx: TransactionRow,
): "INCOMING" | "OUTGOING" {
  if (tx.direction) return tx.direction;
  if (tx.extra?.direction === "IN") return "INCOMING";
  if (tx.tx_type === "CANCELLATION") return "OUTGOING";
  if (tx.tx_type === "SAFE_POLICY_CHANGE") return "OUTGOING";
  if (
    tx.wallet_address &&
    tx.to_address &&
    tx.to_address.toLowerCase() === tx.wallet_address.toLowerCase()
  ) {
    return "INCOMING";
  }
  return "OUTGOING";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const HistoryPage: React.FC = () => {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();
  const navigate = useNavigate();
  const { refreshToken } = usePendingStore();
  const { showToast } = useToastStore();
  const { showTestnets } = usePreferenceStore();
  const { tags, transactionTags } = useTransactionTagStore();

  // --- Data state ---
  const [, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Filters ---
  const [searchText, setSearchText] = useState("");
  const [chainFilter, setChainFilter] = useState<string>("ALL");
  const [directionFilter, setDirectionFilter] = useState<
    "ALL" | "INCOMING" | "OUTGOING"
  >("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TransactionStatus>(
    "ALL",
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [assetFilter, setAssetFilter] = useState<string | null>(searchParams.get('asset'));
  const [tagFilter, setTagFilter] = useState("ALL");
  const [tagTransactionId, setTagTransactionId] = useState<string | null>(null);

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  // --- Status label map (i18n aware) ---
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
    [t],
  );

  // --- Filter options ---
  const chainOptions = useMemo(() => {
    const labels = new Set(
      transactions
        .filter((tx) => showTestnets || !tx.wallet_is_testnet)
        .map((tx) => tx.wallet_chain_label)
        .filter(Boolean),
    );
    return [
      { value: "ALL", label: t("wallet.allNetworks") },
      ...Array.from(labels)
        .sort()
        .map((label) => ({ value: label, label })),
    ];
  }, [transactions, showTestnets, t]);

  const statusOptions = useMemo(
    () => [
      { value: "ALL", label: t("allStatus") },
      ...Object.entries(statusLabelMap).map(([value, label]) => ({
        value,
        label,
      })),
    ],
    [statusLabelMap, t],
  );

  const directionOptions = useMemo(
    () => [
      { value: "ALL", label: t("history.allTypes") },
      { value: "INCOMING", label: t("history.receivedType") },
      { value: "OUTGOING", label: t("history.sentType") },
    ],
    [t],
  );

  const tagOptions = useMemo(
    () => [
      { value: "ALL", label: t("history.allTags") },
      { value: "UNTAGGED", label: t("history.untagged") },
      ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
    ],
    [tags, t],
  );

  // --- Data fetching ---
  const loadAll = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
          setError(null);
        }

        const [response, evmNetworks, btcNetworks] = await Promise.all([
          getWallets(),
          getNetworks("EVM"),
          getNetworks("BTC"),
        ]);

        const items = response.items || [];
        const evmMap = new Map<string, string>();
        const btcMap = new Map<string, string>();
        const explorerMap = new Map<string, string | null>();
        const chainIdMap = new Map<string, number | null>();
        const testnetMap = new Map<string, boolean>();
        (evmNetworks || []).forEach((n) => {
          evmMap.set(n.id, n.name);
          explorerMap.set(n.id, n.explorer_url);
          chainIdMap.set(n.id, n.chain_id ?? null);
          testnetMap.set(n.id, n.is_testnet);
        });
        (btcNetworks || []).forEach((n) => {
          btcMap.set(n.id, n.btc_network ?? "");
          explorerMap.set(n.id, n.explorer_url);
          testnetMap.set(n.id, n.is_testnet);
        });
        const visibleWallets = showTestnets
          ? items
          : items.filter((wallet) => !testnetMap.get(wallet.network_id));
        setWallets(visibleWallets);

        const txResults = await Promise.all(
          visibleWallets.map(async (wallet) => {
            try {
              const resp = await getWalletTransactions(wallet.id);
              const chainLabel = buildChainLabel(wallet, evmMap, btcMap);

              return (resp.items || []).map((tx) => ({
                ...tx,
                wallet_id: wallet.id,
                wallet_name: wallet.name,
                wallet_chain: wallet.chain_type,
                wallet_chain_label: chainLabel,
                wallet_address: wallet.address || "",
                wallet_btc_network:
                  wallet.chain_type === "BTC" && wallet.network_id
                    ? btcMap.get(wallet.network_id) || null
                    : null,
                wallet_explorer_url:
                  wallet.network_id ? explorerMap.get(wallet.network_id) ?? null : null,
                wallet_chain_id:
                  wallet.chain_type === "EVM" && wallet.network_id
                    ? chainIdMap.get(wallet.network_id) ?? null
                    : null,
                wallet_is_testnet:
                  wallet.network_id ? testnetMap.get(wallet.network_id) ?? false : false,
              }));
            } catch {
              return [] as TransactionRow[];
            }
          }),
        );

        const combined = txResults.flat();
        combined.sort((a, b) => {
          const aTime = new Date(a.confirmed_at || a.created_at).getTime();
          const bTime = new Date(b.confirmed_at || b.created_at).getTime();
          return bTime - aTime;
        });
        setTransactions(combined);
        if (isRefresh) setError(null);
      } catch {
        if (!isRefresh) {
          setWallets([]);
          setTransactions([]);
          setError(t("common.error"));
        } else {
          showToast(t("common.error"), "error");
        }
      } finally {
        if (isRefresh) setIsRefreshing(false);
        else setLoading(false);
      }
    },
    [t, showToast, showTestnets],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll, refreshToken]);



  // --- Filtering & pagination ---
  const visibleTransactions = useMemo(
    () => showTestnets ? transactions : transactions.filter((tx) => !tx.wallet_is_testnet),
    [transactions, showTestnets],
  );

  const filteredTransactions = useMemo(() => {
    return visibleTransactions.filter((tx) => {
      const q = searchText.toLowerCase();
      const matchSearch =
        !searchText ||
        tx.wallet_name.toLowerCase().includes(q) ||
        tx.to_address.toLowerCase().includes(q) ||
        (tx.from_address || "").toLowerCase().includes(q) ||
        (tx.tx_hash || "").toLowerCase().includes(q);
      const matchChain =
        chainFilter === "ALL" || tx.wallet_chain_label === chainFilter;
      const matchDirection =
        directionFilter === "ALL" || inferDirection(tx) === directionFilter;
      const matchStatus =
        statusFilter === "ALL" || tx.status === statusFilter;
      const matchAsset = !assetFilter || (tx.token_symbol || '').toUpperCase() === assetFilter.toUpperCase();
      const txTagIds = transactionTags[tx.id] || [];
      const matchTag =
        tagFilter === "ALL"
        || (tagFilter === "UNTAGGED" ? txTagIds.length === 0 : txTagIds.includes(tagFilter));
      return matchSearch && matchChain && matchDirection && matchStatus && matchAsset && matchTag;
    });
  }, [visibleTransactions, searchText, chainFilter, directionFilter, statusFilter, assetFilter, tagFilter, transactionTags]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredTransactions.length / pageSize),
  );

  const currentPageData = useMemo(
    () =>
      filteredTransactions.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
    [filteredTransactions, currentPage, pageSize],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, chainFilter, directionFilter, statusFilter, assetFilter, tagFilter, showTestnets]);

  // --- Derived state ---
  const hasTransactions = visibleTransactions.length > 0;
  const hasFilteredData = currentPageData.length > 0;
  const isFilterEmpty = hasTransactions && !hasFilteredData;

  // ---------------------------------------------------------------------------
  // Column widths
  // ---------------------------------------------------------------------------
  const COL = {
    transaction: "w-[12%]",
    toFrom: "w-[18%]",
    amount: "w-[15%] text-right",
    wallet: "w-[14%]",
    tags: "w-[15%]",
    status: "w-[12%]",
    time: "w-[14%]",
  } as const;

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <PageShell
        title={t("history.title")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("history.title")}
          </span>
        }
      >
        <PageToolbar left={<span />} />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className={COL.transaction}>
                  {t("history.transaction")}
                </TableHead>
                <TableHead className={COL.toFrom}>
                  {t("history.toFrom")}
                </TableHead>
                <TableHead className={COL.amount}>
                  {t("history.amount")}
                </TableHead>
                <TableHead className={COL.wallet}>
                  {t("history.wallet")}
                </TableHead>
                <TableHead className={COL.tags}>
                  {t("history.tags")}
                </TableHead>
                <TableHead align="center" className={COL.status}>
                  {t("tableHeaders.status")}
                </TableHead>
                <TableHead align="right" className={COL.time}>
                  {t("history.time")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <span className="inline-block w-16 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-24 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-16 h-5 rounded-full bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="center">
                    <span className="inline-block w-16 h-5 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="right">
                    <span className="inline-block w-16 h-3 rounded bg-[var(--row-head-bg)] animate-pulse" />
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
  if (error) {
    return (
      <PageShell
        title={t("history.title")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("history.title")}
          </span>
        }
      >
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">{error}</div>
          <Button variant="primary" onClick={() => loadAll()}>
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
      title={t("history.title")}
      breadcrumbs={
        <span className="title-h2 text-[var(--text)]">
          {t("history.title")}
        </span>
      }
    >
      <PageToolbar
        left={
          <>
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("history.searchPlaceholder")}
              className="min-w-[220px] h-10"
            />
            <SelectMenu
              value={chainFilter}
              onChange={setChainFilter}
              options={chainOptions}
              placeholderValue="ALL"
              className="min-w-[240px]"
            />
            <SelectMenu
              value={statusFilter}
              onChange={(value) =>
                setStatusFilter(value as "ALL" | TransactionStatus)
              }
              options={statusOptions}
              placeholderValue="ALL"
              className="min-w-[170px]"
            />
            <SelectMenu
              value={directionFilter}
              onChange={(value) =>
                setDirectionFilter(
                  value as "ALL" | "INCOMING" | "OUTGOING",
                )
              }
              options={directionOptions}
              placeholderValue="ALL"
              className="min-w-[150px]"
            />
            <SelectMenu
              value={tagFilter}
              onChange={setTagFilter}
              options={tagOptions}
              placeholderValue="ALL"
              className="min-w-[150px]"
            />
            {assetFilter && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-bg)] px-3 py-1 text-sm text-[var(--text)]">
                {assetFilter}
                <button
                  onClick={() => {
                    setAssetFilter(null);
                    searchParams.delete('asset');
                    setSearchParams(searchParams, { replace: true });
                  }}
                  className="ml-1 text-[var(--muted)] hover:text-[var(--text)]"
                  aria-label="Clear asset filter"
                >
                  ×
                </button>
              </span>
            )}
          </>
        }
        right={
          <Button
            variant="ghost"
            onClick={() => loadAll(true)}
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

      {/* No transactions at all */}
      {!hasTransactions && (
        <Card>
          <EmptyState title={t("common.noData")} />
        </Card>
      )}

      {/* Has transactions but filter yields nothing */}
      {isFilterEmpty && (
        <Card>
          <EmptyState
            title={t("history.noFilterResults")}
            description={t("history.adjustSearch")}
          />
        </Card>
      )}

      {/* Table with data */}
      {hasFilteredData && (
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className={COL.transaction}>
                  {t("history.transaction")}
                </TableHead>
                <TableHead className={COL.toFrom}>
                  {t("history.toFrom")}
                </TableHead>
                <TableHead className={COL.amount}>
                  {t("history.amount")}
                </TableHead>
                <TableHead className={COL.wallet}>
                  {t("history.wallet")}
                </TableHead>
                <TableHead className={COL.tags}>
                  {t("history.tags")}
                </TableHead>
                <TableHead align="center" className={COL.status}>
                  {t("tableHeaders.status")}
                </TableHead>
                <TableHead align="right" className={COL.time}>
                  {t("history.time")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentPageData.map((tx) => {
                const direction = inferDirection(tx);
                const isOutgoing = direction === "OUTGOING";
                const isCancellation = tx.tx_type === "CANCELLATION";
                const isPolicyChange = tx.tx_type === "SAFE_POLICY_CHANGE";

                const variant = TX_STATUS_VARIANT[tx.status] || "default";
                const showDot = TX_STATUS_DOT.has(tx.status);
                const statusLabel = statusLabelMap[tx.status] || tx.status;

                const symbol = getDisplaySymbol(
                  tx.token_symbol,
                  tx.wallet_chain,
                  tx.wallet_chain_id,
                );
                const displayAmount = isCancellation || isPolicyChange
                  ? "-"
                  : `${formatBalance(tx.amount, tx.token_decimals ?? 18, 8)} ${symbol}`;

                const toFromAddress = isOutgoing
                  ? tx.to_address
                  : tx.from_address || tx.to_address;

                const directionLabel = isOutgoing
                  ? t("wallet.send")
                  : t("wallet.receive");

                return (
                  <TableRow
                    key={tx.id}
                    onClick={() => navigate(`/transactions/${tx.id}`)}
                  >
                    {/* Col 1: Transaction — direction icon + label */}
                    <TableCell>
                      {isPolicyChange ? (
                        <Badge variant="info">{t("transactions.policyChangeTransaction")}</Badge>
                      ) : (
                        <span className="flex items-center gap-1 font-semibold">
                          {isOutgoing ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--danger)] shrink-0"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--success)] shrink-0"><path d="M17 7L7 17"/><path d="M17 17H7V7"/></svg>
                          )}
                          {directionLabel}
                        </span>
                      )}
                    </TableCell>

                    {/* Col 2: To / From — address or "-" */}
                    <TableCell>
                      {toFromAddress ? (
                        <div className="flex items-center gap-1">
                          <span
                            className="font-mono text-xs text-[var(--muted)] truncate"
                            title={toFromAddress}
                          >
                            {truncateAddress(toFromAddress)}
                          </span>
                          <CopyButton
                            value={toFromAddress}
                            stopPropagation
                          />
                        </div>
                      ) : (
                        <span className="text-[var(--muted)]">-</span>
                      )}
                    </TableCell>

                    {/* Col 3: Amount */}
                    <TableCell align="right">
                      {isCancellation || isPolicyChange ? (
                        <span className="text-[var(--muted)]">-</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono font-medium">
                            {displayAmount}
                          </span>
                        </div>
                      )}
                    </TableCell>

                    {/* Col 4: Wallet — chain dot + wallet name */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              tx.wallet_chain === "BTC"
                                ? "#F7931A"
                                : "#627EEA",
                          }}
                        />
                        <span className="truncate">
                          {tx.wallet_name}
                        </span>
                      </div>
                    </TableCell>

                    {/* Col 5: Local tags */}
                    <TableCell>
                      <button
                        type="button"
                        className="flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1 rounded-lg px-1 py-1 text-left hover:bg-[var(--row-head-bg)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          setTagTransactionId(tx.id);
                        }}
                        aria-label={t("history.manageTags")}
                      >
                        {(transactionTags[tx.id] || []).length === 0 ? (
                          <span className="text-xs text-[var(--muted)]">
                            + {t("history.addTag")}
                          </span>
                        ) : (
                          (transactionTags[tx.id] || []).slice(0, 2).map((tagId) => {
                            const tag = tags.find((item) => item.id === tagId);
                            if (!tag) return null;
                            return (
                              <span
                                key={tag.id}
                                className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                                style={{ backgroundColor: tag.color }}
                              >
                                <span className="max-w-20 truncate">{tag.name}</span>
                              </span>
                            );
                          })
                        )}
                        {(transactionTags[tx.id] || []).length > 2 && (
                          <span className="text-[10px] text-[var(--muted)]">
                            +{(transactionTags[tx.id] || []).length - 2}
                          </span>
                        )}
                      </button>
                    </TableCell>

                    {/* Col 6: Status */}
                    <TableCell align="center">
                      <Badge variant={variant} dot={showDot}>
                        {statusLabel}
                      </Badge>
                    </TableCell>

                    {/* Col 7: Time + tx_hash */}
                    <TableCell align="right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-xs text-[var(--muted)]" title={tx.confirmed_at || tx.created_at}>
                          {formatAbsoluteTime(tx.confirmed_at || tx.created_at, language, timeZone)}
                        </span>
                        {tx.tx_hash ? (
                          <a
                            href={getExplorerUrl(tx.tx_hash, tx.wallet_chain, tx.wallet_btc_network, tx.wallet_explorer_url)}
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
      <TransactionTagModal
        transactionId={tagTransactionId}
        onClose={() => setTagTransactionId(null)}
      />
    </PageShell>
  );
};
