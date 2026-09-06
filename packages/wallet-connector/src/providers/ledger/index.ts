// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Ledger Provider
// ═══════════════════════════════════════════════════════════════════════════

import { BaseProvider } from '../../core/base.js';
import { WalletError, WalletErrorCode } from '../../core/errors.js';
import type {
  Account,
  ChainType,
  ConnectOptions,
  SignResult,
  WalletType,
  LedgerConnectOptions,
} from '../../types/wallet.js';
import type { SignPayload, BtcSignPayload, EvmSignPayload } from '../../types/payload.js';
import { LedgerBtcAdapter } from './btc-adapter.js';
import { LedgerEthAdapter } from './eth-adapter.js';
import type { LedgerAccount, LedgerTransport, TransportType } from './types.js';

// ─── Ledger Config ────────────────────────────────────────────────────────
export interface LedgerConfig {
  transportType?: TransportType;
  autoReconnect?: boolean;
}

// ─── Timeout Constants ────────────────────────────────────────────────────
const CONNECT_TIMEOUT = 60_000; // 60s for device connection
const SIGN_TIMEOUT = 120_000; // 120s for signing

// ─── Ledger Error Codes ───────────────────────────────────────────────────
const LEDGER_STATUS_CODES = {
  0x6985: WalletErrorCode.USER_REJECTED, // Conditions not satisfied
  0x6986: WalletErrorCode.DEVICE_LOCKED, // Command not allowed
  0x6700: WalletErrorCode.SIGNING_FAILED, // Wrong length
  0x6982: WalletErrorCode.DEVICE_LOCKED, // Security status not satisfied
  0x6a80: WalletErrorCode.SIGNING_FAILED, // Invalid data
  0x6d00: WalletErrorCode.LEDGER_APP_NOT_OPEN, // INS not supported
  0x6e00: WalletErrorCode.LEDGER_APP_NOT_OPEN, // CLA not supported
  0x5501: WalletErrorCode.USER_REJECTED, // User refused
  0x5502: WalletErrorCode.DEVICE_LOCKED, // Screen locked
} as const;

// ─── Required Apps Per Chain ──────────────────────────────────────────────
const REQUIRED_APPS: Record<ChainType, string> = {
  BITCOIN: 'Bitcoin',
  ETHEREUM: 'Ethereum',
};

// ─── BTC App Names by Network ─────────────────────────────────────────────
const BTC_APPS: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'Bitcoin',
  testnet: 'Bitcoin Test',
};

// ─── Helper to get required app name ──────────────────────────────────────
function getRequiredApp(chain: ChainType, network?: 'mainnet' | 'testnet'): string {
  if (chain === 'BITCOIN' && network) {
    return BTC_APPS[network];
  }
  return REQUIRED_APPS[chain];
}

/**
 * Ledger hardware wallet provider
 * Supports BTC and ETH chains via separate adapters
 */
export class LedgerProvider extends BaseProvider {
  readonly walletType: WalletType = 'LEDGER';
  readonly supportedChains: ChainType[] = ['BITCOIN', 'ETHEREUM'];

  private config: LedgerConfig;
  private transport: LedgerTransport | null = null;
  private btcAdapter: LedgerBtcAdapter;
  private ethAdapter: LedgerEthAdapter;
  private _currentChain: ChainType | null = null;
  private _currentNetwork: 'mainnet' | 'testnet' = 'mainnet';
  private _isSwitchingApp: boolean = false;
  private _transportVersion: number = 0;

  /** Get current connected chain */
  get currentChain(): ChainType | null {
    return this._currentChain;
  }

  /** Get current network (mainnet/testnet, BTC only) */
  get currentNetwork(): 'mainnet' | 'testnet' {
    return this._currentNetwork;
  }

  constructor(config: LedgerConfig = {}) {
    super();
    this.config = config;
    this.btcAdapter = new LedgerBtcAdapter();
    this.ethAdapter = new LedgerEthAdapter();
  }

  // ─── Initialization ──────────────────────────────────────

