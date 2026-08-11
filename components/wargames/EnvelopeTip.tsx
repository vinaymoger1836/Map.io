'use client';

/**
 * What the ring under the pointer is.
 *
 * A board with coverage on is a stack of concentric circles, and the honest
 * problem with it is that a circle says how far but never what for. Two rings
 * 240 km and 1,600 km around the same destroyer are its air defence and its
 * land attack, and until you can ask, the second just looks like an error.
 */

import type { EnvelopeHover } from '@/lib/warLayers';

/** Kept clear of the pointer so the tooltip never covers the ring it describes. */
const OFFSET = 14;
/** Roughly the widest the card gets; used only to decide which side to sit on. */
const WIDTH = 230;

export function EnvelopeTip({ hover, width }: { hover: EnvelopeHover; width: number }) {
  const [x, y] = hover.point;
  // Near the right edge the card would run off the canvas, so it changes sides.
  const flip = x + OFFSET + WIDTH > width;

  return (
    <div
      className="wg-tip"
      style={{
        left: flip ? undefined : x + OFFSET,
        right: flip ? Math.max(width - x + OFFSET, 0) : undefined,
        top: y + OFFSET,
        borderLeftColor: hover.color,
      }}
      role="tooltip"
    >
      <div className="wg-tip-unit">{hover.unitName}</div>
      <div className="wg-tip-head">
        <span className="wg-tip-kind">{hover.weapon || hover.kindLabel}</span>
        <span className="wg-tip-range">{hover.radiusKm.toLocaleString()} km</span>
      </div>
      {hover.weapon && <div className="wg-tip-sub">{hover.kindLabel}</div>}
      {hover.targetText && <div className="wg-tip-vs">vs {hover.targetText}</div>}
      {hover.horizonCut && (
        <div className="wg-tip-cut">
          cut from {hover.nominalKm.toLocaleString()} km by the earth’s curve
        </div>
      )}
    </div>
  );
}
