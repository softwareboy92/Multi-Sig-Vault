import React from "react";
import { Badge } from "../ui";
import { WALLET_STATUS_VARIANT } from "@/utils/status-variants";

const CHAIN_COLORS: Record<string, string> = {
  BTC: "#F7931A",
  EVM: "#627EEA",
};

interface WalletStatusBadgeProps {
  status: string;
  label: string;
  dot?: boolean;
}

/**
 * Semantic-colored status badge for wallet status.
 */
export const WalletStatusBadge: React.FC<WalletStatusBadgeProps> = ({
  status,
  label,
  dot = false,
}) => (
  <Badge variant={WALLET_STATUS_VARIANT[status] || "default"} dot={dot || status === "PENDING_DEPLOY"}>
    {label}
  </Badge>
);

interface ChainBadgeProps {
  chainType: string;
  chainLabel: string;
}

/**
 * Chain badge with colored dot indicator.
 */
export const ChainBadge: React.FC<ChainBadgeProps> = ({ chainType, chainLabel }) => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--row-head-bg)] text-[var(--text)]">
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: CHAIN_COLORS[chainType] || "var(--muted)" }}
    />
    {chainLabel}
  </span>
);

interface ThresholdBadgeProps {
  threshold: number;
  signerCount: number;
}

/**
 * Threshold badge showing M/N multisig configuration.
 */
export const ThresholdBadge: React.FC<ThresholdBadgeProps> = ({
  threshold,
  signerCount,
}) => (
  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--row-head-bg)] text-[var(--text)]">
    {threshold}/{signerCount}
  </span>
);
