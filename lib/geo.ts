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

/* ------------------------------------------------------------------ */
/* Multi-Waypoint Flight Route Geometry & Radar Avoidance Engine      */
/* ------------------------------------------------------------------ */

/** Total cumulative distance along a multi-waypoint route in kilometres. */
export function routeTotalDistanceKm(points: [number, number][]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += distanceKm(points[i], points[i + 1]);
  }
  return sum;
}

/** Distance of each individual leg along a multi-waypoint route. */
export function routeSegmentDistancesKm(points: [number, number][]): number[] {
  if (points.length < 2) return [];
  const dists: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    dists.push(distanceKm(points[i], points[i + 1]));
  }
  return dists;
}

/** Interpolates coordinate and heading at a specific cumulative distance along a multi-leg route. */
export function interpolateRouteDistance(
  points: [number, number][],
  distanceAlongKm: number
): { coord: [number, number]; heading: number; legIndex: number } {
  if (points.length < 2) {
    return { coord: points[0] || [0, 0], heading: 0, legIndex: 0 };
  }
  if (distanceAlongKm <= 0) {
    const heading = bearingDeg(points[0], points[1]);
    return { coord: points[0], heading, legIndex: 0 };
  }

  let accumulated = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const legDist = distanceKm(points[i], points[i + 1]);
    if (distanceAlongKm <= accumulated + legDist || i === points.length - 2) {
      const legRemaining = Math.max(0, distanceAlongKm - accumulated);
      const frac = legDist > 0 ? Math.min(1, legRemaining / legDist) : 0;
      const coord = interpolate(points[i], points[i + 1], frac);
      const heading = bearingDeg(points[i], points[i + 1]);
      return { coord, heading, legIndex: i };
    }
    accumulated += legDist;
  }

  const lastIdx = points.length - 1;
  const heading = bearingDeg(points[lastIdx - 1], points[lastIdx]);
  return { coord: points[lastIdx], heading, legIndex: lastIdx - 1 };
}

/**
 * Splits a multi-waypoint route at a specific cumulative distance along the path into
 * two sub-routes: `before` (ingress up to split) and `after` (continuation from split).
 */
export function splitRouteAtDistance(
  points: [number, number][],
  splitDistanceKm: number
): { before: [number, number][]; after: [number, number][] } {
  if (points.length < 2) {
    return { before: points, after: points };
  }
  const total = routeTotalDistanceKm(points);
  if (splitDistanceKm <= 0) {
    return { before: [points[0]], after: points };
  }
  if (splitDistanceKm >= total) {
    return { before: points, after: [points[points.length - 1]] };
  }

  const { coord, legIndex } = interpolateRouteDistance(points, splitDistanceKm);
  const before: [number, number][] = [...points.slice(0, legIndex + 1), coord];
  const after: [number, number][] = [coord, ...points.slice(legIndex + 1)];

  return { before, after };
}

/**
 * High-resolution great-circle polyline passing through all multi-waypoint legs,
 * preserving accurate curvature across high-latitude map projections.
 */
export function multiLegGreatCirclePath(
  points: [number, number][],
  stepsPerLeg = 24
): [number, number][] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];

  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = greatCirclePath(points[i], points[i + 1], stepsPerLeg);
    if (i > 0) leg.shift(); // Avoid duplicating the shared waypoint vertex
    out.push(...leg);
  }
  return out;
}

/**
 * Determines whether a multi-waypoint route enters a radar/SAM engagement zone of `radiusKm` around `at`.
 * Returns cumulative entryKm and exitKm along the entire multi-leg flight path.
 */
export function routeCrossing(
  points: [number, number][],
  at: [number, number],
  radiusKm: number
): { entryKm: number; exitKm: number; legIndex: number } | null {
  if (points.length < 2 || radiusKm <= 0) return null;
  const totalKm = routeTotalDistanceKm(points);
  if (totalKm <= 0) return null;

  let accumulated = 0;
  let firstEntryKm: number | null = null;
  let lastExitKm: number | null = null;
  let entryLegIndex = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const legDist = distanceKm(points[i], points[i + 1]);
    if (legDist > 0) {
      const legCross = crossing(points[i], points[i + 1], at, radiusKm, legDist);
      if (legCross) {
        const legEntry = accumulated + legCross.entryKm;
        const legExit = accumulated + legCross.exitKm;
        if (firstEntryKm === null) {
          firstEntryKm = legEntry;
          entryLegIndex = i;
        }
        lastExitKm = legExit;
      }
    }
    accumulated += legDist;
  }

  if (firstEntryKm === null) return null;
  return { entryKm: firstEntryKm, exitKm: lastExitKm ?? totalKm, legIndex: entryLegIndex };
}

/**
 * Automated Radar Avoidance Dogleg Generator:
 * Evaluates the direct great-circle flight path against hostile radar/SAM threat zones.
 * If threat zones block the corridor, calculates optimal lateral standoff dogleg waypoints
 * (port or starboard) around the radar envelopes to penetrate via clean air corridors.
 */
export function calculateRadarAvoidanceDogleg(
  from: [number, number],
  to: [number, number],
  threatZones: { at: [number, number]; radiusKm: number }[]
): [number, number][] {
  const directDist = distanceKm(from, to);
  if (directDist < 50 || threatZones.length === 0) return [];

  // 1. Identify which threat zones intersect the direct straight line
  const directCrossingThreats: { at: [number, number]; radiusKm: number; entryKm: number; exitKm: number }[] = [];
  for (const zone of threatZones) {
    const c = crossing(from, to, zone.at, zone.radiusKm, directDist);
    if (c) {
      directCrossingThreats.push({ ...zone, entryKm: c.entryKm, exitKm: c.exitKm });
    }
  }

  if (directCrossingThreats.length === 0) {
    return []; // Direct line is already 100% clear of radar threats!
  }

  // 2. Sort threat zones by entry along flight corridor
  directCrossingThreats.sort((a, b) => a.entryKm - b.entryKm);

  // 3. For each cluster of overlapping threat zones, generate an avoidance waypoint
  const waypoints: [number, number][] = [];
  const baseBearing = bearingDeg(from, to);

  for (const threat of directCrossingThreats) {
    const threatDistFromOrigin = (threat.entryKm + threat.exitKm) / 2;
    const centerPointOnCorridor = interpolate(from, to, threatDistFromOrigin / directDist);

    // Calculate left (port: -90°) and right (starboard: +90°) lateral bypass coordinates
    const safetyBufferKm = threat.radiusKm + 25; // 25 km safety margin outside SAM envelope
    const portWaypoint = destination(centerPointOnCorridor, safetyBufferKm, (baseBearing - 90 + 360) % 360);
    const starWaypoint = destination(centerPointOnCorridor, safetyBufferKm, (baseBearing + 90) % 360);

    // Score port vs starboard: count secondary threat intersections and route detour length
    let portViolations = 0;
    let starViolations = 0;

    for (const other of threatZones) {
      if (distanceKm(portWaypoint, other.at) < other.radiusKm) portViolations++;
      if (distanceKm(starWaypoint, other.at) < other.radiusKm) starViolations++;
    }

    const chosen = portViolations <= starViolations ? portWaypoint : starWaypoint;

    // Avoid duplicate waypoints in close proximity
    if (waypoints.length === 0 || distanceKm(waypoints[waypoints.length - 1], chosen) > 80) {
      waypoints.push(chosen);
    }
  }

  return waypoints;
}

