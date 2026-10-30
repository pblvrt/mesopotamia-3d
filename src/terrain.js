import * as THREE from 'three';
import { BBOX, project } from './projection.js';

// Terrain is fetched at RUNTIME from /terrain/ (public/terrain, owned by the terrain agent).
// If those files are absent we fall back to the procedural fixture in src/fixtures/.
const fixtureUrls = import.meta.glob('./fixtures/height-fixture.png', { eager: true, query: '?url', import: 'default' });
const FIXTURE_PNG = Object.values(fixtureUrls)[0];
const BASE = import.meta.env.BASE_URL + 'terrain/';

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new Error(`${url}: got HTML`);
  return r.json();
}

async function loadImageBitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const blob = await r.blob();
  if (!blob.size || (blob.type && blob.type.includes('html'))) throw new Error(`${url}: not an image`);
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/** Decode a Terrarium PNG into a Float32Array of elevations in KM. */
async function decodeTerrarium(url) {
  const bmp = await loadImageBitmap(url);
  const w = bmp.width, h = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  let min = Infinity, max = -Infinity;
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const e = (px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768) / 1000;
    data[i] = e;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  bmp.close && bmp.close();
  return { w, h, data, min, max };
}

/** Bilinear sampler over an equirectangular heightfield with world-space lookups. */
export class HeightField {
  constructor({ w, h, data, min, max }, bbox, area = true) {
    Object.assign(this, { w, h, data, min, max, bbox, area });
    const nw = project(bbox.west, bbox.north);
    const se = project(bbox.east, bbox.south);
    this.x0 = nw.x; this.x1 = se.x; this.z0 = nw.z; this.z1 = se.z;
  }
  /** Elevation in km at world x,z (clamped to edges). */
  sample(x, z) {
    const { w, h, data } = this;
    let u = ((x - this.x0) / (this.x1 - this.x0)) * (this.area ? w : w - 1) - (this.area ? 0.5 : 0);
    let v = ((z - this.z0) / (this.z1 - this.z0)) * (this.area ? h : h - 1) - (this.area ? 0.5 : 0);
    u = Math.min(Math.max(u, 0), w - 1);
    v = Math.min(Math.max(v, 0), h - 1);
    const i = Math.min(Math.floor(u), w - 2), j = Math.min(Math.floor(v), h - 2);
    const fu = u - i, fv = v - j;
    const a = data[j * w + i], b = data[j * w + i + 1];
    const c = data[(j + 1) * w + i], d = data[(j + 1) * w + i + 1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  }
  contains(x, z) {
    return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1;
  }
}

/** Hypsometric tint used when relief.jpg is unavailable. */
function hypsometricTexture(hf) {
  const W = Math.min(hf.w, 1024), H = Math.round((W * hf.h) / hf.w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const stops = [
    [-0.2, [40, 90, 110]], [0, [196, 186, 140]], [0.05, [205, 192, 146]], [0.3, [190, 170, 120]],
    [0.8, [165, 140, 98]], [1.5, [140, 115, 85]], [2.5, [150, 135, 120]], [3.5, [235, 232, 228]],
  ];
  const col = (e) => {
    if (e <= stops[0][0]) return stops[0][1];
    for (let k = 1; k < stops.length; k++) {
      if (e <= stops[k][0]) {
        const t = (e - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]);
        return stops[k - 1][1].map((v, i) => v + (stops[k][1][i] - v) * t);
      }
    }
    return stops[stops.length - 1][1];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = hf.data[Math.floor((y / H) * hf.h) * hf.w + Math.floor((x / W) * hf.w)];
      const [r, g, b] = col(e);
      const o = (y * W + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Terrain {
  constructor() {
    this.meta = null;
    this.hf = null;
    this.mesh = null;
    this.exaggeration = 15;
    this.isFixture = false;
    this.uniforms = {
      uMask: { value: null },
      uAncient: { value: 1 },
    };
  }

  /** Load metadata + low-res heightfield, build mesh. Returns this. */
  async init(segments, onStatus = () => {}) {
    this.segments = segments;
    onStatus('Reading terrain metadata…');
    try {
      this.meta = await fetchJson(BASE + 'terrain.json');
      const loUrl = BASE + (this.meta.lo?.file || 'height-lo.png');
      onStatus('Loading low-resolution terrain…');
      let raw;
      try {
        raw = await decodeTerrarium(loUrl);
      } catch {
        raw = await decodeTerrarium(BASE + 'height.png');
        this.hiLoaded = true;
      }
      this.hf = new HeightField(raw, this.meta.bbox || BBOX, this.meta.pixelRegistration !== 'point');
    } catch (e) {
      console.warn('[terrain] real terrain unavailable, using FIXTURE heightmap', e);
      this.isFixture = true;
      this.meta = { bbox: BBOX, source: 'Procedural fixture (real terrain files missing)', pixelRegistration: 'area' };
      const raw = await decodeTerrarium(FIXTURE_PNG);
      this.hf = new HeightField(raw, BBOX, true);
      this.hiLoaded = true;
    }
    this.buildMesh();
    this.loadRelief();
    return this;
  }

  buildMesh() {
    const hf = this.hf;
    const width = hf.x1 - hf.x0, depth = hf.z1 - hf.z0;
    const segX = this.segments, segZ = Math.round((this.segments * depth) / width);
    const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate((hf.x0 + hf.x1) / 2, 0, (hf.z0 + hf.z1) / 2);
    this.geometry = geo;
    this.applyHeights();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    mat.map = hypsometricTexture(hf);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uMask = this.uniforms.uMask;
      shader.uniforms.uAncient = this.uniforms.uAncient;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uMask;\nuniform float uAncient;\nvarying vec2 vMask;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 m = texture2D(uMask, uv).rg * uAncient;
          vMask = m;
          // Ancient sea: push terrain below the water surface; marsh: just under marsh water.
          transformed.y = mix(transformed.y, min(transformed.y, -0.003), m.r);
          transformed.y = mix(transformed.y, min(transformed.y, 0.0002), m.g * (1.0 - m.r));`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMask;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.42, 0.25), clamp(vMask.g, 0.0, 1.0) * 0.55);`
        );
    };
    // blank mask until water layer provides one
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
    this.uniforms.uMask.value = blank;

    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.y = this.exaggeration;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'terrain';
    this.mesh.frustumCulled = false;

    // "Diorama" skirt around the map edge so the tile reads as a solid block.
    this.skirt = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ color: 0x6b4f33, side: THREE.DoubleSide })
    );
    this.skirt.frustumCulled = false;
    this.mesh.add(this.skirt);
    this.updateSkirt();
  }

  updateSkirt() {
    if (!this.skirt) return;
    const hf = this.hf;
    const bottom = Math.min(0, hf.min) - 0.4;
    const n = 400;
    const edge = [];
    const push = (x, z) => edge.push([x, z]);
    for (let i = 0; i < n; i++) push(hf.x0 + ((hf.x1 - hf.x0) * i) / n, hf.z0);
    for (let i = 0; i < n; i++) push(hf.x1, hf.z0 + ((hf.z1 - hf.z0) * i) / n);
    for (let i = 0; i < n; i++) push(hf.x1 - ((hf.x1 - hf.x0) * i) / n, hf.z1);
    for (let i = 0; i <= n; i++) push(hf.x0, hf.z1 - ((hf.z1 - hf.z0) * i) / n);
    const pos = new Float32Array(edge.length * 6);
    edge.forEach(([x, z], i) => {
      pos.set([x, Math.max(0, hf.sample(x, z)), z, x, bottom, z], i * 6);
    });
    const idx = [];
    for (let i = 0; i < edge.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = this.skirt.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
  }

  applyHeights() {
    const pos = this.geometry.attributes.position;
    const hf = this.hf;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, hf.sample(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.updateSkirt();
  }

  loadRelief() {
    const url = BASE + (this.meta.relief || 'relief.jpg');
    if (this.isFixture) return;
    loadImageBitmap(url)
      .then((bmp) => {
        const tex = new THREE.Texture(bmp);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false; // ImageBitmap ignores flipY; handled via uv flip below
        tex.repeat.set(1, -1);
        tex.offset.set(0, 1);
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        const old = this.material.map;
        this.material.map = tex;
        this.material.needsUpdate = true;
        old && old.dispose();
      })
      .catch((e) => console.info('[terrain] relief.jpg unavailable, using hypsometric tint', e.message));
  }

  /** Upgrade to the full-resolution heightfield. */
  async upgrade() {
    if (this.hiLoaded) return false;
    const raw = await decodeTerrarium(BASE + 'height.png');
    this.hf = new HeightField(raw, this.meta.bbox || BBOX, this.meta.pixelRegistration !== 'point');
    this.applyHeights();
    this.hiLoaded = true;
    return true;
  }

  setExaggeration(v) {
    this.exaggeration = v;
    if (this.mesh) this.mesh.scale.y = v;
  }

  /** Real elevation in km (clamped to sea level so overlays sit on the water). */
  groundKm(x, z) {
    return Math.max(0, this.hf.sample(x, z));
  }

  /** World Y of the visible surface at x,z. */
  surfaceY(x, z) {
    return this.groundKm(x, z) * this.exaggeration;
  }

  /** Ray-march the heightfield. Returns THREE.Vector3 or null. */
  raycast(ray) {
    const hf = this.hf;
    const ex = this.exaggeration;
    const o = ray.origin, d = ray.direction;
    const top = Math.max(0, hf.max) * ex + 1;
    // start where ray enters the slab below `top`
    let t0 = 0;
    if (o.y > top) {
      if (d.y >= 0) return null;
      t0 = (o.y - top) / -d.y;
    }
    const tMax = t0 + 6000;
    const p = new THREE.Vector3();
    const f = (t) => {
      p.copy(d).multiplyScalar(t).add(o);
      return p.y - Math.max(0, hf.sample(p.x, p.z)) * ex;
    };
    let prevT = t0, prevF = f(t0);
    if (prevF < 0) return null;
    let t = t0;
    while (t < tMax) {
      const step = Math.max(0.05, Math.min(prevF * 0.5, 5));
      t += step;
      const v = f(t);
      if (v <= 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 24; k++) {
          const m = (a + b) / 2;
          if (f(m) > 0) a = m; else b = m;
        }
        f(b);
        if (!hf.contains(p.x, p.z)) return null;
        return p.clone();
      }
      if (p.y < -1) break;
      prevT = t; prevF = v;
    }
    return null;
  }
}
