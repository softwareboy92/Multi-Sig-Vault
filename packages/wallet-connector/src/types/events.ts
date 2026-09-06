// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Event Types
// ═══════════════════════════════════════════════════════════════════════════

import type { Account, WalletState } from './wallet.js';
import type { WalletError } from '../core/errors.js';

// ─── Event Types ──────────────────────────────────────────────────────────
export type WalletEvent =
  | 'stateChange'
  | 'accountChange'
  | 'chainChange'
  | 'disconnect'
  | 'error'
  | 'appChange';

// ─── Event Payloads ───────────────────────────────────────────────────────
export interface WalletEventPayloads {
  stateChange: StateChangePayload;
  accountChange: AccountChangePayload;
  chainChange: ChainChangePayload;
  disconnect: DisconnectPayload;
  error: ErrorPayload;
  appChange: AppChangePayload;
}

export interface StateChangePayload {
  previousState: WalletState;
  currentState: WalletState;
  reason?: string;
  errorMessage?: string;
}

export interface AccountChangePayload {
  previousAccount: Account | null;
  currentAccount: Account | null;
}

export interface ChainChangePayload {
  previousChainId: number | null;
  currentChainId: number;
}

export interface DisconnectPayload {
  reason: 'user' | 'device' | 'timeout' | 'error';
  error?: WalletError;
}

export interface ErrorPayload {
  error: WalletError;
}

export interface AppChangePayload {
  /** Required app name for the selected chain */
  requiredApp: string;
  /** Currently open app (if detected) */
  currentApp?: string;
  /** Action being taken: 'quitting' when exiting current app, 'opening' when requesting to open app */
  action: 'quitting' | 'opening' | 'opened' | 'failed';
}

// ─── Event Handler ────────────────────────────────────────────────────────
export type WalletEventHandler<E extends WalletEvent> = (
  payload: WalletEventPayloads[E]
) => void;
