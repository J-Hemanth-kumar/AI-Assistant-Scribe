/**
 * src/components/chat/ChatMessage.tsx
 *
 * Renders a single chat message using the deterministic layout engine.
 *
 * ZERO LAYOUT SHIFT GUARANTEE
 * ────────────────────────────
 * 1. useChatLayout() pre-computes lines[] and height before the first paint.
 * 2. The bubble's outer div has an explicit `height: ${height}px` style —
 *    the browser never needs to measure text to size the container.
 * 3. Each rendered line uses `position: absolute; top: N × lineHeight` —
 *    zero reflow from neighbouring lines.
 * 4. The height is fed back to ChatList's virtual item sizer so the
 *    virtualized container knows the exact row height before rendering it.
 *
 * STREAMING STABILITY
 * ────────────────────
 * During streaming:
 *   • useChatLayout() uses the incremental tail strategy (see chatLayout.ts).
 *   • Only the last partial line is re-laid-out on each new token.
 *   • The blinking cursor is appended to the last line as a CSS pseudo-element,
 *     not by injecting characters into the text — so layout is not disturbed.
 *   • Scroll position is managed by ChatList, not this component.
 *
 * MARKDOWN AWARENESS
 * ───────────────────
 * The layout engine treats text as plain characters.  Markdown decoration
 * (bold, headings, bullets, citations) is applied as a post-process over the
 * computed lines via `decorateLine()` — which rewrites segments but never
 * changes line counts, keeping height stable.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { AlertCircle, Copy, Check } from 'lucide-react';
import { useChatLayout, CHAT_LINE_HEIGHT, CHAT_PADDING_V } from '@/lib/pretext/chatLayout';

import { parseInlineCitations } from '@/utils/id';
import type { Message, Citation, HighlightSegment } from '@/types';

// ── Markdown decoration ────────────────────────────────────────────────────
// Applied after layout so it never changes line counts.

type LineDecoration =
  | { kind: 'h2';     text: string }
  | { kind: 'h3';     text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'code';   text: string }
  | { kind: 'plain';  text: string; segments: HighlightSegment[] };

function decorateLine(lineText: string): LineDecoration {
  if (lineText.startsWith('## '))  return { kind: 'h2',     text: lineText.slice(3) };
  if (lineText.startsWith('### ')) return { kind: 'h3',     text: lineText.slice(4) };
  if (lineText.startsWith('- ') || lineText.startsWith('* '))
    return { kind: 'bullet', text: lineText.slice(2) };
  if (lineText.startsWith('```') || lineText.startsWith('    '))
    return { kind: 'code',   text: lineText };

  // Parse inline citation markers [N] and bold **text**
  const raw = parseInlineCitations(lineText);
  const segments: HighlightSegment[] = raw.flatMap((seg) => {
    if (seg.type === 'citation') {
      return [{ text: seg.content, type: 'modified' as const }];
    }
    // Bold: split on **…**
    const boldParts = seg.content.split(/\*\*([^*]+)\*\*/g);
    return boldParts.map((part, j) =>
      j % 2 === 1
        ? { text: part }      // bold rendered via CSS in LineRenderer
        : { text: part }
    );
  });

  return { kind: 'plain', text: lineText, segments };
}

// ── Line renderer ──────────────────────────────────────────────────────────

interface LineRendererProps {
  lineText: string;
  top: number;
  isUser: boolean;
  citations: Citation[];
  onCitationClick?: (c: Citation) => void;
}

