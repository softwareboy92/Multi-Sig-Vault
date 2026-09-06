# MultiVault — Backend

非托管多签钱包管理系统的后端服务，基于 **FastAPI + async SQLAlchemy + Pydantic v2**，支持 EVM (Safe) 与 Bitcoin (P2WSH / P2SH-P2WSH) 多签。

## 技术栈

| 分类 | 技术 |
|------|------|
| Web 框架 | FastAPI 0.115, Uvicorn |
| ORM / DB | SQLAlchemy 2 (async), aiosqlite, Alembic |
| 数据校验 | Pydantic v2, pydantic-settings |
| Bitcoin | embit (P2WSH / P2SH-P2WSH / PSBT), Electrum 协议 |
| Ethereum | Web3.py 7 (Safe 合约, EIP-712, Multicall3) |
| 日志 | structlog |
| 交易模拟 | Tenderly Simulation API (httpx) |
| HTTP 客户端 | httpx |
| 开发工具 | Ruff, mypy, pytest, pytest-asyncio |

## 前置要求

- Python 3.12+
- Poetry

## 快速启动

```bash
# 仓库根目录（推荐，一次性安装所有依赖）
pnpm run bootstrap

# 仅启动后端
pnpm run dev:backend

# 或在 apps/backend 目录下
poetry install
poetry run uvicorn multivault.main:app --reload --host 127.0.0.1 --port 8000
```

默认地址：http://127.0.0.1:8000
健康检查：http://127.0.0.1:8000/api/v1/health

> 不使用 Poetry 时须手动设置 `PYTHONPATH=./src`。

## 常用命令

```bash
# 开发模式（自动重载）
poetry run uvicorn multivault.main:app --reload --host 127.0.0.1 --port 8000

# 或使用 main 模块
poetry run python -m multivault.main

# 测试
poetry run pytest                                # 全部测试
poetry run pytest tests/unit/ -v                 # 单元测试
poetry run pytest tests/integration/ -v          # 集成测试
poetry run pytest -x -q --tb=short               # 快速运行（失败即停）
poetry run pytest --cov=multivault --cov-report=term-missing  # 覆盖率

# 代码质量
poetry run ruff check .                          # Lint
poetry run ruff format .                         # 格式化
poetry run mypy src/                             # 类型检查
```

## API 文档

开发模式 (`DEBUG=true`) 下自动启用：

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

详细 API 文档：[docs/API.md](docs/API.md)

## 项目结构

```
apps/backend/
├── pyproject.toml              # Poetry 依赖与工具配置
├── .env.example                # 环境变量模板
├── src/
│   └── multivault/
│       ├── main.py             # FastAPI 入口，lifespan（DB 初始化 + Worker 启动）
│       ├── config.py           # pydantic-settings 配置管理
│       ├── deps.py             # 依赖注入（DB session）
│       ├── api/                # API 路由层
│       │   ├── router.py       #   路由聚合与前缀配置
│       │   ├── system.py       #   /health, /chains
│       │   ├── pending.py      #   /pending-actions（聚合待处理项）
│       │   ├── networks.py     #   /networks/{chain_type}（网络 + 节点 CRUD）
│       │   ├── address_book.py #   /address-book（地址簿 CRUD）
│       │   ├── signers.py      #   /signers（签名设备管理）
│       │   ├── wallets.py      #   /wallets（钱包 CRUD + 部署 + 签名者）
│       │   ├── transactions.py #   /transactions（交易签名 / 广播 / 取消）
│       │   ├── simulation.py   #   /simulation（交易模拟 — Tenderly）
│       │   ├── assets.py       #   /wallets/{id}/assets（资产查询与同步）
│       │   └── backup.py       #   /backup（导出 / 验证 / 导入）
│       ├── schemas/            # Pydantic 请求/响应模式
│       │   ├── common.py       #   ApiResponse, PaginatedResponse, ErrorDetail
│       │   ├── signer.py
│       │   ├── wallet.py
│       │   ├── transaction.py
│       │   ├── asset.py
│       │   ├── network.py
│       │   ├── address_book.py
│       │   ├── simulation.py
│       │   └── backup.py
│       ├── models/             # SQLAlchemy ORM 模型
│       │   ├── base.py         #   引擎与 session 工厂
│       │   ├── signer.py       #   Signer, Challenge
│       │   ├── wallet.py       #   Wallet, WalletSigner
│       │   ├── transaction.py  #   Transaction, Signature
│       │   ├── asset.py        #   Asset
│       │   ├── network.py      #   NetworkConfig, NetworkNodeConfig
│       │   ├── simulation.py   #   TransactionSimulation
│       │   └── address_book.py #   AddressBookEntry
│       ├── services/           # 业务逻辑层
│       │   ├── signer_service.py  #   含 KeyVault challenge fallback 查找
│       │   ├── wallet_service.py
│       │   ├── transaction_service.py
│       │   ├── asset_service.py
│       │   ├── network_service.py
│       │   ├── simulation_service.py
│       │   └── backup_service.py
│       ├── chains/             # 链适配器
│       │   ├── base.py         #   ChainAdapter 抽象基类
│       │   ├── bitcoin/        #   Electrum 客户端, P2WSH / P2SH-P2WSH 地址, PSBT 构建
│       │   └── evm/            #   Web3 客户端, Safe 合约, Multicall3, Tenderly 模拟
│       ├── workers/            # 后台任务
│       │   ├── base.py         #   BaseWorker, WorkerManager
│       │   ├── expiry.py       #   交易过期检查
│       │   ├── sync.py         #   余额同步（EVM Multicall + BTC UTXO）
│       │   ├── evm_indexer.py  #   EVM Safe 事件索引 + 区块确认
│       │   ├── events.py       #   BTC 交易确认检查
│       │   └── nonce_sync.py   #   Safe Nonce 同步
│       ├── utils/              # 工具函数（地址解析、加密、链信息）
│       └── errors/             # 自定义异常
│           └── exceptions.py
├── tests/
│   ├── conftest.py             # Pytest fixtures（内存 DB）
│   ├── unit/                   # 单元测试（30+ 文件）
│   └── integration/            # 集成测试（完整工作流）
├── docs/
│   ├── API.md                  # 详细 API 文档
│   ├── API-CHANGELOG.md        # API 变更日志
│   ├── ARCHITECTURE.md         # 架构设计
│   └── openapi.yaml            # OpenAPI 规范
└── scripts/                    # 辅助脚本
```

