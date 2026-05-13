"""
Groq LLM service — refactored to use AsyncGroq for true streaming.

Uses the official Groq Python SDK (AsyncGroq). Both edit generation 
(JSON mode) and streaming chat responses are natively asynchronous.
"""
import logging
import textwrap
from typing import AsyncGenerator

from groq import AsyncGroq

from app.core.config import settings

logger = logging.getLogger(__name__)

# Lazy singleton
_async_client: AsyncGroq | None = None


async def _get_async_client() -> AsyncGroq:
    global _async_client
    if _async_client is None:
        _async_client = AsyncGroq(api_key=settings.groq_api_key)
        logger.info("AsyncGroq client initialised for model '%s'.", settings.groq_model)
    return _async_client


_EDITOR_SYSTEM_PROMPT = textwrap.dedent("""\
    You are a professional human document editor.

    Editing Guidelines:
    - Improve clarity, readability, and flow
    - Keep the tone natural and human-like
    - Do NOT sound robotic or overly formal
    - Preserve the original meaning
    - Make minimal necessary changes
    - If summarising, keep it concise but meaningful

    Strict Rules:
    - ONLY use the provided context
    - Do NOT add new information or hallucinate
    - Do NOT include explanations outside JSON
    - Output MUST be valid JSON only
    - If the same text appears in multiple chunks, ONLY output the edit for the
      FIRST chunk_index. No duplicate edits.
    - ONLY edit chunks DIRECTLY related to the user's instruction.

    Output Format:
    {
      "edits": [
        {
          "chunk_index": int,
          "page_no": int,
          "original_text": "...",
          "updated_text": "...",
          "reason": "Brief human-editor style explanation"
        }
      ]
    }
""")

_CHAT_SYSTEM_PROMPT = textwrap.dedent("""\
    You are a helpful AI assistant that answers questions and performs edits on the user's document.
    
    Rules for Answers:
    - Use only the provided document context to answer accurately and concisely.
    - If the answer is not in the context, say so clearly — do not hallucinate.

    Rules for Edits:
    - If the user asks for a CHANGE or UPDATE to the document (e.g., 'change name to Manoj'), you MUST provide the technical edit in a structured JSON block at the ENTIRE END of your response.
    - Surround the JSON block with <edit>...</edit> tags.
    - DO NOT include explanations inside the <edit> tags.
    - Use the following JSON schema for the edit block:
      {"edits": [{"chunk_index": int, "page_no": int, "original_text": "...", "updated_text": "...", "reason": "..."}]}
""")


async def generate_edit_response(prompt: str, context: str) -> str:
    """
    Generate a JSON edit response (natively async).
    Returns raw JSON string.
    """
    client = await _get_async_client()
    response = await client.chat.completions.create(
        model=settings.groq_model,
        messages=[
            {"role": "system", "content": _EDITOR_SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nInstruction:\n{prompt}"},
        ],
        response_format={"type": "json_object"},
        temperature=0.7,
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("Groq returned empty content.")
    return content


async def stream_chat_response(prompt: str, context: str) -> AsyncGenerator[str, None]:
    """
    Stream a chat response token-by-token using AsyncGroq.
    Tokens are yielded immediately as they arrive from the network.
    """
    client = await _get_async_client()
    
    # We use await to start the stream
    stream = await client.chat.completions.create(
        model=settings.groq_model,
        messages=[
            {"role": "system", "content": _CHAT_SYSTEM_PROMPT},
            {"role": "user", "content": f"Document context:\n{context}\n\nUser question:\n{prompt}"},
        ],
        temperature=0.7,
        stream=True,
    )

    # Async iteration over the response chunks
    async for chunk in stream:
        token = chunk.choices[0].delta.content or ""
        if token:
            yield token
