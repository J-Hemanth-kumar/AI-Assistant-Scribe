import logging

from app.orchestrator.orchestrator import CognitiveOrchestrator

logger = logging.getLogger(__name__)


class RetrievalService:
    """
    Backward-compatible façade — delegates to CognitiveOrchestrator.
    
    This preserves the interface expected by existing callers (edit.py, rag_service.py)
    while routing all retrieval through the new multi-source Cognitive System.
    """

    def __init__(self) -> None:
        self._orchestrator = CognitiveOrchestrator()

    def retrieve_context(
        self,
        doc_id: str | None,
        query: str,
        *,
        session_id: str | None = None,
        is_edit: bool = False,
        top_k: int = 5,
    ) -> str:
        """
        Retrieve context and format as a string.
        Passes doc_id, session_id, and is_edit down to the Orchestrator.
        """
        return self._orchestrator.retrieve(
            query,
            doc_id=doc_id,
            session_id=session_id,
            is_edit=is_edit,
            top_k=top_k,
        )
