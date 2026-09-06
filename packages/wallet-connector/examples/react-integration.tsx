/**
 * React Integration Example
 * 
 * This example demonstrates:
 * - WalletContextProvider setup
 * - useWallet hook for connection state
 * - useSignature hook for signing
 * - useWalletEvent hook for event handling
 * - useChainSwitch hook for chain switching
 */

import React, { useState, useCallback } from 'react';
import {
  WalletContextProvider,
  useWallet,
  useSignature,
  useWalletEvent,
  useChainSwitch,
} from '@multivault/wallet-connector/react';
import { MetaMaskProvider, WalletError, WalletErrorCode } from '@multivault/wallet-connector';

// ─── Provider Setup ────────────────────────────────────────────────────────

// Create provider instance (singleton)
const metamaskProvider = new MetaMaskProvider();

/**
 * Root App with WalletContextProvider
 */
export function App(): React.ReactElement {
  return (
    <WalletContextProvider provider={metamaskProvider}>
      <div className="app">
        <h1>MultiVault</h1>
        <WalletStatus />
        <ConnectButton />
        <SignMessageForm />
        <ChainSwitcher />
        <EventLogger />
      </div>
    </WalletContextProvider>
  );
}

// ─── Wallet Status ─────────────────────────────────────────────────────────

function WalletStatus(): React.ReactElement {
  const { account, state, isConnected } = useWallet();

  return (
    <div className="wallet-status">
      <h2>Wallet Status</h2>
      <p>State: <code>{state}</code></p>
      <p>Connected: {isConnected ? '✅ Yes' : '❌ No'}</p>
      {account && (
        <div>
          <p>Address: <code>{account.address}</code></p>
          <p>Chain: <code>{account.chain}</code></p>
        </div>
      )}
    </div>
  );
}

// ─── Connect Button ────────────────────────────────────────────────────────

function ConnectButton(): React.ReactElement {
  const { isConnected, isConnecting, connect, disconnect, error } = useWallet();

  const handleConnect = useCallback(async () => {
    try {
      await connect({
        chain: 'ETHEREUM',
        evmChainId: 1, // Mainnet
      });
    } catch (err) {
      // Error is already captured in the hook
      console.error('Connection failed:', err);
    }
  }, [connect]);

  if (isConnecting) {
    return (
      <button disabled className="btn btn-loading">
        Connecting...
      </button>
    );
  }

  if (isConnected) {
    return (
      <button onClick={disconnect} className="btn btn-disconnect">
        Disconnect
      </button>
    );
  }

  return (
    <div>
      <button onClick={handleConnect} className="btn btn-connect">
        Connect MetaMask
      </button>
      {error && <ErrorDisplay error={error} />}
    </div>
  );
}

// ─── Sign Message Form ─────────────────────────────────────────────────────

function SignMessageForm(): React.ReactElement {
  const { isConnected } = useWallet();
  const { signature, isLoading, error, signMessage, reset } = useSignature();
  const [message, setMessage] = useState('Hello, MultiVault!');

  const handleSign = useCallback(async () => {
    if (!message.trim()) {
      alert('Please enter a message to sign');
      return;
    }
    await signMessage(message);
  }, [message, signMessage]);

  if (!isConnected) {
    return (
      <div className="sign-form disabled">
        <h2>Sign Message</h2>
        <p className="muted">Connect your wallet first</p>
      </div>
    );
  }

  return (
    <div className="sign-form">
      <h2>Sign Message</h2>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Enter message to sign"
        rows={4}
        disabled={isLoading}
      />

      <div className="actions">
        <button
          onClick={handleSign}
          disabled={isLoading || !message.trim()}
          className="btn btn-primary"
        >
          {isLoading ? 'Signing...' : 'Sign Message'}
        </button>

        {signature && (
          <button onClick={reset} className="btn btn-secondary">
            Clear
          </button>
        )}
      </div>

      {error && <ErrorDisplay error={error} onRetry={handleSign} />}

      {signature && (
        <div className="signature-result">
          <h4>Signature:</h4>
          <code className="signature">{signature}</code>
        </div>
      )}
    </div>
  );
}

// ─── Chain Switcher ────────────────────────────────────────────────────────

// For this example, we show supported chains
// Note: useChainSwitch works with ChainType, not EVM chainId
const CHAINS = [
  { type: 'ETHEREUM' as const, name: 'Ethereum' },
  { type: 'BITCOIN' as const, name: 'Bitcoin' },
  { type: 'TRON' as const, name: 'Tron' },
];

