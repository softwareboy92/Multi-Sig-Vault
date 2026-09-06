"""Base worker class for background tasks."""

import asyncio
import logging
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Callable

logger = logging.getLogger(__name__)


class WorkerState(str, Enum):
    """Worker lifecycle states."""

    IDLE = "IDLE"
    RUNNING = "RUNNING"
    STOPPING = "STOPPING"
    STOPPED = "STOPPED"
    ERROR = "ERROR"


class BaseWorker(ABC):
    """Abstract base class for background workers.

    Workers run periodic tasks at specified intervals. They are designed
    to be started during application startup and gracefully stopped during
    shutdown.

    Example:
        class MyWorker(BaseWorker):
            async def execute(self) -> None:
                # Do something periodically
                pass

        worker = MyWorker(interval_seconds=60)
        task = asyncio.create_task(worker.run())

        # Later, during shutdown:
        await worker.stop()
    """

    def __init__(
        self,
        interval_seconds: float = 60.0,
        name: str | None = None,
        max_consecutive_errors: int = 5,
    ):
        """Initialize the worker.

        Args:
            interval_seconds: Time between executions in seconds
            name: Worker name for logging (defaults to class name)
            max_consecutive_errors: Max errors before entering ERROR state
        """
        self.interval = interval_seconds
        self.name = name or self.__class__.__name__
        self.max_consecutive_errors = max_consecutive_errors

        self._state = WorkerState.IDLE
        self._running = False
        self._task: asyncio.Task | None = None
        self._consecutive_errors = 0
        self._last_run: datetime | None = None
        self._last_success: datetime | None = None
        self._last_error: str | None = None
        self._total_runs = 0
        self._total_errors = 0

    @property
    def state(self) -> WorkerState:
        """Get current worker state."""
        return self._state

    @property
    def is_running(self) -> bool:
        """Check if worker is currently running."""
        return self._running

    @property
    def stats(self) -> dict[str, Any]:
        """Get worker statistics."""
        return {
            "name": self.name,
            "state": self._state.value,
            "interval_seconds": self.interval,
            "last_run": self._last_run.isoformat() if self._last_run else None,
            "last_success": self._last_success.isoformat() if self._last_success else None,
            "last_error": self._last_error,
            "total_runs": self._total_runs,
            "total_errors": self._total_errors,
            "consecutive_errors": self._consecutive_errors,
        }

    @abstractmethod
    async def execute(self) -> None:
        """Execute one iteration of the worker.

        Subclasses must implement this method with the actual work logic.
        This method should be idempotent and handle its own error logging.
        """
        pass

    async def on_start(self) -> None:
        """Called once when worker starts.

        Override to perform initialization tasks.
        """
        pass

    async def on_stop(self) -> None:
        """Called once when worker stops.

        Override to perform cleanup tasks.
        """
        pass

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs during execution.

        Override to perform custom error handling.

        Args:
            error: The exception that occurred
        """
        pass

    async def run(self) -> None:
        """Start the worker loop.

        This method runs until stop() is called. It executes the work
        at the specified interval and handles errors gracefully.
        """
        if self._running:
            logger.warning(f"Worker {self.name} is already running")
            return

        self._running = True
        self._state = WorkerState.RUNNING
        logger.info(f"Worker {self.name} starting (interval: {self.interval}s)")

        try:
            await self.on_start()
        except Exception as e:
            logger.exception(f"Worker {self.name} failed to start: {e}")
            self._state = WorkerState.ERROR
            self._running = False
            return

        while self._running:
            self._last_run = datetime.now(UTC)
            self._total_runs += 1

            try:
                await self.execute()
                self._last_success = datetime.now(UTC)
                self._consecutive_errors = 0
            except asyncio.CancelledError:
                logger.info(f"Worker {self.name} cancelled")
                break
            except Exception as e:
                self._total_errors += 1
                self._consecutive_errors += 1
                self._last_error = str(e)

                logger.exception(f"Worker {self.name} error: {e}")
                await self.on_error(e)

                # Check if we've exceeded max consecutive errors
                if self._consecutive_errors >= self.max_consecutive_errors:
                    logger.error(
                        f"Worker {self.name} entering ERROR state after "
                        f"{self._consecutive_errors} consecutive errors"
                    )
                    self._state = WorkerState.ERROR
                    break

            # Wait for next interval, but check for stop signal
            if self._running:
                try:
                    await asyncio.sleep(self.interval)
                except asyncio.CancelledError:
                    break

        self._running = False
        # Only set STOPPED if not in ERROR state
        if self._state != WorkerState.ERROR:
            self._state = WorkerState.STOPPED
        logger.info(f"Worker {self.name} stopped (state: {self._state.value})")

        try:
            await self.on_stop()
        except Exception as e:
            logger.exception(f"Worker {self.name} cleanup error: {e}")

    async def stop(self, timeout: float = 5.0) -> None:
        """Stop the worker gracefully.

        Args:
            timeout: Maximum time to wait for worker to stop
        """
        if not self._running:
            return

        logger.info(f"Worker {self.name} stopping...")
        self._state = WorkerState.STOPPING
        self._running = False

        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning(f"Worker {self.name} stop timed out, cancelling")
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass

    def start_task(self) -> asyncio.Task:
        """Start worker as an asyncio task.

        Returns:
            The created task
        """
        self._task = asyncio.create_task(self.run())
        return self._task


class WorkerManager:
    """Manages multiple workers as a group.

    Example:
        manager = WorkerManager()
        manager.add(BalanceSyncWorker(interval_seconds=60))
        manager.add(SyncWorker(interval_seconds=30))

        await manager.start_all()
        # ...
        await manager.stop_all()
    """

    def __init__(self):
        self._workers: list[BaseWorker] = []
        self._tasks: list[asyncio.Task] = []

    def add(self, worker: BaseWorker) -> None:
        """Add a worker to the manager.

        Args:
            worker: Worker instance to add
        """
        self._workers.append(worker)

    def remove(self, worker: BaseWorker) -> None:
        """Remove a worker from the manager.

        Args:
            worker: Worker instance to remove
        """
        if worker in self._workers:
            self._workers.remove(worker)

    @property
    def workers(self) -> list[BaseWorker]:
        """Get list of managed workers."""
        return self._workers.copy()

    async def start_all(self) -> None:
        """Start all workers."""
        logger.info(f"Starting {len(self._workers)} workers")
        for worker in self._workers:
            task = worker.start_task()
            self._tasks.append(task)

    async def stop_all(self, timeout: float = 10.0) -> None:
        """Stop all workers.

        Args:
            timeout: Maximum time to wait for all workers to stop
        """
        logger.info(f"Stopping {len(self._workers)} workers")

        # Signal all workers to stop
        for worker in self._workers:
            worker._running = False
            worker._state = WorkerState.STOPPING

        # Wait for all tasks to complete
        if self._tasks:
            done, pending = await asyncio.wait(
                self._tasks,
                timeout=timeout,
                return_when=asyncio.ALL_COMPLETED,
            )

            # Cancel any tasks that didn't stop in time
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        self._tasks.clear()

    def get_stats(self) -> list[dict[str, Any]]:
        """Get statistics for all workers."""
        return [worker.stats for worker in self._workers]
