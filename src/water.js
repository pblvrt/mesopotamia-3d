import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { project } from './projection.js';

const SEA_LEVEL_ANCIENT_KM = 0.0005; // ~0.5 m
const MARSH_LEVEL_KM = 0.001; // ~1 m

/** Iterate polygons of a GeoJSON geometry as arrays of rings (lon/lat). */
function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function linesOf(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

function shapeFromRings(rings) {
  const toV = ([lon, lat]) => {
    const p = project(lon, lat);
    return new THREE.Vector2(p.x, -p.z); // shape XY -> after rotateX(-90°) maps to world (x, -y)=z
  };
  const outer = rings[0].map(toV);
  if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (let k = 1; k < rings.length; k++) {
    const hole = rings[k].map(toV);
    if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
    shape.holes.push(new THREE.Path(hole));
  }
  return shape;
}

/** Densify a lon/lat line to ~stepKm spacing in world coordinates. */
function densify(coords, stepKm) {
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    const p = project(coords[i][0], coords[i][1]);
    if (i > 0) {
      const q = out[out.length - 1];
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      const n = Math.floor(d / stepKm);
      for (let k = 1; k < n; k++) {
        out.push({ x: q.x + ((p.x - q.x) * k) / n, z: q.z + ((p.z - q.z) * k) / n });
      }
    }
    out.push(p);
  }
  return out;
}

export class Water {
  constructor(terrain, data, scene, labelRoot) {
    this.terrain = terrain;
    this.data = data;
    this.group = new THREE.Group();
    this.riverGroup = new THREE.Group();
    this.coastGroup = new THREE.Group();
    this.group.add(this.riverGroup, this.coastGroup);
    scene.add(this.group);
    this.labelRoot = labelRoot;
    this.lineMaterials = [];
    this.ancient = true;

    this.buildSea(scene);
    this.buildCoast();
    this.buildMask();
    this.buildRivers();
  }

