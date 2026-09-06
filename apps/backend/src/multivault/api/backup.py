"""Backup and restore API endpoints."""

import json
import structlog
from datetime import datetime

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.deps import get_db
from multivault.errors.exceptions import ValidationError
from multivault.schemas.backup import (
    BackupFile,
    ExportRequest,
    ImportRequest,
    ImportResult,
    ValidationResult,
)
from multivault.services.backup_service import BackupService

logger = structlog.get_logger()

router = APIRouter(prefix="/backup", tags=["backup"])


def _parse_backup_file(content: bytes) -> BackupFile:
    """Parse raw bytes into a validated BackupFile.

    Raises ``ValidationError`` with user-friendly messages for JSON parse
    errors and Pydantic schema mismatches.
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValidationError(
            message="Invalid JSON file",
            details={"error": str(e)},
        )

    try:
        return BackupFile.model_validate(data)
    except PydanticValidationError as e:
        # Surface Pydantic field-level errors so the user knows what's wrong.
        errors = [
            {"loc": ".".join(str(p) for p in err["loc"]), "msg": err["msg"]}
            for err in e.errors()
        ]
        raise ValidationError(
            message="Backup file schema validation failed",
            details={"errors": errors},
        )


@router.post("/export")
async def export_data(
    request: ExportRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Export data to JSON backup file."""
    try:
        service = BackupService(db)
        backup = await service.export_data(request)

        def datetime_serializer(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Type {type(obj)} not serializable")

        json_data = json.dumps(
            backup.model_dump(),
            indent=2,
            default=datetime_serializer,
        )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"multivault_backup_{timestamp}.json"

        return StreamingResponse(
            iter([json_data]),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    except Exception as e:
        logger.error("export_failed", error=str(e))
        raise


@router.post("/validate", response_model=ValidationResult)
async def validate_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> ValidationResult:
    """Validate backup file without importing."""
    content = await file.read()
    backup = _parse_backup_file(content)

    service = BackupService(db)
    return await service.validate_backup(backup)


@router.post("/import", response_model=ImportResult)
async def import_data(
    file: UploadFile = File(...),
    conflict_strategy: str = "skip",
    validate_only: bool = False,
    db: AsyncSession = Depends(get_db),
) -> ImportResult:
    """Import data from backup file."""
    content = await file.read()
    backup = _parse_backup_file(content)

    request = ImportRequest(
        conflict_strategy=conflict_strategy,
        validate_only=validate_only,
    )
    service = BackupService(db)
    result = await service.import_data(backup, request)

    logger.info(
        "backup_imported",
        imported=result.imported,
        skipped_count=len(result.skipped),
        errors_count=len(result.errors),
    )

    return result