const LineRenderer = React.memo(function LineRenderer({
  lineText,
  top,
  isUser,
  citations,
  onCitationClick,
}: LineRendererProps) {
  const dec = decorateLine(lineText);
  const baseStyle: React.CSSProperties = {
    position:  'absolute',
    top,
    left:      0,
    right:     0,
    height:    CHAT_LINE_HEIGHT,
    display:   'flex',
    alignItems: 'center',
    padding:   '0 16px',
    fontSize:  14,
    lineHeight: `${CHAT_LINE_HEIGHT}px`,
  };

  switch (dec.kind) {
    case 'h2':
      return (
        <div style={baseStyle}>
          <span className={`font-bold text-sm ${isUser ? 'text-white' : 'text-surface-900 dark:text-zinc-100'}`}>
            {dec.text}
          </span>
        </div>
      );

    case 'h3':
      return (
        <div style={baseStyle}>
          <span className={`font-semibold text-[13px] ${isUser ? 'text-white' : 'text-surface-900 dark:text-zinc-100'}`}>
            {dec.text}
          </span>
        </div>
      );

    case 'bullet':
      return (
        <div style={{ ...baseStyle, gap: 6 }}>
          <span className={`shrink-0 text-[8px] ${isUser ? 'text-white/60' : 'text-accent-400 dark:text-accent-400'}`}>●</span>
          <InlineLine text={dec.text} isUser={isUser} citations={citations} onCitationClick={onCitationClick} />
        </div>
      );

    case 'code':
      return (
        <div style={baseStyle}>
          <code
            className={`font-mono text-[12px] px-1.5 py-0.5 rounded ${
              isUser
                ? 'bg-white/10 text-white'
                : 'bg-surface-100 text-surface-700 dark:bg-slate-800 dark:text-zinc-300'
            }`}
          >
            {dec.text}
          </code>
        </div>
      );

    default:
      return (
        <div style={baseStyle}>
          <InlineLine
            text={dec.text}
            isUser={isUser}
            citations={citations}
            onCitationClick={onCitationClick}
          />
        </div>
      );
  }
});

// ── Inline text (bold + citations) ────────────────────────────────────────

interface InlineLineProps {
  text: string;
  isUser: boolean;
  citations: Citation[];
  onCitationClick?: (c: Citation) => void;
}

