"""Unit tests for base worker classes."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from multivault.workers.base import BaseWorker, WorkerManager, WorkerState


class SimpleWorker(BaseWorker):
    """Simple worker for testing."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.execute_count = 0
        self.should_raise = False
        self.on_start_called = False
        self.on_stop_called = False
        self.on_error_called = False

    async def execute(self) -> None:
        self.execute_count += 1
        if self.should_raise:
            raise ValueError("Test error")

    async def on_start(self) -> None:
        self.on_start_called = True

    async def on_stop(self) -> None:
        self.on_stop_called = True

    async def on_error(self, error: Exception) -> None:
        self.on_error_called = True


class TestBaseWorker:
    """Tests for BaseWorker."""

    def test_init_defaults(self):
        """Test worker initialization with defaults."""
        worker = SimpleWorker()

        assert worker.interval == 60.0
        assert worker.name == "SimpleWorker"
        assert worker.max_consecutive_errors == 5
        assert worker.state == WorkerState.IDLE
        assert worker.is_running is False

    def test_init_custom_params(self):
        """Test worker initialization with custom parameters."""
        worker = SimpleWorker(
            interval_seconds=30.0,
            name="MyWorker",
            max_consecutive_errors=3,
        )

        assert worker.interval == 30.0
        assert worker.name == "MyWorker"
        assert worker.max_consecutive_errors == 3

    def test_stats_property(self):
        """Test worker stats reporting."""
        worker = SimpleWorker(interval_seconds=10.0)
        stats = worker.stats

        assert stats["name"] == "SimpleWorker"
        assert stats["state"] == WorkerState.IDLE.value
        assert stats["interval_seconds"] == 10.0
        assert stats["total_runs"] == 0
        assert stats["total_errors"] == 0
        assert stats["consecutive_errors"] == 0

    @pytest.mark.asyncio
    async def test_run_executes_work(self):
        """Test worker executes work on run."""
        worker = SimpleWorker(interval_seconds=0.01)

        # Run worker briefly
        task = asyncio.create_task(worker.run())
        await asyncio.sleep(0.05)
        await worker.stop()
        # Wait for task to complete
        await asyncio.sleep(0.02)

        assert worker.execute_count >= 1
        assert worker.on_start_called
        assert worker.state == WorkerState.STOPPED

    @pytest.mark.asyncio
    async def test_run_calls_hooks(self):
        """Test worker calls lifecycle hooks."""
        worker = SimpleWorker(interval_seconds=0.01)

        task = asyncio.create_task(worker.run())
        await asyncio.sleep(0.02)
        await worker.stop()
        # Wait for task to complete and hooks to run
        await asyncio.sleep(0.02)

        assert worker.on_start_called
        assert worker.on_stop_called

    @pytest.mark.asyncio
    async def test_run_handles_errors(self):
        """Test worker handles execution errors."""
        worker = SimpleWorker(interval_seconds=0.01)
        worker.should_raise = True

        task = asyncio.create_task(worker.run())
        await asyncio.sleep(0.05)
        await worker.stop()

        assert worker.execute_count >= 1
        assert worker.on_error_called
        assert worker.stats["total_errors"] >= 1

    @pytest.mark.asyncio
    async def test_run_enters_error_state_on_max_errors(self):
        """Test worker enters ERROR state after max consecutive errors."""
        worker = SimpleWorker(
            interval_seconds=0.01,
            max_consecutive_errors=3,
        )
        worker.should_raise = True

        task = asyncio.create_task(worker.run())
        await asyncio.sleep(0.15)  # Wait long enough for 3+ cycles

        # Worker should have stopped due to max errors
        assert worker.state == WorkerState.ERROR
        assert worker.stats["consecutive_errors"] >= 3
        
        # Clean up the task
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_stop_graceful(self):
        """Test graceful worker stop."""
        worker = SimpleWorker(interval_seconds=0.01)

        task = asyncio.create_task(worker.run())
        await asyncio.sleep(0.02)

        assert worker.is_running

        await worker.stop()
        # Wait for task to complete
        await asyncio.sleep(0.02)

        assert not worker.is_running
        assert worker.state == WorkerState.STOPPED

    @pytest.mark.asyncio
    async def test_stop_timeout(self):
        """Test worker stop with timeout."""
        class SlowWorker(BaseWorker):
            async def execute(self) -> None:
                await asyncio.sleep(10)  # Very slow

        worker = SlowWorker(interval_seconds=0.01)

        task = worker.start_task()
        await asyncio.sleep(0.02)

        # Stop with short timeout
        await worker.stop(timeout=0.1)

        assert worker.state == WorkerState.STOPPED

    @pytest.mark.asyncio
    async def test_start_task(self):
        """Test starting worker as task."""
        worker = SimpleWorker(interval_seconds=0.01)

        task = worker.start_task()

        assert task is not None
        assert asyncio.isfuture(task)

        await asyncio.sleep(0.02)
        await worker.stop()

    @pytest.mark.asyncio
    async def test_error_resets_on_success(self):
        """Test consecutive error count resets on success."""
        worker = SimpleWorker(interval_seconds=0.01)
        worker.should_raise = True

        task = asyncio.create_task(worker.run())
        await asyncio.sleep(0.03)

        # Should have accumulated some errors
        assert worker.stats["consecutive_errors"] > 0

        # Fix the worker
        worker.should_raise = False
        await asyncio.sleep(0.02)

        # Consecutive errors should reset
        assert worker.stats["consecutive_errors"] == 0

        await worker.stop()


