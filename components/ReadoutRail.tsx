'use client';

import { TIERS, tierForZoom } from '@/lib/theme';

function dms(value: number, positive: string, negative: string) {
  const hemisphere = value >= 0 ? positive : negative;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  return `${String(deg).padStart(2, '0')}°${String(min).padStart(2, '0')}′${hemisphere}`;
}

/**
 * The rail is the map's instrument panel: where the pointer is, how far in you
 * are, and — the part that matters — which tier of detail that zoom is
 * currently showing. It is the only place the zoom-to-detail rule is stated
 * out loud.
 */
export default function ReadoutRail({
  lngLat,
  zoom,
  projection,
  activeLayers,
}: {
  lngLat: [number, number] | null;
  zoom: number;
  projection: 'mercator' | 'globe';
  activeLayers: number;
}) {
  const tier = tierForZoom(zoom);

  return (
    <div className="rail">
      <div className="rail-cell">
        <span className="k">Pos</span>
        <span className="v">{lngLat ? `${dms(lngLat[1], 'N', 'S')} ${dms(lngLat[0], 'E', 'W')}` : '—'}</span>
      </div>

      <div className="rail-cell">
        <span className="k">Zoom</span>
        <span className="v">{zoom.toFixed(2)}</span>
      </div>

      <div className="rail-cell">
        <span className="k">Detail</span>
        <span className="tier-scale" aria-hidden>
          {TIERS.map((t) => (
            <span key={t.rank} className={`tier-pip${t.rank <= tier.rank ? ' lit' : ''}`} />
          ))}
        </span>
        <span className="v">{tier.name}</span>
      </div>

      <div className="rail-cell optional">
        <span className="k">Showing</span>
        <span className="v">{tier.note}</span>
      </div>

      <div className="rail-cell optional">
        <span className="k">Layers</span>
        <span className="v">{activeLayers}</span>
      </div>

      <div className="rail-cell optional">
        <span className="k">Proj</span>
        <span className="v">{projection === 'globe' ? 'Globe' : 'Web Mercator'}</span>
      </div>

      <div className="rail-cell rail-spacer" />

      <div className="rail-attr">
        <span>
          ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          contributors · basemap CARTO / OpenFreeMap · country geometry Natural Earth
        </span>
      </div>
    </div>
  );
}
