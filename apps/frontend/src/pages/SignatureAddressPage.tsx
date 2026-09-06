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
import { useTranslation } from "../hooks/useTranslation";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { getSigners } from "../api";
import type { Signer } from "../types";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { CopyButton } from "../components/ui/CopyButton";
import { SOURCE_ICON_MAP, getSignerChainLabel, isSignerTestnetOnly } from "../utils/signer";
import { SIGNER_STATUS_VARIANT } from "../utils/status-variants";
import { truncateAddress } from "../utils/address";
import { ImportSignatureAddressModal } from "../components/SignatureAddress/ImportSignatureAddressModal";

const getSignerNetworkLabels = (
  signer: Signer,
  includeTestnets: boolean,
): string[] => {
  const walletNetworkLabels = (signer.wallets ?? [])
    .filter((wallet) => includeTestnets || !wallet.is_testnet)
    .map((wallet) => wallet.network_name?.trim())
    .filter((label): label is string => Boolean(label));

  if (walletNetworkLabels.length > 0) {
    return Array.from(new Set(walletNetworkLabels));
  }

  return [signer.btc_network?.trim() || getSignerChainLabel(signer)];
};

export const SignatureAddressPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showTestnets } = usePreferenceStore();

  // --- Data state ---
  const [signers, setSigners] = useState<Signer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // --- Filters ---
  const [searchText, setSearchText] = useState("");
  const [networkFilter, setNetworkFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "VERIFIED" | "UNVERIFIED" | "REVOKED"
  >("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  // --- Status label map (needs t()) ---
  const statusLabelMap: Record<string, string> = {
    VERIFIED: t("transactions.verified"),
    UNVERIFIED: t("transactions.unverified"),
    REVOKED: t("signatureAddress.statusRevoked"),
  };

  const visibleSigners = useMemo(
    () => showTestnets ? signers : signers.filter((signer) => !isSignerTestnetOnly(signer)),
    [signers, showTestnets],
  );

  const networkOptions = useMemo(() => {
    const labels = new Set(
      visibleSigners.flatMap((signer) =>
        getSignerNetworkLabels(signer, showTestnets),
      ),
    );

    return [
      { value: "ALL", label: t("wallet.allNetworks") },
      ...Array.from(labels)
        .sort()
        .map((label) => ({ value: label, label })),
    ];
  }, [visibleSigners, showTestnets, t]);

  // --- Source options (derived from data, stable deps) ---
  const sourceOptions = useMemo(() => {
    const sources = new Set(
      visibleSigners.map((item) => item.device_type).filter(Boolean)
    );
    return [
      { value: "ALL", label: t("signatureAddress.allDevices") },
      ...Array.from(sources).map((source) => ({
        value: source,
        label: SOURCE_ICON_MAP[source]?.label || source,
      })),
    ];
  }, [visibleSigners, t]);

  // --- Data fetching (useCallback) ---
  const fetchSigners = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);
        const response = await getSigners();
        setSigners(response.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common.loadFailed"));
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchSigners();
  }, [fetchSigners]);

  // --- Filtering ---
  const filteredSigners = useMemo(() => {
    return visibleSigners.filter((item) => {
      const matchSearch =
        !searchText ||
        item.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (item.address || "").toLowerCase().includes(searchText.toLowerCase()) ||
        (item.public_key || "")
          .toLowerCase()
          .includes(searchText.toLowerCase());
      if (!matchSearch) return false;

      const matchNetwork =
        networkFilter === "ALL" ||
        getSignerNetworkLabels(item, showTestnets).includes(networkFilter);
      if (!matchNetwork) return false;

      const matchStatus =
        statusFilter === "ALL" || item.status === statusFilter;
      if (!matchStatus) return false;

      const matchSource =
        sourceFilter === "ALL" || item.device_type === sourceFilter;
      if (!matchSource) return false;

      return true;
    });
  }, [visibleSigners, searchText, networkFilter, statusFilter, sourceFilter, showTestnets]);

  // --- Pagination (useMemo) ---
  const totalPages = Math.max(
    1,
    Math.ceil(filteredSigners.length / pageSize)
  );
  const currentPageData = useMemo(
    () =>
      filteredSigners.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
      ),
    [filteredSigners, currentPage, pageSize]
  );

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, networkFilter, statusFilter, sourceFilter, pageSize, showTestnets]);

  // --- State flags for empty / filter / error distinction ---
  const hasSigners = visibleSigners.length > 0;
  const hasFilteredData = currentPageData.length > 0;
  const isFilterEmpty = hasSigners && !hasFilteredData;

  // --- Chain dot color ---
  const chainDotColor = (chainType: string) =>
    chainType === "BTC" ? "#F7931A" : "#627EEA";

  const closeImportModal = () => {
    setImportModalOpen(false);
    void fetchSigners(true);
  };

  const handleSignerImported = (signerId: string) => {
    setImportModalOpen(false);
    navigate(`/signer/${signerId}`);
  };

  // =====================================================================
  //  Loading skeleton (first load only)
  // =====================================================================
  if (loading && !hasSigners) {
    return (
      <PageShell
        title={t("signatureAddress.title")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("signatureAddress.title")}
          </span>
        }
      >
        <PageToolbar left={<span />} />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">{t("tableHeaders.signatureAddress")}</TableHead>
                <TableHead className="w-[35%]">{t("tableHeaders.address")}</TableHead>
                <TableHead className="w-[20%]">{t("tableHeaders.source")}</TableHead>
                <TableHead align="center" className="w-[17%]">
                  {t("tableHeaders.status")}
                </TableHead>
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
                        <span className="inline-block w-16 h-3 rounded bg-[var(--row-head-bg)] animate-pulse" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-28 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="center">
                    <span className="inline-block w-16 h-5 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageShell>
    );
  }

  // =====================================================================
  //  Error state (independent, with Retry)
  // =====================================================================
  if (error && !hasSigners) {
    return (
      <PageShell
        title={t("signatureAddress.title")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("signatureAddress.title")}
          </span>
        }
      >
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">{error}</div>
          <Button variant="primary" onClick={() => fetchSigners()}>
            {t("common.retry")}
          </Button>
        </Card>
      </PageShell>
    );
  }

  // =====================================================================
  //  Main render
  // =====================================================================
  return (
      <PageShell
        title={t("signatureAddress.title")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("signatureAddress.title")}
          </span>
        }
      >
        <PageToolbar
          left={
            <>
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("signatureAddress.searchPlaceholder")}
                className="min-w-[220px] h-10"
              />
              <SelectMenu
                value={networkFilter}
                onChange={setNetworkFilter}
                options={networkOptions}
                placeholderValue="ALL"
                className="min-w-[240px]"
              />
              <SelectMenu
                value={statusFilter}
                onChange={(value) =>
                  setStatusFilter(
                    value as "ALL" | "VERIFIED" | "UNVERIFIED" | "REVOKED"
                  )
                }
                options={[
                  { value: "ALL", label: t("allStatus") },
                  {
                    value: "VERIFIED",
                    label: t("transactions.verified"),
                  },
                  {
                    value: "UNVERIFIED",
                    label: t("transactions.unverified"),
                  },
                  {
                    value: "REVOKED",
                    label: t("signatureAddress.statusRevoked"),
                  },
                ]}
                placeholderValue="ALL"
                className="min-w-[160px]"
              />
              <SelectMenu
                value={sourceFilter}
                onChange={setSourceFilter}
                options={sourceOptions}
                placeholderValue="ALL"
                className="min-w-[160px]"
              />
            </>
          }
          right={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => fetchSigners(true)}
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
              {hasSigners && (
                <Button
                  variant="primary"
                  onClick={() => setImportModalOpen(true)}
                >
                  {t("signatureAddress.importAddress")}
                </Button>
              )}
            </div>
          }
        />

        {/* No signers at all */}
        {!hasSigners && (
          <Card>
            <EmptyState
              title={t("common.noData")}
              action={
                <Button
                  variant="primary"
                  onClick={() => setImportModalOpen(true)}
                >
                  {t("signatureAddress.importAddress")}
                </Button>
              }
            />
          </Card>
        )}

        {/* Has signers but filter yields nothing */}
        {isFilterEmpty && (
          <Card>
            <EmptyState
              title={t("signatureAddress.noFilterResults")}
              description={t("signatureAddress.adjustFilters")}
            />
          </Card>
        )}

        {/* Table with data */}
        {hasFilteredData && (
          <Card>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%]">{t("tableHeaders.signatureAddress")}</TableHead>
                  <TableHead className="w-[35%]">{t("tableHeaders.address")}</TableHead>
                  <TableHead className="w-[20%]">{t("tableHeaders.source")}</TableHead>
                  <TableHead align="center" className="w-[17%]">
                    {t("tableHeaders.status")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentPageData.map((item) => {
                  const displayAddress =
                    item.address || item.public_key || "";
                  const displayChain = getSignerChainLabel(item);

                  return (
                    <TableRow
                      key={item.id}
                      onClick={() => navigate(`/signer/${item.id}`)}
                    >
                      {/* Signer: dual-row layout with chain color dot */}
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: chainDotColor(item.chain_type),
                            }}
                          />
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold">
                              {item.name}
                            </span>
                            <span className="text-xs text-[var(--muted)]">
                              {displayChain}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Address: truncated 8...6 */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[var(--muted)]">
                            {truncateAddress(displayAddress)}
                          </span>
                          {displayAddress && (
                            <CopyButton
                              value={displayAddress}
                              stopPropagation
                            />
                          )}
                        </div>
                      </TableCell>

                      {/* Source: icon + label */}
                      <TableCell>
                        {SOURCE_ICON_MAP[item.device_type] ? (
                          <div className="inline-flex items-center gap-2">
                            <img
                              src={SOURCE_ICON_MAP[item.device_type].icon}
                              alt={SOURCE_ICON_MAP[item.device_type].label}
                              title={SOURCE_ICON_MAP[item.device_type].label}
                              className="w-5 h-5 object-contain"
                            />
                            <span className="font-semibold">
                              {SOURCE_ICON_MAP[item.device_type].label}
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-[var(--row-head-bg)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--muted)]">?</span>
                            <span className="text-xs text-[var(--muted)]">
                              {item.device_type === 'UNKNOWN' ? 'Unknown Device' : item.device_type}
                            </span>
                          </div>
                        )}
                      </TableCell>

                      {/* Status: badge + verify button for UNVERIFIED */}
                      <TableCell align="center">
                        <div className="inline-flex items-center gap-2">
                          <Badge
                            variant={
                              SIGNER_STATUS_VARIANT[item.status] || "default"
                            }
                            dot={item.status === "UNVERIFIED"}
                          >
                            {statusLabelMap[item.status] || item.status}
                          </Badge>
                          {item.status === "UNVERIFIED" && (
                            <button
                              type="button"
                              className="text-[var(--accent)] text-xs font-bold hover:underline transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/signer/${item.id}/verify`);
                              }}
                            >
                              {t("signatureAddress.verify")}
                            </button>
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
        <ImportSignatureAddressModal
          isOpen={importModalOpen}
          onClose={closeImportModal}
          onImported={handleSignerImported}
        />
      </PageShell>
  );
};
