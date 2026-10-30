# Mesopotamia in the Age of Hammurabi — 3D map

An interactive 3D map of Mesopotamia in the reign of Hammurabi of Babylon (c. 1792–1750 BC,
Middle Chronology). It is meant to give a feel for the geography of the region and for the
size of its cities. Every city footprint is drawn at true horizontal scale, and you can drop a
modern place such as Central Park or the City of London next to it for comparison.

Built with [three.js](https://threejs.org) and [Vite](https://vitejs.dev). It uses no UI framework.

## Features

- **Terrain**: a real elevation model with a hillshaded relief texture. Vertical exaggeration
  can be set from 1× to 40× (default 15×). A low-resolution heightmap loads first and is
  replaced by the full-resolution one in the background. Includes a sea plane at 0 m, sky, haze
  and map-style controls.
- **Ancient water**: the reconstructed river courses of c. 1750 BC (Euphrates, Tigris, Diyala,
  Khabur, Karun…) are drawn as glowing lines on the terrain, with canals dashed. The ancient
  head of the Gulf and the southern marshes are shown as water. The terrain under the ancient
  sea is lowered in the shader so the water shows through. Use **Ancient / Modern** to compare
  the two coastlines.
- **Cities**: each footprint is a translucent filled area with a raised wall outline, coloured
  by polity. Walls are drawn as 15 m × exaggeration. Labels are sized by importance and
  decluttered as you zoom. Click a city to fly to it and open a panel with its Akkadian name,
  modern location, area (ha, km², and how it compares to Central Park), population range,
  description, what happened there under Hammurabi, and sources.
- **Scale tools**:
  - **Compare scale**: in the city panel, place a modern reference footprint beside the city
    or over it, at the same scale.
  - **Measure distance**: click two points to get the great-circle distance, plus travel time
    on foot (25 km/day), by boat downstream (40 km/day) and towed upstream (12 km/day).
  - A **scale bar** that updates as you zoom.
- **Political timeline**: a slider from 1792 to 1750 BC, with a play button. It shows event
  cards from `timeline.json` and recolours each city by the polity that held it that year
  (see `src/conquests.js`).
- A parchment-themed UI with a legend, layer toggles, an attribution footer and a loading
  screen. On mobile, the layers panel collapses and the city panel becomes a bottom sheet.

Controls: left-drag pans, right-drag (or two fingers) rotates, the scroll wheel or a pinch
zooms. `Esc` closes the panel or the measure tool. Add `?seg=256` to the URL to use a lighter
terrain mesh on slow GPUs (the default is 1024 segments on desktop and 512 on mobile).

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
npm run preview    # serve dist/ on http://localhost:4173
```

Docker (multi-stage: node:22-alpine build → nginx:alpine, port 80):

```bash
docker build -t mesopotamia-3d .
docker run --rm -p 8080:80 mesopotamia-3d   # http://localhost:8080
```

`nginx.conf` turns on gzip. It caches the hashed `/assets/` for one year (immutable) and
`/terrain/` for one day.

## Data and how it is loaded

`CONTRACT.md` defines the projection and data formats. The projection is equirectangular
around 44°E, 33°N, with world units in kilometres.

| Data | Location | How it is loaded |
|---|---|---|
| Heightmap (Terrarium PNG), relief texture, `terrain.json` | `public/terrain/` | **fetched at runtime** from `./terrain/` (copied verbatim into `dist/`) |
| `cities.json`, `polities.json`, `timeline.json`, `references.json` | `src/data/` | **bundled at build time** with `import.meta.glob('./data/*.json', {eager:true})` |
| `rivers.geojson`, `coast.geojson` | `src/data/` | bundled at build time with `import.meta.glob('./data/*.geojson', {eager:true, query:'?raw'})`, then `JSON.parse` |

Because both paths use `import.meta.glob`, a missing data file does not break the build. When
a real file is absent, the app falls back to the **temporary fixtures** in `src/fixtures/`:
three cities, two rivers and a canal, a toy coastline, and a procedural heightmap produced by
`node src/fixtures/make-fixtures.mjs`. It then shows a red "Placeholder data in use" note in
the footer. **Changing `src/data/` therefore requires a rebuild.**

Terrarium decoding: `elev_m = R*256 + G + B/256 − 32768`. The image is decoded through
`createImageBitmap(..., {colorSpaceConversion:'none'})` so the browser does not alter the
values. The decoded heights also drive the CPU-side placement of rivers, cities and the
measure tool, and a ray-marched terrain picker.

### Polity ownership over time (`src/conquests.js`)

Each city has `polity1792` and `polity1750`. `conquests.js` adds the dated changes in between,
and walks them in chronological order:

- **Polity-level rules**: Elam takes Eshnunna in 1766 and Eshnunna is restored in 1764; Larsa
  falls to Babylon in 1763, Eshnunna in 1762, and Mari and Malgium in 1761.
- **Per-city overrides**: Hammurabi takes Isin and Uruk in 1787 and Rapiqum in 1783. After
  Shamshi-Adad's death, Zimri-Lim's Mari takes over Mari, Terqa and Tuttul (1775) and Apum
  takes Shubat-Enlil (1776). Karana passes to Babylon in 1756.
- An optional `polityHistory: [{year, polity}]` per city in `cities.json` is also honoured.
- If a city still does not end at `polity1750`, the remaining change is shown at 1752 BC
  ("date uncertain").

All dates are approximate. Hammurabi's year-names give the order of events more reliably than
absolute dates.

## Sources and caveats

- Terrain: Terrain Tiles (Mapzen / AWS Open Data: SRTM, GMTED, ETOPO1). This is **modern**
  elevation. The Mesopotamian alluvium has since gained several metres of silt, and river
  courses have moved.
- Historical data, including city areas, populations, footprints, borders, river courses and
  the shoreline, are **approximate scholarly estimates with large uncertainty**. See the
  `areaNote` and `sources` for each city in the city panel.

## Code layout

```
index.html            UI shell
src/main.js           scene, camera/controls, frame loop, UI wiring
src/projection.js     contract projection, haversine, footprint → ring
src/terrain.js        Terrarium decode, heightfield sampler, terrain mesh + shader, ray picking
src/water.js          sea plane, ancient sea/marsh meshes + mask, river/canal lines + labels
src/cities.js         footprints, markers, labels, declutter, picking
src/tools.js          measure tool, compare-scale tool, scale bar
src/conquests.js      per-year polity ownership
src/ui.js             HTML builders for the city panel, legend, timeline cards
src/style.css         parchment theme, responsive layout
src/fixtures/         TEMPORARY fallback data (used only if real files are missing)
```
