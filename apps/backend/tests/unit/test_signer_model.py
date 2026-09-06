"""Tests for Signer model."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus


@pytest.mark.asyncio
async def test_create_signer(async_session: AsyncSession):
    """Test creating a signer in database."""
    signer = Signer(
        name="Test Ledger",
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.BTC,
        public_key="02" + "a" * 64,
        derivation_path="m/48'/0'/0'/2'",
    )

    async_session.add(signer)
    await async_session.commit()
    await async_session.refresh(signer)

    assert signer.id is not None
    assert signer.name == "Test Ledger"
    assert signer.status == SignerStatus.UNVERIFIED
    assert signer.is_verified is False
    assert signer.created_at is not None


@pytest.mark.asyncio
async def test_signer_identifier_property(async_session: AsyncSession):
    """Test signer identifier returns address or public_key."""
    # Signer with address
    signer1 = Signer(
        name="EVM Signer",
        device_type=DeviceType.METAMASK,
        chain_type=ChainType.EVM,
        address="0x" + "a" * 40,
    )

    # Signer with public_key only
    signer2 = Signer(
        name="BTC Signer",
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.BTC,
        public_key="02" + "b" * 64,
    )

    async_session.add_all([signer1, signer2])
    await async_session.commit()

    assert signer1.identifier == "0x" + "a" * 40
    assert signer2.identifier == "02" + "b" * 64


@pytest.mark.asyncio
async def test_signer_status_transitions(async_session: AsyncSession):
    """Test signer status changes."""
    from datetime import UTC, datetime

    signer = Signer(
        name="Verification Test",
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.BTC,
        public_key="02" + "c" * 64,
    )

    async_session.add(signer)
    await async_session.commit()

    # Initially unverified
    assert signer.status == SignerStatus.UNVERIFIED
    assert signer.is_verified is False

    # Verify the signer
    signer.status = SignerStatus.VERIFIED
    signer.verified_at = datetime.now(UTC)
    await async_session.commit()
    await async_session.refresh(signer)

    assert signer.status == SignerStatus.VERIFIED
    assert signer.is_verified is True
    assert signer.verified_at is not None
