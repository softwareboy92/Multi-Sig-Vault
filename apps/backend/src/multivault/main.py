"""FastAPI application entry point."""

import os
from pathlib import Path

import structlog
from contextlib import asynccontextmanager
from typing import IO, AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from multivault.services.network_service import NetworkService
from multivault.utils.chain_info import get_native_coin_info
from multivault.api.router import api_router
from multivault.config import get_settings
from multivault.errors.exceptions import MultiVaultError
from multivault.models.base import Base, get_engine, get_session_maker
from multivault.models.network import NetworkConfig, NetworkNodeConfig, parse_electrum_url, build_electrum_url
from sqlalchemy import select
import json
from multivault.chains.bitcoin.adapter import BitcoinAdapter
from multivault.chains.bitcoin.address import BitcoinNetwork
from multivault.schemas.common import ErrorDetail, ErrorResponse, ResponseMeta
from multivault.workers import (
    WorkerManager,
    BalanceSyncWorker,
    EVMEventIndexer,
    EVMBlockConfirmationWorker,
    BTCConfirmationWorker,
    SafeNonceSyncWorker,
    UTXOSyncWorker,
)

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer() if get_settings().debug else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


def _acquire_worker_lock(data_dir: Path) -> tuple[IO[str] | None, bool]:
    """Acquire an exclusive lock for background workers.

    Returns (lock_handle, acquired). When not acquired, workers should be skipped.
    """
    disable_workers = os.environ.get("DISABLE_BACKGROUND_WORKERS", "false").lower()
    if disable_workers in {"1", "true", "yes"}:
        logger.info("workers_disabled_by_env")
        return None, False

    lock_path = data_dir / "workers.lock"
    try:
        import fcntl
    except Exception:  # noqa: BLE001
        logger.warning("workers_lock_unavailable", path=str(lock_path))
        return None, True

    lock_handle = lock_path.open("w")
    try:
        fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        logger.info("workers_lock_acquired", path=str(lock_path))
        return lock_handle, True
    except BlockingIOError:
        logger.info("workers_lock_busy", path=str(lock_path))
        lock_handle.close()
        return None, False


def _acquire_db_init_lock(data_dir: Path) -> IO[str] | None:
    """Acquire an exclusive lock for database initialization.

    Returns lock handle. Blocks until lock is acquired to avoid concurrent DDL.
    """
    lock_path = data_dir / "db_init.lock"
    try:
        import fcntl
    except Exception:  # noqa: BLE001
        logger.warning("db_init_lock_unavailable", path=str(lock_path))
        return None

    lock_handle = lock_path.open("w")
    fcntl.flock(lock_handle, fcntl.LOCK_EX)
    logger.info("db_init_lock_acquired", path=str(lock_path))
    return lock_handle


