/**
 * src/lib/text/buildTextMap.ts
 *
 * Converts ParsedContent[] (backend Module 2 output) into a single flat
 * string plus a lookup table that maps chunk_index → character offsets.
 *
 * WHY A FLAT STRING
 * ─────────────────
 * The layout engine (computeLayout) and the diff pipeline both operate on a
 * single contiguous string.  Treating each chunk as a separate string would
 * require N separate layout computations and make cross-chunk highlight ranges
 * impossible to express.
 *
 * CHUNK SEPARATOR
 * ───────────────
 * Chunks are joined with '\n' so that the layout engine treats each chunk as
 * starting on a new logical line.  The separator character is counted in the
 * offset arithmetic.
 *
 * DETERMINISM GUARANTEE
 * ──────────────────────
 * buildTextMap() is a pure function: same ParsedContent[] → same TextMap.
 * This makes the ChunkMap entries safe to use as stable React keys and safe
 * to memoize indefinitely (they never change for a given document version).
 */

import type { ParsedContent, TextMap, ChunkMapEntry } from '@/types';

const CHUNK_SEPARATOR = '\n';

/**
 * Build a TextMap from a (possibly unsorted) ParsedContent[].
 *
 * Chunks are sorted by chunk_index before concatenation so the layout
 * always reflects the document's logical reading order.
 *
 * @param chunks  Raw ParsedContent[] from GET /api/v1/chunks/{doc_id}
 * @returns       { fullText, chunkMap }
 */
export function buildTextMap(chunks: ParsedContent[]): TextMap {
  if (chunks.length === 0) {
    return { fullText: '', chunkMap: [] };
  }

  // Sort ascending by chunk_index — backend may not guarantee order
  const sorted = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);

  const chunkMap: ChunkMapEntry[] = [];
  const parts: string[] = [];
  let offset = 0;

  for (const chunk of sorted) {
    const start = offset;
    const end   = offset + chunk.text.length;

    chunkMap.push({
      chunk_index: chunk.chunk_index,
      start,
      end,
    });

    parts.push(chunk.text);
    // Account for the separator that joins() will insert
    offset = end + CHUNK_SEPARATOR.length;
  }

  const fullText = parts.join(CHUNK_SEPARATOR);

  return { fullText, chunkMap };
}

/**
 * Fast O(1) lookup: chunk_index → ChunkMapEntry.
 *
 * Builds an index Map from the chunkMap array.  Call once per document
 * and memoize the result — the map never changes for a given document.
 */
export function buildChunkIndex(
  chunkMap: ChunkMapEntry[]
): Map<number, ChunkMapEntry> {
  const index = new Map<number, ChunkMapEntry>();
  for (const entry of chunkMap) {
    index.set(entry.chunk_index, entry);
  }
  return index;
}
