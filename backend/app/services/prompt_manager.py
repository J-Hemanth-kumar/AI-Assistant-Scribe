"""
Prompt Manager — domain-aware, factually grounded prompt construction.
"""
from __future__ import annotations
import textwrap
from dataclasses import dataclass, field
from typing import Any
from app.core.config import settings

@dataclass
class BuiltChat:
    messages: list[dict[str, str]]
    is_edit: bool = False

_CHAT_SYSTEM = """\
You are {domain_name}, a precise and trustworthy assistant for {domain_description}.

RULES (absolute — follow in every reply):

1. FACTUAL GROUNDING: Every fact must come from the DOCUMENT CONTEXT only.
   Cite chunks naturally: "According to chunk 2..." / "The document states..."

2. STRICT HONESTY: If not in context: "I don't have information about [topic]
   in the documents provided." Never guess or extrapolate.

3. UNCERTAINTY: For inferred conclusions use "The document suggests..." or
   "Based on the context, it appears..."

4. CONVERSATION: Be warm, natural, direct. Use conversation history for
   continuity. Ask one clarifying question when request is ambiguous.

5. DOMAIN FOCUS: Expertise is: {domain_topics_str}
   Redirect off-topic questions back to {domain_name_short}.

6. EDIT REQUESTS: Only suggest edits when user explicitly requests a change.

   CRITICAL:
   a. original_text = VERBATIM document chunk text ONLY.
      NEVER copy <<< chunk headers, evidence labels, or context preamble.
   b. updated_text = plain text ONLY. NO HTML. NO <font> tags. NO CSS.
      For style-only changes (color/font/size/bold): set updated_text = "".
   c. Styling goes in "style" object, never in updated_text.
   d. For "entire document": one edit per chunk, same style for each.

   Wrap edit JSON in <edit>...</edit> at very end of reply.

   Schema:
   {{"edits": [{{
     "chunk_index": <int>, "page_no": <int>,
     "original_text": "<verbatim document text>",
     "updated_text": "<plain text or empty string>",
     "reason": "<one sentence>",
     "style": {{
       "font_name": "<e.g. Times New Roman> or omit",
       "font_size": <float points e.g. 15.0> or omit,
       "bold": true/false or omit, "italic": true/false or omit,
       "color_hex": "<#RRGGBB e.g. #008000 for green> or omit",
       "alignment": "left"/"center"/"right"/"justify" or omit,
       "is_heading": true/false or omit
     }}
   }}]}}

   Color reference (ALWAYS use hex in color_hex — NEVER HTML tags):
     green=#008000  red=#FF0000  blue=#0000FF  black=#000000
     navy=#000080  purple=#800080  orange=#FF8C00  gray=#808080

   EXAMPLE — "change font color to green for entire document":
   <edit>{{"edits": [
     {{"chunk_index": 0, "page_no": 1, "original_text": "<verbatim chunk 0 text>",
       "updated_text": "", "reason": "green font", "style": {{"color_hex": "#008000"}}}},
     {{"chunk_index": 1, "page_no": 1, "original_text": "<verbatim chunk 1 text>",
       "updated_text": "", "reason": "green font", "style": {{"color_hex": "#008000"}}}}
   ]}}</edit>
"""

_EDITOR_SYSTEM = """\
You are {domain_name}, a professional document editor for {domain_description}.

OUTPUT: Respond with ONLY a valid JSON object. Nothing outside the JSON.

Schema:
{{
  "edits": [{{
    "chunk_index": <int>, "page_no": <int>,
    "original_text": "<verbatim chunk text — never the <<< header line>",
    "updated_text": "<new plain text OR empty string for style-only>",
    "reason": "<one sentence>",
    "style": {{
      "font_name": "<e.g. Times New Roman> or omit",
      "font_size": <float points e.g. 15.0> or omit,
      "bold": true/false or omit, "italic": true/false or omit,
      "color_hex": "<#RRGGBB e.g. #008000 for green> or omit",
      "alignment": "left"/"center"/"right"/"justify" or omit,
      "line_spacing": <float e.g. 1.5> or omit,
      "is_heading": true/false or omit
    }}
  }}]
}}

RULES (never break):
1. NEVER put HTML, <font> tags, or CSS in updated_text.
2. Style-only changes: updated_text = "".
3. original_text = verbatim chunk text. NEVER include <<< header lines.
4. Scope: "entire document" = one edit per chunk shown.
5. No duplicate chunk_index values.

Color reference (hex only — NO HTML):
  green=#008000  red=#FF0000  blue=#0000FF  black=#000000  navy=#000080
  purple=#800080  orange=#FF8C00  gray=#808080  white=#FFFFFF

EXAMPLES:
"Change headings to Times New Roman size 15":
  "updated_text":"", "style":{{"font_name":"Times New Roman","font_size":15.0,"is_heading":true}}

"Change font color to green for entire document":
  "updated_text":"", "style":{{"color_hex":"#008000"}}  (one per chunk)

"Change font color to red for headings only":
  "updated_text":"", "style":{{"color_hex":"#FF0000","is_heading":true}}

"Make the introduction bold":
  "updated_text":"", "style":{{"bold":true}}

"Rewrite the summary to be shorter":
  "updated_text":"The plain-text rewritten summary.", "style":null
"""

