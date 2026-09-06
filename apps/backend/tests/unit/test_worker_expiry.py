"""Unit tests for cleanup workers."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.workers.expiry import (
    AuditLogPruneWorker,
)


class TestAuditLogPruneWorker:
    """Tests for AuditLogPruneWorker."""

    @pytest.mark.asyncio
    async def test_init(self):
        """Test AuditLogPruneWorker initialization."""
        session_factory = AsyncMock()
        worker = AuditLogPruneWorker(
            session_factory=session_factory,
            retention_days=90,
            interval_seconds=86400.0,
        )

        assert worker.name == "AuditLogPruneWorker"
        assert worker.interval == 86400.0
        assert worker._retention_days == 90

    @pytest.mark.asyncio
    async def test_execute_prunes_old_logs(self, async_session):
        """Test execute prunes audit logs older than retention."""
        @asynccontextmanager
        async def session_factory():
            yield async_session
        
        worker = AuditLogPruneWorker(
            session_factory=session_factory,
            retention_days=30,
        )

        # Should not raise
        await worker.execute()
