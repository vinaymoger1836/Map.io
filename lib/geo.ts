/**
 * Distances and circles on a round earth.
 *
 * A 400 km ring is not a circle on the map. Web Mercator stretches east–west
 * with latitude, so a fixed-pixel circle drawn around an S-400 at 68°N would
 * claim a reach it does not have, and the error grows as you move north. These
 * helpers work in ground distance and hand MapLibre a polygon in real
 * coordinates — which is also why the ring behaves correctly when you zoom:
 * it is geography, not decoration.
 */

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The point `distanceKm` away from `origin` along `bearingDeg`. */
export function destination(
  origin: [number, number],
  distanceKmValue: number,
  bearingDeg: number
): [number, number] {
  const angular = distanceKmValue / EARTH_RADIUS_KM;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin[1]);
  const lon1 = toRad(origin[0]);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [toDeg(lon2), toDeg(lat2)];
}

/**
 * The point a given fraction of the way along the great circle from `a` to `b`.
 *
 * Not a linear blend of the coordinates: interpolating lon/lat directly gives a
 * straight line on Web Mercator, which at high latitude is a different path
 * from the one an aircraft flies and — more to the point here — a different
 * path from the one the geodesic rings were drawn against. A raid assessed on
 * the wrong line crosses the wrong belts.
 *
 * Longitudes come back unwrapped relative to `a`, for the same reason
 * `geodesicRing` unwraps: a path over the Bering Strait must run 179, 180, 181
 * rather than falling off the end of the world.
 */
export function interpolate(
  a: [number, number],
  b: [number, number],
  fraction: number
): [number, number] {
  const [lon1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lon2, lat2] = [toRad(b[0]), toRad(b[1])];

  const angular = distanceKm(a, b) / EARTH_RADIUS_KM;
  // Coincident points have no bearing between them; anything else divides by ~0.
  if (angular < 1e-12) return [a[0], a[1]];

  const sinAngular = Math.sin(angular);
  const scaleA = Math.sin((1 - fraction) * angular) / sinAngular;
  const scaleB = Math.sin(fraction * angular) / sinAngular;

  const x = scaleA * Math.cos(lat1) * Math.cos(lon1) + scaleB * Math.cos(lat2) * Math.cos(lon2);
  const y = scaleA * Math.cos(lat1) * Math.sin(lon1) + scaleB * Math.cos(lat2) * Math.sin(lon2);
  const z = scaleA * Math.sin(lat1) + scaleB * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  let lon = toDeg(Math.atan2(y, x));
  while (lon - a[0] > 180) lon -= 360;
  while (a[0] - lon > 180) lon += 360;
  return [lon, toDeg(lat)];
}

/**
 * A great-circle path as a polyline, for drawing and for walking.
 *
 * `steps` sets the resolution, and the caller picks it from how much accuracy
 * the answer deserves: a line on the map needs enough to look like a curve, and
 * a raid being walked through a defence needs enough that a 40 km battery is not
 * stepped straight over.
 */
export function greatCirclePath(
  a: [number, number],
  b: [number, number],
  steps: number
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) out.push(interpolate(a, b, i / steps));
  return out;
}

/**
 * A circle of constant ground distance, as a GeoJSON polygon ring.
 *
 * Longitudes are unwrapped rather than normalised into ±180: a ring around
 * Kamchatka must run 178, 179, 180, 181 and not fall off the end of the world
 * halfway round. MapLibre is content with coordinates past the antimeridian and
 * draws them where they belong.
 */
export function geodesicRing(
  center: [number, number],
  radiusKm: number,
  steps = 72
): [number, number][] {
  const ring: [number, number][] = [];
  let previousLon = center[0];

  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 360) / steps;
    const [lon, lat] = destination(center, radiusKm, bearing);
    let unwrapped = lon;
    while (unwrapped - previousLon > 180) unwrapped -= 360;
    while (previousLon - unwrapped > 180) unwrapped += 360;
    previousLon = unwrapped;
    ring.push([unwrapped, lat]);
  }

  // Close the ring exactly, so the polygon is valid rather than nearly valid.
  ring[ring.length - 1] = [ring[0][0], ring[0][1]];
  return ring;
}

export function geodesicCircle(center: [number, number], radiusKm: number, steps = 72) {
  return {
    type: 'Polygon' as const,
    coordinates: [geodesicRing(center, radiusKm, steps)],
  };
}

/** Initial bearing from point `a` to point `b` in degrees (0–360). */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lon2, lat2] = [toRad(b[0]), toRad(b[1])];
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/**
 * Determines whether the great-circle path from `from` to `to` enters a circle of `radiusKm` around `at`.
 * Returns the entry and exit distance along the flight path in kilometres from `from`.
 */
export function crossing(
  from: [number, number],
  to: [number, number],
  at: [number, number],
  radiusKm: number,
  totalKm: number
): { entryKm: number; exitKm: number } | null {
  if (totalKm <= 0 || radiusKm <= 0) return null;
  const steps = Math.min(1_000, Math.max(48, Math.ceil(totalKm / 5)));
  let entry: number | null = null;
  let exit: number | null = null;

  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    const inside = distanceKm(interpolate(from, to, fraction), at) <= radiusKm;
    if (inside && entry === null) entry = fraction * totalKm;
    if (!inside && entry !== null) {
      exit = fraction * totalKm;
      break;
    }
  }

  if (entry === null) return null;
  return { entryKm: entry, exitKm: exit ?? totalKm };
}

