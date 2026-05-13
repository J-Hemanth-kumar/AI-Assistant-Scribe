from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    redis_url: str
    celery_broker_url: str
    celery_result_backend: str

    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    minio_region: str = "us-east-1"
    minio_secure: bool = False

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333

    # MongoDB (MemPalace vector backend)
    mongo_url: str = "mongodb://scribe:changeme@localhost:27017/mempalace?authSource=admin"
    mongo_db: str = "mempalace"

    # MemPalace
    mempalace_path: str = "/tmp/mempalace/palace"
    mempalace_wing: str = "scribe"

    groq_api_key: str
    groq_model: str = "llama-3.1-8b-instant"

    chunk_size: int = 256
    chunk_overlap: int = 32
    rag_top_k: int = 5

    # Retrieval orchestrator
    retrieval_sources: list[str] = ["qdrant", "mempalace", "postgres"]
    rrf_k: int = 60  # RRF constant

    allowed_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    tesseract_lang: str = "eng"
    log_level: str = "INFO"
    app_env: str = "local"


settings = Settings()
