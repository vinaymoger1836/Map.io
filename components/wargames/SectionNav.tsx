'use client';

/**
 * The console's rooms.
 *
 * The old panel was one long scroll holding everything at once, which meant the
 * colour picker sat above the thing you were actually doing and the systems
 * catalogue was buried under the deploy controls. These are different jobs —
 * arranging the board, describing equipment, counting what a nation owns, and
 * keeping whole boards — and they deserve their own places rather than four
 * scroll positions.
 *
 * Boards comes last because it is the one you visit at the start and end of a
 * session rather than throughout it.
 */

export type Section = 'map' | 'raid' | 'theater' | 'boards';

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'map', label: 'Map', hint: 'Paint nations, deploy units, and set what the map draws' },
  { id: 'raid', label: 'Raid', hint: 'Fly a single raid and assess air defence response' },
  { id: 'theater', label: 'Theater', hint: 'Coordinate multi-phase theater strikes against defended targets' },
  { id: 'boards', label: 'Boards', hint: 'Save and load scenarios, and carry a board to another machine' },
];

export function SectionNav({
  section,
  onChange,
  counts,
  onOpenConfiguration,
  onOpenWarSim,
}: {
  section: Section;
  onChange: (s: Section) => void;
  /** A badge per section, so the nav carries a little state of its own. */
  counts: Record<Section, number | undefined>;
  onOpenConfiguration?: () => void;
  onOpenWarSim?: () => void;
}) {
  return (
    <nav className="wg-nav" aria-label="Console sections">
      {SECTIONS.map(({ id, label, hint }) => (
        <button
          key={id}
          className={`wg-nav-tab${section === id ? ' on' : ''}`}
          aria-current={section === id ? 'page' : undefined}
          onClick={() => onChange(id)}
          title={hint}
        >
          {label}
          {counts[id] !== undefined && <span className="wg-nav-count">{counts[id]}</span>}
        </button>
      ))}
      {onOpenWarSim && (
        <button
          className="wg-nav-tab"
          style={{ color: '#4FA85F', borderColor: 'rgba(79, 168, 95, 0.4)', fontWeight: 600 }}
          onClick={onOpenWarSim}
          title="Launch Realistic Real-Time War Simulation Staging Deck"
        >
          <span>⚔️ War Sim</span>
        </button>
      )}
      {onOpenConfiguration && (
        <button
          className="wg-nav-tab config-link"
          onClick={onOpenConfiguration}
          title="Open Full-Screen Arsenal & ORBAT Configuration Suite"
        >
          <span>⚙️ Config</span>
        </button>
      )}
    </nav>
  );
}
