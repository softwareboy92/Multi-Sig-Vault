# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Frontend: `usePendingOperation` localStorage hook — persist pending signature/broadcast/activation operations across page reloads (1h TTL, auto-dedup by type+id)
- Frontend: `useTransactionConfirmationWatcher` hook — background polling for SIGNED/BROADCAST → terminal state transitions with adaptive intervals (15s / 30s / 60s based on pending tx age) and page visibility optimization
- Frontend: signature and broadcast recovery banners on TransactionDetailPage — retry failed `submitSignature` or `broadcastTransaction` from localStorage-persisted data
- Frontend: activation recovery banner and manual txHash input on WalletDetailPage — recover `PENDING_DEPLOY` wallet activation from localStorage or user-supplied txHash
- Backend: `_try_sync_existing_tx()` in `TransactionService` — compensate existing transaction status from Safe Transaction Service API during history import (supports SIGNED→CONFIRMED, SIGNED→FAILED, FAILED→CONFIRMED recovery paths)
- Backend: auto-activate `PENDING_DEPLOY` EVM wallets via `eth_getCode` check in activation endpoint

### Changed
- Backend: EVMEventIndexer supports FAILED→CONFIRMED recovery — re-process `ExecutionSuccess` events for previously failed transactions
- Backend: SafeNonceSyncWorker adds 10-minute grace period for `SIGNED` transactions before marking as `FAILED`
- Backend: EVMEventIndexer normalizes `safe_tx_hash` with `0x` prefix before database lookup
- Backend: `import_evm_safe_history` returns `synced` count in addition to `imported`; commits on `synced > 0`

### Fixed
- Backend: EVMEventIndexer `get_logs` block params passed as hex strings instead of integers, causing `Web3RPCError` on some RPC endpoints
- Backend: EVMEventIndexer queries chain-tip blocks that may not be available for `eth_getLogs` on load-balanced / OP Stack RPC nodes (e.g. Base); added `confirmation_blocks` safety buffer (default 5) to only query stable blocks
- KeyVault signing payload: correct `business_data` fields per transaction type (ERC-20 symbol/contract, policy change/cancellation description, transfer_type metadata)
- KeyVault signing payload: fix IEEE 754 precision artifacts in amount/fee string conversion (SQLite `Decimal(float)` expansion)
- KeyVault signing payload: set `business_data.amount` to "0" (asset value field, not currently computed)
- Backend: EVMEventIndexer `parse_execution_event` returns hex without `0x` prefix, causing `payload_hash` mismatch with database records
- Backend: stale `error_message` not cleared when transaction confirmed via compensation (fixed in `_try_sync_existing_tx`, `_process_event` ExecutionSuccess, and `EVMBlockConfirmationWorker`)
- Backend: `BalanceSyncWorker` import error — `_resolve_network_id` renamed to `_resolve_network_ids` but import not updated; also fixed `==` → `.in_()` for multi-network query
- Frontend: `showToast` Temporal Dead Zone error in WalletDetailPage — moved declaration before `useCallback` reference

### Changed
- Frontend: temporarily remove all USD price display, `usePrices` hook calls, `UsdSubline` components, and `formatUsd`/`formatBalanceUsd` formatting across 15 pages/components; price and value columns show "—" as placeholder

## [0.1.6] - 2026-03-14

