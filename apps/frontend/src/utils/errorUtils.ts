import { ApiError } from "../api/client";
import { errorCodeMap } from "./errorCodeMap";
import { walletErrorCodeMap, walletErrorMessageMap } from "./walletErrorMap";

type TranslateFn = (key: string, params?: Record<string, string>) => string;

/**
 * Extract a user-friendly error message from any thrown value.
 *
 * Priority:
 *  1. ApiError with known backend code → localized message via errorCodeMap
 *  2. ApiError with message → message as-is
 *  3. Known wallet/browser message → localized wallet message
 *  4. WalletError numeric code → localized wallet message
 *  5. Error → err.message
 *  5. string → the string
 *  6. fallback → t("error.unknownError")
 */
export function getErrorMessage(err: unknown, t: TranslateFn): string {
  if (err instanceof ApiError) {
    const i18nKey = errorCodeMap[err.code];
    if (i18nKey) return t(i18nKey);
    if (err.message) return err.message;
    return t("error.unknownError");
  }

  const rawMessage = getRawErrorMessage(err);
  const searchableMessage =
    err && typeof err === "object" && "name" in err
      ? `${String((err as { name?: unknown }).name || "")}: ${rawMessage || ""}`
      : rawMessage;

  if (searchableMessage) {
    const matched = walletErrorMessageMap.find(({ pattern }) =>
      pattern.test(searchableMessage),
    );
    if (matched) return t(matched.i18nKey);
  }

  const walletErrorCode = getWalletErrorCode(err);
  if (walletErrorCode !== null) {
    const i18nKey = walletErrorCodeMap[walletErrorCode];
    if (i18nKey) return t(i18nKey);
  }

  if (err instanceof Error) {
    return err.message;
  }

  if (typeof err === "string") {
    return err;
  }

  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.reason === "string") return obj.reason;
  }

  return t("error.unknownError");
}

/**
 * Extract the backend error code from an error, if available.
 */
export function getErrorCode(err: unknown): string | null {
  if (err instanceof ApiError) return err.code;
  return null;
}

/**
 * Check if the error represents a 404 Not Found.
 */
export function isNotFound(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404;
  return false;
}

/**
 * Check if the error is a network connectivity issue.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && /fetch|network|failed/i.test(err.message)) {
    return true;
  }
  if (err instanceof ApiError && err.code === "NETWORK_ERROR") {
    return true;
  }
  return false;
}

/**
 * Check if the error represents a 409 Conflict.
 */
export function isConflict(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 409;
  return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getWalletErrorCode(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" && walletErrorCodeMap[code] ? code : null;
}

function getRawErrorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (!err || typeof err !== "object") return null;
  const obj = err as Record<string, unknown>;
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.reason === "string") return obj.reason;
  return null;
}