function ChainSwitcher(): React.ReactElement {
  const { isConnected } = useWallet();
  const { currentChain, isLoading, error, switchChain } = useChainSwitch();

  if (!isConnected) {
    return <></>;
  }

  return (
    <div className="chain-switcher">
      <h2>Switch Chain</h2>
      <p>Current Chain: <code>{currentChain ?? 'Unknown'}</code></p>

      <div className="chain-buttons">
        {CHAINS.map((chain) => (
          <button
            key={chain.type}
            onClick={() => switchChain(chain.type)}
            disabled={isLoading || currentChain === chain.type}
            className={`btn ${currentChain === chain.type ? 'btn-active' : ''}`}
          >
            {chain.name}
          </button>
        ))}
      </div>

      {isLoading && <p className="loading">Switching chain...</p>}
      {error && <ErrorDisplay error={error} />}
    </div>
  );
}

// ─── Event Logger ──────────────────────────────────────────────────────────

function EventLogger(): React.ReactElement {
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  // Listen to all wallet events
  useWalletEvent({
    event: 'accountChange',
    handler: ({ previousAccount, currentAccount }) => {
      addLog(
        `Account changed: ${previousAccount?.address?.slice(0, 8) || 'none'} → ${
          currentAccount?.address?.slice(0, 8) || 'none'
        }`
      );
    },
  });

  useWalletEvent({
    event: 'chainChange',
    handler: ({ previousChainId, currentChainId }) => {
      addLog(`Chain changed: ${previousChainId} → ${currentChainId}`);
    },
  });

  useWalletEvent({
    event: 'disconnect',
    handler: ({ reason }) => {
      addLog(`Disconnected: ${reason}`);
    },
  });

  useWalletEvent({
    event: 'stateChange',
    handler: ({ previousState, currentState }) => {
      addLog(`State: ${previousState} → ${currentState}`);
    },
  });

  useWalletEvent({
    event: 'error',
    handler: ({ error }) => {
      addLog(`Error: ${error.message}`);
    },
  });

  const clearLogs = useCallback(() => setLogs([]), []);

  return (
    <div className="event-logger">
      <div className="header">
        <h2>Event Log</h2>
        <button onClick={clearLogs} className="btn btn-small">
          Clear
        </button>
      </div>

      <div className="log-container">
        {logs.length === 0 ? (
          <p className="muted">No events yet</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="log-entry">
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Error Display ─────────────────────────────────────────────────────────

interface ErrorDisplayProps {
  error: WalletError;
  onRetry?: () => void;
}

function ErrorDisplay({ error, onRetry }: ErrorDisplayProps): React.ReactElement {
  const getMessage = () => {
    switch (error.code) {
      case WalletErrorCode.USER_REJECTED:
        return 'You cancelled the operation';
      case WalletErrorCode.WALLET_NOT_FOUND:
        return 'MetaMask is not installed. Please install it first.';
      case WalletErrorCode.CONNECTION_TIMEOUT:
        return 'Connection timed out. Please try again.';
      case WalletErrorCode.CHAIN_NOT_SUPPORTED:
        return 'This chain is not supported by your wallet.';
      default:
        return error.message;
    }
  };

  return (
    <div className={`error-display ${error.isRetryable ? 'retryable' : ''}`}>
      <p className="error-message">{getMessage()}</p>
      {error.isRetryable && onRetry && (
        <button onClick={onRetry} className="btn btn-retry">
          Retry
        </button>
      )}
    </div>
  );
}

// ─── CSS (inline for example purposes) ─────────────────────────────────────

export const styles = `
.app {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-connect {
  background: #3b82f6;
  color: white;
}

.btn-disconnect {
  background: #ef4444;
  color: white;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.wallet-status,
.sign-form,
.chain-switcher,
.event-logger {
  margin: 20px 0;
  padding: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.signature {
  word-break: break-all;
  font-size: 12px;
  background: #f3f4f6;
  padding: 10px;
  border-radius: 4px;
  display: block;
}

.error-display {
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 10px;
  border-radius: 8px;
  margin-top: 10px;
}

.error-message {
  color: #dc2626;
  margin: 0;
}

.muted {
  color: #9ca3af;
}

.log-container {
  max-height: 200px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.log-entry {
  padding: 4px 0;
  border-bottom: 1px solid #f3f4f6;
}

textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-family: inherit;
  resize: vertical;
}
`;
