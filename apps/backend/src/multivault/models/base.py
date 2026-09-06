"""SQLAlchemy base model and mixins."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, event, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from multivault.config import get_settings


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""

    pass


class TimestampMixin:
    """Mixin for created_at and updated_at timestamps."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    """Mixin for soft delete support."""

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid4())


def create_engine_and_session() -> tuple:
    """Create async engine and session maker."""
    settings = get_settings()

    engine = create_async_engine(
        settings.database_url,
        echo=settings.database_echo,
        connect_args={
            "check_same_thread": False,
            "timeout": 30,
        },
        pool_pre_ping=True,
    )

    # Enable WAL mode and foreign keys for SQLite
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    return engine, session_maker


# Global instances (lazy initialization)
_engine = None
_session_maker = None


def get_engine():
    """Get or create the async engine."""
    global _engine, _session_maker
    if _engine is None:
        _engine, _session_maker = create_engine_and_session()
    return _engine


def get_session_maker():
    """Get or create the async session maker."""
    global _engine, _session_maker
    if _session_maker is None:
        _engine, _session_maker = create_engine_and_session()
    return _session_maker
