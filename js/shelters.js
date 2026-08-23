// SafePic — shelters layer (대피소·쉼터). Loads lazily; silent when data is absent.
const KINDS = [
  { id: 'civil_defense', ko: '민방위 대피시설', en: 'Civil-defense shelter', color: '#1a5fc4', icon: '🛡️' },
  { id: 'heat', ko: '무더위쉼터', en: 'Cooling center', color: '#c2447e', icon: '☀️' },
  { id: 'cold', ko: '한파쉼터', en: 'Warming center', color: '#0f9d7a', icon: '❄️' },
  { id: 'quake', ko: '지진옥외대피장소', en: 'Earthquake assembly site', color: '#9a7328', icon: '🏞️' },
  { id: 'temp_housing', ko: '이재민 임시주거시설', en: 'Temporary housing', color: '#566577', icon: '🏫' },
  { id: 'flood', ko: '수해 대피소', en: 'Flood shelter', color: '#0f4a9e', icon: '🌊' },
];
const cache = new Map(); // kind -> FeatureCollection | null
let index = null; // optional split index {kind:{sido_code:path}}
let map = null, activeKinds = new Set(), currentSido = null;

// big files: reuse the HTTP cache; but never trust a cached 404 (a stale miss from before a deploy) — refetch with 'reload'
async function getJSON(url, big = false) {
  try {
    let r = await fetch(url, { cache: big ? 'force-cache' : 'no-cache' });
    if (!r.ok && big) r = await fetch(url, { cache: 'reload' });
    if (!r.ok) return null; return await r.json();
  } catch { return null; }
}

export async function initShelters(m) {
  map = m;
  index = await getJSON('data/shelters/index.json');
  const avail = [];
  for (const k of KINDS) {
    if (index && index[k.id]) { avail.push(k); continue; }
    const r = await fetch(`data/shelters/${k.id}.geojson`, { method: 'HEAD', cache: 'no-cache' }).catch(() => null);
    if (r && r.ok) avail.push(k);
  }
  return avail; // kinds with data
}
async function load(kind, sido) {
  const key = index && index[kind] ? `${kind}/${sido}` : kind;
  if (cache.has(key)) return cache.get(key);
  let fc = null;
  if (index && index[kind]) { const p = index[kind][sido]; fc = p ? await getJSON('data/shelters/' + p, true) : { type: 'FeatureCollection', features: [] }; }
  else fc = await getJSON(`data/shelters/${kind}.geojson`, true);
  cache.set(key, fc); return fc;
}
function ensureLayer(kind) {
  const k = KINDS.find(x => x.id === kind); const src = 'sh-' + kind;
  if (map.getSource(src)) return;
  map.addSource(src, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: src + '-dot', type: 'circle', source: src, minzoom: 9, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 6, 16, 9], 'circle-color': k.color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2, 'circle-opacity': 0.9 } });
  map.addLayer({ id: src + '-label', type: 'symbol', source: src, minzoom: 13.5, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } });
  map.on('mouseenter', src + '-dot', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', src + '-dot', () => map.getCanvas().style.cursor = '');
  map.on('click', src + '-dot', e => {
    const p = e.features[0].properties;
    const html = `<b>${p.name || ''}</b><br><small>${k.icon} ${k.ko}${p.cap ? ` · ${p.cap}명` : ''}<br>${p.addr || ''}</small>`; map.openPopup ? map.openPopup(e.lngLat, html) : new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
}
export async function setActive(kinds, sido) {
  activeKinds = new Set(kinds); currentSido = sido;
  for (const k of KINDS) {
    const src = 'sh-' + k.id;
    if (!activeKinds.has(k.id)) { if (map.getSource(src)) map.getSource(src).setData({ type: 'FeatureCollection', features: [] }); continue; }
    ensureLayer(k.id);
    const fc = await load(k.id, sido);
    if (fc && map.getSource(src)) map.getSource(src).setData(fc);
  }
}
const R = 6371000;
function dist(a, b) { const toR = x => x * Math.PI / 180; const dLat = toR(b[1] - a[1]), dLon = toR(b[0] - a[0]); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
/** nearest N shelters of the active kinds to [lon,lat]; walking minutes at 67 m/min */
export async function nearest(lonlat, kinds, sido, n = 3) {
  const out = [];
  for (const kind of kinds) {
    const fc = await load(kind, sido); if (!fc) continue;
    const k = KINDS.find(x => x.id === kind);
    for (const f of fc.features) { const d = dist(lonlat, f.geometry.coordinates); if (d < 5000) out.push({ kind, k, d, walk: Math.round(d / 67), p: f.properties, c: f.geometry.coordinates }); }
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}
export { KINDS };
