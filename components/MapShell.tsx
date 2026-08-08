'use client';

import dynamic from 'next/dynamic';

/**
 * MapLibre reaches for `window` on import, so the map is loaded only in the
 * browser. Everything below this line is client-side.
 */
const EurasiaMap = dynamic(() => import('./EurasiaMap'), {
  ssr: false,
  loading: () => (
    <div className="shell">
      <div className="map-stage">
        <div className="map-boot">Loading map</div>
      </div>
      <div className="rail" />
    </div>
  ),
});

export default function MapShell() {
  return <EurasiaMap />;
}
