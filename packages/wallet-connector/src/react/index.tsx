// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - React Hooks
// ═══════════════════════════════════════════════════════════════════════════

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { WalletProvider } from '../core/provider.js';
import type { Account, ChainType, ConnectOptions, SignResult, WalletState } from '../types/wallet.js';
import type { SignPayload } from '../types/payload.js';
import type { WalletEvent, WalletEventPayloads } from '../types/events.js';
import { WalletError, WalletErrorCode } from '../core/errors.js';

// ─── Wallet Context ───────────────────────────────────────────────────────
export interface WalletContextValue {
  // Provider management
  provider: WalletProvider | null;
  setProvider: (provider: WalletProvider | null) => void;

  // Connection state
  state: WalletState;
  account: Account | null;
  error: WalletError | null;

  // Actions
  connect: (options: ConnectOptions) => Promise<Account>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<SignResult>;
  signTransaction: (payload: SignPayload) => Promise<SignResult>;

  // Utilities
  isConnected: boolean;
  isConnecting: boolean;
  isSigning: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Wallet Provider Component ────────────────────────────────────────────
export interface WalletProviderProps {
  children: ReactNode;
  provider?: WalletProvider;
  autoConnect?: boolean;
  autoConnectOptions?: ConnectOptions;
}

export function WalletContextProvider({
  children,
  provider: initialProvider,
  autoConnect = false,
  autoConnectOptions,
}: WalletProviderProps): JSX.Element {
  const [provider, setProvider] = useState<WalletProvider | null>(
    initialProvider ?? null
  );
  const [state, setState] = useState<WalletState>('UNINITIALIZED');
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<WalletError | null>(null);

  // Track if we've attempted auto-connect
  const hasAutoConnected = useRef(false);

  // Derived states
  const isConnected = state === 'CONNECTED';
  const isConnecting = state === 'CONNECTING';
  const isSigning = state === 'SIGNING';

  // ─── Event Handlers ────────────────────────────────────

  useEffect(() => {
    if (!provider) return;

    const handleStateChange = ({
      currentState,
      errorMessage,
    }: WalletEventPayloads['stateChange']) => {
      setState(currentState);
      if (errorMessage) {
        setError(
          new WalletError(WalletErrorCode.UNKNOWN_ERROR, errorMessage)
        );
      } else {
        setError(null);
      }
    };

    const handleAccountChange = ({
      currentAccount,
    }: WalletEventPayloads['accountChange']) => {
      setAccount(currentAccount);
    };

    const handleDisconnect = () => {
      setState((prev) => {
        if (prev === 'IDLE' || prev === 'UNINITIALIZED') return prev;
        return 'IDLE';
      });
      setAccount(null);
    };

    const handleError = ({ error }: WalletEventPayloads['error']) => {
      setError(error);
    };

    // Subscribe to events
    provider.on('stateChange', handleStateChange);
    provider.on('accountChange', handleAccountChange);
    provider.on('disconnect', handleDisconnect);
    provider.on('error', handleError);

    // Sync initial state
    setState(provider.state);
    setAccount(provider.account);

    return () => {
      provider.off('stateChange', handleStateChange);
      provider.off('accountChange', handleAccountChange);
      provider.off('disconnect', handleDisconnect);
      provider.off('error', handleError);
    };
  }, [provider]);

  // ─── Auto Connect ──────────────────────────────────────

  useEffect(() => {
    if (!autoConnect || !provider || !autoConnectOptions || hasAutoConnected.current) {
      return;
    }

    hasAutoConnected.current = true;

    const doAutoConnect = async () => {
      try {
        await provider.init();
        await provider.connect(autoConnectOptions);
      } catch {
        // Silently fail auto-connect
      }
    };

    doAutoConnect();
  }, [autoConnect, provider, autoConnectOptions]);

  // ─── Actions ───────────────────────────────────────────

  const connect = useCallback(
    async (options: ConnectOptions): Promise<Account> => {
      if (!provider) {
        throw new WalletError(
          WalletErrorCode.NOT_INITIALIZED,
          'No wallet provider configured'
        );
      }

      setError(null);

      // Initialize if needed
      if (provider.state === 'UNINITIALIZED') {
        await provider.init();
      }

      return provider.connect(options);
    },
    [provider]
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!provider) return;
    await provider.disconnect();
  }, [provider]);

  const signMessage = useCallback(
    async (message: string): Promise<SignResult> => {
      if (!provider) {
        throw new WalletError(
          WalletErrorCode.NOT_INITIALIZED,
          'No wallet provider configured'
        );
      }

      if (!account) {
        throw new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'No account connected'
        );
      }

      setError(null);
      return provider.signMessage(message, account);
    },
    [provider, account]
  );

  const signTransaction = useCallback(
    async (payload: SignPayload): Promise<SignResult> => {
      if (!provider) {
        throw new WalletError(
          WalletErrorCode.NOT_INITIALIZED,
          'No wallet provider configured'
        );
      }

      if (!account) {
        throw new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'No account connected'
        );
      }

      setError(null);
      return provider.signTransaction(payload, account);
    },
    [provider, account]
  );

  // ─── Context Value ─────────────────────────────────────

  const value = useMemo<WalletContextValue>(
    () => ({
      provider,
      setProvider,
      state,
      account,
      error,
      connect,
      disconnect,
      signMessage,
      signTransaction,
      isConnected,
      isConnecting,
      isSigning,
    }),
    [
      provider,
      state,
      account,
      error,
      connect,
      disconnect,
      signMessage,
      signTransaction,
      isConnected,
      isConnecting,
      isSigning,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ─── useWallet Hook ───────────────────────────────────────────────────────
export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletContextProvider');
  }
  return context;
}

