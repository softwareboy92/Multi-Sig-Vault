import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface Preset {
  key: string;
  label: string;
  value: number;
}

interface FeeRateSelectorProps {
  value: number;
  onChange: (rate: number) => void;
}

export function FeeRateSelector({ value, onChange }: FeeRateSelectorProps) {
  const { t } = useTranslation();
  const [isCustom, setIsCustom] = useState(false);

  const presets: Preset[] = [
    { key: "economy", label: t("transactions.feeRateEconomy"), value: 5 },
    { key: "normal", label: t("transactions.feeRateNormal"), value: 10 },
    { key: "priority", label: t("transactions.feeRatePriority"), value: 25 },
  ];

  const handlePresetClick = (preset: Preset) => {
    setIsCustom(false);
    onChange(preset.value);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.min(10_000, Math.max(1, Math.floor(Number(e.target.value) || 1)));
    onChange(v);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[var(--text)]">
        {t("transactions.feeRate")}
      </label>
      <div className="flex gap-2">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => handlePresetClick(preset)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              !isCustom && value === preset.value
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]"
            }`}
          >
            <div className="font-medium">{preset.label}</div>
            <div className="text-xs opacity-70">{preset.value} sat/vB</div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIsCustom(true)}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
            isCustom
              ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]"
          }`}
        >
          <div className="font-medium">{t("transactions.feeRateCustom")}</div>
          <div className="text-xs opacity-70">sat/vB</div>
        </button>
      </div>
      {isCustom && (
        <input
          type="number"
          min={1}
          max={10000}
          value={value}
          onChange={handleCustomChange}
          placeholder={t("transactions.feeRatePlaceholder")}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      )}
      {value < 3 && (
        <div className="text-xs text-[var(--warning)]">
          {t("transactions.feeRateLowWarning")}
        </div>
      )}
    </div>
  );
}
