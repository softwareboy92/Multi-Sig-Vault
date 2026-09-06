import React from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface BackButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * Circular back-arrow button used in breadcrumb bars.
 * Replaces the repeated inline <button> + SVG pattern across all pages.
 */
export const BackButton: React.FC<BackButtonProps> = ({ onClick, className = "" }) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] shadow-[var(--card-shadow)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
      aria-label={t("common.back")}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
};
