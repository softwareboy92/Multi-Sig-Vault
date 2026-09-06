"""Transaction API endpoints."""

import json
from decimal import Decimal
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    Path,
    Query,
)
from multivault.deps import DbSession
from multivault.models.signer import ChainType
from multivault.models.transaction import TransactionStatus
from multivault.schemas.common import (
    ApiResponse,
    PaginatedResponse,
    PaginationMeta,
)
from multivault.schemas.transaction import (
    BTCBroadcastResponse,
    BtcDecodedTx,
    BTCExecutionData,
    BTCSignerPolicyInfo,
    BTCSigningInfo,
    BtcTxInput,
    BtcTxOutput,
    KeyVaultSigningPayloadResponse,
    PolicyChangeCreate,
    SafeExecutionData,
    SignatureSubmit,
    TransactionCreate,
    TransactionListItem,
    TransactionQuery,
    TransactionResponse,
)
from multivault.services.network_service import NetworkService
from multivault.services.transaction_service import TransactionService
from multivault.services.wallet_service import WalletService
from multivault.utils.address import (
    validate_btc_address,
    validate_evm_address,
)

router = APIRouter()


async def get_transaction_service(db: DbSession) -> TransactionService:
    """Dependency to get transaction service."""
    return TransactionService(db)


async def get_wallet_service(db: DbSession) -> WalletService:
    """Dependency to get wallet service."""
    return WalletService(db)


async def get_network_service(db: DbSession) -> NetworkService:
    """Dependency to get network service."""
    return NetworkService(db)


TransactionServiceDep = Annotated[TransactionService, Depends(get_transaction_service)]
WalletServiceDep = Annotated[WalletService, Depends(get_wallet_service)]
NetworkServiceDep = Annotated[NetworkService, Depends(get_network_service)]


def _transaction_to_response(
    tx,
    can_broadcast: bool | None = None,
    blocking_reason: str | None = None,
) -> TransactionResponse:
    """Convert transaction model to response schema."""
    return TransactionResponse.from_orm_with_signers(tx, can_broadcast, blocking_reason)


def _transaction_to_list_item(tx) -> TransactionListItem:
    """Convert transaction model to list item schema."""
    from multivault.utils.extra import get_extra_field
    return TransactionListItem(
        id=tx.id,
        wallet_id=tx.wallet_id,
        tx_type=tx.tx_type,
        to_address=tx.to_address,
        from_address=get_extra_field(tx, "from_address"),
        amount=tx.amount,
        token_symbol=get_extra_field(tx, "token_symbol"),
        status=tx.status,
        threshold=tx.threshold,
        signature_count=tx.signature_count,
        created_at=tx.created_at,
        confirmed_at=tx.confirmed_at,
        tx_hash=tx.tx_hash,
    )


def _apply_btc_signatures(psbt, signatures) -> None:
    """Apply stored BTC signatures to a PSBT.

    Supports two formats:
    1. Ledger format: JSON [[input_idx, {pubkey: hex, signature: hex}], ...]
    2. KeyVault format: hex/base64 signed PSBT (from nexwallet btc.signTx)
    """
    import json

    import structlog
    from embit.ec import PublicKey
    from multivault.chains.bitcoin.psbt import PSBTBuilder

    log = structlog.get_logger()

    for sig in signatures:
        raw = sig.signature_data.strip()

        # Try Ledger format (JSON array) first
        try:
            sig_data = json.loads(raw)
            if isinstance(sig_data, list):
                for item in sig_data:
                    if not (isinstance(item, list) and len(item) >= 2):
                        continue
                    input_idx = item[0]
                    sig_info = item[1]
                    if not isinstance(sig_info, dict):
                        continue
                    pubkey_hex = sig_info.get("pubkey", "")
                    sig_hex = sig_info.get("signature", "")
                    if not pubkey_hex or not sig_hex:
                        continue
                    if input_idx >= len(psbt.inputs):
                        continue
                    if psbt.inputs[input_idx].partial_sigs is None:
                        psbt.inputs[input_idx].partial_sigs = {}
                    pk = PublicKey.parse(bytes.fromhex(pubkey_hex))
                    psbt.inputs[input_idx].partial_sigs[pk] = bytes.fromhex(sig_hex)
                continue
        except (json.JSONDecodeError, TypeError):
            pass

        # KeyVault format: hex-encoded signed PSBT — extract partial_sigs and apply
        try:
            parse_raw = raw
            if parse_raw.startswith("{"):
                try:
                    wrapped = json.loads(parse_raw)
                    if isinstance(wrapped, dict) and "signature" in wrapped:
                        parse_raw = wrapped["signature"] or ""
                    elif isinstance(wrapped, dict) and "signResult" in wrapped:
                        arr = wrapped.get("signResult")
                        if isinstance(arr, list) and arr and isinstance(arr[0], dict):
                            parse_raw = arr[0].get("signature", "") or ""
                except (json.JSONDecodeError, TypeError):
                    pass

            hex_str = parse_raw.strip()
            if hex_str.startswith("0x") or hex_str.startswith("0X"):
                hex_str = hex_str[2:]
            if not hex_str or len(hex_str) % 2 != 0 or not all(
                c in "0123456789abcdefABCDEF" for c in hex_str
            ):
                psbt_obj = PSBTBuilder.parse(parse_raw)
            else:
                from embit.psbt import PSBT

                psbt_obj = PSBT.parse(bytes.fromhex(hex_str))

            for i, inp in enumerate(psbt_obj.inputs):
                if not inp.partial_sigs or i >= len(psbt.inputs):
                    continue
                if psbt.inputs[i].partial_sigs is None:
                    psbt.inputs[i].partial_sigs = {}
                for pubkey_obj, sig_bytes in inp.partial_sigs.items():
                    psbt.inputs[i].partial_sigs[pubkey_obj] = sig_bytes
        except Exception as e:
            log.warning(
                "btc_signature_parse_failed",
                signer_id=getattr(sig, "signer_id", None),
                error=str(e),
                raw_preview=raw[:80] + "..." if len(raw) > 80 else raw,
            )


# =============================================================================
# Wallet-scoped endpoints (nested under /wallets/{wallet_id}/transactions)
# =============================================================================


wallet_router = APIRouter()
policy_router = APIRouter()


