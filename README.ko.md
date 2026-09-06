# MultiVault

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Stage: Alpha](https://img.shields.io/badge/Stage-Alpha-orange.svg)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **한국어**

MultiVault는 EVM Safe와 Bitcoin P2WSH / P2SH-P2WSH 지갑을 지원하는 비수탁형 로컬 우선 다중 서명 지갑 관리 시스템입니다.

> **⚠️ 프로젝트 상태: Alpha**
>
> API, 데이터베이스 스키마 및 설정 형식은 예고 없이 변경될 수 있습니다. 독립적인 검토와 충분한 테스트 전에는 실제 운영 자산을 관리하는 데 사용하지 마세요.

## 주요 기능

- **비수탁형 서명**: 개인 키는 백엔드로 전달되지 않습니다. Ledger, MetaMask, WalletConnect, KeyVault QR을 지원합니다.
- **EVM / Bitcoin 다중 서명**: Safe, EIP-712, BIP 48, PSBT, P2WSH / P2SH-P2WSH, Electrum을 지원합니다.
- **전체 거래 흐름**: 생성, 서명, 브로드캐스트, 취소, 확인 추적, 중단 복구 및 Safe Nonce 대기열을 관리합니다.
- **송수신 거래 내역**: 네트워크, 송수신 유형, 상태, 자산 또는 로컬 태그로 BTC / EVM 거래를 필터링합니다.
- **로컬 거래 태그**: 태그는 브라우저에만 저장되며 온체인에 공개되지 않습니다.
- **안전한 수신 주소**: 주소록, 빠른 주소 추가 및 주소록 전용 전송 설정을 제공합니다.
- **거래 시뮬레이션**: Tenderly로 EVM 실행 결과를 미리 확인합니다. 자격 증명은 보안 설정에서 구성하고 암호화하여 저장합니다.
- **서명 주소 관리**: 서명자 가져오기, 등록, 검증, 해제와 장치별 안내를 지원합니다.
- **KeyVault 동적 QR**: 카메라 스캔과 녹화된 QR 동영상 업로드를 지원합니다.
- **자산 및 네트워크**: 잔액 동기화, ERC-20 가져오기, EVM / BTC 사용자 지정 네트워크, 공개 RPC 검색을 제공합니다.
- **개인화 UI**: 라이트, 다크, 테크, 매트릭스 테마와 5개 언어를 지원합니다.
- **백업 및 복원**: JSON 내보내기, 검증 및 가져오기를 지원합니다.

## 보안 안내

- MultiVault는 개인 키를 저장하지 않습니다.
- 환경 설정과 거래 태그는 브라우저 로컬 저장소에 보관됩니다.
- Tenderly 시뮬레이션은 선택 기능입니다. 활성화하면 서명 전 거래 데이터가 Tenderly로 전송됩니다.
- Tenderly 자격 증명은 암호화되어 저장되며 브라우저에 반환되지 않습니다.
- 서명 전에 수신 주소, 금액, 네트워크 및 하드웨어 장치 화면을 확인하세요.

## 기술 스택

| 계층 | 기술 |
|---|---|
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2 async, aiosqlite, Pydantic v2 |
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Zustand 5 |
| Wallet SDK | `@multivault/wallet-connector` |
| Blockchain | Web3.py 7, Safe, EIP-712, Multicall3, embit, PSBT, Electrum |
| Deployment | Docker Compose, Nginx |

## 빠른 시작

```bash
bash scripts/docker-up.sh
```

- 앱: http://localhost:3000
- 상태 확인: `curl -fsS http://localhost:3000/api/v1/health`
- 중지: `bash scripts/docker-down.sh`

로컬 개발에는 Node.js 20+, pnpm 9+, Python 3.12+, Poetry가 필요합니다.

```bash
pnpm run bootstrap
pnpm run dev
```

## 주요 명령어

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm docker:up
pnpm docker:down
```

## 문서

- [문서 색인](docs/README.md)
- [빠른 시작](docs/quickstart.md)
- [개발 가이드](docs/development.md)
- [아키텍처](docs/architecture.md)
- [Backend API](apps/backend/docs/API.md)
- [Frontend guide](apps/frontend/README.md)
- [Wallet SDK](packages/wallet-connector/README.md)
- [변경 기록](CHANGELOG.md)

## 라이선스

MIT License. 자세한 내용은 [LICENSE](LICENSE)을 참조하세요.
