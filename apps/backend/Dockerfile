ARG PYTHON_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_IMAGE}

ENV POETRY_VERSION=1.8.4 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
        apt-get update -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 \
        && apt-get install -y --no-install-recommends --fix-missing build-essential curl ca-certificates \
        && break; \
        echo "apt-get failed on attempt ${attempt}, retrying..."; \
        rm -rf /var/lib/apt/lists/*; \
        sleep 5; \
    done; \
    pip install --no-cache-dir poetry==${POETRY_VERSION}; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/backend/pyproject.toml apps/backend/poetry.lock ./
RUN poetry config virtualenvs.create false \
    && poetry install --only main --no-interaction --no-ansi --no-root

COPY apps/backend/src ./src

# Install the project package so `multivault` is importable without PYTHONPATH
RUN poetry install --only main --no-interaction --no-ansi

ENV PYTHONPATH=/app/src

EXPOSE 8000

CMD ["sh", "-c", "uvicorn multivault.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-2}"]