// ─── useWalletEvents Hook ─────────────────────────────────────────────────
export interface UseWalletEventsOptions<E extends WalletEvent> {
  event: E;
  handler: (payload: WalletEventPayloads[E]) => void;
  enabled?: boolean;
}

export function useWalletEvent<E extends WalletEvent>({
  event,
  handler,
  enabled = true,
}: UseWalletEventsOptions<E>): void {
  const { provider } = useWallet();
  const handlerRef = useRef(handler);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!provider || !enabled) return;

    const wrappedHandler = (payload: WalletEventPayloads[E]) => {
      handlerRef.current(payload);
    };

    provider.on(event, wrappedHandler);

    return () => {
      provider.off(event, wrappedHandler);
    };
  }, [provider, event, enabled]);
}

// ─── useSignature Hook ────────────────────────────────────────────────────
export interface SignatureState {
  signature: string | null;
  isLoading: boolean;
  error: WalletError | null;
}

export interface UseSignatureResult extends SignatureState {
  signMessage: (message: string) => Promise<string | null>;
  signTransaction: (payload: SignPayload) => Promise<string | null>;
  reset: () => void;
}

export function useSignature(): UseSignatureResult {
  const { signMessage: walletSignMessage, signTransaction: walletSignTransaction } =
    useWallet();

  const [state, setState] = useState<SignatureState>({
    signature: null,
    isLoading: false,
    error: null,
  });

  const signMessage = useCallback(
    async (message: string): Promise<string | null> => {
      setState({ signature: null, isLoading: true, error: null });

      try {
        const result = await walletSignMessage(message);
        setState({ signature: result.signature, isLoading: false, error: null });
        return result.signature;
      } catch (err) {
        const error =
          err instanceof WalletError
            ? err
            : new WalletError(
                WalletErrorCode.SIGNING_FAILED,
                err instanceof Error ? err.message : 'Unknown error'
              );
        setState({ signature: null, isLoading: false, error });
        return null;
      }
    },
    [walletSignMessage]
  );

  const signTransaction = useCallback(
    async (payload: SignPayload): Promise<string | null> => {
      setState({ signature: null, isLoading: true, error: null });

      try {
        const result = await walletSignTransaction(payload);
        setState({ signature: result.signature, isLoading: false, error: null });
        return result.signature;
      } catch (err) {
        const error =
          err instanceof WalletError
            ? err
            : new WalletError(
                WalletErrorCode.SIGNING_FAILED,
                err instanceof Error ? err.message : 'Unknown error'
              );
        setState({ signature: null, isLoading: false, error });
        return null;
      }
    },
    [walletSignTransaction]
  );

  const reset = useCallback(() => {
    setState({ signature: null, isLoading: false, error: null });
  }, []);

  return {
    ...state,
    signMessage,
    signTransaction,
    reset,
  };
}

// ─── useChainSwitch Hook ──────────────────────────────────────────────────
export interface UseChainSwitchResult {
  currentChain: ChainType | null;
  switchChain: (chain: ChainType) => Promise<void>;
  isLoading: boolean;
  error: WalletError | null;
}

export function useChainSwitch(): UseChainSwitchResult {
  const { account, connect, disconnect } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<WalletError | null>(null);

  const currentChain = account?.chain ?? null;

  const switchChain = useCallback(
    async (chain: ChainType): Promise<void> => {
      if (!account || account.chain === chain) return;

      setIsLoading(true);
      setError(null);

      try {
        // For now, we disconnect and reconnect with new chain
        // Provider-specific switching can be done at provider level
        await disconnect();
        await connect({ chain });
      } catch (err) {
        const walletError =
          err instanceof WalletError
            ? err
            : new WalletError(
                WalletErrorCode.CHAIN_NOT_SUPPORTED,
                err instanceof Error ? err.message : 'Failed to switch chain'
              );
        setError(walletError);
        throw walletError;
      } finally {
        setIsLoading(false);
      }
    },
    [account, connect, disconnect]
  );

  return {
    currentChain,
    switchChain,
    isLoading,
    error,
  };
}
