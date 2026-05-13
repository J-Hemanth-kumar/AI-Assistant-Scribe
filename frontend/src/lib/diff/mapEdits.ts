/**
 * src/lib/diff/mapEdits.ts
 *
 * Converts EditDiff[] (backend Module 4 output) into HighlightRange[]
 * (character offset ranges in fullText).
 *
 * CRITICAL: This module NEVER uses indexOf() or substring matching.
 * ──────────────────────────────────────────────────────────────────
 * String matching would produce incorrect results when:
 *   • The same text appears in multiple chunks
 *   • original_text has been edited by prior versions
 *   • Text contains regex metacharacters
 *
 * Instead, every edit is resolved via chunk_index → ChunkMapEntry lookup,
 * which gives the exact character-offset range deterministically in O(1).
 *
 * EDIT TYPES
 * ──────────
 * The backend provides original_text and updated_text.  We classify each edit:
 *   • original_text === ''  → 'added'   (new content at that chunk position)
 *   • updated_text  === ''  → 'removed' (chunk content deleted)
 *   • otherwise             → 'modified'
 *
 * For 'modified' edits, we highlight the ORIGINAL range in fullText (so the
 * user sees what changed).  The updated_text is shown in the tooltip / reason.
 */

import type { EditDiff, ChunkMapEntry, HighlightRange } from '@/types';
import { buildChunkIndex } from '@/lib/text/buildTextMap';

/**
 * Map EditDiff[] to HighlightRange[] using the chunk offset index.
 *
 * @param edits     EditDiff[] from GET /api/v1/diff/{version_id}
 * @param chunkMap  ChunkMapEntry[] from buildTextMap()
 * @returns         HighlightRange[] sorted by start offset
 */
export function mapEditsToRanges(
  edits: EditDiff[],
  chunkMap: ChunkMapEntry[]
): HighlightRange[] {
  const index = buildChunkIndex(chunkMap);
  const ranges: HighlightRange[] = [];

  for (const edit of edits) {
    const entry = index.get(edit.chunk_index);
    if (!entry) {
      // chunk_index not present in this document version — skip silently
      // (can happen when viewing a diff from a different document revision)
      continue;
    }

    const type: HighlightRange['type'] =
      edit.original_text === '' ? 'added'   :
      edit.updated_text  === '' ? 'removed' :
      'modified';

    ranges.push({
      start:       entry.start,
      end:         entry.end,
      type,
      reason:      edit.reason,
      chunk_index: edit.chunk_index,
    });
  }

  // Sort by start offset so applyHighlights() can do a single linear scan
  ranges.sort((a, b) => a.start - b.start);

  // Merge overlapping or adjacent ranges of the same type to avoid
  // producing duplicate highlight segments for the same characters
  return mergeRanges(ranges);
}

/**
 * Merge overlapping or touching ranges (same type only).
 * Adjacent ranges of different types are kept separate so colours are correct.
 */
function mergeRanges(sorted: HighlightRange[]): HighlightRange[] {
  if (sorted.length === 0) return [];

  const merged: HighlightRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const cur  = sorted[i];
    const prev = merged[merged.length - 1];

    if (cur.start <= prev.end && cur.type === prev.type) {
      // Extend the previous range
      if (cur.end > prev.end) prev.end = cur.end;
      // Combine reasons (separated by '; ')
      if (cur.reason && cur.reason !== prev.reason) {
        prev.reason = prev.reason
          ? `${prev.reason}; ${cur.reason}`
          : cur.reason;
      }
    } else {
      merged.push({ ...cur });
    }
  }

  return merged;
}
