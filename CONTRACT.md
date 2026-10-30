# Data contract (shared by all agents)

Projection: equirectangular around lon0=44.0, lat0=33.0. World units = kilometres.
  x =  (lon - 44.0) * 111.32 * cos(33°)   (east +)
  z = -(lat - 33.0) * 110.574             (south +, Three.js convention)
  y = elevation in km * verticalExaggeration (default 15)
Map bbox: lon 37.5 .. 50.5, lat 28.5 .. 38.5

## public/terrain/  (owned by terrain agent)
- height.png  : RGB "Terrarium" encoding: elev_m = R*256 + G + B/256 - 32768.
                Equirectangular over the bbox exactly; row 0 = north (lat 38.5), col 0 = west (lon 37.5).
- terrain.json: {"bbox":{"west":37.5,"east":50.5,"south":28.5,"north":38.5},"width":W,"height":H,
                 "minElevation":m,"maxElevation":m,"encoding":"terrarium","source":"..."}
- (optional) relief.jpg: hillshade/colour texture at same extent.

## src/data/  (owned by history agent)
- cities.json : array of
  {"id":"babylon","name":"Babylon","akkadian":"Bābilim","modernName":"Hillah, Iraq",
   "lat":32.536,"lon":44.421,
   "areaHa":number|null,               // walled/occupied area during Old Babylonian period (~1800-1750 BC) best estimate
   "areaNote":"string",                // uncertainty / which period the number is from
   "populationEstimate":{"low":n,"high":n}|null,
   "footprint":{"type":"rect"|"ellipse"|"polygon","widthKm":n,"heightKm":n,"rotationDeg":n,"pointsKm":[[x,y],...]}, // approximate shape at true scale, local km, x east, y north
   "polity":"babylon",                 // id into polities.json
   "tier":1|2|3,                       // importance for label size
   "founded":"string","description":"2-4 sentences","hammurabiEra":"what happened here 1792-1750 BC",
   "sources":["..."]}
- polities.json: array of {"id","name","ruler","color":"#hex","capital":"cityId","description","status1792":"...","status1750":"..."}
- rivers.geojson: FeatureCollection of LineStrings, properties {"name","kind":"river"|"canal"|"branch","ancient":true,"note"}
     ancient courses c.1750 BC (Euphrates, Tigris, Diyala, Khabur, Balikh, Karun, Karkheh, Zab, major canals/branches)
- coast.geojson: FeatureCollection with Polygon of the approximate Gulf + marsh extent c.1750 BC, properties {"kind":"sea"|"marsh","note"}
- timeline.json: array of {"year":-1792,"title","text","cities":["babylon",...]} covering Hammurabi's reign
- references.json: modern scale references {"id","name","areaHa","footprint":{...same as city}} e.g. Central Park, City of London, Vatican, Manhattan