  async init(): Promise<void> {
    if (this._state !== 'UNINITIALIZED') {
      return;
    }

    // Check if WebHID is available
    if (!this.isWebHIDSupported()) {
      this.updateState('ERROR', 'WebHID is not supported in this browser');
      throw new WalletError(
        WalletErrorCode.BROWSER_NOT_SUPPORTED,
        'WebHID is not supported in this browser'
      );
    }

    this.updateState('IDLE');
  }

  // ─── Connection ──────────────────────────────────────────

  async connect(options: ConnectOptions): Promise<Account> {
    this.ensureInitialized();
    this.validateChain(options.chain);

    this.updateState('CONNECTING');
    this._currentChain = options.chain;
    
    // Store network for BTC (default to mainnet if not specified)
    const ledgerOptions = options as LedgerConnectOptions;
    if (options.chain === 'BITCOIN' && ledgerOptions.network) {
      this._currentNetwork = ledgerOptions.network;
    }

    try {
      // Request and open transport
      await this.openTransport(options.timeout ?? CONNECT_TIMEOUT);

      // Check and ensure correct app is open (pass network for BTC)
      await this.ensureCorrectApp(options.chain, true, this._currentNetwork);

      // Get account based on chain type
      const account = await this.getAccountForChain(
        options.chain,
        options.derivationPath,
        ledgerOptions
      );

      this.updateAccount(account);
      this.updateState('CONNECTED');

      return account;
    } catch (err) {
      await this.closeTransport();
      this.updateState('ERROR');
      throw this.wrapError(err, WalletErrorCode.CONNECTION_FAILED);
    }
  }

  async disconnect(): Promise<void> {
    await this.closeTransport();
    this.updateAccount(null);
    this._currentChain = null;
    this.updateState('IDLE');
  }

  // ─── Signing ─────────────────────────────────────────────

  async signMessage(message: string, account: Account): Promise<SignResult> {
    this.ensureConnected();
    this.ensureTransport();

    const ledgerAccount = account as LedgerAccount;
    this.updateState('SIGNING');

    try {
      let signature: string;

      if (account.chain === 'BITCOIN') {
        signature = await this.withTimeout(
          this.btcAdapter.signMessage(
            this.transport!,
            ledgerAccount.derivationPath,
            message
          ),
          SIGN_TIMEOUT,
          WalletErrorCode.OPERATION_TIMEOUT
        );
      } else if (account.chain === 'ETHEREUM') {
        signature = await this.withTimeout(
          this.ethAdapter.signMessage(
            this.transport!,
            ledgerAccount.derivationPath,
            message
          ),
          SIGN_TIMEOUT,
          WalletErrorCode.OPERATION_TIMEOUT
        );
      } else {
        throw new WalletError(
          WalletErrorCode.CHAIN_NOT_SUPPORTED,
          `Chain ${account.chain} is not supported by Ledger provider`
        );
      }

      this.updateState('CONNECTED');

      return {
        signature,
        signerAddress: account.address,
        signedAt: new Date(),
      };
    } catch (err) {
      this.updateState('CONNECTED');
      throw this.wrapError(err, WalletErrorCode.SIGNING_FAILED);
    }
  }

