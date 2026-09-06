"""Pytest configuration and fixtures."""

from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from multivault.config import Settings
from multivault.deps import get_db
from multivault.main import app
from multivault.models.base import Base


@pytest.fixture
def test_settings() -> Settings:
    """Provide test settings."""
    return Settings(
        environment="development",
        debug=True,
        database_url="sqlite+aiosqlite:///:memory:",
        database_echo=False,
    )


@pytest_asyncio.fixture
async def async_engine(test_settings: Settings):
    """Create async engine for testing."""
    engine = create_async_engine(
        test_settings.database_url,
        echo=test_settings.database_echo,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def async_session(async_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide async database session for tests."""
    session_maker = async_sessionmaker(
        async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def client(async_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Provide async HTTP client with database override."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield async_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
