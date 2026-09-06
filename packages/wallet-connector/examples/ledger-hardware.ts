/**
 * Ledger Hardware Wallet Integration Example
 * 
 * This example demonstrates:
 * - Connecting to Ledger via WebHID
 * - Auto app switching between chains
 * - Signing Bitcoin PSBT (multisig)
 * - Signing Ethereum EIP-712 (Gnosis Safe)
 * - Handling device events
 */

import { LedgerProvider, WalletError, WalletErrorCode } from '@multivault/wallet-connector';
import type {
  BtcSignPayload,
  EvmSignPayload,
  EIP712TypedData,
  WalletPolicy,
  LedgerConnectOptions,
} from '@multivault/wallet-connector';

// Create Ledger provider
const ledger = new LedgerProvider({
  transportType: 'webhid',
  autoReconnect: true,
});

// ─── Event Listeners ───────────────────────────────────────────────────────

// Setup event listeners before connecting
function setupEventListeners(): void {
  // App switching events (Ledger-specific)
  ledger.on('appChange', ({ requiredApp, currentApp, action }) => {
    switch (action) {
      case 'quitting':
        console.log(`⏳ Exiting ${currentApp}...`);
        break;
      case 'opening':
        console.log(`👆 Please confirm opening ${requiredApp} on your Ledger`);
        break;
      case 'opened':
        console.log(`✅ ${requiredApp} is now open`);
        break;
      case 'failed':
        console.error('❌ App switch failed');
        break;
    }
  });

  // State changes
  ledger.on('stateChange', ({ previousState, currentState }) => {
    console.log(`State: ${previousState} → ${currentState}`);
  });

  // Disconnect events
  ledger.on('disconnect', ({ reason }) => {
    console.log(`Disconnected: ${reason}`);
  });
}

// ─── Connection ────────────────────────────────────────────────────────────

async function connectLedgerBtc(addressIndex: number = 0): Promise<void> {
  try {
    setupEventListeners();
    await ledger.init();
    console.log('Ledger provider initialized');

    // Connect for Bitcoin - will auto-switch app if needed
    const options: LedgerConnectOptions = {
      chain: 'BITCOIN',
      derivationPath: "m/84'/0'/0'", // Native SegWit
      addressIndex,  // Signer index for multisig
      change: 0,     // 0 = receive addresses, 1 = change addresses
      timeout: 60000,
    };

    const account = await ledger.connect(options);

    console.log('Ledger connected for Bitcoin!');
    console.log('Address:', account.address);
    console.log('Public Key:', account.publicKey);
    console.log('XPub:', account.xpub);
    console.log('Master Fingerprint:', account.masterFingerprint);
    console.log('Full Path:', account.derivationPath);
  } catch (error) {
    handleLedgerError(error);
  }
}

async function connectLedgerEth(addressIndex: number = 0): Promise<void> {
  try {
    setupEventListeners();
    await ledger.init();

    // Connect for Ethereum - will auto-switch app if needed
    const options: LedgerConnectOptions = {
      chain: 'ETHEREUM',
      derivationPath: "m/44'/60'/0'/0",
      addressIndex,
      timeout: 60000,
    };

    const account = await ledger.connect(options);

    console.log('Ledger connected for Ethereum!');
    console.log('Address:', account.address);
    console.log('Public Key:', account.publicKey);
    console.log('XPub:', account.xpub);
    console.log('Full Path:', account.derivationPath);
  } catch (error) {
    handleLedgerError(error);
  }
}

// ─── Bitcoin Signing ───────────────────────────────────────────────────────

/**
 * Sign a multisig PSBT with Ledger
 * 
 * For multisig, you need to first register the wallet policy on the device
 * and store the returned HMAC for future signing operations.
 */
async function signBitcoinMultisig(
  psbtBase64: string,
  walletPolicy: WalletPolicy,
  walletHmac: string
): Promise<string | null> {
  const account = ledger.account;
  if (!account) {
    console.error('Not connected. Call connectLedgerBtc() first.');
    return null;
  }

  const payload: BtcSignPayload = {
    type: 'btc',
    psbt: psbtBase64,
    txType: 'native-segwit',
    isMultisig: true,
    walletPolicy,
    walletHmac,
  };

  try {
    console.log('Please confirm the transaction on your Ledger device...');
    const result = await ledger.signTransaction(payload, account);

    console.log('Bitcoin transaction signed!');
    console.log('Signature:', result.signature);
    console.log('Signed at:', result.signedAt.toISOString());

    return result.signature;
  } catch (error) {
    handleLedgerError(error);
    return null;
  }
}

/**
 * Sign a simple Bitcoin transaction (non-multisig)
 */
async function signBitcoinSimple(psbtBase64: string): Promise<string | null> {
  const account = ledger.account;
  if (!account) {
    console.error('Not connected');
    return null;
  }

  const payload: BtcSignPayload = {
    type: 'btc',
    psbt: psbtBase64,
    txType: 'native-segwit',
    isMultisig: false,
  };

  try {
    const result = await ledger.signTransaction(payload, account);
    console.log('Signed PSBT:', result.signature);
    return result.signature;
  } catch (error) {
    handleLedgerError(error);
    return null;
  }
}

// ─── Ethereum Signing ──────────────────────────────────────────────────────

/**
 * Sign a Gnosis Safe transaction using EIP-712
 */
