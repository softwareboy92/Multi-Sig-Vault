# @multivault/wallet-connector

MultiVault 钱包 SDK - 统一的钱包抽象层，支持多种硬件钱包、浏览器插件钱包和 WalletConnect。

## 安装

```bash
npm install @multivault/wallet-connector
# or
pnpm add @multivault/wallet-connector
```

## 特性

- 🔐 **MetaMask** - 完整的浏览器插件钱包支持
- 📱 **WalletConnect V2** - 移动钱包 QR 码连接
- 🔒 **Ledger** - 硬件钱包 WebHID 支持
- 🔑 **KeyVault** - 离线签名设备 QR 码通信
- ⛓️ **EIP-3085** - 自动添加自定义 EVM 链（MetaMask / WalletConnect）
- ⚛️ **React Hooks** - 开箱即用的 React 集成
- 📝 **TypeScript** - 完整的类型定义
- 🔗 **多链** - 支持 Ethereum、Bitcoin

## 快速开始

### MetaMask

```typescript
import { MetaMaskProvider } from '@multivault/wallet-connector';

const provider = new MetaMaskProvider();

// Initialize and connect
await provider.init();
const account = await provider.connect({
  chain: 'ETHEREUM',
  evmChainId: 1,
});

console.log('Connected:', account.address);

// Switch to a custom chain (EIP-3085: auto-add if not present)
await provider.switchChain(137, {
  chainName: 'Polygon',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  rpcUrls: ['https://polygon-rpc.com'],
  blockExplorerUrls: ['https://polygonscan.com'],
});

// Sign a message
const result = await provider.signMessage('Hello!', account);
console.log('Signature:', result.signature);
```

### Ledger

```typescript
import { LedgerProvider } from '@multivault/wallet-connector';

const ledger = new LedgerProvider({
  transportType: 'webhid',
});

await ledger.init();

// Listen for app switching events (optional)
ledger.on('appChange', ({ requiredApp, action }) => {
  if (action === 'opening') {
    console.log(`Please confirm opening ${requiredApp} on your device`);
  }
});

// Connect - will auto-switch apps if needed
const account = await ledger.connect({
  chain: 'BITCOIN',
  derivationPath: "m/48'/0'/0'/2'",
  addressIndex: 0,  // Address index for multisig
  change: 0,        // 0 = receive, 1 = change
  showOnDevice: false, // Silent connect (skip device confirmation)
});

// After user reviews the address on screen, verify on device
await ledger.verifyAddressOnDevice(account);

// Sign Bitcoin PSBT
const result = await ledger.signTransaction({
  type: 'btc',
  psbt: 'base64_psbt_string',
  txType: 'native-segwit',
  isMultisig: false,
}, account);
```

### WalletConnect

```typescript
import { WalletConnectProvider } from '@multivault/wallet-connector';

const wc = new WalletConnectProvider({
  projectId: 'YOUR_PROJECT_ID',
  metadata: { name: 'My App', description: '', url: '', icons: [] },
  chains: [],                             // Empty — no requiredNamespaces (imToken compat)
  optionalChains: [1, 137, 56, 42161],    // All chains as optional
  showQrModal: true,
});

await wc.init();

// Try to restore a previous session before prompting QR scan
const restored = await wc.tryRestore();
if (!restored) {
  const account = await wc.connect({ chain: 'ETHEREUM' });
}

// Switch chain with auto-add (EIP-3085)
await wc.switchChain(42161, {
  chainName: 'Arbitrum One',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://arb1.arbitrum.io/rpc'],
});

// Graceful cleanup — clears session + localStorage
await wc.destroy();
```

### KeyVault

```typescript
import { KeyVaultProvider } from '@multivault/wallet-connector';
import type { KeyVaultConnectOptions, KeyVaultSignPayload } from '@multivault/wallet-connector';

const keyvault = new KeyVaultProvider({ qrTimeoutMs: 180_000 });
await keyvault.init();

// Connect — pass known address (no device I/O)
const account = await keyvault.connect({
  chain: 'ETHEREUM',
  address: '0x1234...abcd',
} as KeyVaultConnectOptions);

// Sign via QR code exchange
const result = await keyvault.signTransaction({
  type: 'keyvault',
  payloadJson: '{"business_data":...}',
  signerId: 'signer-uuid',
}, account);
```

### React