class TestWorkerManager:
    """Tests for WorkerManager."""

    def test_add_worker(self):
        """Test adding workers to manager."""
        manager = WorkerManager()
        worker1 = SimpleWorker(name="Worker1")
        worker2 = SimpleWorker(name="Worker2")

        manager.add(worker1)
        manager.add(worker2)

        assert len(manager.workers) == 2
        assert worker1 in manager.workers
        assert worker2 in manager.workers

    def test_remove_worker(self):
        """Test removing workers from manager."""
        manager = WorkerManager()
        worker = SimpleWorker()

        manager.add(worker)
        manager.remove(worker)

        assert len(manager.workers) == 0

    @pytest.mark.asyncio
    async def test_start_all(self):
        """Test starting all workers."""
        manager = WorkerManager()
        worker1 = SimpleWorker(name="Worker1", interval_seconds=0.01)
        worker2 = SimpleWorker(name="Worker2", interval_seconds=0.01)

        manager.add(worker1)
        manager.add(worker2)

        await manager.start_all()
        await asyncio.sleep(0.03)

        assert worker1.is_running
        assert worker2.is_running

        await manager.stop_all()

    @pytest.mark.asyncio
    async def test_stop_all(self):
        """Test stopping all workers."""
        manager = WorkerManager()
        worker1 = SimpleWorker(name="Worker1", interval_seconds=0.01)
        worker2 = SimpleWorker(name="Worker2", interval_seconds=0.01)

        manager.add(worker1)
        manager.add(worker2)

        await manager.start_all()
        await asyncio.sleep(0.02)
        await manager.stop_all()

        assert not worker1.is_running
        assert not worker2.is_running
        assert worker1.state == WorkerState.STOPPED
        assert worker2.state == WorkerState.STOPPED

    def test_get_stats(self):
        """Test getting stats for all workers."""
        manager = WorkerManager()
        worker1 = SimpleWorker(name="Worker1", interval_seconds=10)
        worker2 = SimpleWorker(name="Worker2", interval_seconds=20)

        manager.add(worker1)
        manager.add(worker2)

        stats = manager.get_stats()

        assert len(stats) == 2
        assert stats[0]["name"] == "Worker1"
        assert stats[1]["name"] == "Worker2"