## API 端点概览

所有端点以 `/api/v1` 为前缀。为向后兼容，`/v1/*` 会自动重写为 `/api/v1/*`。

### 系统 (System)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/chains` | 获取支持的链类型 |
| GET | `/pending-actions` | 聚合待处理项（待签名交易 + 待部署钱包） |

### 网络配置 (Networks)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/networks/{chain_type}` | 列出网络 |
| POST | `/networks/{chain_type}` | 创建网络 |
| POST | `/networks/{chain_type}/test` | 测试端点连通性 |
| GET | `/networks/{chain_type}/{id}` | 获取网络详情 |
| PUT | `/networks/{chain_type}/{id}` | 更新网络 |
| DELETE | `/networks/{chain_type}/{id}` | 删除网络 |
| POST | `/networks/{chain_type}/{id}/default-node` | 设置默认节点 |
| GET | `/networks/{chain_type}/{id}/nodes` | 列出节点 |
| POST | `/networks/{chain_type}/{id}/nodes` | 添加节点 |
| GET | `/networks/nodes/{node_id}` | 获取节点详情 |
| PUT | `/networks/nodes/{node_id}` | 更新节点 |
| DELETE | `/networks/nodes/{node_id}` | 删除节点 |
| POST | `/networks/nodes/{node_id}/test` | 测试节点连通性 |

### 地址簿 (AddressBook)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/address-book` | 列出地址 |
| POST | `/address-book` | 创建地址 |
| PUT | `/address-book/{id}` | 更新地址 |
| DELETE | `/address-book/{id}` | 删除地址 |

### 签名者 (Signers)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/signers/challenge` | 生成验证挑战 |
| POST | `/signers/keyvault/protocol` | 获取 KeyVault QR 协议载荷（含 challenge） |
| POST | `/signers` | 创建签名者 |
| GET | `/signers` | 列出签名者（分页） |
| GET | `/signers/{id}` | 获取详情 |
| PATCH | `/signers/{id}` | 更新名称 |
| POST | `/signers/{id}/verify` | 验证签名者 |
| POST | `/signers/{id}/revoke` | 撤销签名者 |
| DELETE | `/signers/{id}` | 软删除 |

### 钱包 (Wallets)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/wallets` | 创建多签钱包 |
| GET | `/wallets` | 列出钱包（分页） |
| GET | `/wallets/{id}` | 获取详情 |
| PATCH | `/wallets/{id}` | 更新名称 |
| DELETE | `/wallets/{id}` | 归档（软删除） |
| GET | `/wallets/{id}/signers` | 获取钱包签名者列表 |
| PATCH | `/wallets/{id}/signers/{signer_id}/hmac` | 更新 Ledger HMAC |
| GET | `/wallets/{id}/deployment` | 获取 Safe 部署信息 |
| POST | `/wallets/{id}/activate` | 激活已部署钱包 |
| POST | `/wallets/{id}/btc/history/import` | 导入 BTC 交易历史 |
| POST | `/wallets/{id}/policy-changes` | 创建 Safe 策略变更交易（EVM） |
| POST | `/wallets/{id}/sync-policy` | 从链上同步钱包策略（EVM） |

