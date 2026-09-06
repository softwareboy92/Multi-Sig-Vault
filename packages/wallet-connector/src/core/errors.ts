// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Error Types
// ═══════════════════════════════════════════════════════════════════════════

// ─── Error Codes ──────────────────────────────────────────────────────────
export enum WalletErrorCode {
  // Connection Errors (1000-1999)
  WALLET_NOT_FOUND = 1001,
  TRANSPORT_NOT_SUPPORTED = 1002,
  DEVICE_NOT_CONNECTED = 1003,
  CONNECTION_FAILED = 1004,
  CONNECTION_TIMEOUT = 1005,
  WRONG_APP = 1006,
  DEVICE_LOCKED = 1007,
  DEVICE_BUSY = 1008,
  DEVICE_NOT_FOUND = 1009,
  DEVICE_DISCONNECTED = 1010,
  BROWSER_NOT_SUPPORTED = 1011,
  LEDGER_APP_NOT_OPEN = 1012,

  // Signing Errors (2000-2999)
  USER_REJECTED = 2001,
  SIGNING_FAILED = 2002,
  INVALID_PAYLOAD = 2003,
  SIGNATURE_INVALID = 2004,
  WALLET_POLICY_NOT_REGISTERED = 2005,

  // Chain Errors (3000-3999)
  CHAIN_NOT_SUPPORTED = 3001,
  CHAIN_NOT_CONFIGURED = 3002,
  NETWORK_ERROR = 3003,

  // State Errors (4000-4999)
  NOT_INITIALIZED = 4001,
  NOT_CONNECTED = 4002,
  INVALID_STATE = 4003,
  SESSION_EXPIRED = 4004,
  OPERATION_TIMEOUT = 4005,

  // Internal Errors (5000-5999)
  INTERNAL_ERROR = 5001,
  UNKNOWN_ERROR = 5999,
}

// ─── Retryable Error Codes ────────────────────────────────────────────────
const RETRYABLE_CODES = new Set<WalletErrorCode>([
  WalletErrorCode.CONNECTION_TIMEOUT,
  WalletErrorCode.DEVICE_BUSY,
  WalletErrorCode.NETWORK_ERROR,
  WalletErrorCode.OPERATION_TIMEOUT,
]);

// ─── User Action Required Error Codes ─────────────────────────────────────
const ACTION_REQUIRED_CODES = new Set<WalletErrorCode>([
  WalletErrorCode.WALLET_NOT_FOUND,
  WalletErrorCode.WRONG_APP,
  WalletErrorCode.DEVICE_LOCKED,
  WalletErrorCode.USER_REJECTED,
  WalletErrorCode.WALLET_POLICY_NOT_REGISTERED,
]);

// ─── Wallet Error Class ───────────────────────────────────────────────────
export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly details?: Record<string, unknown>;
  readonly cause?: Error;
  readonly timestamp: Date;

  constructor(
    code: WalletErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
    this.details = details;
    this.cause = cause;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown (V8 engines)
    const ErrorCtor = Error as typeof Error & {
      captureStackTrace?: (target: object, constructor: unknown) => void;
    };
    if (ErrorCtor.captureStackTrace) {
      ErrorCtor.captureStackTrace(this, WalletError);
    }
  }

  /**
   * Whether this error is retryable
   */
  get isRetryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  /**
   * Whether this error requires user action
   */
  get requiresUserAction(): boolean {
    return ACTION_REQUIRED_CODES.has(this.code);
  }

  /**
   * Convert to JSON (for logging)
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }

  /**
   * Create from unknown error
   */
  static from(error: unknown, defaultCode = WalletErrorCode.UNKNOWN_ERROR): WalletError {
    if (error instanceof WalletError) {
      return error;
    }

    if (error instanceof Error) {
      return new WalletError(defaultCode, error.message, undefined, error);
    }

    return new WalletError(defaultCode, String(error));
  }
}
