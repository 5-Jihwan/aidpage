// AidPage — H3 grid layer for pilot districts. Shows only attributes that actually have data.
import { getLang } from './i18n.js?v=20260912a';
export const ATTRS = [
  { id: 'shelter_min_walk', ko: '가까운 대피소 도보(분)', en: 'Walk to shelter (min)', unit: '분', unit_en: 'min', ramp: ['#eef2f8', '#9a7328'],
    def: '셀 가운데에서 가장 가까운 민방위 대피소까지 걸어가는 데 걸리는 추정 시간. 위험이 아니라 "대피에 걸리는 시간"입니다.', def_en: 'Estimated walking time from the cell centre to the nearest civil-defence shelter. Not a hazard — a measure of evacuation time.',
    dark: '대피소가 멀다', dark_en: 'shelter is farther', src: '민방위 대피소 목록(국민안전24) · 직선거리 ÷ 67 m/분, 길·경사 미반영', src_en: 'civil-defence shelter list · straight line ÷ 67 m/min, no roads or slope' },
  { id: 'slope_mean', ko: '평균 경사', en: 'Mean slope', unit: '°', ramp: ['#eef2f8', '#9a7328'],
    def: '셀 안 지표면 기울기의 평균. 가파를수록 산사태·토사 유출 조건에 가깝습니다.', def_en: 'Mean ground slope inside the cell. Steeper cells are closer to landslide and debris-flow conditions.',
    dark: '가파르다', dark_en: 'steeper', src: 'Copernicus GLO-30 지표모델(30 m) — 건물·수목 높이가 섞여 도심은 과장될 수 있음', src_en: 'Copernicus GLO-30 surface model (30 m) — includes buildings and trees, so urban slopes may be overstated' },
  { id: 'elev_mean', ko: '평균 고도', en: 'Mean elevation', unit: 'm', ramp: ['#eef2f8', '#1a5fc4'],
    def: '셀의 평균 해발고도. 주변보다 낮은 곳일수록 물이 모이기 쉽습니다.', def_en: 'Mean elevation of the cell. Lower ground collects water more easily.',
    dark: '높다 (침수 조건은 옅은 쪽)', dark_en: 'higher (flood-prone is the pale end)', src: 'Copernicus GLO-30 지표모델(30 m)', src_en: 'Copernicus GLO-30 surface model (30 m)' },
  { id: 'flood_hist_n', ko: '침수 이력(회)', en: 'Flood history', unit: '', ramp: ['#eef2f8', '#0f4a9e'],
    def: '2010년 이후 이 셀에서 침수가 기록된 연도 수. 신고·조사된 침수만 담겨 있어 0이 안전을 뜻하지 않습니다.', def_en: 'Number of years since 2010 with a recorded flood in this cell. Only reported/surveyed floods are included — zero does not mean safe.',
    dark: '기록된 침수가 많다', dark_en: 'more recorded floods', src: '행안부 침수흔적도(전국) · 서울시 침수흔적도 2010~2025', src_en: 'MOIS nationwide flood-trace maps · Seoul flood-trace maps 2010–2025' },
  { id: 'flood_depth_max_m', ko: '최대 침수심', en: 'Max flood depth', unit: 'm', ramp: ['#eef2f8', '#0f4a9e'],
    def: '기록된 침수 가운데 가장 깊었던 침수심. 침수심이 적힌 자료만 반영됩니다.', def_en: 'Deepest recorded flood depth in the cell. Only records that carry a depth are used.',
    dark: '깊었다', dark_en: 'deeper', src: '침수흔적도(침수심 포함분)', src_en: 'flood-trace maps with depth' },
  { id: 'landslide_hist_n', ko: '산사태 이력(건)', en: 'Landslide history', unit: '', ramp: ['#eef2f8', '#7a4a12'],
    def: '이 셀에서 기록된 산사태 발생 건수. 기록된 것만 담겨 0이 안전을 뜻하지 않습니다.', def_en: 'Recorded landslide occurrences in the cell. Records only — zero does not mean safe.',
    dark: '기록이 많다', dark_en: 'more records', src: '행안부 산사태 발생이력', src_en: 'MOIS landslide occurrence records' },
  { id: 'semi_basement_r', ko: '반지하 비율', en: 'Semi-basement share', unit: '%', ramp: ['#eef2f8', '#c2447e'], pct: true,
    def: '주거용 반지하 가구가 전체 가구에서 차지하는 비율.', def_en: 'Share of households living in semi-basements.',
    dark: '비율이 높다', dark_en: 'higher share', src: '건축HUB(자료 승인 대기)', src_en: 'Building HUB (data approval pending)' },
  { id: 'elderly_alone_r', ko: '고령 1인세대 비율 (행정동)', en: 'Elderly living alone (dong)', unit: '%', ramp: ['#eef2f8', '#c2447e'], pct: true,
    def: '65세 이상 1인세대가 전체 세대에서 차지하는 비율. 행정동 값을 그 동의 모든 셀에 같이 적었으므로 한 동 안에서는 셀마다 다르지 않습니다.', def_en: 'Share of one-person households aged 65+. The dong value is stamped on every cell of that dong, so cells inside one dong look alike.',
    dark: '비율이 높다 (대피 도움이 더 필요한 사람의 규모)', dark_en: 'higher share (more people who may need evacuation help)', src: '행안부 주민등록(행정동)', src_en: 'MOIS resident registration by dong' },
  { id: 'bldg_age30_r', ko: '30년 이상 건물 비율', en: 'Buildings 30y+', unit: '%', ramp: ['#eef2f8', '#9a7328'], pct: true,
    def: '지은 지 30년이 넘은 건물의 비율.', def_en: 'Share of buildings older than 30 years.',
    dark: '오래된 건물이 많다', dark_en: 'more old buildings', src: '건축HUB(자료 승인 대기)', src_en: 'Building HUB (data approval pending)' },
  { id: 'pop', ko: '인구 (행정동 전체)', en: 'Population (whole dong)', unit: '', ramp: ['#eef2f8', '#14202e'],
    def: '이 셀이 속한 행정동 전체 인구. 셀 하나의 인구가 아니며, 위험 지표가 아니라 "규모"입니다.', def_en: 'Population of the whole dong the cell belongs to. Not per-cell, and not a hazard — a measure of scale.',
    dark: '동 인구가 많다', dark_en: 'larger dong population', src: '행안부 주민등록(행정동)', src_en: 'MOIS resident registration by dong' },
];
const cache = new Map(); let map = null, current = null, attr = null;

