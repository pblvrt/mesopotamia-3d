// Large, faint "map" labels drawn below the city labels: kingdom names, geographic regions,
// the two great rivers, and the modern orientation layer (grey modern cities, borders and
// country names). Labels are sized in kilometres, so they grow and shrink with zoom, and are
// decluttered by priority each time the view changes.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { project } from './projection.js';

// ------------------------------------------------------------------ definitions
// kind: 'region' (cultural), 'physical', 'river', 'country', 'modern' (pins)
// sizeKm: cap height in km; axis: two [lat, lon] points the label is aligned with.
export const REGIONS = [
  { text: 'SUMER', at: [31.5, 45.95], sizeKm: 22, kind: 'region', sub: 'the old south' },
  { text: 'AKKAD', at: [32.82, 44.95], sizeKm: 22, kind: 'region', sub: 'the northern plain' },
  { text: 'ASSYRIA', at: [35.95, 42.75], sizeKm: 20, kind: 'region', sub: 'Subartu · Upper Mesopotamia' },
  { text: 'ELAM', at: [32.55, 49.35], sizeKm: 22, kind: 'region', sub: 'Susa & the Iranian highlands', dupOf: 'elam' },
  { text: 'JAZIRA', at: [35.45, 41.45], sizeKm: 19, kind: 'physical', sub: 'steppe between the rivers' },
  { text: 'SYRIAN DESERT', at: [32.95, 39.9], sizeKm: 24, kind: 'physical' },
  { text: 'ZAGROS MOUNTAINS', axis: [[35.35, 46.15], [32.95, 48.55]], sizeKm: 22, kind: 'physical' },
  { text: 'TAURUS MOUNTAINS', axis: [[38.25, 39.4], [37.85, 42.6]], sizeKm: 19, kind: 'physical' },
  { text: 'PERSIAN GULF', at: [29.25, 49.35], sizeKm: 22, kind: 'physical', sub: 'the “Lower Sea”', water: true },
];

