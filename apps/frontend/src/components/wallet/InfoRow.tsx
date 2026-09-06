import React from "react";

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  border?: boolean;
  className?: string;
}

/**
 * Reusable key-value information row used in wallet summary cards.
 */
export const InfoRow: React.FC<InfoRowProps> = ({
  label,
  value,
  border = true,
  className = "",
}) => (
  <div
    className={`flex items-center justify-between py-2 ${
      border ? "border-b border-[var(--border)]" : ""
    } ${className}`}
  >
    <span className="text-xs text-[var(--muted)] shrink-0">{label}</span>
    <div className="text-xs text-[var(--text)] text-right break-all ml-4">{value}</div>
  </div>
);
