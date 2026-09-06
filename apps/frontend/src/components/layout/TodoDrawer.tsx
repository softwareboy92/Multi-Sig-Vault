import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { usePendingStore } from "../../stores/usePendingStore";
import type { TimeFilter } from "../../stores/usePendingStore";
import { Drawer, SelectMenu } from "../ui";
import { TodoCard } from "./TodoCard";
import { useTranslation } from "../../hooks/useTranslation";
import { usePreferenceStore } from "../../stores/usePreferenceStore";

export const TodoDrawer: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showTestnets } = usePreferenceStore();

  const {
    items,
    loading,
    error,
    isOpen,
    setOpen,
    chainFilter,
    statusFilter,
    timeFilter,
    setChainFilter,
    setStatusFilter,
    setTimeFilter,
    fetchPending,
    refreshToken,
  } = usePendingStore();

  // Respond to external refreshes (from action handlers after mutations)
  const fetchRef = useRef(fetchPending);
  useEffect(() => {
    fetchRef.current = fetchPending;
  }, [fetchPending]);

  useEffect(() => {
    // Silent re-fetch when refreshToken changes (external trigger)
    fetchRef.current(true);
  }, [refreshToken]);

  // --- Filter options ---
  const visibleItems = useMemo(
    () => showTestnets ? items : items.filter((item) => !item.is_testnet),
    [items, showTestnets],
  );

  const chainOptions = useMemo(() => {
    const labels = new Set(visibleItems.map((item) => item.network_name));
    return [
      { value: "ALL", label: t("allChains") },
      ...Array.from(labels).map((label) => ({ value: label, label })),
    ];
  }, [visibleItems, t]);

  const statusOptions = [
    { value: "ALL", label: t("allStatus") },
    { value: "PENDING_SIGN", label: t("transactions.statusPendingSign") },
    { value: "PARTIALLY_SIGNED", label: t("transactions.statusPartiallySigned") },
    { value: "SIGNED", label: t("transactions.statusSigned") },
    { value: "PENDING_DEPLOY", label: t("wallet.statusPendingDeploy") },
  ];

  const timeOptions = [
    { value: "ALL", label: t("topbar.timeAll") },
    { value: "24H", label: t("topbar.time24h") },
    { value: "7D", label: t("topbar.time7d") },
    { value: "30D", label: t("topbar.time30d") },
  ];

  // --- Computed filtered list ---
  const filteredItems = useMemo(() => {
    const now = Date.now();
    return visibleItems.filter((item) => {
      if (chainFilter !== "ALL" && item.network_name !== chainFilter) return false;
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (timeFilter !== "ALL") {
        const delta = now - new Date(item.created_at).getTime();
        const within =
          timeFilter === "24H"
            ? delta <= 24 * 60 * 60 * 1000
            : timeFilter === "7D"
            ? delta <= 7 * 24 * 60 * 60 * 1000
            : delta <= 30 * 24 * 60 * 60 * 1000;
        if (!within) return false;
      }
      return true;
    });
  }, [visibleItems, chainFilter, statusFilter, timeFilter]);

  const handleCardClick = useCallback(
    (item: (typeof items)[0]) => {
      setOpen(false);
      if (item.action_type === "pending_sign" || item.action_type === "pending_broadcast") {
        navigate(`/transactions/${item.id}`);
      } else {
        navigate(`/wallet/${item.wallet_id}`);
      }
    },
    [navigate, setOpen]
  );

  const handleRefresh = useCallback(() => {
    fetchPending(false);
  }, [fetchPending]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      title={t("topbar.todo")}
    >
      <div className="flex flex-col h-full">
        {/* Filter bar */}
        <div className="px-1 pb-4">
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
            <SelectMenu
              value={chainFilter}
              onChange={setChainFilter}
              options={chainOptions}
              placeholderValue="ALL"
              className="min-h-[var(--field-height)]"
            />
            <SelectMenu
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusOptions}
              placeholderValue="ALL"
              className="min-h-[var(--field-height)]"
            />
            <SelectMenu
              value={timeFilter}
              onChange={(v) => setTimeFilter(v as TimeFilter)}
              options={timeOptions}
              placeholderValue="ALL"
              className="min-h-[var(--field-height)]"
            />
          </div>
        </div>

        {/* Card list */}
        <div className="flex-1 space-y-3 overflow-y-auto px-1 pb-3 custom-scrollbar">
          {loading ? (
            <div className="py-10 text-center text-[var(--font-body)] text-[var(--muted)]">
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="py-10 text-center text-[var(--font-body)] text-[var(--danger)]">
              {error}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-10 text-center text-[var(--font-body)] text-[var(--muted)]">
              {t("common.noData")}
            </div>
          ) : (
            filteredItems.map((item) => (
              <TodoCard
                key={item.id}
                item={item}
                onClick={() => handleCardClick(item)}
              />
            ))
          )}
        </div>

        {/* Footer: count + refresh */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-1 pb-1 pt-3">
          <span className="text-[var(--font-small)] text-[var(--muted)]">
            {t("topbar.todoTotal", { count: String(filteredItems.length), total: String(visibleItems.length) })}
          </span>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="min-h-10 rounded-lg px-2 text-[var(--font-small)] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--row-head-bg)] disabled:opacity-50"
          >
            {t("topbar.todoRefresh")}
          </button>
        </div>
      </div>
    </Drawer>
  );
};