export function initGrid(m) { map = m; }
export async function hasGrid(sgg) {
  if (cache.has(sgg)) return !!cache.get(sgg);
  try { let r = await fetch(`data/grid/${sgg}.geojson`, { cache: 'force-cache' }); if (!r.ok) r = await fetch(`data/grid/${sgg}.geojson`, { cache: 'reload' }); const fc = r.ok ? await r.json() : null; cache.set(sgg, fc); return !!fc; } catch { cache.set(sgg, null); return false; }
}
export function cells(sgg) { const fc = cache.get(sgg); return fc ? fc.features : []; }
export function meta(sgg) { const fc = cache.get(sgg); return fc ? (fc.meta || {}) : {}; }
export function available(sgg) {
  const fc = cache.get(sgg); if (!fc) return [];
  return ATTRS.filter(a => fc.features.some(f => f.properties[a.id] != null));
}
function ensure() {
  if (map.getSource('grid')) return;
  map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'h3' });
  map.addLayer({ id: 'grid-fill', type: 'fill', source: 'grid', paint: { 'fill-color': '#ccc', 'fill-opacity': 0.55 } }, 'sgg-line');
  map.addLayer({ id: 'grid-line', type: 'line', source: 'grid', paint: { 'line-color': '#fff', 'line-width': 0.6, 'line-opacity': 0.8 } }, 'sgg-line');
  // 입체 압출(3D 모드 전용 옵션) — 값이 높은 셀이 솟아오르는 헥사 기둥. 기본 숨김.
  map.addLayer({ id: 'grid-3d', type: 'fill-extrusion', source: 'grid', layout: { visibility: 'none' },
    paint: { 'fill-extrusion-color': '#ccc', 'fill-extrusion-height': 0, 'fill-extrusion-opacity': 0.78 } }, 'sgg-line');
  map.on('mouseenter', 'grid-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'grid-fill', () => map.getCanvas().style.cursor = '');
}
/** 3D 모드에서 격자 기둥 표시 토글 — 색·높이는 show()가 속성마다 갱신 */
export function setExtrude(on) {
  if (map && map.getLayer('grid-3d')) map.setLayoutProperty('grid-3d', 'visibility', on ? 'visible' : 'none');
}
/* 색 경계값. step 표현식은 입력이 '엄격히 오름차순'이어야 한다 — 분위수가 겹치면
   (침수·산사태 이력처럼 값이 0에 몰린 속성) MapLibre가 표현식을 통째로 거부해
   fill-color가 설정되지 않고 격자가 아예 안 칠해진다. 겹치면 서로 다른 값으로 대체한다. */
