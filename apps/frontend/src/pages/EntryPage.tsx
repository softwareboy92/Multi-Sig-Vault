import React from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button } from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

const IconShield: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const IconCode: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const IconLock: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

const IconUsers: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const IconServer: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

const IconLink: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </svg>
);

const IconKey: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const IconClipboard: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

const IconArrowRight: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const IconGithub: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export const EntryPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const trustItems = [
    { icon: <IconShield className="w-5 h-5" />, label: t("entry.trustSelfHosted") },
    { icon: <IconCode className="w-5 h-5" />, label: t("entry.trustOpenSource") },
    { icon: <IconLock className="w-5 h-5" />, label: t("entry.trustNoCustody") },
    { icon: <IconUsers className="w-5 h-5" />, label: t("entry.trustMultiSig") },
  ];

  const steps = [
    { num: "1", title: t("entry.step1Title"), desc: t("entry.step1Desc"), icon: <IconServer className="w-6 h-6" /> },
    { num: "2", title: t("entry.step2Title"), desc: t("entry.step2Desc"), icon: <IconShield className="w-6 h-6" /> },
    { num: "3", title: t("entry.step3Title"), desc: t("entry.step3Desc"), icon: <IconClipboard className="w-6 h-6" /> },
  ];

  const features = [
    { icon: <IconShield className="w-5 h-5" />, title: t("entry.feat1Title"), desc: t("entry.feat1Desc") },
    { icon: <IconKey className="w-5 h-5" />, title: t("entry.feat2Title"), desc: t("entry.feat2Desc") },
    { icon: <IconLink className="w-5 h-5" />, title: t("entry.feat3Title"), desc: t("entry.feat3Desc") },
    { icon: <IconClipboard className="w-5 h-5" />, title: t("entry.feat4Title"), desc: t("entry.feat4Desc") },
  ];

  return (
    <div className="flex flex-col gap-6">

      {/* ── Section 1: Hero ─────────────────────────────────────── */}
      <Card className="relative overflow-hidden !py-8 !px-6 lg:!py-10 lg:!px-8">
        <div className="absolute inset-x-0 top-0 h-24 bg-linear-to-r from-[var(--accent)]/12 via-[var(--accent)]/6 to-transparent" />
        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl flex flex-col gap-4">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/8 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                <IconShield className="w-4 h-4" />
                Self-Custody Multisig
              </div>

              <div className="flex flex-col gap-3">
                <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight tracking-[-0.03em]">
                  MultiVault
                </h1>
                <p className="text-[var(--muted)] text-base lg:text-lg leading-relaxed max-w-2xl">
                  {t("entry.subtitle")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button variant="primary" onClick={() => navigate("/wallet")} className="inline-flex items-center gap-2">
                  {t("entry.cta")}
                  <IconArrowRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => window.open("https://github.com/multivault/multivault", "_blank")}
                  className="inline-flex items-center gap-2"
                >
                  <IconGithub className="w-4 h-4" />
                  GitHub
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[320px]">
              {trustItems.map((item, i) => (
                <div key={i} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
                  <div className="mb-2 text-[var(--accent)]">{item.icon}</div>
                  <div className="font-semibold text-[var(--text)] leading-snug">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
            <span className="font-semibold text-[var(--text)]">MIT License</span>
            <span>v0.1.0</span>
            <span>EVM Safe + BTC P2WSH / P2SH-P2WSH</span>
            <span>Client-side signing only</span>
          </div>
        </div>
      </Card>

      {/* ── Section 2: How It Works ─────────────────────────────── */}
      <div>
        <h2 className="text-lg font-extrabold mb-4">{t("entry.howTitle")}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {steps.map((step) => (
            <Card key={step.num} className="flex flex-col gap-4 !py-7">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center shrink-0 text-[var(--accent)]">
                  {step.icon}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Step {step.num}</span>
                  <h3 className="font-extrabold text-base">{step.title}</h3>
                </div>
              </div>
              <p className="text-[var(--muted)] text-sm leading-relaxed">{step.desc}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Section 3: Features ─────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-extrabold mb-4">{t("entry.featTitle")}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {features.map((feat, i) => (
            <Card key={i} className="flex gap-4 !py-7">
              <div className="w-11 h-11 rounded-2xl bg-[var(--row-head-bg)] flex items-center justify-center shrink-0 text-[var(--accent)]">
                {feat.icon}
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="font-extrabold text-base">{feat.title}</h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">{feat.desc}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};
