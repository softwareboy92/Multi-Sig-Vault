// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Ledger BTC Adapter
// ═══════════════════════════════════════════════════════════════════════════

import type {
  BtcSignResult,
  LedgerChainAdapter,
  LedgerTransport,
  WalletPolicy,
} from './types.js';
import { extractPublicKeyFromXpub, buildFullDerivationPath } from '../../utils/xpub.js';

// ─── BTC Address Options ──────────────────────────────────────────────────
export interface BtcAddressOptions {
  /** Change path: 0 = external/receive, 1 = internal/change (default: 0) */
  change?: 0 | 1;
  /** Address index (default: 0) */
  addressIndex?: number;
}

// ─── BTC Address Result ───────────────────────────────────────────────────
export interface BtcAddressResult {
  /** Bitcoin address */
  address: string;
  /** Compressed public key (33 bytes, hex) */
  publicKey: string;
  /** Extended public key (xpub) at account level */
  xpub: string;
  /** Master fingerprint (hex) */
  masterFingerprint: string;
  /** Full derivation path including change/index */
  derivationPath: string;
}

// ─── BTC Payload Type ─────────────────────────────────────────────────────
export interface BtcSignPayload {
  psbt: string; // Base64 encoded PSBT
  walletPolicy?: WalletPolicy;
  walletHmac?: Buffer;
}

// Lazy-loaded ledger-bitcoin classes
let LedgerBitcoinModule: {
  AppClient: typeof import('ledger-bitcoin').AppClient;
  DefaultWalletPolicy: typeof import('ledger-bitcoin').DefaultWalletPolicy;
  WalletPolicy: typeof import('ledger-bitcoin').WalletPolicy;
} | null = null;

async function getLedgerBitcoinModule() {
  if (!LedgerBitcoinModule) {
    const mod = await import('ledger-bitcoin');
    LedgerBitcoinModule = {
      AppClient: mod.AppClient,
      DefaultWalletPolicy: mod.DefaultWalletPolicy,
      WalletPolicy: mod.WalletPolicy,
    };
  }
  return LedgerBitcoinModule;
}

/**
 * Ledger Bitcoin chain adapter
 * Uses ledger-bitcoin library for PSBT signing
 */