function breaksFor(vals, n = 5) {
  const v = vals.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return [];
  const cand = [...new Set(Array.from({ length: n - 1 }, (_, i) => v[Math.floor((i + 1) * v.length / n)]))].sort((a, b) => a - b);
  if (cand.length >= n - 1) return cand;
  const d = [...new Set(v)].sort((a, b) => a - b);
  if (d.length <= 1) return [];
  const want = Math.min(n - 1, d.length - 1), out = [];
  for (let i = 1; i <= want; i++) { const x = d[Math.round(i * (d.length - 1) / want)]; if (!out.length || x > out[out.length - 1]) out.push(x); }
  return out;
}
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join(''); }
export function show(sgg, attrId) {
  const fc = cache.get(sgg); if (!fc || !map) return null; ensure(); current = sgg; attr = attrId;
  map.getSource('grid').setData(fc);
  const a = ATTRS.find(x => x.id === attrId); if (!a) { map.setPaintProperty('grid-fill', 'fill-color', '#c9d2e0'); return null; }
  const breaks = breaksFor(fc.features.map(f => f.properties[attrId]));
  const n = breaks.length + 1;
  const colors = Array.from({ length: n }, (_, i) => mix(a.ramp[0], a.ramp[1], n === 1 ? 1 : i / (n - 1)));
  // 경계가 없으면(값이 전부 같음) step을 쓸 수 없다 — 단색으로 칠한다.
  const paint = breaks.length ? ['step', ['to-number', ['get', attrId]], colors[0], ...breaks.flatMap((q, i) => [q, colors[i + 1]])] : colors[0];
  const colorExpr = ['case', ['==', ['get', attrId], null], '#d9dee7', paint];
  map.setPaintProperty('grid-fill', 'fill-color', colorExpr);
  // 압출 높이 = 값/최대값 × 2200m (셀 폭 ~350m 대비 읽히는 비율). null 셀은 0.
  const vmax = Math.max(...fc.features.map(f => f.properties[attrId]).filter(x => x != null), 0);
  map.setPaintProperty('grid-3d', 'fill-extrusion-color', colorExpr);
  map.setPaintProperty('grid-3d', 'fill-extrusion-height',
    vmax > 0 ? ['case', ['==', ['get', attrId], null], 0, ['*', ['/', ['to-number', ['get', attrId]], vmax], 2200]] : 0);
  const only = breaks.length ? null : (fc.features.map(f => f.properties[attrId]).find(x => x != null) ?? null);
  return { attr: a, breaks, colors, only };
}
export function hide() { if (map && map.getSource('grid')) map.getSource('grid').setData({ type: 'FeatureCollection', features: [] }); current = null; }
export function fmt(a, v) { if (v == null) return '—'; const x = a.pct ? v * 100 : v; const u = getLang() === 'en' ? (a.unit_en || a.unit) : a.unit; return (Math.round(x * 10) / 10).toLocaleString() + (u ? ' ' + u : ''); }
