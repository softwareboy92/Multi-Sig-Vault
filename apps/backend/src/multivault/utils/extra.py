"""Helpers for reading / writing the JSON `extra` column on models.

Used by Wallet, Signer, and WalletSigner to store chain-specific metadata
in a single Text column, following the same pattern as NetworkConfig.extra.
"""

from __future__ import annotations

import json
from typing import Any


def get_extra(model: Any) -> dict[str, Any]:
    """Parse the ``extra`` JSON column, returning an empty dict when absent."""
    raw = getattr(model, "extra", None)
    if raw is None:
        return {}
    return json.loads(raw) if isinstance(raw, str) else raw


def set_extra(model: Any, **kwargs: Any) -> None:
    """Merge *kwargs* into the model's ``extra`` JSON column.

    Keys whose value is ``None`` are **excluded** to keep the payload compact.
    ``bytes`` values are automatically hex-encoded.
    If the resulting dict is empty the column is set to ``None``.
    """
    current = get_extra(model)
    for k, v in kwargs.items():
        if v is None:
            continue
        # Auto-convert bytes to hex string for JSON serialisability
        if isinstance(v, (bytes, bytearray)):
            v = v.hex()
        current[k] = v
    model.extra = json.dumps(current) if current else None


def get_extra_field(model: Any, key: str, default: Any = None) -> Any:
    """Read a single field from the model's ``extra`` JSON."""
    return get_extra(model).get(key, default)
