from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.config import settings


class Chunker:
    def __init__(self, chunk_size: int | None = None, chunk_overlap: int | None = None) -> None:
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size or settings.chunk_size,
            chunk_overlap=chunk_overlap or settings.chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

    def split_text(self, text: str) -> list[str]:
        return self._splitter.split_text(text)