```tsx
import { WalletContextProvider, useWallet, MetaMaskProvider } from '@multivault/wallet-connector/react';

const provider = new MetaMaskProvider();

function App() {
  return (
    <WalletContextProvider provider={provider}>
      <WalletButton />
    </WalletContextProvider>
  );
}

function WalletButton() {
  const { account, isConnected, connect, disconnect } = useWallet();

  if (isConnected) {
    return (
      <div>
        <span>{account?.address}</span>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <button onClick={() => connect({ chain: 'ETHEREUM' })}>
      Connect Wallet
    </button>
  );
}
```

## API 文档

### Provider（提供方）

#### `MetaMaskProvider`

浏览器扩展钱包集成（MetaMask 及兼容钱包）。

```typescript
const provider = new MetaMaskProvider();
await provider.init();
await provider.connect({ chain: 'ETHEREUM' });
await provider.switchChain(chainId, addChainParams?); // EIP-3085
await provider.signMessage(message, account);
await provider.signTransaction(payload, account);
await provider.disconnect();
```

#### `LedgerProvider`

Ledger 硬件钱包 WebHID 支持。

```typescript
const provider = new LedgerProvider({
  transportType: 'webhid',
  autoReconnect: true,
});

// Basic connection
await provider.init();
const account = await provider.connect({
  chain: 'BITCOIN',
  derivationPath: "m/48'/0'/0'/2'",
});

// Silent connect (deferred device verification)
const account = await provider.connect({
  chain: 'BITCOIN',
  derivationPath: "m/48'/0'/0'/2'",
  addressIndex: 0,
  showOnDevice: false,  // Skip device address confirmation
});
// Later, verify on device after user reviews the address
await provider.verifyAddressOnDevice(account);

// Account contains:
// - address: Derived address
// - publicKey: 33-byte compressed public key (hex)
// - xpub: Extended public key at account level
// - derivationPath: Full path including index
// - masterFingerprint: (BTC only)
```

#### `WalletConnectProvider`

WalletConnect V2 协议支持，含完整生命周期管理。

```typescript
const provider = new WalletConnectProvider({
  projectId: 'YOUR_PROJECT_ID',
  metadata: { name: 'My App', ... },
  chains: [],              // Empty for maximum wallet compatibility
  optionalChains: [1],     // All chains as optional
  showQrModal: true,
});

// Lifecycle
await provider.init();
await provider.tryRestore();                          // Restore cached session (if valid)
await provider.connect({ chain: 'ETHEREUM' });         // QR scan + new session
await provider.switchChain(chainId, addChainParams?);  // EIP-3085
await provider.disconnect();                           // Soft disconnect (keep localStorage)
await provider.destroy();                              // Hard cleanup (clear localStorage + provider)

// Session management
provider.hasExistingSession();  // Check cached session
provider.getSession();          // SessionInfo: topic, peerName, peerIcon, expiry
await provider.clearSession();  // Clear localStorage + re-init provider
```

#### `KeyVaultProvider`

离线签名设备 QR 码集成（air-gapped 设备）。

```typescript
const provider = new KeyVaultProvider({
  qrTimeoutMs: 180_000,  // QR 扫描超时（默认 3 分钟）
});

await provider.init();
// connect 是纯内存操作 — 地址由后端提供
await provider.connect({
  chain: 'ETHEREUM',
  address: '0x...',
} as KeyVaultConnectOptions);
// signTransaction 弹出 QR Modal
await provider.signTransaction(payload, account);
await provider.disconnect();
```

### React Hooks（Hooks）

#### `useWallet()`

钱包连接状态管理。

```typescript
const {
  account,      // Current account
  state,        // Connection state
  isConnected,  // Boolean shorthand
  isConnecting, // Boolean shorthand
  connect,      // Connect function
  disconnect,   // Disconnect function
  error,        // Last error
} = useWallet();
```

#### `useSignature()`

签名功能。

```typescript
const {
  signature,    // Signature result
  isLoading,    // Loading state
  error,        // Error
  signMessage,  // Sign message function
  signTx,       // Sign transaction function
  reset,        // Clear state
} = useSignature();
```

#### `useWalletEvent()`

事件监听。

```typescript
useWalletEvent({
  event: 'accountChange',
  handler: ({ previousAccount, currentAccount }) => {
    console.log('Account changed!');
  },
});
```

#### `useChainSwitch()`

链切换。

```typescript
const {
  currentChain,  // Current chain type
  switchChain,   // Switch function
  isLoading,     // Loading state
  error,         // Error
} = useChainSwitch();
```

### 错误处理