  async signTransaction(
    payload: SignPayload,
    account: Account
  ): Promise<SignResult> {
    this.ensureConnected();
    this.ensureTransport();

    const ledgerAccount = account as LedgerAccount;
    this.updateState('SIGNING');

    try {
      let signature: string;

      if (payload.type === 'btc') {
        const btcPayload = payload as BtcSignPayload;
        const walletPolicy = btcPayload.walletPolicy
          ? {
              name: btcPayload.walletPolicy.name,
              descriptorTemplate: btcPayload.walletPolicy.descriptorTemplate,
              keys: btcPayload.walletPolicy.keys,
            }
          : undefined;
        const result = await this.withTimeout(
          this.btcAdapter.signTransaction(
            this.transport!,
            ledgerAccount.derivationPath,
            {
              psbt: btcPayload.psbt,
              walletPolicy,
              walletHmac: btcPayload.walletHmac
                ? Buffer.from(btcPayload.walletHmac, 'hex')
                : undefined,
            }
          ),
          SIGN_TIMEOUT,
          WalletErrorCode.OPERATION_TIMEOUT
        );

        // Convert signatures to JSON format for backend
        // BtcSignResult.signatures is Array<[number, {pubkey, signature}]>
        const sigEntries = result.signatures;
        
        // Build signature data: [[inputIndex, {pubkey: hex, signature: hex}], ...]
        const sigData = sigEntries.map(([idx, partialSig]) => {
          // Convert to hex
          const pubkeyHex = Buffer.from(partialSig.pubkey as Uint8Array).toString('hex');
          const sigHex = Buffer.from(partialSig.signature as Uint8Array).toString('hex');
          
          return [idx, { pubkey: pubkeyHex, signature: sigHex }];
        });
        
        signature = JSON.stringify(sigData);
      } else if (payload.type === 'evm') {
        const evmPayload = payload as EvmSignPayload;
        const result = await this.withTimeout(
          this.ethAdapter.signTransaction(
            this.transport!,
            ledgerAccount.derivationPath,
            evmPayload.typedData
          ),
          SIGN_TIMEOUT,
          WalletErrorCode.OPERATION_TIMEOUT
        );
        signature = result.signature;
      } else {
        throw new WalletError(
          WalletErrorCode.CHAIN_NOT_SUPPORTED,
          `Payload type ${(payload as any).type} is not supported by Ledger provider`
        );
      }

      this.updateState('CONNECTED');

      return {
        signature,
        signerAddress: account.address,
        signedAt: new Date(),
      };
    } catch (err) {
      this.updateState('CONNECTED');
      throw this.wrapError(err, WalletErrorCode.SIGNING_FAILED);
    }
  }

  // ─── Wallet Policy Registration (BTC Multisig) ───────────

  /**
   * Register a wallet policy on Ledger device.
   * Required for BTC multisig signing.
   * 
   * @param policy - Wallet policy containing descriptor template and keys
   * @returns Object containing policy id and HMAC
   */
  async registerWalletPolicy(policy: {
    name: string;
    descriptorTemplate: string;
    keys: string[];
  }): Promise<{ id: Buffer; hmac: Buffer }> {
    this.ensureConnected();
    this.ensureTransport();

    if (this._currentChain !== 'BITCOIN') {
      throw new WalletError(
        WalletErrorCode.CHAIN_NOT_SUPPORTED,
        'Wallet policy registration is only supported for Bitcoin'
      );
    }

    try {
      const result = await this.withTimeout(
        this.btcAdapter.registerWallet(this.transport!, policy),
        SIGN_TIMEOUT,
        WalletErrorCode.OPERATION_TIMEOUT
      );

      return result;
    } catch (err) {
      throw this.wrapError(err, WalletErrorCode.SIGNING_FAILED);
    }
  }

  // ─── Device Address Verification ─────────────────────────

  /**
   * Display the connected account's address on the Ledger device
   * so the user can visually confirm it matches what the UI shows.
   *
   * Must be called after connect(). Does NOT update account state.
   * If the transport has been lost, attempts a silent reconnect first.
   *
   * @throws USER_REJECTED if the user rejects on device
   * @throws DEVICE_DISCONNECTED if reconnect fails
   */
  async verifyAddressOnDevice(): Promise<void> {
    this.ensureConnected();

    const account = this._account as LedgerAccount;

    // Attempt reconnect if transport was lost (e.g. device sleep)
    if (!this.transport) {
      const reconnected = await this.reconnectTransport(CONNECT_TIMEOUT);
      if (!reconnected) {
        throw new WalletError(
          WalletErrorCode.DEVICE_DISCONNECTED,
          'Ledger device disconnected. Please reconnect.',
        );
      }
      // Re-open the correct app after reconnect
      await this.ensureCorrectApp(account.chain, true, this._currentNetwork);
    }

    // Call lightweight display-only methods on adapters.
    // These avoid the full getAddress() overhead (xpub fetch, policy rebuild, etc.).
    if (account.chain === 'BITCOIN') {
      // Extract account-level path (all hardened segments) from full path
      // BIP 84: m/84'/0'/0'/0/0 → m/84'/0'/0'
      // BIP 48: m/48'/0'/0'/2'/0/0 → m/48'/0'/0'/2'
      const parts = account.derivationPath.split('/');
      const hardenedCount = parts.filter(p => p.endsWith("'")).length;
      const accountPath = parts.slice(0, 1 + hardenedCount).join('/');
      const remaining = parts.slice(1 + hardenedCount);
      const change = Number(remaining[0] ?? 0);
      const addressIndex = Number(remaining[1] ?? 0);
      await this.btcAdapter.displayAddress(
        this.transport!,
        accountPath,
        account.xpub!,
        account.masterFingerprint!,
        change,
        addressIndex,
      );
    } else if (account.chain === 'ETHEREUM') {
      await this.ethAdapter.displayAddress(
        this.transport!,
        account.derivationPath,
      );
    }
  }

