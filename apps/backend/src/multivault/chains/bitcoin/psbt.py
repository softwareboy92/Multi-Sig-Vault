"""
PSBT (Partially Signed Bitcoin Transaction) Builder.

Implements BIP-174 compliant PSBT construction for multisig transactions:
- UTXO selection (largest-first strategy)
- Fee calculation based on virtual bytes
- Change output handling
- Witness script embedding for P2WSH inputs

References:
- BIP-174: https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki
- BIP-371: https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki (Taproot PSBT)
"""

from dataclasses import dataclass, field
from hashlib import new as hashlib_new
from hashlib import sha256
from typing import Sequence

from embit import ec, script
from embit.psbt import PSBT, DerivationPath, InputScope, OutputScope
from embit.transaction import Transaction, TransactionInput, TransactionOutput

from multivault.chains.bitcoin.address import (
    BitcoinNetwork,
    build_multisig_script,
    get_embit_network,
    parse_witness_script,
)
from multivault.chains.bitcoin.electrum import ElectrumUTXO


def _strip_witness(tx: Transaction) -> Transaction:
    """Return a copy of *tx* with all witness data removed.

    BIP-174 ``PSBT_IN_NON_WITNESS_UTXO`` stores the previous transaction so
    that signers can verify the outpoint hash.  embit's
    ``Transaction.serialize()`` includes the SegWit marker, flag and witness
    items when the transaction was originally parsed from a witness-serialized
    raw hex (e.g. from Electrum).  That causes the serialized bytes to differ
    from the non-witness serialization whose SHA-256d equals the txid, making
    hardware-wallet PSBT parsers (Ledger, Trezor) reject the PSBT with
    "Non-witness UTXO does not match outpoint hash".

    Stripping the witness before assignment ensures ``serialize()`` produces
    the legacy (non-witness) byte stream whose hash matches the txid.
    """
    stripped = Transaction(version=tx.version, locktime=tx.locktime, vin=[], vout=[])
    for vin in tx.vin:
        stripped.vin.append(
            TransactionInput(
                txid=vin.txid,
                vout=vin.vout,
                script_sig=vin.script_sig,
                sequence=vin.sequence,
            )
        )
    for vout in tx.vout:
        stripped.vout.append(vout)
    return stripped


class PSBTError(Exception):
    """Base exception for PSBT-related errors."""

    pass


class InsufficientFundsError(PSBTError):
    """Not enough funds to cover transaction amount and fees."""

    def __init__(self, required: int, available: int):
        self.required = required
        self.available = available
        super().__init__(
            f"Insufficient funds: need {required} sat, have {available} sat"
        )


class InvalidAddressError(PSBTError):
    """Invalid Bitcoin address format."""

    pass


@dataclass
class TxOutput:
    """Transaction output specification."""

    address: str
    amount: int  # satoshis


@dataclass
class PSBTInfo:
    """Information about a constructed PSBT."""

    psbt_base64: str
    psbt_hex: str
    fee: int
    fee_rate: float  # sat/vB
    input_count: int
    output_count: int
    total_input: int
    total_output: int
    change_amount: int
    estimated_vsize: int
    selected_utxos: list[dict] | None = None  # [{txid, vout, value}]


@dataclass
class KeyOrigin:
    """BIP32 key origin information for a public key."""
    
    public_key: str  # Hex-encoded compressed public key
    master_fingerprint: str  # 4-byte fingerprint as hex
    derivation_path: str  # Full derivation path e.g., "m/48'/0'/0'/2'/0/0"


@dataclass
class MultisigConfig:
    """Configuration for the multisig wallet."""

    threshold: int
    public_keys: list[str]
    witness_script: bytes = field(default_factory=bytes)
    # Optional: BIP32 key origins for each public key (for PSBT bip32_derivations)
    key_origins: list[KeyOrigin] = field(default_factory=list)
    redeem_script: bytes | None = None
    script_type: str = "p2wsh"

    def __post_init__(self):
        """Build witness script if not provided."""
        if not self.witness_script:
            self.witness_script = build_multisig_script(
                self.threshold, self.public_keys
            )


