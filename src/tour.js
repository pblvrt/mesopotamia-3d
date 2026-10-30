// Guided tour: a short story card that flies the camera through seven framed views and sets
// the right layers and year for each. Shown on first visit; reopened with the Tour button.
import { esc } from './ui.js';
import { fmtKm, fmtDays, WALK_KM_PER_DAY } from './tools.js';

const SEEN_KEY = 'meso3d.tourSeen';

/** Steps. `view` frames the camera: centre lat/lon, distance (km), polar angle from vertical. */
export function tourSteps(api) {
  return [
    {
      title: 'The land between the rivers',
      view: { lat: 33.3, lon: 44.0, dist: 1450, polar: 28 },
      layers: { territories: false, regions: true, modern: true, rivers: true, coast: 'ancient' },
      year: -1792,
      html: () => `
        <p><i>Mesopotamia</i> means “between the rivers”. The <b>Euphrates</b> and the <b>Tigris</b> run from the
        Taurus mountains of Turkey down to the Persian Gulf.</p>
        <p>South of Baghdad they built a dead-flat plain of river silt. Almost every city lay here, fed by canals.
        The <b>Zagros mountains</b> rise to the east and the <b>Syrian desert</b> stretches to the west.</p>
        <p class="aside">Grey names and dashed lines show today’s cities and borders.</p>`,
    },
    {
      title: '1792 BC: a crowded map',
      view: 'overview',
      layers: { territories: true, regions: true, modern: true, rivers: true, coast: 'ancient' },
      year: -1792,
      html: () => `
        <p>When Hammurabi became king, <b>Babylon</b> <span class="chip" style="--c:${api.color('babylon')}"></span> was
        one middling kingdom among several.</p>
        <p><b>Larsa</b> <span class="chip" style="--c:${api.color('larsa')}"></span> under Rim-Sin held the south.
        <b>Eshnunna</b> <span class="chip" style="--c:${api.color('eshnunna')}"></span> held the Diyala valley.
        Shamshi-Adad’s <b>Upper Mesopotamia</b> <span class="chip" style="--c:${api.color('upper_mesopotamia')}"></span>
        stretched across the north and included Mari. <b>Elam</b> <span class="chip" style="--c:${api.color('elam')}"></span>,
        ruled from Susa, was the senior power of the age.</p>`,
    },
    {
      title: 'Babylon up close',
      view: { city: 'babylon', dist: 8.5, polar: 38, dx: 0.9 },
      layers: { territories: true, regions: true, modern: false, rivers: true, coast: 'ancient' },
      year: -1792,
      enter: () => api.showCompare('babylon', 'central_park', 'beside'),
      leave: () => api.clearCompare(),
      highlight: ['babylon'],
      html: () => `
        <p>This is Babylon at true scale. The gold outline is the city; the pale shape beside it is
        <b>New York’s Central Park</b> (341 ha), placed here at the same scale.</p>
        <p>Hammurabi’s Babylon covered perhaps <b>about 400 ha</b>, roughly one Central Park, and held some
        20,000–80,000 people. That is only an estimate: his city lies below the water table and has barely been dug.
        The famous huge Babylon is Nebuchadnezzar’s, 1,200 years later.</p>`,
    },
    {
      title: 'How far apart things were',
      view: { between: ['babylon', 'larsa'], dist: 420, polar: 30 },
      layers: { territories: true, regions: false, modern: true, rivers: true, coast: 'ancient' },
      year: -1792,
      enter: () => api.measure('babylon', 'larsa'),
      leave: () => api.clearMeasure(),
      highlight: ['babylon', 'larsa'],
      html: () => {
        const km = api.cityKm('babylon', 'larsa');
        return `
        <p>Babylon to its great rival Larsa is <b>${fmtKm(km)}</b> in a straight line. That is about
        <b>${fmtDays(km / WALK_KM_PER_DAY)}</b> on foot, and more like <b>10 days</b> along the winding canal roads.</p>
        <p>Heavy goods went by river. Boats drifted south with the current in a few days, but going back north
        meant towing them upstream for two weeks or more.</p>`;
      },
    },
    {
      title: 'Mari, on the middle Euphrates',
      view: { city: 'mari', dist: 70, polar: 40 },
      layers: { territories: true, regions: true, modern: true, rivers: true, coast: 'ancient' },
      year: -1770,
      highlight: ['mari'],
      html: () => `
        <p>Mari sat where the river road from Babylon met the routes to Syria and the Mediterranean.
        Tin, timber, wine and textiles passed through it.</p>
        <p>King <b>Zimri-Lim</b> (1775–1761 BC) lived in a palace of about 300 rooms. Its archive of some 20,000 clay
        letters, including reports from his envoys at Hammurabi’s court, is our best window on this age.</p>`,
    },
    {
      title: 'The ancient shoreline',
      view: { lat: 30.75, lon: 47.0, dist: 520, polar: 30 },
      layers: { territories: true, regions: true, modern: true, rivers: true, coast: 'ancient' },
      year: -1792,
      highlight: ['ur', 'eridu'],
      extra: 'coast',
      leave: () => api.setCoast('ancient'),
      html: () => `
        <p>In Hammurabi’s day the head of the Gulf lay much further inland, and wide reed marshes surrounded
        <b>Ur</b> and <b>Eridu</b>. Since then the rivers have dumped their silt and pushed the coast to the southeast.</p>
        <p>The exact ancient shoreline is uncertain, by tens of kilometres.</p>`,
    },
    {
      title: '1750 BC: Hammurabi’s kingdom',
      view: 'overview',
      layers: { territories: true, regions: true, modern: true, rivers: true, coast: 'ancient' },
      year: -1750,
      html: () => `
        <p>Forty-two years later the map is gold. Hammurabi beat Elam (1764), took Larsa (1763) and Eshnunna (1762),
        and conquered Mari (1761). <b>Babylon</b> now ran from the Gulf to Mari.</p>
        <p>Near the end of his reign he set up the stele of the <b>Code of Hammurabi</b>, with 282 laws, so that
        “the strong may not oppress the weak”.</p>`,
    },
  ];
}

