/**
 * Maps @multivault/wallet-connector numeric error codes to localized messages.
 * Keep these values in sync with WalletErrorCode in the connector package.
 */
export const walletErrorCodeMap: Record<number, string> = {
  1001: "walletError.walletNotFound",
  1002: "walletError.transportNotSupported",
  1003: "walletError.deviceNotConnected",
  1004: "walletError.connectionFailed",
  1005: "walletError.connectionTimeout",
  1006: "walletError.wrongApp",
  1007: "walletError.deviceLocked",
  1008: "walletError.deviceBusy",
  1009: "walletError.deviceNotFound",
  1010: "walletError.deviceDisconnected",
  1011: "walletError.browserNotSupported",
  1012: "walletError.ledgerAppNotOpen",
  2001: "walletError.userRejected",
  2002: "walletError.signingFailed",
  2003: "walletError.invalidPayload",
  2004: "walletError.signatureInvalid",
  2005: "walletError.walletPolicyNotRegistered",
  3001: "walletError.chainNotSupported",
  3002: "walletError.chainNotConfigured",
  3003: "walletError.networkError",
  4001: "walletError.notInitialized",
  4002: "walletError.notConnected",
  4003: "walletError.invalidState",
  4004: "walletError.sessionExpired",
  4005: "walletError.operationTimeout",
  5001: "walletError.internalError",
  5999: "walletError.unknownError",
};

/**
 * Browser APIs and vendor SDKs sometimes throw plain DOMException/Error values
 * without a stable code. Specific patterns must precede generic ones.
 */
export const walletErrorMessageMap: ReadonlyArray<{
  pattern: RegExp;
  i18nKey: string;
}> = [
  {
    pattern: /access denied to use ledger device|notallowederror.*ledger|ledger.*permission.*denied/i,
    i18nKey: "walletError.ledgerAccessDenied",
  },
  {
    pattern: /camera access denied|permission denied.*camera|notallowederror.*camera/i,
    i18nKey: "walletError.cameraAccessDenied",
  },
  {
    pattern: /request already pending|already processing|device.*busy/i,
    i18nKey: "walletError.deviceBusy",
  },
  {
    pattern: /device.*locked|screen locked|security status not satisfied|0x?5502|0x?6982|0x?6986/i,
    i18nKey: "walletError.deviceLocked",
  },
  {
    pattern: /device.*disconnected|provider is disconnected|lost connection/i,
    i18nKey: "walletError.deviceDisconnected",
  },
  {
    pattern: /user rejected|user refused|user denied|user cancelled|user canceled|conditions not satisfied|0x?5501|0x?6985/i,
    i18nKey: "walletError.userRejected",
  },
  {
    pattern: /open the .+ app|app not initialized|app not open|0x?6d00|0x?6e00/i,
    i18nKey: "walletError.ledgerAppNotOpen",
  },
  {
    pattern: /no device selected|device not found/i,
    i18nKey: "walletError.deviceNotFound",
  },
  {
    pattern: /webhid|hid.*not supported|browser.*not supported/i,
    i18nKey: "walletError.browserNotSupported",
  },
  {
    pattern: /operation timed out|connection timed out|timeout/i,
    i18nKey: "walletError.operationTimeout",
  },
  {
    pattern: /wallet not connected|no account connected|not authorized/i,
    i18nKey: "walletError.notConnected",
  },
  {
    pattern: /chain.*not configured|chain is not connected/i,
    i18nKey: "walletError.chainNotConfigured",
  },
];

