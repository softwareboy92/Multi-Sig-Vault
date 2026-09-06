import React from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="text-center py-12 animate-fade-in">
      {icon && (
        <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center rounded-2xl bg-[var(--row-head-bg)] text-[var(--muted)]">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-extrabold text-[var(--text)] mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[var(--muted)] mb-6">{description}</p>
      )}
      {action}
    </div>
  );
};
