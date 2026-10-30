// Kingdom territories: a per-year colour texture draped over the terrain.
//
// Each texel takes the colour of the polity that holds its "nearest" city, where distance is
// weighted by city importance (capitals reach further). Shading fades out beyond ~120 km from
// any city and above ~1500 m, so deserts and mountains stay unclaimed. Borders between
// polities are drawn as darker lines. The nearest-city lookup is precomputed once; a year
// change only re-colours the texels (a few ms) and re-uploads the texture.
import * as THREE from 'three';
import { project, unproject } from './projection.js';

const TIER_WEIGHT = { 1: 1.0, 2: 1.4, 3: 1.8 }; // weighted distance = km × weight
const REACH_KM = 120;
const FADE_FROM_KM = 70;
const FILL_ALPHA = 0.5;
const BORDER_ALPHA = 0.85;
const DIM = { other: 0.35, zagros: 0.6 }; // uncertain / loose polities shaded more faintly

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Fill colour: the polity colour, a little richer so it reads over the tan desert relief.
const hexRgb = (hex) => {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l * 0.9);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
};

export class Territories {
  /**
   * @param terrain Terrain (provides hf + uniforms)
   * @param cities  array of city records (lat/lon/tier)
   * @param polities polities.json
   * @param ownerAt (city, year) -> polity id
   */
  constructor(terrain, cities, polities, ownerAt, width = 1024) {
    this.terrain = terrain;
    this.cities = cities;
    this.ownerAt = ownerAt;
    this.polityById = new Map(polities.map((p) => [p.id, p]));
    const hf = terrain.hf;
    this.W = width;
    this.H = Math.round((width * (hf.z1 - hf.z0)) / (hf.x1 - hf.x0));
    this.kmPerPx = (hf.x1 - hf.x0) / this.W;
    this.data = new Uint8Array(this.W * this.H * 4);
    this.texture = new THREE.DataTexture(this.data, this.W, this.H, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    terrain.uniforms.uTerr.value = this.texture;
    this.precompute();
    this.year = null;
    this.centroids = [];
  }

  /** Nearest weighted city + base alpha per texel. Done once. */
  precompute() {
    const { W, H, terrain } = this;
    const hf = terrain.hf;
    const n = this.cities.length;
    const cx = new Float32Array(n), cz = new Float32Array(n), cw = new Float32Array(n);
    this.cities.forEach((c, i) => {
      const p = project(c.lon, c.lat);
      cx[i] = p.x;
      cz[i] = p.z;
      cw[i] = TIER_WEIGHT[c.tier] || 1.8;
    });
    this.nearest = new Int16Array(W * H).fill(-1);
    this.alpha = new Float32Array(W * H);
    const reach2 = (REACH_KM * 1.8) ** 2;
    for (let j = 0; j < H; j++) {
      const z = hf.z0 + ((j + 0.5) / H) * (hf.z1 - hf.z0);
      for (let i = 0; i < W; i++) {
        const x = hf.x0 + ((i + 0.5) / W) * (hf.x1 - hf.x0);
        let best = -1, bestW = Infinity, bestD2 = 0;
        for (let k = 0; k < n; k++) {
          const dx = x - cx[k], dz = z - cz[k];
          const d2 = dx * dx + dz * dz;
          if (d2 > reach2) continue;
          const w = d2 * cw[k] * cw[k];
          if (w < bestW) { bestW = w; best = k; bestD2 = d2; }
        }
        const o = j * W + i;
        if (best < 0) continue;
        const d = Math.sqrt(bestD2);
        const elev = hf.sample(x, z);
        const a = (1 - smooth(FADE_FROM_KM, REACH_KM, d)) * (1 - smooth(0.9, 1.5, elev)) * (elev < -0.002 ? 0 : 1);
        if (a <= 0.01) continue;
        this.nearest[o] = best;
        this.alpha[o] = a;
      }
    }
  }

  /** Re-colour for a year. Returns per-polity label anchors. */
  setYear(year) {
    if (year === this.year) return this.centroids;
    this.year = year;
    const { W, H, data, nearest, alpha } = this;
    const n = this.cities.length;
    const pol = new Array(n), rgb = new Array(n), dim = new Float32Array(n);
    const polIndex = new Map();
    const polIds = [];
    const owner = new Int16Array(n);
    for (let k = 0; k < n; k++) {
      const id = this.ownerAt(this.cities[k], year);
      const p = this.polityById.get(id);
      pol[k] = id;
      rgb[k] = hexRgb(p?.color || '#9e9e9e');
      dim[k] = DIM[id] ?? 1;
      if (!polIndex.has(id)) { polIndex.set(id, polIds.length); polIds.push(id); }
      owner[k] = polIndex.get(id);
    }
    const sums = polIds.map(() => ({ x: 0, z: 0, w: 0 }));
    const step = 4;
    const differs = (m, po) => {
      const km = nearest[m];
      return km >= 0 && owner[km] !== po && alpha[m] > 0.15;
    };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const o = j * W + i;
        const k = nearest[o];
        const q = o * 4;
        if (k < 0) { data[q + 3] = 0; continue; }
        const a = alpha[o];
        const po = owner[k];
        // border: a neighbour (right/down/left/up) belongs to another polity
        const border =
          a > 0.15 &&
          ((i + 1 < W && differs(o + 1, po)) || (j + 1 < H && differs(o + W, po)) || (i > 0 && differs(o - 1, po)) || (j > 0 && differs(o - W, po)));
        const c = rgb[k];
        if (border) {
          data[q] = c[0] * 0.35; data[q + 1] = c[1] * 0.3; data[q + 2] = c[2] * 0.3;
          data[q + 3] = 255 * BORDER_ALPHA * Math.min(1, a * 1.6) * Math.max(dim[k], 0.6);
        } else {
          data[q] = c[0]; data[q + 1] = c[1]; data[q + 2] = c[2];
          data[q + 3] = 255 * FILL_ALPHA * a * dim[k];
        }
        if (i % step === 0 && j % step === 0 && a > 0.3) {
          const s = sums[po];
          s.x += i * a; s.z += j * a; s.w += a;
        }
      }
    }
    this.texture.needsUpdate = true;

    // label anchors: the claimed texel nearest the area-weighted centroid
    const hf = this.terrain.hf;
    const pxArea = this.kmPerPx * this.kmPerPx * step * step;
    this.centroids = polIds.map((id, pi) => {
      const s = sums[pi];
      if (s.w < 1) return null;
      const ci = s.x / s.w, cj = s.z / s.w;
      let best = null, bd = Infinity;
      for (let j = 0; j < H; j += step) {
        for (let i = 0; i < W; i += step) {
          const o = j * W + i;
          const k = nearest[o];
          if (k < 0 || owner[k] !== pi || alpha[o] < 0.6) continue;
          const d = (i - ci) ** 2 + (j - cj) ** 2;
          if (d < bd) { bd = d; best = [i, j]; }
        }
      }
      if (!best) return null;
      const x = hf.x0 + ((best[0] + 0.5) / W) * (hf.x1 - hf.x0);
      const z = hf.z0 + ((best[1] + 0.5) / H) * (hf.z1 - hf.z0);
      return { id, x, z, areaKm2: s.w * pxArea, ...unproject(x, z) };
    }).filter(Boolean);
    return this.centroids;
  }

  setVisible(on) {
    this.terrain.uniforms.uTerrOn.value = on ? 1 : 0;
  }
}
