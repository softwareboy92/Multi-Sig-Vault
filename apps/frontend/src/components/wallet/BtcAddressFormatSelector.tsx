import React from "react";
import { useTranslation } from "../../hooks/useTranslation";

type BtcScriptType = "p2wsh" | "p2sh-p2wsh";

interface BtcAddressFormatSelectorProps {
  value: BtcScriptType;
  onChange: (value: BtcScriptType) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const BtcAddressFormatSelector: React.FC<
  BtcAddressFormatSelectorProps
> = ({ value, onChange, disabled = false, compact = false }) => {
  const { t } = useTranslation();
  const options = [
    {
      value: "p2wsh" as const,
      title: "P2WSH",
      subtitle: t("createWallet.btcFormatNativeSubtitle"),
      badge: t("createWallet.formatRecommended"),
      useCase: t("createWallet.btcFormatNativeUseCase"),
      address: "bc1q... / tb1q...",
      devices: "Ledger",
      fee: t("createWallet.formatFeeLow"),
      derivation: "BIP48 /2'",
    },
    {
      value: "p2sh-p2wsh" as const,
      title: "P2SH-P2WSH",
      subtitle: t("createWallet.btcFormatNestedSubtitle"),
      badge: t("createWallet.formatCompatible"),
      useCase: t("createWallet.btcFormatNestedUseCase"),
      address: "3... / 2...",
      devices: "Ledger + KeyVault",
      fee: t("createWallet.formatFeeStandard"),
      derivation: "BIP48 /1'",
    },
  ];

  return (
    <fieldset className={compact ? "space-y-2" : "space-y-3"} disabled={disabled}>
      <legend className="field-label">
        {t("createWallet.btcAddressFormatTitle")}
      </legend>
      <p className={`text-sm text-[var(--muted)] ${compact ? "leading-5" : "leading-6"}`}>
        {t("createWallet.btcAddressFormatHint")}
      </p>
      <div className="grid gap-3 md:grid-cols-2" role="radiogroup">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`group rounded-2xl border text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-75 ${
                compact ? "min-h-[184px] p-3" : "min-h-[236px] p-4"
              } ${
                selected
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--card-shadow)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-3)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-extrabold tracking-tight text-[var(--text)]">
                      {option.title}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        selected
                          ? "bg-[var(--accent)] text-[var(--panel)]"
                          : "bg-[var(--row-head-bg)] text-[var(--muted)]"
                      }`}
                    >
                      {option.badge}
                    </span>
                  </div>
                  <p className={`${compact ? "mt-0.5" : "mt-1"} text-sm font-semibold text-[var(--muted)]`}>
                    {option.subtitle}
                  </p>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--panel)]"
                      : "border-[var(--field-border)] text-transparent"
                  }`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
              <p className={`${compact ? "mt-2 min-h-[40px] leading-5" : "mt-4 min-h-[48px] leading-6"} text-sm text-[var(--text)]`}>
                {option.useCase}
              </p>
              <dl className={`${compact ? "mt-2 gap-y-1.5 pt-2" : "mt-4 gap-y-3 pt-4"} grid grid-cols-2 gap-x-4 border-t border-[var(--border)]`}>
                {[
                  [t("createWallet.formatAddressPrefix"), option.address, true],
                  [t("createWallet.formatDevices"), option.devices, false],
                  [t("createWallet.formatFeeLevel"), option.fee, false],
                  [t("createWallet.formatDerivation"), option.derivation, true],
                ].map(([label, detail, mono]) => (
                  <div key={label as string}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {label}
                    </dt>
                    <dd className={`mt-1 text-xs font-bold text-[var(--text)] ${mono ? "font-mono" : ""}`}>
                      {detail}
                    </dd>
                  </div>
                ))}
              </dl>
            </button>
          );
        })}
      </div>
      <div className={`flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] px-3 text-xs text-[var(--muted)] ${compact ? "py-2 leading-4" : "py-2.5 leading-5"}`}>
        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5M10 6.2v.1" strokeLinecap="round" />
        </svg>
        <span>{t("createWallet.btcFormatSelectionNote")}</span>
      </div>
    </fieldset>
  );
};
