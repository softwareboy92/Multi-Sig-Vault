"""BIP 48 derivation path utilities for BTC multisig."""

import re

# BIP 48: m/48'/coinType'/account'/scriptType'
# coinType: 0' (mainnet) or 1' (testnet)
# account: any non-negative integer, hardened
# scriptType: 1' (P2SH-P2WSH) or 2' (P2WSH)
_BIP48_RE = re.compile(r"^m/48'/[01]'/\d+'/[12]'$")


def validate_bip48_path(path: str | None) -> bool:
    """Check if a derivation path matches BIP 48 P2WSH or P2SH-P2WSH format."""
    if not path:
        return False
    return _BIP48_RE.match(path) is not None


# Backward-compatible alias
validate_bip48_p2wsh_path = validate_bip48_path


def script_type_from_path(path: str) -> str:
    """Extract the script type from a BIP 48 derivation path.

    Returns "p2wsh" for /2' or "p2sh-p2wsh" for /1'.
    Raises ValueError for unrecognised or non-BIP 48 paths.
    """
    if not path or not _BIP48_RE.match(path):
        raise ValueError(f"Not a valid BIP 48 path: {path!r}")
    suffix = path.rstrip("/").rsplit("/", 1)[-1]
    if suffix == "2'":
        return "p2wsh"
    elif suffix == "1'":
        return "p2sh-p2wsh"
    else:
        raise ValueError(f"Unknown BIP 48 script type suffix: {suffix!r}")


def ensure_address_level_path(path: str) -> str:
    """Append /0/0 to account-level paths (ending with hardened marker).

    Account-level:  m/48'/0'/0'/2'   → m/48'/0'/0'/2'/0/0
    Address-level:  m/48'/0'/0'/2'/0/0 → unchanged
    """
    normalized = path.rstrip("/")
    if normalized.endswith("'"):
        return f"{normalized}/0/0"
    return normalized
