import './style.css';
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadHistoricalData, usedFixtures } from './data.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { Cities, NEUTRAL_COLOR } from './cities.js';
import { MeasureTool, CompareTool, ScaleBar, fmtKm, fmtDays } from './tools.js';
import { makeOwnership } from './conquests.js';
import { project, unproject, haversineKm, ringAreaKm2, footprintRing } from './projection.js';
import { cityPanelHtml, legendHtml, timelineCardHtml, fmtYear, reignYear, esc } from './ui.js';

const $ = (s) => document.querySelector(s);
const statusEl = $('#loading-status');
const progressEl = $('.progress-bar');
const setStatus = (msg, pct) => {
  statusEl.textContent = msg;
  if (pct != null) progressEl.style.width = `${pct}%`;
};

const isMobile = window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;

// ---------------------------------------------------------------- renderer / scene
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#e6d9bd');
const ZENITH = new THREE.Color('#7fa7c9');
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON.clone(), 1500, 5000);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 30000);
const labelRoot = new THREE.Group();
scene.add(labelRoot);

// soft sky dome (follows the camera, drawn first, no depth)
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(100, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    uniforms: { uH: { value: HORIZON }, uZ: { value: ZENITH }, uSun: { value: new THREE.Vector3(-0.5, 0.45, -0.6).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uH; uniform vec3 uZ; uniform vec3 uSun; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 c = mix(uH, uZ, smoothstep(0.0, 0.55, h));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        c += vec3(1.0, 0.85, 0.6) * pow(s, 24.0) * 0.35;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -1000;
sky.frustumCulled = false;
scene.add(sky);

scene.add(new THREE.HemisphereLight(0xfff3dc, 0x6b5536, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(-600, 900, -700); // NW sun, classic hillshade lighting
scene.add(sun);

// ---------------------------------------------------------------- controls
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 1.2;
controls.maxDistance = 2600;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
controls.zoomToCursor = true;
controls.zoomSpeed = 1.2;

const OVERVIEW = { target: new THREE.Vector3(0, 0, -30), position: new THREE.Vector3(60, 980, 820) };
camera.position.copy(OVERVIEW.position);
controls.target.copy(OVERVIEW.target);

// ---------------------------------------------------------------- state
const data = loadHistoricalData();
const state = {
  year: -1792,
  polityColors: true,
  selectedId: null,
  measuring: false,
  riversOn: true,
  labelsOn: true,
};
const polityById = new Map(data.polities.map((p) => [p.id, p]));
const ownerAt = makeOwnership(data.cities, data.polities);
const centralPark = data.references.find((r) => /central.?park/i.test(r.id + ' ' + r.name));
const CENTRAL_PARK_HA = centralPark?.areaHa || 341;

let terrain, water, cities, measure, compare, scaleBar;
let fly = null; // active camera animation

// ---------------------------------------------------------------- boot
async function boot() {
  setStatus('Loading terrain…', 15);
  terrain = new Terrain();
  terrain.exaggeration = Number($('#exag').value);
  // ?seg=N overrides mesh resolution (useful on slow GPUs / for testing)
  const segParam = Number(new URLSearchParams(location.search).get('seg'));
  const segments = segParam >= 64 && segParam <= 2048 ? segParam : isMobile ? 512 : 1024;
  await terrain.init(segments, (m) => setStatus(m, 30));
  scene.add(terrain.mesh);

  setStatus('Tracing the rivers and the ancient shore…', 55);
  water = new Water(terrain, data, scene, labelRoot);
  water.setResolution(window.innerWidth, window.innerHeight);

  setStatus('Raising city walls…', 75);
  cities = new Cities(terrain, data, scene, labelRoot, { onSelect: selectCity });
  measure = new MeasureTool(terrain, scene, labelRoot, showMeasureResult);
  compare = new CompareTool(terrain, scene, labelRoot);
  scaleBar = new ScaleBar($('#scalebar'));

  buildLegend();
  buildAttribution();
  setupTimeline();
  wireControls();
  setYear(state.year);

  setStatus('Ready', 100);
  renderer.setAnimationLoop(tick);
  setTimeout(() => $('#loading').classList.add('done'), 250);
  setTimeout(() => $('#loading').remove(), 1200);

  // progressive upgrade to full resolution
  if (!terrain.hiLoaded) {
    setTimeout(async () => {
      try {
        if (await terrain.upgrade()) refreshOverlays();
      } catch (e) {
        console.warn('[terrain] full-resolution upgrade failed', e);
      }
    }, 300);
  }
}

function refreshOverlays() {
  water.updateHeights();
  cities.rebuild();
  measure.update();
  compare.refresh();
}

// ---------------------------------------------------------------- polities / timeline
function colorFor(city) {
  if (!state.polityColors) return NEUTRAL_COLOR;
  const p = polityById.get(ownerAt(city, state.year));
  return p?.color || NEUTRAL_COLOR;
}

function setupTimeline() {
  const ticks = $('#tl-ticks');
  const min = -1792, max = -1750;
  const years = [...new Set(data.timeline.map((e) => e.year))].filter((y) => y >= min && y <= max);
  ticks.innerHTML = years.map((y) => `<i style="left:${((y - min) / (max - min)) * 100}%" title="${fmtYear(y)}"></i>`).join('');
  const slider = $('#tl-year');
  slider.addEventListener('input', () => setYear(Number(slider.value)));
  let timer = null;
  const play = $('#tl-play');
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.textContent = '▶';
    play.setAttribute('aria-label', 'Play timeline');
  };
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (state.year >= max) setYear(min);
    play.textContent = '❚❚';
    play.setAttribute('aria-label', 'Pause timeline');
    timer = setInterval(() => {
      if (state.year >= max) return stop();
      setYear(state.year + 1);
    }, 900);
  });
  $('#tl-card').addEventListener('click', (e) => {
    const id = e.target.closest('.citylink')?.dataset.city;
    if (id && cities.byId.has(id)) selectCity(id);
  });
}

function setYear(y) {
  state.year = y;
  $('#tl-year').value = String(y);
  $('#tl-label').innerHTML = `<b>${fmtYear(y)}</b><small>Hammurabi, year ${reignYear(y)}</small>`;
  const nameOf = (id) => cities?.byId.get(id)?.city.name || id;
  $('#tl-card').innerHTML = timelineCardHtml(data.timeline, y, nameOf);
  const past = data.timeline.filter((e) => e.year <= y);
  const latest = past.length ? past[past.length - 1].year : null;
  const hl = latest == null ? [] : past.filter((e) => e.year === latest).flatMap((e) => e.cities || []);
  if (cities) {
    cities.setColors(colorFor);
    cities.setHighlighted(document.getElementById('timeline').hidden ? [] : hl);
  }
  if (state.selectedId) renderCityPanel(state.selectedId, true);
}

// ---------------------------------------------------------------- city selection
function selectCity(id, { fly: doFly = true } = {}) {
  state.selectedId = id;
  cities.select(id);
  compare.clear();
  if (!id) {
    $('#city-panel').hidden = true;
    document.body.classList.remove('panel-open');
    return;
  }
  renderCityPanel(id);
  document.body.classList.add('panel-open');
  const it = cities.byId.get(id);
  if (doFly && it) {
    const d = Math.max(6, it.extent * 6);
    flyTo(new THREE.Vector3(it.x, it.fp.topY, it.z), d, 52);
  }
}

function renderCityPanel(id, keepCompare = false) {
  const it = cities.byId.get(id);
  if (!it) return;
  const c = it.city;
  const panel = $('#city-panel');
  const content = panel.querySelector('.content');
  const prevRef = keepCompare ? content.querySelector('.cmp-ref')?.value : '';
  const prevMode = keepCompare ? content.querySelector('input[name=cmpmode]:checked')?.value : null;
  const bab = cities.byId.get('babylon');
  const fromBabylonKm = bab && bab !== it ? haversineKm(unproject(bab.x, bab.z), { lon: c.lon, lat: c.lat }) : null;
  content.innerHTML = cityPanelHtml({
    city: c,
    polity: polityById.get(ownerAt(c, state.year)),
    basePolity: polityById.get(c.polity1792 || c.polity),
    footprintHa: ringAreaKm2(it.ring) * 100,
    centralParkHa: CENTRAL_PARK_HA,
    references: data.references,
    fromBabylonKm,
  });
  panel.hidden = false;
  panel.scrollTop = keepCompare ? panel.scrollTop : 0;

  const sel = content.querySelector('.cmp-ref');
  if (!sel) return;
  const out = content.querySelector('.cmp-out');
  const update = () => {
    const ref = data.references.find((r) => r.id === sel.value);
    const mode = content.querySelector('input[name=cmpmode]:checked')?.value || 'beside';
    if (!ref) {
      compare.clear();
      out.textContent = '';
      return;
    }
    compare.show(ref, it, mode);
    const cityHa = c.areaHa ?? ringAreaKm2(it.ring) * 100;
    const refHa = ref.areaHa ?? ringAreaKm2(footprintRing(ref.footprint)) * 100;
    if (cityHa && refHa) {
      const r = cityHa / refHa;
      out.textContent =
        r >= 1 ? `${c.name} ≈ ${r.toFixed(r < 10 ? 1 : 0)}× the area of ${ref.name}` : `${ref.name} ≈ ${(1 / r).toFixed(1)}× the area of ${c.name}`;
    }
    const d = Math.max(6, (it.extent + compare.current.ext) * 4);
    flyTo(new THREE.Vector3((it.x + compare.current.cx) / 2, it.fp.topY, it.z), d, 50);
  };
  sel.addEventListener('change', update);
  content.querySelectorAll('input[name=cmpmode]').forEach((r) => r.addEventListener('change', update));
  if (prevRef) {
    sel.value = prevRef;
    if (prevMode) content.querySelector(`input[name=cmpmode][value=${prevMode}]`).checked = true;
  }
}

// ---------------------------------------------------------------- camera fly-to
function flyTo(target, dist, polarDeg = 50) {
  const dir = camera.position.clone().sub(controls.target);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  const pol = THREE.MathUtils.degToRad(polarDeg);
  const toPos = target.clone().add(new THREE.Vector3(dir.x * Math.sin(pol) * dist, Math.cos(pol) * dist, dir.z * Math.sin(pol) * dist));
  fly = {
    t0: performance.now(),
    dur: 1700,
    fromT: controls.target.clone(),
    fromP: camera.position.clone(),
    toT: target.clone(),
    toP: toPos,
  };
}
function flyToRaw(target, position) {
  fly = { t0: performance.now(), dur: 1700, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target.clone(), toP: position.clone() };
}

// ---------------------------------------------------------------- input
function wireControls() {
  const exag = $('#exag');
  const exagVal = $('#exag-val');
  let pending = false;
  exag.addEventListener('input', () => {
    const v = Number(exag.value);
    exagVal.textContent = `${v}×`;
    const old = terrain.exaggeration;
    terrain.setExaggeration(v);
    // keep camera target glued to the surface
    controls.target.y *= v / old;
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        refreshOverlays();
      });
    }
  });

  document.querySelectorAll('input[name=coast]').forEach((r) =>
    r.addEventListener('change', () => water.setAncient($('input[name=coast]:checked').value === 'ancient'))
  );
  $('#lyr-rivers').addEventListener('change', (e) => {
    state.riversOn = e.target.checked;
    water.setRiversVisible(e.target.checked);
  });
  $('#lyr-cities').addEventListener('change', (e) => {
    cities.setVisible(e.target.checked);
    compare.clear();
  });
  $('#lyr-labels').addEventListener('change', (e) => {
    cities.labelsOn = e.target.checked;
    state.labelsOn = e.target.checked;
  });
  $('#lyr-polities').addEventListener('change', (e) => {
    state.polityColors = e.target.checked;
    cities.setColors(colorFor);
  });
  $('#lyr-timeline').addEventListener('change', (e) => {
    $('#timeline').hidden = !e.target.checked;
    setYear(state.year);
  });

  const mBtn = $('#btn-measure');
  mBtn.addEventListener('click', () => setMeasuring(!state.measuring));
  $('#btn-overview').addEventListener('click', () => flyToRaw(OVERVIEW.target, OVERVIEW.position));

  $('#city-panel .close').addEventListener('click', () => selectCity(null));
  const toggle = $('#controls-toggle');
  toggle.addEventListener('click', () => {
    const open = $('#controls').classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.measuring) setMeasuring(false);
      else selectCity(null);
    }
  });

  // click vs drag discrimination
  const el = renderer.domElement;
  let down = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
    fly = null; // user takes over
  });
  el.addEventListener('pointerup', (e) => {
    if (!down || down.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6 && performance.now() - down.t < 600) handleClick(e.clientX, e.clientY);
    down = null;
  });
}