  buildSea(scene) {
    const hf = this.terrain.hf;
    const w = hf.x1 - hf.x0, d = hf.z1 - hf.z0; // exactly the map tile
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((hf.x0 + hf.x1) / 2, 0, (hf.z0 + hf.z1) / 2);
    this.seaMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a6f86, roughness: 0.35, metalness: 0.15, transparent: true, opacity: 0.94,
    });
    this.sea = new THREE.Mesh(geo, this.seaMaterial);
    this.sea.name = 'sea';
    this.sea.renderOrder = 1;
    scene.add(this.sea);
  }

  buildCoast() {
    const seaShapes = [], marshShapes = [];
    for (const f of this.data.coast.features || []) {
      const kind = f.properties?.kind || 'sea';
      for (const rings of polygonsOf(f.geometry)) {
        if (!rings.length || rings[0].length < 3) continue;
        (kind === 'marsh' ? marshShapes : seaShapes).push(shapeFromRings(rings));
      }
    }
    this.seaShapes = seaShapes;
    this.marshShapes = marshShapes;
    if (seaShapes.length) {
      const g = new THREE.ShapeGeometry(seaShapes);
      g.rotateX(-Math.PI / 2);
      this.ancientSea = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({ color: 0x2f7a8f, roughness: 0.3, metalness: 0.15, transparent: true, opacity: 0.95 })
      );
      this.ancientSea.renderOrder = 2;
      this.coastGroup.add(this.ancientSea);
    }
    if (marshShapes.length) {
      const g = new THREE.ShapeGeometry(marshShapes);
      g.rotateX(-Math.PI / 2);
      this.marsh = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          color: 0x5f8f6a, roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.55, depthWrite: false,
        })
      );
      this.marsh.renderOrder = 3;
      this.coastGroup.add(this.marsh);
    }
    this.updateHeights();
  }

  /** Rasterise sea (R) and marsh (G) polygons into a mask aligned with the terrain UVs. */
  buildMask() {
    const hf = this.terrain.hf;
    const W = 2048, H = Math.round((W * (hf.z1 - hf.z0)) / (hf.x1 - hf.x0));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const tx = (lon, lat) => {
      const p = project(lon, lat);
      return [((p.x - hf.x0) / (hf.x1 - hf.x0)) * W, ((p.z - hf.z0) / (hf.z1 - hf.z0)) * H];
    };
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.data.coast.features || []) {
      const kind = f.properties?.kind || 'sea';
      ctx.fillStyle = kind === 'marsh' ? '#00ff00' : '#ff0000';
      for (const rings of polygonsOf(f.geometry)) {
        ctx.beginPath();
        for (const ring of rings) {
          ring.forEach((pt, i) => {
            const [x, y] = tx(pt[0], pt[1]);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.terrain.uniforms.uMask.value = tex;
  }

  buildRivers() {
    const features = this.data.rivers.features || [];
    this.rivers = [];
    const longestByName = new Map();
    for (const f of features) {
      const kind = f.properties?.kind || 'river';
      for (const coords of linesOf(f.geometry)) {
        if (coords.length < 2) continue;
        const pts = densify(coords, 1.0);
        const item = { kind, name: f.properties?.name || '', pts, lines: [] };
        const style = {
          river: { core: 0x1f8fd6, glow: 0x9be3ff, w: 2.6, gw: 8, gop: 0.45 },
          branch: { core: 0x2a9ad8, glow: 0x9be3ff, w: 1.8, gw: 6, gop: 0.38 },
          canal: { core: 0x1a6fa8, glow: 0xb8ecff, w: 1.6, gw: 4.5, gop: 0.35, dashed: true },
        }[kind] || { core: 0x2a9ad8, glow: 0x9be3ff, w: 1.8, gw: 6, gop: 0.38 };
        const glowMat = new LineMaterial({
          color: style.glow, linewidth: style.gw, transparent: true, opacity: style.gop, depthWrite: false,
        });
        const coreMat = new LineMaterial({
          color: style.core, linewidth: style.w, transparent: true, opacity: 0.95, dashed: !!style.dashed,
          dashSize: 1.2, gapSize: 0.8, depthWrite: false,
        });
        for (const mat of [glowMat, coreMat]) {
          const geo = new LineGeometry();
          const line = new Line2(geo, mat);
          line.renderOrder = 5;
          line.frustumCulled = false;
          item.lines.push(line);
          this.riverGroup.add(line);
          this.lineMaterials.push(mat);
        }
        item.coreMat = coreMat;
        this.rivers.push(item);
        if (kind === 'river' && item.name) {
          const prev = longestByName.get(item.name);
          if (!prev || prev.pts.length < pts.length) longestByName.set(item.name, item);
        }
      }
    }
    this.riverLabels = [];
    const named = [...longestByName].sort((a, b) => b[1].pts.length - a[1].pts.length);
    for (const [name, item] of named) {
      // the two great rivers get large aligned labels instead (arealabels.js)
      if (/^(Euphrates|Tigris) \(/.test(name)) continue;
      const el = document.createElement('div');
      el.className = 'river-label';
      el.textContent = name;
      const obj = new CSS2DObject(el);
      obj.userData.at = item.pts[Math.floor(item.pts.length * 0.45)];
      obj.userData.len = item.pts.length;
      obj.userData.w = name.length * 9 + 12;
      this.labelRoot.add(obj);
      this.riverLabels.push(obj);
    }
    this.updateHeights();
  }

  updateHeights() {
    const t = this.terrain, ex = t.exaggeration;
    if (this.ancientSea) this.ancientSea.position.y = SEA_LEVEL_ANCIENT_KM * ex;
    if (this.marsh) this.marsh.position.y = MARSH_LEVEL_KM * ex + 0.002;
    const lift = 0.04 + 0.004 * ex;
    for (const r of this.rivers || []) {
      const arr = new Float32Array(r.pts.length * 3);
      r.pts.forEach((p, i) => {
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = t.surfaceY(p.x, p.z) + lift;
        arr[i * 3 + 2] = p.z;
      });
      for (const line of r.lines) {
        line.geometry.setPositions(arr);
        line.computeLineDistances();
      }
    }
    for (const l of this.riverLabels || []) {
      const p = l.userData.at;
      l.position.set(p.x, t.surfaceY(p.x, p.z) + lift + 0.2, p.z);
    }
  }

  setResolution(w, h) {
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  /** Scale canal dash pattern with zoom so it stays readable. */
  updateForCamera(dist) {
    const dash = Math.max(0.15, dist * 0.006);
    for (const r of this.rivers || []) {
      if (r.coreMat.dashed) {
        r.coreMat.dashSize = dash;
        r.coreMat.gapSize = dash * 0.7;
      }
    }
  }

  setAncient(on) {
    this.ancient = on;
    this.coastGroup.visible = on;
    this.terrain.uniforms.uAncient.value = on ? 1 : 0;
  }

  setRiversVisible(v) {
    this.riverGroup.visible = v;
    for (const l of this.riverLabels || []) l.visible = v;
  }
}
