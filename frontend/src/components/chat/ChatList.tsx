/**
 * src/components/chat/ChatList.tsx
 *
 * Virtualized chat message container.
 *
 * SCROLL STABILITY DURING STREAMING
 * ────────────────────────────────────
 * The key challenge: as streaming tokens arrive, the last message grows.
 * Naive implementations cause the viewport to jump because the DOM height
 * changes and the browser tries to maintain scroll position relative to
 * the top of the content.
 *
 * Solution — "stick to bottom" strategy:
 *   1. `isStuckToBottom` ref tracks whether the user is scrolled to within
 *      STICK_THRESHOLD px of the bottom.
 *   2. During streaming, if stuck, we scroll to bottom after each token.
 *   3. If the user scrolls up manually, isStuckToBottom = false → we stop
 *      auto-scrolling immediately, keeping their scroll position stable.
 *   4. When streaming ends, isStuckToBottom resets to true.
 *
 * HEIGHT MANAGEMENT
 * ──────────────────
 * ChatMessage calls `onHeightReady(id, height)` after its pretext layout
 * resolves.  ChatList stores these in a Map and feeds them to react-virtual's
 * `getItemSize`.  This means:
 *   • The virtual container gets exact row heights (no estimation).
 *   • No DOM measurement is ever needed — heights come from the pretext engine.
 *   • Streaming messages update their stored height on each token batch.
 *
 * OPTIONAL VIRTUALIZATION
 * ────────────────────────
 * Virtualization is only active when messages.length > VIRTUALIZE_THRESHOLD.
 * Below that threshold we render all messages in a plain flex column — which
 * avoids the virtualizer overhead for typical conversation lengths while
 * enabling it automatically for very long sessions.
 */

import {
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChatMessage } from './ChatMessage';
import { bubbleHeight } from '@/lib/pretext/chatLayout';
import type { Message, Citation } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────

/** Activate virtualization above this many messages. */
const VIRTUALIZE_THRESHOLD = 50;

/** Within this many px of the bottom = "stuck to bottom". */
const STICK_THRESHOLD = 60;

/** Padding (px) between message rows */
const ROW_GAP = 16;

/** Fallback height used before layout resolves. */
const DEFAULT_ROW_HEIGHT = 80;

// ── Welcome / empty states ─────────────────────────────────────────────────
// Defined outside component to avoid re-creating on each render