```typescript
import { WalletError, WalletErrorCode } from '@multivault/wallet-connector';

try {
  await provider.connect({ chain: 'ETHEREUM' });
} catch (error) {
  if (error instanceof WalletError) {
    switch (error.code) {
      case WalletErrorCode.USER_REJECTED:
        console.log('User cancelled');
        break;
      case WalletErrorCode.WALLET_NOT_FOUND:
        console.log('Wallet not installed');
        break;
      case WalletErrorCode.CHAIN_NOT_CONFIGURED:
        console.log('Chain params not provided for auto-add');
        break;
      default:
        if (error.isRetryable) {
          // Can retry
        }
    }
  }
}
```

### 事件

```typescript
provider.on('accountChange', ({ previousAccount, currentAccount }) => {});
provider.on('chainChange', ({ previousChainId, currentChainId }) => {});
provider.on('disconnect', ({ reason }) => {});
provider.on('stateChange', ({ previousState, currentState }) => {});
provider.on('error', ({ error }) => {});
// Ledger only
provider.on('appChange', ({ requiredApp, currentApp, action }) => {});
// action: 'quitting' | 'opening' | 'opened' | 'failed'
```

## XPub 工具函数

> **注意**：以下 XPub 工具函数为 SDK 内部工具，仅供 Provider 内部使用，**不从主入口 `@multivault/wallet-connector` 导出**。如需使用请参考 [DESIGN.md §10.2](./docs/DESIGN.md#102-xpub-工具-utilsxpubts内部工具不在公共-api-中)。

```typescript
import {
  parseXpub,
  buildXpub,
  compressPublicKey,
  parseDerivationPath,
  buildFullDerivationPath,
} from '@multivault/wallet-connector';

// Parse xpub string
const xpubData = await parseXpub('xpub...');
console.log(xpubData.publicKey); // 33-byte compressed pubkey

// Compress uncompressed public key (65 bytes -> 33 bytes)
const compressed = compressPublicKey('04a1af...');

// Build full derivation path
const fullPath = buildFullDerivationPath("m/48'/0'/0'/2'", 0, 5);
// "m/48'/0'/0'/2'/0/5"
```

## 文档

| 文档 | 说明 |
|:-----|:-----|
| [API Reference](../../docs/guides/SDK.md) | 完整 API 参考（类型定义、方法签名） |
| [Examples](../../docs/guides/SDK.md) | 详细使用示例（多签流程、错误处理） |
| [Known Issues](../../docs/guides/SDK.md) | 已知问题与解决方案 |

## 示例

查看 [examples/](./examples/) 目录获取完整示例：

- [basic-metamask.ts](./examples/basic-metamask.ts) - MetaMask 基础用法
- [ledger-hardware.ts](./examples/ledger-hardware.ts) - Ledger 硬件钱包
- [react-integration.tsx](./examples/react-integration.tsx) - React 集成

## 多签交易签名

### EVM Safe 交易签名（EIP-712）

```typescript
// 1. Parse EIP-712 typed data from backend
const typedData = JSON.parse(transaction.payload);

// 2. Sign using signTransaction
const evmPayload = {
  type: 'evm',
  typedData: typedData,
  safeTxHash: transaction.payload_hash,
};
const result = await provider.signTransaction(evmPayload, account);

// 3. Submit signature to backend
await fetch(`/transactions/${txId}/sign`, {
  method: 'POST',
  body: JSON.stringify({
    signer_id: signerId,
    signature_data: result.signature,
  }),
});
```

### BTC 多签 PSBT 签名（Ledger）

```typescript
// 1. Register wallet policy (required for Ledger multisig)
const walletPolicy = {
  name: 'My Multisig',
  descriptorTemplate: 'wsh(sortedmulti(2,@0/**,@1/**))',
  keys: [
    '[fingerprint1/48h/0h/0h/2h]xpub1...',
    '[fingerprint2/48h/0h/0h/2h]xpub2...',
  ],
};
const { walletId, walletHmac } = await ledger.registerWalletPolicy(walletPolicy);

// 2. Sign PSBT with policy
const btcPayload = {
  type: 'btc',
  psbt: transaction.payload,  // Base64 PSBT
  txType: 'native-segwit',
  isMultisig: true,
  walletPolicy: walletPolicy,
  walletHmac: walletHmac,
};
const result = await ledger.signTransaction(btcPayload, account);

// 3. Submit partial signatures to backend
await fetch(`/transactions/${txId}/sign`, {
  method: 'POST',
  body: JSON.stringify({
    signer_id: signerId,
    signature_data: JSON.stringify(result.signatures),
  }),
});
```

## 浏览器支持

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| MetaMask | ✅ | ✅ | ❌ | ✅ |
| WalletConnect | ✅ | ✅ | ✅ | ✅ |
| Ledger (WebHID) | ✅ | ❌ | ❌ | ✅ |

## 许可证

MIT
