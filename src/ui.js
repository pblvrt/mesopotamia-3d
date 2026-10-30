// Small DOM helpers for panels, legend and timeline (no UI framework).
import { fmtKm, fmtDays, WALK_KM_PER_DAY } from './tools.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmtYear = (y) => `${Math.abs(y)} BC`;
export const reignYear = (y) => 1792 - Math.abs(y) + 1;

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

export function cityPanelHtml({ city, polity, basePolity, footprintHa, centralParkHa, references, fromBabylonKm }) {
  const ha = city.areaHa ?? null;
  const areaHa = ha ?? footprintHa;
  const area = areaHa
    ? `<span class="big">${fmtInt(areaHa)} ha</span> · ${(areaHa / 100).toFixed(areaHa < 100 ? 2 : 1)} km²<br>
       ≈ ${(areaHa / centralParkHa).toFixed(areaHa / centralParkHa < 10 ? 1 : 0)}× Central Park
       ${ha == null ? '<br><small>(from approximate footprint shape)</small>' : ''}`
    : 'unknown';
  const pop = city.populationEstimate
    ? `${fmtInt(city.populationEstimate.low)} – ${fmtInt(city.populationEstimate.high)}`
    : 'unknown';
  const polityChip = polity
    ? `<span class="polity"><i style="background:${esc(polity.color)}"></i>${esc(polity.name)}${polity.ruler ? ` · ${esc(polity.ruler)}` : ''}</span>`
    : '';
  const baseNote =
    basePolity && polity && basePolity.id !== polity.id ? `<div class="areanote">In 1792 BC: ${esc(basePolity.name)}</div>` : '';
  const refOpts = references
    .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}${r.areaHa ? ` (${fmtInt(r.areaHa)} ha)` : ''}</option>`)
    .join('');
  return `
    <h2 class="cname">${esc(city.name)}</h2>
    ${city.akkadian ? `<div class="akk">Akkadian: ${esc(city.akkadian)}</div>` : ''}
    ${polityChip}${baseNote}
    <dl>
      ${city.modernName ? `<dt>Today</dt><dd>${esc(city.modernName)}</dd>` : ''}
      <dt>Area</dt><dd>${area}</dd>
      <dt>People</dt><dd>${pop}</dd>
      ${city.founded ? `<dt>Founded</dt><dd>${esc(city.founded)}</dd>` : ''}
      ${fromBabylonKm != null ? `<dt>Babylon</dt><dd>${fmtKm(fromBabylonKm)} · ≈ ${fmtDays(fromBabylonKm / WALK_KM_PER_DAY)} on foot</dd>` : ''}
    </dl>
    ${city.areaNote ? `<div class="areanote">${esc(city.areaNote)}</div>` : ''}
    ${city.description ? `<p>${esc(city.description)}</p>` : ''}
    ${city.hammurabiEra ? `<h3>In Hammurabi's time</h3><p>${esc(city.hammurabiEra)}</p>` : ''}
    ${references.length ? `
    <div class="compare">
      <h3 style="margin-top:0">Compare scale</h3>
      <select class="cmp-ref"><option value="">— choose a modern place —</option>${refOpts}</select>
      <div class="seg cmp-mode">
        <label><input type="radio" name="cmpmode" value="beside" checked><span>Beside</span></label>
        <label><input type="radio" name="cmpmode" value="overlay"><span>Overlay</span></label>
      </div>
      <div class="cmp-out"></div>
    </div>` : ''}
    ${city.sources?.length ? `<h3>Sources</h3><ul class="sources">${city.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
  `;
}

export function legendHtml(polities, usedIds) {
  const pol = polities
    .filter((p) => !usedIds || usedIds.has(p.id))
    .map(
      (p) => `<div class="row"><span class="sw" style="background:${esc(p.color)}"></span>
        <span>${esc(p.name)}${p.ruler ? ` <span class="sub">· ${esc(p.ruler)}</span>` : ''}</span></div>`
    )
    .join('');
  return `
    <h3>Polities</h3>${pol || '<div class="row sub">—</div>'}
    <h3>Water c. 1750 BC</h3>
    <div class="row"><span class="ln"></span>River (ancient course)</div>
    <div class="row"><span class="ln dash"></span>Canal</div>
    <div class="row"><span class="sw" style="background:#2f7a8f"></span>Sea (ancient Gulf)</div>
    <div class="row"><span class="sw" style="background:#7aa07c"></span>Marsh</div>
    <h3>Scale</h3>
    <div class="row"><span class="sw" style="background:rgba(243,210,122,.6);border-color:#b08d57"></span>Modern reference footprint</div>
    <div class="row sub">City walls drawn at 15 m × exaggeration</div>`;
}

export function timelineCardHtml(events, year, nameOf = (id) => id) {
  const past = events.filter((e) => e.year <= year);
  if (!past.length) return '<div class="ev old">Move the slider to follow Hammurabi’s reign.</div>';
  const lastYear = past[past.length - 1].year;
  const current = past.filter((e) => e.year === lastYear);
  const prev = past.filter((e) => e.year !== lastYear).slice(-1);
  const evHtml = (e, old) => `
    <div class="ev${old ? ' old' : ''}"><span class="yr">${fmtYear(e.year)}</span><b>${esc(e.title)}</b>
    ${e.text ? ` — ${esc(e.text)}` : ''}
    ${e.cities?.length ? ` <span class="sub">(${e.cities.map((c) => `<span class="citylink" data-city="${esc(c)}">${esc(nameOf(c))}</span>`).join(', ')})</span>` : ''}
    </div>`;
  return current.map((e) => evHtml(e, false)).join('') + prev.map((e) => evHtml(e, true)).join('');
}
