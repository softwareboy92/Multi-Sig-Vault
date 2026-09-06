// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Core Types
// ═══════════════════════════════════════════════════════════════════════════

// ─── Chain Types ──────────────────────────────────────────────────────────
export type ChainType = 'BITCOIN' | 'ETHEREUM';

// ─── Wallet Types ─────────────────────────────────────────────────────────
export type WalletType = 'LEDGER' | 'METAMASK' | 'WALLETCONNECT' | 'KEYVAULT';

// ─── Wallet State ─────────────────────────────────────────────────────────
export type WalletState =
  | 'UNINITIALIZED'
  | 'IDLE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'SIGNING'
  | 'ERROR';

// ─── Session State ────────────────────────────────────────────────────────
export type SessionState =
  | 'INACTIVE'
  | 'CHALLENGE_PENDING'
  | 'VERIFIED'
  | 'EXPIRED';

// ─── Account ──────────────────────────────────────────────────────────────
export interface Account {
  /** Address */
  address: string;

  /** Public key (required for BTC, optional for ETH) */
  publicKey?: string;

  /** Extended public key (required for BTC multisig) */
  xpub?: string;

  /** Derivation path */
  derivationPath?: string;

  /** Master fingerprint (required for BTC Ledger) */
  masterFingerprint?: string;

  /** Chain type */
  chain: ChainType;

  /** Wallet type */
  walletType: WalletType;
}

// ─── BTC Account (Extended) ───────────────────────────────────────────────
export interface BtcAccount extends Account {
  chain: 'BITCOIN';
  publicKey: string;
  xpub: string;
  masterFingerprint: string;
}

// ─── EVM Account (Extended) ───────────────────────────────────────────────
export interface EvmAccount extends Account {
  chain: 'ETHEREUM';
  address: string; // 0x-prefixed checksum address
}

// ─── EIP-3085: wallet_addEthereumChain Parameters ────────────────────────
export interface AddEthereumChainParams {
  /** Chain name displayed in wallet UI */
  chainName: string;
  /** Native currency info */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** RPC endpoint URLs (at least one required) */
  rpcUrls: string[];
  /** Block explorer URLs (optional) */
  blockExplorerUrls?: string[];
}

// ─── Connect Options ──────────────────────────────────────────────────────
export interface ConnectOptions {
  /** Target chain type */
  chain: ChainType;

  /** Derivation path (required for Ledger) */
  derivationPath?: string;

  /** Whether to show confirmation on device (Ledger) */
  showOnDevice?: boolean;

  /** Connection timeout in milliseconds */
  timeout?: number;

  /** EVM chain ID (MetaMask/WalletConnect) */
  evmChainId?: number;

  /** Parameters for wallet_addEthereumChain when target chain is not configured */
  addChainParams?: AddEthereumChainParams;
}

// ─── Ledger Connect Options ───────────────────────────────────────────────
export interface LedgerConnectOptions extends ConnectOptions {
  derivationPath: string;
  showOnDevice?: boolean;
  addressFormat?: 'legacy' | 'nested-segwit' | 'native-segwit' | 'taproot';
  
  /** Address index (default: 0) */
  addressIndex?: number;
  
  /** Change path: 0 = external/receive, 1 = internal/change (default: 0, BTC only) */
  change?: 0 | 1;
  
  /** Network type (BTC only): 'mainnet' or 'testnet'. Affects app name and coinType. */
  network?: 'mainnet' | 'testnet';
}

// ─── Sign Result ──────────────────────────────────────────────────────────
export interface SignResult {
  /** Signature (hex or base64 depending on chain) */
  signature: string;

  /** Signer address */
  signerAddress: string;

  /** Timestamp when signed */
  signedAt: Date;
}
