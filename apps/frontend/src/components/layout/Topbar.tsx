import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguageStore } from "../../stores/useLanguageStore";
import type { Language } from "../../types";
import { useThemeStore } from "../../stores/useThemeStore";
import { useSyncStore } from "../../stores/useSyncStore";
import { usePreferenceStore } from "../../stores/usePreferenceStore";
import { useToastStore } from "../../stores/useToastStore";
import { usePendingStore } from "../../stores/usePendingStore";
import { Dropdown, DropdownItem, SelectMenu } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { getWallets, syncWalletAssets } from "../../api";
import { TodoDrawer } from "./TodoDrawer";

interface TopbarProps {
  onMenuClick?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ onMenuClick }) => {
  const navigate = useNavigate();
  const { language, setLanguage } = useLanguageStore();
  const { theme, setTheme } = useThemeStore();
  const { isSyncing, startSync, finishSync, failSync } = useSyncStore();
  const { autoSyncEnabled, autoSyncIntervalMinutes, showTestnets } = usePreferenceStore();
  const { showToast, removeToast } = useToastStore();
  const { items: pendingItems, setOpen: setTodoOpen } = usePendingStore();
  const pendingCount = showTestnets
    ? pendingItems.length
    : pendingItems.filter((item) => !item.is_testnet).length;
  const { t } = useTranslation();

  const inFlightSyncRef = useRef<Promise<void> | null>(null);
  const nextAutoSyncAtRef = useRef(Date.now());
  const [syncCountdown, setSyncCountdown] = useState(60);
  const [syncJustCompleted, setSyncJustCompleted] = useState(false);
  const syncCompletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Sync logic (unchanged)
  // ---------------------------------------------------------------------------

  const updateCountdown = useCallback(() => {
    const remaining = Math.max(
      0,
      Math.ceil((nextAutoSyncAtRef.current - Date.now()) / 1000)
    );
    setSyncCountdown(remaining);
  }, []);

  const performGlobalSync = useCallback(
    async (showStartToast: boolean) => {
      if (inFlightSyncRef.current || isSyncing) return;
      let syncToastId: string | null = null;
      const syncPromise = (async () => {
        try {
          startSync();
          if (showStartToast) {
            syncToastId = showToast(t("toast.syncing"), "info", 0);
          }

          const walletsResp = await getWallets();
          const wallets = walletsResp.items || [];

          const activeWallets = wallets.filter((w) => w.status === "ACTIVE");

          if (activeWallets.length === 0) {
            finishSync();
            if (syncToastId) {
              removeToast(syncToastId);
            }
            showToast(t("toast.syncNoActiveWallets"), "info");
            return;
          }

          // Batch sync with concurrency limit
          const succeeded: string[] = [];
          const failed: { name: string; error: string }[] = [];
          const BATCH_SIZE = 3;

          for (let i = 0; i < activeWallets.length; i += BATCH_SIZE) {
            const batch = activeWallets.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map(async (wallet) => {
                try {
                  await syncWalletAssets(wallet.id);
                  succeeded.push(wallet.name || wallet.id);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  failed.push({ name: wallet.name || wallet.id, error: msg });
                }
              }),
            );
          }

          finishSync();
          if (syncToastId) {
            removeToast(syncToastId);
          }

          if (failed.length === 0) {
            showToast(t("toast.syncSuccess"), "success");
          } else if (succeeded.length === 0) {
            showToast(t("common.syncFailed"), "error");
          } else {
            showToast(
              t("toast.syncPartialFailed", {
                success: String(succeeded.length),
                failed: String(failed.length),
                names: failed.map((f) => f.name).join(", "),
              }),
              "warning",
            );
          }
          setSyncJustCompleted(true);
          if (syncCompletedTimerRef.current) clearTimeout(syncCompletedTimerRef.current);
          syncCompletedTimerRef.current = setTimeout(() => setSyncJustCompleted(false), 1500);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : t("common.syncFailed");
          failSync(errorMsg);
          if (syncToastId) {
            removeToast(syncToastId);
          }
          showToast(t("toast.syncFailed", { error: errorMsg }), "error");
        } finally {
          nextAutoSyncAtRef.current =
            Date.now() + autoSyncIntervalMinutes * 60_000;
          updateCountdown();
          inFlightSyncRef.current = null;
        }
      })();

      inFlightSyncRef.current = syncPromise;
      await syncPromise;
    },
    [
      autoSyncIntervalMinutes,
      failSync,
      finishSync,
      isSyncing,
      removeToast,
      showToast,
      startSync,
      t,
      updateCountdown,
    ]
  );

  useEffect(() => {
    updateCountdown();
    const timerId = window.setInterval(() => {
      updateCountdown();
      const remainingMs = nextAutoSyncAtRef.current - Date.now();
      if (
        autoSyncEnabled &&
        remainingMs <= 0 &&
        !inFlightSyncRef.current &&
        !isSyncing
      ) {
        void performGlobalSync(true);
      }
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [autoSyncEnabled, isSyncing, performGlobalSync, updateCountdown]);

  const handleSync = async () => {
    await performGlobalSync(true);
  };

  useEffect(() => {
    nextAutoSyncAtRef.current =
      Date.now() + autoSyncIntervalMinutes * 60_000;
    updateCountdown();
  }, [autoSyncIntervalMinutes, updateCountdown]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <header className="relative z-30 flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-transparent py-2">
      <div className="flex items-center gap-3 shrink-0">
        <button
          className="lg:hidden p-2 text-xl bg-[var(--surface)] rounded-[var(--field-radius)] border border-[var(--border)] flex items-center justify-center w-10 h-10 shrink-0"
          onClick={onMenuClick}
        >
          ≡
        </button>
      </div>

      <div className="flex flex-1 flex-wrap justify-end items-center gap-2 lg:gap-3 min-w-0">
        {/* Sync button */}
        <button
          data-tour="topbar-sync"
          onClick={handleSync}
          disabled={isSyncing}
          className={`topbar-control min-w-[8.5rem] px-3 lg:px-4 rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] text-[var(--field-text)] font-semibold text-xs lg:text-sm transition-all flex items-center justify-center gap-2 ${
            isSyncing
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-[var(--row-head-bg)]"
          }`}
        >
          {syncJustCompleted ? (
            <svg className="w-3.5 h-3.5 text-[var(--success)] animate-scale-in" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          <span className="flex min-w-0 flex-col items-start leading-tight">
            {isSyncing ? t("toast.syncing") : t("topbar.syncData")}
            {!isSyncing && autoSyncEnabled && (
              <span className="hidden sm:inline text-[10px] text-[var(--muted)]">
                {t("topbar.syncCountdown", { seconds: String(syncCountdown) })}
              </span>
            )}
          </span>
        </button>

        {/* Todo button */}
        <button
          data-tour="topbar-todo"
          onClick={() => setTodoOpen(true)}
          className={`topbar-control min-w-[7rem] px-3 lg:px-4 rounded-[var(--field-radius)] border font-semibold text-xs lg:text-sm transition-all inline-flex items-center justify-center gap-2 ${
            pendingCount > 0
              ? "topbar-control--alert border-[var(--warning)] bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/20"
              : "border-[var(--field-border)] bg-[var(--field-bg)] text-[var(--field-text)] hover:bg-[var(--row-head-bg)]"
          }`}
        >
          {t("topbar.todo")} <b key={pendingCount} className="inline-block animate-scale-in">{pendingCount}</b>
        </button>

        {/* Language selector */}
        <SelectMenu
          value={language}
          onChange={(value) => setLanguage(value as Language)}
          options={[
            { value: "zh-CN", label: "简体中文" },
            { value: "zh-TW", label: "繁體中文" },
            { value: "en", label: "English" },
            { value: "ja", label: "日本語" },
            { value: "ko", label: "한국어" },
          ]}
          className="topbar-control min-w-[7.5rem] sm:min-w-[8.25rem]"
          menuClassName="min-w-[9.5rem]"
        />

        {/* Todo Drawer (rendered here, controlled by usePendingStore) */}
        <TodoDrawer />

        {/* Settings dropdown */}
        <Dropdown
          trigger={
            <button
              className="topbar-control flex w-11 items-center justify-center rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] text-[var(--field-text)] transition-colors hover:bg-[var(--row-head-bg)]"
              aria-label={t("nav.settings")}
              title={t("nav.settings")}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09c.69 0 1.31-.4 1.51-1a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09c0 .69.4 1.31 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0c.2.6.82 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.69 0-1.31.4-1.51 1z" />
              </svg>
            </button>
          }
        >
          <div className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("nav.settings")}
          </div>
          <DropdownItem onClick={() => navigate("/settings")}>
            <span className="flex items-center gap-2.5">
              <svg className="h-4 w-4 text-[var(--muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              {t("topbar.openSettings")}
            </span>
          </DropdownItem>
          <div className="my-1 h-px bg-[var(--border)]" />
          <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("topbar.theme")}
          </div>
          {([
            { value: "light" as const, label: t("topbar.themeLight"), path: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" },
            { value: "dark" as const, label: t("topbar.themeDark"), path: "M12 3a9 9 0 1 0 9 9c-5 2-11-3-9-9Z" },
            { value: "tech" as const, label: t("topbar.themeTech"), path: "M8 3v3m8-3v3M8 18v3m8-3v3M3 8h3m12 0h3M3 16h3m12 0h3M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm2 4h4v4h-4z" },
            { value: "matrix" as const, label: t("topbar.themeMatrix"), path: "M5 4v16M9 4v7m0 4v5M13 4v3m0 4v9M17 4v11m0 4v1M21 4v5m0 4v7" },
          ]).map((option) => (
            <DropdownItem key={option.value} onClick={() => setTheme(option.value)}>
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <svg className={`h-4 w-4 ${theme === option.value ? "text-[var(--accent)]" : "text-[var(--muted)]"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={option.path} /></svg>
                  {option.label}
                </span>
                {theme === option.value && (
                  <svg className="h-4 w-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"><path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" /></svg>
                )}
              </span>
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
    </header>
  );
};
