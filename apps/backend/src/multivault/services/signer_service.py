"""Signer service for business logic."""

import json
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import structlog

logger = structlog.get_logger(__name__)

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from multivault.errors.exceptions import ConflictError, NotFoundError, ValidationError
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.wallet import Wallet, WalletSigner
from multivault.schemas.signer import (
    ChainTypeEnum,
    ChallengeResponse,
    DeviceTypeEnum,
    KeyVaultProtocolRequest,
    KeyVaultProtocolResponse,
    SignerCreate,
    SignerQueryParams,
    SignerStatusEnum,
    SignerUpdate,
)
from multivault.utils.crypto import (
    generate_challenge,
    rsa_sign_for_keyvault,
    verify_btc_signature,
    verify_evm_signature,
)
from multivault.utils.extra import set_extra


# In-memory challenge store (should use Redis in production)
_challenge_store: dict[str, tuple[str, datetime]] = {}


class SignerService:
    """Service for signer CRUD and verification operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_challenge(
        self,
        chain_type: ChainTypeEnum,
        address: str | None,
        public_key: str | None,
    ) -> ChallengeResponse:
        """Generate a verification challenge for a signer.

        Args:
            chain_type: The blockchain type
            address: EVM address (required for EVM)
            public_key: Public key (required for BTC)

        Returns:
            ChallengeResponse with message and expiry

        Raises:
            ValidationError: If required identifier is missing
        """
        # Validate identifier based on chain type
        if chain_type == ChainTypeEnum.EVM:
            if not address:
                raise ValidationError(
                    message="Address is required for EVM chain",
                    details={"chain_type": chain_type.value},
                )
            identifier = address.lower()
        else:  # BTC
            if not public_key:
                raise ValidationError(
                    message="Public key is required for BTC chain",
                    details={"chain_type": chain_type.value},
                )
            identifier = public_key.lower()

        # Generate challenge
        challenge, expires_at = generate_challenge(identifier)

        # Store challenge for later verification
        _challenge_store[identifier] = (challenge, expires_at)

        return ChallengeResponse(challenge=challenge, expires_at=expires_at)

    async def generate_keyvault_protocol(
        self,
        data: KeyVaultProtocolRequest,
    ) -> KeyVaultProtocolResponse:
        """Generate KeyVault address import protocol data.

        Builds a JSON payload compatible with the KeyVault iOS App's
        QR scanning protocol. Includes a challenge message for
        subsequent signature verification.
        chain_type_value from frontend is used when provided (no DB lookup).
        """
        challenge_msg = f"multivault-{uuid4().hex[:8]}-{int(time.time())}"
        expires_at = datetime.now(UTC) + timedelta(minutes=5)

        if data.chain_type_value:
            chain_type_value = data.chain_type_value
        elif data.chain_type == ChainTypeEnum.BTC:
            chain_type_value = (
                "BTC_TESTNET" if data.chain_net_type == "testnet" else "BTC"
            )
        else:
            chain_type_value = "ETH"

        business: dict = {
            "chain_type": chain_type_value,
            "chain_net_type": data.chain_net_type,
            "message": challenge_msg,
        }
        if data.evm_chain_id is not None:
            business["evm_chain_id"] = data.evm_chain_id

        business_data = json.dumps(business, separators=(",", ":"))
        signature = rsa_sign_for_keyvault(business_data)

        payload = {
            "nxv_action": "import_signer",
            "nxv_expire": int(expires_at.timestamp()),
            "nxv_nonce": int(time.time() * 1000),
            "nxv_platform": "KeyVault",
            "nxv_protocol_version": "1.0",
            "platform": "KeyVault",
            "b_data": {
                "business_data": business_data,
                "signature": signature,
            },
            "w_data": {},
            "s_data": {},
        }

        _challenge_store[challenge_msg] = (challenge_msg, expires_at)

        return KeyVaultProtocolResponse(
            payload_json=json.dumps(payload, separators=(",", ":")),
            challenge=challenge_msg,
            expires_at=expires_at,
        )

    async def create_signer(self, data: SignerCreate) -> Signer:
        """Create a new signer with optional verification.

        Args:
            data: Signer creation data

        Returns:
            Created Signer model

        Raises:
            ValidationError: If validation fails
            ConflictError: If signer with same identifier exists
        """
        # Validate identifier based on chain type
        if data.chain_type == ChainTypeEnum.EVM:
            if not data.address:
                raise ValidationError(
                    message="Address is required for EVM chain",
                    details={"chain_type": data.chain_type.value},
                )
            identifier = data.address.lower()
        else:  # BTC
            if not data.public_key:
                raise ValidationError(
                    message="Public key is required for BTC chain",
                    details={"chain_type": data.chain_type.value},
                )
            identifier = data.public_key.lower()

        # BTC signer must include derivation_path
        if data.chain_type == ChainTypeEnum.BTC and not data.derivation_path:
            raise ValidationError(
                message="BTC signer requires a derivation path",
                details={"chain_type": data.chain_type.value},
            )

        # BTC multisig requires BIP 48 derivation path at import time
        if data.chain_type == ChainTypeEnum.BTC and data.derivation_path:
            from multivault.chains.bitcoin.path import validate_bip48_path, script_type_from_path
            if not validate_bip48_path(data.derivation_path):
                raise ValidationError(
                    message=f"BTC multisig requires BIP 48 derivation path "
                    f"(m/48'/coinType'/account'/[12]'), got: '{data.derivation_path}'",
                    details={"derivation_path": data.derivation_path},
                )
            # Validate script_type consistency if frontend provided one
            if data.script_type:
                actual = script_type_from_path(data.derivation_path)
                if data.script_type != actual:
                    raise ValidationError(
                        message=f"Script type mismatch: selected '{data.script_type}', "
                        f"but derivation path indicates '{actual}'",
                        details={
                            "selected": data.script_type,
                            "actual": actual,
                            "derivation_path": data.derivation_path,
                        },
                    )

        # Check for duplicate
        existing = await self._find_by_identifier(
            chain_type=data.chain_type,
            address=data.address,
            public_key=data.public_key,
        )
        if existing:
            raise ConflictError(
                message="Signer with this identifier already exists",
                details={"signer_id": existing.id},
            )

        # Verification required for all signer types
        verified = False
        verified_at = None

        # Verification required
        if not data.challenge or not data.signature:
            raise ValidationError(
                message="Challenge and signature are required for verification",
                details={"device_type": data.device_type.value},
            )

        # Verify challenge exists and is not expired
        challenge_key = identifier
        stored = _challenge_store.get(challenge_key)
        if not stored and data.challenge:
            stored = _challenge_store.get(data.challenge)
            if stored:
                challenge_key = data.challenge
        if not stored:
            raise ValidationError(
                message="Challenge not found or expired. Please request a new challenge.",
            )

        stored_challenge, expires_at = stored
        if datetime.now(UTC) > expires_at:
            del _challenge_store[identifier]
            raise ValidationError(
                message="Challenge expired. Please request a new challenge.",
            )

        if stored_challenge != data.challenge:
            raise ValidationError(
                message="Challenge mismatch",
            )

        # Verify signature
        if data.chain_type == ChainTypeEnum.EVM:
            verified = verify_evm_signature(
                message=data.challenge,
                signature=data.signature,
                expected_address=data.address,  # type: ignore
            )
        else:  # BTC
            verified = verify_btc_signature(
                message=data.challenge,
                signature=data.signature,
                public_key=data.public_key,  # type: ignore
            )

        if not verified:
            raise ValidationError(
                message="Signature verification failed",
            )

        verified_at = datetime.now(UTC)

        # Clean up used challenge
        del _challenge_store[challenge_key]

        # Create signer
        signer = Signer(
            name=data.name,
            device_type=DeviceType(data.device_type.value),
            chain_type=ChainType(data.chain_type.value),
            public_key=data.public_key,
            address=data.address,
            derivation_path=data.derivation_path,
            status=SignerStatus.VERIFIED if verified else SignerStatus.UNVERIFIED,
            verified_at=verified_at,
        )
        # Store chain/device-specific fields in extra JSON
        if data.master_fingerprint or data.xpub or data.btc_network:
            set_extra(
                signer,
                master_fingerprint=data.master_fingerprint,
                xpub=data.xpub,
                btc_network=data.btc_network,
            )

        self.db.add(signer)
        await self.db.commit()
        await self.db.refresh(signer)

        return signer

    async def get_signer(self, signer_id: str) -> Signer:
        """Get a signer by ID.

        Args:
            signer_id: The signer's UUID

        Returns:
            Signer model (with wallet associations eager-loaded)

        Raises:
            NotFoundError: If signer not found
        """
        stmt = (
            select(Signer)
            .where(
                Signer.id == signer_id,
                Signer.deleted_at.is_(None),
            )
            .options(
                selectinload(Signer.wallet_signers)
                .selectinload(WalletSigner.wallet)
                .selectinload(Wallet.network),
            )
        )
        result = await self.db.execute(stmt)
        signer = result.scalar_one_or_none()

        if not signer:
            raise NotFoundError(resource="Signer", identifier=signer_id)

        return signer

    async def list_signers(
        self,
        params: SignerQueryParams,
    ) -> tuple[list[Signer], int]:
        """List signers with optional filtering.

        Args:
            params: Query parameters for filtering and pagination

        Returns:
            Tuple of (signers list, total count)
        """
        # Base query
        stmt = select(Signer).where(Signer.deleted_at.is_(None))

        # Apply filters
        if params.chain_type:
            stmt = stmt.where(Signer.chain_type == ChainType(params.chain_type.value))
        if params.device_type:
            stmt = stmt.where(Signer.device_type == DeviceType(params.device_type.value))
        if params.status:
            stmt = stmt.where(Signer.status == SignerStatus(params.status.value))
        if params.script_type:
            # Filter by derivation path suffix: /1' = p2sh-p2wsh, /2' = p2wsh
            suffix_map = {"p2wsh": "/2'", "p2sh-p2wsh": "/1'"}
            suffix = suffix_map.get(params.script_type)
            if suffix:
                stmt = stmt.where(Signer.derivation_path.like(f"%{suffix}"))

        # Count total
        count_stmt = select(func.count()).select_from(stmt.subquery())
        count_result = await self.db.execute(count_stmt)
        total = count_result.scalar() or 0

        # Apply pagination and eager-load wallet associations
        offset = (params.page - 1) * params.page_size
        stmt = stmt.offset(offset).limit(params.page_size)
        stmt = stmt.order_by(Signer.created_at.desc())
        stmt = stmt.options(
            selectinload(Signer.wallet_signers)
            .selectinload(WalletSigner.wallet)
            .selectinload(Wallet.network),
        )

        result = await self.db.execute(stmt)
        signers = list(result.scalars().all())

        return signers, total

    async def update_signer(
        self,
        signer_id: str,
        data: SignerUpdate,
    ) -> Signer:
        """Update a signer's name.

        Args:
            signer_id: The signer's UUID
            data: Update data

        Returns:
            Updated Signer model

        Raises:
            NotFoundError: If signer not found
        """
        signer = await self.get_signer(signer_id)
        signer.name = data.name

        await self.db.commit()

        return await self.get_signer(signer_id)

    async def delete_signer(self, signer_id: str) -> None:
        """Soft delete a signer.

        Prevents deletion if the signer is referenced by any active (non-archived,
        non-deleted) wallet.

        Args:
            signer_id: The signer's UUID

        Raises:
            NotFoundError: If signer not found
            ValidationError: If signer is referenced by active wallets
        """
        from multivault.models.wallet import WalletStatus

        signer = await self.get_signer(signer_id)

        # Check if signer is referenced by any active wallet
        stmt = (
            select(func.count())
            .select_from(WalletSigner)
            .join(Wallet, WalletSigner.wallet_id == Wallet.id)
            .where(
                WalletSigner.signer_id == signer.id,
                Wallet.status != WalletStatus.ARCHIVED,
            )
        )
        active_refs = (await self.db.execute(stmt)).scalar_one()
        if active_refs > 0:
            raise ValidationError(
                message="Cannot delete signer referenced by active wallets",
                details={"active_wallet_count": active_refs},
            )

        signer.deleted_at = datetime.now(UTC)

        await self.db.commit()

    async def verify_signer(
        self,
        signer_id: str,
        challenge: str,
        signature: str,
        *,
        device_type: str | None = None,
        derivation_path: str | None = None,
        master_fingerprint: str | None = None,
        xpub: str | None = None,
    ) -> Signer:
        """Verify an existing signer with a signed challenge."""
        signer = await self.get_signer(signer_id)

        if signer.status == SignerStatus.REVOKED:
            raise ValidationError(
                message="Cannot verify a revoked signer. Create a new signer instead.",
                details={"signer_id": signer_id, "status": signer.status.value},
            )

        if signer.status == SignerStatus.VERIFIED:
            return signer

        if not challenge or not signature:
            raise ValidationError(
                message="Challenge and signature are required for verification",
            )

        if signer.chain_type == ChainType.EVM:
            if not signer.address:
                raise ValidationError(
                    message="Address is required for EVM chain",
                    details={"chain_type": signer.chain_type.value},
                )
            identifier = signer.address.lower()
        else:
            if not signer.public_key:
                raise ValidationError(
                    message="Public key is required for BTC chain",
                    details={"chain_type": signer.chain_type.value},
                )
            identifier = signer.public_key.lower()

        stored = _challenge_store.get(identifier)
        if not stored and challenge:
            stored = _challenge_store.get(challenge)
            if stored:
                logger.debug(
                    "challenge_lookup_fallback",
                    signer_id=signer_id,
                    original_key=identifier,
                    fallback_key=challenge[:32],
                )
                identifier = challenge
        if not stored:
            raise ValidationError(
                message="Challenge not found or expired. Please request a new challenge.",
            )

        stored_challenge, expires_at = stored
        if datetime.now(UTC) > expires_at:
            del _challenge_store[identifier]
            raise ValidationError(
                message="Challenge expired. Please request a new challenge.",
            )

        if stored_challenge != challenge:
            raise ValidationError(
                message="Challenge mismatch",
            )

        if signer.chain_type == ChainType.EVM:
            verified = verify_evm_signature(
                message=challenge,
                signature=signature,
                expected_address=signer.address,  # type: ignore
            )
        else:
            verified = verify_btc_signature(
                message=challenge,
                signature=signature,
                public_key=signer.public_key,  # type: ignore
            )

        if not verified:
            raise ValidationError(
                message="Signature verification failed",
            )

        signer.status = SignerStatus.VERIFIED
        signer.verified_at = datetime.now(UTC)

        # Update device_type if currently UNKNOWN (imported signer)
        if signer.device_type == DeviceType.UNKNOWN and device_type:
            signer.device_type = DeviceType(device_type)

        # Update BTC-specific metadata from device (import verify)
        if derivation_path:
            # Validate BIP 48 path for BTC signers
            if signer.chain_type == ChainType.BTC:
                from multivault.chains.bitcoin.path import validate_bip48_path
                if not validate_bip48_path(derivation_path):
                    raise ValidationError(
                        message=f"BTC multisig requires BIP 48 derivation path "
                        f"(m/48'/coinType'/account'/[12]'), got: '{derivation_path}'",
                        details={"derivation_path": derivation_path},
                    )
            signer.derivation_path = derivation_path
        if master_fingerprint or xpub:
            set_extra(
                signer,
                master_fingerprint=master_fingerprint,
                xpub=xpub,
            )

        del _challenge_store[identifier]
        await self.db.commit()

        return await self.get_signer(signer_id)

    async def revoke_signer(self, signer_id: str) -> tuple[Signer, list[dict]]:
        """Revoke a signer's verification status.

        Args:
            signer_id: The signer's UUID

        Returns:
            Tuple of (updated Signer, list of affected wallet dicts).
            Each affected wallet dict has keys: wallet_id, wallet_name,
            threshold, remaining_verified — indicating wallets whose
            verified signer count drops below threshold after revocation.

        Raises:
            NotFoundError: If signer not found
            ValidationError: If signer is already revoked
        """
        from multivault.models.wallet import WalletStatus

        signer = await self.get_signer(signer_id)

        if signer.status == SignerStatus.REVOKED:
            raise ValidationError(
                message="Signer is already revoked",
                details={"signer_id": signer_id},
            )

        # Check wallet impact BEFORE revoking
        affected_wallets: list[dict] = []
        stmt = (
            select(Wallet)
            .options(
                selectinload(Wallet.wallet_signers).selectinload(WalletSigner.signer),
            )
            .join(WalletSigner, WalletSigner.wallet_id == Wallet.id)
            .where(
                WalletSigner.signer_id == signer.id,
                Wallet.status != WalletStatus.ARCHIVED,
            )
        )
        result = await self.db.execute(stmt)
        wallets = result.scalars().unique().all()

        for w in wallets:
            # Count verified signers excluding the one being revoked
            remaining_verified = sum(
                1
                for ws in w.wallet_signers
                if ws.signer.status == SignerStatus.VERIFIED
                and ws.signer_id != signer.id
            )
            if remaining_verified < w.threshold:
                affected_wallets.append(
                    {
                        "wallet_id": w.id,
                        "wallet_name": w.name,
                        "threshold": w.threshold,
                        "remaining_verified": remaining_verified,
                    }
                )

        signer.status = SignerStatus.REVOKED

        await self.db.commit()

        return await self.get_signer(signer_id), affected_wallets

    async def _find_by_identifier(
        self,
        chain_type: ChainTypeEnum,
        address: str | None,
        public_key: str | None,
    ) -> Signer | None:
        """Find existing signer by identifier.

        Args:
            chain_type: The blockchain type
            address: EVM address
            public_key: Public key

        Returns:
            Signer if found, None otherwise
        """
        stmt = select(Signer).where(
            Signer.chain_type == ChainType(chain_type.value),
            Signer.deleted_at.is_(None),
        )

        if chain_type == ChainTypeEnum.EVM and address:
            stmt = stmt.where(Signer.address == address.lower())
        elif public_key:
            stmt = stmt.where(Signer.public_key == public_key.lower())

        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
