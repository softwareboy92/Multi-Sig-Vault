#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "[bootstrap] Checking prerequisites..."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is not installed" >&2
  exit 1
fi

if ! command -v poetry >/dev/null 2>&1; then
  echo "Error: poetry is not installed" >&2
  echo "Install Poetry first, then re-run: bash scripts/bootstrap.sh" >&2
  exit 1
fi

echo "[bootstrap] Installing Node.js dependencies (pnpm install)..."
pnpm install

echo "[bootstrap] Installing backend Python dependencies (poetry install)..."
(
  cd apps/backend
  poetry install
)

echo "[bootstrap] Building wallet-connector SDK..."
pnpm build:sdk

echo "[bootstrap] Done. Start dev servers with: pnpm run dev"
