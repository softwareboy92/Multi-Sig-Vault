# MultiVault — Frontend

非托管多签钱包管理系统的 Web 前端，基于 **React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4**。

## 技术栈

| 分类 | 技术 |
|------|------|
| 框架 | React 19, TypeScript 5.9 |
| 构建 | Vite 7 |
| 样式 | Tailwind CSS 4, CSS Variables（主题） |
| 状态管理 | Zustand 5 |
| 路由 | react-router-dom 7 |
| 钱包 SDK | `@multivault/wallet-connector`（workspace 内包） |
| 国际化 | 自研轻量 i18n（中文 / English） |
| 代码质量 | ESLint 9, TypeScript strict |

## 前置要求

- Node.js 20+
- pnpm 9+
- 后端服务运行在 `http://localhost:8000`（开发环境自动代理 `/api`）

## 快速启动

```bash
# 仓库根目录执行（推荐，一次性安装所有依赖）
pnpm run bootstrap

# 仅启动前端开发服务器
pnpm run dev:frontend

# 或在 apps/frontend 目录下
pnpm dev
```

默认开发地址：http://localhost:3001

## 常用命令

```bash
pnpm dev              # 启动开发服务器（port 3001）
pnpm build            # 生产构建
pnpm build:with-typecheck  # 类型检查 + 生产构建
pnpm typecheck        # 仅类型检查（tsc --noEmit）
pnpm lint             # ESLint 检查
pnpm preview          # 预览生产构建
pnpm clean            # 清理 dist 与 Vite 缓存
```

## 项目结构

