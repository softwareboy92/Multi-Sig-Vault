import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
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
import { useTranslation } from "../hooks/useTranslation";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { usePendingStore } from "../stores/usePendingStore";
import { validateAddress, truncateAddress } from "../utils/address";
import {
  createAddressBook,
  deleteAddressBook,
  getAddressBook,
  updateAddressBook,
} from "../api";
import type {
  AddressBookCreate,
  AddressBookEntry,
  AddressBookUpdate,
} from "../types";

// ---------------------------------------------------------------------------
// Column widths — consistent with HistoryPage / AssetsPage pattern
// ---------------------------------------------------------------------------
const COL = {
  name: "w-[18%]",
  chain: "w-[14%]",
  address: "w-[32%]",
  note: "w-[24%]",
  action: "w-[12%]",
};

// ---------------------------------------------------------------------------
// Chain dot color
// ---------------------------------------------------------------------------
const CHAIN_DOT_COLOR: Record<string, string> = {
  BTC: "#F7931A",
  EVM: "#627EEA",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const AddressPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { showTestnets } = usePreferenceStore();
  const { requestRefresh } = usePendingStore();
  const { pageSize } = useAdaptivePageSize({ rowHeight: 65, fixedOffset: 280 });

  // ---- data state ----
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- filter / pagination ----
  const [searchText, setSearchText] = useState("");
  const [chainFilter, setChainFilter] = useState<"ALL" | "BTC" | "EVM">(
    "ALL",
  );
  const [currentPage, setCurrentPage] = useState(1);

  // ---- CRUD modal ----
  const quickAdd = searchParams.get("add") === "1";
  const requestedChain = searchParams.get("chain") === "BTC" ? "BTC" : "EVM";
  const requestedBtcNetwork = searchParams.get("btc_network") || undefined;
  const [modalOpen, setModalOpen] = useState(quickAdd);
  const [editingEntry, setEditingEntry] = useState<AddressBookEntry | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<AddressBookCreate>({
    name: "",
    address: "",
    chain_type: requestedChain,
    btc_network: requestedChain === "BTC" ? requestedBtcNetwork : undefined,
    note: "",
  });

  // ---- delete confirm modal ----
  const [deleteTarget, setDeleteTarget] = useState<AddressBookEntry | null>(
    null,
  );

  // ---- data fetching ----
  const loadEntries = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await getAddressBook();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ---- filtering ----
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (chainFilter !== "ALL" && entry.chain_type !== chainFilter)
        return false;
      if (!searchText.trim()) return true;
      const keyword = searchText.toLowerCase();
      return (
        entry.name.toLowerCase().includes(keyword) ||
        entry.address.toLowerCase().includes(keyword) ||
        (entry.note || "").toLowerCase().includes(keyword)
      );
    });
  }, [entries, searchText, chainFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const currentPageData = useMemo(
    () =>
      filteredEntries.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
    [filteredEntries, currentPage, pageSize],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, chainFilter]);

  const hasEntries = entries.length > 0;
  const hasFilteredData = filteredEntries.length > 0;
  const isFilterEmpty = hasEntries && !hasFilteredData;

  // ---- CRUD helpers ----
  const openModal = (entry?: AddressBookEntry) => {
    setEditingEntry(entry || null);
    setFormError(null);
    setForm({
      name: entry?.name || "",
      address: entry?.address || "",
      chain_type: entry?.chain_type || "EVM",
      btc_network: entry?.btc_network ?? undefined,
      note: entry?.note || "",
    });
    setModalOpen(true);
  };

  const saveEntry = async () => {
    if (!form.name.trim() || !form.address.trim()) return;
    if (form.chain_type === "BTC" && !form.btc_network) {
      setFormError(t("address.errorBtcNetworkRequired"));
      return;
    }
    const validation = validateAddress(
      form.chain_type,
      form.address,
      form.btc_network,
    );
    if (!validation.valid && validation.errorKey) {
      setFormError(t(validation.errorKey));
      return;
    }
    try {
      if (editingEntry) {
        await updateAddressBook(editingEntry.id, form as AddressBookUpdate);
      } else {
        await createAddressBook(form);
        requestRefresh();
      }
      setModalOpen(false);
      await loadEntries(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAddressBook(deleteTarget.id);
      setDeleteTarget(null);
      await loadEntries(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleteTarget(null);
    }
  };

  // ---- chain label helper ----
  const buildChainLabel = (entry: AddressBookEntry) => {
    const network = entry.btc_network ? `-${entry.btc_network}` : "";
    return `${entry.chain_type}${network}`;
  };

  // ===========================================================================
  // Loading skeleton
  // ===========================================================================
  if (loading) {
    return (
      <PageShell
        title={t("address.title")}
        breadcrumbs={
          <span className="title-h2 text-[var(--text)]">
            {t("nav.addressBook")}
          </span>
        }
      >
        <PageToolbar
          left={
            <>
              <Input
                value=""
                readOnly
                placeholder={t("address.searchPlaceholder")}
                className="min-w-[220px] h-10"
              />
              <SelectMenu
                value="ALL"
                onChange={() => {}}
                options={[{ value: "ALL", label: t("allChains") }]}
                className="min-w-[140px]"
              />
            </>
          }
        />
        <Card>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className={COL.name}>
                  {t("tableHeaders.name")}
                </TableHead>
                <TableHead className={COL.chain}>
                  {t("tableHeaders.chain")}
                </TableHead>
                <TableHead className={COL.address}>
                  {t("tableHeaders.address")}
                </TableHead>
                <TableHead className={COL.note}>
                  {t("address.note")}
                </TableHead>
                <TableHead align="center" className={COL.action}>
                  {t("tableHeaders.action")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-14 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-32 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell>
                    <span className="inline-block w-24 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                  <TableCell align="right">
                    <span className="inline-block w-20 h-4 rounded bg-[var(--row-head-bg)] animate-pulse" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageShell>
    );
  }

  // ===========================================================================
  // Main render
  // ===========================================================================
  return (
    <PageShell
      title={t("address.title")}
      breadcrumbs={
        <span className="title-h2 text-[var(--text)]">
          {t("nav.addressBook")}
        </span>
      }
    >
      <PageToolbar
        left={
          <>
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("address.searchPlaceholder")}
              className="min-w-[220px] h-10"
            />
            <SelectMenu
              value={chainFilter}
              onChange={(v) => setChainFilter(v as "ALL" | "BTC" | "EVM")}
              options={[
                { value: "ALL", label: t("allChains") },
                { value: "BTC", label: "BTC" },
                { value: "EVM", label: "EVM" },
              ]}
              className="min-w-[140px]"
            />
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => loadEntries(true)}
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
            {hasEntries && (
              <Button variant="primary" onClick={() => openModal()}>
                {t("address.addAddress")}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="text-sm text-[var(--danger)] mb-3 px-1">{error}</div>
      )}

      <Card>
        {!hasEntries ? (
          <EmptyState
            title={t("address.noData")}
            action={
              <Button variant="primary" onClick={() => openModal()}>
                {t("address.addAddress")}
              </Button>
            }
          />
        ) : isFilterEmpty ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          <>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className={COL.name}>
                    {t("tableHeaders.name")}
                  </TableHead>
                  <TableHead className={COL.chain}>
                    {t("tableHeaders.chain")}
                  </TableHead>
                  <TableHead className={COL.address}>
                    {t("tableHeaders.address")}
                  </TableHead>
                  <TableHead className={COL.note}>
                    {t("address.note")}
                  </TableHead>
                  <TableHead align="center" className={COL.action}>
                    {t("tableHeaders.action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentPageData.map((entry) => (
                  <TableRow key={entry.id} className="group">
                    {/* Name */}
                    <TableCell>
                      <span className="font-semibold truncate block">
                        {entry.name}
                      </span>
                    </TableCell>

                    {/* Chain */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              CHAIN_DOT_COLOR[entry.chain_type] ||
                              "var(--muted)",
                          }}
                        />
                        <span>
                          {buildChainLabel(entry)}
                        </span>
                      </div>
                    </TableCell>

                    {/* Address — truncated + copy */}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span
                          className="font-mono text-xs text-[var(--muted)] truncate"
                          title={entry.address}
                        >
                          {truncateAddress(entry.address)}
                        </span>
                        <CopyButton value={entry.address} />
                      </div>
                    </TableCell>

                    {/* Note */}
                    <TableCell>
                      <span
                        className="text-[var(--muted)] truncate block"
                        title={entry.note || ""}
                      >
                        {entry.note || "-"}
                      </span>
                    </TableCell>

                    {/* Actions — visible on row hover */}
                    <TableCell align="center">
                      <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-fast">
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg inline-flex items-center justify-center bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                          onClick={() => openModal(entry)}
                          aria-label={t("common.edit")}
                          title={t("common.edit")}
                        >
                          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg inline-flex items-center justify-center bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors"
                          onClick={() => setDeleteTarget(entry)}
                          aria-label={t("common.delete")}
                          title={t("common.delete")}
                        >
                          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              prevLabel={t("common.prev")}
              nextLabel={t("common.next")}
            />
          </>
        )}
      </Card>

      {/* ================================================================= */}
      {/* Create / Edit Modal                                               */}
      {/* ================================================================= */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          editingEntry ? t("address.editAddress") : t("address.addAddress")
        }
        panelClassName="address-book-modal"
      >
        <div className="address-book-form space-y-4">
          {formError && (
            <div className="text-sm text-[var(--danger)]">{formError}</div>
          )}
          <Input
            label={t("address.name")}
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder={t("address.namePlaceholder")}
          />
          <Input
            label={t("address.address")}
            value={form.address}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, address: e.target.value }))
            }
            placeholder={t("address.addressPlaceholder")}
          />

          {/* Chain — SelectMenu */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-[var(--text)]">
              {t("address.chain")}
            </label>
            <SelectMenu
              value={form.chain_type}
              onChange={(v) => {
                const chain = v as "BTC" | "EVM";
                setForm((prev) => ({
                  ...prev,
                  chain_type: chain,
                  btc_network:
                    chain === "BTC"
                      ? prev.btc_network || "mainnet"
                      : undefined,
                }));
              }}
              options={[
                { value: "EVM", label: "EVM" },
                { value: "BTC", label: "BTC" },
              ]}
              className="min-w-[140px]"
            />
          </div>

          {/* BTC Network — SelectMenu (conditional) */}
          {form.chain_type === "BTC" && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-[var(--text)]">
                {t("address.btcNetwork")}
              </label>
              <SelectMenu
                value={form.btc_network || "mainnet"}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, btc_network: v }))
                }
                options={[
                  { value: "mainnet", label: "mainnet" },
                  ...(showTestnets
                    ? [
                        { value: "testnet3", label: "testnet3" },
                        { value: "testnet4", label: "testnet4" },
                      ]
                    : []),
                ]}
                className="min-w-[140px]"
              />
            </div>
          )}

          {/* Note */}
          <Input
            label={t("address.note")}
            value={form.note || ""}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, note: e.target.value }))
            }
            placeholder={t("address.notePlaceholder")}
          />

          <div className="flex gap-2 justify-end border-t border-[var(--border)] pt-4">
            <Button
              variant="ghost"
              className="address-book-cancel"
              onClick={() => setModalOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={saveEntry}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================= */}
      {/* Delete Confirm Modal                                              */}
      {/* ================================================================= */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t("address.confirmDelete")}
        description={t("address.confirmDeleteDesc", {
          name: deleteTarget?.name || "",
        })}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
      />
    </PageShell>
  );
};
