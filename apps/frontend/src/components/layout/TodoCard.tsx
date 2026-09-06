import React from "react";
import type { PendingActionItem } from "../../api/pending";
import { Card } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "../../hooks/useTranslation";
import { useTimezone } from "../../hooks/useTimezone";
import { useLanguageStore } from "../../stores/useLanguageStore";
import { formatBalance, getDisplaySymbol } from "../../utils/format";
import { formatAbsoluteTime } from "../../utils/time";

interface TodoCardProps {
  item: PendingActionItem;
  onClick: () => void;
}

export const TodoCard: React.FC<TodoCardProps> = ({ item, onClick }) => {
  const { t } = useTranslation();
  const timeZone = useTimezone();
  const { language } = useLanguageStore();

  const isTx = item.action_type === "pending_sign" || item.action_type === "pending_broadcast";
  const isBroadcast = item.action_type === "pending_broadcast";

  const formattedAmount = isTx && item.amount != null
    ? `${formatBalance(item.amount, item.token_decimals ?? 18, 8)} ${getDisplaySymbol(item.token_symbol, item.chain_type)}`
    : null;

  // Signature progress for tx items
  const signatureProgress = isTx && item.threshold != null && item.signature_count != null
    ? { signed: item.signature_count, required: item.threshold }
    : null;

  return (
    <Card
      className="cursor-pointer border border-[var(--border)] p-4 transition-all duration-fast hover:border-[var(--accent)]/45 hover:bg-[var(--surface)] sm:p-5"
      onClick={onClick}
    >
      {/* Header row: badge + time */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-[var(--radius-badge)] border border-current/15 px-2.5 py-1 text-[var(--font-small)] font-bold ${
          isBroadcast
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : "bg-[var(--warning)]/10 text-[var(--warning)]"
        }`}>
          {isBroadcast
            ? t("topbar.todoPendingBroadcast")
            : isTx
            ? t("topbar.todoUnsigned")
            : t("wallet.statusPendingDeploy")}
        </span>
        <span className="text-[var(--font-small)] leading-normal text-[var(--muted)]">
          {formatAbsoluteTime(item.created_at, language, timeZone)}
        </span>
      </div>

      <div>
        {isTx ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-[var(--field-radius)] bg-[var(--row-head-bg)] px-3 py-2.5">
                <div className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoWallet")}</div>
                <div className="mt-1 truncate text-[var(--font-body)] font-bold leading-normal text-[var(--text)]" title={item.wallet_name || undefined}>
                  {item.wallet_name || "-"}
                </div>
              </div>

              <div className="min-w-0 rounded-[var(--field-radius)] bg-[var(--row-head-bg)] px-3 py-2.5">
                <div className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoAmount")}</div>
                <div className="mt-1 break-words text-[var(--font-body)] font-extrabold leading-normal text-[var(--text)]">
                  {formattedAmount || "-"}
                </div>
              </div>
            </div>

            {/* To address */}
            <div className="mt-3 rounded-[var(--field-radius)] border border-[var(--border)] px-3 py-2.5">
              <div className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoToLabel")}</div>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-[var(--font-small)] leading-relaxed text-[var(--text)]">
                  {item.to_address || "-"}
                </span>
                {item.to_address && <CopyButton value={item.to_address} stopPropagation />}
              </div>
            </div>

            {/* Signature progress bar (hide for broadcast-ready txs) */}
            {signatureProgress && !isBroadcast && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--field-radius)] border border-[var(--border)] px-3 py-2.5">
                  <div className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoChain")}</div>
                  <div className="mt-1 text-[var(--font-body)] font-semibold leading-normal text-[var(--text)]">{item.network_name}</div>
                </div>
                <div className="rounded-[var(--field-radius)] border border-[var(--border)] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoSignProgress")}</span>
                    <span className="text-[var(--font-body)] font-bold tabular-nums text-[var(--text)]">
                      {signatureProgress.signed}/{signatureProgress.required}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full bg-[var(--warning)] rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (signatureProgress.signed / signatureProgress.required) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {(!signatureProgress || isBroadcast) && (
              <div className="mt-3 rounded-[var(--field-radius)] border border-[var(--border)] px-3 py-2.5">
                <div className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoChain")}</div>
                <div className="mt-1 text-[var(--font-body)] font-semibold leading-normal text-[var(--text)]">{item.network_name}</div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Wallet deploy card */}
            <div className="rounded-[var(--field-radius)] bg-[var(--row-head-bg)] px-3 py-3 text-[var(--font-body)] font-bold leading-normal text-[var(--text)]">
              {t("topbar.todoDeployTitle", { name: item.wallet_name })}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--field-radius)] border border-[var(--border)] px-3 py-2.5">
                <div className="text-[var(--font-small)] text-[var(--muted)]">{t("topbar.todoChain")}</div>
                <div className="mt-1 text-[var(--font-body)] font-semibold leading-normal text-[var(--text)]">{item.network_name}</div>
              </div>
              <div className="min-w-0 rounded-[var(--field-radius)] border border-[var(--border)] px-3 py-2.5">
                <div className="break-all text-[var(--font-small)] leading-relaxed text-[var(--muted)]">
                  {item.predicted_address
                    ? t("topbar.todoPredicted", { address: item.predicted_address })
                    : t("topbar.todoPendingDeployment")}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
};
