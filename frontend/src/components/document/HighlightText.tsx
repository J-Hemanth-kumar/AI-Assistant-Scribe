/**
 * src/components/document/HighlightText.tsx
 *
 * Renders a HighlightSegment[] array inline within a single document row.
 *
 * Highlight colours match standard diff conventions:
 *   added    → green  (bg-emerald-100, text-emerald-800)
 *   removed  → red    (bg-red-100, text-red-700, line-through)
 *   modified → amber  (bg-amber-100, text-amber-800)
 *   (none)   → transparent (plain document text)
 *
 * ACCESSIBILITY
 * ─────────────
 * Each highlighted span carries:
 *   • aria-label describing the change type
 *   • title with the edit reason (shown as native tooltip on hover)
 *   • role="mark" (ARIA landmark for highlighted/changed text)
 *
 * PERFORMANCE
 * ───────────
 * This component is rendered once per VISIBLE line by VirtualizedDocument.
 * It has no internal state and no effects — React.memo ensures it only
 * re-renders when segments actually change.
 */

import React from 'react';
import type { HighlightSegment } from '@/types';

interface HighlightTextProps {
  segments: HighlightSegment[];
  /** Additional className applied to the outer span wrapper. */
  className?: string;
}

const TYPE_STYLES: Record<NonNullable<HighlightSegment['type']>, string> = {
  added:    'bg-emerald-100 text-emerald-800 rounded px-0.5',
  removed:  'bg-red-100 text-red-700 line-through rounded px-0.5',
  modified: 'bg-amber-100 text-amber-800 rounded px-0.5',
};

const TYPE_ARIA: Record<NonNullable<HighlightSegment['type']>, string> = {
  added:    'added text',
  removed:  'removed text',
  modified: 'modified text',
};

function HighlightTextInner({ segments, className }: HighlightTextProps) {
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (!seg.type) {
          // Plain text — no wrapper overhead
          return <React.Fragment key={i}>{seg.text}</React.Fragment>;
        }

        return (
          <mark
            key={i}
            role="mark"
            className={TYPE_STYLES[seg.type]}
            aria-label={TYPE_ARIA[seg.type]}
            title={seg.reason}
          >
            {seg.text}
          </mark>
        );
      })}
    </span>
  );
}

export const HighlightText = React.memo(HighlightTextInner);

// ── Convenience: render a plain line (no highlights) ─────────────────────

interface PlainLineProps {
  text: string;
  className?: string;
}

export function PlainLine({ text, className }: PlainLineProps) {
  return <span className={className}>{text || '\u00A0' /* non-breaking space for empty lines */}</span>;
}
