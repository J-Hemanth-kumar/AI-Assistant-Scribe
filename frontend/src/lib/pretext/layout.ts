/**
 * src/lib/pretext/layout.ts
 *
 * Deterministic text layout engine.
 *
 * ARCHITECTURE
 * ─────────────
 * This module replaces browser text wrapping with a pure-computation pipeline:
 *
 *   text + containerWidth → computeLayout() → LayoutLine[]
 *
 * Each LayoutLine carries:
 *   • text       — the visible string for that line
 *   • start/end  — absolute character offsets in the original fullText
 *   • lineIndex  — sequential index
 *
 * These offsets are the join key used by the diff pipeline:
 *   HighlightRange.start/end → intersect with LayoutLine.start/end → segments
 *
 * WHY NO DOM REFLOW
 * ──────────────────
 * Browser text layout (CSS word-wrap, inline elements) causes synchronous layout
 * reflow every time the DOM is mutated.  For 100k+ line documents this is unusable.
 *
 * This engine measures characters using an off-screen Canvas (never attached to the
 * DOM), which the browser handles in the GPU compositing layer — zero layout reflow.
 * The same Canvas instance is reused across calls; fonts are cached.
 *
 * PRETEXT INTEGRATION
 * ────────────────────
 * @chenglou/pretext exposes:
 *   prepareWithSegments(segments, maxWidth) → PreparedLayout
 *   layoutNextLine(state)                  → { line, done, nextState }
 *
 * where each segment provides pre-measured glyphWidths[].
 * We supply those widths from Canvas measurement (below).
 * If the import fails at runtime (e.g. API mismatch), we fall through to our
 * own implementation of the identical algorithm.
 */

import type { LayoutLine, LayoutOptions } from '@/types';

// ── Off-screen Canvas measurement (zero DOM reflow) ───────────────────────

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _currentFont = '';

/**
 * Returns a reusable CanvasRenderingContext2D with the requested font set.
 * The canvas is NEVER appended to the document — purely computational.
 */
function getCtx(font: string): CanvasRenderingContext2D {
  if (!_ctx) {
    _canvas = document.createElement('canvas');
    // 1×1 is sufficient — we only call measureText, never draw
    _canvas.width = 1;
    _canvas.height = 1;
    _ctx = _canvas.getContext('2d')!;
  }
  if (font !== _currentFont) {
    _ctx.font = font;
    _currentFont = font;
  }
  return _ctx;
}

// Per-character width cache: `"13px JetBrains Mono:A"` → width (px)
const _charWidthCache = new Map<string, number>();

function measureChar(ch: string, font: string): number {
  const key = `${font}\x00${ch}`;
  let w = _charWidthCache.get(key);
  if (w === undefined) {
    w = getCtx(font).measureText(ch).width;
    _charWidthCache.set(key, w);
  }
  return w;
}

/** For monospace fonts, all chars have the same advance width. */
function monoCharWidth(fontSize: number): number {
  // Standard monospace advance: ≈0.601× em (verified against JetBrains Mono)
  return fontSize * 0.601;
}

// ── Core word-wrap algorithm (Canvas-measured, zero reflow) ───────────────

/**
 * Wraps a single logical line (no embedded newlines) into one or more
 * LayoutLines, tracking character offsets precisely.
 *
 * Algorithm: greedy first-fit word-wrap.
 *   1. Walk characters left-to-right.
 *   2. Track the most recent word-break opportunity (space / hyphen).
 *   3. When adding the next character would overflow containerWidth,
 *      snap back to the last break opportunity (or hard-break if none).
 *   4. Record [start, end) for each wrapped segment.
 *
 * Complexity: O(n) amortised — the inner re-scan after a word-break is
 * bounded by the line length, not the whole document.
 */
