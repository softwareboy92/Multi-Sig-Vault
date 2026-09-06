import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useTimezone } from '@/hooks/useTimezone';

import { Badge } from '@/components/ui';
import { CopyButton } from '@/components/ui/CopyButton';
import { formatBalance } from '@/utils/format';
import { formatAbsoluteTime } from '@/utils/time';
import type { AssetChange, SimulationResult } from '@/types';

interface SimulationResultPanelProps {
  simulation: SimulationResult;
  walletAddress: string;
}

function shortenAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

function formatGas(gas: number): string {
  return gas.toLocaleString();
}

/** A single asset row within an address group. */
interface AddressAssetRow {
  symbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  rawAmount: string;
  dollarValue: string;
  isSent: boolean;
  isApprove: boolean;
  /** For Approve rows: the spender address being granted allowance. */
  spenderAddress?: string;
}

/** Group asset changes by address, expanding each transfer into sender + receiver rows. */
function groupByAddress(changes: AssetChange[]): Map<string, AddressAssetRow[]> {
  const map = new Map<string, AddressAssetRow[]>();
  const push = (addr: string, row: AddressAssetRow) => {
    if (!addr) return;
    const key = addr.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  };

  for (const c of changes) {
    const base = {
      symbol: c.token_symbol,
      tokenAddress: c.token_address,
      tokenDecimals: c.token_decimals,
      rawAmount: c.raw_amount,
      dollarValue: c.dollar_value,
      isApprove: c.type === 'Approve',
    };

    if (base.isApprove) {
      // Approve: only show under owner, with spender as target
      if (c.from_address) {
        push(c.from_address, { ...base, isSent: true, spenderAddress: c.to_address });
      }
    } else {
      if (c.from_address) {
        push(c.from_address, { ...base, isSent: true });
      }
      if (c.to_address) {
        push(c.to_address, { ...base, isSent: false });
      }
    }
  }

  return map;
}

export const SimulationResultPanel: React.FC<SimulationResultPanelProps> = ({
  simulation,
  walletAddress,
}) => {
  const { t, language } = useTranslation();
  const timezone = useTimezone();
  const { result, status, gas_used } = simulation;
  const isSuccess = status === 'SUCCESS';

  const getAddressLabel = (address: string): string => {
    if (!address) return '';
    if (address.toLowerCase() === walletAddress.toLowerCase()) {
      return t('transactions.simulationThisWallet');
    }
    return shortenAddress(address);
  };

  // Build address-grouped view
  const addressGroups = result.asset_changes?.length
    ? groupByAddress(result.asset_changes)
    : new Map<string, AddressAssetRow[]>();

  // Sort: wallet address first, then alphabetical
  const sortedAddresses = [...addressGroups.keys()].sort((a, b) => {
    const wa = a === walletAddress.toLowerCase() ? 0 : 1;
    const wb = b === walletAddress.toLowerCase() ? 0 : 1;
    return wa - wb || a.localeCompare(b);
  });

  // Find original-cased address from first occurrence
  const originalCase = new Map<string, string>();
  if (result.asset_changes) {
    for (const c of result.asset_changes) {
      if (c.from_address) originalCase.set(c.from_address.toLowerCase(), c.from_address);
      if (c.to_address) originalCase.set(c.to_address.toLowerCase(), c.to_address);
    }
  }

  return (
    <div className="space-y-3">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${isSuccess ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
          >
            {isSuccess
              ? t('transactions.simulationSuccess')
              : t('transactions.simulationFailure')}
          </span>
          <Badge variant={isSuccess ? 'success' : 'danger'}>
            {status}
          </Badge>
        </div>
        {gas_used != null && (
          <span className="text-sm text-[var(--muted)]">
            {t('transactions.simulationGasUsed')}: {formatGas(gas_used)}
          </span>
        )}
      </div>

      {/* Revert reason */}
      {result.revert_reason && (
        <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger)]/5 p-3">
          <p className="text-sm text-[var(--danger)]">
            <span className="font-medium">
              {t('transactions.simulationRevertReason')}:
            </span>{' '}
            {result.revert_reason}
          </p>
        </div>
      )}

      {/* Asset changes by address */}
      {sortedAddresses.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-[var(--muted)]">
            {t('transactions.simulationAssetChanges')}
          </h4>
          <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {sortedAddresses.map((addrKey) => {
              const addr = originalCase.get(addrKey) || addrKey;
              const rows = addressGroups.get(addrKey)!;
              return (
                <div key={addrKey} className="px-3 py-2">
                  {/* Address header */}
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-sm font-semibold text-[var(--text)] truncate">
                      {getAddressLabel(addr)}
                    </span>
                    <CopyButton value={addr} />
                  </div>
                  {/* Asset rows */}
                  <div className="space-y-1 pl-1">
                    {rows.map((row, idx) => {
                      const amount = formatBalance(row.rawAmount, row.tokenDecimals, 6);
                      return (
                        <div
                          key={`${row.tokenAddress}-${row.isSent}-${idx}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                row.isApprove
                                  ? 'bg-[var(--warning)]'
                                  : row.isSent
                                    ? 'bg-[var(--danger)]'
                                    : 'bg-[var(--success)]'
                              }`}
                            />
                            {row.isApprove ? (
                              <span className="text-sm text-[var(--muted)] inline-flex items-center gap-1 flex-wrap">
                                🔑 {t('transactions.simulationApproval')}{' '}
                                <span className="text-[var(--warning)] font-semibold">
                                  {amount} {row.symbol}
                                </span>
                                {row.spenderAddress && (
                                  <>
                                    <span>→</span>
                                    <span className="inline-flex items-center gap-0.5">
                                      {getAddressLabel(row.spenderAddress)}
                                      <CopyButton value={row.spenderAddress} />
                                    </span>
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="text-sm text-[var(--muted)]">
                                {row.symbol}
                              </span>
                            )}
                          </div>
                          {!row.isApprove && (
                          <div className="shrink-0 text-right flex items-baseline gap-2">
                            <span
                              className={`text-sm font-semibold ${
                                row.isSent
                                  ? 'text-[var(--danger)]'
                                  : 'text-[var(--success)]'
                              }`}
                            >
                              {row.isSent ? '-' : '+'}
                              {amount} {row.symbol}
                            </span>
                            {row.dollarValue && row.dollarValue !== '0' && row.dollarValue !== '' && (
                              <span className="text-sm text-[var(--muted)]">
                                ≈ ${row.dollarValue}
                              </span>
                            )}
                          </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Simulated at */}
      <p className="text-sm text-[var(--muted)]">
        {t('transactions.simulationSimulatedAt')}:{' '}
        {formatAbsoluteTime(simulation.updated_at, language, timezone)}
      </p>
    </div>
  );
};
