// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Ledger ETH Adapter
// ═══════════════════════════════════════════════════════════════════════════

import { ethers } from 'ethers';
import type {
  EIP712TypedData,
  EthSignResult,
  LedgerChainAdapter,
  LedgerTransport,
} from './types.js';
import { buildXpubFromComponents, compressPublicKey } from '../../utils/xpub.js';

// ─── ETH Address Options ──────────────────────────────────────────────────
export interface EthAddressOptions {
  /** Address index (default: 0) */
  addressIndex?: number;
}

// ─── ETH Address Result ───────────────────────────────────────────────────
export interface EthAddressResult {
  /** Ethereum address (0x-prefixed checksum) */
  address: string;
  /** Compressed public key (33 bytes, hex) */
  publicKey: string;
  /** Extended public key (xpub) at account level */
  xpub: string;
  /** Full derivation path including index */
  derivationPath: string;
}

/**
 * Ledger Ethereum chain adapter
 * Uses @ledgerhq/hw-app-eth under the hood
 */
export class LedgerEthAdapter
  implements LedgerChainAdapter<EIP712TypedData, EthSignResult>
{
  readonly chainType = 'ETHEREUM' as const;
  readonly requiredApp = 'Ethereum';

  private ethApp: EthAppInstance | null = null;

  /**
   * Initialize ETH app on transport
   */
  async initApp(transport: LedgerTransport): Promise<void> {
    const { default: Eth } = await import('@ledgerhq/hw-app-eth');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.ethApp = new Eth(transport as any) as EthAppInstance;
  }

  /**
   * Get Ethereum address from device
   * 
   * @param transport - Ledger transport
   * @param derivationPath - Base derivation path (e.g., "m/44'/60'/0'/0")
   * @param display - Whether to show address on device
   * @param options - Address options (addressIndex)
   * @returns EthAddressResult with address, publicKey, xpub, derivationPath
   */
  async getAddress(
    transport: LedgerTransport,
    derivationPath: string,
    display: boolean,
    options: EthAddressOptions = {}
  ): Promise<EthAddressResult> {
    await this.ensureApp(transport);

    if (!this.ethApp) {
      throw new Error('ETH app not initialized');
    }

    const addressIndex = options.addressIndex ?? 0;

    // Build full derivation path with address index
    // ETH path format: m/44'/60'/0'/0/index
    const fullDerivationPath = this.buildFullPath(derivationPath, addressIndex);

    // Get address with chainCode (3rd param = true)
    const result = await this.ethApp.getAddress(fullDerivationPath, display, true);

    // Compress the public key (Ledger returns 65-byte uncompressed key)
    const compressedPubkey = compressPublicKey(result.publicKey);

    // Build xpub from public key and chain code
    // For ETH, we build the xpub at the account level (m/44'/60'/0'/0/index)
    // Depth is 5 (m/purpose/coin/account/change/index)
    const xpub = await buildXpubFromComponents(
      compressedPubkey,
      result.chainCode!,
      '00000000', // Parent fingerprint (we don't have it, use zeroes)
      5, // depth
      addressIndex, // child number (index)
      false // mainnet
    );

    return {
      address: result.address,
      publicKey: compressedPubkey,
      xpub,
      derivationPath: fullDerivationPath,
    };
  }

  /**
   * Build full derivation path with address index
   */
  private buildFullPath(basePath: string, addressIndex: number): string {
    const normalized = basePath.startsWith('m/') ? basePath : `m/${basePath}`;
    const parts = normalized.split('/');

    // If already has 5 components (m/44'/60'/0'/0/0), replace last index
    if (parts.length === 6) {
      parts[5] = String(addressIndex);
      return parts.join('/');
    }

    // If has 5 components (m/44'/60'/0'/0), add index
    if (parts.length === 5) {
      return `${normalized}/${addressIndex}`;
    }

    // If has 4 components (m/44'/60'/0'), add change and index
    if (parts.length === 4) {
      return `${normalized}/0/${addressIndex}`;
    }

    throw new Error(`Unexpected ETH path format: ${basePath}`);
  }

  /**
   * Sign EIP-712 typed data using hashed message method
   * This avoids CORS issues with Ledger's crypto-assets-service
   */
  async signTransaction(
    transport: LedgerTransport,
    derivationPath: string,
    payload: EIP712TypedData
  ): Promise<EthSignResult> {
    await this.ensureApp(transport);

    if (!this.ethApp) {
      throw new Error('ETH app not initialized');
    }

    const { types, primaryType, domain, message } = payload;

    console.log('[ETH Adapter] signEIP712 called');
    console.log('[ETH Adapter] derivationPath:', derivationPath);
    console.log('[ETH Adapter] primaryType:', primaryType);
    console.log('[ETH Adapter] domain:', JSON.stringify(domain));

    // Filter out EIP712Domain from types - ethers.js handles it separately
    const filteredTypes: Record<string, Array<{ name: string; type: string }>> = {};
    for (const [key, value] of Object.entries(types)) {
      if (key !== 'EIP712Domain') {
        filteredTypes[key] = value;
      }
    }

    // Use ethers.js to compute EIP-712 hashes
    // This is more reliable than relying on Ledger's API service
    const typedDataEncoder = new ethers.TypedDataEncoder(filteredTypes);
    
    // Compute domain separator hash
    const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
    
    // Compute message hash (structHash)
    const messageHash = typedDataEncoder.hashStruct(primaryType, message);

    console.log('[ETH Adapter] domainSeparator:', domainSeparator);
    console.log('[ETH Adapter] messageHash:', messageHash);
    console.log('[ETH Adapter] Calling signEIP712HashedMessage...');

    try {
      // Use signEIP712HashedMessage which doesn't require API calls
      // Parameters: path, domainSeparatorHex (no 0x), hashStructMessageHex (no 0x)
      const result = await this.ethApp.signEIP712HashedMessage(
        derivationPath,
        domainSeparator.slice(2),  // Remove 0x prefix
        messageHash.slice(2)        // Remove 0x prefix
      );

      console.log('[ETH Adapter] signEIP712HashedMessage success');
      return this.formatSignature(result);
    } catch (err) {
      console.error('[ETH Adapter] signEIP712HashedMessage error:', err);
      throw err;
    }
  }

  /**
   * Sign personal message
   */
  async signMessage(
    transport: LedgerTransport,
    derivationPath: string,
    message: string
  ): Promise<string> {
    await this.ensureApp(transport);

    if (!this.ethApp) {
      throw new Error('ETH app not initialized');
    }

    // Convert message to hex buffer
    const messageHex = Buffer.from(message, 'utf8').toString('hex');

    const result = await this.ethApp.signPersonalMessage(
      derivationPath,
      messageHex
    );

    const sig = this.formatSignature(result);
    return sig.signature;
  }

  /**
   * Sign raw transaction
   */
  async signRawTransaction(
    transport: LedgerTransport,
    derivationPath: string,
    rawTx: string
  ): Promise<EthSignResult> {
    await this.ensureApp(transport);

    if (!this.ethApp) {
      throw new Error('ETH app not initialized');
    }

    const result = await this.ethApp.signTransaction(
      derivationPath,
      rawTx.startsWith('0x') ? rawTx.slice(2) : rawTx
    );

    return this.formatSignature(result);
  }

  /**
   * Clear cached app instance
   */
  clearApp(): void {
    this.ethApp = null;
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async ensureApp(transport: LedgerTransport): Promise<void> {
    if (!this.ethApp) {
      await this.initApp(transport);
    }
  }

  /**
   * Display address on device for visual verification only.
   * Minimal APDU call — no xpub/pubkey extraction.
   */
  async displayAddress(
    transport: LedgerTransport,
    fullDerivationPath: string,
  ): Promise<void> {
    await this.ensureApp(transport);
    if (!this.ethApp) {
      throw new Error('ETH app not initialized');
    }
    // display=true, chainCode=false (not needed for pure display)
    await this.ethApp.getAddress(fullDerivationPath, true, false);
  }

  private formatSignature(result: LedgerSignResult): EthSignResult {
    // Ledger returns v as a number or hex string
    // For EIP-712, v should be 27 or 28
    let v = typeof result.v === 'number' ? result.v : parseInt(result.v, 16);
    
    // Normalize v to 27/28 if it's 0/1
    if (v === 0 || v === 1) {
      v = v + 27;
    }
    
    const r = '0x' + result.r;
    const s = '0x' + result.s;

    // Combine into full signature: r (32 bytes) + s (32 bytes) + v (1 byte)
    // v should be a single byte hex (e.g., "1b" or "1c")
    const vHex = v.toString(16).padStart(2, '0');
    const signature = '0x' + result.r + result.s + vHex;

    console.log('[ETH Adapter] formatSignature:', { r, s, v, vHex, signature: signature.slice(0, 20) + '...' });
    
    return { v, r, s, signature };
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────
// Simplified types - actual @ledgerhq/hw-app-eth types are more complex

interface LedgerSignResult {
  v: string | number;
  r: string;
  s: string;
}

interface EthAppInstance {
  getAddress(
    path: string,
    display?: boolean,
    chainCode?: boolean
  ): Promise<{ address: string; publicKey: string; chainCode?: string }>;
  signTransaction(path: string, rawTxHex: string): Promise<LedgerSignResult>;
  signPersonalMessage(path: string, messageHex: string): Promise<LedgerSignResult>;
  signEIP712Message(
    path: string,
    jsonMessage: {
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      domain: Record<string, unknown>;
      message: Record<string, unknown>;
    }
  ): Promise<LedgerSignResult>;
  signEIP712HashedMessage(
    path: string,
    domainSeparatorHex: string,
    hashStructMessageHex: string
  ): Promise<LedgerSignResult>;
}
