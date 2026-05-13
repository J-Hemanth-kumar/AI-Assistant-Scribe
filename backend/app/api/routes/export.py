import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.db.models import DocumentVersion, ExportJob
from app.schemas.export import ExportRequest, ExportResponse
from app.services.document_service import DocumentService
from app.services.export_service import ExportService
from app.services.minio_service import MinioService

router = APIRouter(prefix="/export", tags=["export"])
logger = logging.getLogger(__name__)


@router.post("/", response_model=ExportResponse)
@router.post("", response_model=ExportResponse, include_in_schema=False)
def start_export(request: ExportRequest, db: Session = Depends(get_db)):
    doc_uuid = uuid.UUID(request.doc_id)
    export_format = request.export_format or "pdf"

    try:
        # 1. Resolve Version ID and Edits FIRST
        edits = None
        if request.edits:
            edits = [e.model_dump() for e in request.edits]
        else:
            # If no version_id provided, find the latest version for this doc
            query = db.query(DocumentVersion).filter(DocumentVersion.doc_id == doc_uuid)
            if request.version_id is not None:
                query = query.filter(DocumentVersion.id == request.version_id)
            
            doc_version = query.order_by(DocumentVersion.id.desc()).first()
            
            if doc_version:
                edits = doc_version.edit_diff_json.get("edits", [])
                request.version_id = doc_version.id  # Update for the export service call
            else:
                edits = []
                if request.version_id is None:
                    request.version_id = 0

        # Now that we have a version_id (either from request, DB, or default 0), create the job
        job = ExportJob(
            doc_id=doc_uuid,
            version_id=request.version_id,
            status="processing",
            export_format=export_format,
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        # 3. Perform the actual export
        doc_meta = DocumentService().get_document(doc_uuid)
        service = ExportService()
        download_url = service.export_with_edits(
            doc_id=request.doc_id,
            version_id=request.version_id,
            original_key=doc_meta.s3_key,
            edits=edits or [],
            export_format=export_format,
        )

        job.status = "completed"
        job.download_url = download_url
        job.updated_at = datetime.now(timezone.utc)
        db.commit()

        return ExportResponse(
            job_id=job.id,
            status="completed",
            format=export_format,
            download_url=download_url,
            edits_applied=len(edits) if edits else 0,
            message=f"Exported as {export_format}.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Export failed for doc_id=%s", request.doc_id)
        job.status = "failed"
        job.error_message = str(exc)
        db.commit()
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/status/{job_id}")
def get_export_status(job_id: int, db: Session = Depends(get_db)):
    job = db.query(ExportJob).filter(ExportJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found.")
    return {"job_id": job.id, "status": job.status, "download_url": job.download_url, "error": job.error_message}


@router.get("/hello")
def hello_export():
    return {"message": "hello from export router"}


@router.get("/download/{file_path:path}")
def download_file(file_path: str):
    """
    Download a file from storage. 
    Path should be the key (e.g., exports/doc_id/file.pdf)
    """
    minio = MinioService()
    try:
        obj = minio._client.get_object(Bucket=settings.minio_bucket, Key=file_path)
        filename = file_path.split("/")[-1]
        return StreamingResponse(
            obj["Body"],
            media_type=obj.get("ContentType", "application/octet-stream"),
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        logger.error(f"Download failed for {file_path}: {str(e)}")
        raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")
