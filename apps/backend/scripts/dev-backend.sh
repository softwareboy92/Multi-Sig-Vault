#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONPATH="$ROOT_DIR/src"

HOST="${MULTIVAULT_HOST:-127.0.0.1}"
PORT="${MULTIVAULT_PORT:-8000}"

if ! command -v poetry >/dev/null 2>&1; then
	echo "Error: poetry is not installed" >&2
	exit 1
fi

if ! poetry run python -c "import structlog; import multivault.main" >/dev/null 2>&1; then
	echo "Backend dependencies are not installed; running 'poetry install'..." >&2
	poetry install
fi
poetry run uvicorn multivault.main:app --reload --host "$HOST" --port "$PORT"