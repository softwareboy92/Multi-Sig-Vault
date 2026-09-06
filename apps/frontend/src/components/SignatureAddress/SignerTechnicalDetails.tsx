import React from "react";
import { Collapsible } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "../../hooks/useTranslation";
import { useTimezone } from "../../hooks/useTimezone";
import { formatAbsoluteTime } from "../../utils/time";
import type { Signer } from "../../types";

interface SignerTechnicalDetailsProps {
  signer: Signer;
}

/** A single row inside the unified data table: label on top, mono value below. */
const DataRow: React.FC<{
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copy?: boolean;
}> = ({ label, value, mono = true, copy = true }) => {
  if (!value) return null;
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        {copy && <CopyButton value={value} />}
      </div>
      <span
        className={`text-xs text-[var(--text)] break-all leading-relaxed ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
};

export const SignerTechnicalDetails: React.FC<SignerTechnicalDetailsProps> = ({
  signer,
}) => {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();

  // Collect which crypto fields exist to build the table rows
  const cryptoFields: { label: string; value: string | null | undefined }[] = [
    { label: t("signatureAddress.fieldAddress"), value: signer.address },
    { label: t("signatureAddress.fieldPublicKey"), value: signer.public_key },
    { label: t("signatureAddress.fieldExtendedPublicKey"), value: signer.xpub },
  ].filter((f) => f.value);

  const hasHdPair = signer.derivation_path && signer.master_fingerprint;

  // Single HD field (only one of derivation / fingerprint exists)
  const hdSingleField = !hasHdPair
    ? signer.derivation_path || signer.master_fingerprint
    : null;
  const hdSingleLabel = !hasHdPair
    ? signer.derivation_path
      ? t("signatureAddress.fieldDerivationPath")
      : t("signatureAddress.fieldMasterFingerprint")
    : "";

  const hasAnyField = cryptoFields.length > 0 || hasHdPair || hdSingleField;

  return (
    <Collapsible title={t("signatureAddress.technicalDetails")}>
      <div className="space-y-3">
        {/* Unified data table */}
        {hasAnyField && (
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] divide-y divide-[var(--border)]">
            {/* Long crypto values — full-width rows */}
            {cryptoFields.map((f) => (
              <DataRow key={f.label} label={f.label} value={f.value} />
            ))}

            {/* HD pair — two columns in one row */}
            {hasHdPair && (
              <div className="grid grid-cols-2 divide-x divide-[var(--border)]">
                <div className="px-3.5 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      {t("signatureAddress.fieldDerivationPath")}
                    </span>
                    <CopyButton value={signer.derivation_path!} />
                  </div>
                  <span className="text-xs font-mono text-[var(--text)]">
                    {signer.derivation_path}
                  </span>
                </div>
                <div className="px-3.5 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      {t("signatureAddress.fieldMasterFingerprint")}
                    </span>
                    <CopyButton value={signer.master_fingerprint!} />
                  </div>
                  <span className="text-xs font-mono text-[var(--text)]">
                    {signer.master_fingerprint}
                  </span>
                </div>
              </div>
            )}

            {/* HD single field fallback */}
            {hdSingleField && (
              <DataRow label={hdSingleLabel} value={hdSingleField} />
            )}
          </div>
        )}

        {/* Timestamps — lightweight, outside the data table */}
        <div className="flex items-center gap-x-6 gap-y-1 flex-wrap text-xs text-[var(--muted)]">
          <span>
            {t("signatureAddress.createdAt")}{" "}
            <span className="text-[var(--text)]">
              {formatAbsoluteTime(signer.created_at, language, timeZone)}
            </span>
          </span>
          <span>
            {t("signatureAddress.updatedAt")}{" "}
            <span className="text-[var(--text)]">
              {formatAbsoluteTime(signer.updated_at, language, timeZone)}
            </span>
          </span>
        </div>
      </div>
    </Collapsible>
  );
};
