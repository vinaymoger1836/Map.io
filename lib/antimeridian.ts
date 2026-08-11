/**
 * Splitting country polygons at the antimeridian.
 *
 * A polygon that crosses 180° is stored as a jump: one vertex at 179.87, the
 * next at -180. Nothing in the coordinates says "and the shape continues" — so
 * a renderer filling that ring has to guess, and it guesses the long way round.
 * Painting Russia then smears its colour across the Atlantic, because the fill
 * takes the 359.9° path back rather than the 0.1° step forward.
 *
 * The fix is to say what was meant. Each crossing ring is unwrapped into one
 * continuous path — longitudes are allowed past ±180 while we work — and then
 * cut into 360°-wide bands, each shifted back into range. Russia becomes a
 * western piece and a small eastern one that happen to touch at the date line,
 * which is what it always was.
 *
 * Three countries in the world-atlas data need it: Russia, Fiji and Antarctica.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

/** A jump this large between neighbours is a date-line crossing, not a coastline. */
const JUMP = 180;
const BAND = 360;

/** Within a whisker of ±180 — a point sitting on the seam itself. */
const onSeam = (lng: number): boolean => Math.abs(Math.abs(lng) - 180) < 1e-6;

/**
 * True when any ring steps more than half the globe between two vertices.
 *
 * An edge running from +180 to -180 is exempt: that is the seam of a shape that
 * legitimately spans the whole width — Antarctica's, after this very function's
 * output has been split — and treating it as a crossing would make splitting
 * non-idempotent, re-cutting the same coastline on every load.
 */
function crosses(rings: Position[][]): boolean {
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1][0];
      const b = ring[i][0];
      if (Math.abs(b - a) <= JUMP) continue;
      if (onSeam(a) && onSeam(b)) continue;
      return true;
    }
  }
  return false;
}

/**
 * One continuous path, longitudes allowed outside ±180.
 *
 * Walking the ring, a backwards jump of nearly a full turn means the source
 * wrapped; carrying an offset undoes it, so Chukotka sits at 181° rather than
 * at -179° on the far side of the world.
 */
function unwrap(ring: Position[]): Position[] {
  const out: Position[] = [ring[0].slice() as Position];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const delta = ring[i][0] - ring[i - 1][0];
    if (delta > JUMP) offset -= BAND;
    else if (delta < -JUMP) offset += BAND;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

/**
 * Sutherland–Hodgman against one vertical half-plane.
 *
 * A half-plane is convex, which is the condition this algorithm needs; the
 * pieces it leaves along the cut are joined by an edge lying on the cut itself,
 * invisible in a fill.
 */
function clipHalf(ring: Position[], x: number, keepBelow: boolean): Position[] {
  const inside = (p: Position) => (keepBelow ? p[0] <= x : p[0] >= x);
  const cut = (a: Position, b: Position): Position => {
    const t = (x - a[0]) / (b[0] - a[0]);
    return [x, a[1] + t * (b[1] - a[1])];
  };

  const out: Position[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn && bIn) out.push(b);
    else if (aIn && !bIn) out.push(cut(a, b));
    else if (!aIn && bIn) {
      out.push(cut(a, b));
      out.push(b);
    }
  }
  return out;
}

/** The ring within one 360° band, shifted back into ±180. A ring of fewer than
    three points encloses nothing and is dropped. */
function band(ring: Position[], k: number): Position[] | null {
  const lo = k * BAND - 180;
  const hi = k * BAND + 180;
  let out = clipHalf(ring, hi, true);
  if (out.length < 3) return null;
  out = clipHalf(out, lo, false);
  if (out.length < 3) return null;

  const shifted = out.map(([lng, lat]): Position => [lng - k * BAND, lat]);
  // Close the ring, as GeoJSON requires.
  const [fx, fy] = shifted[0];
  const [lx, ly] = shifted[shifted.length - 1];
  if (fx !== lx || fy !== ly) shifted.push([fx, fy]);
  return shifted;
}

/** Which bands a path touches, given its unwrapped extent. */
function bandsFor(ring: Position[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const [lng] of ring) {
    if (lng < min) min = lng;
    if (lng > max) max = lng;
  }
  const first = Math.floor((min + 180) / BAND);
  const last = Math.floor((max + 180) / BAND);
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(k);
  return out;
}

/** Twice the signed area of a ring, by the shoelace formula. */
function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum;
}

/**
 * Drops rings that enclose nothing.
 *
 * Antarctica arrives with its first ring 257 points long and every one of them
 * at latitude -90: a line, not an outline. GeoJSON says the first ring is the
 * exterior, so the real coastline that follows is read as a *hole* — the
 * continent is a shape with zero area minus itself, and painting it fills a
 * band and nothing else. Removing the degenerate ring promotes the coastline to
 * exterior, which is what it always was. Well-formed polygons are untouched.
 */
function dropDegenerateRings(rings: Position[][]): Position[][] {
  const kept = rings.filter((ring) => ring.length >= 4 && Math.abs(ringArea(ring)) > 1e-9);
  // Same array back when nothing was dropped, so callers can compare by identity
  // and leave untouched geometry alone.
  if (!kept.length || kept.length === rings.length) return rings;
  return kept;
}

/** One polygon in, one or more out — holes following their outer ring. */
function splitPolygon(rings: Position[][]): Position[][][] {
  if (!rings.length) return [];
  const unwrapped = rings.map(unwrap);
  const [outer, ...holes] = unwrapped;

  const out: Position[][][] = [];
  for (const k of bandsFor(outer)) {
    const piece = band(outer, k);
    if (!piece) continue;
    const kept: Position[][] = [piece];
    for (const hole of holes) {
      const clipped = band(hole, k);
      if (clipped) kept.push(clipped);
    }
    out.push(kept);
  }
  return out;
}

/** Clean, then cut if it crosses. Returns the input array when neither applies. */
function repairPolygon(rings: Position[][]): Position[][][] | null {
  const cleaned = dropDegenerateRings(rings);
  if (crosses(cleaned)) return splitPolygon(cleaned);
  return cleaned === rings ? null : [cleaned];
}

function splitGeometry(geometry: Geometry): Geometry {
  if (geometry.type === 'Polygon') {
    const parts = repairPolygon(geometry.coordinates);
    if (!parts) return geometry;
    return parts.length === 1
      ? { type: 'Polygon', coordinates: parts[0] }
      : { type: 'MultiPolygon', coordinates: parts };
  }

  if (geometry.type === 'MultiPolygon') {
    const repaired = geometry.coordinates.map(repairPolygon);
    if (repaired.every((r) => r === null)) return geometry;
    const parts = geometry.coordinates.flatMap((rings, i) => repaired[i] ?? [rings]);
    return { type: 'MultiPolygon', coordinates: parts };
  }

  return geometry;
}

/**
 * Splits every crossing polygon in a collection, leaving the rest untouched by
 * identity so nothing downstream re-renders for the sake of it.
 */
export function splitAntimeridian<T extends FeatureCollection>(fc: T): T {
  let changed = false;
  const features = fc.features.map((f: Feature) => {
    if (!f.geometry) return f;
    const geometry = splitGeometry(f.geometry);
    if (geometry === f.geometry) return f;
    changed = true;
    return { ...f, geometry };
  });
  return changed ? { ...fc, features } : fc;
}