  // ─── Transport Management ────────────────────────────────

  private async openTransport(timeout: number): Promise<void> {
    if (this.transport) {
      return;
    }

    try {
      // Dynamic import to avoid bundling issues
      const TransportWebHID = await this.getTransportModule();

      // Increment version for this new transport
      const version = ++this._transportVersion;

      this.transport = (await this.withTimeout(
        TransportWebHID.create(),
        timeout,
        WalletErrorCode.CONNECTION_TIMEOUT
      )) as unknown as LedgerTransport;

      // Setup disconnect handler with version check
      this.transport.on('disconnect', () => {
        this.handleDeviceDisconnect(version);
      });
    } catch (err) {
      throw this.wrapError(err, WalletErrorCode.DEVICE_NOT_FOUND);
    }
  }

  /**
   * Reconnect to an already-authorized device without user interaction.
   * Uses TransportWebHID.openConnected() to connect to previously authorized devices.
   */
  private async reconnectTransport(timeout: number = 5000): Promise<boolean> {
    await this.closeTransport();

    try {
      // Dynamic import
      const { default: TransportWebHID } = await import(
        '@ledgerhq/hw-transport-webhid'
      );

      // First check if any authorized devices are available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hid = (navigator as any).hid;
      if (!hid) {
        return false;
      }

      const devices = await hid.getDevices();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ledgerDevices = devices.filter((d: any) => d.vendorId === 0x2c97);

      if (ledgerDevices.length === 0) {
        return false;
      }

      // Try to open an already-connected device (no user prompt)
      // openConnected() returns null if no device is available
      const transport = await this.withTimeout(
        TransportWebHID.openConnected(),
        timeout,
        WalletErrorCode.CONNECTION_TIMEOUT
      );

      if (!transport) {
        return false;
      }

      // Increment version for this new transport
      const version = ++this._transportVersion;

      this.transport = transport as unknown as LedgerTransport;

      // Setup disconnect handler with version check
      this.transport.on('disconnect', () => {
        this.handleDeviceDisconnect(version);
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for device to reconnect after app switch.
   * Polls until device is available or timeout.
   */
  private async waitForDeviceReconnect(
    maxWaitMs: number = 10000,
    pollIntervalMs: number = 500
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      // Wait a bit before checking
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Try to reconnect
      if (await this.reconnectTransport(2000)) {
        return true;
      }
    }

    return false;
  }

  private async closeTransport(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore close errors
      }
      this.transport = null;
    }

    // Clear adapter caches
    this.btcAdapter.clearApp();
    this.ethAdapter.clearApp();
  }

  private async getTransportModule(): Promise<{ create(): Promise<unknown> }> {
    const transportType = this.config.transportType ?? 'webhid';

    if (transportType === 'webhid') {
      const { default: TransportWebHID } = await import(
        '@ledgerhq/hw-transport-webhid'
      );
      return TransportWebHID;
    }

    throw new WalletError(
      WalletErrorCode.BROWSER_NOT_SUPPORTED,
      `Transport type ${transportType} is not supported`
    );
  }

  // ─── Account Retrieval ───────────────────────────────────

  private async getAccountForChain(
    chain: ChainType,
    derivationPath?: string,
    options?: LedgerConnectOptions
  ): Promise<LedgerAccount> {
    const path = derivationPath ?? this.getDefaultPath(chain);
    const addressIndex = options?.addressIndex ?? 0;
    const change = options?.change ?? 0;

    if (chain === 'BITCOIN') {
      const result = await this.btcAdapter.getAddress(
        this.transport!,
        path,
        options?.showOnDevice ?? true,
        { change, addressIndex }
      );
      return {
        address: result.address,
        chain: 'BITCOIN',
        walletType: 'LEDGER',
        derivationPath: result.derivationPath,
        publicKey: result.publicKey,
        xpub: result.xpub,
        masterFingerprint: result.masterFingerprint,
      };
    }

    if (chain === 'ETHEREUM') {
      const result = await this.ethAdapter.getAddress(
        this.transport!,
        path,
        options?.showOnDevice ?? true,
        { addressIndex }
      );
      return {
        address: result.address,
        chain: 'ETHEREUM',
        walletType: 'LEDGER',
        derivationPath: result.derivationPath,
        publicKey: result.publicKey,
        xpub: result.xpub,
      };
    }

    throw new WalletError(
      WalletErrorCode.CHAIN_NOT_SUPPORTED,
      `Chain ${chain} is not supported by Ledger provider`
    );
  }

  private getDefaultPath(chain: ChainType): string {
    switch (chain) {
      case 'BITCOIN':
        return "m/48'/0'/0'/2'"; // BIP 48 P2WSH multisig
      case 'ETHEREUM':
        return "m/44'/60'/0'/0/0"; // Standard ETH path
      default:
        throw new WalletError(
          WalletErrorCode.CHAIN_NOT_SUPPORTED,
          `No default path for chain ${chain}`
        );
    }
  }

  // ─── Event Handling ──────────────────────────────────────

  private handleDeviceDisconnect(version: number): void {
    // Ignore disconnect events from old transports
    // This can happen when we've already reconnected with a new transport
    if (version !== this._transportVersion) {
      return;
    }

    this.transport = null;
    this.btcAdapter.clearApp();
    this.ethAdapter.clearApp();

    // During app switching, don't update state or emit disconnect
    // The ensureCorrectApp flow will handle reconnection
    if (this._isSwitchingApp) {
      return;
    }

    this.updateAccount(null);
    this.updateState('IDLE');
    this.emit('disconnect', { reason: 'device' });
  }

  // ─── Helpers ─────────────────────────────────────────────

  private isWebHIDSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'hid' in navigator &&
      typeof (navigator as { hid: { requestDevice: unknown } }).hid
        .requestDevice === 'function'
    );
  }

  private ensureTransport(): void {
    if (!this.transport) {
      throw new WalletError(
        WalletErrorCode.DEVICE_NOT_FOUND,
        'Ledger device not connected'
      );
    }
  }

  protected wrapError(err: unknown, defaultCode: WalletErrorCode): WalletError {
    if (err instanceof WalletError) {
      return err;
    }

    // Handle Ledger status codes
    const ledgerError = err as { statusCode?: number; message?: string };
    if (ledgerError.statusCode) {
      const code =
        LEDGER_STATUS_CODES[
          ledgerError.statusCode as keyof typeof LEDGER_STATUS_CODES
        ] ?? defaultCode;
      return new WalletError(
        code,
        ledgerError.message ?? `Ledger error: 0x${ledgerError.statusCode.toString(16)}`
      );
    }

    // Handle disconnect errors
    const message = ledgerError.message ?? String(err);
    if (
      message.includes('disconnected') ||
      message.includes('device was disconnected')
    ) {
      return new WalletError(
        WalletErrorCode.DEVICE_DISCONNECTED,
        'Ledger device was disconnected'
      );
    }

    return new WalletError(defaultCode, message);
  }

  // ─── Public Helpers ──────────────────────────────────────

  /**
   * Get the required app name for a chain
   */
  getRequiredApp(chain: ChainType): string {
    return REQUIRED_APPS[chain];
  }

  /**
   * Check if the correct app is open on the device
   */
  async checkApp(chain: ChainType): Promise<{ isCorrect: boolean; currentApp?: string }> {
    const requiredApp = REQUIRED_APPS[chain];
    return this.checkAppByName(requiredApp);
  }

  /**
   * Check if a specific app is open on the device by name
   */
  async checkAppByName(requiredApp: string): Promise<{ isCorrect: boolean; currentApp?: string; isUnknown?: boolean }> {
    this.ensureTransport();

    try {
      // Get app info using APDU command
      const response = await this.transport!.send(0xb0, 0x01, 0x00, 0x00);

      // Parse response: format varies but generally contains app name
      const appNameLength = response[1];
      const appName = response.subarray(2, 2 + appNameLength).toString('utf8');

      // For BTC apps, do exact matching since "Bitcoin" and "Bitcoin Test" are different
      const isCorrect = appName.toLowerCase() === requiredApp.toLowerCase();

      return { isCorrect, currentApp: appName, isUnknown: false };
    } catch {
      return { isCorrect: false, isUnknown: true };
    }
  }

  /**
   * Request to open a specific app on the Ledger device.
   * This will show a prompt on the device asking user to confirm opening the app.
   * 
   * @param appName - The name of the app to open (e.g., "Ethereum", "Bitcoin")
   * @returns Promise that resolves when app is opened or rejects if user cancels
   */
  async openApp(appName: string): Promise<void> {
    this.ensureTransport();

    try {
      // APDU command to open app: CLA=0xE0, INS=0xD8, P1=0x00, P2=0x00
      // Data: app name as ASCII string
      const appNameBuffer = Buffer.from(appName, 'ascii');
      await this.transport!.send(0xe0, 0xd8, 0x00, 0x00, appNameBuffer);
    } catch (err) {
      const ledgerError = err as { statusCode?: number; message?: string };
      
      // 0x6984 = app not found
      if (ledgerError.statusCode === 0x6984) {
        throw new WalletError(
          WalletErrorCode.LEDGER_APP_NOT_OPEN,
          `App "${appName}" is not installed on the device`
        );
      }
      // 0x6985 = user cancelled
      if (ledgerError.statusCode === 0x6985) {
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          `User cancelled opening "${appName}" app`
        );
      }
      // 0x6d00 = INS not supported - we're inside an app, need to quit first
      if (ledgerError.statusCode === 0x6d00) {
        throw new WalletError(
          WalletErrorCode.LEDGER_APP_NOT_OPEN,
          `Cannot open app while another app is running. Please return to the dashboard first.`
        );
      }
      
      throw this.wrapError(err, WalletErrorCode.LEDGER_APP_NOT_OPEN);
    }
  }

  /**
   * Quit the current app and return to BOLOS dashboard.
   * This is required before opening a different app.
   * Note: This will cause the device to disconnect.
   */
  async quitApp(): Promise<void> {
    this.ensureTransport();

    try {
      // APDU command to quit app: CLA=0xB0, INS=0xA7, P1=0x00, P2=0x00
      await this.transport!.send(0xb0, 0xa7, 0x00, 0x00);
      // Give the device a moment to process
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      // Ignore errors - quitting may cause disconnect which is expected
      const ledgerError = err as { statusCode?: number };
      // 0x6d00 means we're already at dashboard
      if (ledgerError.statusCode !== 0x6d00) {
        // For other errors, just log and continue
      }
    }
  }

  /**
   * Ensure the correct app is open for the given chain.
   * 
   * This method handles the full app switching flow automatically:
   * 1. Check current app state
   * 2. If correct app is open → return success
   * 3. If inside wrong app → quitApp() → wait for reconnect → openApp() → wait for reconnect
   * 4. If at Dashboard (BOLOS) → openApp() → wait for reconnect
   * 
   * All reconnects are handled internally - user only needs to confirm on device.
   * 
   * @param chain - The chain type to check app for
   * @param autoOpen - If true, will automatically handle app switching
   * @param network - Network type for BTC ('mainnet' or 'testnet')
   * @returns Promise that resolves when correct app is open
   */
  async ensureCorrectApp(
    chain: ChainType, 
    autoOpen: boolean = true,
    network?: 'mainnet' | 'testnet'
  ): Promise<void> {
    const requiredApp = getRequiredApp(chain, network);
    let { isCorrect, currentApp, isUnknown } = await this.checkAppByName(requiredApp);

    // If app state is unknown, try a quick reconnect and re-check before proceeding
    if (isUnknown) {
      await this.reconnectTransport(2000);
      const retry = await this.checkAppByName(requiredApp);
      isCorrect = retry.isCorrect;
      currentApp = retry.currentApp;
      isUnknown = retry.isUnknown;
    }

    // Case 1: Correct app is already open
    if (isCorrect) {
      return;
    }

    // If still unknown, avoid automatic switching to reduce device instability
    if (isUnknown) {
      throw new WalletError(
        WalletErrorCode.LEDGER_APP_NOT_OPEN,
        `无法识别当前 Ledger App，请在设备上返回 Dashboard 并打开 ${requiredApp}`
      );
    }

    // Determine device state
    const isAtDashboard = !currentApp || currentApp === 'BOLOS' || currentApp === '';

    if (!autoOpen) {
      throw new WalletError(
        WalletErrorCode.LEDGER_APP_NOT_OPEN,
        `Please open the "${requiredApp}" app on your Ledger device. Currently open: ${currentApp || 'Dashboard'}`
      );
    }

    // Case 2: Inside wrong app → quit first, wait for reconnect, then open new app
    if (!isAtDashboard) {
      this._isSwitchingApp = true;

      this.emit('appChange', {
        requiredApp,
        currentApp,
        action: 'quitting',
      });

      try {
        await this.quitApp();
      } catch {
        // Expected - device disconnects when quitting app
      }

      // Wait for device to reconnect after quitting app
      const reconnectedAfterQuit = await this.waitForDeviceReconnect(8000, 300);
      if (!reconnectedAfterQuit) {
        this._isSwitchingApp = false;
        throw new WalletError(
          WalletErrorCode.DEVICE_DISCONNECTED,
          `退出 ${currentApp} App 后设备未重新连接，请手动重试`
        );
      }

      // Now we should be at Dashboard, fall through to open the app
    } else {
      // Starting from dashboard, also set switching flag
      this._isSwitchingApp = true;
    }

    // Case 3: At Dashboard (either originally or after quitting) → request to open the correct app
    this.emit('appChange', {
      requiredApp,
      currentApp: 'BOLOS',
      action: 'opening',
    });

    try {
      await this.openApp(requiredApp);
    } catch (err) {
      // User rejected or app not installed
      if (err instanceof WalletError) {
        this._isSwitchingApp = false;
        throw err;
      }
      // Other errors - might be disconnect during open
    }

    // Wait for device to reconnect after user confirms opening app
    // This takes longer as user needs to confirm on device
    const reconnectedAfterOpen = await this.waitForDeviceReconnect(30000, 500);
    if (!reconnectedAfterOpen) {
      this._isSwitchingApp = false;
      throw new WalletError(
        WalletErrorCode.DEVICE_DISCONNECTED,
        `打开 ${requiredApp} App 后设备未重新连接，请确认已在设备上打开 App`
      );
    }

    // Verify the correct app is now open (use requiredApp to ensure consistent comparison)
    const { isCorrect: nowCorrect, currentApp: nowApp } = await this.checkAppByName(requiredApp);
    
    // Done switching, clear the flag
    this._isSwitchingApp = false;

    if (!nowCorrect) {
      throw new WalletError(
        WalletErrorCode.LEDGER_APP_NOT_OPEN,
        `App 切换失败，当前打开的是 ${nowApp || 'Dashboard'}，需要 ${requiredApp}`
      );
    }

    // Success - correct app is now open
    this.emit('appChange', {
      requiredApp,
      currentApp: requiredApp,
      action: 'opened',
    });
  }
}

export type { LedgerAccount, LedgerTransport, TransportType };
