import React from "react";
import { Button } from "./Button";

interface AlertBannerProps {
  severity: "warning" | "info" | "danger";
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const severityStyles: Record<string, string> = {
  warning: "bg-[var(--warning)]/10 border-[var(--warning)]/30 text-[var(--warning)]",
  info: "bg-[var(--accent-3)]/10 border-[var(--accent-3)]/30 text-[var(--accent-3)]",
  danger: "bg-[var(--danger)]/10 border-[var(--danger)]/30 text-[var(--danger)]",
};

export const AlertBanner: React.FC<AlertBannerProps> = ({
  severity,
  icon,
  children,
  action,
}) => {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${severityStyles[severity]}`}
    >
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="flex-1 text-sm">{children}</div>
      {action && (
        <Button
          variant="ghost"
          onClick={action.onClick}
          className="shrink-0 text-xs"
        >
          {action.label} →
        </Button>
      )}
    </div>
  );
};