async function signSafeTransaction(
  safeAddress: string,
  safeTxHash: string,
  chainId: number
): Promise<string | null> {
  const account = ledger.account;
  if (!account) {
    console.error('Not connected. Call connectLedgerEth() first.');
    return null;
  }

  // Build EIP-712 typed data for Gnosis Safe
  const typedData: EIP712TypedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    domain: {
      name: 'GnosisSafe',
      version: '1.3.0',
      chainId,
      verifyingContract: safeAddress,
    },
    message: {
      // These values would come from the actual Safe transaction
      to: '0x0000000000000000000000000000000000000000',
      value: '0',
      data: '0x',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: 0,
    },
  };

  const payload: EvmSignPayload = {
    type: 'evm',
    safeTxHash,
    typedData,
  };

  try {
    console.log('Please review and confirm on your Ledger device...');
    const result = await ledger.signTransaction(payload, account);

    console.log('Safe transaction signed!');
    console.log('Signature:', result.signature);

    return result.signature;
  } catch (error) {
    handleLedgerError(error);
    return null;
  }
}

/**
 * Sign a simple message with Ledger (personal_sign)
 */
async function signMessage(message: string): Promise<string | null> {
  const account = ledger.account;
  if (!account) {
    console.error('Not connected');
    return null;
  }

  try {
    console.log('Please approve message signing on your Ledger...');
    const result = await ledger.signMessage(message, account);

    console.log('Message signed!');
    console.log('Signature:', result.signature);

    return result.signature;
  } catch (error) {
    handleLedgerError(error);
    return null;
  }
}

// ─── Events ────────────────────────────────────────────────────────────────

function setupLedgerEvents(): void {
  ledger.on('disconnect', ({ reason }) => {
    console.log('[Ledger] Disconnected:', reason);
    // Prompt user to reconnect
  });

  ledger.on('stateChange', ({ previousState, currentState, reason }) => {
    console.log('[Ledger] State:', previousState, '→', currentState, reason || '');
  });

  ledger.on('error', ({ error }) => {
    console.error('[Ledger] Error event:', error.message);
  });
}

// ─── Error Handling ────────────────────────────────────────────────────────

function handleLedgerError(error: unknown): void {
  if (!(error instanceof WalletError)) {
    console.error('Unexpected error:', error);
    return;
  }

  console.error('Ledger error:', error.code, error.message);

  switch (error.code) {
    // Device not found or not connected
    case WalletErrorCode.DEVICE_NOT_FOUND:
      console.log('No Ledger device found. Please connect your device.');
      break;

    case WalletErrorCode.DEVICE_DISCONNECTED:
      console.log('Ledger was disconnected. Please reconnect and try again.');
      break;

    // Wrong app or no app
    case WalletErrorCode.WRONG_APP:
    case WalletErrorCode.LEDGER_APP_NOT_OPEN:
      console.log('Please open the correct app on your Ledger device.');
      break;

    // Device locked
    case WalletErrorCode.DEVICE_LOCKED:
      console.log('Ledger is locked. Please unlock it with your PIN.');
      break;

    // User rejected
    case WalletErrorCode.USER_REJECTED:
      console.log('Transaction was rejected on the device.');
      break;

    // Connection issues
    case WalletErrorCode.CONNECTION_TIMEOUT:
      console.log('Connection timed out. Please try again.');
      break;

    case WalletErrorCode.DEVICE_BUSY:
      console.log('Device is busy. Please wait and try again.');
      break;

    // Browser support
    case WalletErrorCode.BROWSER_NOT_SUPPORTED:
      console.log('WebHID is not supported in this browser. Use Chrome/Edge.');
      break;

    // Multisig wallet policy not registered
    case WalletErrorCode.WALLET_POLICY_NOT_REGISTERED:
      console.log('Wallet policy not registered. Please register it first.');
      break;

    default:
      if (error.isRetryable) {
        console.log('Error is retryable. Please try again.');
      }
  }
}

// ─── Disconnect ────────────────────────────────────────────────────────────

async function disconnect(): Promise<void> {
  await ledger.disconnect();
  console.log('Ledger disconnected');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Ledger Integration Example ===\n');

  // Setup event listeners
  setupLedgerEvents();

  // Example: Connect for Bitcoin
  await connectLedgerBtc();

  if (ledger.isConnected()) {
    // Example wallet policy (2-of-3 multisig)
    const walletPolicy: WalletPolicy = {
      name: 'MultiVault 2-of-3',
      descriptorTemplate: 'wsh(sortedmulti(2,@0/**,@1/**,@2/**))',
      keys: [
        "[abcd1234/48'/0'/0'/2']xpub661MyMwAqRbcF...",
        "[efgh5678/48'/0'/0'/2']xpub661MyMwAqRbcG...",
        "[ijkl9012/48'/0'/0'/2']xpub661MyMwAqRbcH...",
      ],
    };

    // Sign a multisig transaction
    // await signBitcoinMultisig(
    //   'cHNidP8BAH...base64_psbt...',
    //   walletPolicy,
    //   'previously_registered_hmac_hex'
    // );
  }

  // Cleanup
  // await disconnect();
}

main().catch(console.error);

// Export for use as module
export {
  connectLedgerBtc,
  connectLedgerEth,
  signBitcoinMultisig,
  signBitcoinSimple,
  signSafeTransaction,
  signMessage,
  disconnect,
};