export class Tour {
  constructor(api, root) {
    this.api = api;
    this.root = root;
    this.steps = tourSteps(api);
    this.i = -1;
    this.open = false;
    root.innerHTML = `
      <button class="tour-close icon-btn" aria-label="Skip tour">×</button>
      <div class="tour-kicker"></div>
      <h2 class="tour-title"></h2>
      <div class="tour-text"></div>
      <div class="tour-extra"></div>
      <div class="tour-nav">
        <button class="btn tour-prev">‹ Back</button>
        <div class="tour-dots" role="tablist"></div>
        <button class="btn tour-next primary">Next ›</button>
      </div>`;
    this.$ = (s) => root.querySelector(s);
    this.$('.tour-prev').addEventListener('click', () => this.go(this.i - 1));
    this.$('.tour-next').addEventListener('click', () => (this.i >= this.steps.length - 1 ? this.close(true) : this.go(this.i + 1)));
    this.$('.tour-close').addEventListener('click', () => this.close(false));
    this.$('.tour-dots').innerHTML = this.steps
      .map((s, k) => `<button class="dot" role="tab" aria-label="Step ${k + 1}: ${esc(s.title)}" data-k="${k}"></button>`)
      .join('');
    this.$('.tour-dots').addEventListener('click', (e) => {
      const k = e.target.closest('.dot')?.dataset.k;
      if (k != null) this.go(Number(k));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.target.closest?.('input,select,textarea')) return;
      if (e.key === 'ArrowRight') this.$('.tour-next').click();
      else if (e.key === 'ArrowLeft' && this.i > 0) this.go(this.i - 1);
    });
  }

  static seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  start(i = 0) {
    this.open = true;
    this.root.hidden = false;
    document.body.classList.add('touring');
    this.api.onOpen?.();
    this.i = -1;
    this.go(i);
  }

  go(k) {
    if (k < 0 || k >= this.steps.length) return;
    const prev = this.steps[this.i];
    prev?.leave?.();
    this.i = k;
    const s = this.steps[k];
    const api = this.api;
    api.setYear(s.year);
    api.setLayers(s.layers);
    api.highlight(s.highlight || []);
    s.enter?.();

    this.$('.tour-kicker').textContent = `Step ${k + 1} of ${this.steps.length} · ${Math.abs(s.year)} BC`;
    this.$('.tour-title').textContent = s.title;
    this.$('.tour-text').innerHTML = s.html();
    const extra = this.$('.tour-extra');
    extra.innerHTML = '';
    if (s.extra === 'coast') {
      extra.innerHTML = `<div class="seg"><label><input type="radio" name="tourcoast" value="ancient" checked><span>Coast c. 1750 BC</span></label><label><input type="radio" name="tourcoast" value="modern"><span>Coast today</span></label></div>`;
      extra.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => api.setCoast(r.value)));
    }
    this.$('.tour-prev').disabled = k === 0;
    const last = k === this.steps.length - 1;
    this.$('.tour-next').textContent = last ? 'Explore freely ›' : 'Next ›';
    this.root.querySelectorAll('.dot').forEach((d, j) => d.setAttribute('aria-selected', String(j === k)));
    this.root.scrollTop = 0;
    api.frame(s.view);
    api.invalidate();
  }

  close(finished) {
    if (!this.open) return;
    this.steps[this.i]?.leave?.();
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('touring');
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private mode */
    }
    this.api.onClose?.(finished);
    this.api.invalidate();
  }
}