class PSBTBuilder:
    """
    Builder for constructing PSBTs for multisig transactions.

    This class handles:
    - UTXO selection
    - Fee estimation
    - Change output creation
    - PSBT encoding with witness scripts

    Example:
        builder = PSBTBuilder(
            network=BitcoinNetwork.MAINNET,
            multisig_config=MultisigConfig(
                threshold=2,
                public_keys=[pk1, pk2, pk3],
            ),
        )
        psbt_info = builder.build(
            utxos=utxos,
            outputs=[TxOutput("bc1q...", 50000)],
            change_address="bc1q...",
            fee_rate=10,
        )
    """

    # Estimated vbytes per input/output for fee calculation
    # P2WSH multisig input: ~(10.5 + 73*M + 34*N) vbytes
    # Standard output: ~31-43 vbytes depending on type
    VBYTES_PER_INPUT_BASE = 41  # Base input without witness
    VBYTES_PER_SIG = 73  # Approximate signature size
    VBYTES_PER_PUBKEY = 34  # Pubkey in witness script
    VBYTES_P2WPKH_OUTPUT = 31
    VBYTES_P2WSH_OUTPUT = 43
    VBYTES_P2TR_OUTPUT = 43
    VBYTES_P2SH_OUTPUT = 32  # value(8) + varint(1) + OP_HASH160 PUSH20 <hash> OP_EQUAL(23)
    VBYTES_P2PKH_OUTPUT = 34  # value(8) + varint(1) + OP_DUP OP_HASH160 PUSH20 <hash> OP_EQUALVERIFY OP_CHECKSIG(25)
    VBYTES_OVERHEAD = 11  # Version, locktime, counts, segwit marker/flag amortized

    # Dust limit (below this, outputs are uneconomical)
    DUST_LIMIT = 546

    def __init__(
        self,
        network: BitcoinNetwork = BitcoinNetwork.MAINNET,
        multisig_config: MultisigConfig | None = None,
    ):
        """
        Initialize PSBT builder.

        Args:
            network: Bitcoin network.
            multisig_config: Multisig wallet configuration.
        """
        self.network = network
        self.multisig_config = multisig_config
        self._embit_network = get_embit_network(network)

    def estimate_input_vbytes(self) -> int:
        """
        Estimate virtual bytes per multisig input.

        For M-of-N multisig:
        - Witness: OP_0 + M signatures + witness_script
        - Each signature is ~73 bytes
        - Witness script is ~(1 + 34*N + 2) bytes
        - P2SH-P2WSH adds scriptSig overhead (push of redeem_script)

        vsize contribution = non_witness_bytes + witness_bytes / 4
        """
        if not self.multisig_config:
            return 100  # Default estimate

        m = self.multisig_config.threshold

        # Witness data (bytes in the witness section)
        witness_script_len = len(self.multisig_config.witness_script)
        witness_bytes = (
            1  # Number of stack items (varint)
            + 1  # Empty element for OP_CHECKMULTISIG (varint len=0)
            + m * (1 + 72)  # M signatures with varint length prefix (~72 bytes each)
            + (1 if witness_script_len < 253 else 3)  # Witness script varint length
            + witness_script_len  # Witness script data
        )

        # Non-witness base: txid(32) + vout(4) + scriptSig_varint + scriptSig + sequence(4)
        base_input = 32 + 4 + 4  # txid + vout + sequence
        if self.multisig_config.script_type == "p2sh-p2wsh":
            # scriptSig = push(redeem_script): 1-byte push opcode + redeem_script
            # redeem_script for P2WSH wrap = 0x0020{32-byte-hash} = 34 bytes
            rs_len = len(self.multisig_config.redeem_script) if self.multisig_config.redeem_script else 34
            script_sig_len = 1 + rs_len  # push opcode + data
            base_input += 1 + script_sig_len  # varint(scriptSig length) + scriptSig
        else:
            # Native P2WSH: scriptSig is empty
            base_input += 1  # varint(0) for empty scriptSig

        return base_input + (witness_bytes + 3) // 4

    def estimate_output_vbytes(self, address: str) -> int:
        """Estimate virtual bytes for an output based on address type."""
        # P2TR (Taproot) - bc1p...
        if address.startswith("bc1p") or address.startswith("tb1p"):
            return self.VBYTES_P2TR_OUTPUT
        # P2WPKH (42 chars) vs P2WSH (62 chars) - both start with bc1q/tb1q
        elif address.startswith("bc1q") or address.startswith("tb1q"):
            # P2WPKH is 42 chars, P2WSH is 62 chars
            if len(address) <= 44:  # Allow some margin
                return self.VBYTES_P2WPKH_OUTPUT
            else:
                return self.VBYTES_P2WSH_OUTPUT
        # P2SH - starts with "3" (mainnet) or "2" (testnet)
        elif address.startswith("3") or address.startswith("2"):
            return self.VBYTES_P2SH_OUTPUT
        # P2PKH - starts with "1" (mainnet) or "m"/"n" (testnet)
        elif address.startswith("1") or address.startswith("m") or address.startswith("n"):
            return self.VBYTES_P2PKH_OUTPUT
        else:
            # Unknown — use P2WSH estimate as conservative default
            return self.VBYTES_P2WSH_OUTPUT

    def estimate_vsize(
        self,
        input_count: int,
        outputs: list[TxOutput],
        include_change: bool = True,
        change_address: str | None = None,
    ) -> int:
        """
        Estimate transaction virtual size in vbytes.

        Args:
            input_count: Number of inputs.
            outputs: List of outputs.
            include_change: Whether to include a change output.
            change_address: Address for change output type estimation.

        Returns:
            Estimated vsize in vbytes.
        """
        vsize = self.VBYTES_OVERHEAD
        vsize += input_count * self.estimate_input_vbytes()

        for output in outputs:
            vsize += self.estimate_output_vbytes(output.address)

        if include_change and change_address:
            vsize += self.estimate_output_vbytes(change_address)

        return vsize

    def select_utxos(
        self,
        utxos: list[ElectrumUTXO],
        target_amount: int,
        fee_rate: int,
        change_address: str,
        outputs: list[TxOutput],
    ) -> tuple[list[ElectrumUTXO], int, int]:
        """
        Select UTXOs to cover target amount plus fees.

        Uses a simple largest-first selection strategy.

        Args:
            utxos: Available UTXOs.
            target_amount: Amount to send (excluding fees).
            fee_rate: Fee rate in sat/vB.
            change_address: Address for change calculation.
            outputs: Destination outputs for vsize estimation.

        Returns:
            Tuple of (selected_utxos, total_selected, estimated_fee).

        Raises:
            InsufficientFundsError: If not enough funds.
        """
        # Sort by value descending (largest first)
        sorted_utxos = sorted(utxos, key=lambda u: u.value, reverse=True)

        selected = []
        total = 0

        for utxo in sorted_utxos:
            selected.append(utxo)
            total += utxo.value

            # Estimate fee with current selection
            vsize = self.estimate_vsize(
                input_count=len(selected),
                outputs=outputs,
                include_change=True,
                change_address=change_address,
            )
            estimated_fee = vsize * fee_rate

            # Check if we have enough
            if total >= target_amount + estimated_fee:
                return selected, total, estimated_fee

        # Not enough funds
        total_available = sum(u.value for u in utxos)
        vsize = self.estimate_vsize(
            input_count=len(selected),
            outputs=outputs,
            include_change=True,
            change_address=change_address,
        )
        raise InsufficientFundsError(
            required=target_amount + vsize * fee_rate,
            available=total_available,
        )

    def _populate_psbt_input(
        self,
        inp: InputScope,
        utxo: "ElectrumUTXO",
        witness_script: script.Script,
        witness_script_hash: bytes,
    ) -> None:
        """Set witness_utxo, witness_script, and (for P2SH-P2WSH) redeem_script on a PSBT input."""
        if self.multisig_config.script_type == "p2sh-p2wsh":
            ripemd_input = sha256(self.multisig_config.redeem_script).digest()
            redeem_hash = hashlib_new("ripemd160", ripemd_input).digest()
            script_pubkey = script.Script(
                bytes([0xa9, 0x14]) + redeem_hash + bytes([0x87])
            )
            inp.redeem_script = script.Script(self.multisig_config.redeem_script)
        else:
            script_pubkey = script.Script(bytes([0x00, 0x20]) + witness_script_hash)

        inp.witness_utxo = TransactionOutput(
            value=utxo.value, script_pubkey=script_pubkey
        )
        inp.witness_script = witness_script

    def build(
        self,
        utxos: list[ElectrumUTXO],
        outputs: list[TxOutput],
        change_address: str,
        fee_rate: int = 10,
        raw_txs: dict[str, bytes] | None = None,
        use_all_inputs: bool = False,
        send_max: bool = False,
    ) -> PSBTInfo:
        """
        Build a PSBT for a multisig transaction.

        Args:
            utxos: Available UTXOs for the wallet.
            outputs: Destination outputs.
            change_address: Address to send change to.
            fee_rate: Fee rate in sat/vB.
            raw_txs: Mapping of txid -> raw transaction bytes (for non-segwit).
            use_all_inputs: When True, use ALL provided utxos instead of running
                coin selection. Set this when the caller already chose specific
                UTXOs (custom UTXO selection).

        Returns:
            PSBTInfo with the constructed PSBT.

        Raises:
            InsufficientFundsError: If not enough funds.
            PSBTError: If PSBT construction fails.
        """
        if not self.multisig_config:
            raise PSBTError("Multisig configuration required")

        if not outputs:
            raise PSBTError("At least one output required")

        if fee_rate <= 0:
            raise PSBTError(f"Fee rate must be positive, got {fee_rate}")

        # --- Send-Max mode: compute amount = total_input - fee, no change ---
        if send_max:
            return self._build_send_max(
                utxos=utxos,
                outputs=outputs,
                change_address=change_address,
                fee_rate=fee_rate,
                raw_txs=raw_txs,
            )

        # Calculate total output amount
        total_output = sum(o.amount for o in outputs)

        # Validate amounts
        for output in outputs:
            if output.amount < self.DUST_LIMIT:
                raise PSBTError(
                    f"Output amount {output.amount} is below dust limit {self.DUST_LIMIT}"
                )

        # Select UTXOs (or use all when caller already picked)
        if use_all_inputs:
            selected_utxos = list(utxos)
            total_input = sum(u.value for u in selected_utxos)
            vsize = self.estimate_vsize(
                input_count=len(selected_utxos),
                outputs=outputs,
                include_change=True,
                change_address=change_address,
            )
            estimated_fee = vsize * fee_rate
            if total_input < total_output + estimated_fee:
                raise InsufficientFundsError(
                    required=total_output + estimated_fee,
                    available=total_input,
                )
        else:
            selected_utxos, total_input, estimated_fee = self.select_utxos(
                utxos=utxos,
                target_amount=total_output,
                fee_rate=fee_rate,
                change_address=change_address,
                outputs=outputs,
            )

        # Capture selected UTXO details for callers (e.g. UTXO locking)
        selected_utxo_dicts = [
            {"txid": u.txid, "vout": u.vout, "value": u.value}
            for u in selected_utxos
        ]

        # Calculate change
        change_amount = total_input - total_output - estimated_fee

        # Skip change if below dust
        include_change = change_amount >= self.DUST_LIMIT

        if not include_change:
            # No change output — all excess sats become fee
            estimated_fee = total_input - total_output
            change_amount = 0

        # Build transaction
        # NOTE: embit Transaction.__init__ uses mutable default args (vin=[], vout=[]).
        # Always pass explicit empty lists to avoid shared-state bugs.
        tx = Transaction(version=2, vin=[], vout=[], locktime=0)

        # Add inputs
        for utxo in selected_utxos:
            tx_in = TransactionInput(
                # embit expects txid in big-endian (display format) and handles
                # the internal little-endian conversion during serialization
                txid=bytes.fromhex(utxo.txid),
                vout=utxo.vout,
                sequence=0xFFFFFFFE,  # Enable RBF
            )
            tx.vin.append(tx_in)

        # Add outputs
        for output in outputs:
            sc = script.address_to_scriptpubkey(output.address)
            tx_out = TransactionOutput(value=output.amount, script_pubkey=sc)
            tx.vout.append(tx_out)

        # Add change output
        if include_change:
            change_script = script.address_to_scriptpubkey(change_address)
            change_out = TransactionOutput(
                value=change_amount, script_pubkey=change_script
            )
            tx.vout.append(change_out)

        # Create PSBT
        psbt = PSBT(tx)

        # Add input information
        witness_script = script.Script(self.multisig_config.witness_script)
        witness_script_hash = sha256(self.multisig_config.witness_script).digest()

        for i, utxo in enumerate(selected_utxos):
            inp = psbt.inputs[i]

            # Set witness UTXO
            self._populate_psbt_input(
                inp, utxo, witness_script, witness_script_hash
            )

            # Add BIP32 derivation info for each key (required for Ledger multisig)
            if self.multisig_config.key_origins:
                for ko in self.multisig_config.key_origins:
                    pubkey_bytes = bytes.fromhex(ko.public_key)
                    fingerprint = bytes.fromhex(ko.master_fingerprint)
                    
                    # Parse derivation path "m/84'/0'/0'/0/0" -> list of ints
                    path_parts = ko.derivation_path.replace("m/", "").split("/")
                    derivation = []
                    for part in path_parts:
                        if part.endswith("'") or part.endswith("h"):
                            # Hardened: add 0x80000000
                            derivation.append(int(part[:-1]) | 0x80000000)
                        else:
                            derivation.append(int(part))
                    
                    # embit DerivationPath takes (fingerprint, derivation_list)
                    deriv_path = DerivationPath(fingerprint, derivation)
                    
                    # Add to bip32_derivations: pubkey -> DerivationPath
                    inp.bip32_derivations[ec.PublicKey.parse(pubkey_bytes)] = deriv_path

            # Add non-witness UTXO (full prev tx, stripped of witness data)
            if raw_txs and utxo.txid in raw_txs:
                inp.non_witness_utxo = _strip_witness(
                    Transaction.parse(raw_txs[utxo.txid])
                )

        # Serialize PSBT
        psbt_bytes = psbt.serialize()
        psbt_base64 = psbt.to_base64()

        # Calculate actual vsize
        actual_vsize = self.estimate_vsize(
            input_count=len(selected_utxos),
            outputs=outputs,
            include_change=include_change,
            change_address=change_address if include_change else None,
        )

        return PSBTInfo(
            psbt_base64=psbt_base64,
            psbt_hex=psbt_bytes.hex(),
            fee=estimated_fee,
            fee_rate=estimated_fee / actual_vsize if actual_vsize > 0 else fee_rate,
            input_count=len(selected_utxos),
            output_count=len(tx.vout),
            total_input=total_input,
            total_output=total_output + change_amount,
            change_amount=change_amount,
            estimated_vsize=actual_vsize,
            selected_utxos=selected_utxo_dicts,
        )

    def _build_send_max(
        self,
        utxos: list[ElectrumUTXO],
        outputs: list[TxOutput],
        change_address: str,
        fee_rate: int,
        raw_txs: dict[str, bytes] | None = None,
    ) -> PSBTInfo:
        """
        Build a send-max PSBT: spend all provided UTXOs with no change output.

        The send amount is computed as total_input - fee. The first output's
        amount is overwritten with this value.

        Raises:
            InsufficientFundsError: If total input cannot cover the fee.
            PSBTError: If resulting send amount is below dust limit.
        """
        if not self.multisig_config:
            raise PSBTError("Multisig configuration required")
        if not outputs:
            raise PSBTError("At least one output required")

        selected_utxos = list(utxos)
        total_input = sum(u.value for u in selected_utxos)

        if not selected_utxos:
            raise InsufficientFundsError(required=0, available=0)

        # Estimate vsize with NO change output
        vsize = self.estimate_vsize(
            input_count=len(selected_utxos),
            outputs=outputs,
            include_change=False,
        )
        estimated_fee = vsize * fee_rate

        send_amount = total_input - estimated_fee

        if send_amount < self.DUST_LIMIT:
            raise InsufficientFundsError(
                required=estimated_fee + self.DUST_LIMIT,
                available=total_input,
            )

        # Override the first output with the computed amount
        outputs = [TxOutput(address=outputs[0].address, amount=send_amount)]

        selected_utxo_dicts = [
            {"txid": u.txid, "vout": u.vout, "value": u.value}
            for u in selected_utxos
        ]

        # Build transaction (explicit empty lists — see build() for rationale)
        tx = Transaction(version=2, vin=[], vout=[], locktime=0)

        for utxo in selected_utxos:
            tx_in = TransactionInput(
                txid=bytes.fromhex(utxo.txid),
                vout=utxo.vout,
                sequence=0xFFFFFFFE,
            )
            tx.vin.append(tx_in)

        sc = script.address_to_scriptpubkey(outputs[0].address)
        tx.vout.append(TransactionOutput(value=send_amount, script_pubkey=sc))

        # Create PSBT
        psbt = PSBT(tx)

        # Add input information (same logic as build())
        witness_script = script.Script(self.multisig_config.witness_script)
        witness_script_hash = sha256(self.multisig_config.witness_script).digest()

        for i, utxo in enumerate(selected_utxos):
            inp = psbt.inputs[i]

            self._populate_psbt_input(
                inp, utxo, witness_script, witness_script_hash
            )

            if self.multisig_config.key_origins:
                for ko in self.multisig_config.key_origins:
                    pubkey_bytes = bytes.fromhex(ko.public_key)
                    fingerprint = bytes.fromhex(ko.master_fingerprint)
                    path_parts = ko.derivation_path.replace("m/", "").split("/")
                    derivation = []
                    for part in path_parts:
                        if part.endswith("'") or part.endswith("h"):
                            derivation.append(int(part[:-1]) | 0x80000000)
                        else:
                            derivation.append(int(part))
                    deriv_path = DerivationPath(fingerprint, derivation)
                    inp.bip32_derivations[ec.PublicKey.parse(pubkey_bytes)] = deriv_path

            if raw_txs and utxo.txid in raw_txs:
                inp.non_witness_utxo = _strip_witness(
                    Transaction.parse(raw_txs[utxo.txid])
                )

        # Serialize
        psbt_bytes = psbt.serialize()
        psbt_base64 = psbt.to_base64()

        return PSBTInfo(
            psbt_base64=psbt_base64,
            psbt_hex=psbt_bytes.hex(),
            fee=estimated_fee,
            fee_rate=estimated_fee / vsize if vsize > 0 else fee_rate,
            input_count=len(selected_utxos),
            output_count=1,
            total_input=total_input,
            total_output=send_amount,
            change_amount=0,
            estimated_vsize=vsize,
            selected_utxos=selected_utxo_dicts,
        )

    @staticmethod
    def parse(psbt_data: str | bytes) -> PSBT:
        """
        Parse a PSBT from base64 or hex.

        Args:
            psbt_data: PSBT in base64 or hex format.

        Returns:
            Parsed PSBT object.
        """
        if isinstance(psbt_data, str):
            # Try base64 first
            try:
                return PSBT.from_base64(psbt_data)
            except Exception:
                # Try hex
                return PSBT.parse(bytes.fromhex(psbt_data))
        return PSBT.parse(psbt_data)

    @staticmethod
    def combine(psbts: Sequence[PSBT | str]) -> PSBT:
        """
        Combine multiple PSBTs (e.g., after collecting signatures).

        Args:
            psbts: List of PSBTs to combine.

        Returns:
            Combined PSBT with all signatures.
        """
        parsed = []
        for p in psbts:
            if isinstance(p, str):
                parsed.append(PSBTBuilder.parse(p))
            else:
                parsed.append(p)

        if not parsed:
            raise PSBTError("No PSBTs to combine")

        result = parsed[0]
        for other in parsed[1:]:
            result = result.update(other)

        return result

    @staticmethod
    def finalize(psbt: PSBT | str) -> tuple[bytes, str]:
        """
        Finalize a PSBT and extract the signed transaction.

        For P2WSH multisig, this builds the witness stack:
        - Empty element (for OP_CHECKMULTISIG bug)
        - Signatures in order matching pubkeys in witness_script
        - Witness script

        Args:
            psbt: Fully signed PSBT.

        Returns:
            Tuple of (raw_tx_bytes, txid).

        Raises:
            PSBTError: If PSBT cannot be finalized.
        """
        if isinstance(psbt, str):
            psbt = PSBTBuilder.parse(psbt)

        from embit.script import Witness
        from embit.transaction import Transaction, TransactionInput

        # Build new vin list with witnesses
        new_vin = []

        try:
            for i, inp in enumerate(psbt.inputs):
                if not inp.witness_script:
                    raise PSBTError(f"Input {i} missing witness_script")

                # Get partial signatures
                if not inp.partial_sigs:
                    raise PSBTError(f"Input {i} has no signatures")

                # Parse witness script to get pubkey order and threshold
                ws = inp.witness_script.data
                if not ws:
                    raise PSBTError(f"Input {i} missing witness_script")

                try:
                    threshold, pubkey_hexes = parse_witness_script(ws)
                except ValueError as e:
                    raise PSBTError(f"Input {i} invalid witness_script: {e}") from e

                pubkeys_in_script = [bytes.fromhex(pk) for pk in pubkey_hexes]

                # Build witness: empty + signatures in script order + witness_script
                witness_items = [b""]  # Empty for CHECKMULTISIG bug

                added = 0
                for pk in pubkeys_in_script:
                    # Match with PublicKey objects in partial_sigs
                    for pk_obj, sig in inp.partial_sigs.items():
                        if pk_obj.sec() == pk:
                            witness_items.append(sig)
                            added += 1
                            break

                    if added >= threshold:
                        break

                if added < threshold:
                    raise PSBTError(
                        f"Input {i} has insufficient signatures ({added}/{threshold})"
                    )

                witness_items.append(ws)

                # Create new TransactionInput with witness
                # P2SH-P2WSH: scriptSig = push(redeem_script)
                old_vin = psbt.tx.vin[i]
                if inp.redeem_script:
                    rs_data = inp.redeem_script.data
                    # Script push: length_byte + data (for scripts <=75 bytes)
                    if len(rs_data) <= 75:
                        script_sig = script.Script(bytes([len(rs_data)]) + rs_data)
                    else:
                        # OP_PUSHDATA1 for 76-255 bytes
                        script_sig = script.Script(bytes([0x4c, len(rs_data)]) + rs_data)
                else:
                    script_sig = old_vin.script_sig

                new_input = TransactionInput(
                    txid=old_vin.txid,
                    vout=old_vin.vout,
                    sequence=old_vin.sequence,
                    script_sig=script_sig,
                    witness=Witness(witness_items)
                )
                new_vin.append(new_input)

        except PSBTError:
            raise
        except Exception as e:
            raise PSBTError(f"Failed to finalize PSBT: {e}") from e

        # Create new transaction with witnesses
        tx = Transaction(
            version=psbt.tx.version,
            locktime=psbt.tx.locktime,
            vin=new_vin,
            vout=list(psbt.tx.vout)
        )

        raw_tx = tx.serialize()
        txid = tx.txid().hex()

        return raw_tx, txid
