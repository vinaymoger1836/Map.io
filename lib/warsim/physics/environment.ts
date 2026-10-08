import type { Vec3 } from './coordinates';

/** Immutable input for one reference session. Heights are ellipsoid-relative local ENU metres. */
export interface EnvironmentSnapshot {
  version: 1; id: string; provenance: string; confidence: 'synthetic' | 'surveyed';
  terrain: { westM: number; southM: number; cellM: number; columns: number; rows: number; heightsM: (number | null)[] };
  boundary: { landAtOrAboveM: number };
  weather: { visibilityKm: number; rain: number; seaState: number; windEastMps: number; windNorthMps: number };
}

export function referenceEnvironment(): EnvironmentSnapshot {
  const columns = 11, rows = 11;
  const heightsM = Array.from({ length: columns * rows }, (_, n) => {
    const x = -10000 + n % columns * 2000;
    return x >= 6000 ? 30 : x >= 4000 ? 5 : 0;
  });
  return { version: 1, id: 'glasswater-synthetic-terrain-v1', provenance: 'authored fictional grid, 2 km spacing', confidence: 'synthetic',
    terrain: { westM: -10000, southM: -10000, cellM: 2000, columns, rows, heightsM },
    boundary: { landAtOrAboveM: 5 },
    weather: { visibilityKm: 20, rain: 0, seaState: 0, windEastMps: 0, windNorthMps: 0 } };
}

export function validateEnvironment(env: EnvironmentSnapshot) {
  const t = env.terrain, w = env.weather;
  if (env.version !== 1 || !env.id || !env.provenance || !['synthetic', 'surveyed'].includes(env.confidence)
    || !Number.isSafeInteger(t.columns) || !Number.isSafeInteger(t.rows) || t.columns < 2 || t.rows < 2
    || t.columns * t.rows > 4096 || !Number.isFinite(t.westM) || !Number.isFinite(t.southM)
    || !Number.isFinite(t.cellM) || t.cellM <= 0 || t.cellM > 10000 || t.heightsM.length !== t.columns * t.rows
    || t.heightsM.some(h => h !== null && (!Number.isFinite(h) || h < -11000 || h > 9000))
    || !Number.isFinite(env.boundary?.landAtOrAboveM) || env.boundary.landAtOrAboveM < -100 || env.boundary.landAtOrAboveM > 500
    || !Number.isFinite(w.visibilityKm) || w.visibilityKm < .1 || w.visibilityKm > 100
    || !Number.isFinite(w.rain) || w.rain < 0 || w.rain > 1
    || !Number.isFinite(w.seaState) || w.seaState < 0 || w.seaState > 9
    || !Number.isFinite(w.windEastMps) || !Number.isFinite(w.windNorthMps)
    || Math.hypot(w.windEastMps, w.windNorthMps) > 100) throw new Error('Invalid physical environment snapshot.');
}

export type ElevationSample = { status: 'known'; elevationM: number } | { status: 'unavailable' };
export function sampleElevation(env: EnvironmentSnapshot, eastM: number, northM: number): ElevationSample {
  const t = env.terrain, x = (eastM - t.westM) / t.cellM, y = (northM - t.southM) / t.cellM;
  if (x < 0 || y < 0 || x > t.columns - 1 || y > t.rows - 1) return { status: 'unavailable' };
  const x0 = Math.min(t.columns - 2, Math.floor(x)), y0 = Math.min(t.rows - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0;
  const h00 = t.heightsM[y0 * t.columns + x0], h10 = t.heightsM[y0 * t.columns + x0 + 1];
  const h01 = t.heightsM[(y0 + 1) * t.columns + x0], h11 = t.heightsM[(y0 + 1) * t.columns + x0 + 1];
  if ([h00, h10, h01, h11].some(h => h === null)) return { status: 'unavailable' };
  return { status: 'known', elevationM: h00! * (1 - fx) * (1 - fy) + h10! * fx * (1 - fy)
    + h01! * (1 - fx) * fy + h11! * fx * fy };
}

export type SurfaceSample = { status: 'land' | 'sea'; elevationM: number } | { status: 'unavailable' };
export function sampleSurface(env: EnvironmentSnapshot, eastM: number, northM: number): SurfaceSample {
  const elevation = sampleElevation(env, eastM, northM);
  if (elevation.status === 'unavailable') return elevation;
  return { status: elevation.elevationM >= env.boundary.landAtOrAboveM ? 'land' : 'sea', elevationM: elevation.elevationM };
}

export type SightResult = 'clear' | 'blocked' | 'unavailable';
export function terrainSight(env: EnvironmentSnapshot, source: Vec3, target: Vec3): SightResult {
  const distance = Math.hypot(target[0] - source[0], target[1] - source[1]);
  const samples = Math.max(2, Math.ceil(distance / Math.min(250, env.terrain.cellM / 2)));
  for (let n = 1; n < samples; n++) {
    const f = n / samples, x = source[0] + (target[0] - source[0]) * f, y = source[1] + (target[1] - source[1]) * f;
    const elevation = sampleElevation(env, x, y);
    if (elevation.status === 'unavailable') return 'unavailable';
    if (elevation.elevationM > source[2] + (target[2] - source[2]) * f) return 'blocked';
  }
  return 'clear';
}

export const radarWeatherFactor = (env?: EnvironmentSnapshot) => env
  ? Math.max(.25, Math.min(1, env.weather.visibilityKm / 10)) * (1 - .45 * env.weather.rain) : 1;
export const seaSpeedFactor = (env?: EnvironmentSnapshot) => env ? Math.max(.55, 1 - .05 * env.weather.seaState) : 1;