### 交易 (Transactions)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/wallets/{id}/transactions` | 创建交易 |
| GET | `/wallets/{id}/transactions` | 列出钱包交易（分页） |
| GET | `/wallets/{id}/transactions/nonce-queue` | 获取 Safe nonce 队列 |
| GET | `/transactions/{id}` | 获取交易详情 |
| POST | `/transactions/{id}/sign` | 提交签名 |
| GET | `/transactions/{id}/btc-signing-info` | 获取 BTC 签名信息 |
| GET | `/transactions/{id}/execution` | 获取 EVM Safe 执行数据 |
| POST | `/transactions/{id}/broadcast` | 标记 EVM 已广播 |
| GET | `/transactions/{id}/btc-execution` | 获取 BTC 最终交易数据 |
| POST | `/transactions/{id}/btc-broadcast` | 广播 BTC 交易 |
| GET | `/transactions/{id}/cancel-options` | 获取取消选项 |
| POST | `/transactions/{id}/cancel` | 取消交易 |

### 交易模拟 (Simulation)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/simulation/config` | 查询 Tenderly 是否已配置 |
| POST | `/simulation/transactions/{id}/simulate` | 触发交易模拟（Tenderly API） |
| GET | `/simulation/transactions/{id}/simulation` | 获取已有模拟结果 |

### 资产 (Assets)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/wallets/{id}/assets` | 获取资产列表 |
| POST | `/wallets/{id}/assets` | 添加 ERC20 代币 |
| POST | `/wallets/{id}/assets/sync` | 同步资产余额 |

### 备份与恢复 (Backup)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/backup/export` | 导出数据（JSON 下载） |
| POST | `/backup/validate` | 验证备份文件 |
| POST | `/backup/import` | 导入备份文件 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEBUG` | `false` | 启用调试模式（开启 Swagger / ReDoc） |
| `ENVIRONMENT` | `development` | 环境名称（development / staging / production） |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/multivault.db` | 数据库连接 URL |
| `DATABASE_ECHO` | `false` | SQL 日志输出 |
| `CORS_ORIGINS` | `http://localhost:3000,...` | CORS 允许的源（逗号分隔或 JSON 数组） |
| `SYNC_INTERVAL_SECONDS` | `60` | 余额同步间隔（秒） |
| `CHALLENGE_EXPIRY_SECONDS` | `300` | Challenge 过期时间（秒） |
| `DISABLE_BACKGROUND_WORKERS` | `false` | 禁用所有后台 Worker |
| `TENDERLY_ACCESS_KEY` | `""` | Tenderly API 访问密钥（交易模拟） |
| `TENDERLY_ACCOUNT_SLUG` | `""` | Tenderly 账户 slug |
| `TENDERLY_PROJECT_SLUG` | `""` | Tenderly 项目 slug |

> Bitcoin / EVM 网络配置已迁移到数据库，通过 `/api/v1/networks/{chain_type}` 管理。首次启动自动 seed 默认网络（Ethereum Mainnet / Sepolia / BSC / Polygon + Bitcoin Mainnet / Testnet3 / Testnet4）。每个 EVM 网络包含 `native_currency`（name / symbol / decimals）字段用于 EIP-3085 链添加；对已存在但缺失该字段的网络会自动 backfill。

在后端目录下创建 `.env` 文件覆盖默认配置，参见 [.env.example](.env.example)。

## 后台 Workers

应用启动时通过文件锁（`data/workers.lock`）确保同一时间只有一个进程运行 Workers，多实例部署时自动跳过。

| Worker | 说明 | 间隔 | 启动条件 |
|--------|------|------|----------|
| `BTCConfirmationWorker` | BTC 交易确认检查 | 事件驱动 | 存在已启用 BTC 网络 |
| `BalanceSyncWorker` | EVM 资产余额同步（Multicall） | 由 `SYNC_INTERVAL_SECONDS` 控制 | 每个已启用 EVM 网络 |
| `EVMEventIndexer` | EVM Safe 事件索引（含 confirmation_blocks 安全缓冲） | 15s | 每个已启用 EVM 网络 |
| `EVMBlockConfirmationWorker` | EVM 交易区块确认 | 30s | 每个已启用 EVM 网络 |
| `SafeNonceSyncWorker` | Safe nonce 链上同步 | 300s | 始终 |

## 架构分层

```
API (api/)  →  Service (services/)  →  Model (models/) + Chain Adapter (chains/)
    ↑                                        ↓
 Schemas (schemas/)                    Database (SQLite / PostgreSQL)
```

- **API 层**：路由定义、请求解析、响应封装，不含业务逻辑
- **Service 层**：核心业务逻辑、事务管理、跨链协调
- **Model 层**：SQLAlchemy ORM，使用 `selectinload` 预加载关联关系（避免 async lazy load）
- **Chain Adapter 层**：链交互抽象（Bitcoin Electrum / EVM Web3），可独立测试

## 许可证

MIT