@wallet_router.post("", response_model=ApiResponse[TransactionResponse])
async def create_transaction(
    wallet_id: str = Path(..., description="Wallet UUID"),
    request: TransactionCreate = ...,
    db: DbSession = ...,
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
) -> ApiResponse[TransactionResponse]:
    """Create a new transaction for a wallet.

    The transaction starts in PENDING_SIGN status, ready for signers to submit signatures.
    For EVM wallets, this builds a Safe transaction and returns the hash for signing.
    """
    # Get wallet to determine chain type
    wallet = await wallet_service.get_wallet(wallet_id)

    # Get chain type value
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)

    payload: str
    payload_hash: str | None = None

    if chain_type == ChainType.EVM.value:
        from multivault.errors.exceptions import ValidationError

        try:
            validate_evm_address(request.to_address)
        except ValueError as exc:
            raise ValidationError(message=str(exc), details={"to_address": request.to_address}) from exc

    if chain_type == ChainType.BTC.value:
        from multivault.errors.exceptions import ValidationError

        try:
            btc_network_name = None
            import json as _json
            network_service = NetworkService(db)
            btc_net_cfg = await network_service.get_network(wallet.network_id)
            if btc_net_cfg and btc_net_cfg.extra:
                btc_network_name = _json.loads(btc_net_cfg.extra).get("btc_network")
            validate_btc_address(request.to_address, btc_network_name)
        except ValueError as exc:
            raise ValidationError(message=str(exc), details={"to_address": request.to_address}) from exc

    utxo_inputs = None  # Set by BTC branch only

    if chain_type == ChainType.EVM.value:
        # Build EVM Safe transaction
        from multivault.chains.evm import (
            SafeManager,
            Web3Client,
        )
        network_service = NetworkService(db)
        rpc_url = None
        node = await network_service.get_default_node(wallet.network_id)
        if node:
            rpc_url = node.endpoint_url

        if not rpc_url:
            raise ValidationError(
                message="No RPC URL configured for wallet's network",
                details={"wallet_id": wallet.id, "network_id": wallet.network_id},
            )
        
        client = Web3Client(rpc_url=rpc_url)
        await client.connect()

        # Token info for ERC20 transfers (or native symbol for native transfers)
        token_symbol: str | None = None
        token_decimals: int | None = None

        # Resolve native token symbol from network chain_id
        _evm_native_symbols: dict[int, str] = {
            1: "ETH", 5: "ETH", 11155111: "ETH",
            56: "BNB", 97: "tBNB",
            137: "POL", 80001: "POL",
            42161: "ETH", 421614: "ETH",
            8453: "ETH", 84532: "ETH",
            10: "ETH", 11155420: "ETH",
            43114: "AVAX", 43113: "AVAX",
            250: "FTM", 4002: "FTM",
            61: "ETC",
        }
        _native_network_cfg = await network_service.get_network(wallet.network_id)
        _evm_chain_id: int | None = None
        if _native_network_cfg and _native_network_cfg.extra:
            import json as _json_extra
            _extra_parsed = (
                _json_extra.loads(_native_network_cfg.extra)
                if isinstance(_native_network_cfg.extra, str)
                else _native_network_cfg.extra
            )
            _evm_chain_id = _extra_parsed.get("chain_id")

        try:
            safe_manager = SafeManager(client=client)

            import json

            # Allocate Safe nonce FIRST (before building transaction)
            on_chain_nonce = await safe_manager.get_nonce(wallet.address)
            
            # Sync nonces first (mark stale transactions)
            await tx_service.sync_safe_nonces(wallet.id, on_chain_nonce)
            
            # Allocate next nonce for this transaction
            safe_nonce = await tx_service.allocate_safe_nonce(wallet.id, on_chain_nonce)

            if request.token_address:
                # ERC20 token transfer
                # Build transfer(to, amount) calldata
                from eth_abi import (
                    decode,
                    encode,
                )
                from web3 import Web3

                # Get token decimals (default to 18 if not fetchable)
                token_decimals = 18
                try:
                    # Try to get decimals from contract
                    decimals_data = Web3.keccak(text="decimals()")[:4]
                    result = await client.call(
                        to=request.token_address,
                        data=decimals_data,
                    )
                    if result and len(result) >= 32:
                        (token_decimals,) = decode(["uint8"], result)
                except Exception:
                    pass  # Use default 18

                # Get token symbol
                try:
                    symbol_data = Web3.keccak(text="symbol()")[:4]
                    result = await client.call(
                        to=request.token_address,
                        data=symbol_data,
                    )
                    if result and len(result) >= 32:
                        # Decode string (offset at 32, length at 64, then actual string)
                        (token_symbol,) = decode(["string"], result)
                except Exception:
                    # Fallback: try to extract from address or use generic name
                    token_symbol = "TOKEN"

                # Convert amount to token units
                amount_tokens = int(Decimal(str(request.amount)) * Decimal(10 ** token_decimals))

                # ERC20 transfer(address to, uint256 amount)
                transfer_selector = Web3.keccak(text="transfer(address,uint256)")[:4]
                transfer_data = transfer_selector + encode(
                    ["address", "uint256"],
                    [Web3.to_checksum_address(request.to_address), amount_tokens]
                )

                # Safe transaction: call token contract with transfer data
                safe_tx = await safe_manager.build_safe_transaction(
                    safe_address=wallet.address,
                    to=request.token_address,  # Target is token contract
                    value=0,  # No ETH value for token transfer
                    data=transfer_data,
                    nonce=safe_nonce,  # Use allocated nonce
                )
            else:
                # Native transfer (ETH / BNB / tBNB / POL / …)
                # Resolve native token symbol from chain_id
                if _evm_chain_id is not None:
                    token_symbol = _evm_native_symbols.get(_evm_chain_id, "ETH")
                else:
                    token_symbol = "ETH"

                # Convert amount to wei (amount is in native token with 18 decimals)
                amount_wei = int(Decimal(str(request.amount)) * Decimal("1000000000000000000"))

                # Build Safe transaction
                safe_tx = await safe_manager.build_safe_transaction(
                    safe_address=wallet.address,
                    to=request.to_address,
                    value=amount_wei,
                    nonce=safe_nonce,  # Use allocated nonce
                )

            # Store the Safe tx hash as payload_hash (this is what signers will sign)
            payload_hash = "0x" + safe_tx.tx_hash.hex()

            # Store typed data JSON as payload (for reference)
            payload = json.dumps(safe_tx.get_typed_data())

        finally:
            await client.disconnect()

    else:
        # BTC: Build PSBT using UTXOs from Electrum
        safe_nonce = None  # BTC doesn't use nonces
        from multivault.chains.bitcoin import (
            ElectrumClient,
            PSBTBuilder,
            derive_p2wsh_address,
        )
        from multivault.chains.bitcoin.address import BitcoinNetwork
        from multivault.chains.bitcoin.psbt import (
            InsufficientFundsError,
            KeyOrigin,
            MultisigConfig,
            TxOutput,
        )

        # BTC doesn't have tokens
        token_symbol = None
        token_decimals = None

        # Get BTC network configuration from database
        import json as _json

        from multivault.models.network import parse_electrum_url

        network_service = NetworkService(db)
        btc_network_config = await network_service.get_network(wallet.network_id)
        btc_node = await network_service.get_default_node(wallet.network_id) if btc_network_config else None
        
        if not btc_node:
            raise ValidationError(
                message="No Bitcoin node configured for wallet's network",
                details={"wallet_id": wallet.id, "network_id": wallet.network_id},
            )

        # Determine network from extra metadata
        _extra = _json.loads(btc_network_config.extra) if btc_network_config.extra else {}
        _btc_net_name = _extra.get("btc_network", "")
        btc_network = BitcoinNetwork.TESTNET if "test" in _btc_net_name.lower() else BitcoinNetwork.MAINNET

        # Get public keys and key origins from wallet signers (sorted by order_index)
        public_keys = []
        key_origins = []
        for ws in sorted(wallet.wallet_signers, key=lambda x: x.order_index):
            if ws.signer.public_key:
                public_keys.append(ws.signer.public_key)
                # Add key origin info for BIP32 derivations in PSBT (required for Ledger)
                from multivault.utils.extra import get_extra_field
                signer_mfp = get_extra_field(ws.signer, "master_fingerprint")
                if signer_mfp and ws.signer.derivation_path:
                    from multivault.chains.bitcoin.path import ensure_address_level_path
                    deriv_path = ensure_address_level_path(ws.signer.derivation_path)
                    
                    key_origins.append(KeyOrigin(
                        public_key=ws.signer.public_key,
                        master_fingerprint=signer_mfp,
                        derivation_path=deriv_path,
                    ))

        if len(public_keys) != wallet.signer_count:
            from multivault.errors.exceptions import ValidationError
            raise ValidationError(
                message="Not all signers have public keys",
                details={"expected": wallet.signer_count, "found": len(public_keys)},
            )

        # BTC multisig requires ALL signers to have complete key origin info
        # (xpub, derivation_path, master_fingerprint) for Ledger wallet policy.
        if len(key_origins) != len(public_keys):
            from multivault.errors.exceptions import ValidationError
            missing = []
            for ws in sorted(wallet.wallet_signers, key=lambda x: x.order_index):
                signer_extra = get_extra_field(ws.signer, "master_fingerprint")
                if not signer_extra or not ws.signer.derivation_path:
                    missing.append(ws.signer.name or ws.signer.public_key or ws.signer.id)
            raise ValidationError(
                message="All BTC signers must be verified with complete key origin info (derivation path, master fingerprint, xpub) before creating transactions.",
                details={
                    "expected": len(public_keys),
                    "with_key_origin": len(key_origins),
                    "missing_signers": missing,
                },
            )

        # Build multisig config with key origins for PSBT bip32_derivations
        # Read script_type / redeem_script from wallet extras (set during import)
        from multivault.utils.extra import get_extra_field as _get_extra_field
        wallet_script_type = _get_extra_field(wallet, "script_type") or "p2wsh"
        wallet_redeem_script_hex = _get_extra_field(wallet, "redeem_script")
        wallet_redeem_script = bytes.fromhex(wallet_redeem_script_hex) if wallet_redeem_script_hex else None

        multisig_config = MultisigConfig(
            threshold=wallet.threshold,
            public_keys=public_keys,
            key_origins=key_origins,
            script_type=wallet_script_type,
            redeem_script=wallet_redeem_script,
        )

        # --- UTXO cache + locking ---
        from multivault.chains.bitcoin.electrum import ElectrumUTXO
        from multivault.utils.extra import (
            get_extra,
            set_extra,
        )

        wallet_extra = get_extra(wallet)
        cached_utxos_raw = wallet_extra.get("utxos")

        # Connect to Electrum (needed for raw_txs and fallback)
        _host, _port, _ssl = parse_electrum_url(btc_node.endpoint_url)
        client = ElectrumClient(host=_host, port=_port, use_ssl=_ssl)
        await client.connect()

        try:
            # 1. Read cached UTXOs or fallback to Electrum (None = never synced)
            if cached_utxos_raw is None:
                electrum_utxos = await client.list_unspent(wallet.address)
                cached_utxos_raw = [
                    {"txid": u.txid, "vout": u.vout, "value": u.value, "height": u.height}
                    for u in electrum_utxos
                ]
                # Write cache back
                from datetime import UTC
                from datetime import datetime as dt
                set_extra(wallet, utxos=cached_utxos_raw, utxos_synced_at=dt.now(UTC).isoformat())
                await db.commit()

            # 2. Get locked outpoints from active BTC transactions
            locked_outpoints = await tx_service.get_locked_utxo_outpoints(wallet.id)

            # 3. Filter available UTXOs
            available_utxos = [
                ElectrumUTXO(txid=u["txid"], vout=u["vout"], value=u["value"], height=u.get("height", 0))
                for u in cached_utxos_raw
                if (u["txid"], u["vout"]) not in locked_outpoints
            ]

            # 3b. Custom UTXO selection: validate and narrow to user picks
            if request.selected_utxos:
                from multivault.errors.exceptions import ValidationError
                available_map = {(u.txid, u.vout): u for u in available_utxos}
                picked: list[ElectrumUTXO] = []
                for sel in request.selected_utxos:
                    key = (sel.txid, sel.vout)
                    if key in locked_outpoints:
                        raise ValidationError(
                            message=f"UTXO {sel.txid}:{sel.vout} is locked by a pending transaction.",
                            details={"txid": sel.txid, "vout": sel.vout},
                        )
                    utxo = available_map.get(key)
                    if utxo is None:
                        raise ValidationError(
                            message=f"UTXO {sel.txid}:{sel.vout} not found in wallet.",
                            details={"txid": sel.txid, "vout": sel.vout},
                        )
                    picked.append(utxo)
                available_utxos = picked

            if not available_utxos:
                from multivault.errors.exceptions import ValidationError
                total_cached = len(cached_utxos_raw)
                total_locked = len(locked_outpoints)
                raise ValidationError(
                    message=f"No available UTXOs. {total_locked} of {total_cached} UTXOs locked by pending transactions.",
                    details={
                        "address": wallet.address,
                        "total_utxos": total_cached,
                        "locked_utxos": total_locked,
                    },
                )

            # 4. Convert amount and build PSBT
            amount_sats = int(Decimal(str(request.amount)) * Decimal("100000000"))

            # Fetch raw txs for available UTXOs (non_witness_utxo)
            raw_txs: dict[str, bytes] = {}
            unique_txids = set(utxo.txid for utxo in available_utxos)
            for txid in unique_txids:
                raw_hex = await client.get_raw_transaction(txid)
                raw_txs[txid] = bytes.fromhex(raw_hex)

            builder = PSBTBuilder(network=btc_network, multisig_config=multisig_config)
            outputs = [TxOutput(address=request.to_address, amount=amount_sats)]
            change_address = wallet.address
            fee_rate = request.fee_rate or 10

            try:
                psbt_info = builder.build(
                    utxos=available_utxos,
                    outputs=outputs,
                    change_address=change_address,
                    fee_rate=fee_rate,
                    raw_txs=raw_txs,
                    use_all_inputs=request.use_all_inputs,
                    send_max=request.send_max,
                )
            except InsufficientFundsError as exc:
                from multivault.errors.exceptions import ValidationError
                raise ValidationError(
                    message=str(exc),
                    details={
                        "required": exc.required,
                        "available": exc.available,
                    },
                ) from exc

            # When send_max, the builder computed the real send amount; update
            # request.amount so transaction_service stores the correct value.
            if request.send_max:
                actual_send_sats = psbt_info.total_input - psbt_info.fee
                request.amount = Decimal(str(actual_send_sats)) / Decimal("100000000")

            payload = psbt_info.psbt_base64
            import hashlib
            payload_hash = hashlib.sha256(psbt_info.psbt_base64.encode()).hexdigest()
            fee_amount = Decimal(str(psbt_info.fee)) / Decimal("100000000")

            # 5. Extract selected UTXO inputs for locking
            utxo_inputs = psbt_info.selected_utxos

        finally:
            await client.disconnect()

    tx = await tx_service.create_transaction(
        wallet_id=wallet_id,
        data=request,
        payload=payload,
        payload_hash=payload_hash,
        fee_amount=fee_amount if chain_type != ChainType.EVM.value else None,
        token_symbol=token_symbol if chain_type == ChainType.EVM.value else None,
        token_decimals=token_decimals if chain_type == ChainType.EVM.value else None,
        safe_nonce=safe_nonce if chain_type == ChainType.EVM.value else None,
        utxo_inputs=utxo_inputs if chain_type == ChainType.BTC.value else None,
    )
    return ApiResponse(data=_transaction_to_response(tx))


