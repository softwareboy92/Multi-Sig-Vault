# MultiVault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Stage: Alpha](https://img.shields.io/badge/Stage-Alpha-orange.svg)

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md) | [한국어](README.ko.md)

MultiVault 是一個非託管、本機優先的多簽錢包管理系統，支援 EVM Safe 與 Bitcoin P2WSH / P2SH-P2WSH 錢包。

> **⚠️ 專案狀態：Alpha**
>
> API、資料庫結構與設定格式仍可能變更。在完成獨立審查與充分測試前，請勿用於管理正式環境中的真實資產。

## 功能亮點

- **非託管簽名**：私鑰不會進入後端，可透過 Ledger、MetaMask、WalletConnect 或 KeyVault QR 簽名。
- **EVM 與 Bitcoin 多簽**：支援 Safe、EIP-712、BIP 48、PSBT、P2WSH / P2SH-P2WSH 與 Electrum。
- **完整交易流程**：建立、簽名、廣播、取消、確認追蹤、中斷復原與 Safe Nonce 佇列。
- **收發交易歷史**：可依網路、收發類型、狀態、資產或本機標籤篩選 BTC / EVM 交易。
- **本機交易標籤**：標籤僅儲存在瀏覽器，不會寫入鏈上。
- **安全收款地址**：支援地址簿、快速新增，以及「僅允許向地址簿轉帳」偏好。
- **交易模擬**：使用 Tenderly 預覽 EVM 執行結果；憑證可在安全設定中配置並由後端加密儲存。
- **簽名地址管理**：匯入、註冊、驗證與撤銷簽名地址，提供裝置引導與多語言錯誤訊息。
- **KeyVault 動態 QR**：可使用攝影機掃描，或上傳錄製的動態 QR 影片。
- **資產與網路**：資產同步、ERC-20 匯入、自訂 EVM / BTC 網路與公開 RPC 探索。
- **個人化介面**：亮色、暗色、科技、駭客任務主題；支援五種介面語言。
- **備份與還原**：支援 JSON 匯出、驗證與匯入。

## 安全說明

- MultiVault 不儲存私鑰。
- 偏好設定與交易標籤保存在瀏覽器本機。
- Tenderly 模擬為選用功能；啟用後，待簽交易資料會傳送至 Tenderly。
- Tenderly 憑證會加密儲存，且不會回傳至瀏覽器。
- 簽名前請核對地址、金額、網路與硬體裝置畫面。

## 技術棧

| 層級 | 技術 |
|---|---|
| 後端 | Python 3.12+、FastAPI、SQLAlchemy 2 async、aiosqlite、Pydantic v2 |
| 前端 | React 19、TypeScript 5.9、Vite 7、Tailwind CSS 4、Zustand 5 |
| 錢包 SDK | `@multivault/wallet-connector` |
| 區塊鏈 | Web3.py 7、Safe、EIP-712、Multicall3、embit、PSBT、Electrum |
| 部署 | Docker Compose、Nginx |

## 快速開始

```bash
bash scripts/docker-up.sh
```

- 應用程式：http://localhost:3000
- 健康檢查：`curl -fsS http://localhost:3000/api/v1/health`
- 停止：`bash scripts/docker-down.sh`

本機開發需求：Node.js 20+、pnpm 9+、Python 3.12+、Poetry。

```bash
pnpm run bootstrap
pnpm run dev
```

## 常用命令

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm docker:up
pnpm docker:down
```

## 文件

- [文件索引](docs/README.md)
- [快速開始](docs/quickstart.md)
- [開發指南](docs/development.md)
- [系統架構](docs/architecture.md)
- [後端 API](apps/backend/docs/API.md)
- [前端指南](apps/frontend/README.md)
- [錢包 SDK](packages/wallet-connector/README.md)
- [更新日誌](CHANGELOG.md)

## 授權

MIT License，詳見 [LICENSE](LICENSE)。
