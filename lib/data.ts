import type { FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';

/**
 * Country geometry comes from world-atlas (Natural Earth, TopoJSON). It is
 * fetched rather than bundled so the app stays small; swap COUNTRIES_URL for a
 * local copy in public/data if you need the map to work offline.
 */
export const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

export type FC = FeatureCollection<Geometry, Record<string, unknown>>;

const EMPTY: FC = { type: 'FeatureCollection', features: [] };

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

async function getLocal(name: string): Promise<FC> {
  try {
    return await getJSON<FC>(`/data/${name}.geojson`);
  } catch (err) {
    console.error(`Layer "${name}" failed to load.`, err);
    return EMPTY;
  }
}

export interface MapData {
  countries: FC;
  control: FC;
  frontline: FC;
  hotspots: FC;
  bordersSpecial: FC;
  energyLines: FC;
  energyPoints: FC;
  military: FC;
  arcticIce: FC;
  arcticRoutes: FC;
  arcticEez: FC;
  arcticPorts: FC;
  places: FC;
  waters: FC;
  /** True when country geometry could not be fetched — blocs and outlines are then empty. */
  countriesFailed: boolean;
}

async function loadCountries(): Promise<{ fc: FC; failed: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo: any = await getJSON(COUNTRIES_URL);
    const fc = feature(topo, topo.objects.countries) as unknown as FC;
    // Lift the TopoJSON id into properties so MapLibre filters can reach it.
    for (const f of fc.features) {
      f.properties = { ...(f.properties ?? {}), iso: String(f.id ?? '') };
    }
    return { fc, failed: false };
  } catch (err) {
    console.error('Country geometry failed to load — bloc and border layers will be empty.', err);
    return { fc: EMPTY, failed: true };
  }
}

export async function loadMapData(): Promise<MapData> {
  const [
    countries,
    control,
    frontline,
    hotspots,
    bordersSpecial,
    energyLines,
    energyPoints,
    military,
    arcticIce,
    arcticRoutes,
    arcticEez,
    arcticPorts,
    places,
    waters,
  ] = await Promise.all([
    loadCountries(),
    getLocal('control'),
    getLocal('frontline'),
    getLocal('hotspots'),
    getLocal('borders-special'),
    getLocal('energy-lines'),
    getLocal('energy-points'),
    getLocal('military'),
    getLocal('arctic-ice'),
    getLocal('arctic-routes'),
    getLocal('arctic-eez'),
    getLocal('arctic-ports'),
    getLocal('places'),
    getLocal('waters'),
  ]);

  return {
    countries: countries.fc,
    countriesFailed: countries.failed,
    control,
    frontline,
    hotspots,
    bordersSpecial,
    energyLines,
    energyPoints,
    military,
    arcticIce,
    arcticRoutes,
    arcticEez,
    arcticPorts,
    places,
    waters,
  };
}
