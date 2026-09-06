import React from "react";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[var(--row-head-bg)] text-[var(--text)]",
  success: "bg-[var(--success)]/15 text-[var(--success)]",
  warning: "bg-[var(--warning)]/15 text-[var(--warning)]",
  danger: "bg-[var(--danger)]/15 text-[var(--danger)]",
  info: "bg-[var(--accent-3)]/15 text-[var(--accent-3)]",
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "default",
  dot = false,
  className = "",
}) => {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-[var(--radius-badge)] border border-current/15 transition-colors duration-fast ${variantClasses[variant]} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {children}
    </span>
  );
};
