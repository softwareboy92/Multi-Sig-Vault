import React, { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";

type IconName = "dashboard" | "wallet" | "signature" | "assets" | "history" | "address" | "settings";

interface NavItem {
  id: string;
  translationKey: string;
  path: string;
  icon: IconName;
}

const navSections: Array<{ id: string; titleKey: string; items: NavItem[] }> = [
  {
    id: "main",
    titleKey: "nav.sectionMain",
    items: [
      {
        id: "dashboard",
        translationKey: "nav.dashboard",
        path: "/dashboard",
        icon: "dashboard",
      },
      {
        id: "wallet",
        translationKey: "nav.wallets",
        path: "/wallet",
        icon: "wallet",
      },
      {
        id: "signatureAddress",
        translationKey: "nav.signatureAddress",
        path: "/signer",
        icon: "signature",
      },
      {
        id: "history",
        translationKey: "nav.history",
        path: "/transactions",
        icon: "history",
      },
    ],
  },
  {
    id: "manage",
    titleKey: "nav.sectionManage",
    items: [
      {
        id: "address",
        translationKey: "nav.addressBook",
        path: "/address",
        icon: "address",
      },
      {
        id: "settings",
        translationKey: "nav.settings",
        path: "/settings",
        icon: "settings",
      },
    ],
  },
];

const MultiVaultMark: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="MultiVault"
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="var(--surface)" />
      <path
        d="M24 7.5 37 14v9.5c0 8.8-5.5 14.2-13 17.5-7.5-3.3-13-8.7-13-17.5V14l13-6.5Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 29.5V18.7L24 27l7.5-8.3v10.8"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

interface SidebarProps {
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);

  const handleNavClick = (path: string) => {
    navigate(path);
    if (onClose) onClose();
  };

  const renderIcon = (name: IconName) => {
    switch (name) {
      case "dashboard":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
            <rect x="14" y="14" width="7" height="7" rx="2" />
          </svg>
        );
      case "wallet":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h12a2 2 0 012 2v2H7a2 2 0 000 4h12v4a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 11h2" />
          </svg>
        );
      case "signature":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3 3 7-7" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 19h16" />
          </svg>
        );
      case "assets":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 12h10M4 16h7" />
          </svg>
        );
      case "history":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-3-6.7" />
          </svg>
        );
      case "address":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6-5.2 6-10a6 6 0 10-12 0c0 4.8 6 10 6 10z" />
            <circle cx="12" cy="11" r="2.5" />
          </svg>
        );
      case "settings":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.8.3 1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8 1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
          </svg>
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      el.classList.add("is-scrolling");
      if (scrollTimerRef.current) {
        window.clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = window.setTimeout(() => {
        el.classList.remove("is-scrolling");
      }, 900);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (scrollTimerRef.current) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  return (
    <aside
      ref={scrollRef}
      className="app-sidebar h-full w-[clamp(15rem,17vw,17.5rem)] bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] px-4 py-5 flex flex-col gap-5 overflow-auto custom-scrollbar"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3" data-tour="sidebar-brand">
          <MultiVaultMark className="w-10 h-10" />
          <div>
            <div
              className="title-h3 leading-none cursor-pointer"
              onClick={() => {
                navigate("/dashboard");
              }}
            >
              MultiVault
            </div>
            <div className="mt-1 text-[11px] tracking-wide text-[var(--muted)]">
              {t("entry.trustSelfHosted")}
            </div>
          </div>
        </div>
        <button
          className="lg:hidden w-9 h-9 rounded-lg border border-[var(--sidebar-border)] bg-[var(--surface)] text-lg flex items-center justify-center"
          onClick={onClose}
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      <div className="h-px bg-[var(--sidebar-border)]" />

      <nav className="flex flex-col gap-5">
        {navSections.map((section) => (
          <div key={section.id} className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] font-semibold px-3">
              {t(section.titleKey)}
            </div>
            <div className="flex flex-col gap-1.5">
              {section.items.map((item) => {
                const isActive =
                  location.pathname.startsWith(item.path) ||
                  (item.id === "dashboard" && location.pathname.startsWith("/assets"));

                return (
                  <button
                    key={item.id}
                    data-tour={`sidebar-nav-${item.id}`}
                    onClick={() => handleNavClick(item.path)}
                    aria-current={isActive ? "page" : undefined}
                    className={`group relative w-full flex items-center gap-3 border px-3 py-2.5 rounded-[var(--field-radius)] text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                      ${
                        isActive
                          ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-soft)] text-[var(--text)]"
                          : "border-transparent text-[var(--muted)] hover:border-[var(--sidebar-border)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                      }
                    `}
                  >
                    <span
                      className={`w-9 h-9 rounded-[9px] border flex items-center justify-center transition-colors
                        ${
                          isActive
                            ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                            : "border-[var(--sidebar-border)] bg-[var(--surface)] text-[var(--muted)] group-hover:text-[var(--text)]"
                        }
                      `}
                    >
                      <span className="w-4 h-4">{renderIcon(item.icon)}</span>
                    </span>
                    <span className="text-left flex-1">{t(item.translationKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="text-xs text-[var(--muted)] mt-auto px-3">MultiVault © 2026</div>
    </aside>
  );
};
