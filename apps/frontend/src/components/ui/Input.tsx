import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = "",
  ...props
}) => {
  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      <input
        className={
          `
          field-control
          ${error ? "border-[var(--danger)]" : ""}
          ${className}
        `
        }
        {...props}
      />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
};
