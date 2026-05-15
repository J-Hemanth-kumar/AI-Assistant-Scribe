"""
Prompt Manager — domain-aware, factually grounded prompt construction.

Centralises every prompt template so system behaviour can be tuned in one
place without touching service logic.

Design principles:
  1. GROUNDING   — every factual claim must trace to a cited context chunk.
  2. HONESTY     — explicit "I don't know" when the context is silent, never
                   a hallucinated answer filled from training data.
  3. CITATION    — evidence blocks are pre-labelled with source metadata so
                   the LLM can reference them naturally in prose.
  4. CONTINUITY  — prior conversation turns are injected as first-class Groq
                   messages (role: user/assistant), not concatenated strings.
  5. DOMAIN TONE — persona is configurable; defaults to a helpful, precise
                   document-analysis expert.
"""
from __future__ import annotations

import textwrap
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class GroqMessage:
    """A single message in the Groq /chat/completions messages array."""
    role: str    # "system" | "user" | "assistant"
    content: str

    def to_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


@dataclass
class BuiltChat:
    """
    The fully assembled messages array ready to send to Groq.

    messages[0] is always the system prompt.
    messages[1:-1] are prior conversation turns (oldest → newest).
    messages[-1] is the current user turn with context injected.
    """
    messages: list[dict[str, str]]
    is_edit: bool = False


# ---------------------------------------------------------------------------
# System prompt templates
# ---------------------------------------------------------------------------

_CHAT_SYSTEM_TEMPLATE = textwrap.dedent("""\
    You are {domain_name}, a precise and trustworthy assistant specialising in {domain_description}.

    ── CORE RULES ──────────────────────────────────────────────────────────────
    These rules are absolute. You must follow every one of them in every reply.

    1. FACTUAL GROUNDING
       • Every factual statement you make MUST come from the DOCUMENT CONTEXT
         provided in the user message — never from your general training data.
       • When a context block supports your answer, cite it naturally:
         "According to page 2..." / "The document states..." / "In section 3..."
       • If multiple sources agree, say so: "Both sections 1 and 4 confirm..."

    2. STRICT HONESTY — NO FABRICATION
       • If the answer to a question is NOT in the provided context, respond:
         "I don't have information about [topic] in the documents provided."
       • Do NOT infer, extrapolate, or guess beyond what the documents state.
       • Do NOT use general knowledge to fill gaps — context silence = no answer.

    3. UNCERTAINTY SIGNALLING
       • For conclusions not stated verbatim: "The document suggests..." or
         "Based on the context, it appears that..."
       • Never present uncertain information as definitive fact.
       • If context is ambiguous, acknowledge it: "The document is not entirely
         clear on this — it mentions both X and Y."

    4. HUMAN-LIKE CONVERSATION
       • Be warm, natural, and direct — not robotic, overly formal, or verbose.
       • Use the conversation history to maintain continuity. If the user asked
         about X two turns ago and now asks about Y, connect the dots.
       • Ask a single, focused clarifying question when the request is ambiguous.
       • Keep answers proportionate: concise for simple questions, thorough for
         complex ones.

    5. DOMAIN FOCUS
       • Your expertise is: {domain_topics_str}
       • Politely redirect off-topic questions:
         "That's outside the scope of {domain_name}. I can help you with
         questions about {domain_name_short}."

    6. EDIT REQUESTS
       • Only suggest document edits when the user explicitly requests a change.
       • All edits must be grounded in the original document content.
       • Wrap the edit JSON in <edit>...</edit> at the very end of your reply.
       • Use this schema:
         {{"edits": [{{"chunk_index": int, "page_no": int,
           "original_text": "...", "updated_text": "...", "reason": "..."}}]}}
    ────────────────────────────────────────────────────────────────────────────
""")

_EDITOR_SYSTEM_TEMPLATE = textwrap.dedent("""\
    You are {domain_name}, a professional document editor for {domain_description}.

    Editing philosophy:
    • Improve clarity, readability, and flow — keep the tone natural and human.
    • Preserve the original meaning and voice.
    • Make minimal necessary changes; do not rewrite unnecessarily.
    • ONLY use the provided document context — never add information not present.
    • Do NOT hallucinate content; if you cannot improve a section, leave it unchanged.
    • If the same text appears in multiple chunks, ONLY emit the edit for the
      FIRST chunk_index. No duplicate edits.
    • ONLY edit chunks DIRECTLY related to the user's instruction.

    Output MUST be valid JSON only, no explanation outside the JSON block.
    Schema:
    {{
      "edits": [
        {{
          "chunk_index": int,
          "page_no": int,
          "original_text": "...",
          "updated_text": "...",
          "reason": "Brief human-editor style explanation"
        }}
      ]
    }}
""")