class LegacyV1PathMiddleware:
    """Rewrite legacy /v1 paths to /api/v1."""

    def __init__(self, app: FastAPI) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[override]
        if scope.get("type") == "http":
            path = scope.get("path", "")
            if path == "/v1" or path.startswith("/v1/"):
                scope = dict(scope)
                scope["path"] = path.replace("/v1", "/api/v1", 1)
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager for startup and shutdown events."""
    settings = get_settings()
    logger.info(
        "starting_application",
        app_name=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
    )

    # Ensure data directory exists before database initialization
    _ = settings.data_dir  # This creates the directory if it doesn't exist

    # Initialize database tables
    engine = get_engine()
    db_lock_handle = None
    if settings.database_url.startswith("sqlite"):
        db_lock_handle = _acquire_db_init_lock(settings.data_dir)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("database_initialized")

    async def ensure_default_networks() -> None:
        """Seed default EVM and BTC networks if none exist for each chain type."""
        async with get_session_maker()() as session:
            service = NetworkService(session)

            # --- EVM defaults ---
            existing_evm = await service.list_networks(chain_type="EVM")
            if not existing_evm:
                evm_defaults = [
                    ("Ethereum", 1, "https://etherscan.io", False, "https://ethereum-rpc.publicnode.com"),
                    ("Ethereum Sepolia", 11155111, "https://sepolia.etherscan.io", True, "https://ethereum-sepolia-rpc.publicnode.com"),
                    ("BNB Smart Chain Mainnet", 56, "https://bscscan.com", False, "https://bsc-rpc.publicnode.com"),
                    ("Polygon Mainnet", 137, "https://polygonscan.com", False, "https://polygon-bor-rpc.publicnode.com"),
                ]
                for name, chain_id, explorer_url, is_testnet, rpc_url in evm_defaults:
                    try:
                        coin = get_native_coin_info("EVM", chain_id)
                        network = await service.create_network(
                            chain_type="EVM",
                            name=name,
                            explorer_url=explorer_url,
                            enabled=True,
                            is_testnet=is_testnet,
                            extra={
                                "chain_id": chain_id,
                                "native_currency": {
                                    "name": coin["name"],
                                    "symbol": coin["symbol"],
                                    "decimals": coin["decimals"],
                                },
                            },
                        )
                        await service.create_node(
                            network=network,
                            node_type="JSON_RPC",
                            endpoint_url=rpc_url,
                            priority=500,
                            enabled=True,
                        )
                        logger.info("default_network_created", chain_type="EVM", name=name, chain_id=chain_id)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("default_network_create_failed", chain_type="EVM", name=name, error=str(exc))

            # --- Backfill native_currency for existing EVM networks ---
            all_evm = existing_evm or await service.list_networks(chain_type="EVM")
            for net in all_evm:
                extra_data = json.loads(net.extra) if isinstance(net.extra, str) else (net.extra or {})
                chain_id = extra_data.get("chain_id")
                if chain_id and "native_currency" not in extra_data:
                    coin = get_native_coin_info("EVM", chain_id)
                    extra_data["native_currency"] = {
                        "name": coin["name"],
                        "symbol": coin["symbol"],
                        "decimals": coin["decimals"],
                    }
                    try:
                        await service.update_network(
                            network=net,
                            name=net.name,
                            explorer_url=net.explorer_url,
                            enabled=net.enabled,
                            is_testnet=net.is_testnet,
                            extra=extra_data,
                        )
                        logger.info("evm_native_currency_backfilled", name=net.name, chain_id=chain_id)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("evm_native_currency_backfill_failed", name=net.name, error=str(exc))

            # --- BTC defaults ---
            existing_btc = await service.list_networks(chain_type="BTC")
            if not existing_btc:
                btc_defaults = [
                    ("Bitcoin Mainnet", "mainnet", "https://mempool.space/", False,
                     [("electrum.blockstream.info", 50002, True)]),
                    ("Bitcoin Testnet3", "testnet3", "https://mempool.space/testnet", True,
                     [("electrum.blockstream.info", 60002, True)]),
                    ("Bitcoin Testnet4", "testnet4", "https://mempool.space/testnet4", True,
                     [("testnet4-electrumx.wakiyamap.dev", 51002, True)]),
                ]
                for name, btc_network_name, explorer_url, is_testnet, nodes in btc_defaults:
                    try:
                        network = await service.create_network(
                            chain_type="BTC",
                            name=name,
                            explorer_url=explorer_url,
                            enabled=True,
                            is_testnet=is_testnet,
                            extra={"btc_network": btc_network_name},
                        )
                        for host, port, ssl in nodes:
                            await service.create_node(
                                network=network,
                                node_type="ELECTRUM",
                                endpoint_url=build_electrum_url(host, port, ssl),
                                priority=500,
                                enabled=True,
                            )
                        logger.info("default_network_created", chain_type="BTC", name=name, btc_network=btc_network_name)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("default_network_create_failed", chain_type="BTC", name=name, error=str(exc))

    await ensure_default_networks()

    # Initialize and start background workers (single-process lock)
    worker_manager = WorkerManager()
    session_factory = get_session_maker()
    worker_lock_handle, should_start_workers = _acquire_worker_lock(settings.data_dir)

    btc_adapters: dict[str, BitcoinAdapter] = {}
    btc_networks_by_id: dict[str, NetworkConfig] = {}
    btc_nodes_by_network_id: dict[str, NetworkNodeConfig] = {}

    def get_btc_adapter(network_id: str | None) -> BitcoinAdapter | None:
        """Get a connected-capable BitcoinAdapter for a specific BTC network.

        NOTE: This is intentionally synchronous (no DB access). It relies on
        startup-time caching of enabled BTC networks + their default nodes.
        """
        nonlocal btc_adapters
        nonlocal btc_networks_by_id
        nonlocal btc_nodes_by_network_id

        resolved_network_id = network_id
        if not resolved_network_id:
            resolved_network_id = next(iter(btc_nodes_by_network_id.keys()), None)

        if not resolved_network_id:
            structlog.get_logger(__name__).warning(
                "btc_worker_disabled",
                reason="No enabled Bitcoin network with default node configured",
            )
            return None

        existing = btc_adapters.get(resolved_network_id)
        if existing is not None:
            return existing

        network_config = btc_networks_by_id.get(resolved_network_id)
        node_config = btc_nodes_by_network_id.get(resolved_network_id)
        if not (network_config and node_config):
            structlog.get_logger(__name__).warning(
                "btc_adapter_unavailable",
                network_id=resolved_network_id,
                reason="Missing network or default node",
            )
            return None

        extra = json.loads(network_config.extra) if network_config.extra else {}
        btc_net_name = extra.get("btc_network", "")
        btc_network = (
            BitcoinNetwork.TESTNET
            if network_config.is_testnet or "test" in btc_net_name.lower()
            else BitcoinNetwork.MAINNET
        )

        host, port, ssl = parse_electrum_url(node_config.endpoint_url)
        adapter = BitcoinAdapter(
            electrum_host=host,
            electrum_port=port,
            electrum_ssl=ssl,
            network=btc_network,
        )
        btc_adapters[resolved_network_id] = adapter
        return adapter

    if should_start_workers:
        # Add workers based on configuration
        worker_manager.add(
            BTCConfirmationWorker(
                session_factory=session_factory,
                get_adapter=get_btc_adapter,
            )
        )

        async with session_factory() as session:
            result = await session.execute(
                select(NetworkConfig).where(
                    NetworkConfig.chain_type == "EVM",
                    NetworkConfig.enabled.is_(True),
                )
            )
            evm_networks = list(result.scalars().all())

            # Cache enabled BTC networks and their default nodes
            result = await session.execute(
                select(NetworkConfig).where(
                    NetworkConfig.chain_type == "BTC",
                    NetworkConfig.enabled.is_(True),
                )
            )
            btc_networks = list(result.scalars().all())
            if btc_networks:
                service = NetworkService(session)
                for net in btc_networks:
                    btc_networks_by_id[net.id] = net
                    node = await service.get_default_node(net.id)
                    if node:
                        btc_nodes_by_network_id[net.id] = node
                    else:
                        logger.warning(
                            "btc_network_no_default_node",
                            network_id=net.id,
                            name=net.name,
                        )

        # Add UTXO sync worker for BTC wallets
        if btc_networks:
            worker_manager.add(
                UTXOSyncWorker(
                    session_factory=session_factory,
                    get_adapter=get_btc_adapter,
                    interval_seconds=30.0,
                )
            )

        # Add EVM workers for configured networks, fallback to settings
        if evm_networks:
            async with session_factory() as session:
                service = NetworkService(session)
                for network in evm_networks:
                    node = await service.get_default_node(network.id)
                    if not node:
                        logger.warning(
                            "no_default_rpc_node",
                            network_id=network.id,
                            network_name=network.name,
                        )
                        continue
                    rpc_url = node.endpoint_url
                    extra = json.loads(network.extra) if network.extra else {}
                    chain_id = extra.get("chain_id")
                    if not chain_id:
                        logger.warning("evm_network_missing_chain_id", network_id=network.id)
                        continue
                    worker_manager.add(
                        BalanceSyncWorker(
                            session_factory=session_factory,
                            rpc_url=rpc_url,
                            chain_id=chain_id,
                            interval_seconds=settings.sync_interval_seconds,
                        )
                    )
                    worker_manager.add(
                        EVMEventIndexer(
                            session_factory=session_factory,
                            rpc_url=rpc_url,
                            chain_id=chain_id,
                            interval_seconds=15.0,
                        )
                    )
                    worker_manager.add(
                        EVMBlockConfirmationWorker(
                            session_factory=session_factory,
                            rpc_url=rpc_url,
                            chain_id=chain_id,
                            interval_seconds=30.0,
                        )
                    )
        else:
            structlog.get_logger(__name__).info(
                "evm_workers_info",
                message="No enabled EVM networks found, EVM workers not started"
            )

        # Add Safe Nonce Sync Worker for all EVM wallets
        worker_manager.add(
            SafeNonceSyncWorker(
                session_maker=session_factory,
                interval_seconds=300.0,  # 5 minutes
            )
        )

        # Start all workers
        await worker_manager.start_all()
        logger.info("workers_started", count=len(worker_manager.workers))

        # Store worker manager in app state for access from endpoints
        app.state.worker_manager = worker_manager
    else:
        logger.info("workers_skipped")

    yield

    # Stop workers gracefully
    if should_start_workers:
        await worker_manager.stop_all(timeout=10.0)
        logger.info("workers_stopped")
    if worker_lock_handle:
        try:
            worker_lock_handle.close()
        except Exception:  # noqa: BLE001
            logger.warning("workers_lock_release_failed")
    if db_lock_handle:
        try:
            db_lock_handle.close()
        except Exception:  # noqa: BLE001
            logger.warning("db_init_lock_release_failed")

    # Cleanup on shutdown
    await engine.dispose()
    logger.info("application_shutdown")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Non-custodial multisig wallet manager for Bitcoin and EVM chains",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
        lifespan=lifespan,
    )

    # CORS middleware for development
    if settings.environment == "development":
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Include API router
    app.include_router(api_router)

    # Legacy path compatibility (/v1 -> /api/v1)
    app.add_middleware(LegacyV1PathMiddleware)  # type: ignore[arg-type]

    # Exception handlers
    @app.exception_handler(MultiVaultError)
    async def multivault_exception_handler(
        request: Request,
        exc: MultiVaultError,
    ) -> JSONResponse:
        """Handle custom MultiVault exceptions."""
        logger.warning(
            "api_error",
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
            path=request.url.path,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                error=ErrorDetail(
                    code=exc.error_code,
                    message=exc.message,
                    details=exc.details,
                ),
                meta=ResponseMeta(),
            ).model_dump(mode="json"),
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        """Handle unexpected exceptions."""
        logger.exception(
            "unhandled_exception",
            error=str(exc),
            path=request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="INTERNAL_ERROR",
                    message="An internal error occurred",
                ),
                meta=ResponseMeta(),
            ).model_dump(mode="json"),
        )

    return app


# Create application instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "multivault.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