@wallet_router.get("", response_model=PaginatedResponse[TransactionListItem])
async def list_transactions(
    wallet_id: str = Path(..., description="Wallet UUID"),
    service: TransactionServiceDep = ...,
    status: TransactionStatus | None = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginatedResponse[TransactionListItem]:
    """List transactions for a wallet."""
    query = TransactionQuery(
        status=status,
        page=page,
        page_size=page_size,
    )
    transactions, total = await service.list_transactions(wallet_id, query)

    items = [_transaction_to_list_item(tx) for tx in transactions]

    return PaginatedResponse(
        data=items,
        pagination=PaginationMeta(
            page=query.page,
            page_size=query.page_size,
            total=total,
            total_pages=(total + query.page_size - 1) // query.page_size,
        ),
    )


@policy_router.post("/policy-changes", response_model=ApiResponse[TransactionResponse])
async def create_policy_transaction(
    wallet_id: str = Path(..., description="Wallet UUID"),
    request: PolicyChangeCreate = ...,
    db: DbSession = ...,
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
) -> ApiResponse[TransactionResponse]:
    """Create a Safe policy change transaction (owner/threshold modification)."""
    from multivault.chains.evm.adapter import EVMAdapter
    from multivault.errors.exceptions import ValidationError
    from multivault.models.transaction import TransactionType
    from multivault.models.wallet import WalletStatus
    from multivault.utils.extra import set_extra

    wallet = await wallet_service.get_wallet(wallet_id)

    # Must be EVM Safe
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
    if chain_type != ChainType.EVM.value:
        raise ValidationError(
            message="Policy changes are only supported for EVM Safe wallets",
            details={"wallet_id": wallet_id, "chain_type": chain_type},
        )

    # Must be ACTIVE
    wallet_status = wallet.status.value if hasattr(wallet.status, "value") else str(wallet.status)
    if wallet_status != WalletStatus.ACTIVE.value:
        raise ValidationError(
            message="Wallet must be active to create policy transactions",
            details={"wallet_id": wallet_id, "status": wallet_status},
        )

    # Get RPC URL (same pattern as existing handler)
    network_service = NetworkService(db)
    node = await network_service.get_default_node(wallet.network_id)
    rpc_url = node.endpoint_url if node else None
    if not rpc_url:
        raise ValidationError(
            message="No RPC URL configured for wallet's network",
            details={"wallet_id": wallet.id, "network_id": wallet.network_id},
        )

    adapter = EVMAdapter(rpc_url=rpc_url)
    await adapter.connect()
    try:
        # Get current Safe info for nonce + snapshot
        safe_info = await adapter.get_safe_info(wallet.address)
        on_chain_nonce = safe_info["nonce"]
        old_threshold = safe_info["threshold"]
        old_owners = safe_info["owners"]

        # Sync stale nonces, allocate next
        await tx_service.sync_safe_nonces(wallet.id, on_chain_nonce)
        safe_nonce = await tx_service.allocate_safe_nonce(wallet.id, on_chain_nonce)

        # Build policy change transaction via adapter (includes validation)
        try:
            safe_tx = await adapter.build_policy_change_transaction(
                wallet_address=wallet.address,
                action=request.action,
                params={
                    "new_owner": request.new_owner,
                    "removed_owner": request.removed_owner,
                    "new_threshold": request.new_threshold,
                },
                safe_nonce=safe_nonce,
                safe_info=safe_info,
            )
        except ValueError as e:
            raise ValidationError(
                message=str(e),
                details={"action": request.action},
            )

        payload_hash = "0x" + safe_tx.tx_hash.hex()
        payload = json.dumps(safe_tx.get_typed_data())
    finally:
        await adapter.disconnect()

    # TODO: Replace send_max workaround once TransactionCreate supports
    # zero-amount tx types natively (e.g. per-type schema or allow_zero_amount flag).
    # Persist using amount=0 workaround (send_max=True bypasses amount>0 validator)
    data = TransactionCreate(
        to_address=wallet.address,
        amount=Decimal("0"),
        send_max=True,
        description=request.description,
    )

    tx = await tx_service.create_transaction(
        wallet_id=wallet_id,
        data=data,
        payload=payload,
        payload_hash=payload_hash,
        tx_type=TransactionType.SAFE_POLICY_CHANGE,
        safe_nonce=safe_nonce,
    )

    # Store policy metadata in extra
    set_extra(
        tx,
        policy_action=request.action,
        new_owner=request.new_owner,
        removed_owner=request.removed_owner,
        new_threshold=request.new_threshold,
        old_threshold=old_threshold,
        old_owners=old_owners,
    )
    await db.commit()

    # Re-fetch with eager-loaded relationships after commit
    # (commit expires the identity map, so tx.signatures would trigger
    #  a lazy load → MissingGreenlet in async context)
    tx = await tx_service.get_transaction(tx.id)

    return ApiResponse(data=_transaction_to_response(tx))


@policy_router.post("/sync-policy", response_model=ApiResponse)
async def sync_wallet_policy(
    wallet_id: str = Path(..., description="Wallet UUID"),
    db: DbSession = ...,
    wallet_service: WalletServiceDep = ...,
    network_service: NetworkServiceDep = ...,
) -> ApiResponse:
    """Sync wallet policy (owners/threshold) from on-chain Safe state."""
    from multivault.chains.evm.adapter import EVMAdapter
    from multivault.errors.exceptions import ValidationError
    from multivault.models.wallet import WalletStatus

    wallet = await wallet_service.get_wallet(wallet_id)

    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
    if chain_type != ChainType.EVM.value:
        raise ValidationError(
            message="Policy sync is only supported for EVM Safe wallets",
            details={"wallet_id": wallet_id, "chain_type": chain_type},
        )

    wallet_status = wallet.status.value if hasattr(wallet.status, "value") else str(wallet.status)
    if wallet_status != WalletStatus.ACTIVE.value:
        raise ValidationError(
            message="Wallet must be active to sync policy",
            details={"wallet_id": wallet_id, "status": wallet_status},
        )

    node = await network_service.get_default_node(wallet.network_id)
    rpc_url = node.endpoint_url if node else None
    if not rpc_url:
        raise ValidationError(
            message="No RPC URL configured for wallet's network",
            details={"wallet_id": wallet.id, "network_id": wallet.network_id},
        )

    adapter = EVMAdapter(rpc_url=rpc_url)
    await adapter.connect()
    try:
        safe_info = await adapter.get_safe_info(wallet.address)
    finally:
        await adapter.disconnect()

    await wallet_service.sync_wallet_policy(wallet.id, safe_info)
    await db.commit()

    return ApiResponse(data={"synced": True})


# =============================================================================
# Transaction-scoped endpoints (top-level /transactions/{id})
# =============================================================================


@router.get("/{transaction_id}", response_model=ApiResponse[TransactionResponse])
async def get_transaction(
    transaction_id: str = Path(..., description="Transaction UUID"),
    check_broadcast: bool = Query(True, description="Whether to perform on-chain broadcast readiness check (slow)"),
    service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
    network_service: NetworkServiceDep = ...,
) -> ApiResponse[TransactionResponse]:
    """Get transaction details with optional can_broadcast status check."""
    tx = await service.get_transaction(transaction_id)
    
    # For EVM Safe transactions, check if can broadcast
    # Only check for transactions that haven't been finalized yet
    can_broadcast: bool | None = None
    blocking_reason: str | None = None
    
    # Only calculate can_broadcast for active transactions when check_broadcast is enabled
    # Terminal states (BROADCAST, CONFIRMED, FAILED, CANCELLED) don't need this check
    if check_broadcast and tx.safe_nonce is not None and tx.status in [
        TransactionStatus.PENDING_SIGN,
        TransactionStatus.PARTIALLY_SIGNED,
        TransactionStatus.SIGNED,
    ]:
        # Get wallet to check chain type
        wallet = await wallet_service.get_wallet(tx.wallet_id)
        chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
        
        if chain_type == "EVM":
            # Get default node for unified network
            node = await network_service.get_default_node(wallet.network_id)
            if not node:
                can_broadcast = None
                blocking_reason = None
            else:
                from multivault.chains.evm.safe import SafeManager
                from multivault.chains.evm.web3_client import Web3Client

                # Create Web3 client and connect
                web3_client = Web3Client(rpc_url=node.endpoint_url)
                await web3_client.connect()
                
                try:
                    # Create Safe manager and get on-chain nonce
                    safe_manager = SafeManager(web3_client)
                    on_chain_nonce = await safe_manager.get_nonce(wallet.address)
                    
                    # Check broadcast readiness
                    can_broadcast, blocking_reason = await service.can_broadcast_safe_transaction(
                        tx, on_chain_nonce
                    )
                finally:
                    # Always disconnect Web3 client
                    await web3_client.disconnect()
    
    return ApiResponse(data=_transaction_to_response(tx, can_broadcast, blocking_reason))


@router.post("/{transaction_id}/sign", response_model=ApiResponse[TransactionResponse])
async def submit_signature(
    transaction_id: str = Path(..., description="Transaction UUID"),
    signer_id: str = Query(..., description="Signer UUID"),
    request: SignatureSubmit = ...,
    service: TransactionServiceDep = ...,
) -> ApiResponse[TransactionResponse]:
    """Submit a signature for a transaction.

    For BTC: Provide partial PSBT signature
    For EVM: Provide Safe signature (r+s+v hex)
    """
    tx = await service.submit_signature(transaction_id, signer_id, request)
    return ApiResponse(data=_transaction_to_response(tx))


@router.post(
    "/{transaction_id}/keyvault/signing-payload",
    response_model=ApiResponse[KeyVaultSigningPayloadResponse],
)
async def generate_keyvault_signing_payload(
    transaction_id: str = Path(..., description="Transaction UUID"),
    signer_id: str = Query(..., description="Signer UUID"),
    service: TransactionServiceDep = ...,
) -> ApiResponse[KeyVaultSigningPayloadResponse]:
    """Generate KeyVault-compatible signing payload for QR display."""
    result = await service.generate_keyvault_signing_payload(
        transaction_id, signer_id
    )
    return ApiResponse(data=KeyVaultSigningPayloadResponse(**result))


@router.get("/{transaction_id}/btc-signing-info", response_model=ApiResponse[BTCSigningInfo])
async def get_btc_signing_info(
    transaction_id: str = Path(..., description="Transaction UUID"),
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
) -> ApiResponse[BTCSigningInfo]:
    """Get BTC multisig signing information.

    Returns wallet policy info and signer HMACs needed for Ledger signing.
    Only available for BTC transactions in PENDING_SIGN status.
    """
    from multivault.errors.exceptions import ValidationError

    tx = await tx_service.get_transaction(transaction_id)

    # Get wallet
    wallet = await wallet_service.get_wallet(tx.wallet_id)
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)

    if chain_type != ChainType.BTC.value:
        raise ValidationError(
            message="BTC signing info is only available for BTC transactions",
            details={"chain_type": chain_type},
        )

    # Check status
    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
    if tx_status not in [TransactionStatus.PENDING_SIGN.value, TransactionStatus.PARTIALLY_SIGNED.value]:
        raise ValidationError(
            message=f"Transaction must be in PENDING_SIGN or PARTIALLY_SIGNED status (current: {tx_status})",
            details={"current_status": tx_status},
        )

    # Build signer policy info
    from multivault.utils.extra import (
        get_extra,
        get_extra_field,
    )
    signers = []
    for ws in wallet.wallet_signers:
        signer_extra = get_extra(ws.signer)
        ws_extra = get_extra(ws)
        signers.append(BTCSignerPolicyInfo(
            signer_id=ws.signer.id,
            signer_name=ws.signer.name,
            derivation_path=ws.signer.derivation_path,
            master_fingerprint=signer_extra.get("master_fingerprint"),
            xpub=signer_extra.get("xpub"),
            ledger_policy_hmac=ws_extra.get("ledger_policy_hmac"),
            order_index=ws.order_index,
        ))

    # Sort by order_index
    signers.sort(key=lambda s: s.order_index)

    # Determine script type from wallet extras
    wallet_script_type = get_extra_field(wallet, "script_type") or "p2wsh"
    if wallet_script_type == "p2sh-p2wsh":
        policy_type = f"sh(wsh(sortedmulti({wallet.threshold},...)))"
    else:
        policy_type = f"wsh(sortedmulti({wallet.threshold},...))"

    return ApiResponse(data=BTCSigningInfo(
        transaction_id=tx.id,
        wallet_id=wallet.id,
        psbt_base64=tx.payload or "",
        threshold=wallet.threshold,
        signer_count=wallet.signer_count,
        wallet_policy_type=policy_type,
        script_type=wallet_script_type,
        signers=signers,
    ))


