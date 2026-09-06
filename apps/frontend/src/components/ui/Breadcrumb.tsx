import { useLocation, useNavigate } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const renderIcon = (href = "") => {
    const iconClass = "h-[1.05rem] w-[1.05rem] shrink-0";

    if (href.includes("transaction") || href.includes("history")) {
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
        </svg>
      );
    }

    if (href.includes("signer")) {
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="8" r="3.2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    }

    if (href.includes("asset")) {
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 8 4-8 4-8-4 8-4Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m4 12 8 4 8-4M4 17l8 4 8-4" />
        </svg>
      );
    }

    if (href.includes("settings")) {
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.3 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.3 3.1h4.8l.3-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
        </svg>
      );
    }

    if (href.includes("address")) {
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z" />
          <circle cx="12" cy="11" r="2" />
        </svg>
      );
    }

    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.5 12 3l8 6.5V20h-6v-6h-4v6H4V9.5Z" />
      </svg>
    );
  };

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 max-w-full items-center text-[var(--font-body)]"
    >
      <div className="custom-scrollbar min-w-0 max-w-full overflow-x-auto py-1">
      <ol className="flex min-w-max items-center rounded-full border border-[var(--border)] bg-[var(--panel)] shadow-[var(--card-shadow)]">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          const isPrimary = index === 0;
          const isHighlighted = isCurrent && !isPrimary;
          const segmentClass = `relative inline-flex h-12 max-w-[clamp(9rem,24vw,20rem)] items-center gap-2 rounded-full border border-transparent px-5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
            index > 0 ? "-ml-5 pl-9" : ""
          } ${
            isHighlighted
              ? "bg-[var(--accent)] text-[var(--on-accent)] shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
              : "bg-[var(--panel)] text-[var(--muted)] hover:border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] hover:bg-[color-mix(in_srgb,var(--accent-soft)_42%,var(--panel))] hover:text-[var(--accent)]"
          }`;

          return (
            <li
              key={`${item.label}-${index}`}
              className="relative flex shrink-0 items-center"
              style={{ zIndex: items.length - index }}
            >
              {item.href ? (
                <button
                  type="button"
                  onClick={() => navigate(item.href!)}
                  className={segmentClass}
                  title={item.label}
                >
                  {isPrimary && renderIcon(item.href)}
                  <span className="truncate">{item.label}</span>
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={segmentClass}
                  title={item.label}
                >
                  {isPrimary && renderIcon(location.pathname)}
                  <span className="truncate">{item.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      </div>
    </nav>
  );
}
