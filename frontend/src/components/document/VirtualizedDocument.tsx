/**
 * src/components/document/VirtualizedDocument.tsx
 *
 * Virtualized document renderer.
 *
 * PIPELINE (exactly as specified):
 *
 *   ParsedContent[]
 *     → buildTextMap()         fullText + chunkMap
 *     → computeLayout()        LayoutLine[]     (Pretext / Canvas, no DOM reflow)
 *     → mapEditsToRanges()     HighlightRange[] (chunk_index lookup, no indexOf)
 *     → applyHighlightsBatch() HighlightSegment[][] (one array per visible line)
 *     → useVirtualizer()       renders only visible rows
 *     → <HighlightText>        inline segment rendering
 *
 * ZERO LAYOUT SHIFT
 * ─────────────────
 * • Container height is set to lines.length × LINE_HEIGHT before any paint.
 * • Each row uses `position: absolute; top: N × LINE_HEIGHT` — no
 *   browser reflow is needed to compute positions.
 * • ResizeObserver fires synchronously before paint to update containerWidth.
 * • @tanstack/react-virtual handles overscan + recycling without touching CSS.
 *
 * EDIT HIGHLIGHTS
 * ───────────────
 * • Version selector (dropdown) lets the user pick which edit version to overlay.
 * • Edits are fetched via TanStack Query (cached per version_id).
 * • Highlighted lines are pre-computed in a useMemo — O(lines + ranges).
 * • Tooltip on hover shows the edit reason from the backend.
 *
 * PERFORMANCE NUMBERS (rough estimates)
 * ───────────────────────────────────────
 * 100k-line document, 60fps monitor:
 *   • Layout compute (first paint): ~120ms (Canvas measure, one-shot)
 *   • Re-render per scroll event:    ~2ms   (only ~30 DOM rows in flight)
 *   • Edit overlay (1000 edits):     ~8ms   (applyHighlightsBatch O(N+L))
 */

import React, {
  useRef,
  useMemo,
  useEffect,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Loader2,
  AlertCircle,
  ChevronDown,
  GitBranch,
  X,
} from 'lucide-react';

import { computeLayout, warmFontCache, invalidateLayoutCache } from '@/lib/pretext/layout';
import { buildTextMap } from '@/lib/text/buildTextMap';
import { mapEditsToRanges } from '@/lib/diff/mapEdits';
import { applyHighlightsBatch } from '@/lib/diff/applyHighlights';
import { HighlightText, PlainLine } from './HighlightText';

import {
  fetchParsedContent,
  fetchEditDiffs,
  fetchDocumentVersions,
} from '@/services/api';
import { useAppContext } from '@/context/AppContext';

import type {
  LayoutLine,
  HighlightRange,
  HighlightSegment,
} from '@/types';

// ── Layout constants ──────────────────────────────────────────────────────

/** Must match the CSS in the row renderer exactly. */
const LINE_HEIGHT   = 20;     // px per row
const FONT_SIZE     = 12;     // px — monospace document text
const FONT_FAMILY   = 'JetBrains Mono';
const OVERSCAN      = 20;     // virtual rows kept alive outside viewport
const H_PADDING     = 48;     // px — left+right padding subtracted from container width
const EMPTY_SEGS: HighlightSegment[] = [];

