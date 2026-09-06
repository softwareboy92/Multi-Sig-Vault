import React from "react";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  disabled = false,
  ariaLabel,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex items-center w-11 h-6 rounded-full border transition-colors relative ${
        checked
          ? "bg-[var(--text)] border-[var(--text)]"
          : "bg-[var(--border)] border-[var(--border)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute w-5 h-5 rounded-full bg-[var(--surface)] transition-all ${
          checked ? "left-5" : "left-1"
        }`}
      />
    </button>
  );
};
