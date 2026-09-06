import React from "react";
import { PageHeader } from "./PageHeader";
import { Breadcrumb } from "./Breadcrumb";

interface PageShellProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  showTitle?: boolean;
  children: React.ReactNode;
}

export const PageShell: React.FC<PageShellProps> = ({
  title,
  description,
  actions,
  breadcrumbs,
  showTitle = false,
  children,
}) => {
  // Older list pages pass a standalone title span. Normalize it here so
  // first-level and nested routes always occupy the same breadcrumb frame.
  const isLegacyTitle =
    React.isValidElement(breadcrumbs) && breadcrumbs.type === "span";
  const breadcrumbContent = isLegacyTitle ? (
    <Breadcrumb items={[{ label: title }]} />
  ) : (
    breadcrumbs
  );

  return (
    <div className="flex w-full flex-col gap-[var(--section-gap)]">
      {breadcrumbContent && (
        <div className="flex min-h-14 min-w-0 items-center text-[var(--font-body)] text-[var(--muted)]">
          {breadcrumbContent}
        </div>
      )}
      {showTitle && (
        <PageHeader title={title} description={description} actions={actions} />
      )}
      <div className="flex w-full flex-col gap-[var(--section-gap)]">{children}</div>
    </div>
  );
};
