import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  clickable?: boolean;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  clickable = false,
  onClick,
}) => {
  const hasCustomPadding = /(?:^|\s)!?p-(?:\[[^\]]+\]|\S+)/.test(className);

  return (
    <div
      className={`
        glass-surface bg-[var(--panel)] rounded-[var(--radius-card)] border border-[var(--border)]
        ${hasCustomPadding ? "" : "p-[var(--card-padding)]"}
        shadow-[var(--card-shadow)]
        ${
          clickable
            ? "cursor-pointer hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] hover:bg-[color-mix(in_srgb,var(--accent-soft)_40%,var(--panel))] transition-colors"
            : ""
        }
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
