import React from "react";
import { Badge, Card, Collapsible } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { formatAbsoluteTime } from "../../utils/time";
import { getExplorerUrl } from "../../utils/formatters";
import { truncateAddress } from "../../utils/address";
import { useTranslation } from "../../hooks/useTranslation";
import { useTimezone } from "../../hooks/useTimezone";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import type { Transaction, Wallet } from "../../types";

interface TransactionDetailsCardProps {
  transaction: Transaction;
  wallet: Wallet;
  networkExplorerUrl: string | null;
  btcNetwork: string | null;
  showActions: boolean;
}

const DetailItem: React.FC<{
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  danger?: boolean;
}> = ({ label, children, wide, danger }) => (
  <div className={`min-w-0 rounded-[var(--field-radius)] border p-4 ${wide ? "md:col-span-2" : ""} ${danger ? "border-[var(--danger)]/35 bg-[var(--danger)]/5" : "border-[var(--border)] bg-[var(--surface)]"}`}>
    <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${danger ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{label}</div>
    <div className={`mt-2 min-w-0 text-sm ${danger ? "break-all text-[var(--danger)]" : "text-[var(--text)]"}`}>{children}</div>
  </div>
);

export const TransactionDetailsCard: React.FC<TransactionDetailsCardProps> = ({
  transaction,
  wallet,
  networkExplorerUrl,
  btcNetwork,
  showActions,
}) => {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();
  const signedSignerIds = new Set(transaction.signatures.map((s) => s.signer_id));
  const explorerUrl = transaction.tx_hash
    ? getExplorerUrl(transaction.tx_hash, wallet.chain_type, btcNetwork, networkExplorerUrl)
    : "";

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="title-h3 text-[var(--text)]">{t("transactions.executionTitle")}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">{transaction.tx_type}</p>
        </div>
        {transaction.safe_nonce != null && (
          <Badge variant="default">Nonce {transaction.safe_nonce}</Badge>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <DetailItem label={t("transactions.signatures")}>
          <span className="text-lg font-extrabold">{transaction.signature_count}</span>
          <span className="mx-1 text-[var(--muted)]">/</span>
          <span className="text-[var(--muted)]">{transaction.threshold}</span>
        </DetailItem>

        <DetailItem label={transaction.confirmed_at ? t("transactions.confirmedAt") : t("transactions.createdAt")}>
          <span className="font-semibold">
            {formatAbsoluteTime(transaction.confirmed_at || transaction.created_at, language, timeZone)}
          </span>
        </DetailItem>

        {transaction.tx_hash && (
          <DetailItem label={t("transactions.txHash")} wide>
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono" title={transaction.tx_hash}>
                {truncateAddress(transaction.tx_hash, 16, 14)}
              </span>
              <CopyButton value={transaction.tx_hash} toast={false} />
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  aria-label={t("transactions.txHash")}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="m10 14 11-11" /></svg>
                </a>
              )}
            </div>
          </DetailItem>
        )}

        {transaction.description && (
          <DetailItem label={t("transactions.description")} wide>
            <span className="break-words">{transaction.description}</span>
          </DetailItem>
        )}

        {transaction.error_message && transaction.status !== "CANCELLED" && (
          <DetailItem label={t("common.error")} wide danger>
            {transaction.error_message}
          </DetailItem>
        )}
      </div>

      {!showActions && transaction.signatures.length > 0 && (
        <div className="mt-4">
          <Collapsible
            title={t("transactions.signersTitle")}
            badge={<Badge variant="default">{transaction.signatures.length}</Badge>}
          >
            <div className="space-y-2">
              {wallet.signers.map((signer) => {
                const isSigned = signedSignerIds.has(signer.id);
                const signerDisplay = signer.address || signer.xpub || signer.public_key || "-";
                const showPath = wallet.chain_type === "BTC" && !signer.address && signer.xpub && signer.derivation_path;
                const deviceInfo = SOURCE_ICON_MAP[signer.device_type];
                return (
                  <div key={signer.id} className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-3 last:border-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm font-semibold text-[var(--text)]">
                        {deviceInfo && <img src={deviceInfo.icon} alt={deviceInfo.label} className="h-4 w-4 object-contain" />}
                        <span>{signer.name}</span>
                      </div>
                      <div className="break-all font-mono text-xs text-[var(--muted)]">{signerDisplay}</div>
                      {showPath && <div className="mt-0.5 text-xs text-[var(--muted)]">{signer.derivation_path}</div>}
                    </div>
                    <Badge variant={isSigned ? "success" : "warning"}>
                      {isSigned ? t("transactions.signed") : t("transactions.pending")}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </Collapsible>
        </div>
      )}
    </Card>
  );
};
