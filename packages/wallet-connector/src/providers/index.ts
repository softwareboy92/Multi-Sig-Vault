// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Providers Export
// ═══════════════════════════════════════════════════════════════════════════

export { MetaMaskProvider } from './metamask.js';

export { WalletConnectProvider } from './walletconnect.js';
export type { WalletConnectConfig, SessionInfo } from './walletconnect.js';

export { LedgerProvider } from './ledger/index.js';
export type { LedgerConfig, LedgerAccount, LedgerTransport, TransportType } from './ledger/index.js';

export { LedgerBtcAdapter } from './ledger/btc-adapter.js';
export type { BtcSignPayload as LedgerBtcPayload } from './ledger/btc-adapter.js';

export { LedgerEthAdapter } from './ledger/eth-adapter.js';

export { KeyVaultProvider } from './keyvault/index.js';
export type { KeyVaultConfig, KeyVaultConnectOptions } from './keyvault/index.js';
