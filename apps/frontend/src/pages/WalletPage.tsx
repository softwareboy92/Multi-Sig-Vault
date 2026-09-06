import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  Button,
  Badge,
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
import { ReceiveModal, WalletTagModal } from "../components/wallet";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { getNetworks, getWalletAssets, getWallets } from "../api";
import type { NetworkConfig, Wallet } from "../types";
import { CopyButton } from "../components/ui/CopyButton";
import { getWalletChainLabel, getNativeSymbol, isWalletTestnet } from "../utils/wallet";
import { formatBalance } from "../utils/format";
import { WALLET_STATUS_VARIANT } from "../utils/status-variants";
import { useWalletTagStore } from "../stores/useWalletTagStore";

type WalletViewMode = "LIST" | "NETWORK" | "TAG";

export const WalletPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  // --- Data state ---
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [networkFilter, setNetworkFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | string>("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState<WalletViewMode>("LIST");
  const [groupFilter, setGroupFilter] = useState("ALL");

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  // --- Modal state ---
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveWallet, setReceiveWallet] = useState<Wallet | null>(null);
  const [tagWalletId, setTagWalletId] = useState<string | null>(null);
  const { tags, walletTags } = useWalletTagStore();

  // --- Network maps ---
  const [evmNetworksAll, setEvmNetworksAll] = useState<NetworkConfig[]>([]);
  const [btcNetworksAll, setBtcNetworksAll] = useState<NetworkConfig[]>([]);
  const { showTestnets } = usePreferenceStore();

  // --- Balance cache (wallet_id → { balance, symbol }) ---
  const [balanceMap, setBalanceMap] = useState<
    Record<string, { balance: string; symbol: string; decimals: number } | null>
  >({});

  // --- Static maps ---
  const statusLabelMap: Record<string, string> = {
    ACTIVE: t("wallet.statusActive"),
    PENDING_DEPLOY: t("wallet.statusPendingDeploy"),
    ARCHIVED: t("wallet.statusArchived"),
  };

  const statusOptions = [
    { value: "ALL", label: t("allStatus") },
    { value: "ACTIVE", label: statusLabelMap.ACTIVE },
    { value: "PENDING_DEPLOY", label: statusLabelMap.PENDING_DEPLOY },
    { value: "ARCHIVED", label: statusLabelMap.ARCHIVED },
  ];

  const tagOptions = useMemo(
    () => [
      { value: "ALL", label: t("wallet.allWalletTags") },
      { value: "UNTAGGED", label: t("wallet.untaggedWallets") },
      ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
    ],
    [tags, t],
  );

  // --- Network maps (memoized) ---
  const evmNetworkMap = useMemo(() => {
    const map = new Map<string, NetworkConfig>();
    evmNetworksAll.forEach((n) => map.set(n.id, n));
    return map;
  }, [evmNetworksAll]);

  const btcNetworkMap = useMemo(() => {
    const map = new Map<string, NetworkConfig>();
    btcNetworksAll.forEach((n) => map.set(n.id, n));
    return map;
  }, [btcNetworksAll]);

  const visibleWallets = useMemo(
    () =>
      showTestnets
        ? wallets
        : wallets.filter(
            (wallet) => !isWalletTestnet(wallet, evmNetworkMap, btcNetworkMap),
          ),
    [wallets, showTestnets, evmNetworkMap, btcNetworkMap],
  );

  const networkOptions = useMemo(() => {
    const usedNetworkIds = new Set(visibleWallets.map((w) => w.network_id));
    const opts: { value: string; label: string }[] = [
      { value: "ALL", label: t("wallet.allNetworks") },
    ];
    btcNetworksAll.forEach((n) => {
      if (usedNetworkIds.has(n.id)) opts.push({ value: n.id, label: n.name });
    });
    evmNetworksAll.forEach((n) => {
      if (usedNetworkIds.has(n.id)) opts.push({ value: n.id, label: n.name });
    });
    return opts;
  }, [btcNetworksAll, evmNetworksAll, visibleWallets, t]);

  const groupOptions = useMemo(
    () => (viewMode === "NETWORK" ? networkOptions : tagOptions),
    [viewMode, networkOptions, tagOptions],
  );

  // --- Data fetching ---
  const fetchWallets = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
          setWalletError(null);
        }
        const response = await getWallets();
        setWallets(response.items || []);
        if (isRefresh) setWalletError(null);
      } catch (err) {
        setWalletError(
          err instanceof Error ? err.message : "Failed to load wallets"
        );
      } finally {
        if (isRefresh) setIsRefreshing(false);
        else setLoading(false);
      }
    },
    []
  );

  const fetchEvmNetworks = useCallback(async () => {
    try {
      const networks = await getNetworks("EVM");
      setEvmNetworksAll(networks || []);
    } catch (err) {
      setEvmNetworksAll([]);
      showToast(
        err instanceof Error ? err.message : t("walletModal.errorLoadNetworks"),
        "warning"
      );
    }
  }, [showToast, t]);

  const fetchBtcNetworks = useCallback(async () => {
    try {
      const networks = await getNetworks("BTC");
      setBtcNetworksAll(networks || []);
    } catch (err) {
      setBtcNetworksAll([]);
      showToast(
        err instanceof Error ? err.message : t("walletModal.errorLoadNetworks"),
        "warning"
      );
    }
  }, [showToast, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setWalletError(null);
        const response = await getWallets();
        if (cancelled) return;
        setWallets(response.items || []);
      } catch (err) {
        if (cancelled) return;
        setWalletError(
          err instanceof Error ? err.message : "Failed to load wallets"
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetchEvmNetworks();
    fetchBtcNetworks();
  }, [fetchEvmNetworks, fetchBtcNetworks]);

  // --- Async balance loading ---
  useEffect(() => {
    if (wallets.length === 0) return;
    const activeWallets = visibleWallets.filter((w) => w.status === "ACTIVE");
    if (activeWallets.length === 0) return;

    let cancelled = false;

    const loadBalances = async () => {
      const results: Record<
        string,
        { balance: string; symbol: string; decimals: number } | null
      > = {};

      await Promise.allSettled(
        activeWallets.map(async (w) => {
          try {
            const assets = await getWalletAssets(w.id);
            const native = assets?.find((a) => a.is_native);
            if (native) {
              const evmChainId = w.chain_type === "EVM"
                ? evmNetworksAll.find((n) => n.id === w.network_id)?.chain_id ?? null
                : null;
              results[w.id] = {
                balance: native.balance,
                symbol: native.symbol || getNativeSymbol(w.chain_type, evmChainId),
                decimals: native.decimals,
              };
            } else {
              results[w.id] = null;
            }
          } catch {
            results[w.id] = null;
          }
        })
      );

      if (!cancelled) {
        setBalanceMap((prev) => ({ ...prev, ...results }));
      }
    };

    loadBalances();
    return () => {
      cancelled = true;
    };
  }, [visibleWallets, evmNetworksAll]);

  // --- Modal handlers ---
  const openReceiveModal = (wallet: Wallet) => {
    setReceiveWallet(wallet);
    setShowReceiveModal(true);
  };

  // --- Filtering & pagination ---
  const filteredWallets = useMemo(() => {
    return visibleWallets.filter((w) => {
      const matchSearch =
        !searchText ||
        w.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (w.address || "").toLowerCase().includes(searchText.toLowerCase());
      if (!matchSearch) return false;

      const effectiveNetworkFilter =
        viewMode === "NETWORK"
          ? groupFilter
          : viewMode === "LIST"
            ? networkFilter
            : "ALL";
      const matchNetwork =
        effectiveNetworkFilter === "ALL" ||
        w.network_id === effectiveNetworkFilter;
      if (!matchNetwork) return false;

      const matchStatus =
        statusFilter === "ALL" || w.status === statusFilter;
      if (!matchStatus) return false;

      const tagIds = walletTags[w.id] || [];
      const effectiveTagFilter =
        viewMode === "TAG"
          ? groupFilter
          : viewMode === "LIST"
            ? tagFilter
            : "ALL";
      return (
        effectiveTagFilter === "ALL" ||
        (effectiveTagFilter === "UNTAGGED"
          ? tagIds.length === 0
          : tagIds.includes(effectiveTagFilter))
      );
    });
  }, [visibleWallets, searchText, networkFilter, statusFilter, tagFilter, walletTags, viewMode, groupFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredWallets.length / pageSize)
  );

  const currentPageData = useMemo(
    () =>
      filteredWallets.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
      ),
    [filteredWallets, currentPage, pageSize]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, networkFilter, statusFilter, tagFilter, viewMode, groupFilter, showTestnets]);

  useEffect(() => {
    if (!networkOptions.some((option) => option.value === networkFilter)) {
      setNetworkFilter("ALL");
    }
  }, [networkFilter, networkOptions]);

  useEffect(() => {
    if (
      viewMode !== "LIST" &&
      !groupOptions.some((option) => option.value === groupFilter)
    ) {
      setGroupFilter("ALL");
    }
  }, [groupFilter, groupOptions, viewMode]);

  const changeViewMode = (mode: WalletViewMode) => {
    setViewMode(mode);
    setGroupFilter("ALL");
    setCurrentPage(1);
  };

  const getGroupCount = (value: string) => {
    if (value === "ALL") return visibleWallets.length;
    if (viewMode === "NETWORK") {
      return visibleWallets.filter((wallet) => wallet.network_id === value).length;
    }
    if (value === "UNTAGGED") {
      return visibleWallets.filter(
        (wallet) => (walletTags[wallet.id] || []).length === 0,
      ).length;
    }
    return visibleWallets.filter((wallet) =>
      (walletTags[wallet.id] || []).includes(value),
    ).length;
  };



  // --- Render helpers ---
  const renderBalanceCell = (wallet: Wallet) => {
    if (wallet.status !== "ACTIVE") return <span className="text-[var(--muted)]">—</span>;
    const entry = balanceMap[wallet.id];
    if (entry === undefined) {
      // Still loading
      return (
        <span className="inline-block w-16 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
      );
    }
    if (entry === null) return <span className="text-[var(--muted)]">—</span>;
    const formatted = formatBalance(entry.balance, entry.decimals, 6);
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="font-mono">
          {formatted} {entry.symbol}
        </span>
      </div>
    );
  };

  // --- Loading skeleton ---
  if (loading) {
    return (
      <PageShell
        title={t("wallet.listTitle")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("wallet.listTitle")}
          </span>
        }
      >
        <PageToolbar left={<span />} />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22%]">{t("tableHeaders.wallet")}</TableHead>
                <TableHead className="w-[22%]">{t("tableHeaders.address")}</TableHead>
                <TableHead align="right" className="w-[17%]">{t("tableHeaders.balance")}</TableHead>
                <TableHead className="w-[15%]">{t("wallet.walletTags")}</TableHead>
                <TableHead align="center" className="w-[12%]">{t("tableHeaders.status")}</TableHead>
                <TableHead align="center" className="w-[12%]">{t("tableHeaders.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[var(--row-head-bg)] animate-pulse" />
                      <div className="flex flex-col gap-1">
                        <span className="inline-block w-24 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                        <span className="inline-block w-20 h-3 rounded bg-[var(--row-head-bg)] animate-pulse" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-28 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="right">
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-16 h-5 rounded-full bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="center">
                    <span className="inline-block w-16 h-5 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="center">
                    <span className="inline-block w-14 h-5 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageShell>
    );
  }

  // --- Error state (wallet-level only) ---
  if (walletError) {
    return (
      <PageShell
        title={t("wallet.listTitle")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("wallet.listTitle")}
          </span>
        }
      >
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">{walletError}</div>
          <Button variant="primary" onClick={() => fetchWallets()}>
            {t("common.retry")}
          </Button>
        </Card>
      </PageShell>
    );
  }

  // --- Distinguish empty states ---
  const hasWallets = visibleWallets.length > 0;
  const hasFilteredData = currentPageData.length > 0;
  const isFilterEmpty = hasWallets && !hasFilteredData;

  return (
    <>
      <PageShell
        title={t("wallet.listTitle")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("wallet.listTitle")}
          </span>
        }
      >
        <div
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--panel)] p-1"
          role="tablist"
          aria-label={t("wallet.walletView")}
        >
          {(
            [
              ["LIST", t("wallet.listView")],
              ["NETWORK", t("wallet.groupByNetwork")],
              ["TAG", t("wallet.groupByTag")],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={viewMode === mode}
              onClick={() => changeViewMode(mode)}
              className={`min-h-10 rounded-[calc(var(--field-radius)-0.2rem)] px-4 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                viewMode === mode
                  ? "bg-[var(--accent)] text-[var(--on-accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--row-head-bg)] hover:text-[var(--text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <PageToolbar
          left={
            <>
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("wallet.searchPlaceholder")}
                className="min-w-[220px] h-10"
              />
              {viewMode === "LIST" && (
                <SelectMenu
                  value={networkFilter}
                  onChange={setNetworkFilter}
                  options={networkOptions}
                  placeholderValue="ALL"
                  className="min-w-[160px]"
                />
              )}
              <SelectMenu
                value={statusFilter}
                onChange={setStatusFilter}
                options={statusOptions}
                placeholderValue="ALL"
                className="min-w-[160px]"
              />
              {viewMode === "LIST" && (
                <SelectMenu
                  value={tagFilter}
                  onChange={setTagFilter}
                  options={tagOptions}
                  placeholderValue="ALL"
                  className="min-w-[170px]"
                />
              )}
            </>
          }
          right={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  fetchWallets(true);
                  fetchEvmNetworks();
                  fetchBtcNetworks();
                }}
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
              {hasWallets && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => navigate("/wallet/import")}
                  >
                    {t("wallet.importExisting")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => navigate("/wallet/create")}
                  >
                    {t("wallet.createWallet")}
                  </Button>
                </>
              )}
            </div>
          }
        />

        {/* No wallets at all */}
        {!hasWallets && (
          <Card>
            <EmptyState
              title={t("common.noData")}
              action={
                <div className="flex gap-3 justify-center">
                  <Button
                    variant="secondary"
                    onClick={() => navigate("/wallet/import")}
                  >
                    {t("wallet.importExisting")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => navigate("/wallet/create")}
                  >
                    {t("wallet.createWallet")}
                  </Button>
                </div>
              }
            />
          </Card>
        )}

        {hasWallets && (
          <div
            className={`grid min-w-0 gap-4 ${
              viewMode === "LIST"
                ? "grid-cols-1"
                : "grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)]"
            }`}
          >
            {viewMode !== "LIST" && (
              <Card className="h-fit min-w-0 p-2 lg:sticky lg:top-6">
                <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {viewMode === "NETWORK"
                    ? t("wallet.networkGroups")
                    : t("wallet.tagGroups")}
                </div>
                <div
                  className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
                  role="navigation"
                  aria-label={
                    viewMode === "NETWORK"
                      ? t("wallet.networkGroups")
                      : t("wallet.tagGroups")
                  }
                >
                  {groupOptions.map((option) => {
                    const active = groupFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => setGroupFilter(option.value)}
                        className={`flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-[var(--field-radius)] px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:w-full ${
                          active
                            ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                            : "text-[var(--muted)] hover:bg-[var(--row-head-bg)] hover:text-[var(--text)]"
                        }`}
                      >
                        <span className="max-w-36 truncate">{option.label}</span>
                        <span className="rounded-full bg-[var(--row-head-bg)] px-2 py-0.5 text-xs tabular-nums text-[var(--muted)]">
                          {getGroupCount(option.value)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            <div className="min-w-0">
              {/* Has wallets but filter yields nothing */}
              {isFilterEmpty && (
                <Card>
                  <EmptyState
                    title={t("wallet.noFilterResults")}
                    description={t("wallet.adjustFilters")}
                  />
                </Card>
              )}

              {/* Table with data */}
              {hasFilteredData && (
                <Card>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">{t("tableHeaders.wallet")}</TableHead>
                  <TableHead className="w-[22%]">{t("tableHeaders.address")}</TableHead>
                  <TableHead align="right" className="w-[17%]">
                    {t("tableHeaders.balance")}
                  </TableHead>
                  <TableHead className="w-[15%]">
                    {t("wallet.walletTags")}
                  </TableHead>
                  <TableHead align="center" className="w-[12%]">
                    {t("tableHeaders.status")}
                  </TableHead>
                  <TableHead align="center" className="w-[12%]">
                    {t("tableHeaders.action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentPageData.map((wallet) => {
                  const chainLabel = getWalletChainLabel(
                    wallet,
                    evmNetworkMap as Map<string, { name: string }>,
                    btcNetworkMap as Map<string, { btc_network?: string; network?: string }>
                  );
                  const isArchived = wallet.status === "ARCHIVED";

                  return (
                    <TableRow
                      key={wallet.id}
                      className={`${
                        isArchived ? "opacity-60" : ""
                      }`}
                      onClick={() => navigate(`/wallet/${wallet.id}`)}
                    >
                      {/* Wallet: dual-row layout with chain color dot */}
                      <TableCell>
                        <div className="flex items-center gap-3.5">
                          <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--field-radius)] border text-sm font-extrabold shadow-sm"
                            style={{
                              backgroundColor:
                                wallet.chain_type === "BTC"
                                  ? "color-mix(in srgb, #F7931A 14%, var(--panel))"
                                  : "color-mix(in srgb, #627EEA 14%, var(--panel))",
                              borderColor:
                                wallet.chain_type === "BTC"
                                  ? "color-mix(in srgb, #F7931A 45%, transparent)"
                                  : "color-mix(in srgb, #627EEA 45%, transparent)",
                              color: wallet.chain_type === "BTC" ? "#F7931A" : "#7795ff",
                            }}
                          >
                            {wallet.chain_type === "BTC" ? "B" : "E"}
                          </span>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[1.04em] font-bold">
                              {wallet.name}
                            </span>
                            <span className="text-[0.82em] text-[var(--muted)]">
                              {chainLabel} · {wallet.threshold}/
                              {wallet.signer_count}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Address: 8...6 or awaiting deployment */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {wallet.address ? (
                            <>
                              <span className="font-mono text-[0.86em] text-[var(--muted)]">
                                {wallet.address.slice(0, 8)}...
                                {wallet.address.slice(-6)}
                              </span>
                              <CopyButton
                                value={wallet.address}
                                stopPropagation
                              />
                            </>
                          ) : (
                            <span className="italic text-[0.86em] text-[var(--muted)]">
                              {t("wallet.awaitingDeployment")}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Balance (new column) */}
                      <TableCell align="right">
                        {renderBalanceCell(wallet)}
                      </TableCell>

                      {/* Local wallet tags */}
                      <TableCell>
                        <button
                          type="button"
                          className="flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1 rounded-lg px-1 py-1 text-left hover:bg-[var(--row-head-bg)]"
                          onClick={(event) => {
                            event.stopPropagation();
                            setTagWalletId(wallet.id);
                          }}
                          aria-label={t("wallet.manageWalletTags")}
                        >
                          {(walletTags[wallet.id] || []).length === 0 ? (
                            <span className="text-xs text-[var(--muted)]">
                              + {t("wallet.addWalletTag")}
                            </span>
                          ) : (
                            <>
                              {(walletTags[wallet.id] || []).slice(0, 2).map((tagId) => {
                                const tag = tags.find((item) => item.id === tagId);
                                if (!tag) return null;
                                return (
                                  <span
                                    key={tag.id}
                                    className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                                    style={{ backgroundColor: tag.color }}
                                  >
                                    <span className="max-w-20 truncate">{tag.name}</span>
                                  </span>
                                );
                              })}
                              {(walletTags[wallet.id] || []).length > 2 && (
                                <span className="text-[10px] text-[var(--muted)]">
                                  +{(walletTags[wallet.id] || []).length - 2}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      </TableCell>

                      {/* Status */}
                      <TableCell
                        align="center"
                        className="min-w-[100px]"
                      >
                        <Badge
                          variant={WALLET_STATUS_VARIANT[wallet.status] || "default"}
                          dot={wallet.status === "PENDING_DEPLOY"}
                        >
                          {statusLabelMap[wallet.status] || wallet.status}
                        </Badge>
                      </TableCell>

                      {/* Action: icon buttons */}
                      <TableCell
                        align="center"
                        className="min-w-[80px] whitespace-nowrap"
                      >
                        {(() => {
                          const isBtc = wallet.chain_type === "BTC";
                          const belowThreshold = isBtc
                            ? (wallet.verified_signer_count ?? 0) < wallet.signer_count
                            : (wallet.verified_signer_count ?? 0) < wallet.threshold;
                          const notActive = wallet.status !== "ACTIVE";
                          const disabled = notActive || belowThreshold;
                          const tip = belowThreshold
                            ? isBtc
                              ? t("wallet.btcAllSignersRequired", {
                                  verified: String(wallet.verified_signer_count ?? 0),
                                  total: String(wallet.signer_count),
                                })
                              : t("wallet.signerVerifyRequired", {
                                  verified: String(wallet.verified_signer_count ?? 0),
                                  threshold: String(wallet.threshold),
                                })
                            : undefined;
                          return (
                            <div className="flex items-center justify-center gap-1.5 w-full">
                              <button
                                type="button"
                                className="w-9 h-9 rounded-[var(--field-radius)] border border-[var(--accent)]/20 inline-flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/wallet/${wallet.id}/send`);
                                }}
                                disabled={disabled}
                                aria-label={t("wallet.send")}
                                title={tip ?? t("wallet.send")}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <line x1="7" y1="17" x2="17" y2="7" />
                                  <polyline points="7 7 17 7 17 17" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="w-9 h-9 rounded-[var(--field-radius)] border border-[var(--accent)]/20 inline-flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openReceiveModal(wallet);
                                }}
                                disabled={disabled}
                                aria-label={t("wallet.receive")}
                                title={tip ?? t("wallet.receive")}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <line x1="17" y1="7" x2="7" y2="17" />
                                  <polyline points="17 17 7 17 7 7" />
                                </svg>
                              </button>
                            </div>
                          );
                        })()}
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
            </div>
          </div>
        )}
      </PageShell>

      <ReceiveModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        wallet={receiveWallet}
      />
      <WalletTagModal
        walletId={tagWalletId}
        onClose={() => setTagWalletId(null)}
      />
    </>
  );
};
