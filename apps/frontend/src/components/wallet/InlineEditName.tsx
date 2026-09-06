import React, { useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useToastStore } from "@/stores/useToastStore";
import { usePendingStore } from "@/stores/usePendingStore";
import { renameWallet } from "@/api";
import type { Wallet } from "@/types";

interface InlineEditNameProps {
  walletId: string;
  currentName: string;
  onRenamed: (updated: Wallet) => void;
  className?: string;
}

/**
 * Inline-editable wallet name with pencil icon.
 * Supports Enter to confirm, Escape / blur to cancel.
 */
export const InlineEditName: React.FC<InlineEditNameProps> = ({
  walletId,
  currentName,
  onRenamed,
  className = "",
}) => {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const { requestRefresh } = usePendingStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditName(currentName);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (!saving) setIsEditing(false);
  };

  const confirmEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === currentName) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await renameWallet(walletId, trimmed);
      onRenamed(updated);
      showToast(t("wallet.renameSuccess"), "success");
      requestRefresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : t("wallet.renameFailed"),
        "error",
      );
    } finally {
      setSaving(false);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <form
        className={`flex items-center gap-2 ${className}`}
        onSubmit={(e) => {
          e.preventDefault();
          confirmEdit();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
          onBlur={cancelEdit}
          maxLength={100}
          className="title-h2 bg-transparent border-b-2 border-[var(--accent)] outline-none text-[var(--text)] px-0 py-0 w-auto min-w-[120px]"
          autoFocus
        />
        <button
          type="submit"
          disabled={saving || !editName.trim()}
          className="w-7 h-7 rounded-md text-[var(--accent)] hover:bg-[var(--row-head-bg)] inline-flex items-center justify-center disabled:opacity-40"
          title={t("common.save")}
          onMouseDown={(e) => e.preventDefault()}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </form>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <h2 className="title-h2">{currentName}</h2>
      <button
        type="button"
        onClick={startEdit}
        className="w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--row-head-bg)] inline-flex items-center justify-center"
        title={t("common.edit")}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
    </div>
  );
};
