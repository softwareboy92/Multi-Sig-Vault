"""Asset service for balance queries and sync."""

from datetime import UTC, datetime
from decimal import Decimal

import structlog

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.errors.exceptions import NotFoundError, ValidationError
from multivault.models.asset import Asset
from multivault.models.signer import ChainType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.services.network_service import NetworkService

logger = structlog.get_logger(__name__)


class AssetService:
    """Service for asset balance operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_wallet_assets(self, wallet_id: str) -> list[Asset]:
        """Get all assets for a wallet.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            List of Asset models
        """
        stmt = select(Asset).where(Asset.wallet_id == wallet_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def add_token(
        self,
        wallet_id: str,
        contract_address: str,
        symbol: str | None = None,
        name: str | None = None,
        decimals: int | None = None,
    ) -> Asset:
        """Add an ERC20 token to wallet's asset list.

        If symbol/name/decimals not provided, will query from chain.

        Args:
            wallet_id: The wallet's UUID
            contract_address: Token contract address
            symbol: Optional token symbol
            name: Optional token name
            decimals: Optional token decimals

        Returns:
            Created Asset model
        """
        from multivault.chains.evm import Web3Client
        from multivault.config import get_settings

        # Get wallet
        stmt = select(Wallet).where(
            Wallet.id == wallet_id,
            Wallet.status != WalletStatus.ARCHIVED,
        )
        result = await self.db.execute(stmt)
        wallet = result.scalar_one_or_none()

        if not wallet:
            raise NotFoundError("Wallet", wallet_id)

        chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
        if chain_type != ChainType.EVM.value:
            raise ValidationError(
                message="Token import only supported for EVM wallets",
                details={"chain_type": chain_type},
            )

        # Normalize address
        from web3 import Web3
        try:
            contract_address = Web3.to_checksum_address(contract_address)
        except Exception as exc:
            raise ValidationError(
                message="Invalid token contract address",
                details={"contract_address": contract_address},
            ) from exc

        # Check if already exists
        stmt = select(Asset).where(
            Asset.wallet_id == wallet_id,
            Asset.contract_address == contract_address,
        )
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            raise ValidationError(
                message="Token already added to wallet",
                details={"contract_address": contract_address},
            )

        # Query token info from chain if not provided
        if not symbol or not name or decimals is None:
            rpc_url = await self._get_evm_rpc_url(wallet)
            if not rpc_url:
                raise ValidationError(
                    message="No RPC URL configured for wallet's network",
                    details={"wallet_id": wallet.id, "network_id": wallet.network_id},
                )
            client = Web3Client(rpc_url=rpc_url)
            await client.connect()
            try:
                token_info = await client.get_erc20_info(contract_address)
                symbol = symbol or token_info.get("symbol", "UNKNOWN")
                name = name or token_info.get("name", "Unknown Token")
                decimals = decimals if decimals is not None else token_info.get("decimals", 18)
            finally:
                await client.disconnect()

        # Create asset with 0 balance (will be synced later)
        asset = Asset(
            wallet_id=wallet_id,
            symbol=symbol,
            name=name,
            contract_address=contract_address,
            decimals=decimals,
            balance="0",
            last_synced_at=None,
        )
        self.db.add(asset)
        await self.db.commit()
        await self.db.refresh(asset)

        return asset

    async def sync_wallet_assets(self, wallet_id: str) -> list[Asset]:
        """Sync assets for a wallet from chain.

        Queries the blockchain for current balances and updates the database.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            Updated list of Asset models

        Raises:
            NotFoundError: If wallet not found
            ValidationError: If wallet not active
        """
        # Get wallet
        stmt = select(Wallet).where(
            Wallet.id == wallet_id,
            Wallet.status != WalletStatus.ARCHIVED,
        )
        result = await self.db.execute(stmt)
        wallet = result.scalar_one_or_none()

        if not wallet:
            raise NotFoundError("Wallet", wallet_id)

        # Get chain type and status
        chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
        status = wallet.status.value if hasattr(wallet.status, "value") else str(wallet.status)

        if status != WalletStatus.ACTIVE.value:
            raise ValidationError(
                message="Cannot sync assets for non-active wallet",
                details={"status": status},
            )

        if not wallet.address:
            raise ValidationError(
                message="Wallet has no address",
                details={"wallet_id": wallet_id},
            )

        if chain_type == ChainType.EVM.value:
            return await self._sync_evm_assets(wallet)
        else:
            # BTC: placeholder
            return await self._sync_btc_assets(wallet)

    async def _sync_evm_assets(self, wallet: Wallet) -> list[Asset]:
        """Sync EVM assets using Multicall3.

        Queries balances for:
        1. Native coin (ETH/BNB/MATIC/etc.)
        2. Existing ERC20 tokens already in the wallet's asset list
        3. Preset well-known tokens not yet in the asset list (auto-discovery)

        Only preset tokens with balance > 0 are written to the database.
        """
        from multivault.chains.evm import BalanceQuery, Multicall3, Web3Client
        from multivault.chains.evm.token_registry import get_preset_tokens
        from multivault.utils.chain_info import get_native_coin_info
        from multivault.utils.extra import get_extra_field

        rpc_url = await self._get_evm_rpc_url(wallet)
        if not rpc_url:
            raise ValidationError(
                message="No RPC URL configured for wallet's network",
                details={"wallet_id": wallet.id, "network_id": wallet.network_id},
            )
        client = Web3Client(rpc_url=rpc_url)
        await client.connect()

        try:
            multicall = Multicall3(client)

            # Resolve chain_id from network (avoid lazy load in async)
            chain_id = None
            if wallet.network_id:
                network_service = NetworkService(self.db)
                network = await network_service.get_network(wallet.network_id)
                if network:
                    chain_id = get_extra_field(network, "chain_id")

            # Get existing ERC20 tokens for this wallet
            stmt = select(Asset).where(
                Asset.wallet_id == wallet.id,
                Asset.contract_address.isnot(None),
            )
            result = await self.db.execute(stmt)
            erc20_assets = list(result.scalars().all())

            # Discover preset tokens not yet in wallet's asset list
            existing_addresses = {
                a.contract_address.lower()
                for a in erc20_assets
                if a.contract_address
            }
            preset_tokens = get_preset_tokens(chain_id) if chain_id else []
            discovery_tokens = [
                t for t in preset_tokens
                if t.address.lower() not in existing_addresses
            ]

            # Build queries: native + existing ERC20 + discovery tokens
            queries = [BalanceQuery(address=wallet.address, token=None, decimals=18)]
            for asset in erc20_assets:
                queries.append(
                    BalanceQuery(
                        address=wallet.address,
                        token=asset.contract_address,
                        decimals=asset.decimals,
                    )
                )
            discovery_start_idx = len(queries)
            for token in discovery_tokens:
                queries.append(
                    BalanceQuery(
                        address=wallet.address,
                        token=token.address,
                        decimals=token.decimals,
                    )
                )

            # Execute batch query
            balance_results = await multicall.get_balances(queries)

            # Process native balance
            if balance_results and balance_results[0].success:
                native_balance = balance_results[0].balance
            else:
                # Fallback: query directly via Web3
                native_balance = await client.get_balance(wallet.address)

            native_info = get_native_coin_info("EVM", chain_id=chain_id)

            native_asset = await self._upsert_asset(
                wallet_id=wallet.id,
                symbol=native_info["symbol"],
                name=native_info["name"],
                contract_address=None,
                decimals=native_info["decimals"],
                balance=str(native_balance),
            )

            synced_assets = [native_asset]

            # Update existing ERC20 assets
            for i, asset in enumerate(erc20_assets):
                result_idx = i + 1  # Skip native balance at index 0
                if result_idx < len(balance_results) and balance_results[result_idx].success:
                    token_balance = balance_results[result_idx].balance
                else:
                    token_balance = 0

                updated_asset = await self._upsert_asset(
                    wallet_id=wallet.id,
                    symbol=asset.symbol,
                    name=asset.name,
                    contract_address=asset.contract_address,
                    decimals=asset.decimals,
                    balance=str(token_balance),
                )
                synced_assets.append(updated_asset)

            # Auto-discover preset tokens with non-zero balance
            for i, token in enumerate(discovery_tokens):
                result_idx = discovery_start_idx + i
                if (
                    result_idx < len(balance_results)
                    and balance_results[result_idx].success
                    and balance_results[result_idx].balance > 0
                ):
                    discovered_asset = await self._upsert_asset(
                        wallet_id=wallet.id,
                        symbol=token.symbol,
                        name=token.name,
                        contract_address=token.address,
                        decimals=token.decimals,
                        balance=str(balance_results[result_idx].balance),
                    )
                    synced_assets.append(discovered_asset)

            # Trigger EVM Safe history import as part of asset sync
            # Only attempt for chains supported by Safe Transaction Service
            if chain_id:
                from multivault.chains.evm.safe_tx_service import SafeTxServiceClient

                if SafeTxServiceClient(chain_id=chain_id).is_supported():
                    try:
                        from multivault.services.transaction_service import TransactionService

                        tx_service = TransactionService(self.db)
                        await tx_service.import_evm_safe_history(
                            wallet=wallet,
                            chain_id=chain_id,
                            limit=200,
                            include_incoming=True,
                            rpc_url=rpc_url,
                        )
                    except Exception as exc:
                        logger.warning(
                            "evm_safe_history_import_failed",
                            wallet_id=wallet.id,
                            chain_id=chain_id,
                            error=str(exc),
                        )

            return synced_assets

        finally:
            await client.disconnect()

    async def _get_evm_rpc_url(self, wallet: Wallet) -> str | None:
        """Resolve RPC URL for an EVM wallet from configured networks."""
        if wallet.chain_type != ChainType.EVM:
            return None
        if not wallet.network_id:
            return None
        network_service = NetworkService(self.db)
        node = await network_service.get_default_node(wallet.network_id)
        return node.endpoint_url if node else None

    async def _sync_btc_assets(self, wallet: Wallet) -> list[Asset]:
        """Sync BTC assets using Electrum."""
        import json

        from multivault.chains.bitcoin import ElectrumClient
        from multivault.models.network import parse_electrum_url
        from multivault.services.transaction_service import TransactionService

        network_service = NetworkService(self.db)
        
        # Get network config and its default node
        if not wallet.network_id:
            raise ValidationError(
                message="Network ID missing for wallet",
                details={"wallet_id": wallet.id},
            )
        network_config = await network_service.get_network(wallet.network_id)
        btc_node = None
        if network_config:
            btc_node = await network_service.get_default_node(network_config.id)

        if not btc_node:
            raise ValidationError(
                message="No Bitcoin node configured for wallet's network",
                details={"wallet_id": wallet.id, "network_id": wallet.network_id},
            )

        host, port, use_ssl = parse_electrum_url(btc_node.endpoint_url)

        # Use Electrum node from DB config
        client = ElectrumClient(
            host=host,
            port=port,
            use_ssl=use_ssl,
        )
        await client.connect()

        try:
            # Get UTXO balance and cache UTXO details
            utxos = await client.list_unspent(wallet.address)
            total_sats = sum(u.value for u in utxos)

            from datetime import UTC, datetime
            from multivault.utils.extra import set_extra
            utxo_dicts = [
                {"txid": u.txid, "vout": u.vout, "value": u.value, "height": u.height}
                for u in utxos
            ]
            set_extra(
                wallet,
                utxos=utxo_dicts,
                utxos_synced_at=datetime.now(UTC).isoformat(),
            )

            # Update or create BTC asset
            from multivault.utils.chain_info import get_native_coin_info
            btc_info = get_native_coin_info("BTC")

            btc_asset = await self._upsert_asset(
                wallet_id=wallet.id,
                symbol=btc_info["symbol"],
                name=btc_info["name"],
                contract_address=None,
                decimals=btc_info["decimals"],
                balance=str(total_sats),
            )

            # Trigger BTC history import as part of asset sync
            try:
                tx_service = TransactionService(self.db)
                await tx_service.import_btc_history(
                    wallet=wallet,
                    btc_network=network_config,
                    btc_node=btc_node,
                    limit=200,
                    confirmed_only=False,
                )
            except Exception as exc:
                logger.warning(
                    "btc_history_import_failed",
                    wallet_id=wallet.id,
                    error=str(exc),
                )

            return [btc_asset]

        finally:
            await client.disconnect()

    async def _upsert_asset(
        self,
        wallet_id: str,
        symbol: str,
        name: str,
        contract_address: str | None,
        decimals: int,
        balance: str,
    ) -> Asset:
        """Create or update an asset record."""
        # Find existing
        stmt = select(Asset).where(
            Asset.wallet_id == wallet_id,
            Asset.symbol == symbol,
            Asset.contract_address == contract_address if contract_address else Asset.contract_address.is_(None),
        )
        result = await self.db.execute(stmt)
        asset = result.scalar_one_or_none()

        now = datetime.now(UTC)

        if asset:
            # Update existing
            asset.balance = balance
            asset.last_synced_at = now
        else:
            # Create new
            asset = Asset(
                wallet_id=wallet_id,
                symbol=symbol,
                name=name,
                contract_address=contract_address,
                decimals=decimals,
                balance=balance,
                last_synced_at=now,
            )
            self.db.add(asset)

        await self.db.commit()
        await self.db.refresh(asset)

        return asset
