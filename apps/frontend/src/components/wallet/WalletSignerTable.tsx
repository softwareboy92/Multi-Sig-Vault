import React, { memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "../../hooks/useTranslation";
import { formatAddress } from "../../utils/format";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import type { Wallet } from "../../types";

// ---------------------------------------------------------------------------
// Row component (memoized)
// ---------------------------------------------------------------------------

const WalletSignerRow = memo(function WalletSignerRow({
  signer,
}: {
  signer: Wallet["signers"][number];
}) {
  const navigate = useNavigate();

  return (
    <TableRow
      onClick={
        signer.id
          ? () => navigate(`/signer/${signer.id}`)
          : undefined
      }
    >
      <TableCell>
        <span className="text-[var(--text)] text-sm">
          {signer.name || "\u2014"}
        </span>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-xs text-[var(--muted)]">
            {(signer.address || signer.public_key)
              ? formatAddress(signer.address || signer.public_key || "")
              : "\u2014"}
          </span>
          {(signer.address || signer.public_key) && (
            <CopyButton value={signer.address || signer.public_key || ""} />
          )}
        </span>
      </TableCell>
      <TableCell>
        {SOURCE_ICON_MAP[signer.device_type] ? (
          <div className="inline-flex items-center gap-2">
            <img
              src={SOURCE_ICON_MAP[signer.device_type].icon}
              alt={SOURCE_ICON_MAP[signer.device_type].label}
              className="w-5 h-5 object-contain"
            />
            <span className="font-semibold text-sm">
              {SOURCE_ICON_MAP[signer.device_type].label}
            </span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[var(--row-head-bg)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--muted)]">?</span>
            <span className="text-xs text-[var(--muted)]">
              {signer.device_type || "\u2014"}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell>
        {signer.status ? (
          <Badge
            variant={
              signer.status === "VERIFIED" ? "success" : "default"
            }
          >
            {signer.status}
          </Badge>
        ) : (
          "\u2014"
        )}
      </TableCell>
    </TableRow>
  );
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WalletSignerTableProps {
  wallet: Wallet;
}

/**
 * Displays the wallet's signers in a table with M/N threshold header.
 * Returns null when there are no signers.
 */
export const WalletSignerTable: React.FC<WalletSignerTableProps> = ({
  wallet,
}) => {
  const { t } = useTranslation();

  if (wallet.signers.length === 0) return null;

  return (
    <Card>
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {t("wallet.signers")} ({wallet.threshold}/{wallet.signers.length})
        </h3>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("tableHeaders.name")}</TableHead>
            <TableHead>{t("tableHeaders.address")}</TableHead>
            <TableHead>{t("tableHeaders.device")}</TableHead>
            <TableHead>{t("tableHeaders.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallet.signers.map((signer) => (
            <WalletSignerRow
              key={signer.id ?? signer.address}
              signer={signer}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
};
