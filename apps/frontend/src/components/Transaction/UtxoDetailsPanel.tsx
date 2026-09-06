import React from "react";
import { Badge, Card } from "../ui";
import { CopyButton } from "../ui/CopyButton";
import { useTranslation } from "../../hooks/useTranslation";
import type { BtcDecodedTx } from "../../types";

interface UtxoDetailsPanelProps {
  decodedTx: BtcDecodedTx;
}

function formatBtc(sats: number): string {
  return (sats / 1e8).toFixed(8).replace(/\.?0+$/, "");
}

function shortenAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

export const UtxoDetailsPanel: React.FC<UtxoDetailsPanelProps> = ({ decodedTx }) => {
  const { t } = useTranslation();

  const totalIn = decodedTx.inputs.reduce((s, i) => s + (i.value ?? 0), 0);
  const totalOut = decodedTx.outputs.reduce((s, o) => s + o.value, 0);

  return (
    <Card className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text)]">
          {t("transactions.utxoTitle")}
        </h3>
        {decodedTx.fee != null && (
          <Badge variant="default" className="text-xs">
            {t("transactions.utxoFee")}: {formatBtc(decodedTx.fee)} BTC
          </Badge>
        )}
      </div>

      {/* Inputs */}
      <div>
        <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider mb-2">
          {t("transactions.utxoInputs")} ({decodedTx.inputs.length})
        </h4>
        <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
          {decodedTx.inputs.map((input, idx) => (
            <div
              key={`${input.txid}:${input.vout}`}
              className="px-3 py-2 bg-[var(--surface)] flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--muted)] shrink-0">#{idx}</span>
                  {input.address ? (
                    <span className="text-xs font-mono truncate" title={input.address}>
                      {shortenAddress(input.address)}
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-[var(--muted)] truncate" title={input.txid}>
                      {shortenAddress(input.txid)}:{input.vout}
                    </span>
                  )}
                  {input.address && <CopyButton value={input.address} className="shrink-0" />}
                </div>
              </div>
              {input.value != null && (
                <span className="text-xs font-mono text-[var(--text)] whitespace-nowrap">
                  {formatBtc(input.value)} BTC
                </span>
              )}
            </div>
          ))}
        </div>
        {totalIn > 0 && (
          <div className="text-right text-xs text-[var(--muted)] mt-1">
            {t("transactions.utxoTotal")}: {formatBtc(totalIn)} BTC
          </div>
        )}
      </div>

      {/* Outputs */}
      <div>
        <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider mb-2">
          {t("transactions.utxoOutputs")} ({decodedTx.outputs.length})
        </h4>
        <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
          {decodedTx.outputs.map((output) => (
            <div
              key={output.index}
              className="px-3 py-2 bg-[var(--surface)] flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--muted)] shrink-0">#{output.index}</span>
                  {output.address ? (
                    <span className="text-xs font-mono truncate" title={output.address}>
                      {shortenAddress(output.address)}
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-[var(--muted)]">N/A</span>
                  )}
                  {output.is_change && (
                    <Badge variant="info" className="text-[10px] shrink-0">
                      {t("transactions.utxoChange")}
                    </Badge>
                  )}
                  {output.address && <CopyButton value={output.address} className="shrink-0" />}
                </div>
              </div>
              <span className="text-xs font-mono text-[var(--text)] whitespace-nowrap">
                {formatBtc(output.value)} BTC
              </span>
            </div>
          ))}
        </div>
        <div className="text-right text-xs text-[var(--muted)] mt-1">
          {t("transactions.utxoTotal")}: {formatBtc(totalOut)} BTC
        </div>
      </div>

      {/* Tx meta info */}
      {(decodedTx.txid || decodedTx.size || decodedTx.confirmations != null) && (
        <div className="border-t border-[var(--border)] pt-3 space-y-1">
          {decodedTx.txid && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--muted)]">{t("transactions.utxoTxid")}:</span>
              <span className="font-mono truncate">{decodedTx.txid}</span>
              <CopyButton value={decodedTx.txid} className="shrink-0" />
            </div>
          )}
          {decodedTx.size != null && decodedTx.vsize != null && (
            <div className="text-xs text-[var(--muted)]">
              {t("transactions.utxoSize")}: {decodedTx.size} bytes / {decodedTx.vsize} vbytes
            </div>
          )}
          {decodedTx.confirmations != null && (
            <div className="text-xs text-[var(--muted)]">
              {t("transactions.utxoConfirmations")}: {decodedTx.confirmations}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
