import {
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChatMessage } from './ChatMessage';
import { bubbleHeight } from '@/lib/pretext/chatLayout';
import { Sparkles, FileText, Bookmark, Share2 } from 'lucide-react';
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

function WelcomeScreen({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full text-center
                    px-6 py-12 animate-fade-in select-none relative overflow-hidden">
      {/* Background soft glowing orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-accent-500/10 dark:bg-accent-500/5 blur-[80px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-60 h-60 rounded-full bg-purple-500/10 dark:bg-purple-500/5 blur-[90px] pointer-events-none" />

      {/* Brand Logo */}
      <div className="relative group mb-6">
        <div className="absolute inset-0 bg-gradient-to-tr from-accent-600 to-indigo-500 rounded-3xl blur-md opacity-40 group-hover:opacity-75 transition-opacity duration-500" />
        <div className="relative w-16 h-16 rounded-3xl bg-gradient-to-tr from-accent-600 via-accent-500 to-indigo-600
                        flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-300">
          <Sparkles size={28} className="text-white fill-white/10 animate-pulse" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-surface-800 dark:text-slate-100 tracking-tight mb-2">
        Welcome to <span className="bg-gradient-to-r from-accent-600 via-accent-500 to-indigo-500 bg-clip-text text-transparent">Scribe</span>
      </h2>
      
      <p className="text-sm text-surface-500 dark:text-slate-400 max-w-sm leading-relaxed mb-8">
        Your ultimate AI research companion. Upload documents and query them to generate cited, RAG-backed insights instantly.
      </p>

      <button onClick={onCreate} className="btn-primary px-7 py-3 rounded-2xl gap-2 font-bold shadow-glow-accent scale-100 active:scale-[0.98] transition-all">
        <Sparkles size={16} />
        Start a new conversation
      </button>

      {/* Feature cards */}
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
        {[
          { 
            icon: <FileText size={18} className="text-blue-500 dark:text-blue-400" />, 
            title: 'Knowledge RAG', 
            desc: 'Upload PDFs, Word docs, TXT or Markdown files.' 
          },
          { 
            icon: <Bookmark size={18} className="text-emerald-500 dark:text-emerald-400" />, 
            title: 'Smart Citations', 
            desc: 'Exact references with page number overlays.' 
          },
          { 
            icon: <Share2 size={18} className="text-violet-500 dark:text-violet-400" />, 
            title: 'Premium Export', 
            desc: 'Save as beautiful PDF, Word, or Markdown files.' 
          },
        ].map((f) => (
          <div 
            key={f.title}
            className="group/card flex flex-col items-center justify-center p-4 
                       bg-white/60 dark:bg-slate-900/40 backdrop-blur-md 
                       border border-surface-200/80 dark:border-slate-800/30 rounded-2xl 
                       shadow-sm hover:shadow-md hover:border-accent-300/50 dark:hover:border-accent-500/30
                       hover:-translate-y-0.5 transition-all duration-300"
          >
            <div className="w-10 h-10 rounded-xl bg-surface-50 dark:bg-slate-800/50 flex items-center justify-center mb-3 
                            group-hover/card:scale-110 transition-transform duration-300">
              {f.icon}
            </div>
            <h4 className="text-xs font-bold text-surface-700 dark:text-slate-200 mb-1">{f.title}</h4>
            <p className="text-[10px] text-surface-400 dark:text-slate-500 leading-normal">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center
                    px-6 py-12 animate-fade-in select-none relative overflow-hidden">
      <div className="w-12 h-12 rounded-2xl bg-surface-50 dark:bg-slate-900/40 border border-surface-200/50 dark:border-slate-800/30 flex items-center justify-center mb-4 shadow-sm">
        <Sparkles size={20} className="text-accent-500 animate-pulse animate-duration-1000" />
      </div>
      <h3 className="text-sm font-bold text-surface-700 dark:text-slate-200 mb-1">Your workspace is ready</h3>
      <p className="text-xs text-surface-400 dark:text-slate-500 max-w-xs leading-relaxed">
        Send a message to get started, or upload a document to enable advanced semantic search and citations.
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
        className="flex-1 overflow-y-auto px-4 md:px-6 py-6"
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
      className="flex-1 overflow-y-auto px-4 md:px-6 py-6"
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
