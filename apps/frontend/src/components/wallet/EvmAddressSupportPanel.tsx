import React from "react";
import { useTranslation } from "../../hooks/useTranslation";

export const EvmAddressSupportPanel: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section className="space-y-3" aria-labelledby="evm-address-support-title">
      <div>
        <h3 id="evm-address-support-title" className="field-label">
          {t("signatureAddress.evmAddressScopeTitle")}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {t("signatureAddress.evmAddressScopeHint")}
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4 shadow-[var(--card-shadow)] sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/25 bg-[var(--panel)] text-lg font-extrabold text-[var(--accent)]">
              E
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-[var(--text)]">
                  {t("signatureAddress.evmUniversalAddress")}
                </span>
                <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-[var(--panel)]">
                  {t("signatureAddress.evmFixedFormat")}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-[var(--muted)]">
                {t("signatureAddress.evmUniversalSubtitle")}
              </p>
            </div>
          </div>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--accent)] text-[var(--panel)]" aria-hidden="true">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <p className="mt-4 text-sm leading-6 text-[var(--text)]">
          {t("signatureAddress.evmUniversalDescription")}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border)] pt-4 md:grid-cols-4">
          {[
            [t("signatureAddress.evmAddressFormatLabel"), "0x...", true],
            [t("signatureAddress.evmNetworkScopeLabel"), t("signatureAddress.evmAllCompatibleChains"), false],
            [t("signatureAddress.evmEnvironmentLabel"), t("signatureAddress.evmMainnetAndTestnet"), false],
            [t("signatureAddress.evmNetworkTimingLabel"), t("signatureAddress.evmChooseWhenCreating"), false],
          ].map(([label, value, mono]) => (
            <div key={label as string}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {label}
              </dt>
              <dd className={`mt-1 text-xs font-bold text-[var(--text)] ${mono ? "font-mono" : ""}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] px-3 py-2.5 text-xs leading-5 text-[var(--muted)]">
        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5M10 6.2v.1" strokeLinecap="round" />
        </svg>
        <span>{t("signatureAddress.evmNetworkSelectionNote")}</span>
      </div>
    </section>
  );
};
