import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { unproject, haversineKm, footprintRing, ringExtentKm, ringAreaKm2 } from './projection.js';
import { buildFootprint } from './cities.js';

export const WALK_KM_PER_DAY = 25;
export const BOAT_DOWN_KM_PER_DAY = 40; // drifting/rowed with the current
export const BOAT_UP_KM_PER_DAY = 12; // hauled/towed against the current

export function fmtKm(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}
export const fmtDays = (d) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d < 10 ? d.toFixed(1) : Math.round(d)} days`);

/** Two-click distance tool. */
export class MeasureTool {
  constructor(terrain, scene, labelRoot, onResult) {
    this.terrain = terrain;
    this.scene = scene;
    this.labelRoot = labelRoot;
    this.onResult = onResult;
    this.points = [];
    this.active = false;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new LineMaterial({ color: 0xffd27a, linewidth: 3, dashed: true, dashSize: 4, gapSize: 2.5, depthTest: false, transparent: true });
    this.mat.resolution.set(window.innerWidth, window.innerHeight);
    this.pins = [];
  }

  setActive(on) {
    this.active = on;
    if (!on) this.clear();
  }

  clear() {
    this.points = [];
    this.group.clear();
    for (const p of this.pins) this.labelRoot.remove(p);
    this.pins = [];
    if (this.midLabel) this.labelRoot.remove(this.midLabel);
    this.midLabel = null;
    this.line = null;
    this.onResult(null);
  }

  addPoint(p, name) {
    if (this.points.length >= 2) this.clear();
    this.points.push({ x: p.x, z: p.z });
    const el = document.createElement('div');
    el.className = 'measure-pin';
    el.textContent = this.points.length === 1 ? 'A' : 'B';
    if (name) el.title = name;
    const pin = new CSS2DObject(el);
    pin.center.set(0.5, 1);
    this.labelRoot.add(pin);
    this.pins.push(pin);
    this.update();
    if (this.points.length === 2) {
      const [a, b] = this.points.map((q) => unproject(q.x, q.z));
      const km = haversineKm(a, b);
      const el2 = document.createElement('div');
      el2.className = 'measure-label';
      el2.innerHTML = `<b>${fmtKm(km)}</b> · ≈ ${fmtDays(km / WALK_KM_PER_DAY)} on foot`;
      this.midLabel = new CSS2DObject(el2);
      this.midLabel.center.set(0.5, 1.3);
      this.labelRoot.add(this.midLabel);
      this.update();
      this.onResult({
        km,
        walkDays: km / WALK_KM_PER_DAY,
        boatDownDays: km / BOAT_DOWN_KM_PER_DAY,
        boatUpDays: km / BOAT_UP_KM_PER_DAY,
      });
    } else this.onResult({ pending: true });
  }

  update() {
    const t = this.terrain;
    this.points.forEach((q, i) => this.pins[i].position.set(q.x, t.surfaceY(q.x, q.z) + 0.1, q.z));
    this.group.clear();
    if (this.points.length === 2) {
      const [a, b] = this.points;
      if (this.midLabel) {
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        this.midLabel.position.set(mx, t.surfaceY(mx, mz) + 0.3, mz);
      }
      const n = 200, arr = [];
      for (let i = 0; i <= n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
        arr.push(x, t.surfaceY(x, z) + 0.15 + 0.004 * t.exaggeration, z);
      }
      const geo = new LineGeometry();
      geo.setPositions(arr);
      this.line = new Line2(geo, this.mat);
      this.line.computeLineDistances();
      this.line.renderOrder = 30;
      this.line.frustumCulled = false;
      this.group.add(this.line);
    }
  }

  updateForCamera(dist, w, h) {
    this.mat.resolution.set(w, h);
    this.mat.dashSize = Math.max(0.05, dist * 0.012);
    this.mat.gapSize = this.mat.dashSize * 0.6;
  }
}

/** Drops a modern reference footprint next to / over a city at true scale. */
export class CompareTool {
  constructor(terrain, scene, labelRoot) {
    this.terrain = terrain;
    this.scene = scene;
    this.labelRoot = labelRoot;
    this.current = null;
  }

  clear() {
    if (!this.current) return;
    this.scene.remove(this.current.fp.group);
    this.current.fp.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.labelRoot.remove(this.current.label);
    this.current = null;
  }

  /** ref: references.json entry; cityItem: {x,z,ring,extent}; mode: 'beside'|'overlay' */
  show(ref, cityItem, mode) {
    this.clear();
    if (!ref || !cityItem) return;
    this.state = { ref, cityItem, mode };
    const ring = footprintRing(ref.footprint, ref.areaHa);
    const ext = ringExtentKm(ring);
    let cx = cityItem.x, cz = cityItem.z;
    if (mode === 'beside') {
      // place to the east, just clear of both shapes
      const maxXcity = Math.max(...cityItem.ring.map((p) => p[0]));
      const minXref = Math.min(...ring.map((p) => p[0]));
      cx = cityItem.x + maxXcity - minXref + Math.max(0.25, 0.15 * Math.max(ext, cityItem.extent));
    }
    const fp = buildFootprint(ring, cx, cz, this.terrain, '#f3d27a', { fillOpacity: 0.22, wallOpacity: 0.55, wallM: 25 });
    // keep reference above the city fill in overlay mode
    fp.group.position.y += 0.03;
    fp.group.renderOrder = 15;
    this.scene.add(fp.group);
    const el = document.createElement('div');
    el.className = 'ref-label';
    const ha = ref.areaHa ?? Math.round(ringAreaKm2(ring) * 100);
    el.textContent = `${ref.name} · ${Math.round(ha).toLocaleString()} ha`;
    const label = new CSS2DObject(el);
    label.position.set(cx, fp.topY + 0.1, cz);
    label.center.set(0.5, 1.2);
    this.labelRoot.add(label);
    this.current = { fp, label, ext, cx, cz };
  }

  refresh() {
    if (this.current && this.state) this.show(this.state.ref, this.state.cityItem, this.state.mode);
  }
}

/** Updates the HTML scale bar from the camera distance. */
export class ScaleBar {
  constructor(el) {
    this.el = el;
    this.bar = el.querySelector('.bar');
    this.text = el.querySelector('.txt');
  }
  update(camera, dist, viewportH) {
    const visibleH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const kmPerPx = visibleH / viewportH;
    const maxKm = kmPerPx * 130;
    const p = Math.pow(10, Math.floor(Math.log10(maxKm)));
    const nice = [5, 2, 1].map((m) => m * p).find((v) => v <= maxKm) || p;
    this.bar.style.width = `${nice / kmPerPx}px`;
    this.text.textContent = fmtKm(nice);
  }
}
