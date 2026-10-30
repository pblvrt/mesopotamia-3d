// Historical data loader.
// Data files in src/data/ are bundled at BUILD time through import.meta.glob (eager),
// so a missing file never breaks the build. For each file we fall back to the
// clearly-marked temporary fixtures in src/fixtures/ only if the real file is absent.
const realJson = import.meta.glob('./data/*.json', { eager: true, import: 'default' });
const realGeo = import.meta.glob('./data/*.geojson', { eager: true, query: '?raw', import: 'default' });
const fixJson = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
const fixGeo = import.meta.glob('./fixtures/*.geojson', { eager: true, query: '?raw', import: 'default' });

export const usedFixtures = [];

function getJson(name, fallback) {
  const real = realJson[`./data/${name}`];
  if (real !== undefined) return real;
  const fx = fixJson[`./fixtures/${name}`];
  if (fx !== undefined) {
    usedFixtures.push(name);
    return fx;
  }
  return fallback;
}

function getGeo(name) {
  let raw = realGeo[`./data/${name}`];
  if (raw === undefined) {
    raw = fixGeo[`./fixtures/${name}`];
    if (raw !== undefined) usedFixtures.push(name);
  }
  if (raw === undefined) return { type: 'FeatureCollection', features: [] };
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn(`Could not parse ${name}`, e);
    return { type: 'FeatureCollection', features: [] };
  }
}

const asArray = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.items) ? v.items : []);

export function loadHistoricalData() {
  const cities = asArray(getJson('cities.json', [])).filter(
    (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lon)
  );
  const polities = asArray(getJson('polities.json', []));
  const timeline = asArray(getJson('timeline.json', [])).slice().sort((a, b) => a.year - b.year);
  const references = asArray(getJson('references.json', []));
  const rivers = getGeo('rivers.geojson');
  const coast = getGeo('coast.geojson');
  if (usedFixtures.length) {
    console.info('[mesopotamia-3d] Using TEMPORARY fixtures for:', usedFixtures.join(', '));
  }
  return { cities, polities, timeline, references, rivers, coast };
}
