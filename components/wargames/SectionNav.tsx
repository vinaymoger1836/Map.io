'use client';

/**
 * The console's three rooms.
 *
 * The old panel was one long scroll holding everything at once, which meant the
 * colour picker sat above the thing you were actually doing and the systems
 * catalogue was buried under the deploy controls. These are three different
 * jobs — arranging the board, describing equipment, and counting what a nation
 * owns — and they deserve three places rather than three scroll positions.
 */

export type Section = 'map' | 'armaments' | 'forces';

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'map', label: 'Map', hint: 'Paint nations, deploy units, and set what the map draws' },
  { id: 'armaments', label: 'Armaments', hint: 'What every system is — specifications, sources, and your own' },
  { id: 'forces', label: 'Forces', hint: 'What each nation has on the board' },
];

export function SectionNav({
  section,
  onChange,
  counts,
}: {
  section: Section;
  onChange: (s: Section) => void;
  /** A badge per section, so the nav carries a little state of its own. */
  counts: Record<Section, number | undefined>;
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
    </nav>
  );
}