export class LedgerBtcAdapter
  implements LedgerChainAdapter<BtcSignPayload, BtcSignResult>
{
  readonly chainType = 'BITCOIN' as const;
  readonly requiredApp = 'Bitcoin';

  private btcApp: BtcAppInstance | null = null;

  /**
   * Initialize BTC app on transport
   */
  async initApp(transport: LedgerTransport): Promise<void> {
    const mod = await getLedgerBitcoinModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.btcApp = new mod.AppClient(transport as any) as unknown as BtcAppInstance;
  }

  /**
   * Get Bitcoin address from device
   * 
   * @param transport - Ledger transport
   * @param derivationPath - Account-level derivation path (e.g., "m/84'/0'/0'")
   * @param display - Whether to show address on device
   * @param options - Address options (change, addressIndex)
   * @returns BtcAddressResult with address, publicKey, xpub, masterFingerprint, derivationPath
   */
  async getAddress(
    transport: LedgerTransport,
    derivationPath: string,
    display: boolean,
    options: BtcAddressOptions = {}
  ): Promise<BtcAddressResult> {
    await this.ensureApp(transport);

    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    const change = options.change ?? 0;
    const addressIndex = options.addressIndex ?? 0;

    // Get master fingerprint
    const masterFingerprint = await this.btcApp.getMasterFingerprint();
    const fpHex =
      typeof masterFingerprint === 'string'
        ? masterFingerprint
        : masterFingerprint.toString('hex');

    // Get extended public key for the account path
    const xpub = await this.btcApp.getExtendedPubkey(derivationPath, false);

    // BIP 48 multisig paths cannot use DefaultWalletPolicy (single-sig wpkh).
    // For multisig signer import we only need xpub + fingerprint + pubkey;
    // the actual P2WSH address depends on ALL signers and is computed later.
    const isBip48 = derivationPath.startsWith("m/48'");

    let address = '';
    if (!isBip48) {
      // Single-sig: use DefaultWalletPolicy to get address
      const policy = await this.createDefaultPolicy(masterFingerprint, xpub, derivationPath);
      address = await this.btcApp.getWalletAddress(
        policy,
        null, // DefaultWalletPolicy doesn't need registration
        change,
        addressIndex,
        display
      );
    } else {
      // For BIP 48 multisig, show xpub on device for user verification
      // (P2WSH address requires all signer keys and cannot be shown here)
      if (display) {
        await this.btcApp.getExtendedPubkey(derivationPath, true);
      }
    }

    // Build full derivation path
    const fullDerivationPath = buildFullDerivationPath(derivationPath, change, addressIndex);

    // Get child xpub at the full path to extract compressed public key
    const childXpub = await this.btcApp.getExtendedPubkey(fullDerivationPath, false);
    const compressedPubkey = await extractPublicKeyFromXpub(childXpub);

    const result = {
      address,
      publicKey: compressedPubkey,
      xpub,
      masterFingerprint: fpHex,
      derivationPath: fullDerivationPath,
    };
    return result;
  }

  /**
   * Sign PSBT transaction
   */
  async signTransaction(
    transport: LedgerTransport,
    derivationPath: string,
    payload: BtcSignPayload
  ): Promise<BtcSignResult> {
    await this.ensureApp(transport);

    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    // If wallet policy is provided, use it (multisig case)
    // Otherwise, create a default single-sig policy
    let policy: WalletPolicyInstance | DefaultWalletPolicyInstance;
    let hmac: Buffer | null;

    if (payload.walletPolicy && payload.walletHmac) {
      // Multisig: use provided policy and hmac
      policy = await this.convertToWalletPolicy(payload.walletPolicy);
      hmac = payload.walletHmac;
    } else {
      // Single-sig: use DefaultWalletPolicy (no registration needed)
      const masterFingerprint = await this.btcApp.getMasterFingerprint();
      const xpub = await this.btcApp.getExtendedPubkey(derivationPath, false);
      policy = await this.createDefaultPolicy(masterFingerprint, xpub, derivationPath);
      hmac = null;
    }

    // Parse PSBT from base64
    const psbtBuffer = Buffer.from(payload.psbt, 'base64');

    // Sign the PSBT
    const signatures = await this.btcApp.signPsbt(psbtBuffer, policy, hmac);

    // Return as array to preserve all signatures (Map would lose duplicates for same input)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
      signatures: signatures.map(([idx, ps]: [number, any]) => [
        idx,
        { pubkey: Buffer.from(ps.pubkey), signature: Buffer.from(ps.signature) }
      ]),
    };
  }

  /**
   * Sign message (BIP-322 or legacy)
   */
  async signMessage(
    transport: LedgerTransport,
    derivationPath: string,
    message: string
  ): Promise<string> {
    await this.ensureApp(transport);

    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    // Sign using BIP-322 simple message format
    const signature = await this.btcApp.signMessage(
      Buffer.from(message, 'utf8'),
      derivationPath
    );

    return typeof signature === 'string' ? signature : signature.toString('base64');
  }

  /**
   * Get master fingerprint
   */
  async getMasterFingerprint(transport: LedgerTransport): Promise<string> {
    await this.ensureApp(transport);

    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    const fp = await this.btcApp.getMasterFingerprint();
    return fp.toString('hex');
  }

  /**
   * Get extended public key
   */
  async getExtendedPubkey(
    transport: LedgerTransport,
    derivationPath: string,
    display: boolean = false
  ): Promise<string> {
    await this.ensureApp(transport);

    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    return this.btcApp.getExtendedPubkey(derivationPath, display);
  }

  /**
   * Register a wallet policy
   */
  async registerWallet(
    transport: LedgerTransport,
    policy: WalletPolicy
  ): Promise<{ id: Buffer; hmac: Buffer }> {
    await this.ensureApp(transport);

    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    const walletPolicy = await this.convertToWalletPolicy(policy);
    const [id, hmac] = await this.btcApp.registerWallet(walletPolicy);

    return { id, hmac };
  }

  /**
   * Clear cached app instance
   */
  clearApp(): void {
    this.btcApp = null;
  }

  /**
   * Display address on device for visual verification only.
   * Uses pre-existing xpub and masterFingerprint (from connect) to rebuild
   * the wallet policy, avoiding redundant APDU calls.
   */
  async displayAddress(
    transport: LedgerTransport,
    accountPath: string,
    xpub: string,
    masterFingerprint: string,
    change: number,
    addressIndex: number,
  ): Promise<void> {
    await this.ensureApp(transport);
    if (!this.btcApp) {
      throw new Error('BTC app not initialized');
    }

    // BIP 48 multisig: show xpub on device (P2WSH address needs all signers)
    if (accountPath.startsWith("m/48'")) {
      await this.btcApp.getExtendedPubkey(accountPath, true);
      return;
    }

    const policy = await this.createDefaultPolicy(masterFingerprint, xpub, accountPath);
    await this.btcApp.getWalletAddress(policy, null, change, addressIndex, true);
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async ensureApp(transport: LedgerTransport): Promise<void> {
    if (!this.btcApp) {
      await this.initApp(transport);
    }
  }

  private async createDefaultPolicy(
    masterFingerprint: Buffer | string,
    xpub: string,
    derivationPath: string
  ): Promise<DefaultWalletPolicyInstance> {
    const mod = await getLedgerBitcoinModule();
    // Native SegWit single-sig policy using DefaultWalletPolicy
    // DefaultWalletPolicy is for standard single-sig wallets and doesn't require registration
    const fpHex =
      typeof masterFingerprint === 'string'
        ? masterFingerprint
        : masterFingerprint.toString('hex');

    // Format key info: [fingerprint/path]xpub
    // e.g., [73c5da0a/84'/0'/0']xpub...
    const keyInfo = `[${fpHex}${derivationPath.replace('m', '')}]${xpub}`;
    
    // DefaultWalletPolicy for wpkh (native segwit)
    return new mod.DefaultWalletPolicy('wpkh(@0/**)', keyInfo) as unknown as DefaultWalletPolicyInstance;
  }

  private async convertToWalletPolicy(policy: WalletPolicy): Promise<WalletPolicyInstance> {
    const mod = await getLedgerBitcoinModule();
    // WalletPolicy is for multisig and other complex scripts
    const walletPolicy = new mod.WalletPolicy(
      policy.name,
      policy.descriptorTemplate,
      policy.keys
    );
    
    return walletPolicy as unknown as WalletPolicyInstance;
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────
// Simplified types - actual ledger-bitcoin types are more complex
// We use string for fingerprint as newer versions return string directly

interface BtcAppInstance {
  getMasterFingerprint(): Promise<Buffer | string>;
  getExtendedPubkey(path: string, display: boolean): Promise<string>;
  registerWallet(policy: WalletPolicyInstance): Promise<[Buffer, Buffer]>;
  getWalletAddress(
    policy: DefaultWalletPolicyInstance | WalletPolicyInstance,
    hmac: Buffer | null,
    change: number,
    addressIndex: number,
    display: boolean
  ): Promise<string>;
  signPsbt(
    psbt: Buffer,
    policy: WalletPolicyInstance | DefaultWalletPolicyInstance,
    hmac: Buffer | null
  ): Promise<Array<[number, Buffer]>>;
  signMessage(message: Buffer, path: string): Promise<Buffer | string>;
}

interface WalletPolicyInstance {
  name: string;
  descriptorTemplate: string;
  keys: string[];
}

interface DefaultWalletPolicyInstance {
  descriptorTemplate: string;
  keyInfo: string;
}