// Warm the font cache once at module load so the first layout call is fast
if (typeof document !== 'undefined') {
  warmFontCache(FONT_FAMILY, FONT_SIZE);
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface VersionSelectorProps {
  docId: string;
  selectedVersionId: string | undefined;
  onSelect: (versionId: string | undefined) => void;
}

function VersionSelector({ docId, selectedVersionId, onSelect }: VersionSelectorProps) {
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['versions', docId],
    queryFn:  () => fetchDocumentVersions(docId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-surface-400">
        <Loader2 size={10} className="animate-spin" />
        Loading versions…
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <span className="text-[10px] text-surface-400 flex items-center gap-1">
        <GitBranch size={10} />
        No edits yet
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <GitBranch size={11} className="text-surface-400 shrink-0" />
      <div className="relative">
        <select
          value={selectedVersionId ?? ''}
          onChange={(e) => onSelect(e.target.value || undefined)}
          className="appearance-none text-[10px] bg-surface-100 border border-surface-200
                     rounded-lg pl-2 pr-6 py-1 text-surface-700 cursor-pointer
                     focus:outline-none focus:ring-2 focus:ring-accent-500
                     hover:bg-surface-200 transition-colors"
          aria-label="Select edit version to overlay"
        >
          <option value="">No diff overlay</option>
          {versions.map((v) => (
            <option key={v.version_id} value={v.version_id}>
              v{v.version_number} — {v.prompt.slice(0, 32)}{v.prompt.length > 32 ? '…' : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          size={10}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none"
        />
      </div>
      {selectedVersionId && (
        <button
          onClick={() => onSelect(undefined)}
          className="p-0.5 rounded text-surface-400 hover:text-surface-600 hover:bg-surface-100"
          aria-label="Clear diff overlay"
          title="Clear diff overlay"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

// ── Diff legend ────────────────────────────────────────────────────────────

function DiffLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-surface-500">
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />
        Added
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300" />
        Modified
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" />
        Removed
      </span>
    </div>
  );
}

// ── Row renderer ────────────────────────────────────────────────────────────

interface RowProps {
  line: LayoutLine;
  segments: HighlightSegment[];
  top: number;
  lineNumber: number;
}

const DocumentRow = React.memo(function DocumentRow({
  line,
  segments,
  top,
  lineNumber,
}: RowProps) {
  const hasHighlight = segments.some((s) => s.type != null);

  return (
    <div
      style={{
        position:  'absolute',
        top,
        left:      0,
        right:     0,
        height:    LINE_HEIGHT,
        display:   'flex',
        alignItems: 'center',
      }}
      className={`px-6 group ${hasHighlight ? 'bg-opacity-40' : ''}`}
    >
      {/* Line number gutter */}
      <span
        className="select-none text-surface-300 text-right shrink-0 mr-4 font-mono"
        style={{ fontSize: 10, width: 36, lineHeight: `${LINE_HEIGHT}px` }}
        aria-hidden="true"
      >
        {lineNumber + 1}
      </span>

      {/* Text content */}
      <span
        className="font-mono text-surface-700 whitespace-pre overflow-hidden"
        style={{ fontSize: FONT_SIZE, lineHeight: `${LINE_HEIGHT}px` }}
      >
        {hasHighlight ? (
          <HighlightText segments={segments} />
        ) : (
          <PlainLine text={line.text} />
        )}
      </span>
    </div>
  );
});

// ── Main component ──────────────────────────────────────────────────────────

interface VirtualizedDocumentProps {
  docId: string;
}

export function VirtualizedDocument({ docId }: VirtualizedDocumentProps) {
  const { state, dispatch } = useAppContext();
  const selectedVersionId = state.previewVersionId != null ? String(state.previewVersionId) : undefined;

  const containerRef  = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // ── Track container width via ResizeObserver ──────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) {
        const effective = Math.max(w - H_PADDING, 100);
        setContainerWidth(effective);
        // Invalidate cached layout for this document so next render recomputes
        invalidateLayoutCache(docId);
      }
    });
    ro.observe(el);
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) setContainerWidth(Math.max(initial - H_PADDING, 100));
    return () => ro.disconnect();
  }, [docId]);

  // ── Fetch ParsedContent[] ─────────────────────────────────────────────
  const {
    data: parsedChunks = [],
    isLoading: chunksLoading,
    isError: chunksError,
  } = useQuery({
    queryKey:  ['chunks', docId],
    queryFn:   () => fetchParsedContent(docId),
    staleTime: Infinity,    // ParsedContent is immutable for a given doc version
    gcTime:    15 * 60_000,
  });

  // ── Fetch EditDiffs for the selected version ──────────────────────────
  const {
    data: editDiffs = [],
    isLoading: diffsLoading,
  } = useQuery({
    queryKey:  ['diff', selectedVersionId],
    queryFn:   () => fetchEditDiffs(selectedVersionId!),
    enabled:   !!selectedVersionId,
    staleTime: Infinity,
    gcTime:    15 * 60_000,
  });

  // ── Build text map ────────────────────────────────────────────────────
  const { fullText, chunkMap } = useMemo(
    () => buildTextMap(parsedChunks),
    [parsedChunks]
  );

  // ── Compute layout ────────────────────────────────────────────────────
  const lines: LayoutLine[] = useMemo(() => {
    if (!fullText) return [];
    return computeLayout(fullText, {
      containerWidth,
      fontSize:   FONT_SIZE,
      fontFamily: FONT_FAMILY,
      lineHeight: LINE_HEIGHT,
      monospace:  true, // JetBrains Mono — fixed advance width
    });
  }, [fullText, containerWidth]);

  // ── Map edits to character ranges ────────────────────────────────────
  const highlightRanges: HighlightRange[] = useMemo(() => {
    if (editDiffs.length === 0 || chunkMap.length === 0) return [];
    return mapEditsToRanges(editDiffs, chunkMap);
  }, [editDiffs, chunkMap]);

  // ── Pre-compute all segment arrays ───────────────────────────────────
  // applyHighlightsBatch is O(lines + ranges); the result is stable until
  // lines or ranges change.
  const segmentGrid: HighlightSegment[][] = useMemo(() => {
    if (highlightRanges.length === 0) return [];
    return applyHighlightsBatch(lines, highlightRanges);
  }, [lines, highlightRanges]);

  // ── @tanstack/react-virtual ────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count:              lines.length,
    getScrollElement:   () => containerRef.current,
    estimateSize:       () => LINE_HEIGHT,   // exact — no estimation needed
    overscan:           OVERSCAN,
  });

  const totalHeight = lines.length * LINE_HEIGHT;

  // ── Loading / error states ────────────────────────────────────────────
  if (chunksLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
        <Loader2 size={20} className="animate-spin text-accent-400" />
        <p className="text-[10px] text-surface-400">Loading document…</p>
      </div>
    );
  }

  if (chunksError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 py-10 px-4 text-center">
        <AlertCircle size={20} className="text-red-400" />
        <p className="text-xs font-medium text-surface-700">Failed to load document</p>
      </div>
    );
  }

  if (parsedChunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
        <FileText size={22} className="text-surface-300" />
        <p className="text-[10px] text-surface-400">Document is empty</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-100
                      bg-surface-50 shrink-0 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-surface-400 font-mono">
            {lines.length.toLocaleString()} lines
          </span>
          {diffsLoading && (
            <Loader2 size={10} className="animate-spin text-accent-400" />
          )}
        </div>

        <VersionSelector
          docId={docId}
          selectedVersionId={selectedVersionId}
          onSelect={(vId) =>
            dispatch({ type: 'SET_PREVIEW_VERSION', payload: { versionId: vId != null ? Number(vId) : undefined } })
          }
        />

        {selectedVersionId && highlightRanges.length > 0 && (
          <DiffLegend />
        )}
      </div>

      {/* ── Virtual scroll container ──────────────────────────────────── */}
      {/*
        CRITICAL: this container has explicit `overflow-y: auto` and a fixed
        height from its parent.  @tanstack/react-virtual reads the scroll
        position from this element — it must NOT be `overflow: hidden`.

        The inner div height is set to the total document height
        (lines.length × LINE_HEIGHT) before any rows are painted, which
        gives the scrollbar its correct thumb size with zero layout shift.
      */}
      <div
        ref={containerRef}
        style={{ overflowY: 'auto', flex: 1, minHeight: 0, position: 'relative' }}
        aria-label="Document content"
        role="document"
      >
        {/* Total height sentinel — fixes scrollbar size */}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vItem) => {
            const line     = lines[vItem.index];
            const segments = segmentGrid.length > 0
              ? (segmentGrid[vItem.index] ?? EMPTY_SEGS)
              : EMPTY_SEGS;

            return (
              <DocumentRow
                key={vItem.key}
                line={line}
                segments={segments}
                top={vItem.start}
                lineNumber={vItem.index}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
