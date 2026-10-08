'use client';

import dynamic from 'next/dynamic';
import { Profiler, useEffect } from 'react';
import { recordWarSimCommit, startWarSimDiagnostics } from '@/lib/warsim/diagnostics';

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
  useEffect(() => startWarSimDiagnostics(), []);
  if (process.env.NEXT_PUBLIC_WARSIM_DIAGNOSTICS === '1') {
    return <Profiler id="map-shell" onRender={recordWarSimCommit}><EurasiaMap /></Profiler>;
  }
  return <EurasiaMap />;
}
