import React from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../stores/useToastStore";

interface CopyButtonProps {
  /** The text value to write to clipboard */
  value: string;
  /** Whether to call event.stopPropagation() on click */
  stopPropagation?: boolean;
  /** Whether to show a success toast after copy (default true) */
  toast?: boolean;
  className?: string;
}

/**
 * Small icon-only button that copies a value to clipboard.
 * Replaces the repeated inline copy-button + SVG pattern across all pages.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  stopPropagation = false,
  toast = true,
  className = "",
}) => {
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  const handleClick = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (!value) return;
    navigator.clipboard.writeText(value);
    if (toast) {
      showToast(t("toast.copySuccess"), "success");
    }
  };

  return (
    <button
      type="button"
      className={`w-6 h-6 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--row-head-bg)] inline-flex items-center justify-center ${className}`}
      onClick={handleClick}
      aria-label={t("common.copy")}
      title={t("common.copy")}
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9h10v10H9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
    </button>
  );
};
