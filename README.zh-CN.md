# MultiVault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Stage: Alpha](https://img.shields.io/badge/Stage-Alpha-orange.svg)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![Node 20+](https://img.shields.io/badge/node-20+-green.svg)](https://nodejs.org/)

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

MultiVault 是一个非托管、本地优先的多签钱包管理系统，支持 EVM Safe 与 Bitcoin P2WSH / P2SH-P2WSH 钱包。

> **⚠️ 项目状态：Alpha**
>
> API、数据库结构和配置格式仍可能发生变化。在完成独立审查和充分测试前，请勿用于管理生产环境中的真实资产。

## 功能亮点

- **非托管签名**：私钥不会进入后端，可通过 Ledger、MetaMask、WalletConnect 或 KeyVault 二维码完成签名。
- **EVM 与 Bitcoin 多签**：支持 EVM Safe、EIP-712，以及 Bitcoin BIP 48、PSBT、P2WSH / P2SH-P2WSH 和 Electrum。
- **完整交易生命周期**：创建、签名、广播、取消、确认跟踪、中断恢复和 Safe Nonce 队列管理。
- **收发交易历史**：同步 BTC / EVM 交易，并按照网络、收发类型、状态、资产或本地标签筛选。
- **本地交易标签**：创建并分配仅保存在浏览器本地的标签，不会写入链上。
- **更安全的收款地址**：支持地址簿、无地址时快捷添加，以及“仅允许向地址簿转账”安全偏好。
- **交易模拟**：通过 Tenderly 预览 EVM 执行结果和资产变化；可直接在安全设置中配置，API Key 由后端在本地加密保存。
- **签名地址管理**：导入、注册、验证和撤销签名地址，并提供针对不同设备的交互提示与多语言错误信息。
- **KeyVault 动态二维码**：支持摄像头扫描；电脑无摄像头时，可上传录制的动态二维码视频进行解析。
- **资产与网络管理**：同步资产、导入 ERC-20、自定义 EVM / BTC 网络，以及发现公开 EVM RPC。
- **个性化界面**：亮色、暗色、科技、黑客帝国四套主题；支持简中、繁中、英文、日文和韩文。
- **备份与恢复**：支持 JSON 数据导出、校验和导入。

## 安全说明

- MultiVault 不存储私钥。
- 偏好设置和交易标签保存在浏览器本地。
- Tenderly 模拟是可选功能；启用后，待签交易数据会发送至 Tenderly。
- 在安全设置中保存的 Tenderly 凭据会加密落盘，且不会回传至浏览器。
- 签名前请始终核对收款地址、金额、网络和硬件设备屏幕。

## 技术栈

| 层级 | 技术 |
|---|---|
| 后端 | Python 3.12+、FastAPI、SQLAlchemy 2 async、aiosqlite、Pydantic v2 |
| 前端 | React 19、TypeScript 5.9、Vite 7、Tailwind CSS 4、Zustand 5 |
| 钱包 SDK | `@multivault/wallet-connector` |
| 区块链 | Web3.py 7、Safe、EIP-712、Multicall3、embit、PSBT、Electrum |
| 部署 | Docker Compose、Nginx |

## 快速开始

### Docker（推荐）

```bash
bash scripts/docker-up.sh
```

启动后：

- 应用：http://localhost:3001
- 健康检查：`curl -fsS http://localhost:3001/api/v1/health`
- 停止：`bash scripts/docker-down.sh`

如果 Docker Hub 无法访问，可覆盖基础镜像：

```bash
export PYTHON_IMAGE=<mirror>/library/python:3.12-slim-bookworm
export NODE_IMAGE=<mirror>/library/node:20-alpine
export NGINX_IMAGE=<mirror>/library/nginx:1.27-alpine
bash scripts/docker-up.sh
```

### 本地开发

前置要求：Node.js 20+、pnpm 9+、Python 3.12+、Poetry。

```bash
pnpm run bootstrap
pnpm run dev
```

- 前端：http://localhost:3001
- 后端 API：http://127.0.0.1:8000/api/v1
- 日志：`logs/backend.log`、`logs/frontend.log`

## 常用命令

```bash
pnpm test              # SDK + 后端测试
pnpm test:backend      # 后端测试
pnpm test:sdk          # 钱包 SDK 测试
pnpm lint              # 前端 + SDK 代码检查
pnpm typecheck         # TypeScript 类型检查
pnpm build             # 构建 SDK + 前端
pnpm docker:up         # 启动 Docker 服务
pnpm docker:down       # 停止 Docker 服务
```

## 仓库结构

```text
apps/
  backend/             FastAPI 服务、链适配器、后台任务和测试
  frontend/            React 应用、UI 组件、状态管理和多语言
packages/
  wallet-connector/    Ledger、MetaMask、WalletConnect、KeyVault 适配器
docs/                  架构与开发文档
scripts/               开发和部署脚本
```

## 文档

- [文档索引](docs/README.md)
- [快速开始](docs/quickstart.md)
- [开发指南](docs/development.md)
- [系统架构](docs/architecture.md)
- [后端 API](apps/backend/docs/API.md)
- [后端指南](apps/backend/README.md)
- [前端指南](apps/frontend/README.md)
- [钱包 SDK](packages/wallet-connector/README.md)
- [更新日志](CHANGELOG.md)

## 许可证

MIT License，详见 [LICENSE](LICENSE)。
