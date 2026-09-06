#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "🔎 Checking Docker daemon..."
python3 - <<'PY'
import subprocess
import sys

try:
	subprocess.run(
		["docker", "info"],
		stdout=subprocess.DEVNULL,
		stderr=subprocess.PIPE,
		timeout=5,
		check=True,
	)
except subprocess.TimeoutExpired:
	print(
		"Docker is not responding (timeout). Start Docker Desktop and retry.",
		file=sys.stderr,
	)
	sys.exit(1)
except subprocess.CalledProcessError as exc:
	stderr = exc.stderr.decode(errors="ignore").strip()
	print(stderr or "Docker is not available. Start Docker Desktop and retry.", file=sys.stderr)
	sys.exit(1)
else:
	print("OK")
PY

# Ensure .env exists so docker compose can read optional overrides
if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "📄 No .env found — creating one from .env.example defaults..."
  cat > "$ROOT_DIR/.env" <<'ENV'
# Docker deployment defaults (auto-generated from docker-up.sh)
# Override base images if Docker Hub is slow / unreachable:
# PYTHON_IMAGE=mirror/library/python:3.12-slim-bookworm
# NODE_IMAGE=mirror/library/node:20-alpine
# NGINX_IMAGE=mirror/library/nginx:1.27-alpine
ENV
fi

echo ""
echo "🏗️  Building images (plain progress)..."
echo "If Docker Hub is slow/unreachable, override base images via env vars, e.g.:"
echo "  PYTHON_IMAGE=<mirror>/library/python:3.12-slim-bookworm"
echo "  NODE_IMAGE=<mirror>/library/node:20-alpine"
echo "  NGINX_IMAGE=<mirror>/library/nginx:1.27-alpine"
echo ""
docker compose --progress=plain build

echo "🚀 Starting containers..."
docker compose up -d

echo "✅ MultiVault is starting..."
echo "Frontend: http://localhost:3001"
echo "Backend:  internal only (no host port)"

echo ""
docker compose ps

echo ""
echo "If something looks wrong:"
echo "  docker compose logs -f --tail=200"