@router.get("/{transaction_id}/execution", response_model=ApiResponse[SafeExecutionData])
async def get_execution_data(
    transaction_id: str = Path(..., description="Transaction UUID"),
    db: DbSession = ...,
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
) -> ApiResponse[SafeExecutionData]:
    """Get execution data for a fully-signed EVM Safe transaction.

    Returns the encoded execTransaction call data that the frontend should
    send to the Safe contract via the user's connected wallet.
    """
    tx = await tx_service.get_transaction(transaction_id)

    # Validate status
    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
    if tx_status != TransactionStatus.SIGNED.value:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message=f"Transaction must be in SIGNED status (current: {tx_status})",
            details={"current_status": tx_status},
        )

    # Get wallet
    wallet = await wallet_service.get_wallet(tx.wallet_id)
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)

    if chain_type != ChainType.EVM.value:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message="Execution data is only available for EVM transactions",
            details={"chain_type": chain_type},
        )

    # Build execution data
    import json

    from multivault.chains.evm import (
        SafeManager,
        SafeSignature,
        SafeTransaction,
        Web3Client,
    )
    from multivault.config import get_settings

    network_service = NetworkService(db)
    rpc_url = None
    node = await network_service.get_default_node(wallet.network_id)
    rpc_url = node.endpoint_url if node else None

    if not rpc_url:
        raise ValidationError(
            message="No RPC URL configured for wallet's network",
            details={"wallet_id": wallet.id, "network_id": wallet.network_id},
        )
    
    client = Web3Client(rpc_url=rpc_url)
    await client.connect()

    try:
        safe_manager = SafeManager(client=client)

        # Reconstruct SafeTransaction from stored payload
        typed_data = json.loads(tx.payload)
        message = typed_data.get("message", {})

        # Parse data field - may or may not have 0x prefix
        data_hex = message.get("data", "") or ""
        if data_hex.startswith("0x"):
            data_hex = data_hex[2:]
        data_bytes = bytes.fromhex(data_hex) if data_hex else b""

        safe_tx = SafeTransaction(
            to=message.get("to", "0x" + "0" * 40),
            value=int(message.get("value", 0)),
            data=data_bytes,
            operation=int(message.get("operation", 0)),
            safe_tx_gas=int(message.get("safeTxGas", 0)),
            base_gas=int(message.get("baseGas", 0)),
            gas_price=int(message.get("gasPrice", 0)),
            gas_token=message.get("gasToken", "0x" + "0" * 40),
            refund_receiver=message.get("refundReceiver", "0x" + "0" * 40),
            nonce=int(message.get("nonce", 0)),
            safe_address=wallet.address,
            chain_id=client.chain_id or 1,
        )

        # Collect signatures from transaction
        signatures = []
        for sig in tx.signatures:
            signatures.append(SafeSignature(
                signer=sig.signer.address,
                data=bytes.fromhex(sig.signature_data.replace("0x", "")),
            ))

        # Combine signatures (sorted by signer address)
        combined_sigs = safe_manager.combine_signatures(signatures)

        # Build execTransaction call data
        exec_data = safe_manager.build_exec_transaction_data(safe_tx, combined_sigs)

        return ApiResponse(data=SafeExecutionData(
            safe_address=wallet.address,
            exec_transaction_data="0x" + exec_data.hex(),
            signatures_count=len(signatures),
            estimated_gas=None,  # Could estimate gas here
        ))

    finally:
        await client.disconnect()


