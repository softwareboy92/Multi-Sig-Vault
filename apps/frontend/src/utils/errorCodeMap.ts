/**
 * Maps backend error codes to i18n translation keys.
 *
 * The keys here must match the `code` field in the backend's ErrorResponse.
 * The values are dot-path keys into the i18n translations.
 */
export const errorCodeMap: Record<string, string> = {
  NOT_FOUND: "error.notFound",
  VALIDATION_ERROR: "error.validation",
  CONFLICT: "error.conflict",
  CHAIN_ERROR: "error.chainError",
  SIGNER_NOT_VERIFIED: "error.signerNotVerified",
  INSUFFICIENT_SIGNATURES: "error.insufficientSignatures",
  INVALID_SIGNATURE: "error.invalidSignature",
  WALLET_NOT_ACTIVE: "error.walletNotActive",
  INTERNAL_ERROR: "error.internal",
  NETWORK_ERROR: "error.networkUnavailable",
};