function setMeasuring(on) {
  state.measuring = on;
  measure.setActive(on);
  document.body.classList.toggle('measuring', on);
  $('#btn-measure').setAttribute('aria-pressed', String(on));
  const res = $('#measure-result');
  res.hidden = !on;
  if (on) res.innerHTML = 'Click two points on the map.';
}

function showMeasureResult(r) {
  const res = $('#measure-result');
  if (!state.measuring) return;
  res.hidden = false;
  if (!r) res.innerHTML = 'Click two points on the map.';
  else if (r.pending) res.innerHTML = 'Now click the second point.';
  else
    res.innerHTML = `<b>${fmtKm(r.km)}</b> straight line<br>
      ≈ ${fmtDays(r.walkDays)} walking <small style="display:inline">(25 km/day)</small><br>
      ≈ ${fmtDays(r.boatDownDays)} by boat downstream<br>
      ≈ ${fmtDays(r.boatUpDays)} by boat upstream (towed)
      <small>Great-circle distance; real routes followed rivers and canals and were longer.</small>`;
}

const raycaster = new THREE.Raycaster();
function handleClick(x, y) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (state.measuring) {
    const p = terrain.raycast(raycaster.ray);
    if (p) measure.addPoint(p);
    return;
  }
  const id = cities.pick(raycaster, camera, x, y, window.innerWidth, window.innerHeight);
  if (id) selectCity(id);
}