@router.post("/{transaction_id}/broadcast", response_model=ApiResponse[TransactionResponse])
async def broadcast_transaction(
    transaction_id: str = Path(..., description="Transaction UUID"),
    tx_hash: str = Query(..., description="On-chain transaction hash after execution"),
    tx_service: TransactionServiceDep = ...,
) -> ApiResponse[TransactionResponse]:
    """Mark a transaction as broadcast after frontend execution.

    For EVM: Called after the frontend executes the Safe transaction.
    The tx_hash should be the on-chain transaction hash from the execution.
    """
    tx = await tx_service.broadcast_transaction(transaction_id, tx_hash=tx_hash)
    return ApiResponse(data=_transaction_to_response(tx))


@router.get("/{transaction_id}/btc-execution", response_model=ApiResponse[BTCExecutionData])
async def get_btc_execution_data(
    transaction_id: str = Path(..., description="Transaction UUID"),
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
) -> ApiResponse[BTCExecutionData]:
    """Get execution data for a fully-signed BTC transaction.

    Returns the finalized PSBT and raw transaction ready for broadcast.
    """
    tx = await tx_service.get_transaction(transaction_id)

    # Validate status
    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
    if tx_status != TransactionStatus.SIGNED.value:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message=f"Transaction must be in SIGNED status (current: {tx_status})",
            details={"current_status": tx_status},
        )

    # Get wallet and validate chain type
    wallet = await wallet_service.get_wallet(tx.wallet_id)
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)

    if chain_type != ChainType.BTC.value:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message="BTC execution data is only available for BTC transactions",
            details={"chain_type": chain_type},
        )

    # Get stored PSBT from payload
    from multivault.chains.bitcoin.psbt import PSBTBuilder

    if not tx.payload:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message="Transaction has no PSBT payload",
            details={"transaction_id": transaction_id},
        )

    try:
        # Apply stored signatures and finalize
        psbt = PSBTBuilder.parse(tx.payload)
        signatures = await tx_service.get_signatures(transaction_id)
        _apply_btc_signatures(psbt, signatures)
        raw_tx_bytes, txid = PSBTBuilder.finalize(psbt)

        return ApiResponse(data=BTCExecutionData(
            transaction_id=transaction_id,
            finalized_psbt=tx.payload,
            raw_tx=raw_tx_bytes.hex(),
            txid=txid,
            signatures_count=tx.signature_count,
            can_broadcast=tx.signature_count >= tx.threshold,
        ))

    except Exception as e:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message=f"Failed to finalize PSBT: {e}",
            details={"transaction_id": transaction_id},
        )


