"""Tests for encrypted Tenderly security settings."""

from pathlib import Path

from multivault.services.simulation_config_service import SimulationConfigService


def test_tenderly_credentials_are_encrypted_at_rest(tmp_path: Path):
    service = SimulationConfigService(data_dir=tmp_path)

    saved = service.save(
        access_key="tenderly-secret-key",
        account_slug="my-account",
        project_slug="my-project",
        enabled=True,
    )

    assert saved.configured is True
    raw = service.config_path.read_bytes()
    assert b"tenderly-secret-key" not in raw
    assert b"my-account" not in raw
    assert service.config_path.stat().st_mode & 0o777 == 0o600
    assert service.key_path.stat().st_mode & 0o777 == 0o600

    loaded = service.get_credentials()
    assert loaded.access_key == "tenderly-secret-key"
    assert loaded.account_slug == "my-account"
    assert loaded.project_slug == "my-project"
    assert loaded.source == "settings"


def test_blank_api_key_preserves_existing_secret(tmp_path: Path):
    service = SimulationConfigService(data_dir=tmp_path)
    service.save(
        access_key="existing-secret",
        account_slug="account",
        project_slug="project",
        enabled=True,
    )

    updated = service.save(
        access_key="",
        account_slug="updated-account",
        project_slug="updated-project",
        enabled=True,
    )

    assert updated.access_key == "existing-secret"
    assert updated.account_slug == "updated-account"
