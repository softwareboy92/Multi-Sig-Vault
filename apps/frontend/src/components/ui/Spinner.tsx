import React from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-8 h-8",
};

export const Spinner: React.FC<SpinnerProps> = ({ size = "md", className = "" }) => {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)] ${sizeClasses[size]} ${className}`}
    />
  );
};