@router.post("/{transaction_id}/btc-broadcast", response_model=ApiResponse[BTCBroadcastResponse])
async def broadcast_btc_transaction(
    transaction_id: str = Path(..., description="Transaction UUID"),
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
    network_service: NetworkServiceDep = ...,
) -> ApiResponse[BTCBroadcastResponse]:
    """Broadcast a fully-signed BTC transaction to the network.

    Unlike EVM transactions which are executed by the frontend,
    BTC transactions are broadcast by the backend via Electrum.
    """
    tx = await tx_service.get_transaction(transaction_id)

    # Validate status
    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
    if tx_status != TransactionStatus.SIGNED.value:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message=f"Transaction must be in SIGNED status (current: {tx_status})",
            details={"current_status": tx_status},
        )

    # Get wallet and validate chain type
    wallet = await wallet_service.get_wallet(tx.wallet_id)
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)

    if chain_type != ChainType.BTC.value:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message="BTC broadcast is only available for BTC transactions",
            details={"chain_type": chain_type},
        )

    # Get PSBT and signatures
    from multivault.chains.bitcoin.psbt import PSBTBuilder

    if not tx.payload:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message="Transaction has no PSBT payload",
            details={"transaction_id": transaction_id},
        )

    # Get signatures from database
    signatures = await tx_service.get_signatures(transaction_id)

    try:
        # Parse PSBT and inject signatures
        psbt = PSBTBuilder.parse(tx.payload)
        _apply_btc_signatures(psbt, signatures)

        # Now finalize with signatures injected
        raw_tx_bytes, txid = PSBTBuilder.finalize(psbt)
    except Exception as e:
        from multivault.errors.exceptions import ValidationError
        raise ValidationError(
            message=f"Failed to finalize PSBT: {e}",
            details={"transaction_id": transaction_id},
        )

    # Broadcast via Electrum
    import json as _json

    from multivault.chains.bitcoin.adapter import BitcoinAdapter
    from multivault.chains.bitcoin.address import BitcoinNetwork
    from multivault.models.network import parse_electrum_url as _parse_electrum_url

    # Get Bitcoin network configuration from transaction's wallet
    btc_network_config = await network_service.get_network(tx.wallet.network_id)
    btc_node = await network_service.get_default_node(tx.wallet.network_id) if btc_network_config else None
    
    if not btc_node:
        raise ValidationError(
            message="No Bitcoin node configured",
            details={"wallet_id": tx.wallet_id, "network_id": tx.wallet.network_id},
        )

    # Determine network from extra metadata
    _extra = _json.loads(btc_network_config.extra) if btc_network_config.extra else {}
    _btc_net_name = _extra.get("btc_network", "")
    network = BitcoinNetwork.TESTNET if "test" in _btc_net_name.lower() else BitcoinNetwork.MAINNET

    _host, _port, _ssl = _parse_electrum_url(btc_node.endpoint_url)
    adapter = BitcoinAdapter(
        electrum_host=_host,
        electrum_port=_port,
        electrum_ssl=_ssl,
        network=network,
    )

    try:
        await adapter.connect()
        result = await adapter.broadcast(raw_tx_bytes)

        if result.success:
            # Update transaction status
            await tx_service.broadcast_transaction(transaction_id, tx_hash=result.tx_hash)

            return ApiResponse(data=BTCBroadcastResponse(
                transaction_id=transaction_id,
                tx_hash=result.tx_hash,
                raw_tx=raw_tx_bytes.hex(),
                success=True,
                error=None,
            ))
        else:
            return ApiResponse(data=BTCBroadcastResponse(
                transaction_id=transaction_id,
                tx_hash="",
                raw_tx=raw_tx_bytes.hex(),
                success=False,
                error=result.error,
            ))

    finally:
        await adapter.disconnect()


