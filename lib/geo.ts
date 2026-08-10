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
