/** WGS84 geodetic/ECEF/local east-north-up. Distances and altitude are metres. */
export type Vec3 = [number, number, number];
export type Geo = [number, number, number]; // longitude degrees, latitude degrees, ellipsoid altitude
const A = 6378137;
const E2 = 6.69437999014e-3;
const RAD = Math.PI / 180;
export function ecef([lon, lat, h]: Geo): Vec3 {
  const p = lat * RAD, l = lon * RAD, n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * Math.sin(p)];
}
export function geodetic([x, y, z]: Vec3): Geo {
  const r = Math.hypot(x, y);
  let p = Math.atan2(z, r * (1 - E2));
  for (let i = 0; i < 12; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
    p = Math.atan2(z + E2 * n * Math.sin(p), r);
  }
  const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  const h = r * Math.cos(p) + z * Math.sin(p) - n * (1 - E2 * Math.sin(p) ** 2);
  return [Math.atan2(y, x) / RAD, p / RAD, h];
}
function basis(origin: Geo): Vec3[] {
  const l = origin[0] * RAD, p = origin[1] * RAD;
  return [[-Math.sin(l), Math.cos(l), 0], [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]];
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
export const sub = (a: Vec3, b: Vec3): Vec3 => add(a, scale(b, -1));
export const dot = (a: Vec3, b: Vec3) => a.reduce((sum, n, i) => sum + n * b[i], 0);
export const length = (a: Vec3) => Math.hypot(...a);
export const unit = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
export function toENU(point: Geo, origin: Geo): Vec3 {
  const d = sub(ecef(point), ecef(origin));
  return basis(origin).map(b => dot(b, d)) as Vec3;
}
export function fromENU(point: Vec3, origin: Geo): Geo {
  const b = basis(origin);
  return geodetic(add(ecef(origin), add(add(scale(b[0], point[0]), scale(b[1], point[1])), scale(b[2], point[2]))));
}
/** Earliest contact over a step, accounting for both bodies moving. */
export function sweptSphere(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3, radius: number): number | null {
  const p = sub(a0, b0), v = sub(sub(a1, a0), sub(b1, b0));
  const c = dot(p, p) - radius * radius;
  if (c <= 0) return 0;
  const a = dot(v, v), b = 2 * dot(p, v), discriminant = b * b - 4 * a * c;
  if (a < 1e-12 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
