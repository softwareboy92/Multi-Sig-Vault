"""Safe Nonce synchronization worker for EVM wallets."""

import asyncio
from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.wallet import Wallet, WalletStatus
from multivault.models.signer import ChainType
from multivault.chains.evm import SafeManager, Web3Client
from multivault.services.transaction_service import TransactionService
from multivault.services.network_service import NetworkService
from multivault.services.wallet_service import WalletService
from multivault.workers.base import BaseWorker


logger = structlog.get_logger(__name__)


class SafeNonceSyncWorker(BaseWorker):
    """
    Worker to synchronize Safe nonce state for EVM wallets.
    
    Tasks:
    1. Periodically check all active EVM Safe wallets
    2. Get on-chain nonce for each wallet
    3. Mark transactions with stale nonces as FAILED
    4. Log sync results
    
    Run interval: Every 5 minutes (300 seconds)
    """

    def __init__(
        self,
        session_maker,
        interval_seconds: float = 300.0,  # 5 minutes
        batch_size: int = 10,  # Process wallets in batches
    ):
        super().__init__(
            interval_seconds=interval_seconds,
            name="SafeNonceSyncWorker",
        )
        self.session_maker = session_maker
        self.batch_size = batch_size

    async def execute(self) -> None:
        """Execute one iteration of nonce synchronization."""
        async with self.session_maker() as session:
            try:
                wallets_synced = await self._sync_all_wallets(session)
                logger.info(
                    "safe_nonce_sync_completed",
                    wallets_synced=wallets_synced,
                )
                deploy_activated = await self._check_pending_deploy_wallets(session)
                if deploy_activated:
                    logger.info("pending_deploy_auto_activated", count=deploy_activated)
            except Exception as e:
                logger.error(
                    "safe_nonce_sync_failed",
                    error=str(e),
                    exc_info=True,
                )

    async def _sync_all_wallets(self, session: AsyncSession) -> int:
        """
        Sync nonces for all active EVM Safe wallets.
        
        Returns:
            Number of wallets successfully synced
        """
        # Query all active EVM wallets with deployed addresses
        stmt = select(Wallet).where(
            Wallet.chain_type == ChainType.EVM,
            Wallet.status == WalletStatus.ACTIVE,
            Wallet.address.isnot(None),
            Wallet.deleted_at.is_(None),
        )
        result = await session.execute(stmt)
        wallets = result.scalars().all()

        if not wallets:
            logger.debug("no_active_evm_wallets_to_sync")
            return 0

        logger.info("syncing_safe_nonces", wallet_count=len(wallets))

        synced_count = 0
        for wallet in wallets:
            try:
                stale_count = await self._sync_wallet_nonces(session, wallet)
                if stale_count > 0:
                    logger.info(
                        "wallet_nonces_synced",
                        wallet_id=wallet.id,
                        wallet_name=wallet.name,
                        stale_transactions=stale_count,
                    )
                synced_count += 1
            except Exception as e:
                logger.error(
                    "wallet_nonce_sync_failed",
                    wallet_id=wallet.id,
                    wallet_name=wallet.name,
                    error=str(e),
                )
                # Continue with other wallets even if one fails
                continue

        return synced_count

    async def _sync_wallet_nonces(
        self,
        session: AsyncSession,
        wallet: Wallet,
    ) -> int:
        """
        Sync nonces for a single wallet.
        
        Returns:
            Number of stale transactions marked as failed
        """
        # Get network configuration
        network_service = NetworkService(session)
        rpc_url = None
        
        if wallet.network_id:
            try:
                node = await network_service.get_default_node(wallet.network_id)
                rpc_url = node.endpoint_url if node else None
            except Exception as e:
                logger.warning(
                    "failed_to_get_network_config",
                    wallet_id=wallet.id,
                    network_id=wallet.network_id,
                    error=str(e),
                )
        
        # Require RPC URL from database
        if not rpc_url:
            logger.warning(
                "safe_nonce_sync_skip_no_rpc",
                wallet_id=wallet.id,
                wallet_address=wallet.address,
                network_id=wallet.network_id,
            )
            return
        
        client = Web3Client(rpc_url=rpc_url)
        
        try:
            await client.connect()
            safe_manager = SafeManager(client=client)
            
            # Get on-chain nonce
            on_chain_nonce = await safe_manager.get_nonce(wallet.address)
            
            # Sync using transaction service
            tx_service = TransactionService(session)
            stale_count = await tx_service.sync_safe_nonces(
                wallet.id,
                on_chain_nonce,
            )
            
            return stale_count
            
        finally:
            await client.disconnect()

    async def _check_pending_deploy_wallets(
        self,
        session: AsyncSession,
    ) -> int:
        """Check PENDING_DEPLOY wallets for on-chain deployment and auto-activate."""
        stmt = select(Wallet).where(
            Wallet.chain_type == ChainType.EVM,
            Wallet.status == WalletStatus.PENDING_DEPLOY,
            Wallet.deleted_at.is_(None),
        )
        result = await session.execute(stmt)
        pending_wallets = result.scalars().all()

        activated = 0
        for wallet in pending_wallets:
            predicted_address = wallet.extra.get("predicted_address") if wallet.extra else None
            if not predicted_address:
                continue
            try:
                network_service = NetworkService(session)
                node = await network_service.get_default_node(wallet.network_id)
                rpc_url = node.endpoint_url if node else None
                if not rpc_url:
                    continue

                client = Web3Client(rpc_url=rpc_url)
                await client.connect()
                try:
                    code = await client.web3.eth.get_code(predicted_address)
                finally:
                    await client.disconnect()

                if code and len(code) > 0:
                    wallet_service = WalletService(session)
                    await wallet_service.activate_wallet(
                        wallet_id=wallet.id,
                        address=predicted_address,
                        tx_hash=None,
                        salt=wallet.extra.get("salt") if wallet.extra else None,
                        factory_address=wallet.extra.get("factory_address") if wallet.extra else None,
                    )
                    logger.info(
                        "auto_activated_deployed_wallet",
                        wallet_id=wallet.id,
                        address=predicted_address,
                    )
                    activated += 1
            except Exception as e:
                logger.error(
                    "pending_deploy_check_failed",
                    wallet_id=wallet.id,
                    error=str(e),
                )
                continue
        return activated
