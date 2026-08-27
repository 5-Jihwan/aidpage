// AidPage — shelters layer (대피소·쉼터). Loads lazily; silent when data is absent.
const KINDS = [
  { id: 'civil_defense', ko: '민방위 대피시설', en: 'Civil-defense shelter', color: '#1a5fc4', icon: '🛡️' },
  { id: 'heat', ko: '무더위쉼터', en: 'Cooling center', color: '#c2447e', icon: '☀️' },
  { id: 'cold', ko: '한파쉼터', en: 'Warming center', color: '#0f9d7a', icon: '❄️' },
  { id: 'quake', ko: '지진옥외대피장소', en: 'Earthquake assembly site', color: '#9a7328', icon: '🏞️' },
  { id: 'temp_housing', ko: '이재민 임시주거시설', en: 'Temporary housing', color: '#566577', icon: '🏫' },
  { id: 'tsunami', ko: '지진해일 대피소', en: 'Tsunami shelter', color: '#0f4a9e', icon: '🌊' },
  { id: 'townhall', ko: '주민센터(피해신고)', en: 'Community center (damage report)', color: '#1a5fc4', icon: '🏛️' },
  { id: 'er', ko: '응급의료센터', en: 'Emergency room', color: '#c8432b', icon: '🏥' },
  { id: 'pharmacy', ko: '약국', en: 'Pharmacy', color: '#c2447e', icon: '💊' },
  { id: 'fire', ko: '소방서·119안전센터', en: 'Fire station', color: '#c8432b', icon: '🚒' },
  { id: 'police', ko: '경찰서·지구대', en: 'Police', color: '#14202e', icon: '🚓' },
  { id: 'meal', ko: '무료급식소', en: 'Free meal site', color: '#9a7328', icon: '🍚' },
  { id: 'water', ko: '비상급수시설', en: 'Emergency water', color: '#0f9d7a', icon: '🚰' },
  { id: 'dust', ko: '미세먼지쉼터', en: 'Clean-air shelter', color: '#566577', icon: '😷' },
  { id: 'chem', ko: '화학사고 대피소', en: 'Chemical-accident shelter', color: '#6b4f00', icon: '🧪' },
  { id: 'health', ko: '보건소', en: 'Public health center', color: '#0f9d7a', icon: '🩺' },
  // hazard points (not facilities): drawn as small triangles-ish dots in warm colors
  { id: 'steep', ko: '급경사지(붕괴위험 관리지점)', en: 'Steep slope (managed risk site)', color: '#c8432b', icon: '⛰️', hazard: true },
  { id: 'wildfire_hist', ko: '산불 발생 이력(2013~)', en: 'Wildfire history (2013–)', color: '#e0701a', icon: '🔥', hazard: true },
  { id: 'underpass', ko: '지하차도(호우 시 진입 금지)', en: 'Road underpass (avoid in heavy rain)', color: '#0f4a9e', icon: '🚇', hazard: true },
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
/* 시설 아이콘: 흰 원 + 시설색 링 + 이모지 (색점만으로는 종류 구분이 어렵다는 피드백 반영) */
function ensureIcon(k) {
  const name = 'sh-ic-' + k.id;
  if (map.hasImage(name)) return name;
  const c = document.createElement('canvas'); c.width = c.height = 60; const x = c.getContext('2d');
  x.beginPath(); x.arc(30, 30, 26, 0, Math.PI * 2);
  x.fillStyle = k.hazard ? '#fdf1e4' : '#fff'; x.fill();
  x.lineWidth = 4; x.strokeStyle = k.color; x.stroke();
  x.font = '28px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(k.icon, 30, 33);
  map.addImage(name, x.getImageData(0, 0, 60, 60), { pixelRatio: 2 });
  return name;
}
/* ── 통합 클러스터 소스: 같은 자리에 시설이 겹치면 대표 아이콘 + 우상단 개수 배지,
      누르면 그 자리의 시설 목록 (사용자 피드백: 겹친 아이콘 구분 불가) ── */
const KIND_IDS = KINDS.map(k => k.id);
const EMPTY_FC = { type: 'FeatureCollection', features: [] };
function detailHTML(p, lngLat) {
  const k = KINDS.find(x => x.id === p.kind) || KINDS[0];
  const en = document.documentElement.lang === 'en';
  return `<b>${p.name || ''}</b><br><small>${k.icon} ${en ? k.en : k.ko}${p.cap ? ` · ${p.cap}${en ? '' : '명'}` : ''}${p.type && !/^\d|^FTL|^\d{3}$/.test(p.type) ? ` · ${p.type}` : ''}<br>${p.addr || ''}${p.hours ? `<br>🕒 ${p.hours}` : ''}${p.tel ? `<br>📞 <a href="tel:${p.tel}">${p.tel}</a>` : ''}</small>${map.routeLinks ? map.routeLinks(lngLat.lng, lngLat.lat, p.name) : ''}${map.srcBadge ? map.srcBadge(p.src, p.asof) : ''}`;
}
function openPopup(lngLat, html) {
  if (map.openPopup) return map.openPopup(lngLat, html);
  const pop = new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(lngLat).addTo(map);
  if (typeof html === 'string') pop.setHTML(html); else pop.setDOMContent(html);
  return pop;
}
function ensureAll() {
  if (map.getSource('sh-all')) return;
  KINDS.forEach(ensureIcon);
  map.addSource('sh-all', { type: 'geojson', data: EMPTY_FC, cluster: true, clusterRadius: 22, clusterMaxZoom: 24,
    clusterProperties: { ki: ['min', ['get', 'ki']] } });
  const iconSize = ['interpolate', ['linear'], ['zoom'], 9, 0.45, 12, 0.75, 16, 1.05];
  map.addLayer({ id: 'sh-pt', type: 'symbol', source: 'sh-all', minzoom: 9, filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': ['concat', 'sh-ic-', ['get', 'kind']], 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-padding': 0 }, paint: { 'icon-opacity': 0.95 } });
  map.addLayer({ id: 'sh-cluster', type: 'symbol', source: 'sh-all', minzoom: 9, filter: ['has', 'point_count'],
    layout: { 'icon-image': ['concat', 'sh-ic-', ['at', ['get', 'ki'], ['literal', KIND_IDS]]], 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-padding': 0 }, paint: { 'icon-opacity': 0.95 } });
  map.addLayer({ id: 'sh-cluster-badge', type: 'circle', source: 'sh-all', minzoom: 9, filter: ['has', 'point_count'],
    paint: { 'circle-radius': 8, 'circle-color': '#c8432b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-translate': [11, -11] } });
  map.addLayer({ id: 'sh-cluster-count', type: 'symbol', source: 'sh-all', minzoom: 9, filter: ['has', 'point_count'],
    layout: { 'text-field': ['case', ['>', ['get', 'point_count'], 9], '9+', ['to-string', ['get', 'point_count']]], 'text-size': 10, 'text-font': ['Noto Sans Regular'], 'text-offset': [1.1, -1.1], 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
  map.addLayer({ id: 'sh-label', type: 'symbol', source: 'sh-all', minzoom: 13.5, filter: ['!', ['has', 'point_count']],
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } });
  map.on('mouseenter', 'sh-pt', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'sh-pt', () => map.getCanvas().style.cursor = '');
  map.on('click', 'sh-pt', e => { unspiderfy(); openPopup(e.lngLat, detailHTML(e.features[0].properties, e.lngLat)); });
  // 클러스터: 마우스를 올리면 우측으로 가로 펼침 (터치는 탭). 아이콘 쪽으로 옮겨가도 유지.
  map.on('mouseenter', 'sh-cluster', e => { map.getCanvas().style.cursor = 'pointer'; spiderFromEvent(e); });
  map.on('mouseleave', 'sh-cluster', () => { map.getCanvas().style.cursor = ''; scheduleCollapse(); });
  map.on('click', 'sh-cluster', e => spiderFromEvent(e, true));
  map.on('zoomstart', unspiderfy);
  map.on('dragstart', unspiderfy);
  map.on('click', e => { const ls = ['sh-cluster'].filter(l => map.getLayer(l)); if (!ls.length || !map.queryRenderedFeatures(e.point, { layers: ls }).length) unspiderfy(); });
}
/* ── 스파이더파이: 겹친 시설을 옆으로 펼쳐 무엇이 있는지 보여준다 ── */
let _spider = null, _spiderId = null, _spiderTimer = null;
function unspiderfy() { clearTimeout(_spiderTimer); if (!_spider) return; _spider.forEach(m => m.remove()); _spider = null; _spiderId = null; }
function scheduleCollapse() { clearTimeout(_spiderTimer); _spiderTimer = setTimeout(unspiderfy, 450); }
function cancelCollapse() { clearTimeout(_spiderTimer); }
async function spiderFromEvent(e, isClick = false) {
  const f = e.features && e.features[0]; if (!f) return;
  const src = map.getSource('sh-all');
  const n = f.properties.point_count;
  try {
    if (isClick && n > 10) { // 대량 뭉침은 클릭 시 그 지점으로 줌인
      const z = await src.getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: e.lngLat, zoom: Math.min(z, 17.5) });
      return;
    }
    if (_spiderId === f.properties.cluster_id) { cancelCollapse(); return; } // 이미 펼쳐짐
    const leaves = await src.getClusterLeaves(f.properties.cluster_id, 10, 0);
    spiderfy(e.lngLat, leaves, f.properties.cluster_id);
  } catch { /* cluster gone */ }
}
function spiderfy(lngLat, leaves, clusterId) {
  unspiderfy();
  _spiderId = clusterId;
  const n = leaves.length;
  // 화면 오른쪽 공간이 모자라면 왼쪽으로 펼침
  const px = map.project(lngLat).x;
  const need = 30 + n * 38 + 20;
  const dir = (px + need > map.getContainer().clientWidth) ? -1 : 1;
  _spider = leaves.map((lf, i) => {
    const k = KINDS.find(x => x.id === lf.properties.kind) || KINDS[0];
    // ⚠ 마커 루트에 transform 애니메이션 금지 (MapLibre 위치 transform을 덮음) → 루트/아이콘 분리
    const root = document.createElement('div');
    const el = document.createElement('div');
    el.className = 'spider-ic';
    el.style.borderColor = k.color;
    if (k.hazard) el.style.background = '#fdf1e4';
    el.textContent = k.icon;
    el.title = lf.properties.name || (document.documentElement.lang === 'en' ? k.en : k.ko);
    el.style.animationDelay = `${i * 30}ms`;
    root.appendChild(el);
    root.addEventListener('mouseenter', cancelCollapse);
    root.addEventListener('mouseleave', scheduleCollapse);
    root.addEventListener('click', ev => {
      ev.stopPropagation();
      const c = lf.geometry && lf.geometry.coordinates;
      openPopup(c ? { lng: c[0], lat: c[1] } : lngLat, detailHTML(lf.properties, lngLat));
    });
    return new maplibregl.Marker({ element: root, offset: [dir * (32 + i * 38), 0] })
      .setLngLat(lngLat).addTo(map);
  });
}
export async function setActive(kinds, sido) {
  activeKinds = new Set(kinds); currentSido = sido;
  unspiderfy();
  ensureAll();
  const feats = [];
  for (const k of KINDS) {
    if (!activeKinds.has(k.id)) continue;
    const fc = await load(k.id, sido);
    if (!fc) continue;
    const ki = KIND_IDS.indexOf(k.id);
    for (const f of fc.features) {
      feats.push({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties, kind: k.id, ki } });
    }
  }
  if (map.getSource('sh-all')) map.getSource('sh-all').setData({ type: 'FeatureCollection', features: feats });
}
const R = 6371000;
function dist(a, b) { const toR = x => x * Math.PI / 180; const dLat = toR(b[1] - a[1]), dLon = toR(b[0] - a[0]); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
/** nearest N shelters of the active kinds to [lon,lat]; walking minutes at 67 m/min */
export async function nearest(lonlat, kinds, sido, n = 3, perKind = false) {
  const out = [];
  for (const kind of kinds) {
    const fc = await load(kind, sido); if (!fc) continue;
    const k = KINDS.find(x => x.id === kind);
    let best = null;
    for (const f of fc.features) {
      const d = dist(lonlat, f.geometry.coordinates); if (d >= 5000) continue;
      const item = { kind, k, d, walk: Math.round(d / 67), p: f.properties, c: f.geometry.coordinates };
      if (perKind) { if (!best || d < best.d) best = item; } else out.push(item);
    }
    if (perKind && best) out.push(best);
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}
export { KINDS };
