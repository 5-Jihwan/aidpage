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
  // 인덱스에 없는 종류만 HEAD로 존재 확인 — style.load 경로라 직렬 금지, 병렬로
  const oks = await Promise.all(KINDS.map(async k => {
    if (index && index[k.id]) return true;
    const r = await fetch(`data/shelters/${k.id}.geojson`, { method: 'HEAD', cache: 'no-cache' }).catch(() => null);
    return !!(r && r.ok);
  }));
  return KINDS.filter((k, i) => oks[i]); // kinds with data, KINDS 순서 유지
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
/* 개수 배지: 숫자를 원 이미지에 구워 한 장으로 렌더 — 원(circle)과 숫자(text)를 별개 레이어로
   그리면 피치·기기 DPR에 따라 좌표계가 어긋나 숫자가 원 밖으로 이탈한다(08-31 실기기 2회 보고) */
function ensureBadge(label) {
  const name = 'sh-bdg-' + label;
  if (map.hasImage(name)) return name;
  const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d');
  x.beginPath(); x.arc(20, 20, 17, 0, Math.PI * 2);
  x.fillStyle = '#c8432b'; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
  x.fillStyle = '#fff'; x.font = '700 19px "Noto Sans KR","Malgun Gothic",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, 20, 21);
  map.addImage(name, x.getImageData(0, 0, 40, 40), { pixelRatio: 2 });
  return name;
}
const BADGE_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '9+'];
/* ── 통합 클러스터 소스: 같은 자리에 시설이 겹치면 대표 아이콘 + 우상단 개수 배지,
      누르면 그 자리의 시설 목록 (사용자 피드백: 겹친 아이콘 구분 불가) ── */
