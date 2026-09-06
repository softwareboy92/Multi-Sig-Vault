/**
 * Strip address-level (non-hardened) trailing segments from a derivation path,
 * keeping only the account-level (all-hardened) prefix.
 *
 * m/48'/1'/0'/2'/0/0 → m/48'/1'/0'/2'
 * m/84'/0'/0'/0/0    → m/84'/0'/0'
 * m/48'/0'/0'/2'     → m/48'/0'/0'/2'  (already account-level)
 *
 * If the path has no hardened segments it is returned as-is.
 */
export function toAccountLevelPath(path: string): string {
  const parts = path.split("/");
  const hardenedCount = parts.filter((p) => p.endsWith("'")).length;
  if (hardenedCount === 0) return path;
  return parts.slice(0, 1 + hardenedCount).join("/");
}

/**
 * Extract the BTC account index from a derivation path.
 * Works for any purpose (BIP 44/48/84/86): the account is always
 * the third hardened segment: m/purpose'/coin'/account'/...
 *
 * Returns "0" when the path is missing or unparseable.
 */
export function parseBtcAccount(path?: string | null): string {
  if (!path) return "0";
  const match = path.match(/m\/\d+'\/\d+'\/(\d+)'/);
  if (!match) return "0";
  return match[1] || "0";
}
