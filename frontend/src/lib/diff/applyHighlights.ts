/**
 * src/lib/diff/applyHighlights.ts
 *
 * Splits a single LayoutLine into HighlightSegment[] by intersecting
 * the line's character range [line.start, line.end) with HighlightRange[].
 *
 * ALGORITHM
 * ─────────
 * 1. Filter ranges to those that overlap [line.start, line.end).
 * 2. Clip each range to the line boundaries.
 * 3. Walk the line characters left-to-right, emitting segments whenever
 *    the highlight type changes.
 *
 * This is a single O(k + r) scan where k = line length, r = range count.
 * For a document with N ranges and L lines: O(N + L × r_per_line).
 * In practice r_per_line ≈ 1 for typical diff outputs, making this O(N + L).
 *
 * EXAMPLE
 * ───────
 * line.text  = "Hello world foo"
 * line.start = 100
 * line.end   = 115
 *
 * ranges = [{ start: 106, end: 111, type: 'modified' }]
 *           → "world" is modified
 *
 * result = [
 *   { text: "Hello ", type: undefined },
 *   { text: "world", type: 'modified', reason: '…' },
 *   { text: " foo",  type: undefined },
 * ]
 */

import type { LayoutLine, HighlightRange, HighlightSegment } from '@/types';

/**
 * Apply highlight ranges to a single layout line.
 *
 * @param line    One LayoutLine from computeLayout()
 * @param ranges  All HighlightRange[] for the document (must be sorted by start).
 *                Only the ranges that intersect this line are processed.
 * @returns       HighlightSegment[] covering the full line text.
 */
export function applyHighlights(
  line: LayoutLine,
  ranges: HighlightRange[]
): HighlightSegment[] {
  // Fast path: no ranges or empty line
  if (ranges.length === 0 || line.text === '') {
    return [{ text: line.text }];
  }

  // ── 1. Clip ranges to this line ──────────────────────────────────────
  type ClippedRange = {
    localStart: number; // offset relative to line.start
    localEnd:   number;
    type:       HighlightRange['type'];
    reason?:    string;
  };

  const clipped: ClippedRange[] = [];

  for (const r of ranges) {
    // Skip ranges that don't overlap this line
    if (r.end <= line.start) continue;
    if (r.start >= line.end)  break; // ranges are sorted — no point continuing

    clipped.push({
      localStart: Math.max(r.start, line.start) - line.start,
      localEnd:   Math.min(r.end,   line.end)   - line.start,
      type:       r.type,
      reason:     r.reason,
    });
  }

  if (clipped.length === 0) {
    return [{ text: line.text }];
  }

  // ── 2. Build segments ─────────────────────────────────────────────────
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const cr of clipped) {
    // Normal text before this range
    if (cursor < cr.localStart) {
      segments.push({ text: line.text.slice(cursor, cr.localStart) });
    }

    // Highlighted segment
    if (cr.localStart < cr.localEnd) {
      segments.push({
        text:   line.text.slice(cr.localStart, cr.localEnd),
        type:   cr.type,
        reason: cr.reason,
      });
    }

    cursor = Math.max(cursor, cr.localEnd);
  }

  // Normal text after the last range
  if (cursor < line.text.length) {
    segments.push({ text: line.text.slice(cursor) });
  }

  // Filter out empty segments that can appear when ranges are adjacent
  return segments.filter((s) => s.text.length > 0);
}

/**
 * Batch version: apply highlights to an array of lines.
 * More efficient than calling applyHighlights() per line because it
 * maintains a range cursor that advances monotonically.
 */
export function applyHighlightsBatch(
  lines: LayoutLine[],
  ranges: HighlightRange[]
): HighlightSegment[][] {
  if (ranges.length === 0) {
    return lines.map((l) => [{ text: l.text }]);
  }

  const results: HighlightSegment[][] = new Array(lines.length);
  let ri = 0; // range cursor

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Advance range cursor past ranges that ended before this line
    while (ri < ranges.length && ranges[ri].end <= line.start) ri++;

    // Collect ranges that overlap this line
    const lineRanges: HighlightRange[] = [];
    let rj = ri;
    while (rj < ranges.length && ranges[rj].start < line.end) {
      lineRanges.push(ranges[rj++]);
    }

    results[li] = applyHighlights(line, lineRanges);
  }

  return results;
}
