import React from "react";
import { Spinner } from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "default";
  loading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "default",
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}) => {
  const baseClass =
    "px-5 py-2.5 rounded-[var(--field-radius)] border transition-all duration-fast font-bold text-[var(--font-body)] text-[var(--text)] cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shadow-none";

  const variantClasses = {
    primary: "bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)] hover:bg-[var(--accent-2)] hover:border-[var(--accent-2)]",
    secondary:
      "bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:bg-[var(--row-head-bg)]",
    ghost:
      "bg-transparent border-[var(--border)] text-[var(--text)] hover:bg-[var(--row-head-bg)]",
    default:
      "bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:bg-[var(--row-head-bg)]",
  };

  return (
    <button
      className={`${baseClass} ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size="sm" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
};
