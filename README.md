# MultiVault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Stage: Alpha](https://img.shields.io/badge/Stage-Alpha-orange.svg)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![Node 20+](https://img.shields.io/badge/node-20+-green.svg)](https://nodejs.org/)

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

MultiVault is a non-custodial, local-first multi-signature wallet manager for EVM Safe and Bitcoin P2WSH / P2SH-P2WSH wallets.

> **⚠️ Project Status: Alpha**
>
> APIs, database schemas, and configuration formats may change without notice. Do not use MultiVault to manage production assets until you have independently reviewed and tested it.

## Highlights

- **Non-custodial signing** — Private keys never enter the backend. Sign with Ledger, MetaMask, WalletConnect, or KeyVault QR.
- **EVM and Bitcoin multisig** — Safe contract accounts and EIP-712 on EVM; BIP 48, PSBT, P2WSH / P2SH-P2WSH, and Electrum on Bitcoin.
- **Complete transaction lifecycle** — Create, sign, broadcast, cancel, track confirmation, recover interrupted operations, and manage the Safe nonce queue.
- **Incoming and outgoing history** — Import BTC and EVM activity, filter by network, direction, status, asset, or local tag, and inspect transaction details.
- **Local transaction tags** — Create and assign private, browser-local labels without publishing them on-chain.
- **Safer recipients** — Use the address book, quickly add missing entries, or require every recipient to come from the address book.
- **Transaction simulation** — Preview EVM execution and asset changes with Tenderly. Configure credentials in Security Settings; API keys are encrypted locally by the backend.
- **Signer management** — Import, register, verify, and revoke signer addresses with device-aware guidance and localized wallet errors.
- **KeyVault animated QR workflow** — Scan with a camera or import a recorded QR video when a camera is unavailable.
- **Assets and networks** — Synchronize balances, import ERC-20 tokens, manage custom EVM / BTC networks, and discover public EVM RPC endpoints.
- **Personalized interface** — Light, dark, tech, and Matrix themes; Simplified Chinese, Traditional Chinese, English, Japanese, and Korean.
- **Backup and restore** — Export, verify, and import wallet data in JSON format.

## Security Notes

- MultiVault does not store private keys.
- Local preferences and transaction tags stay in browser storage.
- Tenderly simulation is optional. When enabled, pending transaction data is sent to Tenderly.
- Tenderly credentials saved through Security Settings are encrypted at rest and are never returned to the browser.
- Always verify the recipient, amount, network, and device display before signing.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2 async, aiosqlite, Pydantic v2 |
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Zustand 5 |
| Wallet SDK | `@multivault/wallet-connector` |
| Blockchain | Web3.py 7, Safe, EIP-712, Multicall3, embit, PSBT, Electrum |
| Deployment | Docker Compose, Nginx |

## Quick Start

### Docker (recommended)

```bash
bash scripts/docker-up.sh
```

After startup:

- App: http://localhost:3000
- Health check: `curl -fsS http://localhost:3000/api/v1/health`
- Stop: `bash scripts/docker-down.sh`

If Docker Hub is unavailable, override the base images:

```bash
export PYTHON_IMAGE=<mirror>/library/python:3.12-slim-bookworm
export NODE_IMAGE=<mirror>/library/node:20-alpine
export NGINX_IMAGE=<mirror>/library/nginx:1.27-alpine
bash scripts/docker-up.sh
```

### Local development

Requirements: Node.js 20+, pnpm 9+, Python 3.12+, Poetry.

```bash
pnpm run bootstrap
pnpm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://127.0.0.1:8000/api/v1
- Logs: `logs/backend.log`, `logs/frontend.log`

## Common Commands

```bash
pnpm test              # SDK + backend tests
pnpm test:backend      # Backend tests
pnpm test:sdk          # Wallet SDK tests
pnpm lint              # Frontend + SDK lint
pnpm typecheck         # TypeScript checks
pnpm build             # SDK + frontend build
pnpm docker:up         # Start Docker services
pnpm docker:down       # Stop Docker services
```

## Repository Layout

```text
apps/
  backend/             FastAPI service, chain adapters, workers, and tests
  frontend/            React application, UI components, stores, and i18n
packages/
  wallet-connector/    Ledger, MetaMask, WalletConnect, and KeyVault adapters
docs/                  Architecture and development documentation
scripts/               Development and deployment scripts
```

## Documentation

- [Documentation index](docs/README.md)
- [Quick start](docs/quickstart.md)
- [Development guide](docs/development.md)
- [Architecture](docs/architecture.md)
- [Backend API](apps/backend/docs/API.md)
- [Backend guide](apps/backend/README.md)
- [Frontend guide](apps/frontend/README.md)
- [Wallet SDK](packages/wallet-connector/README.md)
- [Changelog](CHANGELOG.md)

## License

MIT License. See [LICENSE](LICENSE).
