const BTC_DUST_LIMIT = 546;
const FEE_RATE_MAX = 10_000;
const FEE_RATE_LOW_THRESHOLD = 3;
const EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Rejects empty, non-numeric, zero, and negative amounts. */
export function validatePositiveAmount(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "transactions.amountRequired";
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return "transactions.amountInvalid";
  if (num <= 0) return "transactions.amountMustBePositive";
  return null;
}

/** Rejects amounts with more decimal places than the token supports. */
export function validateAmountPrecision(
  value: string,
  decimals: number,
): string | null {
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) return null;
  const fractionalLen = value.length - dotIndex - 1;
  if (fractionalLen > decimals) return "transactions.amountPrecisionExceeded";
  return null;
}

/** Rejects amount > available balance (both as decimal strings). */
export function validateAmountWithinBalance(
  amount: string,
  maxAmount: string,
): string | null {
  const a = Number.parseFloat(amount);
  const m = Number.parseFloat(maxAmount);
  if (!Number.isFinite(a) || !Number.isFinite(m)) return null;
  if (a > m) return "transactions.amountExceedsBalance";
  return null;
}

/** Rejects when amountSats + feeSats > totalInputSats. */
export function validateBtcTotalSpend(
  amountSats: number,
  feeSats: number,
  totalInputSats: number,
): string | null {
  if (amountSats + feeSats > totalInputSats) return "transactions.btcTotalExceedsInputs";
  return null;
}

/**
 * Warns when change output is > 0 but < dust limit.
 * Returns null when change === 0 (send-max) or change >= dust.
 */
export function validateBtcDustChange(
  totalInputSats: number,
  amountSats: number,
  feeSats: number,
): string | null {
  const change = totalInputSats - amountSats - feeSats;
  if (change > 0 && change < BTC_DUST_LIMIT) return "transactions.btcDustChangeWarning";
  return null;
}

/** Validate fee rate bounds + low-rate warning. */
export function validateFeeRate(rate: number): {
  error: string | null;
  warning: string | null;
} {
  if (!Number.isFinite(rate) || rate < 1) return { error: "transactions.feeRateInvalid", warning: null };
  if (rate > FEE_RATE_MAX) return { error: "transactions.feeRateTooHigh", warning: null };
  if (rate < FEE_RATE_LOW_THRESHOLD) return { error: null, warning: "transactions.feeRateLowWarning" };
  return { error: null, warning: null };
}

/** True if address is the EVM zero address. */
export function isZeroAddress(address: string): boolean {
  return address.trim().toLowerCase() === EVM_ZERO_ADDRESS;
}

/** Warning if toAddress matches walletAddress (case-insensitive). */
export function validateNotSelfTransfer(
  toAddress: string,
  walletAddress: string | null | undefined,
): string | null {
  if (!walletAddress) return null;
  if (toAddress.trim().toLowerCase() === walletAddress.trim().toLowerCase()) {
    return "transactions.selfTransferWarning";
  }
  return null;
}
