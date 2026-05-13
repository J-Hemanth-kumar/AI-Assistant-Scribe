import logging
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


class Embedder:
    """Singleton BGE-M3 embedder — model loaded once on first use."""
    _instance: "Embedder | None" = None
    _model: SentenceTransformer | None = None

    def __new__(cls) -> "Embedder":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _load(self) -> None:
        if self._model is None:
            logger.info("Loading BGE-M3 embedding model...")
            self._model = SentenceTransformer("BAAI/bge-m3", device="cpu")
            logger.info("BGE-M3 loaded.")

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self._load()
        return self._model.encode(texts).tolist()  # type: ignore[union-attr]
