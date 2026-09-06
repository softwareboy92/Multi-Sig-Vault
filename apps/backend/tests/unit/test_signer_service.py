"""Tests for Signer service."""

from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.errors.exceptions import ConflictError, NotFoundError, ValidationError
from multivault.models.signer import SignerStatus
from multivault.schemas.signer import (
    ChainTypeEnum,
    DeviceTypeEnum,
    SignerCreate,
    SignerQueryParams,
    SignerUpdate,
)
from multivault.services.signer_service import SignerService


@pytest.fixture
def signer_service(async_session: AsyncSession) -> SignerService:
    """Create signer service with test session."""
    return SignerService(async_session)

@pytest.fixture
async def create_db_signer(async_session: AsyncSession):
    """Helper to create signers directly in DB bypassing verification."""
    from multivault.models.signer import Signer, ChainType, DeviceType, SignerStatus
    from datetime import datetime, UTC
    
    async def _create(name: str, chain_type: ChainTypeEnum, 
                     address: str = None, public_key: str = None,
                     device_type: DeviceTypeEnum = DeviceTypeEnum.LEDGER):
        signer = Signer(
            name=name,
            device_type=DeviceType[device_type.value],
            chain_type=ChainType[chain_type.value],
            address=address,
            public_key=public_key,
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        await async_session.commit()
        await async_session.refresh(signer)
        return signer
    
    return _create




class TestCreateChallenge:
    """Tests for challenge creation."""

    @pytest.mark.asyncio
    async def test_create_evm_challenge(self, signer_service: SignerService):
        """Test creating challenge for EVM chain."""
        result = await signer_service.create_challenge(
            chain_type=ChainTypeEnum.EVM,
            address="0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
            public_key=None,
        )

        assert result.challenge is not None
        assert "0x742d35cc6634c0532925a3b844bc9e7595f1e3c7" in result.challenge
        assert result.expires_at is not None

    @pytest.mark.asyncio
    async def test_create_btc_challenge(self, signer_service: SignerService):
        """Test creating challenge for BTC chain."""
        pubkey = "02" + "a" * 64
        result = await signer_service.create_challenge(
            chain_type=ChainTypeEnum.BTC,
            address=None,
            public_key=pubkey,
        )

        assert result.challenge is not None
        assert pubkey.lower() in result.challenge
        assert result.expires_at is not None

    @pytest.mark.asyncio
    async def test_evm_requires_address(self, signer_service: SignerService):
        """Test EVM chain requires address."""
        with pytest.raises(ValidationError) as exc_info:
            await signer_service.create_challenge(
                chain_type=ChainTypeEnum.EVM,
                address=None,
                public_key="02" + "a" * 64,
            )

        assert "Address is required" in str(exc_info.value.message)

    @pytest.mark.asyncio
    async def test_btc_requires_public_key(self, signer_service: SignerService):
        """Test BTC chain requires public key."""
        with pytest.raises(ValidationError) as exc_info:
            await signer_service.create_challenge(
                chain_type=ChainTypeEnum.BTC,
                address="0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
                public_key=None,
            )

        assert "Public key is required" in str(exc_info.value.message)


class TestCreateSignerWithVerification:
    """Tests for creating verified signers."""

    @pytest.mark.asyncio
    async def test_ledger_requires_signature(self, signer_service: SignerService):
        """Test LEDGER device requires signature verification."""
        data = SignerCreate(
            name="My Ledger",
            device_type=DeviceTypeEnum.LEDGER,
            chain_type=ChainTypeEnum.BTC,
            public_key="02" + "a" * 64,
            derivation_path="m/48'/0'/0'/2'",
        )

        with pytest.raises(ValidationError) as exc_info:
            await signer_service.create_signer(data)

        assert "Challenge and signature are required" in str(exc_info.value.message)

    @pytest.mark.asyncio
    async def test_metamask_requires_signature(self, signer_service: SignerService):
        """Test METAMASK device requires signature verification."""
        data = SignerCreate(
            name="My MetaMask",
            device_type=DeviceTypeEnum.METAMASK,
            chain_type=ChainTypeEnum.EVM,
            address="0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
        )

        with pytest.raises(ValidationError) as exc_info:
            await signer_service.create_signer(data)

        assert "Challenge and signature are required" in str(exc_info.value.message)


class TestGetSigner:
    """Tests for getting signer by ID."""

    @pytest.mark.asyncio
    async def test_get_existing_signer(self, signer_service: SignerService, async_session: AsyncSession):
        """Test getting an existing signer."""
        # Create a signer directly in DB (bypass verification for test)
        from multivault.models.signer import Signer, ChainType, DeviceType, SignerStatus
        from datetime import datetime, UTC
        
        created = Signer(
            name="Test Signer",
            device_type=DeviceType.LEDGER,
            chain_type=ChainType.EVM,
            address="0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(created)
        await async_session.commit()
        await async_session.refresh(created)

        # Get it
        signer = await signer_service.get_signer(created.id)

        assert signer.id == created.id
        assert signer.name == "Test Signer"

    @pytest.mark.asyncio
    async def test_get_nonexistent_signer_raises(self, signer_service: SignerService):
        """Test getting nonexistent signer raises NotFoundError."""
        with pytest.raises(NotFoundError):
            await signer_service.get_signer("nonexistent-id")


class TestListSigners:
    """Tests for listing signers."""

    @pytest.mark.asyncio
    async def test_list_empty(self, signer_service: SignerService):
        """Test listing when no signers exist."""
        params = SignerQueryParams()
        signers, total = await signer_service.list_signers(params)

        assert signers == []
        assert total == 0

    @pytest.mark.asyncio
    async def test_list_with_signers(self, signer_service: SignerService, create_db_signer):
        """Test listing with multiple signers."""
        # Create signers directly in DB
        for i in range(3):
            addr = f"0x{'a' * 39}{i}"
            await create_db_signer(
                name=f"Signer {i}",
                chain_type=ChainTypeEnum.EVM,
                address=addr,
            )

        params = SignerQueryParams()
        signers, total = await signer_service.list_signers(params)

        assert len(signers) == 3
        assert total == 3

    @pytest.mark.asyncio
    async def test_list_filter_by_chain_type(self, signer_service: SignerService, create_db_signer):
        """Test filtering by chain type."""
        # Create EVM signer
        await create_db_signer(
            name="EVM Signer",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )

        # Create BTC signer
        await create_db_signer(
            name="BTC Signer",
            chain_type=ChainTypeEnum.BTC,
            public_key="02" + "b" * 64,
        )

        # Filter by EVM
        params = SignerQueryParams(chain_type=ChainTypeEnum.EVM)
        signers, total = await signer_service.list_signers(params)

        assert len(signers) == 1
        assert signers[0].name == "EVM Signer"

    @pytest.mark.asyncio
    async def test_list_pagination(self, signer_service: SignerService, create_db_signer):
        """Test pagination."""
        # Create 5 signers directly in DB
        for i in range(5):
            addr = f"0x{'a' * 39}{i}"
            await create_db_signer(
                name=f"Signer {i}",
                chain_type=ChainTypeEnum.EVM,
                address=addr,
            )

        # Get page 1 with page_size 2
        params = SignerQueryParams(page=1, page_size=2)
        signers, total = await signer_service.list_signers(params)

        assert len(signers) == 2
        assert total == 5

        # Get page 3
        params = SignerQueryParams(page=3, page_size=2)
        signers, total = await signer_service.list_signers(params)

        assert len(signers) == 1
        assert total == 5


class TestUpdateSigner:
    """Tests for updating signer."""

    @pytest.mark.asyncio
    async def test_update_name(self, signer_service: SignerService, create_db_signer):
        """Test updating signer name."""
        # Create signer directly in DB
        created = await create_db_signer(
            name="Original Name",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )

        # Update
        update_data = SignerUpdate(name="New Name")
        updated = await signer_service.update_signer(created.id, update_data)

        assert updated.name == "New Name"


class TestDeleteSigner:
    """Tests for soft deleting signer."""

    @pytest.mark.asyncio
    async def test_soft_delete(self, signer_service: SignerService, create_db_signer):
        """Test soft delete marks signer as deleted."""
        # Create signer directly in DB
        created = await create_db_signer(
            name="To Delete",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )

        # Delete
        await signer_service.delete_signer(created.id)

        # Should not be found
        with pytest.raises(NotFoundError):
            await signer_service.get_signer(created.id)


class TestRevokeSigner:
    """Tests for revoking signer."""

    @pytest.mark.asyncio
    async def test_revoke_signer(self, signer_service: SignerService, create_db_signer):
        """Test revoking signer changes status."""
        # Create signer directly in DB
        created = await create_db_signer(
            name="To Revoke",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )

        # Revoke
        revoked, affected = await signer_service.revoke_signer(created.id)

        assert revoked.status == SignerStatus.REVOKED
        assert affected == []  # No wallets reference this signer


class TestVerifySignerChallengeFallback:
    """Tests for verify_signer challenge lookup fallback (KeyVault flow)."""

    @pytest.mark.asyncio
    async def test_fallback_lookup_by_challenge_value(
        self, signer_service: SignerService, create_db_signer, monkeypatch
    ):
        """KeyVault stores challenges under challenge_msg key, not identifier.
        verify_signer should fall back to looking up by challenge value."""
        from datetime import timedelta
        from multivault.services import signer_service as svc_module

        # Create an UNVERIFIED BTC signer in DB (unique pubkey to avoid collision)
        btc_pubkey = "02" + "d" * 64
        created = await create_db_signer(
            name="KV BTC Signer",
            chain_type=ChainTypeEnum.BTC,
            public_key=btc_pubkey,
        )
        # Force status to UNVERIFIED for verify flow
        from multivault.models.signer import SignerStatus as SS
        created.status = SS.UNVERIFIED
        created.verified_at = None
        await signer_service.db.commit()

        # Simulate KeyVault challenge stored under challenge_msg key (not pubkey)
        challenge_msg = "multivault-test1234-1710000000"
        expires_at = datetime.now(UTC) + timedelta(minutes=5)
        svc_module._challenge_store[challenge_msg] = (challenge_msg, expires_at)

        # Mock crypto verification to pass
        monkeypatch.setattr(
            svc_module, "verify_btc_signature", lambda **kwargs: True
        )

        # verify_signer should find challenge via fallback
        result = await signer_service.verify_signer(
            signer_id=created.id,
            challenge=challenge_msg,
            signature="dummy_sig",
        )

        assert result.status == SignerStatus.VERIFIED
        # Challenge should be cleaned up
        assert challenge_msg not in svc_module._challenge_store

    @pytest.mark.asyncio
    async def test_no_fallback_when_primary_key_matches(
        self, signer_service: SignerService, create_db_signer, monkeypatch
    ):
        """When challenge is stored under identifier (standard flow),
        fallback is not needed and verify still works."""
        from datetime import timedelta
        from multivault.services import signer_service as svc_module

        btc_pubkey = "02" + "b" * 64
        created = await create_db_signer(
            name="Standard BTC Signer",
            chain_type=ChainTypeEnum.BTC,
            public_key=btc_pubkey,
        )
        from multivault.models.signer import SignerStatus as SS
        created.status = SS.UNVERIFIED
        created.verified_at = None
        await signer_service.db.commit()

        # Standard flow: challenge stored under identifier (pubkey)
        challenge_text = f"MultiVault verification for {btc_pubkey.lower()}"
        identifier = btc_pubkey.lower()
        expires_at = datetime.now(UTC) + timedelta(minutes=5)
        svc_module._challenge_store[identifier] = (challenge_text, expires_at)

        monkeypatch.setattr(
            svc_module, "verify_btc_signature", lambda **kwargs: True
        )

        result = await signer_service.verify_signer(
            signer_id=created.id,
            challenge=challenge_text,
            signature="dummy_sig",
        )

        assert result.status == SignerStatus.VERIFIED
        assert identifier not in svc_module._challenge_store

    @pytest.mark.asyncio
    async def test_challenge_not_found_raises_error(
        self, signer_service: SignerService, create_db_signer
    ):
        """When challenge not in store under any key, raises ValidationError."""
        btc_pubkey = "02" + "c" * 64
        created = await create_db_signer(
            name="No Challenge Signer",
            chain_type=ChainTypeEnum.BTC,
            public_key=btc_pubkey,
        )
        from multivault.models.signer import SignerStatus as SS
        created.status = SS.UNVERIFIED
        created.verified_at = None
        await signer_service.db.commit()

        with pytest.raises(ValidationError, match="Challenge not found"):
            await signer_service.verify_signer(
                signer_id=created.id,
                challenge="nonexistent-challenge",
                signature="dummy_sig",
            )