```
apps/frontend/
├── public/                    # 静态资源
├── src/
│   ├── api/                   # 后端 API 客户端
│   │   ├── client.ts          #   Fetch 封装（base URL、错误处理）
│   │   ├── wallets.ts         #   钱包 CRUD & 部署
│   │   ├── transactions.ts    #   交易创建、签名、广播
│   │   ├── signers.ts         #   签名地址管理
│   │   ├── keyvault.ts        #   KeyVault QR 协议载荷与签名 Payload
│   │   ├── networks.ts        #   链与节点配置
│   │   ├── addressBook.ts     #   地址簿
│   │   ├── backup.ts          #   备份与恢复
│   │   ├── simulation.ts      #   交易模拟（Tenderly）
│   │   └── pending.ts         #   待处理项
│   ├── components/
│   │   ├── ui/                # 通用 UI 组件库
│   │   │   ├── Button / Card / Modal / Drawer / Table ...
│   │   │   ├── PageShell      #   页面容器（统一 max-width + padding）
│   │   │   ├── PageHeader     #   页面标题栏
│   │   │   ├── PageToolbar    #   页面工具栏（搜索、筛选、操作）
│   │   │   └── EmptyState     #   空状态占位
│   │   ├── layout/            # 布局组件（Layout, Sidebar, Topbar, TodoDrawer）
│   │   ├── wallet/            # 钱包相关业务组件（PolicyTab、AddOwnerModal 等 Safe 策略管理）
│   │   ├── Transaction/       # 交易相关业务组件（ActionBar, SimulationSection, SimulationResultPanel）
│   │   ├── transactions/      # 交易列表相关业务组件
│   │   ├── networks/          # 网络配置组件（NetworkNodeCard、NetworksPageShell、ImportRpcModal）
│   │   ├── settings/          # 设置页组件
│   │   └── SignatureAddress/  # 签名地址（Signer）组件
│   ├── hooks/                 # 自定义 Hooks
│   │   ├── useWalletConnection  # 钱包连接（Ledger/MetaMask/WalletConnect/KeyVault）+ EIP-3085 链添加
│   │   ├── useWalletDetail      # 钱包详情数据加载
│   │   ├── useDeployFlow        # Safe 钱包部署流程
│   │   ├── useSimulation        # 交易模拟状态管理（Tenderly）
│   │   ├── useTranslation       # i18n hook
│   │   └── useAdaptivePageSize  # 自适应分页
│   ├── stores/                # Zustand 状态管理
│   │   ├── useNetworkStore      # 网络列表与选中状态
│   │   ├── useSyncStore         # 全局同步（资产、余额）
│   │   ├── useTodoStore         # 待处理项（待签名 / 待部署）
│   │   ├── useThemeStore        # 亮色 / 暗色主题
│   │   ├── useLanguageStore     # 语言切换
│   │   ├── usePreferenceStore   # 用户偏好设置
│   │   └── useToastStore        # Toast 通知
│   ├── services/              # 业务服务层
│   │   └── chainRegistry.ts   #   chainid.network 注册表查询（EIP-3085、Safe v1.4.1 部署检查、公开 RPC 发现）
│   ├── i18n/                  # 国际化
│   │   └── translations/
│   │       ├── en.ts          #   English
│   │       └── zh-CN.ts       #   简体中文
│   ├── pages/                 # 页面组件（路由级）
│   ├── types/                 # TypeScript 类型定义
│   ├── utils/                 # 工具函数（地址截断、EIP-3085 链参数构建、策略标签等）
│   ├── App.tsx                # 路由配置
│   └── main.tsx               # 应用入口
├── index.html
├── vite.config.ts             # Vite 配置（代理、别名、构建）
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## 架构概要

### 路由与页面

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | EntryPage | 产品介绍首页 |
| `/wallets` | WalletPage | 钱包列表 |
| `/wallets/:id` | WalletDetailPage | 钱包详情 |
| `/wallets/:id/assets` | WalletAssetsPage | 钱包资产 |
| `/wallets/create` | CreateWalletPage | 创建钱包 |
| `/assets` | AssetsPage | 资产总览 |
| `/assets/:id` | AssetDetailPage | 资产详情 |
| `/transactions` | TransactionsPage | 交易列表 |
| `/transactions/:id` | TransactionDetailPage | 交易详情 |
| `/history` | HistoryPage | 历史记录 |
| `/addresses` | AddressPage | 地址簿 |
| `/signers` | SignatureAddressPage | 签名地址管理 |
| `/signers/:id` | SignatureAddressDetailPage | 签名地址详情 |
| `/signers/import` | SignatureAddressImportPage | 导入签名地址 |
| `/networks/evm` | EVMNetworksPage | EVM 网络配置 |
| `/networks/btc` | BTCNetworksPage | BTC 网络配置 |
| `/settings` | SettingsPage | 系统设置 |

### 状态管理

使用 Zustand 5，按职责拆分为独立 Store。各 Store 间无直接依赖，通过页面组件组合使用。Store 数据持久化采用 `localStorage`（偏好类）或仅内存持有（业务数据从 API 获取）。

### API 层

`src/api/client.ts` 封装统一的 Fetch 客户端，所有请求走 `/api/v1` 前缀。开发环境由 Vite 代理转发至后端 `http://localhost:8000`。

### 主题系统

通过 CSS Variables 实现亮色/暗色主题切换，变量定义在 `src/index.css`。所有组件使用 `var(--xxx)` 引用颜色，Tailwind 作为布局工具使用。

### 国际化

自研轻量 i18n 方案，翻译文件位于 `src/i18n/translations/`。支持参数插值（`{name}` 语法），通过 `useTranslation()` hook 获取 `t()` 函数。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_BASE_URL` | `/api/v1` | 后端 API 基础路径 |

## 生产部署

生产构建产物在 `dist/` 目录，可由 Nginx 或类似静态服务器托管。项目根目录的 `docker-compose.yml` 已配置 Nginx 容器，将前端静态文件和 API 代理整合。

```bash
pnpm build
# dist/ 目录即可部署
```

Docker 部署参见根目录 [README.md](../../README.md)。

## 代码规范

- 路径别名：`@/` 映射到 `src/`
- 组件：函数式组件 + Hooks，无 class 组件
- 样式：Tailwind utility-first + CSS Variables，不使用 CSS Modules
- 命名：组件 PascalCase，文件与组件同名；hooks `use` 前缀；stores `use` 前缀 + `Store` 后缀
- i18n：所有用户可见文本必须走 `t()` 函数，禁止硬编码中文/英文
- 代码/注释/标识符使用 English，文档正文使用中文
