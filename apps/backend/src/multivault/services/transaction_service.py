"""Transaction service for business logic."""

import base64
import json
from datetime import (
    UTC,
    datetime,
    timedelta,
)
from decimal import Decimal

import structlog
from embit import script
from embit.transaction import Transaction as BitcoinTransaction
from multivault.chains.bitcoin.address import (
    BitcoinNetwork,
    get_embit_network,
)
from multivault.chains.bitcoin.electrum import (
    ElectrumClient,
    ElectrumRPCError,
)
from multivault.chains.evm.safe_tx_service import (
    SafeTxServiceClient,
    SafeTxServiceError,
)
from multivault.errors.exceptions import (
    ConflictError,
    InsufficientSignaturesError,
    InvalidSignatureError,
    NotFoundError,
    ValidationError,
    WalletNotActiveError,
)
from multivault.models.network import (
    NetworkConfig,
    NetworkNodeConfig,
    parse_electrum_url,
)
from multivault.models.signer import (
    ChainType,
    Signer,
    SignerStatus,
)
from multivault.models.transaction import (
    Signature,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from multivault.models.wallet import (
    Wallet,
    WalletSigner,
    WalletSource,
    WalletStatus,
)
from multivault.schemas.transaction import (
    SignatureSubmit,
    TransactionCreate,
    TransactionQuery,
)
from multivault.utils.crypto import rsa_sign_for_keyvault
from multivault.utils.extra import (
    get_extra_field,
    set_extra,
)
from sqlalchemy import (
    and_,
    func,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


def _get_status_value(status) -> str:
    """Get string value from status enum or string."""
    if hasattr(status, "value"):
        return status.value
    return str(status)


class TransactionService:
    """Service for transaction CRUD and signature management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _parse_btc_header_time(header_hex: str) -> datetime | None:
        """Parse block header hex and return UTC datetime."""
        if not header_hex or len(header_hex) < 160:
            return None
        try:
            header_bytes = bytes.fromhex(header_hex)
        except ValueError:
            return None
        if len(header_bytes) < 80:
            return None
        timestamp = int.from_bytes(header_bytes[68:72], "little")
        return datetime.fromtimestamp(timestamp, tz=UTC)

    @staticmethod
    def _get_header_hex(header_result) -> str | None:
        """Normalize electrum header result to hex string."""
        if isinstance(header_result, str):
            return header_result
        if isinstance(header_result, dict):
            return header_result.get("hex") or header_result.get("header")
        return None

    @staticmethod
    def _sats_to_btc_decimal(sats: int) -> Decimal:
        return (Decimal(sats) / Decimal("100000000")).quantize(Decimal("0.00000001"))

    @staticmethod
    def _pick_external_address(
        tx: BitcoinTransaction,
        wallet_script_bytes: bytes,
        embit_network,
    ) -> str | None:
        best_value = -1
        best_address: str | None = None
        for out in tx.vout:
            if out.script_pubkey.serialize() == wallet_script_bytes:
                continue
            if out.value <= best_value:
                continue
            try:
                candidate = out.script_pubkey.address(embit_network)
            except Exception:
                continue
            best_value = out.value
            best_address = candidate
        return best_address

    async def _compute_btc_import_fields(
        self,
        *,
        tx: BitcoinTransaction,
        wallet_address: str,
        wallet_script_bytes: bytes,
        embit_network,
        prev_tx_cache: dict[str, BitcoinTransaction],
        fetch_prev_tx,
    ) -> dict:
        sum_inputs_total = 0
        sum_inputs_wallet = 0

        for inp in tx.vin:
            prev_txid = inp.txid.hex()
            if prev_txid == "00" * 32:
                continue
            prev_tx = prev_tx_cache.get(prev_txid)
            if prev_tx is None:
                prev_raw = await fetch_prev_tx(prev_txid)
                prev_tx = BitcoinTransaction.from_string(prev_raw)
                prev_tx_cache[prev_txid] = prev_tx

            if inp.vout >= len(prev_tx.vout):
                continue
            prev_out = prev_tx.vout[inp.vout]
            sum_inputs_total += prev_out.value
            if prev_out.script_pubkey.serialize() == wallet_script_bytes:
                sum_inputs_wallet += prev_out.value

        sum_outputs_total = 0
        sum_outputs_wallet = 0
        for out in tx.vout:
            sum_outputs_total += out.value
            if out.script_pubkey.serialize() == wallet_script_bytes:
                sum_outputs_wallet += out.value

        sum_outputs_external = max(0, sum_outputs_total - sum_outputs_wallet)
        fee_sats = max(0, sum_inputs_total - sum_outputs_total)

        direction = "SELF"
        if sum_inputs_wallet == 0 and sum_outputs_wallet > 0:
            direction = "IN"
        elif sum_inputs_wallet > 0 and sum_outputs_external > 0:
            direction = "OUT"
        elif sum_inputs_wallet > 0 and sum_outputs_wallet > 0 and sum_outputs_external == 0:
            direction = "SELF"
        else:
            net_sats = sum_outputs_wallet - sum_inputs_wallet
            if net_sats > 0:
                direction = "IN"
            elif net_sats < 0:
                direction = "OUT"
            else:
                direction = "SELF"

        if direction == "IN":
            amount_sats = sum_outputs_wallet
            fee_out = 0
            to_address = wallet_address
        elif direction == "OUT":
            amount_sats = sum_outputs_external
            fee_out = fee_sats
            to_address = (
                self._pick_external_address(tx, wallet_script_bytes, embit_network)
                or "unknown"
            )
        else:
            amount_sats = 0
            fee_out = fee_sats
            to_address = wallet_address

        return {
            "direction": direction,
            "amount_sats": amount_sats,
            "fee_sats": fee_out,
            "to_address": to_address,
        }

    @staticmethod
    def _resolve_btc_network(network: str) -> BitcoinNetwork:
        """Map network identifier string to BitcoinNetwork enum."""
        normalized = (network or "").lower()
        if normalized in ("mainnet", "main"):
            return BitcoinNetwork.MAINNET
        if normalized in ("testnet4", "testnet-4"):
            return BitcoinNetwork.TESTNET4
        if normalized in ("testnet3", "testnet-3"):
            return BitcoinNetwork.TESTNET3
        if normalized in ("testnet", "test"):
            return BitcoinNetwork.TESTNET
        if normalized in ("regtest", "reg"):
            return BitcoinNetwork.REGTEST
        raise ValidationError(
            message="Unsupported BTC network",
            details={"network": network},
        )

    # =========================================================================
    # EVM Safe Nonce Management
    # =========================================================================

    async def allocate_safe_nonce(
        self,
        wallet_id: str,
        on_chain_nonce: int,
    ) -> int:
        """
        Allocate next available Safe nonce for a wallet.
        
        **Critical**: Safe contracts require sequential nonce execution. If a nonce 
        is cancelled in the database but not executed on-chain, that nonce 
        becomes a "gap" that blocks all higher nonces from executing.
        
        Algorithm:
        1. Start from on-chain nonce (first unexecuted nonce)
        2. Check each nonce sequentially to find gaps
        3. Return the first nonce without an active transaction
        
        This ensures:
        - No nonce gaps that would block transaction execution
        - Cancelled nonces are automatically reused
        - Multiple cancelled nonces are filled in order
        
        Example scenario:
        - On-chain nonce = 5 (nonces 0-4 executed)
        - Active transactions: nonce 5, 6, 8
        - Cancelled: nonce 7
        - Result: Allocate nonce 7 (fill the gap)
        
        Args:
            wallet_id: The wallet's UUID
            on_chain_nonce: Current nonce from Safe contract
            
        Returns:
            Next nonce to allocate (may reuse a cancelled nonce)
        """
        # Get all active nonces for this wallet
        stmt = select(Transaction.safe_nonce).where(
            Transaction.wallet_id == wallet_id,
            Transaction.safe_nonce.isnot(None),
            Transaction.status.in_([
                TransactionStatus.PENDING_SIGN,
                TransactionStatus.PARTIALLY_SIGNED,
                TransactionStatus.SIGNED,
                TransactionStatus.BROADCAST,
            ]),
            Transaction.deleted_at.is_(None),
        ).order_by(Transaction.safe_nonce)
        
        result = await self.db.execute(stmt)
        active_nonces = {row[0] for row in result.fetchall()}
        
        # Find first available nonce starting from on-chain nonce
        candidate_nonce = on_chain_nonce
        while candidate_nonce in active_nonces:
            candidate_nonce += 1
        
        return candidate_nonce

    async def sync_safe_nonces(
        self,
        wallet_id: str,
        on_chain_nonce: int,
    ) -> int:
        """
        Sync wallet nonces with on-chain state and mark stale transactions.
        
        Finds all transactions with nonce < on_chain_nonce that are still pending
        and marks them as FAILED (stale).
        
        **Important**: BROADCAST transactions are excluded because they have already
        been submitted to the network and should be confirmed by the EVM Indexer worker.
        Marking them as stale could cause false failures.
        
        Args:
            wallet_id: The wallet's UUID
            on_chain_nonce: Current nonce from Safe contract
            
        Returns:
            Number of stale transactions marked as failed
        """
        # Find transactions with nonce < on_chain_nonce that aren't finalized
        # Exclude BROADCAST status - those are already submitted and pending confirmation
        stmt = select(Transaction).where(
            Transaction.wallet_id == wallet_id,
            Transaction.safe_nonce < on_chain_nonce,
            Transaction.safe_nonce.isnot(None),
            Transaction.status.in_([
                TransactionStatus.PENDING_SIGN,
                TransactionStatus.PARTIALLY_SIGNED,
                TransactionStatus.SIGNED,
                # TransactionStatus.BROADCAST,  # Exclude: already submitted, let indexer handle it
            ]),
            Transaction.deleted_at.is_(None),
        )
        result = await self.db.execute(stmt)
        stale_txs = result.scalars().all()
        
        # SIGNED txs get a grace period — broadcast API may have failed but
        # the tx could still confirm on-chain via the Indexer.
        signed_grace_period = timedelta(minutes=10)
        now = datetime.now(UTC)

        count = 0
        for tx in stale_txs:
            if tx.status == TransactionStatus.SIGNED:
                if tx.updated_at and (now - tx.updated_at) < signed_grace_period:
                    continue  # Within grace period — skip
            tx.status = TransactionStatus.FAILED
            tx.error_message = (
                f"Transaction stale: Nonce {tx.safe_nonce} already used on-chain "
                f"(current on-chain nonce: {on_chain_nonce})"
            )
            tx.updated_at = datetime.now(UTC)
            count += 1
        
        if count > 0:
            await self.db.commit()
        
        return count

    # =========================================================================
    # BTC UTXO Locking
    # =========================================================================

    async def get_locked_utxo_outpoints(
        self,
        wallet_id: str,
    ) -> set[tuple[str, int]]:
        """
        Get all UTXO outpoints locked by active BTC transactions.

        Returns set of (txid, vout) tuples for UTXOs that are currently
        referenced by non-terminal BTC transactions (no safe_nonce).
        """
        stmt = select(Transaction.extra).where(
            Transaction.wallet_id == wallet_id,
            Transaction.safe_nonce.is_(None),  # BTC only
            Transaction.status.in_([
                TransactionStatus.PENDING_SIGN,
                TransactionStatus.PARTIALLY_SIGNED,
                TransactionStatus.SIGNED,
                TransactionStatus.BROADCAST,
            ]),
            Transaction.deleted_at.is_(None),
        )

        result = await self.db.execute(stmt)
        rows = result.scalars().all()

        locked: set[tuple[str, int]] = set()
        for raw_extra in rows:
            if not raw_extra:
                continue
            try:
                extra = json.loads(raw_extra) if isinstance(raw_extra, str) else raw_extra
                for inp in extra.get("utxo_inputs", []):
                    locked.add((inp["txid"], inp["vout"]))
            except (json.JSONDecodeError, KeyError, TypeError) as exc:
                logger.warning("Skipping malformed utxo_inputs in transaction extra: %s", exc)

        return locked

    async def can_broadcast_safe_transaction(
        self,
        transaction: Transaction,
        on_chain_nonce: int,
    ) -> tuple[bool, str]:
        """
        Check if a Safe transaction can be broadcast.
        
        Safe requires strict sequential execution of nonces. A transaction can 
        be broadcast ONLY when:
        1. Its nonce >= on-chain nonce (not stale)
        2. Its nonce == on-chain nonce (exactly matches, no skipping)
        3. No other transaction with same nonce is already BROADCAST
        
        This ensures:
        - Nonce 1 must be broadcast and confirmed before nonce 2 can be broadcast
        - Nonce 2 must be broadcast and confirmed before nonce 3 can be broadcast
        - etc.
        
        Args:
            transaction: The transaction to check
            on_chain_nonce: Current nonce from Safe contract
            
        Returns:
            Tuple of (can_broadcast, reason_if_not)
        """
        if transaction.safe_nonce is None:
            return True, ""  # Not a Safe transaction
        
        # Check if transaction is stale
        if transaction.safe_nonce < on_chain_nonce:
            return False, (
                f"Transaction stale: Nonce {transaction.safe_nonce} < "
                f"on-chain nonce {on_chain_nonce}"
            )
        
        # Check if nonce matches on-chain nonce (Safe requires sequential execution)
        # This check ensures that:
        # - If nonce 1 hasn't been confirmed (on_chain_nonce still 1), 
        #   then nonce 2 cannot be broadcast (because nonce 2 > 1)
        # - Only when nonce 1 is confirmed and on_chain_nonce becomes 2,
        #   can nonce 2 be broadcast
        if transaction.safe_nonce > on_chain_nonce:
            return False, (
                f"Cannot skip nonces: Transaction nonce {transaction.safe_nonce} > "
                f"on-chain nonce {on_chain_nonce}. Must wait for nonce {on_chain_nonce} "
                f"to be confirmed on-chain first."
            )
        
        # nonce matches on-chain nonce - check if another transaction with same nonce is already broadcast
        stmt = select(
            Transaction.id,
            Transaction.safe_nonce,
            Transaction.description,
            Transaction.status,
        ).where(
            Transaction.wallet_id == transaction.wallet_id,
            Transaction.safe_nonce == transaction.safe_nonce,
            Transaction.id != transaction.id,  # Exclude current transaction
            Transaction.status == TransactionStatus.BROADCAST,
            Transaction.deleted_at.is_(None),
        ).limit(1)
        
        result = await self.db.execute(stmt)
        duplicate_tx = result.first()
        
        if duplicate_tx:
            description = duplicate_tx.description or "Untitled transaction"
            if len(description) > 50:
                description = description[:47] + "..."
            return False, (
                f"Another transaction with nonce {duplicate_tx.safe_nonce} is already broadcast: "
                f"{description}"
            )
        
        return True, ""

    # =========================================================================
    # BTC History Import
    # =========================================================================

    async def import_btc_history(
        self,
        wallet: "Wallet",
        btc_network: NetworkConfig,
        btc_node: NetworkNodeConfig,
        limit: int = 200,
        confirmed_only: bool = False,
    ) -> dict:
        """Import BTC address history as read-only transactions.

        Stores imported records in transactions table with:
        - status=PENDING_CONFIRMATION for mempool transactions
        - status=CONFIRMED for mined transactions
        - threshold=1, signature_count=1
        - payload=raw_tx_hex, payload_hash=txid
        """
        import json

        if not wallet.address:
            raise ValidationError(
                message="Wallet has no address",
                details={"wallet_id": wallet.id},
            )
        wallet_addr: str = wallet.address  # narrowed by guard above

        extra = json.loads(btc_network.extra) if isinstance(btc_network.extra, str) else (btc_network.extra or {})
        network_enum = self._resolve_btc_network(extra.get("btc_network", "mainnet"))
        embit_network = get_embit_network(network_enum)
        wallet_script = script.Script.from_address(wallet_addr)
        wallet_script_bytes = wallet_script.serialize()

        host, port, ssl = parse_electrum_url(btc_node.endpoint_url)
        client = ElectrumClient(
            host=host,
            port=port,
            use_ssl=ssl,
        )

        processed = 0
        inserted = 0
        skipped = 0
        errors: list[dict] = []

        header_cache: dict[int, datetime] = {}
        await client.connect()
        try:
            history = await client.get_history(wallet_addr)
            if confirmed_only:
                history = [item for item in history if item.height > 0]

            history = sorted(history, key=lambda item: (item.height, item.txid), reverse=True)
            history = history[:limit]

            processed = len(history)
            if processed == 0:
                return {
                    "processed": 0,
                    "inserted": 0,
                    "updated": 0,
                    "skipped": 0,
                    "errors": [],
                }

            txids = [item.txid for item in history]
            stmt = (
                select(Transaction)
                .where(
                    Transaction.wallet_id == wallet.id,
                    Transaction.tx_hash.in_(txids),
                    Transaction.deleted_at.is_(None),
                )
            )
            result = await self.db.execute(stmt)
            existing = {
                tx.tx_hash: tx
                for tx in result.scalars().all()
                if tx.tx_hash
            }

            prev_tx_cache: dict[str, BitcoinTransaction] = {}
            now = datetime.now(UTC)
            updated = 0

            for item in history:
                txid = item.txid
                is_confirmed = bool(item.height and item.height > 0)

                confirmed_at: datetime | None = None
                if is_confirmed:
                    if item.height not in header_cache:
                        header_result = await client.get_header(item.height)
                        header_hex = self._get_header_hex(header_result)
                        header_time = self._parse_btc_header_time(header_hex) if header_hex else None
                        if header_time:
                            header_cache[item.height] = header_time
                    confirmed_at = header_cache.get(item.height, now)

                existing_tx = existing.get(txid)
                if existing_tx:
                    if (
                        is_confirmed
                        and _get_status_value(existing_tx.status)
                        != TransactionStatus.CONFIRMED.value
                    ):
                        existing_tx.status = TransactionStatus.CONFIRMED
                        existing_tx.block_number = item.height
                        existing_tx.confirmed_at = confirmed_at
                        existing_tx.updated_at = now
                        existing_tx.error_message = None
                        updated += 1
                    else:
                        skipped += 1
                    continue

                try:
                    raw_tx = await client.get_raw_transaction(txid)
                    tx = BitcoinTransaction.from_string(raw_tx)

                    fields = await self._compute_btc_import_fields(
                        tx=tx,
                        wallet_address=wallet_addr,
                        wallet_script_bytes=wallet_script_bytes,
                        embit_network=embit_network,
                        prev_tx_cache=prev_tx_cache,
                        fetch_prev_tx=client.get_raw_transaction,
                    )

                    amount_btc = self._sats_to_btc_decimal(fields["amount_sats"])
                    fee_amount = (
                        self._sats_to_btc_decimal(fields["fee_sats"]) if fields["fee_sats"] > 0 else None
                    )

                    imported_tx = Transaction(
                        wallet_id=wallet.id,
                        tx_type=TransactionType.TRANSFER,
                        description=f"IMPORTED_BTC_HISTORY:{fields['direction']}",
                        to_address=fields["to_address"],
                        amount=amount_btc,
                        payload=raw_tx,
                        payload_hash=txid,
                        fee_amount=fee_amount,
                        safe_nonce=None,
                        threshold=1,
                        signature_count=1,
                        status=(
                            TransactionStatus.CONFIRMED
                            if is_confirmed
                            else TransactionStatus.PENDING_CONFIRMATION
                        ),
                        confirmed_at=confirmed_at,
                        tx_hash=txid,
                        block_number=item.height if is_confirmed else None,
                        created_at=confirmed_at or now,
                        updated_at=now,
                    )

                    self.db.add(imported_tx)
                    inserted += 1
                except (ValueError, ElectrumRPCError) as exc:
                    errors.append({"txid": txid, "reason": str(exc)})
                    continue

            if inserted > 0 or updated > 0:
                await self.db.commit()

        finally:
            await client.disconnect()

        return {
            "processed": processed,
            "inserted": inserted,
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
        }

    async def backfill_btc_history_confirmed_at(
        self,
        wallet: "Wallet",
        btc_network: NetworkConfig,
        btc_node: NetworkNodeConfig,
    ) -> dict:
        """Backfill confirmed_at for imported BTC history transactions."""
        import json

        if not wallet.address:
            raise ValidationError(
                message="Wallet has no address",
                details={"wallet_id": wallet.id},
            )
        wallet_addr: str = wallet.address  # narrowed by guard above

        extra = json.loads(btc_network.extra) if isinstance(btc_network.extra, str) else (btc_network.extra or {})
        network_enum = self._resolve_btc_network(extra.get("btc_network", "mainnet"))
        embit_network = get_embit_network(network_enum)
        wallet_script = script.Script.from_address(wallet_addr)
        wallet_script_bytes = wallet_script.serialize()

        host, port, ssl = parse_electrum_url(btc_node.endpoint_url)
        client = ElectrumClient(
            host=host,
            port=port,
            use_ssl=ssl,
        )

        updated = 0
        skipped = 0
        errors: list[dict] = []
        header_cache: dict[int, datetime] = {}

        await client.connect()
        try:
            history = await client.get_history(wallet_addr)
            height_map = {item.txid: item.height for item in history if item.height and item.height > 0}

            stmt = select(Transaction).where(
                Transaction.wallet_id == wallet.id,
                Transaction.description.like("IMPORTED_BTC_HISTORY:%"),
                Transaction.tx_hash.isnot(None),
                Transaction.deleted_at.is_(None),
            )
            result = await self.db.execute(stmt)
            txs = list(result.scalars().all())

            prev_tx_cache: dict[str, BitcoinTransaction] = {}

            for tx in txs:
                txid = tx.tx_hash or ""
                height = height_map.get(txid)
                if not height:
                    skipped += 1
                    continue

                try:
                    raw_tx = tx.payload
                    if not raw_tx or not isinstance(raw_tx, str):
                        raw_tx = await client.get_raw_transaction(txid)
                    parsed_tx = BitcoinTransaction.from_string(raw_tx)

                    if height not in header_cache:
                        header_result = await client.get_header(height)
                        header_hex = self._get_header_hex(header_result)
                        header_time = self._parse_btc_header_time(header_hex) if header_hex else None
                        if header_time:
                            header_cache[height] = header_time
                    confirmed_at = header_cache.get(height)
                    if not confirmed_at:
                        skipped += 1
                        continue

                    fields = await self._compute_btc_import_fields(
                        tx=parsed_tx,
                        wallet_address=wallet_addr,
                        wallet_script_bytes=wallet_script_bytes,
                        embit_network=embit_network,
                        prev_tx_cache=prev_tx_cache,
                        fetch_prev_tx=client.get_raw_transaction,
                    )

                    amount_btc = self._sats_to_btc_decimal(fields["amount_sats"])
                    fee_amount = (
                        self._sats_to_btc_decimal(fields["fee_sats"]) if fields["fee_sats"] > 0 else None
                    )

                    tx.confirmed_at = confirmed_at
                    tx.created_at = confirmed_at
                    tx.updated_at = datetime.now(UTC)
                    tx.amount = amount_btc
                    tx.fee_amount = fee_amount
                    tx.to_address = fields["to_address"]
                    tx.description = f"IMPORTED_BTC_HISTORY:{fields['direction']}"
                    updated += 1
                except Exception as exc:
                    errors.append({"txid": txid, "reason": str(exc)})

            if updated > 0:
                await self.db.commit()

        finally:
            await client.disconnect()

        return {
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
        }

    # =========================================================================
    # EVM Safe History Import
    # =========================================================================

    async def import_evm_safe_history(
        self,
        wallet: "Wallet",
        chain_id: int,
        limit: int = 200,
        include_incoming: bool = True,
        rpc_url: str | None = None,
    ) -> dict:
        """Import EVM Safe transaction history from Safe Transaction Service.

        Stores imported records with status=CONFIRMED (or FAILED) as
        read-only historical records. Mirrors import_btc_history pattern.
        """
        client = SafeTxServiceClient(chain_id=chain_id)
        if not client.is_supported():
            raise ValidationError(
                message=f"Network (chain_id={chain_id}) not supported by Safe Transaction Service",
                details={"chain_id": chain_id},
            )

        safe_address = wallet.address
        if not safe_address:
            raise ValidationError(
                message="Wallet has no address",
                details={"wallet_id": wallet.id},
            )
        now = datetime.now(UTC)

        errors: list[dict] = []

        # --- 1. Fetch multisig transactions ---
        try:
            multisig_txs = await client.get_multisig_transactions(
                safe_address, limit=limit, executed=True,
            )
        except SafeTxServiceError as exc:
            multisig_txs = []
            errors.append({"tx_ref": "multisig_fetch", "reason": str(exc)})

        # --- 2. Fetch incoming transfers ---
        incoming_txs: list[dict] = []
        if include_incoming:
            try:
                incoming_txs = await client.get_incoming_transfers(
                    safe_address, limit=limit,
                )
            except SafeTxServiceError as exc:
                errors.append({"tx_ref": "incoming_fetch", "reason": str(exc)})

        # --- 3. Collect existing hashes for dedup ---
        all_payload_hashes = [tx.get("safeTxHash") for tx in multisig_txs if tx.get("safeTxHash")]
        # Also check incoming payload_hash prefix for dedup
        all_payload_hashes += [
            f"incoming:{tx.get('transactionHash')}"
            for tx in incoming_txs if tx.get("transactionHash")
        ]
        all_tx_hashes = (
            [tx.get("transactionHash") for tx in multisig_txs if tx.get("transactionHash")]
            + [tx.get("transactionHash") for tx in incoming_txs if tx.get("transactionHash")]
        )

        existing_payload_hashes: set[str] = set()
        existing_tx_hashes: set[str] = set()

        if all_payload_hashes:
            stmt = (
                select(Transaction.payload_hash)
                .where(
                    Transaction.wallet_id == wallet.id,
                    Transaction.payload_hash.in_(all_payload_hashes),
                    Transaction.deleted_at.is_(None),
                )
            )
            result = await self.db.execute(stmt)
            existing_payload_hashes = {r[0] for r in result.fetchall() if r[0]}

        if all_tx_hashes:
            stmt = (
                select(Transaction.tx_hash)
                .where(
                    Transaction.wallet_id == wallet.id,
                    Transaction.tx_hash.in_(all_tx_hashes),
                    Transaction.deleted_at.is_(None),
                )
            )
            result = await self.db.execute(stmt)
            existing_tx_hashes = {r[0] for r in result.fetchall() if r[0]}

        # --- Build token info cache for decimal conversion ---
        token_info_cache: dict[str, dict] = {}  # address.lower() -> {symbol, decimals}
        web3_client = None
        if rpc_url:
            from multivault.chains.evm.web3_client import Web3Client
            web3_client = Web3Client(rpc_url=rpc_url)
            await web3_client.connect()

        try:
            stats = await self._do_import(
                wallet, safe_address, now, multisig_txs, incoming_txs,
                existing_payload_hashes, existing_tx_hashes,
                web3_client, token_info_cache,
            )
        finally:
            if web3_client:
                await web3_client.disconnect()

        total_imported = stats["multisig_imported"] + stats["incoming_imported"]
        total_synced = stats["synced"]
        if total_imported > 0 or total_synced > 0:
            await self.db.commit()

        return {
            "imported": total_imported,
            "synced": total_synced,
            "skipped": stats["skipped"],
            "failed": stats["failed"],
            "multisig_imported": stats["multisig_imported"],
            "incoming_imported": stats["incoming_imported"],
            "errors": errors + stats["errors"],
        }

    async def _do_import(
        self,
        wallet: "Wallet",
        safe_address: str,
        now: datetime,
        multisig_txs: list[dict],
        incoming_txs: list[dict],
        existing_payload_hashes: set[str],
        existing_tx_hashes: set[str],
        web3_client,
        token_info_cache: dict[str, dict],
    ) -> dict:
        """Process multisig and incoming txs with token decimal resolution."""
        multisig_imported = 0
        incoming_imported = 0
        skipped = 0
        failed = 0
        errors: list[dict] = []

        synced = 0

        # --- 4. Process multisig transactions ---
        for mtx in multisig_txs:
            safe_tx_hash = mtx.get("safeTxHash")
            tx_hash = mtx.get("transactionHash")

            if safe_tx_hash and safe_tx_hash in existing_payload_hashes:
                did_sync = await self._try_sync_existing_tx(
                    wallet.id, safe_tx_hash, mtx, now,
                )
                if did_sync:
                    synced += 1
                else:
                    skipped += 1
                continue
            if tx_hash and tx_hash in existing_tx_hashes:
                skipped += 1
                continue

            try:
                record = await self._map_multisig_tx(
                    mtx, wallet, safe_address, now, web3_client, token_info_cache,
                )
                self.db.add(record)
                multisig_imported += 1
                if safe_tx_hash:
                    existing_payload_hashes.add(safe_tx_hash)
                if tx_hash:
                    existing_tx_hashes.add(tx_hash)
            except Exception as exc:
                failed += 1
                errors.append({"tx_ref": safe_tx_hash or tx_hash or "unknown", "reason": str(exc)})

        # --- 5. Process incoming transfers ---
        for itx in incoming_txs:
            tx_hash = itx.get("transactionHash")

            if tx_hash and tx_hash in existing_tx_hashes:
                skipped += 1
                continue
            incoming_ph = f"incoming:{tx_hash}" if tx_hash else None
            if incoming_ph and incoming_ph in existing_payload_hashes:
                skipped += 1
                continue

            try:
                record = await self._map_incoming_transfer(
                    itx, wallet, now, web3_client, token_info_cache,
                )
                self.db.add(record)
                incoming_imported += 1
                if tx_hash:
                    existing_tx_hashes.add(tx_hash)
            except Exception as exc:
                failed += 1
                errors.append({"tx_ref": tx_hash or "unknown", "reason": str(exc)})

        return {
            "multisig_imported": multisig_imported,
            "incoming_imported": incoming_imported,
            "skipped": skipped,
            "synced": synced,
            "failed": failed,
            "errors": errors,
        }

    async def _try_sync_existing_tx(
        self,
        wallet_id: str,
        safe_tx_hash: str,
        mtx: dict,
        now: datetime,
    ) -> bool:
        """Sync status of an existing tx from Safe API data.

        When the Safe Transaction Service returns an executed transaction that
        matches a local non-terminal or FAILED tx, update its status to
        CONFIRMED or FAILED accordingly.  Mirrors the FAILED→CONFIRMED
        recovery logic in EVMEventIndexer._process_event.

        Returns True if a status update was applied.
        """
        execution_date = mtx.get("executionDate")
        if not execution_date:
            # Not yet executed on-chain; nothing to sync
            return False

        stmt = (
            select(Transaction)
            .where(
                Transaction.wallet_id == wallet_id,
                Transaction.payload_hash == safe_tx_hash,
            )
        )
        result = await self.db.execute(stmt)
        existing_tx = result.scalar_one_or_none()
        if existing_tx is None:
            return False

        # Skip truly terminal states (CONFIRMED, CANCELLED).
        # Allow FAILED to be recovered — on-chain success is the ultimate truth,
        # consistent with EVMEventIndexer._process_event recovery logic.
        prev_status = existing_tx.status.value if hasattr(existing_tx.status, "value") else str(existing_tx.status)
        if prev_status in (TransactionStatus.CONFIRMED.value, TransactionStatus.CANCELLED.value):
            return False

        is_successful = mtx.get("isSuccessful", False)
        on_chain_hash = mtx.get("transactionHash")
        block_number = mtx.get("blockNumber")

        # FAILED + isSuccessful=False → already failed, no change needed
        if prev_status == TransactionStatus.FAILED.value and not is_successful:
            return False

        if is_successful:
            existing_tx.status = TransactionStatus.CONFIRMED
            existing_tx.confirmed_at = now
            existing_tx.error_message = None
        else:
            existing_tx.status = TransactionStatus.FAILED
            existing_tx.error_message = "On-chain execution failed (synced from Safe API)"

        if on_chain_hash:
            existing_tx.tx_hash = on_chain_hash
        if block_number is not None:
            existing_tx.block_number = block_number

        existing_tx.updated_at = now
        logger.info(
            "Synced tx %s from Safe API: %s → %s (tx_hash=%s)",
            existing_tx.id,
            prev_status,
            existing_tx.status.value,
            on_chain_hash,
        )
        await self.db.flush()
        return True

    # ---------- private helpers ----------

    async def _resolve_token_info(
        self,
        token_address: str,
        web3_client,
        cache: dict[str, dict],
    ) -> dict:
        """Resolve token decimals/symbol via cache or web3 RPC.

        Returns {"symbol": str, "decimals": int} or {"decimals": 18} as fallback.
        """
        key = token_address.lower()
        if key in cache:
            return cache[key]

        if web3_client:
            try:
                info = await web3_client.get_erc20_info(token_address)
                cache[key] = info
                return info
            except Exception:
                pass

        fallback = {"symbol": "UNKNOWN", "decimals": 18}
        cache[key] = fallback
        return fallback

    async def _map_multisig_tx(
        self,
        mtx: dict,
        wallet: "Wallet",
        safe_address: str,
        now: datetime,
        web3_client=None,
        token_info_cache: dict[str, dict] | None = None,
    ) -> "Transaction":
        """Map a Safe TX Service multisig transaction to a Transaction record."""
        value_wei = int(mtx.get("value", "0"))
        data = mtx.get("data")
        tx_type = self._infer_multisig_tx_type(value_wei, data)

        token_address = mtx.get("to") or ""
        token_extra: dict = {}

        # For ERC20 transfers, decode amount from calldata and resolve decimals.
        if tx_type == TransactionType.TOKEN_TRANSFER and data and len(data) >= 138:
            try:
                raw_token_amount = int(data[74:138], 16)
                # Resolve token decimals from cache / web3
                cache = token_info_cache if token_info_cache is not None else {}
                token_info = await self._resolve_token_info(
                    token_address, web3_client, cache,
                )
                decimals = int(token_info.get("decimals", 18))
                amount = (
                    Decimal(raw_token_amount) / Decimal(10**decimals)
                    if decimals > 0
                    else Decimal(raw_token_amount)
                )
                token_extra["token_address"] = token_address
                if token_info.get("symbol"):
                    token_extra["token_symbol"] = token_info["symbol"]
                token_extra["token_decimals"] = decimals
                # Decode real recipient from calldata (first param of transfer)
                if len(data) >= 74:
                    recipient = "0x" + data[34:74].lstrip("0")
                    if len(recipient) > 2:
                        from web3 import Web3
                        try:
                            recipient = Web3.to_checksum_address("0x" + data[34:74][-40:])
                        except Exception:
                            pass
                        token_extra["token_recipient"] = recipient
            except (ValueError, IndexError):
                amount = Decimal(value_wei) / Decimal(10**18)
        else:
            amount = Decimal(value_wei) / Decimal(10**18)

        to_address = mtx.get("to") or ""
        direction = "SELF" if to_address.lower() == safe_address.lower() else "OUT"

        fee_wei = mtx.get("fee")
        fee_amount = Decimal(int(fee_wei)) / Decimal(10**18) if fee_wei else None

        execution_date = mtx.get("executionDate")
        confirmed_at = self._parse_iso_datetime(execution_date) if execution_date else now

        is_successful = mtx.get("isSuccessful", True)
        status = TransactionStatus.CONFIRMED if is_successful else TransactionStatus.FAILED

        confirmations = mtx.get("confirmations") or []

        extra = {
            "direction": direction,
            "operation": mtx.get("operation", 0),
            "executor": mtx.get("executor"),
            "call_data": data,
            "import_source": "safe_tx_service",
            **token_extra,
        }

        return Transaction(
            wallet_id=wallet.id,
            tx_type=tx_type,
            description=f"IMPORTED_SAFE_HISTORY:{direction}",
            to_address=to_address,
            amount=amount,
            payload=json.dumps({"origin": "safe_tx_service", "safeTxHash": mtx.get("safeTxHash")}),
            payload_hash=mtx.get("safeTxHash"),
            fee_amount=fee_amount,
            safe_nonce=mtx.get("nonce"),
            threshold=mtx.get("confirmationsRequired", wallet.threshold),
            signature_count=len(confirmations),
            status=status,
            confirmed_at=confirmed_at,
            tx_hash=mtx.get("transactionHash"),
            block_number=mtx.get("blockNumber"),
            extra=json.dumps(extra),
            created_at=confirmed_at,
            updated_at=now,
        )

    async def _map_incoming_transfer(
        self,
        itx: dict,
        wallet: "Wallet",
        now: datetime,
        web3_client=None,
        token_info_cache: dict[str, dict] | None = None,
    ) -> "Transaction":
        """Map a Safe TX Service incoming transfer to a Transaction record."""
        token_address = itx.get("tokenAddress")
        token_info = itx.get("tokenInfo") or {}
        value_raw = int(itx.get("value", "0"))

        if token_address and token_info.get("decimals") is not None:
            decimals = int(token_info["decimals"])
            amount = Decimal(value_raw) / Decimal(10**decimals) if decimals > 0 else Decimal(value_raw)
            tx_type = TransactionType.TOKEN_TRANSFER
        elif token_address:
            # tokenInfo missing from API — resolve via web3
            cache = token_info_cache if token_info_cache is not None else {}
            resolved = await self._resolve_token_info(
                token_address, web3_client, cache,
            )
            decimals = int(resolved.get("decimals", 18))
            amount = Decimal(value_raw) / Decimal(10**decimals) if decimals > 0 else Decimal(value_raw)
            tx_type = TransactionType.TOKEN_TRANSFER
            # Backfill token_info so extra fields below pick it up
            if not token_info.get("symbol") and resolved.get("symbol"):
                token_info["symbol"] = resolved["symbol"]
            if token_info.get("decimals") is None:
                token_info["decimals"] = decimals
        else:
            amount = Decimal(value_raw) / Decimal(10**18)
            tx_type = TransactionType.TRANSFER

        execution_date = itx.get("executionDate")
        confirmed_at = self._parse_iso_datetime(execution_date) if execution_date else now

        from_address = itx.get("from") or ""

        extra: dict = {
            "direction": "IN",
            "from_address": from_address,
            "import_source": "safe_tx_service",
        }
        if token_address:
            extra["token_address"] = token_address
        if token_info.get("symbol"):
            extra["token_symbol"] = token_info["symbol"]
        if token_info.get("decimals") is not None:
            extra["token_decimals"] = token_info["decimals"]

        tx_hash = itx.get("transactionHash") or None

        # For incoming transfers, to_address = wallet's own address (the recipient),
        # sender is stored in extra.from_address above.
        return Transaction(
            wallet_id=wallet.id,
            tx_type=tx_type,
            description="IMPORTED_SAFE_HISTORY:IN",
            to_address=wallet.address,
            amount=amount,
            payload="",
            payload_hash=f"incoming:{tx_hash}" if tx_hash else None,
            fee_amount=None,
            safe_nonce=None,
            threshold=1,
            signature_count=1,
            status=TransactionStatus.CONFIRMED,
            confirmed_at=confirmed_at,
            tx_hash=tx_hash,
            block_number=itx.get("blockNumber"),
            extra=json.dumps(extra),
            created_at=confirmed_at,
            updated_at=now,
        )

    # ERC20 function selectors that indicate a token transfer
    _ERC20_TRANSFER_SELECTORS = ("0xa9059cbb", "0x23b872dd")  # transfer, transferFrom

    @staticmethod
    def _infer_multisig_tx_type(value_wei: int, data: str | None) -> "TransactionType":
        """Infer TransactionType from value and calldata."""
        if data and data not in ("0x", "0x00", ""):
            if any(data.startswith(sel) for sel in TransactionService._ERC20_TRANSFER_SELECTORS):
                return TransactionType.TOKEN_TRANSFER
            return TransactionType.CONTRACT_CALL
        if value_wei > 0:
            return TransactionType.TRANSFER
        return TransactionType.CONTRACT_CALL

    @staticmethod
    def _parse_iso_datetime(s: str) -> datetime:
        """Parse ISO 8601 datetime string to aware datetime."""
        from datetime import timezone
        s = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    # =========================================================================
    # Transaction Lifecycle
    # =========================================================================

    async def create_transaction(
        self,
        wallet_id: str,
        data: TransactionCreate,
        *,
        payload: str,
        payload_hash: str | None = None,
        fee_amount: Decimal | None = None,
        tx_type: TransactionType = TransactionType.TRANSFER,
        token_symbol: str | None = None,
        token_decimals: int | None = None,
        safe_nonce: int | None = None,
        utxo_inputs: list[dict] | None = None,
    ) -> Transaction:
        """Create a new transaction in pending-sign status.

        Args:
            wallet_id: The wallet's UUID
            data: Transaction creation data from API
            payload: Chain-specific payload (PSBT base64 or Safe tx data)
            payload_hash: Hash of payload for verification
            fee_amount: Calculated fee amount
            tx_type: Transaction type
            token_symbol: Token symbol for token transfers
            token_decimals: Token decimals for token transfers
            safe_nonce: Safe nonce for EVM transactions (if pre-allocated)

        Returns:
            Created Transaction in PENDING_SIGN status

        Raises:
            NotFoundError: If wallet not found
            WalletNotActiveError: If wallet not active
            ValidationError: If validation fails
        """
        # Fetch and validate wallet
        wallet = await self._get_active_wallet(wallet_id)

        # Guard: imported wallets require at least one VERIFIED signer
        _source = wallet.source
        wallet_source = _source.value if isinstance(_source, WalletSource) else _source
        if wallet_source == WalletSource.IMPORTED.value:
            verified_count_stmt = (
                select(func.count())
                .select_from(WalletSigner)
                .join(Signer, WalletSigner.signer_id == Signer.id)
                .where(
                    WalletSigner.wallet_id == wallet_id,
                    Signer.status == SignerStatus.VERIFIED,
                )
            )
            verified_count = await self.db.scalar(verified_count_stmt) or 0
            if verified_count == 0:
                raise ValidationError(
                    message="Imported wallet has no verified signers. Verify at least one signer before creating transactions.",
                    details={"wallet_id": wallet_id},
                )

        # Determine transaction type
        if data.token_address:
            tx_type = TransactionType.TOKEN_TRANSFER

        # Create transaction
        tx = Transaction(
            wallet_id=wallet.id,
            tx_type=tx_type,
            description=data.description,
            to_address=data.to_address,
            amount=data.amount,
            payload=payload,
            payload_hash=payload_hash,
            fee_amount=fee_amount,
            safe_nonce=safe_nonce,
            threshold=wallet.threshold,
            signature_count=0,
            status=TransactionStatus.PENDING_SIGN,
        )

        # Store chain-specific metadata in extra JSON
        set_extra(
            tx,
            token_address=data.token_address,
            token_symbol=token_symbol,
            token_decimals=token_decimals,
            fee_rate=data.fee_rate,
            utxo_inputs=utxo_inputs,
        )

        self.db.add(tx)
        await self.db.commit()

        return await self.get_transaction(tx.id)

    async def submit_signature(
        self,
        transaction_id: str,
        signer_id: str,
        data: SignatureSubmit,
    ) -> Transaction:
        """Submit a signature for a transaction.

        Args:
            transaction_id: The transaction's UUID
            signer_id: The signer's UUID
            data: Signature submission data

        Returns:
            Updated Transaction

        Raises:
            NotFoundError: If transaction or signer not found
            ValidationError: If cannot sign (wrong status, not a signer, etc.)
            ConflictError: If signer already signed
        """
        tx = await self.get_transaction(transaction_id)

        # Check if can accept signatures
        tx_status = _get_status_value(tx.status)
        if not tx.can_sign:
            if tx.is_final:
                raise ValidationError(
                    message=f"Transaction is in final state: {tx.status}",
                    details={"status": tx_status},
                )
            if tx_status == TransactionStatus.SIGNED.value:
                raise ValidationError(
                    message="Transaction already has enough signatures",
                    details={"status": tx_status},
                )
            raise ValidationError(
                message=f"Cannot sign transaction in status {tx.status}",
                details={"status": tx_status},
            )

        # Validate signer belongs to wallet
        wallet_signers = await self._get_wallet_signer_ids(tx.wallet_id)
        if signer_id not in wallet_signers:
            raise ValidationError(
                message="Signer is not a member of this wallet",
                details={"signer_id": signer_id, "wallet_id": tx.wallet_id},
            )

        # Check for duplicate signature
        existing = await self._get_signature(transaction_id, signer_id)
        if existing:
            raise ConflictError(
                message="Signer has already signed this transaction",
                details={"signer_id": signer_id, "transaction_id": transaction_id},
            )

        # Parse BTC signature data to find all public keys that signed
        # BTC sig_data format: [[input_index, {pubkey: hex, signature: hex}], ...]
        import json
        signed_pubkeys: set[str] = set()
        try:
            sig_data = json.loads(data.signature_data)
            for item in sig_data:
                if isinstance(item, list) and len(item) >= 2:
                    sig_info = item[1]
                    if isinstance(sig_info, dict) and "pubkey" in sig_info:
                        signed_pubkeys.add(sig_info["pubkey"])
        except (json.JSONDecodeError, TypeError):
            pass

        # For BTC multisig: find all signers that match the pubkeys and create records for each
        if signed_pubkeys:
            # Get all wallet signers and their public keys
            wallet_signers_result = await self.db.execute(
                select(WalletSigner)
                .options(selectinload(WalletSigner.signer))
                .where(WalletSigner.wallet_id == tx.wallet_id)
            )
            wallet_signers = list(wallet_signers_result.scalars().all())

            # Map pubkey to signer_id
            pubkey_to_signer: dict[str, str] = {}
            for ws in wallet_signers:
                if ws.signer.public_key:
                    pubkey_to_signer[ws.signer.public_key] = ws.signer.id

            # Create signature record for each matching pubkey
            signers_created: set[str] = set()
            for pubkey in signed_pubkeys:
                matched_signer_id = pubkey_to_signer.get(pubkey)
                if matched_signer_id and matched_signer_id not in signers_created:
                    # Check if this signer already has a signature
                    existing_sig = await self._get_signature(transaction_id, matched_signer_id)
                    if not existing_sig:
                        sig = Signature(
                            transaction_id=transaction_id,
                            signer_id=matched_signer_id,
                            signature_data=data.signature_data,  # Store full sig data for reference
                            signature_type=data.signature_type,
                            verified=True,
                            verified_at=datetime.now(UTC),
                        )
                        self.db.add(sig)
                        signers_created.add(matched_signer_id)

            sig_count = len(signers_created) if signers_created else 1
            
            # If no signers matched (fallback), create record for the provided signer_id
            if not signers_created:
                sig = Signature(
                    transaction_id=transaction_id,
                    signer_id=signer_id,
                    signature_data=data.signature_data,
                    signature_type=data.signature_type,
                    verified=True,
                    verified_at=datetime.now(UTC),
                )
                self.db.add(sig)
        else:
            # EVM or other: single signature record
            sig = Signature(
                transaction_id=transaction_id,
                signer_id=signer_id,
                signature_data=data.signature_data,
                signature_type=data.signature_type,
                verified=True,
                verified_at=datetime.now(UTC),
            )
            self.db.add(sig)
            sig_count = 1

        # Atomic update of signature_count (avoids read-modify-write race)
        await self.db.execute(
            update(Transaction)
            .where(Transaction.id == transaction_id)
            .values(
                signature_count=Transaction.signature_count + sig_count,
                updated_at=datetime.now(UTC),
            )
        )
        await self.db.refresh(tx)  # read back latest values

        # Update status based on signature count
        if tx.signature_count >= tx.threshold:
            tx.status = TransactionStatus.SIGNED
        elif _get_status_value(tx.status) == TransactionStatus.PENDING_SIGN.value:
            tx.status = TransactionStatus.PARTIALLY_SIGNED

        await self.db.commit()

        return await self.get_transaction(transaction_id)

    async def broadcast_transaction(
        self,
        transaction_id: str,
        *,
        tx_hash: str,
    ) -> Transaction:
        """Mark transaction as broadcast.

        Called after successful chain broadcast.

        Args:
            transaction_id: The transaction's UUID
            tx_hash: The on-chain transaction hash

        Returns:
            Updated Transaction

        Raises:
            NotFoundError: If transaction not found
            ValidationError: If not in SIGNED status
            InsufficientSignaturesError: If threshold not met
        """
        tx = await self.get_transaction(transaction_id)

        # Validate status
        tx_status = _get_status_value(tx.status)
        if tx_status != TransactionStatus.SIGNED.value:
            raise ValidationError(
                message=f"Cannot broadcast transaction in status {tx.status}",
                details={"current_status": tx_status},
            )

        # Double-check threshold
        if tx.signature_count < tx.threshold:
            raise InsufficientSignaturesError(
                required=tx.threshold,
                collected=tx.signature_count,
            )

        # Update transaction
        tx.status = TransactionStatus.BROADCAST
        tx.tx_hash = tx_hash
        tx.updated_at = datetime.now(UTC)

        await self.db.commit()
        return await self.get_transaction(tx.id)

    async def confirm_on_chain(
        self,
        transaction_id: str,
        *,
        block_number: int,
        block_hash: str | None = None,
    ) -> Transaction:
        """Mark transaction as confirmed on chain.

        Args:
            transaction_id: The transaction's UUID
            block_number: Block number containing the transaction
            block_hash: Optional block hash

        Returns:
            Updated Transaction

        Raises:
            NotFoundError: If transaction not found
            ValidationError: If not in BROADCAST status
        """
        tx = await self.get_transaction(transaction_id)

        # Validate status
        tx_status = _get_status_value(tx.status)
        if tx_status != TransactionStatus.BROADCAST.value:
            raise ValidationError(
                message=f"Cannot confirm transaction in status {tx.status}",
                details={"current_status": tx_status},
            )

        # Update transaction
        tx.status = TransactionStatus.CONFIRMED
        tx.block_number = block_number
        if block_hash:
            set_extra(tx, block_hash=block_hash)
        tx.confirmed_at = datetime.now(UTC)
        tx.updated_at = datetime.now(UTC)

        await self.db.commit()
        await self.db.refresh(tx)

        return tx

    async def get_safe_cancellation_options(
        self,
        transaction_id: str,
    ) -> dict:
        """Get available cancellation options for a Safe transaction.
        
        Returns information about whether the transaction can be cancelled
        in database only, or requires on-chain cancellation.
        
        Args:
            transaction_id: The transaction's UUID
            
        Returns:
            Dictionary with cancellation options:
            {
                "can_cancel_offchain": bool,  # Can do database-only cancel
                "can_cancel_onchain": bool,   # Can do on-chain cancel
                "is_latest_nonce": bool,
                "reason": str,
            }
        """
        from multivault.models.signer import ChainType
        from multivault.models.wallet import Wallet
        
        tx = await self.get_transaction(transaction_id)
        
        # Check if transaction can be cancelled
        tx_status = _get_status_value(tx.status)
        if tx.is_final:
            return {
                "can_cancel_offchain": False,
                "can_cancel_onchain": False,
                "is_latest_nonce": False,
                "reason": f"Transaction is in final status: {tx.status}",
            }
        
        if tx_status == TransactionStatus.BROADCAST.value:
            return {
                "can_cancel_offchain": False,
                "can_cancel_onchain": False,
                "is_latest_nonce": False,
                "reason": "Transaction already broadcast to network",
            }
        
        # Get wallet
        wallet_stmt = select(Wallet).where(Wallet.id == tx.wallet_id)
        wallet_result = await self.db.execute(wallet_stmt)
        wallet = wallet_result.scalar_one()
        
        chain_type_value = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
        is_safe_wallet = (
            chain_type_value == ChainType.EVM.value and 
            tx.safe_nonce is not None
        )
        
        if not is_safe_wallet:
            # Non-Safe wallets: always can cancel offchain
            return {
                "can_cancel_offchain": True,
                "can_cancel_onchain": False,
                "is_latest_nonce": True,
                "reason": "Non-Safe wallet: simple database cancellation",
            }
        
        # Safe wallet: check if this is the latest nonce
        assert tx.safe_nonce is not None
        is_latest = await self._is_latest_safe_nonce(tx.wallet_id, tx.safe_nonce)
        
        return {
            "can_cancel_offchain": is_latest,
            "can_cancel_onchain": True,
            "is_latest_nonce": is_latest,
            "reason": (
                "Latest nonce: can cancel offchain (free) or onchain (costs gas)"
                if is_latest
                else "Not latest nonce: must cancel onchain to prevent nonce gap"
            ),
        }
    
    async def _is_latest_safe_nonce(
        self,
        wallet_id: str,
        nonce: int,
    ) -> bool:
        """Check if the given nonce is the highest active nonce for the wallet.
        
        Args:
            wallet_id: Wallet UUID
            nonce: Nonce to check
            
        Returns:
            True if no active transactions have higher nonce
        """
        stmt = select(func.max(Transaction.safe_nonce)).where(
            Transaction.wallet_id == wallet_id,
            Transaction.safe_nonce.isnot(None),
            Transaction.status.in_([
                TransactionStatus.PENDING_SIGN,
                TransactionStatus.PARTIALLY_SIGNED,
                TransactionStatus.SIGNED,
                TransactionStatus.BROADCAST,
            ]),
            Transaction.deleted_at.is_(None),
        )
        result = await self.db.execute(stmt)
        max_nonce = result.scalar()
        
        return max_nonce is None or max_nonce == nonce
    
    async def cancel_transaction(
        self,
        transaction_id: str,
        *,
        on_chain: bool = False,
        reason: str | None = None,
    ) -> Transaction:
        """Cancel a pending transaction.
        
        For EVM Safe wallets:
        - If latest nonce: can choose offchain (database) or onchain cancellation
        - If not latest: must use onchain cancellation to prevent nonce gap
        - Onchain: creates CANCELLATION transaction (0 ETH to self, same nonce)
        - Offchain: directly marks as CANCELLED (nonce can be reused)
        
        For non-Safe or BTC wallets:
        - Always offchain (database) cancellation

        Args:
            transaction_id: The transaction's UUID
            on_chain: Force on-chain cancellation (ignored for non-Safe)
            reason: Optional cancellation reason

        Returns:
            Cancellation transaction (onchain) or original transaction (offchain)

        Raises:
            NotFoundError: If transaction not found
            ValidationError: If transaction cannot be cancelled or wrong method chosen
        """
        from multivault.models.signer import ChainType
        from multivault.models.wallet import Wallet
        
        tx = await self.get_transaction(transaction_id)

        # Can only cancel pending transactions
        tx_status = _get_status_value(tx.status)
        if tx.is_final:
            raise ValidationError(
                message=f"Cannot cancel transaction in status {tx.status}",
                details={"current_status": tx_status},
            )

        if tx_status == TransactionStatus.BROADCAST.value:
            raise ValidationError(
                message="Cannot cancel broadcast transaction",
                details={"current_status": tx_status, "tx_hash": tx.tx_hash},
            )
        
        # Get wallet to check if it's Safe
        wallet_stmt = select(Wallet).where(Wallet.id == tx.wallet_id)
        wallet_result = await self.db.execute(wallet_stmt)
        wallet = wallet_result.scalar_one()
        
        chain_type_value = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
        is_safe_wallet = (
            chain_type_value == ChainType.EVM.value and 
            tx.safe_nonce is not None
        )
        
        if is_safe_wallet:
            # Safe wallet: check if latest nonce
            assert tx.safe_nonce is not None
            is_latest = await self._is_latest_safe_nonce(tx.wallet_id, tx.safe_nonce)
            
            if not is_latest and not on_chain:
                # Not latest nonce: MUST use on-chain cancellation
                raise ValidationError(
                    message="Cannot cancel offchain: transaction is not the latest nonce",
                    details={
                        "transaction_nonce": tx.safe_nonce,
                        "is_latest": False,
                        "hint": "Use on_chain=True to create cancellation transaction",
                    },
                )
            
            if on_chain:
                # On-chain cancellation: create CANCELLATION transaction
                # Get correct RPC URL for wallet's network (BEFORE creating cancellation tx)
                rpc_url = None
                if wallet.network_id:
                    from multivault.services.network_service import NetworkService
                    network_service = NetworkService(self.db)
                    node = await network_service.get_default_node(wallet.network_id)
                    if node:
                        rpc_url = node.endpoint_url
                
                return await self._create_safe_cancellation_transaction(
                    tx, wallet, reason, rpc_url=rpc_url
                )
            else:
                # Offchain cancellation: direct database marking (latest nonce only)
                tx.status = TransactionStatus.CANCELLED
                tx.error_message = None
                set_extra(
                    tx,
                    cancellation_method="offchain",
                    cancellation_reason=reason,
                )
                tx.updated_at = datetime.now(UTC)
                
                await self.db.commit()
                return await self.get_transaction(tx.id)
        else:
            # Non-Safe: direct cancellation
            tx.status = TransactionStatus.CANCELLED
            tx.error_message = None
            set_extra(
                tx,
                cancellation_method="offchain",
                cancellation_reason=reason,
            )
            tx.updated_at = datetime.now(UTC)
            
            await self.db.commit()
            return await self.get_transaction(tx.id)
    
    async def _create_safe_cancellation_transaction(
        self,
        original_tx: Transaction,
        wallet: "Wallet",
        reason: str | None,
        rpc_url: str | None = None,
    ) -> Transaction:
        """Create a Safe cancellation transaction.
        
        Creates a new transaction that sends 0 ETH to the wallet itself,
        using the same nonce as the original transaction. This effectively
        "replaces" the original transaction on-chain.
        
        Args:
            original_tx: The transaction to cancel
            wallet: The Safe wallet
            reason: Cancellation reason
            rpc_url: Optional RPC URL (uses settings default if not provided)
            
        Returns:
            The cancellation transaction (needs signatures)
        """
        import json
        from decimal import Decimal

        from multivault.chains.evm import (
            SafeManager,
            Web3Client,
        )
        from multivault.config import get_settings

        # Mark original as CANCELLED
        original_tx.status = TransactionStatus.CANCELLED
        original_tx.error_message = None
        set_extra(
            original_tx,
            cancellation_method="onchain_replacement",
            cancellation_reason=reason,
        )
        original_tx.updated_at = datetime.now(UTC)
        
        # Build Safe TypedData for the cancellation transaction
        if not rpc_url:
            raise ValidationError(
                message="No RPC URL configured for wallet's network",
                details={"wallet_id": wallet.id, "network_id": wallet.network_id},
            )
        
        if not wallet.address:
            raise ValidationError(
                message="Wallet has no address",
                details={"wallet_id": wallet.id},
            )
        wallet_addr: str = wallet.address  # narrowed by guard above
        
        assert original_tx.safe_nonce is not None
        
        client = Web3Client(rpc_url=rpc_url)
        
        try:
            await client.connect()
            safe_manager = SafeManager(client=client)
            
            # Build Safe transaction: 0 ETH to self, same nonce
            safe_tx = await safe_manager.build_safe_transaction(
                safe_address=wallet_addr,
                to=wallet_addr,  # Send to self
                value=0,  # 0 ETH
                data=b"",  # No data
                nonce=original_tx.safe_nonce,  # SAME NONCE as original!
            )
            
            # Store the Safe tx hash as payload_hash (this is what signers will sign)
            payload_hash = "0x" + safe_tx.tx_hash.hex()
            
            # Store typed data JSON as payload (for signing)
            payload = json.dumps(safe_tx.get_typed_data())
            
        finally:
            await client.disconnect()
        
        # Create cancellation transaction
        cancellation_tx = Transaction(
            wallet_id=wallet.id,
            tx_type=TransactionType.CANCELLATION,
            to_address=wallet.address,  # Send to self
            amount=Decimal("0"),  # 0 ETH
            payload=payload,  # Safe TypedData JSON
            payload_hash=payload_hash,  # SafeTxHash for verification
            threshold=wallet.threshold,
            status=TransactionStatus.PENDING_SIGN,
            safe_nonce=original_tx.safe_nonce,  # SAME NONCE!
            safe_replaces_tx_id=original_tx.id,
            description=f"Cancel: {original_tx.description or 'transaction'}",
        )
        
        self.db.add(cancellation_tx)
        await self.db.commit()
        return await self.get_transaction(cancellation_tx.id)

    async def fail_transaction(
        self,
        transaction_id: str,
        error: str,
    ) -> Transaction:
        """Mark transaction as failed.

        Args:
            transaction_id: The transaction's UUID
            error: Error message

        Returns:
            Updated Transaction
        """
        tx = await self.get_transaction(transaction_id)

        # Guard: terminal states are irreversible
        if tx.is_final:
            raise ValidationError(
                message=f"Cannot fail transaction in terminal status {tx.status}",
                details={"current_status": _get_status_value(tx.status)},
            )

        tx.status = TransactionStatus.FAILED
        tx.error_message = error
        tx.updated_at = datetime.now(UTC)

        await self.db.commit()
        await self.db.refresh(tx)

        return tx

    # =========================================================================
    # KeyVault Signing Payload
    # =========================================================================

    _CHAIN_ID_TO_KEYVAULT_SYMBOL: dict[int, str] = {
        1: "ETH",
        11155111: "SEPOLIA",
        56: "BSC",
        137: "POL",
        42161: "ARBITRUM",
        8453: "BASE",
        10: "OP",
        43114: "AVAX",
        250: "FTM",
        61: "ETC",
    }

    async def generate_keyvault_signing_payload(
        self,
        transaction_id: str,
        signer_id: str,
    ) -> dict:
        """Generate KeyVault-compatible signing payload for a transaction."""
        import time

        tx = await self.get_transaction(transaction_id)

        wallet_stmt = (
            select(Wallet)
            .options(selectinload(Wallet.network))
            .where(Wallet.id == tx.wallet_id, Wallet.deleted_at.is_(None))
        )
        wallet = (await self.db.execute(wallet_stmt)).scalar_one_or_none()
        if not wallet:
            raise NotFoundError("Wallet", tx.wallet_id)

        wallet_signer_ids = await self._get_wallet_signer_ids(wallet.id)
        if signer_id not in wallet_signer_ids:
            raise ValidationError(
                message="Signer is not a member of this wallet",
                details={"signer_id": signer_id, "wallet_id": wallet.id},
            )

        signer_stmt = select(Signer).where(
            Signer.id == signer_id,
            Signer.deleted_at.is_(None),
        )
        signer = (await self.db.execute(signer_stmt)).scalar_one_or_none()
        if not signer:
            raise NotFoundError("Signer", signer_id)

        permission_address = signer.address if signer.address else None

        chain_type_val = (
            wallet.chain_type.value
            if hasattr(wallet.chain_type, "value")
            else str(wallet.chain_type)
        )

        task_id = f"{transaction_id}-{int(time.time())}"
        now_ts = int(time.time())
        expire_ts = now_ts + 300
        nonce_ts = int(time.time() * 1000)
        nxv_action = "multi_sign" 
        network = wallet.network
        is_testnet = getattr(network, "is_testnet", False) if network else False
        chain_net_type = "testnet" if is_testnet else "mainnet"
        # Normalize Decimal values to avoid IEEE 754 float→Decimal precision artifacts
        # (SQLite stores Numeric as real; Decimal(float) expands to ~52 decimal places)
        amount_str = str(float(tx.amount)) if tx.amount else "0"
        fee_str = str(float(tx.fee_amount)) if tx.fee_amount else "0"
        symbol = "BTC" if chain_type_val == ChainType.BTC.value else "ETH"
        to_list = [{
            "address": tx.to_address or "",
            "volume": amount_str,
            "amount": "0",
            "to_tag": "",
        }]
        pisces_info = {
            "latest_ver": "1.0.9",
            "min_ver": "1.0.0",
            "nxv_action": nxv_action,
            "upgrade_url": "",
        }

        if chain_type_val == ChainType.EVM.value:
            extra = get_extra_field(network, "chain_id") if network else None
            evm_chain_id = int(extra) if extra is not None else 1
            if is_testnet:
                chain_type_name = "ETH"
            else:
                chain_type_name = self._CHAIN_ID_TO_KEYVAULT_SYMBOL.get(
                    evm_chain_id, "ETH"
                )
            symbol = chain_type_name
            to_list[0]["amount"] = "0"

            typed_data = json.loads(tx.payload)

            # Resolve display fields based on transaction type
            tx_type_val = (
                tx.tx_type.value
                if hasattr(tx.tx_type, "value")
                else str(tx.tx_type)
            )

            if tx_type_val == TransactionType.TOKEN_TRANSFER.value:
                display_symbol = get_extra_field(tx, "token_symbol") or chain_type_name
                token_contract = get_extra_field(tx, "token_address") or ""
                transfer_type = "transfer"
                description = ""
            elif tx_type_val == TransactionType.SAFE_POLICY_CHANGE.value:
                display_symbol = chain_type_name
                token_contract = ""
                transfer_type = "policy_change"
                description = tx.description or ""
            elif tx_type_val == TransactionType.CANCELLATION.value:
                display_symbol = chain_type_name
                token_contract = ""
                transfer_type = "cancellation"
                description = tx.description or ""
            else:
                # TRANSFER (native) / CONTRACT_CALL / SAFE_DEPLOY / any future types
                display_symbol = chain_type_name
                token_contract = ""
                transfer_type = "transfer"
                description = ""

            business = {
                "chain_id": wallet.network_id,
                "chain_symbol": chain_type_name,
                "contract": token_contract,
                "fee": fee_str,
                "fee_amount": fee_str,
                "from_address": wallet.address or "",
                "permission_address": permission_address or "",
                "pisces_info": pisces_info,
                "symbol": display_symbol,
                "task_id": task_id,
                "to": to_list,
                "wallet_id": wallet.id,
                "wallet_name": wallet.name,
                "wallet_address": wallet.address or "",
                "user_name": "",
                "user_id": "",
                "evm_chain_id": evm_chain_id,
                "chain_type": chain_type_name,
                "chain_net_type": chain_net_type,
            }
            if description:
                business["description"] = description

            transfer_item = {
                "transfer_id": transaction_id,
                "symbol": display_symbol,
                "to": tx.to_address or "",
                "transfer_type": transfer_type,
                "volume": amount_str,
                "transfer_message": typed_data,
            }
        else:
            chain_type_name = (
                "BTC_TESTNET" if is_testnet else "BTC"
            )
            business = {
                "chain_id": wallet.network_id,
                "chain_symbol": "BTC",
                "contract": "",
                "fee": fee_str,
                "fee_amount": fee_str,
                "from_address": wallet.address or "",
                "permission_address": permission_address or "",
                "pisces_info": pisces_info,
                "symbol": "BTC",
                "task_id": task_id,
                "to": to_list,
                "wallet_id": wallet.id,
                "wallet_name": wallet.name,
                "wallet_address": wallet.address or "",
                "user_name": "",
                "user_id": "",
                "chain_type": chain_type_name,
                "chain_net_type": chain_net_type,
            }

            tx_hex = base64.b64decode(tx.payload).hex()
            tx_data = {"txHex": tx_hex}
            # tx_data["meta"] = {
            #     "fee": fee_str,
            #     "changeValue": "0",
            #     "totalInputValue": "0",
            #     "totalSendValue": amount_str,
            #     "txSize": 0,
            # }
            transfer_item = {
                "transfer_id": transaction_id,
                "symbol": "BTC",
                "to": tx.to_address or "",
                "transfer_type": "transfer",
                "volume": amount_str,
                "transfer_message": {"txData": tx_data},
            }

        w_meta = {
            "task_id": task_id,
            "wallet_data": [transfer_item],
        }
        business_data = json.dumps(business, separators=(",", ":"))
        wallet_data_str = json.dumps(w_meta, separators=(",", ":"))
        b_signature = rsa_sign_for_keyvault(business_data)
        w_signature = rsa_sign_for_keyvault(wallet_data_str)

        headers = {
            "nxv_protocol_version": "1.0",
            "nxv_platform": "KeyVault",
            "nxv_expire": expire_ts,
            "nxv_nonce": nonce_ts,
            "nxv_action": nxv_action,
        }
        payload: dict = {
            "headers": headers,
            "s_data": {},
            "b_data": {
                "business_data": business_data,
                "signature": b_signature,
            },
            "w_data": {
                "transfer_data": {
                    "wallet_data": wallet_data_str,
                    "signature": w_signature,
                },
            },
        }

        return {
            "payload_json": json.dumps(payload, separators=(",", ":")),
            "signer_id": signer_id,
        }

    # =========================================================================
    # Query Operations
    # =========================================================================

    async def get_transaction(self, transaction_id: str) -> Transaction:
        """Get a transaction by ID with signatures loaded.

        Args:
            transaction_id: The transaction's UUID

        Returns:
            Transaction model with relationships

        Raises:
            NotFoundError: If transaction not found or deleted
        """
        stmt = (
            select(Transaction)
            .options(
                selectinload(Transaction.signatures).selectinload(Signature.signer),
                selectinload(Transaction.wallet),
            )
            .where(Transaction.id == transaction_id, Transaction.deleted_at.is_(None))
        )
        result = await self.db.execute(stmt)
        tx = result.scalar_one_or_none()

        if not tx:
            raise NotFoundError("Transaction", transaction_id)

        return tx

    async def get_transaction_by_hash(self, tx_hash: str) -> Transaction | None:
        """Get a transaction by on-chain hash.

        Args:
            tx_hash: The on-chain transaction hash

        Returns:
            Transaction model or None
        """
        stmt = (
            select(Transaction)
            .where(Transaction.tx_hash == tx_hash, Transaction.deleted_at.is_(None))
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_transactions(
        self,
        wallet_id: str,
        query: TransactionQuery,
    ) -> tuple[list[Transaction], int]:
        """List transactions for a wallet.

        Args:
            wallet_id: The wallet's UUID
            query: Query parameters

        Returns:
            Tuple of (transactions, total_count)
        """
        # Base query
        stmt = select(Transaction).where(
            Transaction.wallet_id == wallet_id,
            Transaction.deleted_at.is_(None),
        )

        # Apply filters
        if query.status:
            stmt = stmt.where(Transaction.status == query.status)

        # Count total
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = await self.db.scalar(count_stmt) or 0

        # Apply pagination and ordering
        stmt = stmt.order_by(Transaction.created_at.desc())
        stmt = stmt.offset((query.page - 1) * query.page_size).limit(query.page_size)

        result = await self.db.execute(stmt)
        transactions = list(result.scalars().all())

        return transactions, total

    async def list_pending_transactions(
        self,
        wallet_id: str | None = None,
    ) -> list[Transaction]:
        """List all transactions requiring user action (signing or broadcasting).

        Includes PENDING_SIGN, PARTIALLY_SIGNED, and SIGNED (ready to broadcast)
        transactions.

        Args:
            wallet_id: Optional wallet filter

        Returns:
            List of pending transactions
        """
        stmt = select(Transaction).where(
            Transaction.deleted_at.is_(None),
            Transaction.status.in_([
                TransactionStatus.PENDING_SIGN,
                TransactionStatus.PARTIALLY_SIGNED,
                TransactionStatus.SIGNED,
            ]),
        )

        if wallet_id:
            stmt = stmt.where(Transaction.wallet_id == wallet_id)

        stmt = stmt.order_by(Transaction.created_at.asc())

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    # =========================================================================
    # Signature Operations
    # =========================================================================

    async def get_signatures(self, transaction_id: str) -> list[Signature]:
        """Get all signatures for a transaction.

        Args:
            transaction_id: The transaction's UUID

        Returns:
            List of Signature models
        """
        stmt = (
            select(Signature)
            .options(selectinload(Signature.signer))
            .where(Signature.transaction_id == transaction_id)
            .order_by(Signature.created_at)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_combined_payload(self, transaction_id: str) -> str:
        """Get the transaction payload with all signatures combined.

        For BTC: Combined PSBT with all partial sigs
        For EVM: Safe tx data with concatenated signatures

        Args:
            transaction_id: The transaction's UUID

        Returns:
            Combined payload string

        Raises:
            NotFoundError: If transaction not found
        """
        tx = await self.get_transaction(transaction_id)
        signatures = await self.get_signatures(transaction_id)

        # The actual combination logic would be in the chain adapter
        # Here we just return the signature data for the service layer
        # The caller is responsible for using chain adapter to combine
        return tx.payload

    # =========================================================================
    # Private Methods
    # =========================================================================

    async def _get_active_wallet(self, wallet_id: str) -> Wallet:
        """Get wallet and validate it's active.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            Wallet model

        Raises:
            NotFoundError: If wallet not found
            WalletNotActiveError: If wallet not active
        """
        stmt = (
            select(Wallet)
            .where(Wallet.id == wallet_id, Wallet.deleted_at.is_(None))
        )
        result = await self.db.execute(stmt)
        wallet = result.scalar_one_or_none()

        if not wallet:
            raise NotFoundError("Wallet", wallet_id)

        wallet_status = _get_status_value(wallet.status)
        if wallet_status != WalletStatus.ACTIVE.value:
            raise WalletNotActiveError(wallet_id, wallet_status)

        return wallet

    async def _get_wallet_signer_ids(self, wallet_id: str) -> set[str]:
        """Get set of signer IDs for a wallet.

        Args:
            wallet_id: The wallet's UUID

        Returns:
            Set of signer IDs
        """
        stmt = select(WalletSigner.signer_id).where(
            WalletSigner.wallet_id == wallet_id
        )
        result = await self.db.execute(stmt)
        return set(result.scalars().all())

    async def _get_signature(
        self,
        transaction_id: str,
        signer_id: str,
    ) -> Signature | None:
        """Get existing signature for a transaction/signer pair.

        Args:
            transaction_id: The transaction's UUID
            signer_id: The signer's UUID

        Returns:
            Signature model or None
        """
        stmt = select(Signature).where(
            Signature.transaction_id == transaction_id,
            Signature.signer_id == signer_id,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
