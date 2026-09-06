import React, { useRef, useState } from "react";
import { Badge, Card, Button, Dropdown, DropdownItem } from "../ui";
import type { BadgeVariant } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "../../hooks/useTranslation";
import { SOURCE_ICON_MAP, getSignerChainLabel } from "../../utils/signer";
import { SIGNER_STATUS_VARIANT } from "../../utils/status-variants";
import { truncateAddress } from "../../utils/address";
import type { Signer } from "../../types";

interface SignerHeaderCardProps {
  signer: Signer;
  onRename: (newName: string) => Promise<void>;
  isRenaming: boolean;
  onVerify: () => void;
  onDelete: () => void;
  deleteLoading: boolean;
}

export const SignerHeaderCard: React.FC<SignerHeaderCardProps> = ({
  signer,
  onRename,
  isRenaming,
  onVerify,
  onDelete,
  deleteLoading,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const chainLabel = getSignerChainLabel(signer);
  const statusVariant: BadgeVariant =
    SIGNER_STATUS_VARIANT[signer.status] || "default";

  const statusLabelMap: Record<string, string> = {
    VERIFIED: t("transactions.verified"),
    UNVERIFIED: t("transactions.unverified"),
    REVOKED: t("signatureAddress.statusRevoked"),
  };
  const statusLabel = statusLabelMap[signer.status] || signer.status;
  const sourceInfo = SOURCE_ICON_MAP[signer.device_type];

  const startEdit = () => {
    setEditName(signer.name);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submitEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === signer.name) {
      setIsEditing(false);
      return;
    }
    await onRename(trimmed);
    setIsEditing(false);
  };

  const canDelete = signer.wallets.length === 0;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Name with inline edit */}
          <div className="flex items-center gap-2 mb-3">
            {isEditing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitEdit();
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => {
                    if (!isRenaming) setIsEditing(false);
                  }}
                  onKeyDown={(e) => e.key === "Escape" && setIsEditing(false)}
                  className="text-lg font-bold bg-transparent border-b-2 border-[var(--accent)] text-[var(--text)] outline-none px-0 py-0.5 min-w-[120px]"
                  disabled={isRenaming}
                  maxLength={100}
                />
                <button
                  type="submit"
                  disabled={isRenaming || !editName.trim()}
                  className="w-7 h-7 rounded-md text-[var(--accent)] hover:bg-[var(--row-head-bg)] inline-flex items-center justify-center disabled:opacity-40"
                  title={t("common.save")}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </button>
              </form>
            ) : (
              <>
                <h2 className="text-lg font-bold text-[var(--text)] truncate">
                  {signer.name}
                </h2>
                <button
                  type="button"
                  onClick={startEdit}
                  className="w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--row-head-bg)] inline-flex items-center justify-center shrink-0"
                  title={t("common.edit")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Device info */}
          <div className="flex items-center gap-3 mb-3">
            {sourceInfo ? (
              <span
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--row-head-bg)] text-[var(--text)]"
                title={sourceInfo.label}
              >
                <img
                  src={sourceInfo.icon}
                  alt={sourceInfo.label}
                  className="w-4 h-4 object-contain"
                />
                {sourceInfo.label}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--row-head-bg)] text-[var(--text)]">
                {signer.device_type}
              </span>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant={statusVariant}>{statusLabel}</Badge>
            <Badge variant="info">{chainLabel}</Badge>
          </div>

          {/* Address / Public Key */}
          {(signer.address || signer.public_key) && (
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
              <span>{truncateAddress(signer.address || signer.public_key || "")}</span>
              <CopyButton value={signer.address || signer.public_key || ""} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {signer.status !== "VERIFIED" && (
            <Button variant="primary" onClick={onVerify}>
              {t("signatureAddress.verify")}
            </Button>
          )}
          {canDelete && (
            <Dropdown
              trigger={
                <button className="w-8 h-8 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--row-head-bg)] inline-flex items-center justify-center transition-colors">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5"
                    fill="currentColor"
                  >
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
              }
              align="right"
            >
              <DropdownItem onClick={onDelete}>
                <span className="text-[var(--danger)]">
                  {deleteLoading ? "..." : t("common.delete")}
                </span>
              </DropdownItem>
            </Dropdown>
          )}
        </div>
      </div>
    </Card>
  );
};