function WelcomeScreen({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center
                    px-6 animate-fade-in select-none">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-600 to-accent-400
                      flex items-center justify-center shadow-lg mb-4">
        <span className="text-white text-xl font-bold">S</span>
      </div>
      <h2 className="text-xl font-bold text-surface-800 mb-2">Welcome to Scribe</h2>
      <p className="text-sm text-surface-500 max-w-xs leading-relaxed mb-6">
        Upload documents and ask questions to get structured, cited answers
        powered by your RAG pipeline.
      </p>
      <button onClick={onCreate} className="btn-primary">
        Start a conversation
      </button>
      <div className="mt-8 grid grid-cols-3 gap-3 max-w-sm w-full">
        {[
          { icon: '📄', label: 'Upload PDFs & Docs' },
          { icon: '🔖', label: 'Cited answers' },
          { icon: '📤', label: 'Export results' },
        ].map((f) => (
          <div key={f.label}
               className="bg-white rounded-xl p-3 border border-surface-200 text-center shadow-sm">
            <div className="text-xl mb-1">{f.icon}</div>
            <p className="text-[10px] text-surface-500 font-medium leading-tight">{f.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center
                    px-6 animate-fade-in select-none">
      <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center mb-3">
        <span className="text-surface-400 text-lg">💬</span>
      </div>
      <h3 className="text-sm font-semibold text-surface-600 mb-1">No messages yet</h3>
      <p className="text-xs text-surface-400 max-w-xs leading-relaxed">
        Type below, or upload a document first to enable RAG-powered responses.
      </p>
    </div>
  );
}

// ── ChatList ───────────────────────────────────────────────────────────────

interface ChatListProps {
  messages: Message[];
  hasSession: boolean;
  onCreateSession: () => void;
  onToggleEvidence: (messageId: string, evidenceId: string) => void;
  onCitationClick?: (citation: Citation) => void;
}

export function ChatList({
  messages,
  hasSession,
  onCreateSession,
  onToggleEvidence,
  onCitationClick,
}: ChatListProps) {
  const scrollRef       = useRef<HTMLDivElement>(null);
  const isStuckRef      = useRef(true);
  const isStreamingRef  = useRef(false);

  // Per-message height cache (id → px)
  const heightMapRef = useRef(new Map<string, number>());
  const [, forceUpdate] = useState(0);

  const lastMessage = messages.at(-1);
  const isCurrentlyStreaming = lastMessage?.isStreaming === true;

  // Track streaming state
  useEffect(() => {
    isStreamingRef.current = isCurrentlyStreaming;
    if (!isCurrentlyStreaming) {
      isStuckRef.current = true; // reset after stream ends
    }
  }, [isCurrentlyStreaming]);

  // ── Scroll-stick logic ─────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isStuckRef.current = distFromBottom <= STICK_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Auto-scroll when new messages added or streaming token arrives
  useEffect(() => {
    if (isStuckRef.current) {
      scrollToBottom(isCurrentlyStreaming ? 'instant' : 'smooth');
    }
  }, [messages.length, lastMessage?.content, isCurrentlyStreaming, scrollToBottom]);

  // ── Height reporting from ChatMessage ─────────────────────────────
  const handleHeightReady = useCallback((messageId: string, height: number) => {
    const prev = heightMapRef.current.get(messageId);
    if (prev !== height) {
      heightMapRef.current.set(messageId, height);
      forceUpdate((n) => n + 1);
      // If at bottom and a message height changed (streaming), scroll to keep up
      if (isStuckRef.current) {
        scrollToBottom('instant');
      }
    }
  }, [scrollToBottom]);

  // ── Virtualizer ────────────────────────────────────────────────────
  const shouldVirtualize = messages.length > VIRTUALIZE_THRESHOLD;

  const getSize = useCallback((index: number): number => {
    const msg = messages[index];
    const stored = heightMapRef.current.get(msg.id);
    if (stored) return stored + ROW_GAP;
    // Before layout resolves: estimate from content length
    const rough = Math.ceil(msg.content.length / 60) || 1;
    return bubbleHeight(rough) + ROW_GAP;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count:            shouldVirtualize ? messages.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize:     getSize,
    overscan:         10,
    // Measure actual rendered heights and update estimates
    measureElement:   (el) => {
      const h = el.getBoundingClientRect().height;
      return h > 0 ? h : DEFAULT_ROW_HEIGHT;
    },
  });

  // ── Render ──────────────────────────────────────────────────────────

  if (!hasSession) {
    return (
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <WelcomeScreen onCreate={onCreateSession} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <EmptyConversation />
      </div>
    );
  }

  // ── Flat (non-virtualized) render for short conversations ──────────
  if (!shouldVirtualize) {
    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 md:px-6 py-4"
        style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}
      >
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onToggleEvidence={(evId) => onToggleEvidence(msg.id, evId)}
            onCitationClick={onCitationClick}
            onHeightReady={handleHeightReady}
          />
        ))}
        {/* Scroll anchor */}
        <div style={{ height: 1, flexShrink: 0 }} aria-hidden="true" />
      </div>
    );
  }

  // ── Virtualized render for long conversations ──────────────────────
  const virtualItems  = virtualizer.getVirtualItems();
  const totalSize     = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 md:px-6"
      aria-label="Chat messages"
    >
      {/* Total height sentinel */}
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((vItem) => {
          const msg = messages[vItem.index];
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position:  'absolute',
                top:       vItem.start,
                left:      0,
                right:     0,
                paddingTop: ROW_GAP / 2,
                paddingBottom: ROW_GAP / 2,
              }}
            >
              <ChatMessage
                message={msg}
                onToggleEvidence={(evId) => onToggleEvidence(msg.id, evId)}
                onCitationClick={onCitationClick}
                onHeightReady={handleHeightReady}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
