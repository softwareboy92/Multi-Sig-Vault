"""Wallet service for business logic."""

import json
import time
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from multivault.errors.exceptions import ChainError, ConflictError, NotFoundError, ValidationError
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.services.network_service import NetworkService
from multivault.models.wallet import Wallet, WalletSigner, WalletSource, WalletStatus
from multivault.schemas.wallet import (
    BtcImportPreview,
    SafeDeploymentInfoResponse,
    WalletCreate,
    WalletImport,
    WalletQuery,
    WalletUpdate,
)
from multivault.chains.bitcoin.electrum import ElectrumClient
from multivault.chains.evm.adapter import EVMAdapter
from multivault.utils.extra import get_extra_field, set_extra


class WalletService:
    """Service for wallet CRUD and management operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_wallet(self, data: WalletCreate) -> Wallet:
        """Create a new multisig wallet.

        Args:
            data: Wallet creation data

        Returns:
            Created Wallet model

        Raises:
            ValidationError: If validation fails
            NotFoundError: If any signer not found
        """
        # Validate threshold vs signer count
        signer_count = len(data.signer_ids)
        if data.threshold > signer_count:
            raise ValidationError(
                message=f"Threshold ({data.threshold}) cannot exceed signer count ({signer_count})",
                details={
                    "threshold": data.threshold,
                    "signer_count": signer_count,
                },
            )

        # Fetch and validate all signers
        signers = await self._get_and_validate_signers(
            signer_ids=data.signer_ids,
            chain_type=data.chain_type,
        )

        # Determine initial status based on chain type
        # - EVM: PENDING_DEPLOY (Safe contract needs to be deployed on-chain)
        # - BTC: ACTIVE (multisig script address, no on-chain deployment needed)
        initial_status = (
            WalletStatus.PENDING_DEPLOY
            if data.chain_type.value == ChainType.EVM.value
            else WalletStatus.ACTIVE
        )

        # Create wallet
        wallet = Wallet(
            name=data.name,
            chain_type=ChainType(data.chain_type.value),
            threshold=data.threshold,
            signer_count=signer_count,
            status=initial_status,
        )

        # Chain-specific wallet configuration
        network_service = NetworkService(self.db)
        network = await network_service.get_network(data.network_id)
        if not network:
            raise ValidationError(
                message="Network not found",
                details={"network_id": data.network_id},
            )
        if not network.enabled:
            raise ValidationError(
                message="Network is disabled",
                details={"network_id": data.network_id},
            )
        # Validate chain_type consistency
        chain_type_str = data.chain_type.value if hasattr(data.chain_type, 'value') else str(data.chain_type)
        if network.chain_type != chain_type_str:
            raise ValidationError(
                message="Network chain_type mismatch",
                details={"expected": chain_type_str, "actual": network.chain_type},
            )

        wallet.network_id = data.network_id

        if data.chain_type.value == ChainType.EVM.value:
            # For EVM wallets, generate salt_nonce using millisecond timestamp
            # This allows creating multiple wallets with the same owners/threshold
            set_extra(wallet, salt=str(int(time.time() * 1000)))
        elif data.chain_type.value == ChainType.BTC.value:
            # For BTC wallets, derive P2WSH multisig address from public keys
            import json
            from multivault.chains.bitcoin import derive_p2wsh_address
            from multivault.chains.bitcoin.address import BitcoinNetwork

            # Get default node for BTC wallet
            btc_node = await network_service.get_default_node(network.id)
            if not btc_node:
                raise ValidationError(
                    message="No default node configured for BTC network",
                    details={"network_id": data.network_id},
                )

            extra = json.loads(network.extra) if isinstance(network.extra, str) else (network.extra or {})
            btc_network = extra.get("btc_network", "mainnet")

            normalized_btc_network = (
                "testnet" if "test" in btc_network.lower() else "mainnet"
            )

            network_enum = (
                BitcoinNetwork.TESTNET
                if normalized_btc_network == "testnet"
                else BitcoinNetwork.MAINNET
            )

            # Get public keys from signers (BTC signers must have public_key)
            public_keys = [s.public_key for s in signers if s.public_key]
            if len(public_keys) != len(signers):
                raise ValidationError(
                    message="All BTC signers must have public keys",
                    details={"missing_pubkey_count": len(signers) - len(public_keys)},
                )

            # Infer script_type from signers' derivation paths
            from multivault.chains.bitcoin.path import script_type_from_path

            script_types = set()
            for s in signers:
                if s.derivation_path:
                    script_types.add(script_type_from_path(s.derivation_path))
            if len(script_types) != 1:
                raise ValidationError(
                    message="All BTC signers must use the same address format "
                    f"(script_type). Found mixed: {script_types}",
                    details={"script_types": list(script_types)},
                )
            wallet_script_type = script_types.pop()

            if wallet_script_type == "p2sh-p2wsh":
                from multivault.chains.bitcoin.address import derive_p2sh_p2wsh_address
                address, _redeem_script, _witness_script = derive_p2sh_p2wsh_address(
                    threshold=data.threshold,
                    public_keys=public_keys,
                    network=network_enum,
                )
                wallet.address = address
                set_extra(
                    wallet,
                    script_type="p2sh-p2wsh",
                    witness_script=_witness_script,
                    redeem_script=_redeem_script,
                )
            elif wallet_script_type == "p2wsh":
                address, _witness_script = derive_p2wsh_address(
                    threshold=data.threshold,
                    public_keys=public_keys,
                    network=network_enum,
                )
                wallet.address = address
                set_extra(wallet, script_type="p2wsh", witness_script=_witness_script)
            else:
                raise ValidationError(
                    message=f"Unsupported script_type: {wallet_script_type}",
                )

        self.db.add(wallet)
        await self.db.flush()  # Get wallet.id

        # Create wallet-signer associations with order
        for index, signer in enumerate(signers):
            wallet_signer = WalletSigner(
                wallet_id=wallet.id,
                signer_id=signer.id,
                order_index=index,
            )
            self.db.add(wallet_signer)

        await self.db.commit()

        # Reload with relationships
        return await self.get_wallet(wallet.id)

    # ------------------------------------------------------------------
    # Import existing wallet
    # ------------------------------------------------------------------

    async def import_wallet(self, data: WalletImport) -> Wallet:
        """Import an existing multisig wallet from on-chain state."""
        if data.chain_type == ChainType.EVM:
            return await self._import_evm_safe(data)
        elif data.chain_type == ChainType.BTC:
            return await self._import_btc_p2wsh(data)
        else:
            raise ValidationError(
                message=f"Import not yet supported for chain type: {data.chain_type}",
                details={"chain_type": str(data.chain_type)},
            )

    async def _import_evm_safe(self, data: WalletImport) -> Wallet:
        """Import an existing EVM Safe wallet by reading on-chain state."""
        # Use pre-fetched data when available, otherwise query chain
        if data.safe_owners and data.safe_threshold is not None:
            owners = data.safe_owners
            threshold = data.safe_threshold
            nonce = 0  # nonce_at_import is informational only
        else:
            # Get RPC URL from network config
            network_service = NetworkService(self.db)
            network = await network_service.get_network(data.network_id)
            if not network:
                raise ValidationError(
                    message="Network not found",
                    details={"network_id": data.network_id},
                )
            if not network.enabled:
                raise ValidationError(
                    message="Network is disabled",
                    details={"network_id": data.network_id},
                )

            node = await network_service.get_default_node(data.network_id)
            rpc_url = node.endpoint_url if node else None
            if not rpc_url:
                raise ValidationError(
                    message="No RPC URL configured for network",
                    details={"network_id": data.network_id},
                )

            # Read on-chain state
            adapter = EVMAdapter(rpc_url=rpc_url)
            await adapter.connect()

            try:
                deployed = await adapter.is_deployed(data.safe_address)
                if not deployed:
                    raise ValidationError(
                        message="Safe contract is not deployed at the given address",
                        details={"safe_address": data.safe_address},
                    )

                safe_info = await adapter.get_safe_info(data.safe_address)
                owners = safe_info["owners"]
                threshold = safe_info["threshold"]
                nonce = safe_info["nonce"]
            finally:
                await adapter.disconnect()

        safe_address = data.safe_address.lower()

        # Check for duplicate (case-insensitive for EVM addresses)
        stmt = select(Wallet).where(
            func.lower(Wallet.address) == safe_address,
            Wallet.chain_type == ChainType.EVM,
            Wallet.status != WalletStatus.ARCHIVED,
            Wallet.deleted_at.is_(None),
        )
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none():
            raise ConflictError(
                message="Wallet with this address already exists",
                details={"address": safe_address},
            )

        # Create or reuse signers
        signers: list[Signer] = []
        for i, owner in enumerate(owners):
            addr = owner.lower()
            signer_stmt = select(Signer).where(
                func.lower(Signer.address) == addr,
                Signer.chain_type == ChainType.EVM,
                Signer.deleted_at.is_(None),
            )
            signer_result = await self.db.execute(signer_stmt)
            existing = signer_result.scalar_one_or_none()
            if existing:
                signers.append(existing)
            else:
                signer = Signer(
                    name=f"Imported Signer {i + 1}",
                    device_type=DeviceType.UNKNOWN,
                    chain_type=ChainType.EVM,
                    address=addr,
                    status=SignerStatus.UNVERIFIED,
                )
                self.db.add(signer)
                signers.append(signer)

        # Create wallet
        wallet = Wallet(
            name=data.name,
            chain_type=ChainType.EVM,
            threshold=threshold,
            signer_count=len(signers),
            status=WalletStatus.ACTIVE,
            source=WalletSource.IMPORTED,
            address=safe_address,
            network_id=data.network_id,
        )
        set_extra(
            wallet,
            safe_version="1.4.0+",
            imported_at=datetime.now(UTC).isoformat(),
            nonce_at_import=nonce,
        )
        self.db.add(wallet)
        await self.db.flush()

        # Create wallet-signer associations
        for index, signer in enumerate(signers):
            ws = WalletSigner(
                wallet_id=wallet.id,
                signer_id=signer.id,
                order_index=index,
            )
            self.db.add(ws)

        await self.db.commit()
        return await self.get_wallet(wallet.id)

    # =====================================================================
    # BTC Preview (verify without saving)
    # =====================================================================
    async def preview_btc_import(self, data: "BtcImportPreview") -> dict:
        """Verify BTC multisig import params and return preview data.

        Does NOT create any wallet or signer records.
        Returns derived address, sorted public keys, threshold,
        and witness script for frontend confirmation.
        """
        from multivault.chains.bitcoin.address import BitcoinNetwork

        # Resolve network → BTC network enum
        network_service = NetworkService(self.db)
        network = await network_service.get_network(data.network_id)
        if not network:
            raise ValidationError(
                message="Network not found",
                details={"network_id": data.network_id},
            )
        if not network.enabled:
            raise ValidationError(
                message="Network is disabled",
                details={"network_id": data.network_id},
            )

        extra = json.loads(network.extra) if network.extra else {}
        btc_net_name = extra.get("btc_network", "mainnet")
        btc_network = (
            BitcoinNetwork.TESTNET
            if "test" in btc_net_name.lower()
            else BitcoinNetwork.MAINNET
        )

        is_manual = data.public_keys is not None and data.threshold is not None

        if is_manual:
            return await self._preview_btc_manual(
                data, btc_network
            )
        else:
            return await self._preview_btc_auto(
                data, btc_network
            )

    @staticmethod
    def _is_p2sh_p2wsh_address(address: str) -> bool:
        """Detect P2SH-P2WSH from address prefix.

        P2SH addresses start with '3' (mainnet) or '2' (testnet).
        P2WSH addresses start with 'bc1q' or 'tb1q' (bech32).
        """
        return address.startswith("3") or address.startswith("2")

    async def _preview_btc_manual(
        self, data: "BtcImportPreview", btc_network: "BitcoinNetwork"
    ) -> dict:
        """Preview Mode A: re-derive address from user-provided keys."""
        from multivault.chains.bitcoin.address import (
            derive_p2sh_p2wsh_address,
            derive_p2wsh_address,
            sort_public_keys,
            validate_public_key,
        )

        assert data.public_keys is not None
        assert data.threshold is not None

        for pk in data.public_keys:
            if not validate_public_key(pk):
                raise ValidationError(
                    message=f"Invalid public key: {pk}",
                    details={"public_key": pk},
                )

        is_nested = self._is_p2sh_p2wsh_address(data.address)

        if is_nested:
            derived_address, redeem_script, witness_script = (
                derive_p2sh_p2wsh_address(
                    data.threshold, data.public_keys, btc_network
                )
            )
        else:
            derived_address, witness_script = derive_p2wsh_address(
                data.threshold, data.public_keys, btc_network
            )
            redeem_script = None

        if derived_address != data.address:
            raise ValidationError(
                message="Derived address does not match provided address",
                details={
                    "derived": derived_address,
                    "provided": data.address,
                },
            )

        sorted_pks = [pk.hex() for pk in sort_public_keys(data.public_keys)]
        ws_hex = witness_script.hex() if isinstance(witness_script, bytes) else witness_script

        result: dict = {
            "mode": "manual",
            "address": derived_address,
            "threshold": data.threshold,
            "public_keys": sorted_pks,
            "signer_count": len(sorted_pks),
            "witness_script": ws_hex,
            "script_type": "p2sh-p2wsh" if is_nested else "p2wsh",
            "address_match": True,
        }
        if redeem_script is not None:
            result["redeem_script"] = redeem_script.hex()
        return result

    async def _preview_btc_auto(
        self, data: "BtcImportPreview", btc_network: "BitcoinNetwork"
    ) -> dict:
        """Preview Mode B: extract multisig params from chain."""
        from multivault.chains.bitcoin.address import (
            derive_p2sh_p2wsh_address,
            derive_p2wsh_address,
            get_embit_network,
            parse_witness_script,
        )
        from multivault.chains.bitcoin.electrum import ElectrumClient
        from multivault.models.network import parse_electrum_url

        network_service = NetworkService(self.db)
        node = await network_service.get_default_node(data.network_id)
        if not node:
            raise ValidationError(
                message="No default node configured for BTC network",
                details={"network_id": data.network_id},
            )
        host, port, use_ssl = parse_electrum_url(node.endpoint_url)
        embit_net = get_embit_network(btc_network)

        client = ElectrumClient(host=host, port=port, use_ssl=use_ssl)
        try:
            await client.connect()

            witness_script_hex = None

            if data.tx_id:
                raw_hex = await client.get_raw_transaction(data.tx_id)
                witness_script_hex = self._extract_witness_script(
                    raw_hex, data.address, embit_net
                )
            else:
                # Scan recent transactions (limit to avoid excessive RPC calls
                # on active addresses). If not found, user should provide tx_id.
                _MAX_TX_SCAN = 20
                history = await client.get_history(data.address)
                for tx_info in history[:_MAX_TX_SCAN]:
                    raw_hex = await client.get_raw_transaction(tx_info.txid)
                    ws_hex = self._extract_witness_script(
                        raw_hex, data.address, embit_net
                    )
                    if ws_hex:
                        witness_script_hex = ws_hex
                        break

            if not witness_script_hex:
                raise ValidationError(
                    message="No spending transaction found for this address",
                    details={"address": data.address},
                )

            threshold, pubkey_hexes = parse_witness_script(
                bytes.fromhex(witness_script_hex)
            )

            is_nested = self._is_p2sh_p2wsh_address(data.address)
            if is_nested:
                derived_address, redeem_script_raw, ws_raw = (
                    derive_p2sh_p2wsh_address(
                        threshold, pubkey_hexes, btc_network
                    )
                )
            else:
                derived_address, ws_raw = derive_p2wsh_address(
                    threshold, pubkey_hexes, btc_network
                )
                redeem_script_raw = None

            if derived_address != data.address:
                raise ValidationError(
                    message="Extracted multisig params do not match the address",
                    details={
                        "derived": derived_address,
                        "provided": data.address,
                    },
                )
        finally:
            await client.disconnect()

        ws_hex = ws_raw.hex() if isinstance(ws_raw, bytes) else ws_raw

        result: dict = {
            "mode": "auto",
            "address": derived_address,
            "threshold": threshold,
            "public_keys": pubkey_hexes,
            "signer_count": len(pubkey_hexes),
            "witness_script": ws_hex,
            "script_type": "p2sh-p2wsh" if is_nested else "p2wsh",
            "address_match": True,
        }
        if redeem_script_raw is not None:
            result["redeem_script"] = redeem_script_raw.hex()
        return result

    async def _import_btc_p2wsh(self, data: WalletImport) -> Wallet:
        """Import a BTC P2WSH multisig wallet (Mode A: manual with pubkeys)."""
        import json as _json

        from multivault.chains.bitcoin.address import (
            BitcoinNetwork,
            derive_p2wsh_address,
            validate_public_key,
        )

        # Validate network
        network_service = NetworkService(self.db)
        network = await network_service.get_network(data.network_id)
        if not network:
            raise ValidationError(
                message="Network not found",
                details={"network_id": data.network_id},
            )
        if not network.enabled:
            raise ValidationError(
                message="Network is disabled",
                details={"network_id": data.network_id},
            )

        # Determine BTC network from network config
        extra = _json.loads(network.extra) if network.extra else {}
        btc_net_name = extra.get("btc_network", "mainnet")
        btc_network_enum = (
            BitcoinNetwork.TESTNET
            if "test" in btc_net_name.lower()
            else BitcoinNetwork.MAINNET
        )

        # Mode A: manual import with explicit keys
        if data.public_keys and data.threshold:
            return await self._import_btc_mode_a(data, btc_network_enum)
        else:
            # Mode B: auto-extract from chain
            return await self._import_btc_mode_b(data, btc_network_enum)

    async def _import_btc_mode_a(
        self, data: WalletImport, btc_network: "BitcoinNetwork"
    ) -> Wallet:
        """BTC Mode A: manual import with user-provided public keys."""
        from multivault.chains.bitcoin.address import (
            BitcoinNetwork,
            derive_p2sh_p2wsh_address,
            derive_p2wsh_address,
            sort_public_keys,
            validate_public_key,
        )

        assert data.public_keys is not None
        assert data.threshold is not None

        # Validate each public key
        for pk in data.public_keys:
            if not validate_public_key(pk):
                raise ValidationError(
                    message=f"Invalid public key: {pk}",
                    details={"public_key": pk},
                )

        # Derive address and witness script (branch by script type)
        is_nested = self._is_p2sh_p2wsh_address(data.address)
        if is_nested:
            derived_address, redeem_script, witness_script = (
                derive_p2sh_p2wsh_address(
                    data.threshold, data.public_keys, btc_network
                )
            )
        else:
            derived_address, witness_script = derive_p2wsh_address(
                data.threshold, data.public_keys, btc_network
            )
            redeem_script = None

        # Compare with user-provided address
        if derived_address != data.address:
            raise ValidationError(
                message="Derived address does not match provided address",
                details={
                    "derived": derived_address,
                    "provided": data.address,
                },
            )

        # Check duplicate
        stmt = select(Wallet).where(
            Wallet.address == derived_address,
            Wallet.chain_type == ChainType.BTC,
            Wallet.status != WalletStatus.ARCHIVED,
            Wallet.deleted_at.is_(None),
        )
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none():
            raise ConflictError(
                message="Wallet with this address already exists",
                details={"address": derived_address},
            )

        # Get sorted public keys (derive_p2wsh_address sorts internally)
        sorted_pks = [pk.hex() for pk in sort_public_keys(data.public_keys)]

        # Create or reuse signers by public_key match
        signers: list[Signer] = []
        for i, pk_hex in enumerate(sorted_pks):
            signer_stmt = select(Signer).where(
                Signer.public_key == pk_hex,
                Signer.chain_type == ChainType.BTC,
                Signer.deleted_at.is_(None),
            )
            signer_result = await self.db.execute(signer_stmt)
            existing = signer_result.scalar_one_or_none()
            if existing:
                signers.append(existing)
            else:
                btc_net_name = (
                    "testnet"
                    if btc_network == BitcoinNetwork.TESTNET
                    else "mainnet"
                )
                signer = Signer(
                    name=f"Imported Signer {i + 1}",
                    device_type=DeviceType.UNKNOWN,
                    chain_type=ChainType.BTC,
                    public_key=pk_hex,
                    status=SignerStatus.UNVERIFIED,
                    extra=json.dumps({"btc_network": btc_net_name}),
                )
                self.db.add(signer)
                signers.append(signer)

        # Create wallet
        wallet = Wallet(
            name=data.name,
            chain_type=ChainType.BTC,
            threshold=data.threshold,
            signer_count=len(signers),
            status=WalletStatus.ACTIVE,
            source=WalletSource.IMPORTED,
            address=derived_address,
            network_id=data.network_id,
        )
        extra_kwargs: dict = {
            "witness_script": witness_script,
            "script_type": "p2sh-p2wsh" if is_nested else "p2wsh",
            "imported_at": datetime.now(UTC).isoformat(),
        }
        if redeem_script is not None:
            extra_kwargs["redeem_script"] = redeem_script.hex()
        set_extra(wallet, **extra_kwargs)
        self.db.add(wallet)
        await self.db.flush()

        # Create wallet-signer associations
        for index, signer in enumerate(signers):
            ws = WalletSigner(
                wallet_id=wallet.id,
                signer_id=signer.id,
                order_index=index,
            )
            self.db.add(ws)

        await self.db.commit()
        return await self.get_wallet(wallet.id)

    async def _import_btc_mode_b(
        self, data: WalletImport, btc_network: "BitcoinNetwork"
    ) -> Wallet:
        """BTC Mode B: auto-extract multisig params from spending transaction."""
        from multivault.chains.bitcoin.address import (
            BitcoinNetwork,
            derive_p2sh_p2wsh_address,
            derive_p2wsh_address,
            get_embit_network,
            parse_witness_script,
        )
        from multivault.models.network import parse_electrum_url

        # Get Electrum node config
        network_service = NetworkService(self.db)
        node = await network_service.get_default_node(data.network_id)
        if not node:
            raise ValidationError(
                message="No default node configured for BTC network",
                details={"network_id": data.network_id},
            )
        host, port, use_ssl = parse_electrum_url(node.endpoint_url)

        embit_net = get_embit_network(btc_network)

        # Connect to Electrum
        client = ElectrumClient(host=host, port=port, use_ssl=use_ssl)
        try:
            await client.connect()

            # Find a spending transaction (use raw hex — verbose unsupported
            # by many Electrum servers including Blockstream)
            witness_script_hex = None

            if data.tx_id:
                # User provided a specific tx
                raw_hex = await client.get_raw_transaction(data.tx_id)
                witness_script_hex = self._extract_witness_script(
                    raw_hex, data.address, embit_net
                )
            else:
                # Auto-discover: scan history for a spending tx
                history = await client.get_history(data.address)
                for tx_info in history:
                    raw_hex = await client.get_raw_transaction(tx_info.txid)
                    ws_hex = self._extract_witness_script(
                        raw_hex, data.address, embit_net
                    )
                    if ws_hex:
                        witness_script_hex = ws_hex
                        break

            if not witness_script_hex:
                raise ValidationError(
                    message="No spending transaction found for this address",
                    details={"address": data.address},
                )

            # Parse witness script
            threshold, pubkey_hexes = parse_witness_script(
                bytes.fromhex(witness_script_hex)
            )

            # Verify by re-deriving address
            is_nested = self._is_p2sh_p2wsh_address(data.address)
            if is_nested:
                derived_address, redeem_script_raw, ws_raw = (
                    derive_p2sh_p2wsh_address(
                        threshold, pubkey_hexes, btc_network
                    )
                )
            else:
                derived_address, ws_raw = derive_p2wsh_address(
                    threshold, pubkey_hexes, btc_network
                )
                redeem_script_raw = None
            if derived_address != data.address:
                raise ValidationError(
                    message="Extracted multisig params do not match the address",
                    details={
                        "derived": derived_address,
                        "provided": data.address,
                    },
                )
        finally:
            await client.disconnect()

        # Check duplicate
        stmt = select(Wallet).where(
            Wallet.address == data.address,
            Wallet.chain_type == ChainType.BTC,
            Wallet.status != WalletStatus.ARCHIVED,
            Wallet.deleted_at.is_(None),
        )
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none():
            raise ConflictError(
                message="Wallet with this address already exists",
                details={"address": data.address},
            )

        # Create or reuse signers by public_key
        signers: list[Signer] = []
        for i, pk_hex in enumerate(pubkey_hexes):
            signer_stmt = select(Signer).where(
                Signer.public_key == pk_hex,
                Signer.chain_type == ChainType.BTC,
                Signer.deleted_at.is_(None),
            )
            signer_result = await self.db.execute(signer_stmt)
            existing = signer_result.scalar_one_or_none()
            if existing:
                signers.append(existing)
            else:
                btc_net_name = (
                    "testnet"
                    if btc_network == BitcoinNetwork.TESTNET
                    else "mainnet"
                )
                signer = Signer(
                    name=f"Imported Signer {i + 1}",
                    device_type=DeviceType.UNKNOWN,
                    chain_type=ChainType.BTC,
                    public_key=pk_hex,
                    status=SignerStatus.UNVERIFIED,
                    extra=json.dumps({"btc_network": btc_net_name}),
                )
                self.db.add(signer)
                signers.append(signer)

        # Create wallet
        wallet = Wallet(
            name=data.name,
            chain_type=ChainType.BTC,
            threshold=threshold,
            signer_count=len(signers),
            status=WalletStatus.ACTIVE,
            source=WalletSource.IMPORTED,
            address=data.address,
            network_id=data.network_id,
        )
        ws_hex = ws_raw.hex() if isinstance(ws_raw, bytes) else ws_raw
        extra_kwargs_b: dict = {
            "witness_script": ws_hex,
            "script_type": "p2sh-p2wsh" if is_nested else "p2wsh",
            "imported_at": datetime.now(UTC).isoformat(),
        }
        if redeem_script_raw is not None:
            extra_kwargs_b["redeem_script"] = redeem_script_raw.hex()
        set_extra(wallet, **extra_kwargs_b)
        self.db.add(wallet)
        await self.db.flush()

        for index, signer in enumerate(signers):
            ws_assoc = WalletSigner(
                wallet_id=wallet.id,
                signer_id=signer.id,
                order_index=index,
            )
            self.db.add(ws_assoc)

        await self.db.commit()
        return await self.get_wallet(wallet.id)

    @staticmethod
    def _extract_witness_script(
        raw_hex: str, address: str, embit_net: dict
    ) -> str | None:
        """Extract witnessScript hex from a raw tx that spends from address.

        Parses the raw transaction with embit and checks each input's
        witness stack. For P2WSH multisig, the last witness item is the
        witnessScript; we derive the P2WSH address from it and compare
        against the target address to identify the correct input.

        Also handles P2SH-P2WSH: if P2WSH doesn't match, derives the
        P2SH(redeemScript) address and compares.
        """
        from hashlib import sha256

        from embit import script as embit_script
        from embit.transaction import Transaction as EmbitTransaction

        tx = EmbitTransaction.parse(bytes.fromhex(raw_hex))
        for inp in tx.vin:
            if not inp.witness or not inp.witness.items:
                continue
            # Last witness item is the witnessScript for P2WSH / P2SH-P2WSH
            ws_bytes = inp.witness.items[-1]
            if len(ws_bytes) < 3:  # too short to be a valid multisig script
                continue
            try:
                # Try P2WSH first
                p2wsh_spk = embit_script.p2wsh(embit_script.Script(ws_bytes))
                derived_addr = p2wsh_spk.address(embit_net)
                if derived_addr == address:
                    return ws_bytes.hex()

                # Try P2SH-P2WSH: redeemScript = OP_0 <SHA256(witnessScript)>
                script_hash = sha256(ws_bytes).digest()
                redeem_script = bytes([0x00, 0x20]) + script_hash
                p2sh_spk = embit_script.p2sh(embit_script.Script(redeem_script))
                p2sh_addr = p2sh_spk.address(embit_net)
                if p2sh_addr == address:
                    return ws_bytes.hex()
            except Exception:
                continue
        return None

    async def get_wallet(self, wallet_id: str, *, include_archived: bool = False) -> Wallet:
        """Get a wallet by ID with signers loaded.

        Args:
            wallet_id: The wallet's UUID
            include_archived: If True, include soft-deleted wallets

        Returns:
            Wallet model with relationships

        Raises:
            NotFoundError: If wallet not found or deleted
        """
        stmt = (
            select(Wallet)
            .options(
                selectinload(Wallet.wallet_signers).selectinload(WalletSigner.signer),
                selectinload(Wallet.network),
            )
            .where(Wallet.id == wallet_id)
        )
        if not include_archived:
            stmt = stmt.where(Wallet.status != WalletStatus.ARCHIVED)
        result = await self.db.execute(stmt)
        wallet = result.scalar_one_or_none()

        if not wallet:
            raise NotFoundError("Wallet", wallet_id)

        return wallet

    async def list_wallets(
        self,
        query: WalletQuery,
    ) -> tuple[list[Wallet], int]:
        """List wallets with filtering and pagination.

        Args:
            query: Query parameters

        Returns:
            Tuple of (wallets, total_count)
        """
        # Base query
        stmt = select(Wallet).where(Wallet.status != WalletStatus.ARCHIVED)

        # Apply filters
        if query.chain_type:
            stmt = stmt.where(Wallet.chain_type == ChainType(query.chain_type.value))

        if query.status:
            stmt = stmt.where(Wallet.status == WalletStatus(query.status.value))

        # Count total
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = await self.db.scalar(count_stmt) or 0

        # Apply pagination and ordering, eagerly load signers for verified count
        stmt = stmt.options(
            selectinload(Wallet.wallet_signers).selectinload(WalletSigner.signer),
        )
        stmt = stmt.order_by(Wallet.created_at.desc())
        stmt = stmt.offset((query.page - 1) * query.page_size).limit(query.page_size)

        result = await self.db.execute(stmt)
        wallets = list(result.scalars().all())

        return wallets, total

    async def update_wallet(
        self,
        wallet_id: str,
        data: WalletUpdate,
    ) -> Wallet:
        """Update wallet name.

        Args:
            wallet_id: The wallet's UUID
            data: Update data

        Returns:
            Updated Wallet model

        Raises:
            NotFoundError: If wallet not found
        """
        wallet = await self.get_wallet(wallet_id)
        wallet.name = data.name
        wallet.updated_at = datetime.now(UTC)

        await self.db.commit()
        return await self.get_wallet(wallet_id)

    async def archive_wallet(self, wallet_id: str) -> Wallet:
        """Archive (soft delete) a wallet.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            Archived Wallet model

        Raises:
            NotFoundError: If wallet not found
        """
        wallet = await self.get_wallet(wallet_id)
        wallet.status = WalletStatus.ARCHIVED

        await self.db.commit()
        return await self.get_wallet(wallet_id, include_archived=True)

    async def activate_wallet(
        self,
        wallet_id: str,
        address: str,
        *,
        tx_hash: str | None = None,
        witness_script: str | None = None,
        redeem_script: str | None = None,
        salt: str | None = None,
        factory_address: str | None = None,
    ) -> Wallet:
        """Activate a wallet after address derivation/deployment.

        Args:
            wallet_id: The wallet's UUID
            address: The on-chain multisig address
            witness_script: BTC witness script hex
            redeem_script: BTC redeem script hex
            salt: EVM Safe salt
            factory_address: EVM Safe factory address

        Returns:
            Activated Wallet model

        Raises:
            NotFoundError: If wallet not found
            ValidationError: If wallet is not in PENDING_DEPLOY status
        """
        wallet = await self.get_wallet(wallet_id)

        if wallet.status != WalletStatus.PENDING_DEPLOY:
            raise ValidationError(
                message="Only pending-deploy wallets can be activated",
                details={
                    "wallet_id": wallet_id,
                    "current_status": wallet.status.value,
                },
            )

        wallet.address = address
        wallet.status = WalletStatus.ACTIVE
        wallet.deployed_at = datetime.now(UTC)

        # Store chain-specific fields in extra JSON
        extra_fields: dict[str, str] = {}
        # BTC-specific
        if witness_script:
            extra_fields["witness_script"] = witness_script
        if redeem_script:
            extra_fields["redeem_script"] = redeem_script
        # EVM-specific
        if salt:
            extra_fields["salt"] = salt
        if tx_hash:
            extra_fields["deployment_tx_hash"] = tx_hash
        if factory_address:
            extra_fields["factory_address"] = factory_address

        if extra_fields:
            set_extra(wallet, **extra_fields)

        await self.db.commit()
        return await self.get_wallet(wallet_id)

    async def get_wallet_signers(self, wallet_id: str) -> list[Signer]:
        """Get ordered list of signers for a wallet.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            List of Signer models in order

        Raises:
            NotFoundError: If wallet not found
        """
        wallet = await self.get_wallet(wallet_id)
        return [ws.signer for ws in wallet.wallet_signers]

    async def get_deployment_info(self, wallet_id: str) -> SafeDeploymentInfoResponse:
        """Get Safe deployment information for an EVM wallet.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            SafeDeploymentInfoResponse with predicted address and tx data

        Raises:
            NotFoundError: If wallet not found
            ValidationError: If wallet is not EVM or not in PENDING_DEPLOY status
        """
        wallet = await self.get_wallet(wallet_id)

        # Validate chain type
        chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
        if chain_type != ChainType.EVM.value:
            raise ValidationError(
                message="Deployment info is only available for EVM wallets",
                details={"chain_type": chain_type},
            )

        # Validate status
        status = wallet.status.value if hasattr(wallet.status, "value") else str(wallet.status)
        if status != WalletStatus.PENDING_DEPLOY.value:
            raise ValidationError(
                message=f"Wallet is not pending deployment (status: {status})",
                details={"status": status, "wallet_id": wallet_id},
            )

        # Get signer addresses (ordered)
        owners = []
        for ws in wallet.wallet_signers:
            if ws.signer.address:
                owners.append(ws.signer.address)
            else:
                raise ValidationError(
                    message=f"Signer {ws.signer.name} has no address",
                    details={"signer_id": ws.signer.id},
                )

        # Import SafeManager lazily to avoid circular imports
        from multivault.chains.evm import SafeManager, Web3Client
        from multivault.chains.evm.web3_client import Web3ConnectionError

        # Get RPC URL from wallet's network configuration
        rpc_url = None
        if wallet.network_id:
            from multivault.services.network_service import NetworkService
            network_service = NetworkService(self.db)
            node = await network_service.get_default_node(wallet.network_id)
            if node:
                rpc_url = node.endpoint_url

        if not rpc_url:
            raise ValidationError(
                message="No RPC URL configured for wallet's network",
                details={"wallet_id": wallet.id, "network_id": wallet.network_id},
            )

        client = Web3Client(rpc_url=rpc_url)
        try:
            await client.connect()
        except Web3ConnectionError as exc:
            raise ChainError(
                message="Failed to connect to EVM RPC",
                details={"rpc_url": rpc_url},
            ) from exc
        safe_manager = SafeManager(client=client)

        try:

            # Use wallet salt if already set, otherwise use 0
            salt_str = get_extra_field(wallet, "salt")
            salt_nonce = int(salt_str) if salt_str else 0

            # Get deployment info
            deployment_info = await safe_manager.get_deployment_info(
                owners=owners,
                threshold=wallet.threshold,
                salt_nonce=salt_nonce,
            )

            # Build deployment transaction
            deployment_tx = None
            if not deployment_info.is_deployed:
                deployment_tx = safe_manager.build_deployment_tx(
                    owners=owners,
                    threshold=wallet.threshold,
                    salt_nonce=salt_nonce,
                )

            return SafeDeploymentInfoResponse(
                wallet_id=wallet_id,
                predicted_address=deployment_info.address,
                owners=deployment_info.owners,
                threshold=deployment_info.threshold,
                salt_nonce=deployment_info.salt_nonce,
                factory_address=deployment_info.factory_address,
                singleton_address=deployment_info.singleton_address,
                fallback_handler=deployment_info.fallback_handler,
                is_deployed=deployment_info.is_deployed,
                chain_id=client.chain_id or 1,
                deployment_tx=deployment_tx,
            )
        finally:
            await client.disconnect()

    # =========================================================================
    # Private Methods
    # =========================================================================

    async def _get_and_validate_signers(
        self,
        signer_ids: list[str],
        chain_type: ChainType,
    ) -> list[Signer]:
        """Fetch signers and validate them for wallet creation.

        Args:
            signer_ids: List of signer IDs
            chain_type: Expected chain type

        Returns:
            List of Signer models in same order as signer_ids

        Raises:
            NotFoundError: If any signer not found
            ValidationError: If signer validation fails
        """
        # Fetch all signers
        stmt = select(Signer).where(
            Signer.id.in_(signer_ids),
            Signer.deleted_at.is_(None),
        )
        result = await self.db.execute(stmt)
        signers_map = {s.id: s for s in result.scalars().all()}

        # Validate all signers exist
        missing = set(signer_ids) - set(signers_map.keys())
        if missing:
            raise NotFoundError("Signer", ", ".join(list(missing)))

        # Validate each signer
        errors = []
        # Get chain type value for comparison (handle both enum and string)
        expected_chain = chain_type.value if hasattr(chain_type, "value") else str(chain_type)

        for signer_id in signer_ids:
            signer = signers_map[signer_id]

            # Check chain type matches (signer.chain_type may be string from SQLite)
            signer_chain = signer.chain_type.value if hasattr(signer.chain_type, "value") else str(signer.chain_type)
            if signer_chain != expected_chain:
                errors.append(
                    f"Signer {signer.name} ({signer_id}) has chain type {signer_chain}, expected {expected_chain}"
                )

            # Check verification status
            signer_status = signer.status.value if hasattr(signer.status, "value") else str(signer.status)
            if signer_status != SignerStatus.VERIFIED.value:
                errors.append(
                    f"Signer {signer.name} ({signer_id}) is not verified (status: {signer_status})"
                )

            # Check required identifier for BTC (need public_key for script)
            if expected_chain == ChainType.BTC.value and not signer.public_key:
                errors.append(
                    f"Signer {signer.name} ({signer_id}) requires public_key for BTC multisig"
                )

            # BTC multisig requires BIP 48 derivation path
            if expected_chain == ChainType.BTC.value:
                from multivault.chains.bitcoin.path import validate_bip48_path
                if not validate_bip48_path(signer.derivation_path):
                    path_display = signer.derivation_path or "(none)"
                    errors.append(
                        f"Signer {signer.name} ({signer_id}) has derivation path "
                        f"'{path_display}', BTC multisig requires BIP 48 path "
                        f"(m/48'/coinType'/account'/[12]')"
                    )

        if errors:
            raise ValidationError(
                message="Signer validation failed",
                details={"errors": errors},
            )

        # Return signers in original order
        return [signers_map[sid] for sid in signer_ids]

    async def update_signer_hmac(
        self,
        wallet_id: str,
        signer_id: str,
        hmac: str,
    ) -> WalletSigner:
        """Update the Ledger policy HMAC for a signer in a wallet.

        Args:
            wallet_id: Wallet ID
            signer_id: Signer ID
            hmac: Ledger wallet policy HMAC (32 bytes hex)

        Returns:
            Updated WalletSigner model

        Raises:
            NotFoundError: If wallet or signer not found in wallet
        """
        # Find the wallet signer association
        stmt = (
            select(WalletSigner)
            .options(selectinload(WalletSigner.signer))
            .where(
                WalletSigner.wallet_id == wallet_id,
                WalletSigner.signer_id == signer_id,
            )
        )
        result = await self.db.execute(stmt)
        wallet_signer = result.scalar_one_or_none()

        if not wallet_signer:
            raise NotFoundError(
                resource_type="WalletSigner",
                resource_id=f"wallet_id={wallet_id}, signer_id={signer_id}",
            )

        # Update the HMAC in extra JSON
        set_extra(wallet_signer, ledger_policy_hmac=hmac)
        await self.db.commit()
        await self.db.refresh(wallet_signer)

        return wallet_signer

    async def sync_wallet_policy(self, wallet_id: str, safe_info: dict) -> None:
        """Sync wallet policy from on-chain Safe state.

        Updates threshold, signer_count, and WalletSigner associations
        to match the on-chain owners/threshold.

        Args:
            wallet_id: Wallet ID to sync.
            safe_info: Dict with 'owners' (list[str]) and 'threshold' (int).
        """
        wallet = await self.get_wallet(wallet_id)

        owners: list[str] = safe_info["owners"]
        threshold: int = safe_info["threshold"]

        # Update wallet scalars
        wallet.threshold = threshold
        wallet.signer_count = len(owners)

        # Delete all existing WalletSigner associations for this wallet
        await self.db.execute(
            delete(WalletSigner).where(WalletSigner.wallet_id == wallet_id)
        )

        # Recreate associations from on-chain owner list
        for i, owner in enumerate(owners):
            addr = owner.lower()
            signer_stmt = select(Signer).where(
                func.lower(Signer.address) == addr,
                Signer.chain_type == ChainType.EVM,
                Signer.deleted_at.is_(None),
            )
            signer_result = await self.db.execute(signer_stmt)
            existing = signer_result.scalar_one_or_none()

            if existing:
                signer = existing
            else:
                signer = Signer(
                    name=f"Imported Signer {i + 1}",
                    device_type=DeviceType.UNKNOWN,
                    chain_type=ChainType.EVM,
                    address=addr,
                    status=SignerStatus.UNVERIFIED,
                )
                self.db.add(signer)
                await self.db.flush()

            ws = WalletSigner(
                wallet_id=wallet.id,
                signer_id=signer.id,
                order_index=i,
            )
            self.db.add(ws)

        await self.db.flush()
