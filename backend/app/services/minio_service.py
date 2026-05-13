import logging
from io import BytesIO

import boto3
from botocore.client import Config

from app.core.config import settings

logger = logging.getLogger(__name__)


class MinioService:
    def __init__(self) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            region_name=settings.minio_region,
            config=Config(signature_version="s3v4"),
        )

    def ensure_bucket(self) -> None:
        existing = {b["Name"] for b in self._client.list_buckets().get("Buckets", [])}
        if settings.minio_bucket not in existing:
            self._client.create_bucket(Bucket=settings.minio_bucket)
            logger.info("Created bucket '%s'.", settings.minio_bucket)

    def upload_fileobj(self, fileobj, key: str, content_type: str) -> None:
        self._client.upload_fileobj(
            Fileobj=fileobj,
            Bucket=settings.minio_bucket,
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )

    def get_object_bytes(self, key: str) -> bytes:
        obj = self._client.get_object(Bucket=settings.minio_bucket, Key=key)
        return bytes(obj["Body"].read())

    def delete_file(self, key: str) -> None:
        self._client.delete_object(Bucket=settings.minio_bucket, Key=key)
        logger.info("Deleted object '%s'.", key)
