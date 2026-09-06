// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - NXV Protocol Response Decoder
// ═══════════════════════════════════════════════════════════════════════════
//
// Decodes and normalizes JSON responses from the KeyVault device.
// Handles the ambiguity in the NXV protocol where field names may appear
// in camelCase or snake_case, and signatures may be at different nesting
// levels depending on single-tx vs batch-tx operations.
//
// Bug fix vs existing frontend: uses `??` instead of `||` for signature
// extraction so that empty-string signatures are preserved as values
// rather than falling through to the next candidate.
//
// @see KeyVaultSignModal.tsx:44-62     (sign result extraction)
// @see ImportSignatureAddressForm.tsx:309-349 (import signer extraction)
// ═══════════════════════════════════════════════════════════════════════════

import type { NxvAccountInfo, NxvResponse, NxvSignResult, NxvImportSignerResult } from './types.js';

// ─── Public Return Types ──────────────────────────────────────────────────

/** Normalized per-transaction signature */
export interface ExtractedSignature {
  transferId: string;
  signature: string;
}

/** Normalized account info with consistent field names */
export interface ExtractedSignerAccount {
  address: string;
  publicKey: string;
  derivationPath: string;
  masterFingerprint: string;
  xpub: string;
  name: string;
  challengeSignature: string;
}

// ─── Allowed Actions ──────────────────────────────────────────────────────

const VALID_ACTIONS = new Set<string>(['sign_result', 'import_signer_result']);

// ─── Core Decoder ─────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string from the KeyVault device and validate the action.
 *
 * @throws {SyntaxError} on invalid JSON
 * @throws {Error} on unrecognized `nxv_action`
 */
export function decodeNxvResponse(json: string): NxvResponse {
  const parsed = JSON.parse(json); // throws SyntaxError on bad JSON

  const action: unknown = parsed?.nxv_action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(
      `Unknown or missing nxv_action: ${JSON.stringify(action)}`,
    );
  }

  return parsed as NxvResponse;
}

// ─── Signature Extraction ─────────────────────────────────────────────────

/**
 * Extract an array of `{transferId, signature}` from a sign result.
 *
 * Prefers the `signResult[]` array when present (batch signing).
 * Falls back to the top-level `b_data.signature` for single-tx results.
 *
 * Uses `??` (not `||`) so that an empty-string signature is preserved
 * as a valid value rather than falling through — fixing a bug in the
 * original frontend code.
 */
export function extractSignatures(result: NxvSignResult): ExtractedSignature[] {
  const { b_data } = result;
  const signResultArr = b_data?.signResult;

  // Batch: per-transaction array takes precedence
  if (Array.isArray(signResultArr) && signResultArr.length > 0) {
    return signResultArr.map((item) => ({
      transferId: item.transfer_id ?? '',
      signature: item.signature ?? '',
    }));
  }

  // Single: wrap top-level signature into a one-element array.
  // `??` preserves empty string as intentional value.
  const sig = b_data?.signature ?? '';
  return [{ transferId: '', signature: sig }];
}

// ─── Signer Account Extraction ────────────────────────────────────────────

/**
 * Extract normalized account info from an import_signer_result.
 *
 * Handles both camelCase and snake_case field variants with `??` chains,
 * matching the behaviour in ImportSignatureAddressForm.tsx:309-349.
 */
export function extractSignerAccount(
  result: NxvImportSignerResult,
): ExtractedSignerAccount {
  const account: NxvAccountInfo = result.b_data?.account ?? {};
  const sig = result.b_data?.signature ?? '';

  return {
    address: account.address ?? '',
    publicKey: account.publicKey ?? account.public_key ?? '',
    derivationPath:
      account.path ?? account.derivationPath ?? account.derivation_path ?? '',
    masterFingerprint:
      account.fpr ?? account.masterFingerprint ?? account.master_fingerprint ?? '',
    xpub: account.xpub ?? '',
    name: account.name ?? '',
    challengeSignature: sig,
  };
}
