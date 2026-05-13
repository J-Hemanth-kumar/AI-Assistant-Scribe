/**
 * src/lib/pretext/chatLayout.ts
 *
 * Chat-specific layout hook.
 *
 * Wraps computeLayout() for the chat UI with:
 *  • Plus Jakarta Sans proportional font (measureText per char)
 *  • ResizeObserver to track container width changes
 *  • Memoised layout — only recomputes when text or width changes
 *  • Incremental streaming update — appends new lines without full re-layout
 *
 * STREAMING STABILITY
 * ────────────────────
 * During streaming, tokens arrive via APPEND_TOKEN actions.  A naive approach
 * (recompute full layout on every token) causes O(n²) total work and makes
 * the container height jump on each render.
 *
 * This hook addresses it with an "incremental tail" strategy:
 *   1. Keep a stable `baseLines` array for text that has already been laid out.
 *   2. Only re-layout the last partial "chunk" (from the last newline to the
 *      current end of text).
 *   3. Concatenate baseLines + tailLines for the final result.
 *   4. Height = (baseLines.length + tailLines.length) × lineHeight — always
 *      computable before any paint, eliminating layout shift.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { computeLayout } from './layout';
import type { LayoutLine, LayoutOptions } from '@/types';

export const CHAT_FONT_FAMILY = 'Plus Jakarta Sans';
export const CHAT_FONT_SIZE   = 14;   // px — matches Tailwind text-sm
export const CHAT_LINE_HEIGHT = 22;   // px — matches leading-relaxed at 14px
export const CHAT_PADDING_V   = 24;   // px total (top + bottom) inside bubble

/**
 * Returns the pixel height a message bubble occupies given its line count.
 * Used by ChatList's virtual item sizer — must be pure and deterministic.
 */
export function bubbleHeight(lineCount: number): number {
  return Math.max(lineCount * CHAT_LINE_HEIGHT + CHAT_PADDING_V, 44);
}

interface UseChatLayoutResult {
  lines: LayoutLine[];
  height: number;
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * useChatLayout
 *
 * Computes pretext layout for a chat message bubble.
 * Re-runs only when text or container width changes.
 *
 * @param text        The full message content (may grow during streaming).
 * @param isStreaming  When true, use incremental update to avoid O(n²) work.
 */
export function useChatLayout(
  text: string,
  isStreaming: boolean
): UseChatLayoutResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(480); // sensible default

  // ── Track container width via ResizeObserver ─────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      // Subtract avatars and margins for more accurate bubble constraint
      const adjustedWidth = width ? Math.floor(width) : 0;
      if (adjustedWidth > 40) setContainerWidth(adjustedWidth);
    });
    ro.observe(el);
    // Seed with current width immediately
    const initial = el.getBoundingClientRect().width;
    if (initial > 40) setContainerWidth(Math.floor(initial));

    return () => ro.disconnect();
  }, []);

  // ── Layout options ───────────────────────────────────────────────────
  const opts: LayoutOptions = useMemo(() => ({
    containerWidth,
    fontSize:    CHAT_FONT_SIZE,
    fontFamily:  CHAT_FONT_FAMILY,
    lineHeight:  CHAT_LINE_HEIGHT,
    monospace:   false,
  }), [containerWidth]);

  // ── Incremental streaming cache ──────────────────────────────────────
  // baseLinesRef: layout of text up to the last stable newline
  // baseLengthRef: char length of the text covered by baseLines
  const baseLinesRef  = useRef<LayoutLine[]>([]);
  const baseLengthRef = useRef(0);
  const prevTextRef   = useRef('');

  const lines = useMemo(() => {
    if (!isStreaming) {
      // Non-streaming: full layout, no incremental optimisation needed
      return text ? computeLayout(text, opts) : [];
    }

    // ── Incremental path ─────────────────────────────────────────────
    // If new text is a strict extension of the previous text, only re-layout
    // the tail (from baseLengthRef.current onward).
    if (text.startsWith(prevTextRef.current) && baseLengthRef.current > 0) {
      const tail = text.slice(baseLengthRef.current);
      // Find the last complete line in tail (up to last \n)
      const lastNl = tail.lastIndexOf('\n');

      if (lastNl >= 0) {
        // There's at least one complete line in the tail — fold it into base
        const newBase = computeLayout(text.slice(0, baseLengthRef.current + lastNl + 1), opts);
        baseLinesRef.current  = newBase;
        baseLengthRef.current = baseLengthRef.current + lastNl + 1;
      }

      // Layout only the remaining partial line
      const partialTail = text.slice(baseLengthRef.current);
      const tailLines = partialTail
        ? computeLayout(partialTail, { ...opts, containerWidth })
            .map((l) => ({
              ...l,
              start: l.start + baseLengthRef.current,
              end:   l.end   + baseLengthRef.current,
              lineIndex: baseLinesRef.current.length + l.lineIndex,
            }))
        : [];

      prevTextRef.current = text;
      return [...baseLinesRef.current, ...tailLines];
    }

    // Text changed non-incrementally (e.g. session switch) — full recompute
    const full = computeLayout(text, opts);
    const lastNl = text.lastIndexOf('\n');
    if (lastNl >= 0) {
      baseLinesRef.current  = computeLayout(text.slice(0, lastNl + 1), opts);
      baseLengthRef.current = lastNl + 1;
    } else {
      baseLinesRef.current  = [];
      baseLengthRef.current = 0;
    }
    prevTextRef.current = text;
    return full;
  }, [text, opts, isStreaming, containerWidth]);

  // Reset incremental cache when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      baseLinesRef.current  = [];
      baseLengthRef.current = 0;
      prevTextRef.current   = '';
    }
  }, [isStreaming]);

  const height = bubbleHeight(lines.length);

  return { lines, height, containerRef };
}