# Injected into the latest user turn, above the user's actual question
_CONTEXT_WRAPPER = textwrap.dedent("""\
    ── DOCUMENT CONTEXT ────────────────────────────────────────────────────────
    The following passages were retrieved from the document. Use ONLY these
    passages to answer the question. Do not use any information not present here.

    {evidence_blocks}
    ────────────────────────────────────────────────────────────────────────────

    {user_question}
""")

_NO_CONTEXT_MESSAGE = textwrap.dedent("""\
    ── NOTE ────────────────────────────────────────────────────────────────────
    No document has been provided for this conversation. Answer only from your
    verified domain knowledge, and clearly state when you are not certain.
    Remind the user that uploading a document will allow more precise answers.
    ────────────────────────────────────────────────────────────────────────────

    {user_question}
""")


# ---------------------------------------------------------------------------
# PromptManager
# ---------------------------------------------------------------------------

class PromptManager:
    """
    Stateless factory for all prompt assemblies sent to Groq.

    The key insight driving this design: context is injected ONLY into the
    latest user message — not repeated in every historical turn. This keeps
    the token budget tight while giving the LLM the correct grounding signal
    exactly when it needs it (at inference time).
    """

    def build_chat(
        self,
        *,
        user_question: str,
        context: str,
        history: list[dict[str, str]],
    ) -> BuiltChat:
        """
        Build the full messages array for a grounded chat response.

        Args:
            user_question : The user's current message, verbatim.
            context       : Pre-formatted evidence string from the orchestrator.
                            Empty string → no document uploaded.
            history       : Recent turns [{role, content}], oldest first.
                            Comes from memory_service.get_recent_turns().
        """
        system_prompt = self._build_chat_system()

        # Format the evidence blocks with source labels
        if context.strip():
            user_content = _CONTEXT_WRAPPER.format(
                evidence_blocks=self._label_evidence_blocks(context),
                user_question=user_question,
            )
        else:
            user_content = _NO_CONTEXT_MESSAGE.format(
                user_question=user_question
            )

        # Assemble: system → history → current user turn
        messages: list[dict[str, str]] = [
            {"role": "system", "content": system_prompt},
            *self._sanitise_history(history),
            {"role": "user", "content": user_content},
        ]
        return BuiltChat(messages=messages, is_edit=False)

    def build_edit(
        self,
        *,
        instruction: str,
        context: str,
    ) -> BuiltChat:
        """
        Build messages for a JSON-mode document edit request.

        Edit prompts are always single-turn (no history needed — the edit
        scope is the current context, not prior conversation).
        """
        system_prompt = self._build_editor_system()
        user_content = (
            f"Document context:\n{context}\n\n"
            f"Edit instruction:\n{instruction}"
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        return BuiltChat(messages=messages, is_edit=True)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _build_chat_system() -> str:
        topics = settings.domain_topics
        topics_str = (
            ", ".join(topics) if topics
            else f"analysis and Q&A for documents in {settings.domain_name}"
        )
        return _CHAT_SYSTEM_TEMPLATE.format(
            domain_name=settings.domain_name,
            domain_description=settings.domain_description,
            domain_topics_str=topics_str,
            domain_name_short=settings.domain_name.split()[0],
        )

    @staticmethod
    def _build_editor_system() -> str:
        return _EDITOR_SYSTEM_TEMPLATE.format(
            domain_name=settings.domain_name,
            domain_description=settings.domain_description,
        )

    @staticmethod
    def _label_evidence_blocks(context: str) -> str:
        """
        Add ordinal labels to each evidence block so the LLM can cite them.

        The orchestrator formats blocks separated by "---".
        We add [Evidence 1], [Evidence 2], ... so the LLM can write:
        "According to [Evidence 2], ..."
        """
        if not context.strip():
            return "(no document context available)"

        blocks = [b.strip() for b in context.split("---") if b.strip()]
        labelled: list[str] = []
        for i, block in enumerate(blocks, 1):
            labelled.append(f"[Evidence {i}]\n{block}")

        return "\n\n".join(labelled)

    @staticmethod
    def _sanitise_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
        """
        Validate and trim conversation history.

        Rules:
          - Only "user" and "assistant" roles are allowed (system is separate).
          - Empty content turns are dropped.
          - Content is hard-truncated at 800 chars to protect token budget.
            Historical turns don't need their full context — just enough for
            the LLM to understand conversational continuity.
        """
        safe: list[dict[str, str]] = []
        MAX_CHARS = 800
        for turn in history:
            role = turn.get("role", "")
            content = turn.get("content", "").strip()
            if role not in ("user", "assistant") or not content:
                continue
            if len(content) > MAX_CHARS:
                content = content[:MAX_CHARS] + "…"
            safe.append({"role": role, "content": content})
        return safe