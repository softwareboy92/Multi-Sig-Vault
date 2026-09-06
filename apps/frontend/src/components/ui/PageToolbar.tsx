import React from "react";

interface PageToolbarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export const PageToolbar: React.FC<PageToolbarProps> = ({ left, right }) => {
  return (
    <div className="glass-surface flex w-full flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel)] p-[clamp(0.75rem,1.1vw,1rem)] shadow-[var(--card-shadow)]">
      {left ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{left}</div> : <span />}
      {right ? <div className="flex flex-wrap items-center gap-3">{right}</div> : null}
    </div>
  );
};