@router.get("/{transaction_id}/btc-decoded", response_model=ApiResponse[BtcDecodedTx])
async def get_btc_decoded_transaction(
    transaction_id: str = Path(..., description="Transaction UUID"),
    tx_service: TransactionServiceDep = ...,
    wallet_service: WalletServiceDep = ...,
    network_service: NetworkServiceDep = ...,
) -> ApiResponse[BtcDecodedTx]:
    """Get decoded BTC transaction with human-readable inputs/outputs.

    Two decoding paths:
    - Pre-broadcast (PENDING_SIGN / PARTIALLY_SIGNED / SIGNED): local PSBT parse via embit
    - Post-broadcast (BROADCAST / CONFIRMED): query Electrum node for verbose tx
    """
    from multivault.errors.exceptions import ValidationError

    tx = await tx_service.get_transaction(transaction_id)

    # Validate chain type
    wallet = await wallet_service.get_wallet(tx.wallet_id)
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)

    if chain_type != ChainType.BTC.value:
        raise ValidationError(
            message="Decoded transaction is only available for BTC transactions",
            details={"chain_type": chain_type},
        )

    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
    has_tx_hash = bool(tx.tx_hash)

    if has_tx_hash:
        # Path 1: Post-broadcast — query Electrum verbose tx
        return ApiResponse(data=await _decode_btc_from_electrum(
            tx, wallet, network_service,
        ))
    elif tx.payload:
        # Path 2: Pre-broadcast — local PSBT parse
        return ApiResponse(data=await _decode_btc_from_psbt(
            tx, wallet, network_service,
        ))
    else:
        raise ValidationError(
            message="Transaction has no payload or tx_hash for decoding",
            details={"transaction_id": transaction_id},
        )


async def _decode_btc_from_psbt(tx, wallet, network_service) -> BtcDecodedTx:
    """Decode a BTC transaction from its PSBT payload using embit."""
    import json as _json
    import logging

    from embit import script as embit_script
    from multivault.chains.bitcoin.address import (
        BitcoinNetwork,
        get_embit_network,
    )
    from multivault.chains.bitcoin.psbt import PSBTBuilder
    from multivault.errors.exceptions import ValidationError

    logger = logging.getLogger(__name__)

    # Determine Bitcoin network
    btc_network_config = await network_service.get_network(wallet.network_id)
    _extra = _json.loads(btc_network_config.extra) if btc_network_config.extra else {}
    _btc_net_name = _extra.get("btc_network", "")
    network = BitcoinNetwork.TESTNET if "test" in _btc_net_name.lower() else BitcoinNetwork.MAINNET
    net = get_embit_network(network)

    try:
        psbt = PSBTBuilder.parse(tx.payload)
    except Exception as e:
        raise ValidationError(
            message=f"Failed to parse PSBT payload: {e}",
            details={"transaction_id": str(tx.id)},
        )
    raw_tx = psbt.tx

    # Decode inputs
    inputs: list[BtcTxInput] = []
    total_input_value = 0
    for i, vin in enumerate(raw_tx.vin):
        prev_txid = vin.txid.hex()
        # embit stores txid in internal byte order (little-endian), reverse for display
        if len(prev_txid) == 64:
            prev_txid = bytes.fromhex(prev_txid)[::-1].hex()

        value = None
        address = None

        # Try to get value/address from witness_utxo
        if i < len(psbt.inputs) and psbt.inputs[i].witness_utxo:
            wu = psbt.inputs[i].witness_utxo
            value = wu.value
            total_input_value += value
            try:
                address = embit_script.Script(wu.script_pubkey.data).address(net)
            except Exception as e:
                logger.debug("Failed to derive input address from witness_utxo: %s", e)

        inputs.append(BtcTxInput(
            txid=prev_txid,
            vout=vin.vout,
            value=value,
            address=address,
        ))

    # Decode outputs
    outputs: list[BtcTxOutput] = []
    total_output_value = 0
    wallet_address = wallet.address
    for idx, vout in enumerate(raw_tx.vout):
        value = vout.value
        total_output_value += value
        address = None
        try:
            address = embit_script.Script(vout.script_pubkey.data).address(net)
        except Exception as e:
            logger.debug("Failed to derive output address from script_pubkey: %s", e)

        is_change = address == wallet_address if address and wallet_address else None

        outputs.append(BtcTxOutput(
            index=idx,
            value=value,
            address=address,
            is_change=is_change,
        ))

    # Compute fee if all input values are known
    fee = (total_input_value - total_output_value) if total_input_value > 0 else None

    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)

    return BtcDecodedTx(
        transaction_id=str(tx.id),
        txid=tx.tx_hash,
        version=raw_tx.version,
        size=None,
        vsize=None,
        fee=fee,
        inputs=inputs,
        outputs=outputs,
        status=tx_status,
        confirmations=None,
    )


async def _decode_btc_from_electrum(tx, wallet, network_service) -> BtcDecodedTx:
    """Decode a broadcast BTC transaction by querying Electrum for verbose tx data."""
    import json as _json

    from multivault.chains.bitcoin.address import BitcoinNetwork
    from multivault.chains.bitcoin.electrum import ElectrumClient
    from multivault.errors.exceptions import ValidationError
    from multivault.models.network import parse_electrum_url as _parse_electrum_url

    btc_network_config = await network_service.get_network(wallet.network_id)
    btc_node = await network_service.get_default_node(wallet.network_id) if btc_network_config else None

    if not btc_node:
        raise ValidationError(
            message="No Bitcoin node configured",
            details={"wallet_id": str(tx.wallet_id)},
        )

    _extra = _json.loads(btc_network_config.extra) if btc_network_config.extra else {}
    _btc_net_name = _extra.get("btc_network", "")
    _network = BitcoinNetwork.TESTNET if "test" in _btc_net_name.lower() else BitcoinNetwork.MAINNET

    _host, _port, _ssl = _parse_electrum_url(btc_node.endpoint_url)
    client = ElectrumClient(host=_host, port=_port, use_ssl=_ssl)

    try:
        await client.connect()
        verbose_tx = await client.get_transaction(tx.tx_hash, verbose=True)
    except Exception as e:
        raise ValidationError(
            message=f"Failed to query Electrum for transaction: {e}",
            details={"tx_hash": tx.tx_hash},
        )
    finally:
        await client.disconnect()

    wallet_address = wallet.address

    # Parse verbose tx from Electrum (bitcoind-format JSON)
    inputs: list[BtcTxInput] = []
    for vin_data in verbose_tx.get("vin", []):
        inputs.append(BtcTxInput(
            txid=vin_data.get("txid", ""),
            vout=vin_data.get("vout", 0),
            value=_sat_from_btc(vin_data.get("value")) if "value" in vin_data else None,
            address=vin_data.get("prevout", {}).get("scriptpubkey_address")
            if "prevout" in vin_data
            else None,
        ))

    outputs: list[BtcTxOutput] = []
    for vout_data in verbose_tx.get("vout", []):
        idx = vout_data.get("n", 0)
        value = _sat_from_btc(vout_data.get("value", 0)) or 0
        spk = vout_data.get("scriptPubKey", {})
        address = spk.get("address") or (spk.get("addresses", [None]) or [None])[0]
        is_change = address == wallet_address if address and wallet_address else None

        outputs.append(BtcTxOutput(
            index=idx,
            value=value,
            address=address,
            is_change=is_change,
        ))

    total_in = sum(inp.value for inp in inputs if inp.value is not None)
    total_out = sum(out.value for out in outputs)
    fee = (total_in - total_out) if total_in > 0 else verbose_tx.get("fee")

    tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
    confirmations = verbose_tx.get("confirmations")

    return BtcDecodedTx(
        transaction_id=str(tx.id),
        txid=tx.tx_hash,
        version=verbose_tx.get("version", 2),
        size=verbose_tx.get("size"),
        vsize=verbose_tx.get("vsize"),
        fee=fee if isinstance(fee, int) else _sat_from_btc(fee) if fee else None,
        inputs=inputs,
        outputs=outputs,
        status=tx_status,
        confirmations=confirmations,
    )


