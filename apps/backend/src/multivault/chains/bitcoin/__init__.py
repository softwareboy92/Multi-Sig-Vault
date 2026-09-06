"""
Bitcoin chain adapter module.

Provides Bitcoin-specific implementation including:
- Electrum client for blockchain queries
- P2WSH address derivation for multisig
- PSBT construction and signing
"""

from multivault.chains.bitcoin.adapter import BitcoinAdapter, BitcoinAdapterError
from multivault.chains.bitcoin.address import derive_p2wsh_address, build_multisig_script
from multivault.chains.bitcoin.electrum import ElectrumClient
from multivault.chains.bitcoin.path import ensure_address_level_path, validate_bip48_p2wsh_path
from multivault.chains.bitcoin.psbt import PSBTBuilder

__all__ = [
    "BitcoinAdapter",
    "BitcoinAdapterError",
    "ElectrumClient",
    "PSBTBuilder",
    "derive_p2wsh_address",
    "build_multisig_script",
    "ensure_address_level_path",
    "validate_bip48_p2wsh_path",
]