_CONTEXT_WRAPPER = """\
── DOCUMENT CONTEXT ─────────────────────────────────────────────────────────
The passages below were retrieved from the document. Use ONLY these.
EDIT RULE: "original_text" in any <edit> block must be raw document chunk
text ONLY — never copy <<< chunk headers, labels, or this preamble.

{evidence_blocks}
─────────────────────────────────────────────────────────────────────────────

{user_question}"""

_NO_CONTEXT = """\
── NOTE ─────────────────────────────────────────────────────────────────────
No document has been provided. Answer from verified domain knowledge and state
when uncertain. Remind the user to upload a document for precise answers.
─────────────────────────────────────────────────────────────────────────────

{user_question}"""


class PromptManager:
    """Stateless factory for all prompt assemblies sent to Groq."""

    def build_chat(self, *, user_question: str, context: str, history: list[dict[str, str]]) -> BuiltChat:
        system = _CHAT_SYSTEM.format(
            domain_name=settings.domain_name,
            domain_description=settings.domain_description,
            domain_topics_str=", ".join(settings.domain_topics) if settings.domain_topics else settings.domain_name,
            domain_name_short=settings.domain_name.split()[0],
        )
        if context.strip():
            user_content = _CONTEXT_WRAPPER.format(
                evidence_blocks=self._label_evidence_blocks(context),
                user_question=user_question,
            )
        else:
            user_content = _NO_CONTEXT.format(user_question=user_question)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": system},
            *self._sanitise_history(history),
            {"role": "user", "content": user_content},
        ]
        return BuiltChat(messages=messages, is_edit=False)

    def build_edit(self, *, instruction: str, context: str) -> BuiltChat:
        system = _EDITOR_SYSTEM.format(
            domain_name=settings.domain_name,
            domain_description=settings.domain_description,
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Document context:\n{context}\n\nEdit instruction:\n{instruction}"},
        ]
        return BuiltChat(messages=messages, is_edit=True)

    @staticmethod
    def _label_evidence_blocks(context: str) -> str:
        """
        Format evidence blocks with headers that are visually distinct from
        document text so the LLM never copies them into original_text.

        Header format:  <<< CHUNK N | source=... — DO NOT copy into original_text >>>
        The <<< >>> delimiters are unambiguous metadata markers, not document content.
        """
        if not context.strip():
            return "(no document context available)"

        blocks = [b.strip() for b in context.split("---") if b.strip()]
        labelled: list[str] = []
        for i, block in enumerate(blocks, 1):
            lines = block.splitlines()
            source_line = ""
            text_lines = lines
            if lines and lines[0].startswith("[source="):
                source_line = lines[0]
                text_lines = lines[1:]
            chunk_text = "\n".join(text_lines).strip()
            meta = f"CHUNK {i}" + (f" | {source_line}" if source_line else "")
            header = f"<<< {meta} — DO NOT copy this header into original_text >>>"
            labelled.append(f"{header}\n{chunk_text}")

        return "\n\n".join(labelled)

    @staticmethod
    def _sanitise_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
        """Validate, filter, and truncate prior turns for safe injection."""
        safe: list[dict[str, str]] = []
        for turn in history:
            role = turn.get("role", "")
            content = turn.get("content", "").strip()
            if role not in ("user", "assistant") or not content:
                continue
            if len(content) > 800:
                content = content[:800] + "…"
            safe.append({"role": role, "content": content})
        return safe