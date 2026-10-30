// Per-year political ownership for the timeline slider (1792 → 1750 BC).
//
// cities.json gives `polity1792` (start of Hammurabi's reign) and `polity1750` (his death);
// older data may only have `polity`. This module fills in WHEN each city changed hands.
//
// Algorithm, for a city and a year Y (negative = BC):
//   owner = city.polity1792 ?? city.polity
//   walk every rule with rule.year <= Y in chronological order:
//     • POLITY_CONQUESTS  — "cities currently held by <from> pass to <to>"
//                           (optionally only cities whose 1792 polity is in `base`)
//     • CITY_OVERRIDES    — "this city passes to <polity>"
//     • city.polityHistory (optional array in cities.json: [{year, polity}]) — same as overrides
//   Finally, if the walk does not end at city.polity1750, a closing transfer to polity1750 is
//   added at END_OF_REIGN_FALLBACK (date unknown; documented as such in the UI legend/README).
// Rules pointing at a polity id that is not in polities.json are ignored.
//
// Dates: conventional Middle Chronology, keyed to Hammurabi's year names. Approximate.

export const END_OF_REIGN_FALLBACK = -1752;

export const POLITY_CONQUESTS = [
  // Elam seizes Eshnunna, is driven out by the coalition; Eshnunna restored, then defeated.
  { year: -1766, from: ['eshnunna'], to: 'elam', note: 'Elam takes Eshnunna' },
  { year: -1764, from: ['elam'], base: ['eshnunna'], to: 'eshnunna', note: 'Elamites expelled; Eshnunna restored' },
  // Hammurabi defeats Rim-Sin; Larsa and all of Sumer pass to Babylon (year name 31).
  { year: -1763, from: ['larsa'], to: 'babylon', note: 'Fall of Larsa; Rim-Sin defeated' },
  { year: -1762, from: ['eshnunna'], to: 'babylon', note: 'Eshnunna defeated' },
  // Mari conquered (year name 33); Malgium submits the same year.
  { year: -1761, from: ['mari'], to: 'babylon', note: 'Mari taken from Zimri-Lim' },
  { year: -1761, from: ['malgium'], to: 'babylon', note: 'Malgium submits' },
];

export const CITY_OVERRIDES = {
  // Year name 7: "Uruk and Isin were seized" — Hammurabi's early southern campaign.
  isin: [{ year: -1787, polity: 'babylon', note: 'Seized by Hammurabi (year 7)' }],
  uruk: [{ year: -1787, polity: 'babylon', note: 'Seized by Hammurabi (year 7)' }],
  // Year names 10–11: Rapiqum taken from Eshnunna.
  rapiqum: [{ year: -1783, polity: 'babylon', note: 'Taken by Hammurabi' }],
  // Death of Shamshi-Adad (c. 1776): Zimri-Lim returns to Mari; the north fragments.
  mari: [{ year: -1775, polity: 'mari' }, { year: -1761, polity: 'babylon' }],
  terqa: [{ year: -1775, polity: 'mari' }, { year: -1761, polity: 'babylon' }],
  tuttul: [{ year: -1775, polity: 'mari' }],
  shubat_enlil: [{ year: -1776, polity: 'apum', note: 'Capital of Apum after Shamshi-Adad' }],
  karana: [{ year: -1776, polity: 'other' }, { year: -1756, polity: 'babylon', note: 'Northern campaign' }],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function makeOwnership(cities, polities) {
  const ids = new Set(polities.map((p) => p.id));
  const byNorm = new Map(polities.map((p) => [norm(p.id), p.id]));
  const resolve = (id) => (ids.has(id) ? id : byNorm.get(norm(id)) || null);
  const match = (list, id) => list.some((f) => norm(f) === norm(id));

  const timelines = new Map();
  for (const c of cities) {
    const base = c.polity1792 || c.polity;
    const rules = [];
    POLITY_CONQUESTS.forEach((r, i) => {
      const to = resolve(r.to);
      if (to && (!r.base || match(r.base, base))) rules.push({ year: r.year, from: r.from, to, order: i });
    });
    for (const r of [...(CITY_OVERRIDES[c.id] || []), ...(c.polityHistory || [])]) {
      const to = resolve(r.polity);
      if (to && Number.isFinite(r.year)) rules.push({ year: r.year, to, order: 1000 });
    }
    rules.sort((a, b) => a.year - b.year || a.order - b.order);

    // Pre-compute the ownership change points for this city.
    const changes = [];
    let owner = base;
    for (const r of rules) {
      if (r.from && !match(r.from, owner)) continue;
      if (r.to !== owner) {
        owner = r.to;
        changes.push({ year: r.year, polity: owner });
      }
    }
    const final = c.polity1750 && resolve(c.polity1750);
    if (final && final !== owner) {
      const last = changes.length ? changes[changes.length - 1].year : -Infinity;
      changes.push({ year: Math.max(END_OF_REIGN_FALLBACK, last + 1), polity: final, fallback: true });
    }
    timelines.set(c.id, { base, changes });
  }

  /** Polity id controlling `city` in `year` (negative = BC). */
  return function ownerAt(city, year) {
    const t = timelines.get(city.id);
    if (!t) return city.polity;
    let owner = t.base;
    for (const ch of t.changes) if (ch.year <= year) owner = ch.polity;
    return owner;
  };
}