function InlineLine({ text, isUser, citations, onCitationClick }: InlineLineProps) {
  const parts = parseInlineCitations(text);

  return (
    <span className={isUser ? 'text-white' : 'text-surface-800 dark:text-zinc-200'}>
      {parts.map((seg, i) => {
        if (seg.type === 'citation') {
          const cit = citations.find((c) => c.index === seg.index);
          return (
            <button
              key={i}
              onClick={() => cit && onCitationClick?.(cit)}
              title={cit ? `${cit.sourceTitle}: ${cit.excerpt}` : undefined}
              className={`
                inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
                mx-0.5 cursor-pointer transition-all duration-200
                ${isUser
                  ? 'bg-white/20 text-white hover:bg-white/30'
                  : 'bg-accent-50 text-accent-700 border border-accent-200 hover:bg-accent-100 dark:bg-accent-950/40 dark:text-accent-300 dark:border-accent-800/60 dark:hover:bg-accent-900/60'
                }
              `}
              aria-label={`Citation ${seg.index}`}
            >
              {seg.content}
            </button>
          );
        }
        // Handle **bold** inline
        const boldParts = seg.content.split(/\*\*([^*]+)\*\*/g);
        return (
          <React.Fragment key={i}>
            {boldParts.map((part, j) =>
              j % 2 === 1
                ? <strong key={j} className={isUser ? 'text-white' : 'text-surface-900 dark:text-white'}>{part}</strong>
                : <React.Fragment key={j}>{part}</React.Fragment>
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
}

// ── Typing indicator ───────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 px-5 py-3" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-surface-400 dark:bg-slate-500 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

// ── ChatMessage ────────────────────────────────────────────────────────────

export interface ChatMessageProps {
  message: Message;
  onToggleEvidence: (evidenceId: string) => void;
  onCitationClick?: (citation: Citation) => void;
  /**
   * Called after layout is computed so ChatList can store the exact height
   * and pass it to the virtualizer item sizer.
   */
  onHeightReady?: (messageId: string, height: number) => void;
}

export const ChatMessage = React.memo(function ChatMessage({
  message,
  onCitationClick,
  onHeightReady,
}: ChatMessageProps) {
  const isUser   = message.role === 'user';
  const [copied, setCopied] = useState(false);

  // Debug logging for content changes
  useEffect(() => {
    console.log(`[ChatMessage ${message.id}] Content updated:`, {
      content: message.content,
      length: message.content?.length,
      isStreaming: message.isStreaming,
      firstChar: message.content?.charAt(0),
      lastChar: message.content?.charAt(message.content.length - 1)
    });
  }, [message.content, message.id, message.isStreaming]);

  // ── Pretext layout ──────────────────────────────────────────────────
  const { lines, height, containerRef } = useChatLayout(
    message.content,
    message.isStreaming === true
  );

  // Report height to ChatList once layout stabilises
  const reportedHeightRef = useRef(-1);
  useEffect(() => {
    if (height !== reportedHeightRef.current && height > 0) {
      reportedHeightRef.current = height;
      onHeightReady?.(message.id, height);
    }
  }, [height, message.id, onHeightReady]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full
                  group animate-slide-up`}
      data-message-id={message.id}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-600 to-accent-400 dark:from-accent-500 dark:to-accent-400
                        flex items-center justify-center text-white text-[10px] font-bold
                        shrink-0 mt-0.5 mr-2.5 shadow-sm dark:shadow-[0_0_12px_rgba(99,102,241,0.25)] select-none">
          S
        </div>
      )}

      <div 
        ref={containerRef}
        className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
        style={{ maxWidth: '75%' }}
      >

        {/* ── Message bubble ─────────────────────────────────────────── */}
        <div
          className={`
            relative rounded-2xl overflow-hidden shadow-bubble dark:shadow-dark-bubble
            ${isUser
              ? 'bg-gradient-to-br from-accent-600 to-accent-500 dark:from-accent-600 dark:to-accent-700 rounded-br-sm border dark:border-accent-500/20'
              : 'bg-white border border-surface-200 dark:bg-slate-900/60 dark:border-slate-800/80 backdrop-blur-md rounded-bl-sm'
            }
          `}
          /*
           * Explicit height to prevent layout shifts.
           * We add a small buffer for vertical padding.
           */
          style={{ 
            height: (message.isStreaming && message.content === '') ? 'auto' : `${height}px`,
            minWidth: '60px' 
          }}
        >
          {/* Error banner */}
          {message.error && (
            <div className="flex items-center gap-2 text-red-400 text-xs px-4 py-2">
              <AlertCircle size={13} />
              {message.error}
            </div>
          )}

          {/* Typing dots (before first token arrives) */}
          {message.isStreaming && message.content === '' && <TypingDots />}

          {/* 
            GHOST TEXT (INTERNAL WIDTH DRIVER)
            ──────────────────────────────────
            This text is transparent and unselectable, but it forces the parent 
            bubble to have the correct 'natural' width under maxWidth: 75%.
            Without this, an absolute-only container collapses to 0px width.
          */}
          {message.content !== '' && (
            <div 
              className="opacity-0 invisible select-none pointer-events-none px-4 py-3 text-sm leading-relaxed"
              aria-hidden="true"
            >
              {message.content}
            </div>
          )}

          {/* Line-by-line content area — overlaid on top of the ghost-width */}
          {message.content !== '' && (
            <div
              style={{ 
                position: 'absolute', 
                top: `${CHAT_PADDING_V / 2}px`, 
                left: 0, 
                right: 0, 
                bottom: 0 
              }}
              aria-label={isUser ? 'Your message' : 'Assistant response'}
            >
              {lines.map((line, i) => (
                <LineRenderer
                  key={`${message.id}-L${i}`}
                  lineText={line.text}
                  top={i * CHAT_LINE_HEIGHT}
                  isUser={isUser}
                  citations={message.citations ?? []}
                  onCitationClick={onCitationClick}
                />
              ))}

              {/* Blinking cursor (CSS only — no text injection, no layout change) */}
              {message.isStreaming && message.content !== '' && lines.length > 0 && (
                <span
                  className="absolute w-0.5 h-3.5 bg-accent-400 dark:bg-accent-500 animate-pulse"
                  style={{
                    top: (lines.length - 1) * CHAT_LINE_HEIGHT + 4,
                    right: 16
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          )}
        </div>

        {/* ── Meta row ────────────────────────────────────────────────── */}
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-[10px] text-surface-400 dark:text-slate-500 font-medium">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && !message.isStreaming && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-0.5
                         text-surface-400 hover:text-surface-600 dark:text-slate-500 dark:hover:text-slate-300"
              aria-label="Copy response"
            >
              {copied
                ? <Check size={12} className="text-green-500" />
                : <Copy size={12} />
              }
            </button>
          )}
        </div>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-7 h-7 rounded-lg bg-surface-200 dark:bg-slate-800 flex items-center justify-center
                        text-surface-500 dark:text-slate-400 text-[10px] font-bold shrink-0 mt-0.5 ml-2.5
                        border dark:border-slate-700/50 shadow-sm select-none">
          U
        </div>
      )}
    </div>
  );
});