### Added
- EVM auto RPC discovery: auto-seed a default public RPC node from chainid.network registry on network creation
- Import RPC modal: browse, health-check, and bulk-import public RPC nodes from chainid.network registry
- `getPublicRpcs()` / `normalizeRpcUrl()` utilities in chainRegistry service for filtering and ranking public endpoints
- Network node card "Import from Registry" button for quick access to RPC discovery
- BTC P2SH-P2WSH address format support alongside existing P2WSH multisig
- BTC multisig BIP 48 derivation path support (`m/48'/coinType'/account'/1'` for P2SH-P2WSH, `/2'` for P2WSH)
- BTC address format selector on wallet creation page (P2WSH / P2SH-P2WSH with pros/cons descriptions)
- Backend BIP 48 path validation module (`path.py`) with strict regex enforcement and `script_type` inference
- Backend P2SH-P2WSH PSBT construction with `_populate_psbt_input` helper
- Backend wallet import support for P2SH-P2WSH addresses (Mode A manual + Mode B auto)
- Backend `script_type` auto-inference from signer derivation paths during wallet creation
- BTC signer display priority: address → xpub + derivation path → public key (across 3 transaction components)
- KeyVault QR modal: App Store download link and "Disable Platform Attestation" hint
- KeyVault restriction: BTC P2WSH-only via KeyVault, P2SH-P2WSH only via Ledger
- Shared frontend derivation path utilities (`toAccountLevelPath`, `parseBtcAccount`)
- WalletConnect lifecycle methods: `destroy()` (hard cleanup), `tryRestore()` (session recovery), `clearLocalStorage()`
- WalletConnect disconnect event deduplication with `_disconnecting` guard
- WalletConnect signing failure recovery: check session liveness to allow retry or degrade to IDLE
- Frontend `useWalletConnection` lifecycle management: `wcProviderRef`, `disconnectingRef` serialization guard, `forceDisconnect()` with `destroy()`, `cleanup()` exposure
- Frontend `cleanupRef` pattern for SignatureAddress form unmount cleanup
- EVM network `chain_id` uniqueness constraint on create and immutability on update
- BTC/EVM broadcast error toast notifications (`broadcastFailed` / `executeFailed` i18n keys)
- `BroadcastError` class for BTC broadcast with Electrum error message extraction
- EVM indexer multi-network support: `_resolve_network_ids()` returns `list[str]` for duplicate `chain_id` handling

### Changed
- Ledger BTC adapter: detect BIP 48 paths and skip single-sig address derivation
- VerifySignatureAddressForm: use dynamic path suffix (`/1'` or `/2'`) based on signer's script type
- Remove debug `console.log`/`console.error` from Ledger adapter and frontend
- WalletConnect `chains` configuration: use empty array (no `requiredNamespaces`) for imToken compatibility
- Default EVM network names normalized (e.g., "Ethereum (Sepolia)" → "Ethereum Sepolia")

### Fixed
- BTC P2SH-P2WSH PSBT input vsize underestimation: added scriptSig overhead (varint + push opcode + redeem script) to `estimate_input_vbytes()`
- EVM indexer FAILED status not persisted: added explicit `session.commit()` for FAILED transactions
- EVM indexer `_resolve_network_id()` returning only first match for duplicate `chain_id` networks
- EVM indexer missing timestamps and block pointer safety in confirmation worker
- Network edit form: name editability with `seededNetworkRef` pattern; `chain_id` input disabled in edit mode
- Frontend silent broadcast failure: EVM `executeWithDevice` and BTC `handleExecute` now surface RPC errors via toast

### Breaking Changes
- **BTC signers created under the old BIP 84 (`m/84'/…`) path scheme must be re-imported using BIP 48 paths.** There is no automatic migration. Delete the old signer and re-import with the correct `m/48'/coinType'/account'/scriptType'` derivation path.

## [0.1.5] - 2026-03-11

### Added
- EVM Safe policy management: add/remove/swap owner and change threshold via Safe contract
- Policy change transaction flow: build, sign, broadcast, confirm with on-chain execution
- On-chain drift detection and manual sync-policy endpoint for wallet state reconciliation
- Permissions tab (formerly "Policy") in wallet detail with owner list, threshold display, and change history
- Add Owner, Remove Owner, Swap Owner, Change Threshold modals
- Policy change detail card on transaction detail page
- `SAFE_POLICY_CHANGE` transaction type across models, schemas, and frontend
- Policy action inference from extra fields for backward-compatible history display
- EVM transaction simulation via Tenderly API (backend + frontend)
- KeyVault QR-based signing for EVM and BTC (BC-UR protocol, Web Component Modal)
- KeyVault SDK refactor — migrate QR signing flow into `@multivault/wallet-connector`
- KeyVault signature address verification for BTC and EVM
- Ledger deferred device verification with on-device address display
- EIP-3085 `wallet_addEthereumChain` support in WalletConnect provider
- Chain selector combo box with auto-fill in network form
- Native currency seeding and backfill for EVM networks
- Safe v1.4.1 deployment validation for custom EVM networks
- Success toast for sign and execute actions
- Testnet-aware USD price lookups (skip price fetch for testnets)

