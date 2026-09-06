"""Background workers for cleaning up stale challenges and audit logs."""

import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from multivault.workers.base import BaseWorker

logger = logging.getLogger(__name__)


class ChallengeCleanupWorker(BaseWorker):
    """Worker that cleans up expired signer challenges.

    Periodically deletes challenges that have expired and were never used.

    Configuration:
        - interval_seconds: How often to clean up (default: 300 = 5 min)
        - max_age_seconds: Maximum age of challenges to keep (default: 3600 = 1 hour)
    """

    def __init__(
        self,
        session_factory,
        interval_seconds: float = 300.0,
        max_age_seconds: float = 3600.0,
    ):
        """Initialize the cleanup worker.

        Args:
            session_factory: Async session factory for database access
            interval_seconds: Cleanup interval in seconds
            max_age_seconds: Maximum age of challenges to keep
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="ChallengeCleanupWorker",
        )
        self._session_factory = session_factory
        self._max_age = max_age_seconds

    async def execute(self) -> None:
        """Clean up expired challenges."""
        from datetime import timedelta

        from sqlalchemy import delete, and_

        from multivault.models.signer import Challenge

        async with self._session_factory() as session:
            cutoff = datetime.now(UTC) - timedelta(seconds=self._max_age)

            # Delete expired and unused challenges
            stmt = delete(Challenge).where(
                and_(
                    Challenge.expires_at < cutoff,
                    Challenge.used_at.is_(None),
                )
            )

            result = await session.execute(stmt)
            await session.commit()

            if result.rowcount > 0:
                logger.info(f"Cleaned up {result.rowcount} expired challenge(s)")


class AuditLogPruneWorker(BaseWorker):
    """Worker that prunes old audit log entries.

    Periodically archives and deletes audit log entries older than
    the configured retention period.

    Configuration:
        - interval_seconds: How often to prune (default: 86400 = 1 day)
        - retention_days: Days to retain logs (default: 90)
    """

    def __init__(
        self,
        session_factory,
        interval_seconds: float = 86400.0,
        retention_days: int = 90,
    ):
        """Initialize the prune worker.

        Args:
            session_factory: Async session factory for database access
            interval_seconds: Prune interval in seconds
            retention_days: Number of days to retain audit logs
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="AuditLogPruneWorker",
        )
        self._session_factory = session_factory
        self._retention_days = retention_days

    async def execute(self) -> None:
        """Prune old audit log entries."""
        from datetime import timedelta

        # Note: AuditLog model would need to be created for this to work
        # This is a placeholder implementation
        cutoff = datetime.now(UTC) - timedelta(days=self._retention_days)
        logger.debug(f"Would prune audit logs older than {cutoff}")
        # Implementation would delete or archive old entries