const KIND_IDS = KINDS.map(k => k.id);
const EMPTY_FC = { type: 'FeatureCollection', features: [] };
function detailHTML(p, lngLat) {
  const k = KINDS.find(x => x.id === p.kind) || KINDS[0];
  const en = document.documentElement.lang === 'en';
  return `<b>${p.name || ''}</b><br><small>${k.icon} ${en ? k.en : k.ko}${p.cap ? ` · ${p.cap}${en ? '' : '명'}` : ''}${p.type && !/^\d|^FTL|^\d{3}$/.test(p.type) ? ` · ${p.type}` : ''}<br>${p.addr || ''}${p.hours ? `<br>🕒 ${p.hours}` : ''}${p.tel ? `<br>📞 <a href="tel:${p.tel}">${p.tel}</a>` : ''}</small>${map.routeLinks ? map.routeLinks(lngLat.lng, lngLat.lat, p.name) : ''}${map.srcBadge ? map.srcBadge(p.src, p.asof) : ''}`;
}
let _popFallback = null;
function openPopup(lngLat, html) {
  if (map.openPopup) return map.openPopup(lngLat, html);
  if (_popFallback) { try { _popFallback.remove(); } catch (e) { /* gone */ } }
  const pop = new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(lngLat).addTo(map);
  if (typeof html === 'string') pop.setHTML(html); else pop.setDOMContent(html);
  _popFallback = pop;
  return pop;
}
let heatOn = false; // 표시 모드: false=아이콘·클러스터, true=밀도 히트맵 (kfood-atlas 방식, 팔레트는 AidPage)
// 히트맵 4단계 등급 밴드(범례 공용) — 연속 그라데이션은 "어디부터 많음인지" 경계가 없어
// "그냥 색칠"로 읽힌다는 피드백(09-01). 색을 등급으로 끊고 각 색에 이름을 붙인다.
// 키는 i18n legend.heat.l1~l4 (드묾·보통·많음·밀집 / sparse·moderate·high·dense).
export const HEAT_BANDS = [
  { c: '#3b82f6', key: 'legend.heat.l1' },
  { c: '#a3e635', key: 'legend.heat.l2' },
  { c: '#f97316', key: 'legend.heat.l3' },
  { c: '#dc2626', key: 'legend.heat.l4' },
];
const ICON_LAYERS = ['sh-pt', 'sh-cluster', 'sh-cluster-badge', 'sh-label'];
export function setHeatmap(on) {
  heatOn = !!on;
  if (!map || !map.getLayer('sh-heatmap')) return;
  map.setLayoutProperty('sh-heatmap', 'visibility', heatOn ? 'visible' : 'none');
  ICON_LAYERS.forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', heatOn ? 'none' : 'visible'));
}
function ensureAll() {
  if (map.getSource('sh-all')) return;
  KINDS.forEach(ensureIcon);
  map.addSource('sh-all', { type: 'geojson', data: EMPTY_FC, cluster: true, clusterRadius: 22, clusterMaxZoom: 17,
    clusterProperties: { ki: ['min', ['get', 'ki']] } });
  // 히트맵 전용 비클러스터 소스 — 클러스터 소스는 저줌에서 점이 뭉쳐 밀도가 왜곡된다
  map.addSource('sh-heat', { type: 'geojson', data: EMPTY_FC });
  // 삽입 위치 = "격자 위, 지명 라벨 아래". 첫 심볼 레이어 아래(1차 시도)는 격자(grid-fill,
  // sgg-line 아래 삽입)까지 히트맵 위로 올라와 색면이 묻혔다 — 앱 라벨(sgg/emd-label) 바로 아래가 정답.
  const firstSymbol = ['sgg-label', 'emd-label'].find(l => map.getLayer(l))
    || (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
  map.addLayer({ id: 'sh-heatmap', type: 'heatmap', source: 'sh-heat',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 0.9, 14, 1.6],
      // 반경을 키워 점별 얼룩 대신 면으로 읽히게
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 12, 9, 22, 12, 36, 15, 52],
      // 등급 밴드(step) — HEAT_BANDS와 반드시 일치(범례가 이 값·이름을 그린다).
      // 연속 보간 대신 계단으로 끊어 기상도 등고선처럼 "여기부터 다음 등급"이 보이게 한다.
      'heatmap-color': ['step', ['heatmap-density'],
        'rgba(0,0,0,0)',
        0.12, 'rgba(59,130,246,.55)',
        0.35, 'rgba(163,230,53,.7)',
        0.6, 'rgba(249,115,22,.8)',
        0.82, 'rgba(220,38,38,.9)'],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.85, 16, 0.55],
    } }, firstSymbol);
  const iconSize = ['interpolate', ['linear'], ['zoom'], 9, 0.45, 12, 0.75, 16, 1.05];
  map.addLayer({ id: 'sh-pt', type: 'symbol', source: 'sh-all', minzoom: 9, filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': ['concat', 'sh-ic-', ['get', 'kind']], 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-padding': 0 }, paint: { 'icon-opacity': 0.95 } });
  map.addLayer({ id: 'sh-cluster', type: 'symbol', source: 'sh-all', minzoom: 9, filter: ['has', 'point_count'],
    layout: { 'icon-image': ['concat', 'sh-ic-', ['at', ['get', 'ki'], ['literal', KIND_IDS]]], 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-padding': 0 }, paint: { 'icon-opacity': 0.95 } });
  BADGE_LABELS.forEach(ensureBadge);
  map.addLayer({ id: 'sh-cluster-badge', type: 'symbol', source: 'sh-all', minzoom: 9, filter: ['has', 'point_count'],
    layout: { 'icon-image': ['concat', 'sh-bdg-', ['case', ['>', ['get', 'point_count'], 9], '9+', ['to-string', ['get', 'point_count']]]],
              'icon-size': 0.9, 'icon-offset': [24, -24], 'icon-allow-overlap': true, 'icon-padding': 0 },
    paint: { 'icon-opacity': 1 } });
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
let _lastSig = null; // renderAll마다 불리므로 종류·시도·클립이 그대로면 수만 피처 재조립을 건너뛴다
/** clip = { sig, keep(lon,lat) } — 있으면 keep이 참인 시설만 지도에 올린다 (아이콘 산재 방지) */
export async function setActive(kinds, sido, clip = null) {
  const sig = [...kinds].sort().join(',') + '|' + (sido || '') + '|' + (clip ? clip.sig : '');
  if (sig === _lastSig && map.getSource('sh-all')) return;
  _lastSig = sig;
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
      const c = f.geometry.coordinates;
      if (clip && !clip.keep(c[0], c[1])) continue;
      feats.push({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties, kind: k.id, ki } });
    }
  }
  if (map.getSource('sh-all')) map.getSource('sh-all').setData({ type: 'FeatureCollection', features: feats });
  if (map.getSource('sh-heat')) map.getSource('sh-heat').setData({ type: 'FeatureCollection', features: feats });
  setHeatmap(heatOn); // 저장된 모드를 레이어 생성 후에도 유지
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
    // 5km 원을 포함하는 위경도 상자로 선별 후에만 하버사인 (수만 피처 × 삼각함수 회피)
    const dLat = 0.045, dLon = 0.045 / Math.max(Math.cos(lonlat[1] * Math.PI / 180), 0.2);
    for (const f of fc.features) {
      const c = f.geometry.coordinates;
      if (Math.abs(c[1] - lonlat[1]) > dLat || Math.abs(c[0] - lonlat[0]) > dLon) continue;
      const d = dist(lonlat, c); if (d >= 5000) continue;
      const item = { kind, k, d, walk: Math.round(d / 67), p: f.properties, c: f.geometry.coordinates };
      if (perKind) { if (!best || d < best.d) best = item; } else out.push(item);
    }
    if (perKind && best) out.push(best);
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}
export { KINDS };