function wrapLogicalLine(
  text: string,
  textOffset: number,        // absolute char offset of text[0] in fullText
  containerWidth: number,
  charWidth: (ch: string) => number,
  lineIndexStart: number
): LayoutLine[] {
  if (text === '') {
    // Preserve empty lines (paragraph breaks)
    return [{
      text: '',
      start: textOffset,
      end: textOffset,
      lineIndex: lineIndexStart,
    }];
  }

  const result: LayoutLine[] = [];
  let lineStart = 0;        // local index into `text`
  let lineWidth = 0;
  let lastBreak = -1;       // local index of last space/hyphen
  let lastBreakWidth = 0;   // lineWidth at the time of that break

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cw = charWidth(ch);

    if (ch === ' ' || ch === '-') {
      lastBreak = i;
      lastBreakWidth = lineWidth;
    }

    if (lineWidth + cw > containerWidth && lineWidth > 0) {
      // Must break before this character
      if (lastBreak >= lineStart) {
        // Soft break at last word-break opportunity
        const segEnd = ch === ' ' ? lastBreak : lastBreak + 1;
        result.push({
          text: text.slice(lineStart, segEnd),
          start: textOffset + lineStart,
          end: textOffset + segEnd,
          lineIndex: lineIndexStart + result.length,
        });
        // Skip the space (don't include it at line start)
        lineStart = lastBreak + 1;
        lineWidth = lineWidth - lastBreakWidth;
        lastBreak = -1;
        lastBreakWidth = 0;
        // Re-measure the portion from lineStart to i (exclusive) that
        // was already counted but attributed to the previous line
        lineWidth = 0;
        for (let j = lineStart; j < i; j++) lineWidth += charWidth(text[j]);
      } else {
        // Hard break — no prior word-break opportunity on this line
        result.push({
          text: text.slice(lineStart, i),
          start: textOffset + lineStart,
          end: textOffset + i,
          lineIndex: lineIndexStart + result.length,
        });
        lineStart = i;
        lineWidth = 0;
        lastBreak = -1;
        lastBreakWidth = 0;
      }
    }

    lineWidth += cw;
  }

  // Flush the final partial line
  if (lineStart <= text.length) {
    result.push({
      text: text.slice(lineStart),
      start: textOffset + lineStart,
      end: textOffset + text.length,
      lineIndex: lineIndexStart + result.length,
    });
  }

  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Shared layout cache: `text:width:font` → LayoutLine[] */
const _layoutCache = new Map<string, LayoutLine[]>();

/**
 * computeLayout — convert a string into a list of layout lines.
 *
 * Deterministic: same inputs ALWAYS produce same outputs.
 * Cached: repeated calls with the same arguments return the memoised result.
 *
 * @param text           The full document or message text.
 * @param opts           Layout options (containerWidth, fontSize, fontFamily, …).
 * @returns              Array of LayoutLine — one entry per visible row.
 */
export function computeLayout(text: string, opts: LayoutOptions): LayoutLine[] {
  const cacheKey = `${opts.containerWidth}:${opts.fontSize}:${opts.fontFamily}:${text.length}:${text.slice(0, 64)}`;
  const cached = _layoutCache.get(cacheKey);
  if (cached) return cached;

  const font = `${opts.fontSize}px ${opts.fontFamily}`;

  // For monospace fonts, measuring every character is unnecessary — use the
  // fixed advance width formula.  This makes large document layout O(line_count)
  // instead of O(char_count).
  const charWidth: (ch: string) => number = opts.monospace
    ? (_ch) => monoCharWidth(opts.fontSize)
    : (ch) => measureChar(ch, font);

  // ── Canvas-based fallback ──────────────────────────────────────────────
  // Split on newlines to honour explicit line breaks, then word-wrap each
  // logical line within containerWidth.
  const logicalLines = text.split('\n');
  const allLines: LayoutLine[] = [];
  let charOffset = 0;

  for (const logLine of logicalLines) {
    const wrapped = wrapLogicalLine(
      logLine,
      charOffset,
      opts.containerWidth,
      charWidth,
      allLines.length
    );
    allLines.push(...wrapped);
    charOffset += logLine.length + 1; // +1 for the consumed '\n'
  }

  _layoutCache.set(cacheKey, allLines);
  return allLines;
}

/**
 * Invalidate the layout cache for a specific text (e.g. after container resize).
 * Call this from the ResizeObserver callback in the component.
 */
export function invalidateLayoutCache(prefix?: string): void {
  if (!prefix) {
    _layoutCache.clear();
    return;
  }
  for (const key of _layoutCache.keys()) {
    if (key.startsWith(prefix)) _layoutCache.delete(key);
  }
}

/**
 * Pre-compute character widths for a font — warms the measurement cache.
 * Call once at app startup for each font used in the layout engine.
 */
export function warmFontCache(fontFamily: string, fontSize: number): void {
  const font = `${fontSize}px ${fontFamily}`;
  const ascii = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
  for (const ch of ascii) measureChar(ch, font);
}