// River labels follow the river course near an anchor point.
export const RIVER_LABELS = [
  { text: 'EUPHRATES', river: /^Euphrates \(/, near: [34.45, 41.75] },
  { text: 'EUPHRATES', river: /^Euphrates \(/, near: [36.35, 38.45] },
  { text: 'TIGRIS', river: /^Tigris \(/, near: [34.35, 43.85] },
  { text: 'TIGRIS', river: /^Tigris \(/, near: [32.45, 45.9] },
];

export const MODERN_CITIES = [
  { name: 'Baghdad', at: [33.315, 44.366] },
  { name: 'Basra', at: [30.508, 47.783] },
  { name: 'Mosul', at: [36.34, 43.13] },
  { name: 'Kirkuk', at: [35.468, 44.392] },
  { name: 'Erbil', at: [36.191, 44.009] },
  { name: 'Kuwait City', at: [29.376, 47.977] },
  { name: 'Ahvaz', at: [31.318, 48.671] },
  { name: 'Deir ez-Zor', at: [35.336, 40.141] },
  { name: 'Raqqa', at: [35.952, 39.012] },
  { name: 'Nasiriyah', at: [31.052, 46.257] },
];

export const COUNTRIES = [
  { text: 'IRAQ', at: [33.85, 42.55] },
  { text: 'SYRIA', at: [34.75, 38.35] },
  { text: 'TURKEY', at: [37.55, 38.4] },
  { text: 'IRAN', at: [34.6, 49.4] },
  { text: 'KUWAIT', at: [29.05, 47.35] },
  { text: 'SAUDI ARABIA', at: [29.35, 43.3] },
];

// Short display names / rulers for kingdom labels.
const POLITY_LABEL = {
  babylon: { name: 'BABYLON', ruler: () => 'Hammurabi' },
  larsa: { name: 'LARSA', ruler: () => 'Rim-Sin' },
  eshnunna: { name: 'ESHNUNNA', ruler: (y) => (y < -1779 ? 'Dadusha' : 'Ibal-pi-El II') },
  mari: { name: 'MARI', ruler: () => 'Zimri-Lim' },
  upper_mesopotamia: { name: 'UPPER MESOPOTAMIA', ruler: (y) => (y < -1776 ? 'Shamshi-Adad' : 'Ishme-Dagan') },
  elam: { name: 'ELAM', ruler: () => 'the sukkalmah of Susa' },
  malgium: { name: 'MALGIUM', ruler: () => '', small: true },
  der: { name: 'DER', ruler: () => '', small: true },
  apum: { name: 'APUM', ruler: () => '', small: true },
  yamhad: { name: 'YAMHAD', ruler: () => 'Aleppo' },
};

const PRIORITY = { polity: 6, river: 5, physical: 4, region: 3, country: 2, modern: 1 };
const DEFAULTS = {
  polity: { minPx: 13, maxPx: 30, cw: 0.92 },
  region: { minPx: 12, maxPx: 26, cw: 0.98 },
  physical: { minPx: 12, maxPx: 24, cw: 0.98 },
  river: { minPx: 13, maxPx: 22, cw: 0.92, sizeKm: 15 },
  country: { minPx: 11, maxPx: 18, cw: 1.0, sizeKm: 13 },
  modern: { fixedPx: 11, cw: 0.62 },
};

const ll = ([lat, lon]) => project(lon, lat);

export class AreaLabels {
  constructor(terrain, data, scene, polities) {
    this.terrain = terrain;
    this.scene = scene; // main 3D scene (for border lines)
    this.root = new THREE.Scene(); // rendered by a separate CSS2DRenderer below city labels
    this.items = [];
    this.polityById = new Map(polities.map((p) => [p.id, p]));
    this.groups = { region: true, polity: true, modern: true };
    this.visiblePolities = new Set();

    for (const r of REGIONS) this.addItem({ ...r, group: 'region' });
    for (const r of RIVER_LABELS) {
      const a = this.riverAnchor(data.rivers, r);
      if (a) this.addItem({ text: r.text, kind: 'river', group: 'region', axis: a });
    }
    for (const c of COUNTRIES) this.addItem({ ...c, kind: 'country', group: 'modern' });
    for (const c of MODERN_CITIES) this.addItem({ text: c.name, at: c.at, kind: 'modern', group: 'modern' });
    this.polityItems = [];

    this.buildBorders(data.modernBorders);
    this.refreshHeights();
  }

  /** Find the river point nearest an anchor and the local direction of the course. */
  riverAnchor(rivers, r) {
    const p0 = ll(r.near);
    let best = null;
    for (const f of rivers?.features || []) {
      if (!r.river.test(f.properties?.name || '') || f.properties?.kind !== 'river') continue;
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of lines) {
        const pts = line.map(([lon, lat]) => project(lon, lat));
        pts.forEach((p, i) => {
          const d = Math.hypot(p.x - p0.x, p.z - p0.z);
          if (!best || d < best.d) best = { d, pts, i };
        });
      }
    }
    if (!best || best.d > 60) return null;
    // direction over ~±40 km of course
    const { pts, i } = best;
    let a = i, b = i;
    const len = (u, v) => Math.hypot(pts[u].x - pts[v].x, pts[u].z - pts[v].z);
    while (a > 0 && len(a, i) < 40) a--;
    while (b < pts.length - 1 && len(b, i) < 40) b++;
    return { center: pts[i], from: pts[a], to: pts[b] };
  }

  addItem(def) {
    const d = { ...DEFAULTS[def.kind], ...def };
    const el = document.createElement('div');
    el.className = `area-label al-${d.kind}${d.water ? ' al-water' : ''}`;
    if (d.kind === 'modern') el.innerHTML = '<i></i><span></span>';
    else el.innerHTML = '<div class="t"><b></b>' + (d.sub ? '<small></small>' : '') + '</div>';
    el.querySelector(d.kind === 'modern' ? 'span' : 'b').textContent = d.text;
    if (d.sub) el.querySelector('small').textContent = d.sub;
    const obj = new CSS2DObject(el);
    if (d.kind === 'modern') obj.center.set(0, 0.5);
    this.root.add(obj);
    let center, from, to;
    if (d.axis && d.axis.center) ({ center, from, to } = d.axis);
    else if (d.axis) {
      from = ll(d.axis[0]);
      to = ll(d.axis[1]);
      center = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    } else center = ll(d.at);
    const item = { ...d, el, obj, center, from, to, inner: el.firstElementChild, font: 0, tkey: '', shown: true };
    this.items.push(item);
    return item;
  }

  buildBorders(geo) {
    this.borderMat = new LineMaterial({
      color: 0x5d5850, linewidth: 1.6, transparent: true, opacity: 0.7, dashed: true, dashSize: 3, gapSize: 2, depthWrite: false,
    });
    this.borderMat.resolution.set(window.innerWidth, window.innerHeight);
    this.borderGroup = new THREE.Group();
    this.borderLines = [];
    for (const f of geo?.features || []) {
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        // densify to ~2 km so the line hugs the terrain
        const pts = [];
        line.forEach(([lon, lat], i) => {
          const p = project(lon, lat);
          if (i) {
            const q = pts[pts.length - 1];
            const n = Math.floor(Math.hypot(p.x - q.x, p.z - q.z) / 2);
            for (let k = 1; k < n; k++) pts.push({ x: q.x + ((p.x - q.x) * k) / n, z: q.z + ((p.z - q.z) * k) / n });
          }
          pts.push(p);
        });
        const l = new Line2(new LineGeometry(), this.borderMat);
        l.userData.pts = pts;
        l.renderOrder = 6;
        l.frustumCulled = false;
        this.borderGroup.add(l);
        this.borderLines.push(l);
      }
    }
    this.scene.add(this.borderGroup);
  }

  /** Kingdom name labels at territory anchors for the current year. */
  setPolities(anchors, year) {
    for (const it of this.polityItems) {
      this.root.remove(it.obj);
      this.items.splice(this.items.indexOf(it), 1);
    }
    this.polityItems = [];
    this.visiblePolities = new Set();
    for (const a of anchors) {
      const meta = POLITY_LABEL[a.id];
      if (!meta || a.areaKm2 < 1500) continue;
      const p = this.polityById.get(a.id);
      const sizeKm = Math.min(30, Math.max(14, Math.sqrt(a.areaKm2) * 0.1)) * (meta.small ? 0.75 : 1);
      const it = this.addItem({ text: meta.name, sub: meta.ruler(year), at: [a.lat, a.lon], sizeKm, kind: 'polity', group: 'polity' });
      it.el.style.setProperty('--pc', p?.color || '#555');
      it.polity = a.id;
      this.polityItems.push(it);
      this.visiblePolities.add(a.id);
    }
    this.refreshHeights();
  }

  setGroupVisible(group, on) {
    this.groups[group] = on;
    if (group === 'modern') this.borderGroup.visible = on;
  }

  refreshHeights() {
    const t = this.terrain;
    for (const it of this.items) {
      const y = it.water ? 0.02 : t.surfaceY(it.center.x, it.center.z) + 0.3;
      it.obj.position.set(it.center.x, y, it.center.z);
      if (it.from) {
        it.p0 = new THREE.Vector3(it.from.x, t.surfaceY(it.from.x, it.from.z), it.from.z);
        it.p1 = new THREE.Vector3(it.to.x, t.surfaceY(it.to.x, it.to.z), it.to.z);
      }
    }
    const lift = 0.05 + 0.004 * t.exaggeration;
    for (const l of this.borderLines) {
      const arr = [];
      for (const p of l.userData.pts) arr.push(p.x, t.surfaceY(p.x, p.z) + lift, p.z);
      l.geometry.setPositions(arr);
      l.computeLineDistances();
    }
  }

  setResolution(w, h) {
    this.borderMat.resolution.set(w, h);
  }

  /**
   * Size + declutter. `obstacles` are screen rects of city labels already placed.
   * Kingdom/region labels may sit under city labels; modern labels avoid them.
   */
  update(camera, dist, w, h, obstacles = []) {
    this.borderMat.dashSize = Math.max(0.3, dist * 0.008);
    this.borderMat.gapSize = this.borderMat.dashSize * 0.8;
    const tanF = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    const placed = [];
    const cityRects = obstacles;
    const order = this.items.slice().sort((p, q) => PRIORITY[q.kind] - PRIORITY[p.kind] || (q.sizeKm || 0) - (p.sizeKm || 0));
    for (const it of order) {
      let vis = this.groups[it.group] !== false;
      if (vis && it.dupOf && this.groups.polity && this.visiblePolities.has(it.dupOf)) vis = false;
      let font = it.fixedPx || 0, angle = 0;
      if (vis) {
        v.copy(it.obj.position).project(camera);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) vis = false;
      }
      if (vis && !it.fixedPx) {
        const d = camera.position.distanceTo(it.obj.position);
        const kmPerPx = (2 * d * tanF) / h;
        const raw = it.sizeKm / kmPerPx;
        if (raw < it.minPx * 0.55 || raw > it.maxPx * 3.5) vis = false;
        font = Math.min(it.maxPx, Math.max(it.minPx, raw));
      }
      if (vis && it.p0) {
        a.copy(it.p0).project(camera);
        b.copy(it.p1).project(camera);
        angle = Math.atan2(-(b.y - a.y) * h, (b.x - a.x) * w);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
      }
      let off = null;
      if (vis) {
        const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
        const tw = it.text.length * font * it.cw + 8;
        const th = font * (it.sub ? 1.9 : 1.25);
        const c = Math.abs(Math.cos(angle)), sn = Math.abs(Math.sin(angle));
        const bw = it.kind === 'modern' ? tw + 12 : tw * c + th * sn;
        const bh = it.kind === 'modern' ? th : tw * sn + th * c;
        const avoidCities = it.kind !== 'region' && it.kind !== 'physical';
        // try the anchor first, then nudge kingdom/river labels off city labels
        const cands = it.kind === 'modern' || it.kind === 'country' || it.kind === 'physical'
          ? [[0, 0]]
          : [[0, 0], [0, bh * 0.9], [0, -bh * 0.9], [bw * 0.55, 0], [-bw * 0.55, 0], [0, bh * 1.7], [0, -bh * 1.7]];
        for (const [dx, dy] of cands) {
          const cx = sx + dx, cy = sy + dy;
          const r = it.kind === 'modern'
            ? { x0: cx - 4, x1: cx + bw, y0: cy - bh / 2, y1: cy + bh / 2 }
            : { x0: cx - bw / 2, x1: cx + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2 };
          const hit = (q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
          if (placed.some(hit) || (avoidCities && cityRects.some(hit))) continue;
          placed.push(r);
          off = [dx, dy];
          break;
        }
        if (!off) vis = false;
      }
      if (vis !== it.shown) {
        it.obj.visible = vis;
        it.shown = vis;
      }
      if (!vis) continue;
      if (Math.abs(font - it.font) > 0.4) {
        it.font = font;
        it.el.style.fontSize = `${font.toFixed(1)}px`;
      }
      const key = `${off[0].toFixed(0)},${off[1].toFixed(0)},${angle.toFixed(2)}`;
      if (key !== it.tkey) {
        it.tkey = key;
        it.inner.style.transform = `translate(${off[0].toFixed(0)}px, ${off[1].toFixed(0)}px)` + (angle ? ` rotate(${angle.toFixed(3)}rad)` : '');
      }
    }
  }
}
