"""Secure runtime configuration for the Tenderly simulation integration."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from multivault.config import get_settings
from multivault.errors.exceptions import ValidationError


@dataclass(frozen=True)
class TenderlyCredentials:
    access_key: str
    account_slug: str
    project_slug: str
    enabled: bool
    source: str

    @property
    def configured(self) -> bool:
        return bool(
            self.enabled
            and self.access_key
            and self.account_slug
            and self.project_slug
        )


class SimulationConfigService:
    """Store Tenderly credentials encrypted in the backend data directory."""

    CONFIG_FILE = "tenderly-settings.enc"
    KEY_FILE = "settings-encryption.key"

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or get_settings().data_dir
        self.config_path = self.data_dir / self.CONFIG_FILE
        self.key_path = self.data_dir / self.KEY_FILE

    def get_credentials(self) -> TenderlyCredentials:
        stored = self._read_stored()
        if stored is not None:
            return TenderlyCredentials(
                access_key=str(stored.get("access_key", "")).strip(),
                account_slug=str(stored.get("account_slug", "")).strip(),
                project_slug=str(stored.get("project_slug", "")).strip(),
                enabled=bool(stored.get("enabled", False)),
                source="settings",
            )

        settings = get_settings()
        return TenderlyCredentials(
            access_key=settings.tenderly_access_key.strip(),
            account_slug=settings.tenderly_account_slug.strip(),
            project_slug=settings.tenderly_project_slug.strip(),
            enabled=settings.tenderly_configured,
            source="environment" if settings.tenderly_configured else "none",
        )

    def save(
        self,
        *,
        access_key: str | None,
        account_slug: str,
        project_slug: str,
        enabled: bool,
    ) -> TenderlyCredentials:
        current = self.get_credentials()
        normalized_key = (access_key or "").strip() or current.access_key
        normalized_account = account_slug.strip()
        normalized_project = project_slug.strip()

        if enabled and not (normalized_key and normalized_account and normalized_project):
            raise ValidationError(
                message="Tenderly API key, account, and project are required",
                details={
                    "access_key": bool(normalized_key),
                    "account_slug": bool(normalized_account),
                    "project_slug": bool(normalized_project),
                },
            )

        payload = {
            "access_key": normalized_key,
            "account_slug": normalized_account,
            "project_slug": normalized_project,
            "enabled": enabled,
        }
        self.data_dir.mkdir(parents=True, exist_ok=True)
        encrypted = self._get_fernet(create=True).encrypt(
            json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        )
        temp_path = self.config_path.with_suffix(".tmp")
        temp_path.write_bytes(encrypted)
        os.chmod(temp_path, 0o600)
        temp_path.replace(self.config_path)
        os.chmod(self.config_path, 0o600)

        return TenderlyCredentials(
            access_key=normalized_key,
            account_slug=normalized_account,
            project_slug=normalized_project,
            enabled=enabled,
            source="settings",
        )

    def _read_stored(self) -> dict[str, object] | None:
        if not self.config_path.exists():
            return None
        try:
            decrypted = self._get_fernet(create=False).decrypt(
                self.config_path.read_bytes(),
            )
            parsed = json.loads(decrypted.decode("utf-8"))
            return parsed if isinstance(parsed, dict) else None
        except (InvalidToken, OSError, ValueError, json.JSONDecodeError) as exc:
            raise ValidationError(
                message="Stored simulation security settings could not be read",
                details={"reason": type(exc).__name__},
            ) from exc

    def _get_fernet(self, *, create: bool) -> Fernet:
        if self.key_path.exists():
            return Fernet(self.key_path.read_bytes().strip())
        if not create:
            raise ValidationError(
                message="Simulation settings encryption key is missing",
            )

        self.data_dir.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        self.key_path.write_bytes(key)
        os.chmod(self.key_path, 0o600)
        return Fernet(key)
