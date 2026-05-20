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
    # llama-3.3-70b-versatile: stronger instruction-following + citation
    # adherence than llama-3.1-8b-instant at modest extra latency.
    # Override in .env: GROQ_MODEL=llama-3.1-8b-instant for faster responses.
    groq_model: str = "llama-3.3-70b-versatile"

    chunk_size: int = 256
    chunk_overlap: int = 32
    rag_top_k: int = 5

    # ── Domain persona ─────────────────────────────────────────────────────
    # Configure in .env to match your deployment context.
    # The system prompt is built from these at runtime (see prompt_manager.py).
    #
    # DOMAIN_NAME        - Short name shown in the persona heading.
    # DOMAIN_DESCRIPTION - One sentence: what this assistant does.
    # DOMAIN_TOPICS      - JSON list of topics; used for polite off-topic redirect.
    domain_name: str = "Scribe Assistant"
    domain_description: str = (
        "precise document analysis, question answering, and guided editing "
        "of uploaded documents"
    )
    domain_topics: list[str] = [
        "document content and structure",
        "section summaries and key facts",
        "document editing and revision",
        "clarifying questions about the uploaded file",
    ]

    # ── Conversation history ───────────────────────────────────────────────
    # How many prior user+assistant turn PAIRS to inject into each Groq call.
    # Each pair ≈ 200-400 tokens. Higher = better continuity, more cost.
    # Recommended: 4–8.  Override: CONVERSATION_HISTORY_TURNS=4
    conversation_history_turns: int = 6

    # ── Retrieval orchestrator — sequential cascade pipeline ──────────────
    #
    # Chat query cascade (short-circuits on first satisfied stage):
    #   Stage 1: mempalace  — local episodic memory, zero vector DB cost.
    #                         Stops if score >= mempalace_confidence_threshold.
    #   Stage 2: hybrid RAG — qdrant (dense) + bm25 (sparse), concurrent.
    #                         Only fires if Stage 1 not satisfied.
    #
    # Edit queries: qdrant only (chunk_index alignment required).
    retrieval_sources: list[str] = ["qdrant", "bm25", "mempalace"]
    rrf_k: int = 60  # Reciprocal Rank Fusion constant (Cormack et al. 2009)

    # Min MemPalace score to short-circuit Hybrid RAG (Stage 2).
    # 0.75 = strong match required. Override: MEMPALACE_CONFIDENCE_THRESHOLD=0.80
    mempalace_confidence_threshold: float = 0.75

    allowed_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    tesseract_lang: str = "eng"
    log_level: str = "INFO"
    app_env: str = "local"


settings = Settings()