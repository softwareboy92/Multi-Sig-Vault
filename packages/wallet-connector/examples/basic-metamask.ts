/**
 * Basic MetaMask integration example
 * 
 * This example demonstrates:
 * - Connecting to MetaMask
 * - Signing messages
 * - Signing EIP-712 typed data (Gnosis Safe)
 * - Listening to events
 */

import {
  MetaMaskProvider,
  WalletError,
  WalletErrorCode,
} from '@multivault/wallet-connector';
import type { EvmSignPayload, EIP712TypedData } from '@multivault/wallet-connector';

// Create provider instance
const provider = new MetaMaskProvider();

// Initialize and connect
async function connect(): Promise<void> {
  try {
    // Initialize provider
    await provider.init();
    console.log('MetaMask provider initialized');

    // Check if already connected (isConnected is a method)
    if (provider.isConnected()) {
      console.log('Already connected:', provider.account?.address);
      return;
    }

    // Connect to Ethereum mainnet
    const account = await provider.connect({
      chain: 'ETHEREUM',
      evmChainId: 1,
    });

    console.log('Connected successfully!');
    console.log('Address:', account.address);
    console.log('Chain:', account.chain);
  } catch (error) {
    handleError(error);
  }
}

// Sign a plain message
async function signMessage(message: string): Promise<string | null> {
  const account = provider.account;
  if (!account) {
    console.error('Not connected. Call connect() first.');
    return null;
  }

  try {
    const result = await provider.signMessage(message, account);
    console.log('Message signed successfully!');
    console.log('Signature:', result.signature);
    console.log('Signed at:', result.signedAt.toISOString());
    return result.signature;
  } catch (error) {
    handleError(error);
    return null;
  }
}

// Sign a Gnosis Safe transaction (EIP-712)
async function signSafeTransaction(
  safeAddress: string,
  safeTxHash: string,
  chainId: number
): Promise<string | null> {
  const account = provider.account;
  if (!account) {
    console.error('Not connected. Call connect() first.');
    return null;
  }

  // Construct EIP-712 typed data for Gnosis Safe
  // Note: Gnosis Safe uses its own domain structure with chainId + verifyingContract
  // For this example, we use the standard EIP712Domain structure required by the SDK
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
    const result = await provider.signTransaction(payload, account);
    console.log('Safe transaction signed!');
    console.log('Signature:', result.signature);
    return result.signature;
  } catch (error) {
    handleError(error);
    return null;
  }
}

// Setup event listeners
function setupEventListeners(): void {
  provider.on('accountChange', ({ previousAccount, currentAccount }) => {
    console.log('[Event] Account changed');
    console.log('  From:', previousAccount?.address || 'none');
    console.log('  To:', currentAccount?.address || 'none');
  });

  provider.on('chainChange', ({ previousChainId, currentChainId }) => {
    console.log('[Event] Chain changed');
    console.log('  From:', previousChainId);
    console.log('  To:', currentChainId);
  });

  provider.on('disconnect', ({ reason }) => {
    console.log('[Event] Disconnected:', reason);
  });

  provider.on('error', ({ error }) => {
    console.error('[Event] Error:', error.message);
  });
}

// Disconnect wallet
async function disconnect(): Promise<void> {
  await provider.disconnect();
  console.log('Disconnected from MetaMask');
}

// Error handler
function handleError(error: unknown): void {
  if (error instanceof WalletError) {
    console.error('Wallet error:', error.code, error.message);

    switch (error.code) {
      case WalletErrorCode.USER_REJECTED:
        console.log('User cancelled the operation');
        break;
      case WalletErrorCode.WALLET_NOT_FOUND:
        console.log('MetaMask is not installed');
        break;
      case WalletErrorCode.DEVICE_LOCKED:
        console.log('Wallet is locked. Please unlock it.');
        break;
      default:
        if (error.isRetryable) {
          console.log('This error is retryable');
        }
    }
  } else {
    console.error('Unexpected error:', error);
  }
}

// Main execution
async function main(): Promise<void> {
  console.log('=== MetaMask Integration Example ===\n');

  // Setup event listeners first
  setupEventListeners();

  // Connect
  await connect();

  if (provider.isConnected()) {
    // Sign a test message
    await signMessage('Hello, MultiVault!');

    // Example Safe transaction signing
    // await signSafeTransaction(
    //   '0xYourSafeAddress...',
    //   '0xSafeTxHash...',
    //   1
    // );
  }

  // Cleanup (uncomment to disconnect)
  // await disconnect();
}

// Run if executed directly
main().catch(console.error);
