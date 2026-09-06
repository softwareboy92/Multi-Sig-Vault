# MultiVault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Stage: Alpha](https://img.shields.io/badge/Stage-Alpha-orange.svg)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語** | [한국어](README.ko.md)

MultiVault は、EVM Safe と Bitcoin P2WSH / P2SH-P2WSH に対応した、ノンカストディアルかつローカルファーストなマルチシグウォレット管理システムです。

> **⚠️ プロジェクトの状態：Alpha**
>
> API、データベーススキーマ、設定形式は予告なく変更される場合があります。独自のレビューと十分なテストを行うまでは、本番資産の管理に使用しないでください。

## 主な機能

- **ノンカストディアル署名**：秘密鍵はバックエンドに送信されません。Ledger、MetaMask、WalletConnect、KeyVault QR に対応します。
- **EVM / Bitcoin マルチシグ**：Safe、EIP-712、BIP 48、PSBT、P2WSH / P2SH-P2WSH、Electrum に対応します。
- **取引ライフサイクル**：作成、署名、ブロードキャスト、キャンセル、確認追跡、中断復旧、Safe Nonce キューを管理します。
- **送受信履歴**：ネットワーク、送受信種別、状態、資産、ローカルタグで BTC / EVM 取引を絞り込めます。
- **ローカル取引タグ**：タグはブラウザ内に保存され、オンチェーンには公開されません。
- **安全な送金先**：アドレス帳、クイック追加、アドレス帳限定送金に対応します。
- **取引シミュレーション**：Tenderly で EVM 実行結果を事前確認できます。認証情報はセキュリティ設定で構成し、暗号化して保存します。
- **署名アドレス管理**：署名者のインポート、登録、検証、失効と、デバイス別ガイダンスに対応します。
- **KeyVault 動的 QR**：カメラでのスキャンに加え、録画した QR 動画のアップロードにも対応します。
- **資産とネットワーク**：残高同期、ERC-20 インポート、EVM / BTC カスタムネットワーク、公開 RPC 検出を提供します。
- **表示設定**：ライト、ダーク、テック、マトリックスのテーマと、5 言語に対応します。
- **バックアップ**：JSON のエクスポート、検証、インポートに対応します。

## セキュリティ

- MultiVault は秘密鍵を保存しません。
- 設定と取引タグはブラウザのローカルストレージに保存されます。
- Tenderly シミュレーションは任意です。有効化すると未署名取引データが Tenderly に送信されます。
- Tenderly 認証情報は暗号化して保存され、ブラウザには返されません。
- 署名前に送金先、金額、ネットワーク、デバイス画面を確認してください。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| Backend | Python 3.12+、FastAPI、SQLAlchemy 2 async、aiosqlite、Pydantic v2 |
| Frontend | React 19、TypeScript 5.9、Vite 7、Tailwind CSS 4、Zustand 5 |
| Wallet SDK | `@multivault/wallet-connector` |
| Blockchain | Web3.py 7、Safe、EIP-712、Multicall3、embit、PSBT、Electrum |
| Deployment | Docker Compose、Nginx |

## クイックスタート

```bash
bash scripts/docker-up.sh
```

- アプリ：http://localhost:3000
- ヘルスチェック：`curl -fsS http://localhost:3000/api/v1/health`
- 停止：`bash scripts/docker-down.sh`

ローカル開発には Node.js 20+、pnpm 9+、Python 3.12+、Poetry が必要です。

```bash
pnpm run bootstrap
pnpm run dev
```

## コマンド

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm docker:up
pnpm docker:down
```

## ドキュメント

- [ドキュメント一覧](docs/README.md)
- [クイックスタート](docs/quickstart.md)
- [開発ガイド](docs/development.md)
- [アーキテクチャ](docs/architecture.md)
- [Backend API](apps/backend/docs/API.md)
- [Frontend guide](apps/frontend/README.md)
- [Wallet SDK](packages/wallet-connector/README.md)
- [変更履歴](CHANGELOG.md)

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
