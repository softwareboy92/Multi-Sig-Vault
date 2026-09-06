"""Application configuration management."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

import json

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "MultiVault"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: Literal["development", "staging", "production"] = "development"

    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    # Database
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/multivault.db",
        description="SQLAlchemy async database URL",
    )
    database_echo: bool = False

    # CORS (for development)
    cors_origins_raw: str = Field(
        default=(
            "http://localhost:3000,"
            "http://localhost:5173,"
            "http://localhost:5174,"
            "http://localhost:5175"
        ),
        validation_alias="CORS_ORIGINS",
    )

    # Bitcoin and EVM network configurations are now stored in database
    # See EVMNetworkConfig, EVMRpcNodeConfig, BTCNetworkConfig, BTCNodeConfig models

    # Background Workers
    sync_interval_seconds: int = 60

    # Price cache
    price_cache_ttl_seconds: int = 180

    # Challenge verification
    challenge_expiry_seconds: int = 300

    # KeyVault RSA signing (for QR protocol verification)
    keyvault_rsa_private_key_path: str = Field(
        default="",
        description="Path to PEM file (or base64-encoded PEM) for KeyVault RSA signing",
    )

    # Tenderly Simulation API
    tenderly_access_key: str = Field(
        default="",
        description="Tenderly API access key for transaction simulation",
    )
    tenderly_account_slug: str = Field(
        default="",
        description="Tenderly account slug (organization or username)",
    )
    tenderly_project_slug: str = Field(
        default="",
        description="Tenderly project slug",
    )

    @property
    def tenderly_configured(self) -> bool:
        """Whether Tenderly simulation is available."""
        return bool(
            self.tenderly_access_key
            and self.tenderly_account_slug
            and self.tenderly_project_slug
        )

    @property
    def data_dir(self) -> Path:
        """Get data directory path, creating if needed."""
        path = Path("./data")
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cors_origins(self) -> list[str]:
        raw = (self.cors_origins_raw or "").strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except json.JSONDecodeError:
            pass
        return [item.strip() for item in raw.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