// ---------------------------------------------------------------- legend / attribution
function buildLegend() {
  const used = new Set();
  for (const c of data.cities) for (let y = -1792; y <= -1750; y++) used.add(ownerAt(c, y));
  $('#legend').innerHTML = legendHtml(data.polities, used.size ? used : null);
}

function buildAttribution() {
  const src = terrain.meta?.source || 'terrain data';
  const fixtures = [...usedFixtures, ...(terrain.isFixture ? ['terrain'] : [])];
  $('#attribution').innerHTML =
    `Terrain: ${esc(src)} · modern elevations; ancient water courses &amp; coastline reconstructed. ` +
    `Historical data approximate — city sizes, populations and borders are scholarly estimates with large uncertainty. Dates: Middle Chronology.` +
    (fixtures.length ? ` <span class="fixture-warning">Placeholder data in use: ${esc(fixtures.join(', '))}</span>` : '');
}

// ---------------------------------------------------------------- frame loop
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let lastDeclutter = 0;
const hf = () => terrain.hf;

function tick(now) {
  if (fly) {
    const t = Math.min(1, (now - fly.t0) / fly.dur);
    const k = ease(t);
    // arc out a little on long flights
    controls.target.lerpVectors(fly.fromT, fly.toT, k);
    camera.position.lerpVectors(fly.fromP, fly.toP, k);
    const span = fly.fromT.distanceTo(fly.toT);
    camera.position.y += Math.sin(Math.PI * k) * span * 0.35;
    if (t >= 1) fly = null;
  }
  controls.update();

  // keep target within the map and glued to the ground
  const h = hf();
  const tx = THREE.MathUtils.clamp(controls.target.x, h.x0, h.x1);
  const tz = THREE.MathUtils.clamp(controls.target.z, h.z0, h.z1);
  if (tx !== controls.target.x || tz !== controls.target.z) {
    camera.position.x += tx - controls.target.x;
    camera.position.z += tz - controls.target.z;
    controls.target.x = tx;
    controls.target.z = tz;
  }
  if (!fly) {
    const gy = terrain.surfaceY(controls.target.x, controls.target.z);
    const dy = (gy - controls.target.y) * 0.12;
    controls.target.y += dy;
    camera.position.y += dy;
  }
  // never go underground
  const camGround = terrain.surfaceY(camera.position.x, camera.position.z) + 0.15;
  if (camera.position.y < camGround) camera.position.y = camGround;

  const dist = camera.position.distanceTo(controls.target);
  scene.fog.near = dist * 1.1;
  scene.fog.far = dist * 4.5 + 300;
  sky.position.copy(camera.position);

  water.updateForCamera(dist);
  measure.updateForCamera(dist, window.innerWidth, window.innerHeight);
  if (now - lastDeclutter > 90) {
    lastDeclutter = now;
    const riverLabelsOn = state.riversOn && state.labelsOn && dist < 1600;
    const extras = water.riverLabels.map((obj) => ({ obj, w: obj.userData.w, show: riverLabelsOn }));
    cities.declutter(camera, dist, window.innerWidth, window.innerHeight, extras);
    scaleBar.update(camera, dist, window.innerHeight);
    if (compare.current) compare.current.label.visible = dist < Math.max(30, compare.current.ext * 40);
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  water?.setResolution(w, h);
});

boot().catch((e) => {
  console.error(e);
  setStatus(`Could not start: ${e.message}. WebGL 2 is required.`, 100);
});

// exposed for debugging in the console
window.__meso = { get terrain() { return terrain; }, get cities() { return cities; }, data, project };
