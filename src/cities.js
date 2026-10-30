import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { project, footprintRing, ringExtentKm } from './projection.js';

export const NEUTRAL_COLOR = '#b08d57';

/** Build wall + fill + outline meshes for a local-km ring placed at world (cx, cz). */
export function buildFootprint(ring, cx, cz, terrain, color, opts = {}) {
  const ex = terrain.exaggeration;
  let maxG = 0, minG = Infinity;
  for (const [px, py] of ring) {
    const g = terrain.groundKm(cx + px, cz - py);
    maxG = Math.max(maxG, g);
    minG = Math.min(minG, g);
  }
  const cg = terrain.groundKm(cx, cz);
  maxG = Math.max(maxG, cg);
  minG = Math.min(minG, cg);
  const lift = 0.02 + 0.002 * ex;
  const baseY = maxG * ex + lift;
  const wallH = Math.max(0.06, (opts.wallM ?? 15) / 1000 * ex);
  const bottom = minG * ex - 0.05;
  const topY = baseY + wallH;

  const group = new THREE.Group();
  group.position.set(cx, 0, cz);

  // Fill
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const fillGeo = new THREE.ShapeGeometry(shape);
  fillGeo.rotateX(-Math.PI / 2);
  const fillMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: opts.fillOpacity ?? 0.38, side: THREE.DoubleSide, depthWrite: false,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.y = baseY;
  fill.renderOrder = 10;
  group.add(fill);

  // Wall (vertical ribbon along the outline)
  const n = ring.length;
  const pos = new Float32Array((n + 1) * 2 * 3);
  for (let i = 0; i <= n; i++) {
    const [x, y] = ring[i % n];
    pos.set([x, bottom, -y], i * 6);
    pos.set([x, topY, -y], i * 6 + 3);
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  wallGeo.setIndex(idx);
  const wallMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: opts.wallOpacity ?? 0.7, side: THREE.DoubleSide, depthWrite: false,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.renderOrder = 11;
  group.add(wall);

  // Bright outline on the wall top
  const lp = ring.map(([x, y]) => new THREE.Vector3(x, topY, -y));
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(lp),
    new THREE.LineBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#fff8e0'), 0.45), transparent: true })
  );
  outline.renderOrder = 12;
  group.add(outline);

  return { group, fill, wall, outline, topY, baseY, materials: [fillMat, wallMat, outline.material] };
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(40,25,10,0.85)';
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Cities {
  constructor(terrain, data, scene, labelRoot, { onSelect }) {
    this.terrain = terrain;
    this.data = data;
    this.scene = scene;
    this.labelRoot = labelRoot;
    this.onSelect = onSelect;
    this.group = new THREE.Group();
    this.group.name = 'cities';
    scene.add(this.group);
    this.items = data.cities.map((c) => {
      const p = project(c.lon, c.lat);
      const ring = footprintRing(c.footprint, c.areaHa);
      return { city: c, x: p.x, z: p.z, ring, extent: ringExtentKm(ring), color: NEUTRAL_COLOR };
    });
    this.byId = new Map(this.items.map((it) => [it.city.id, it]));
    this.labelsOn = true;
    this.selected = null;
    this.highlighted = new Set();
    this.buildMarkers();
    this.buildLabels();
    this.rebuild();
  }

  buildMarkers() {
    const n = this.items.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.markers = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 11, sizeAttenuation: false, map: makeDotTexture(), vertexColors: true, transparent: true,
        alphaTest: 0.3, depthWrite: false,
      })
    );
    this.markers.renderOrder = 20;
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);
  }

  buildLabels() {
    for (const it of this.items) {
      const c = it.city;
      const el = document.createElement('div');
      el.className = `city-label tier-${c.tier || 3}`;
      el.innerHTML = `<span class="sw"></span><span class="nm"></span>`;
      el.querySelector('.nm').textContent = c.name;
      el.title = c.akkadian ? `${c.name} — ${c.akkadian}` : c.name;
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelect(c.id);
      });
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 1.15);
      this.labelRoot.add(obj);
      it.label = obj;
      it.el = el;
      it.labelW = (c.name.length * ({ 1: 9.5, 2: 8, 3: 7 }[c.tier] || 7) + 22);
      it.labelH = { 1: 24, 2: 20, 3: 18 }[c.tier] || 18;
    }
  }

  /** (Re)build footprint meshes – called on load and when exaggeration changes. */
  rebuild() {
    for (const it of this.items) {
      if (it.fp) {
        this.group.remove(it.fp.group);
        it.fp.group.traverse((o) => o.geometry && o.geometry.dispose());
        it.fp.materials.forEach((m) => m.dispose());
      }
      it.fp = buildFootprint(it.ring, it.x, it.z, this.terrain, it.color);
      it.fp.fill.userData.cityId = it.city.id;
      this.group.add(it.fp.group);
    }
    const pos = this.markers.geometry.attributes.position;
    this.items.forEach((it, i) => {
      pos.setXYZ(i, it.x, it.fp.topY + 0.05, it.z);
      it.label.position.set(it.x, it.fp.topY + 0.1, it.z);
    });
    pos.needsUpdate = true;
    this.markers.geometry.computeBoundingSphere();
    this.applyColors();
  }

  setColors(colorById) {
    for (const it of this.items) it.color = colorById(it.city) || NEUTRAL_COLOR;
    this.applyColors();
  }

  applyColors() {
    const col = this.markers.geometry.attributes.color;
    const tmp = new THREE.Color();
    this.items.forEach((it, i) => {
      tmp.set(it.color);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      it.fp.fill.material.color.set(it.color);
      it.fp.wall.material.color.set(it.color);
      it.fp.outline.material.color.set(it.color).lerp(new THREE.Color('#fff8e0'), 0.45);
      it.el.style.setProperty('--pc', it.color);
      const hi = this.selected === it || this.highlighted.has(it.city.id);
      it.fp.wall.material.opacity = hi ? 0.95 : 0.7;
      it.fp.fill.material.opacity = hi ? 0.55 : 0.38;
      it.el.classList.toggle('selected', this.selected === it);
      it.el.classList.toggle('highlight', this.highlighted.has(it.city.id));
    });
    col.needsUpdate = true;
  }

  select(id) {
    this.selected = id ? this.byId.get(id) || null : null;
    this.applyColors();
  }

  setHighlighted(ids) {
    this.highlighted = new Set(ids || []);
    this.applyColors();
  }

  setVisible(v) {
    this.group.visible = v;
    this.markers.visible = v;
    this.visible = v;
  }

  /** Label declutter: tier thresholds by zoom + greedy screen-space overlap rejection. */
  declutter(camera, dist, w, h, extras = []) {
    const show = this.labelsOn && this.visible !== false;
    const v = new THREE.Vector3();
    const placed = [];
    const order = this.items.slice().sort((a, b) => {
      const pa = a === this.selected || this.highlighted.has(a.city.id) ? 0 : 1;
      const pb = b === this.selected || this.highlighted.has(b.city.id) ? 0 : 1;
      return pa - pb || (a.city.tier || 3) - (b.city.tier || 3) || (b.city.areaHa || 0) - (a.city.areaHa || 0);
    });
    for (const it of order) {
      const tier = it.city.tier || 3;
      const forced = it === this.selected || this.highlighted.has(it.city.id);
      let vis = show && (forced || tier === 1 || (tier === 2 && dist < 1500) || (tier >= 3 && dist < 300));
      if (vis) {
        v.copy(it.label.position).project(camera);
        if (v.z > 1 || v.z < -1) vis = false;
        else {
          const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
          const r = { x0: sx - it.labelW / 2, x1: sx + it.labelW / 2, y0: sy - it.labelH - 6, y1: sy };
          if (!forced && placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) vis = false;
          else placed.push(r);
        }
      }
      it.label.visible = vis;
    }
    // secondary labels (rivers): only placed where they don't collide with cities
    for (const ex of extras) {
      let vis = ex.show;
      if (vis) {
        v.copy(ex.obj.position).project(camera);
        if (v.z > 1 || v.z < -1) vis = false;
        else {
          const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
          const r = { x0: sx - ex.w / 2, x1: sx + ex.w / 2, y0: sy - 10, y1: sy + 10 };
          if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) vis = false;
          else placed.push(r);
        }
      }
      ex.obj.visible = vis;
    }
    return placed;
  }

  /** Pick a city near a screen point (markers) or under the ray (footprints). */
  pick(raycaster, camera, sx, sy, w, h) {
    if (this.visible === false) return null;
    const v = new THREE.Vector3();
    let best = null, bestD = 14;
    for (const it of this.items) {
      v.set(it.x, it.fp.topY, it.z).project(camera);
      if (v.z > 1) continue;
      const d = Math.hypot((v.x * 0.5 + 0.5) * w - sx, (-v.y * 0.5 + 0.5) * h - sy);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (best) return best.city.id;
    const hits = raycaster.intersectObjects(this.items.map((it) => it.fp.fill), false);
    return hits.length ? hits[0].object.userData.cityId : null;
  }
}
