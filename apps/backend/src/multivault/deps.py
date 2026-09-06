"""FastAPI dependency injection definitions."""

from typing import Annotated, AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.base import get_session_maker


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Provide a database session for each request.

    Yields a session that is automatically closed after the request.
    """
    session_maker = get_session_maker()
    async with session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]
