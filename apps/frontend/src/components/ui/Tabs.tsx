import React from "react";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ items, activeKey, onChange }) => {
  return (
    <div className="flex gap-1 border-b border-[var(--border)]">
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => !item.disabled && onChange(item.key)}
            disabled={item.disabled}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors relative",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              isActive
                ? "text-[var(--accent)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--text)]",
              item.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            {item.label}
            {item.count != null && (
              <span className="ml-1.5 text-xs opacity-70">({item.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
