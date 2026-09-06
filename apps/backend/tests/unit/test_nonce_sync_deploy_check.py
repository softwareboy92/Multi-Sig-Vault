"""Tests for NonceSyncWorker PENDING_DEPLOY wallet auto-activation."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from multivault.models.wallet import Wallet, WalletStatus
from multivault.models.signer import ChainType


@pytest.mark.asyncio
async def test_pending_deploy_wallet_with_code_is_activated():
    """If eth_getCode returns non-empty code, wallet should be auto-activated."""
    wallet = MagicMock(spec=Wallet)
    wallet.id = "wallet-1"
    wallet.chain_type = ChainType.EVM
    wallet.status = WalletStatus.PENDING_DEPLOY
    wallet.network_id = "net-1"
    wallet.extra = {
        "predicted_address": "0xDeployedAddress",
        "salt": "42",
        "factory_address": "0xFactory",
    }

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [wallet]
    mock_session.execute.return_value = mock_result

    # Mock Web3Client with async context and web3.eth.get_code
    mock_web3 = MagicMock()
    mock_web3.eth.get_code = AsyncMock(return_value=b"\x60\x80\x60\x40")  # non-empty

    mock_client_instance = AsyncMock()
    mock_client_instance.web3 = mock_web3

    mock_wallet_service = AsyncMock()

    # Mock the node returned by NetworkService
    mock_node = MagicMock()
    mock_node.endpoint_url = "http://rpc"

    from multivault.workers.nonce_sync import SafeNonceSyncWorker

    worker = SafeNonceSyncWorker.__new__(SafeNonceSyncWorker)

    with patch("multivault.workers.nonce_sync.NetworkService") as MockNetSvc, \
         patch("multivault.workers.nonce_sync.Web3Client", return_value=mock_client_instance), \
         patch("multivault.workers.nonce_sync.WalletService", return_value=mock_wallet_service):
        MockNetSvc.return_value.get_default_node = AsyncMock(return_value=mock_node)
        result = await worker._check_pending_deploy_wallets(mock_session)

    assert result == 1
    mock_wallet_service.activate_wallet.assert_called_once_with(
        wallet_id="wallet-1",
        address="0xDeployedAddress",
        tx_hash=None,
        salt="42",
        factory_address="0xFactory",
    )


@pytest.mark.asyncio
async def test_pending_deploy_wallet_without_code_is_skipped():
    """If eth_getCode returns empty bytes (no code), wallet should not be activated."""
    wallet = MagicMock(spec=Wallet)
    wallet.id = "wallet-2"
    wallet.chain_type = ChainType.EVM
    wallet.status = WalletStatus.PENDING_DEPLOY
    wallet.network_id = "net-1"
    wallet.extra = {"predicted_address": "0xNotDeployed"}

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [wallet]
    mock_session.execute.return_value = mock_result

    mock_web3 = MagicMock()
    mock_web3.eth.get_code = AsyncMock(return_value=b"")  # empty = no code

    mock_client_instance = AsyncMock()
    mock_client_instance.web3 = mock_web3

    mock_wallet_service = AsyncMock()

    mock_node = MagicMock()
    mock_node.endpoint_url = "http://rpc"

    from multivault.workers.nonce_sync import SafeNonceSyncWorker

    worker = SafeNonceSyncWorker.__new__(SafeNonceSyncWorker)

    with patch("multivault.workers.nonce_sync.NetworkService") as MockNetSvc, \
         patch("multivault.workers.nonce_sync.Web3Client", return_value=mock_client_instance), \
         patch("multivault.workers.nonce_sync.WalletService", return_value=mock_wallet_service):
        MockNetSvc.return_value.get_default_node = AsyncMock(return_value=mock_node)
        result = await worker._check_pending_deploy_wallets(mock_session)

    assert result == 0
    mock_wallet_service.activate_wallet.assert_not_called()


@pytest.mark.asyncio
async def test_pending_deploy_wallet_no_predicted_address_is_skipped():
    """Wallets without predicted_address in extra should be skipped."""
    wallet = MagicMock(spec=Wallet)
    wallet.id = "wallet-3"
    wallet.extra = {}

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [wallet]
    mock_session.execute.return_value = mock_result

    from multivault.workers.nonce_sync import SafeNonceSyncWorker

    worker = SafeNonceSyncWorker.__new__(SafeNonceSyncWorker)

    with patch("multivault.workers.nonce_sync.NetworkService"), \
         patch("multivault.workers.nonce_sync.Web3Client") as MockClient, \
         patch("multivault.workers.nonce_sync.WalletService") as MockWalletSvc:
        result = await worker._check_pending_deploy_wallets(mock_session)

    assert result == 0
    MockClient.return_value.connect.assert_not_called()
    MockWalletSvc.return_value.activate_wallet.assert_not_called()
