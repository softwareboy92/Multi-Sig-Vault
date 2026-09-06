import type { BadgeVariant } from "@/components/ui";

// ---------------------------------------------------------------------------
// Transaction status → badge variant
// ---------------------------------------------------------------------------
// SIGNED / BROADCAST are intermediate steps (not yet confirmed on-chain),
// so they use "info" rather than "success" to distinguish from CONFIRMED.
// ---------------------------------------------------------------------------

export const TX_STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING_SIGN: "warning",
  PARTIALLY_SIGNED: "warning",
  SIGNED: "info",
  BROADCAST: "info",
  PENDING_CONFIRMATION: "warning",
  CONFIRMED: "success",
  FAILED: "danger",
  CANCELLED: "default",
};

/** Statuses that should show a pulsing dot indicator. */
export const TX_STATUS_DOT = new Set([
  "PENDING_SIGN",
  "PARTIALLY_SIGNED",
  "PENDING_CONFIRMATION",
]);

// ---------------------------------------------------------------------------
// Wallet status → badge variant
// ---------------------------------------------------------------------------
// ARCHIVED is a deliberate, neutral state — "default" (gray), not "danger".
// ---------------------------------------------------------------------------

export const WALLET_STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  PENDING_DEPLOY: "warning",
  ARCHIVED: "default",
};

// ---------------------------------------------------------------------------
// Signer status → badge variant
// ---------------------------------------------------------------------------

export const SIGNER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  VERIFIED: "success",
  UNVERIFIED: "warning",
  REVOKED: "danger",
};
