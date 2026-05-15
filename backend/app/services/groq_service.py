"""
Groq LLM service — factually grounded, multi-turn, domain-specific responses.

Architecture changes vs. the original:
  1. Multi-turn messages
     Instead of packing everything into a single user string, the full
     conversation history is passed as a messages array:
       [system] → [user/assistant × N prior turns] → [user: context + question]
     The LLM sees real dialogue continuity, not a concatenated wall of text.

  2. Domain-aware system prompt (via PromptManager)
     Built from config (DOMAIN_NAME, DOMAIN_DESCRIPTION, DOMAIN_TOPICS).
     Contains strict anti-hallucination, citation, and uncertainty rules.

  3. Context injection in latest user turn only
     Retrieved evidence is wrapped with clear labels ([Evidence 1], ...)
     and injected exclusively in the current user message — not repeated
     in historical turns — keeping the token budget efficient.

  4. Uncertainty + citation rules baked into the system prompt
     The LLM is instructed to cite evidence blocks by ordinal, signal
     uncertainty explicitly, and refuse to answer outside context.

  5. Model upgrade recommendation
     llama-3.3-70b-versatile follows citation and refusal instructions
     more reliably than llama-3.1-8b-instant.
     Override with GROQ_MODEL env var if latency is more important.
"""
from __future__ import annotations

import logging
import textwrap
from typing import AsyncGenerator

from groq import AsyncGroq

from app.core.config import settings
from app.services.prompt_manager import PromptManager

logger = logging.getLogger(__name__)

# Lazy singleton — initialised on first request
_async_client: AsyncGroq | None = None
_prompt_manager = PromptManager()


async def _get_async_client() -> AsyncGroq:
    global _async_client
    if _async_client is None:
        _async_client = AsyncGroq(api_key=settings.groq_api_key)
        logger.info(
            "AsyncGroq client initialised for model '%s'.", settings.groq_model
        )
    return _async_client


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_edit_response(prompt: str, context: str) -> str:
    """
    Generate a structured JSON edit response (natively async, JSON mode).

    Returns raw JSON string. Always single-turn — edit scope is the current
    document context, not prior conversation.
    """
    client = await _get_async_client()
    built = _prompt_manager.build_edit(instruction=prompt, context=context)

    response = await client.chat.completions.create(
        model=settings.groq_model,
        messages=built.messages,
        response_format={"type": "json_object"},
        temperature=0.3,   # Low: edits must be precise, not creative
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("Groq returned empty content for edit request.")
    return content


async def stream_chat_response(
    prompt: str,
    context: str,
    *,
    history: list[dict[str, str]] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Stream a grounded, domain-specific chat response token-by-token.

    Args:
        prompt  : The user's current question or instruction.
        context : Pre-formatted evidence string from the hybrid retrieval
                  pipeline (dense + BM25 + MemPalace). Empty string means
                  no document was uploaded.
        history : Recent conversation turns [{role, content}], oldest first.
                  Injected as native Groq messages for true multi-turn
                  continuity. Comes from memory_service.get_recent_turns().
                  None or [] → single-turn (no prior context).

    Yields:
        str: Text tokens as they arrive from Groq.

    Anti-hallucination guarantee:
        The system prompt (built by PromptManager) instructs the LLM to
        answer ONLY from the provided evidence blocks and to respond with
        "I don't have information about [topic] in the documents provided."
        when the context is silent on the question.
    """
    client = await _get_async_client()
    built = _prompt_manager.build_chat(
        user_question=prompt,
        context=context,
        history=history or [],
    )

    logger.debug(
        "Groq stream: model=%s turns_in_history=%d context_chars=%d",
        settings.groq_model,
        len(history or []),
        len(context),
    )

    stream = await client.chat.completions.create(
        model=settings.groq_model,
        messages=built.messages,
        temperature=0.4,   # Low-mid: factual but readable, not robotic
        stream=True,
    )

    async for chunk in stream:
        token = chunk.choices[0].delta.content or ""
        if token:
            yield token