def _sat_from_btc(btc_value) -> int | None:
    """Convert BTC float/string to satoshis safely. Returns None for None input."""
    if btc_value is None:
        return None
    from decimal import Decimal
    return int(Decimal(str(btc_value)) * Decimal("100000000"))


@router.get("/{transaction_id}/cancel-options", response_model=ApiResponse[dict])
async def get_cancel_options(
    transaction_id: str = Path(..., description="Transaction UUID"),
    service: TransactionServiceDep = ...,
) -> ApiResponse[dict]:
    """Get available cancellation options for a transaction.
    
    Returns whether the transaction can be cancelled offchain (database only)
    or requires onchain cancellation (creates replacement transaction).
    
    For Safe wallets:
    - Latest nonce: can choose offchain (free) or onchain (costs gas)
    - Not latest: must use onchain to prevent nonce gap
    """
    options = await service.get_safe_cancellation_options(transaction_id)
    return ApiResponse(data=options)


@router.post("/{transaction_id}/cancel", response_model=ApiResponse[TransactionResponse])
async def cancel_transaction(
    transaction_id: str = Path(..., description="Transaction UUID"),
    on_chain: bool = Query(
        False,
        description="Force on-chain cancellation (creates CANCELLATION transaction). "
                   "Required if not latest nonce.",
    ),
    reason: str | None = Query(None, description="Cancellation reason"),
    service: TransactionServiceDep = ...,
) -> ApiResponse[TransactionResponse]:
    """Cancel a pending transaction.
    
    For Safe wallets:
    - If latest nonce: can choose offchain (on_chain=false) or onchain (on_chain=true)
    - If not latest: must use onchain (on_chain=true)
    
    Offchain cancellation:
    - Free (no gas cost)
    - Instant
    - Nonce can be reused by next transaction
    
    Onchain cancellation:
    - Costs gas
    - Requires signatures and broadcast
    - Creates CANCELLATION transaction with same nonce
    
    Use GET /transactions/{id}/cancel-options to check available options first.
    
    Cannot cancel transactions that have been broadcast.
    """
    tx = await service.cancel_transaction(transaction_id, on_chain=on_chain, reason=reason)
    return ApiResponse(data=_transaction_to_response(tx))


# =============================================================================
# Nonce Queue Management (EVM Safe only)
# =============================================================================


@wallet_router.get("/nonce-queue", response_model=ApiResponse[dict])
async def get_nonce_queue(
    wallet_id: str = Path(..., description="Wallet UUID"),
    wallet_service: WalletServiceDep = ...,
    tx_service: TransactionServiceDep = ...,
    db: DbSession = ...,
) -> ApiResponse[dict]:
    """
    Get Safe nonce queue for a wallet.
    
    Returns:
    - Current on-chain nonce
    - List of pending transactions with their nonces
    - Next allocatable nonce
    
    Only applicable to EVM Safe wallets.
    """
    from multivault.chains.evm import (
        SafeManager,
        Web3Client,
    )
    from multivault.config import get_settings
    from multivault.errors.exceptions import ValidationError
    from multivault.models.signer import ChainType
    from multivault.services.network_service import NetworkService

    # Get wallet
    wallet = await wallet_service.get_wallet(wallet_id)
    
    # Check if wallet is EVM
    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
    if chain_type != ChainType.EVM.value:
        raise ValidationError(
            message="Nonce queue only applicable to EVM Safe wallets",
            details={"chain_type": chain_type}
        )
    
    if not wallet.address:
        raise ValidationError(
            message="Wallet not deployed yet",
            details={"wallet_id": wallet_id}
        )
    
    # Get network config
    network_service = NetworkService(db)
    node = await network_service.get_default_node(wallet.network_id)
    rpc_url = node.endpoint_url if node else None
    
    if not rpc_url:
        raise ValidationError(
            message="No RPC URL configured for wallet's network",
            details={"wallet_id": wallet.id, "network_id": wallet.network_id},
        )
    
    client = Web3Client(rpc_url=rpc_url)
    
    try:
        await client.connect()
        safe_manager = SafeManager(client=client)
        
        # Get on-chain nonce
        on_chain_nonce = await safe_manager.get_nonce(wallet.address)
        
        # Sync nonces
        await tx_service.sync_safe_nonces(wallet.id, on_chain_nonce)
        
        # Query pending transactions
        from multivault.models.transaction import (
            Transaction,
            TransactionStatus,
        )
        from sqlalchemy import select
        
        stmt = select(Transaction).where(
            Transaction.wallet_id == wallet_id,
            Transaction.safe_nonce.isnot(None),
            Transaction.status.notin_([
                TransactionStatus.CONFIRMED,
                TransactionStatus.CANCELLED,
                TransactionStatus.FAILED,
            ]),
            Transaction.deleted_at.is_(None),
        ).order_by(Transaction.safe_nonce)
        
        result = await db.execute(stmt)
        pending_txs = result.scalars().all()
        
        # Calculate next allocatable nonce
        next_nonce = await tx_service.allocate_safe_nonce(wallet.id, on_chain_nonce)
        
        # Detect nonce gaps
        active_nonces = {tx.safe_nonce for tx in pending_txs}
        gaps = []
        if active_nonces:
            max_nonce = max(active_nonces)
            for candidate in range(on_chain_nonce, max_nonce):
                if candidate not in active_nonces:
                    gaps.append(candidate)
        
        # Build queue info
        queue = []
        for tx in pending_txs:
            can_broadcast, reason = await tx_service.can_broadcast_safe_transaction(tx, on_chain_nonce)
            queue.append({
                "id": tx.id,
                "nonce": tx.safe_nonce,
                "description": tx.description,
                "status": tx.status,
                "to_address": tx.to_address,
                "amount": str(tx.amount),
                "created_at": tx.created_at.isoformat(),
                "can_broadcast": can_broadcast,
                "blocking_reason": reason if not can_broadcast else None,
            })
        
        # Build warnings
        warnings = []
        if gaps:
            warnings.append({
                "type": "nonce_gap",
                "message": f"Nonce gap(s) detected: {gaps}. These nonces were cancelled but are still needed on-chain. "
                          f"The next transaction will automatically fill the first gap (nonce {gaps[0]}).",
                "severity": "warning",
                "affected_nonces": gaps,
            })
        
        return ApiResponse(data={
            "on_chain_nonce": on_chain_nonce,
            "next_allocatable_nonce": next_nonce,
            "pending_count": len(queue),
            "nonce_gaps": gaps,
            "warnings": warnings,
            "queue": queue,
        })
    
    finally:
        await client.disconnect()
