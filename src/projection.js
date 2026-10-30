// Projection defined in CONTRACT.md. World units are kilometres.
export const LON0 = 44.0;
export const LAT0 = 33.0;
export const KX = 111.32 * Math.cos((33 * Math.PI) / 180); // km per degree longitude
export const KZ = 110.574; // km per degree latitude
export const BBOX = { west: 37.5, east: 50.5, south: 28.5, north: 38.5 };

export function project(lon, lat) {
  return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KZ };
}

export function unproject(x, z) {
  return { lon: x / KX + LON0, lat: LAT0 - z / KZ };
}

/** Great-circle distance in km between two {lon,lat}. */
export function haversineKm(a, b) {
  const R = 6371.0088;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** World-space extent of a bbox. */
export function bboxWorld(b = BBOX) {
  const nw = project(b.west, b.north);
  const se = project(b.east, b.south);
  return { x0: nw.x, x1: se.x, z0: nw.z, z1: se.z };
}

/**
 * Convert a footprint object ({type:"rect"|"ellipse"|"polygon", ...}) to a ring of
 * local km points [[x(east), y(north)], ...]. rotationDeg rotates counter-clockwise
 * (i.e. positive = turns east-west axis towards north).
 * Falls back to a circle of the given area (ha) if the footprint is missing.
 */
export function footprintRing(fp, areaHa) {
  let pts = [];
  if (fp && fp.type === 'polygon' && Array.isArray(fp.pointsKm) && fp.pointsKm.length >= 3) {
    pts = fp.pointsKm.map((p) => [p[0], p[1]]);
  } else if (fp && fp.type === 'rect' && fp.widthKm && fp.heightKm) {
    const w = fp.widthKm / 2, h = fp.heightKm / 2;
    pts = [[-w, -h], [w, -h], [w, h], [-w, h]];
  } else if (fp && fp.type === 'ellipse' && fp.widthKm && fp.heightKm) {
    const n = 64;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push([(Math.cos(t) * fp.widthKm) / 2, (Math.sin(t) * fp.heightKm) / 2]);
    }
  } else {
    const r = areaHa ? Math.sqrt((areaHa / 100) / Math.PI) : 0.4;
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
  }
  const rot = fp && fp.rotationDeg && fp.type !== 'polygon' ? (fp.rotationDeg * Math.PI) / 180 : 0;
  if (rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    pts = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  }
  return pts;
}

/** Polygon area of a ring in km². */
export function ringAreaKm2(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function ringExtentKm(ring) {
  let m = 0;
  for (const [x, y] of ring) m = Math.max(m, Math.hypot(x, y));
  return m;
}