### Changed
- Rename `KeyVaultEvmSignPayload` to `KeyVaultSignPayload` for multi-chain consistency

### Fixed
- WalletConnect session rejection on mainnet required chain
- Sort signatures by signer address for Safe simulation
- Incoming transaction display and testnet asset pricing
- Frontend TypeScript compilation errors (53 errors resolved)
- ActionBar panel expands upward, stays fixed at viewport bottom

## [0.1.4] - 2026-02-19

### Added
- Detail pages redesign: rewrite Signer, Wallet, and Transaction detail pages with hooks + sub-components
- `AlertBanner`, `Collapsible`, `Tabs` UI components
- Frontend A/B/C/D completion: sortable tables, breadcrumbs, form drafts, BTC fee rate selector, toast enhancements
- Asset enhancement: USD price display (DeFiLlama), donut/bar charts, asset drill-down
- BTC UTXO locking: cache, confirmation check, coin selection decoupling
- BTC send-max support with backend fee calculation
- TanStack Query infrastructure and query key factory
- Lazy-loaded page components with `React.lazy`
- `ErrorBoundary` wrapping layout children, 404 page
- `useFormDraft` hook with `CreateWalletPage` integration

### Changed
- Timezone support: user-selectable timezone preference in settings
- Performance: `React.memo` on list items, adaptive transaction polling, visibility-aware queries

### Fixed
- UTXO picker usability (5 issues), locked UTXO display
- Wallet duplicate check with case-insensitive comparison and soft-delete filter
- Decimal-format balance handling in USD value calculation

## [0.1.3] - 2026-02-14

### Added
- Multisig wallet import: EVM Safe + BTC P2WSH (Mode A manual, Mode B auto-extract)
- `WalletSource` enum, `DeviceType.UNKNOWN` for imported signers
- Signer verification gate for imported wallets
- Entry page, pending actions panel
- Commit convention documentation

### Changed
- Architecture refactor: unified network model, signer/wallet/transaction model improvements
- Frontend redesign: network pages, settings, unified UX patterns and shared components
- Project documentation rewrite (architecture, development, API)

### Fixed
- BTC testnet detection for imported signers
- Propagate `btc_network` to imported signers

## [0.1.2] - 2026-01-29

### Fixed
- BTC signing flow
- Backup import/export
- Wallet-network model consistency

## [0.1.1] - 2026-01-28

### Added
- Safe nonce queue for EVM transactions

## [0.1.0] - 2026-01-26

### Added
- Initial monorepo setup (FastAPI backend + React frontend + wallet-connector SDK)
- Non-custodial multi-signature wallet management
- EVM Safe support (EIP-712, Multicall3)
- Bitcoin P2WSH support (PSBT, Electrum)
- Network management with custom RPC endpoints
- Asset tracking and balance synchronization
- Transaction creation, signing, broadcasting, and cancellation
- Signer device management (Ledger, MetaMask, WalletConnect)
- Full backup and restore (JSON export/import)
- Background workers (expiry check, balance sync, EVM event indexing, block confirmation, Safe nonce sync)
- Internationalization (zh-CN / English)
- Docker Compose deployment

[Unreleased]: https://github.com/multivault/multivault/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/multivault/multivault/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/multivault/multivault/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/multivault/multivault/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/multivault/multivault/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/multivault/multivault/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/multivault/multivault/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/multivault/multivault/releases/tag/v0.1.0
