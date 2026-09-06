"""Main API router that aggregates all sub-routers."""

from fastapi import APIRouter

from multivault.api import address_book, assets, backup, networks, pending, prices, signers, simulation, system, transactions, wallets

# Main API router with version prefix
api_router = APIRouter(prefix="/api/v1")

# Include sub-routers
api_router.include_router(system.router, tags=["System"])
api_router.include_router(pending.router, tags=["Pending Actions"])
api_router.include_router(networks.router, prefix="/networks", tags=["Networks"])
api_router.include_router(address_book.router, prefix="/address-book", tags=["AddressBook"])
api_router.include_router(signers.router, prefix="/signers", tags=["Signers"])
api_router.include_router(wallets.router, prefix="/wallets", tags=["Wallets"])
api_router.include_router(transactions.router, prefix="/transactions", tags=["Transactions"])
api_router.include_router(backup.router, tags=["Backup"])

# Nested transaction routes under wallets
api_router.include_router(
    transactions.wallet_router,
    prefix="/wallets/{wallet_id}/transactions",
    tags=["Transactions"],
)

# Policy change routes under wallets
api_router.include_router(
    transactions.policy_router,
    prefix="/wallets/{wallet_id}",
    tags=["Policy"],
)

# Asset routes under wallets
api_router.include_router(
    assets.router,
    prefix="/wallets",
    tags=["Assets"],
)

# Price routes
api_router.include_router(prices.router, prefix="/prices", tags=["Prices"])

# Simulation routes
api_router.include_router(simulation.router, prefix="/simulation", tags=["Simulation"])
