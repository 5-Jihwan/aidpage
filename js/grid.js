// SafePic — H3 grid layer for pilot districts. Shows only attributes that actually have data.
import { getLang } from './i18n.js?v=20260826g';
export const ATTRS = [
  { id: 'shelter_min_walk', ko: '가까운 대피소 도보(분)', en: 'Walk to shelter (min)', unit: '분', unit_en: 'min', ramp: ['#eef2f8', '#9a7328'] },
  { id: 'slope_mean', ko: '평균 경사', en: 'Mean slope', unit: '°', ramp: ['#eef2f8', '#9a7328'] },
  { id: 'elev_mean', ko: '평균 고도', en: 'Mean elevation', unit: 'm', ramp: ['#eef2f8', '#1a5fc4'] },
  { id: 'flood_hist_n', ko: '침수 이력(회)', en: 'Flood history', unit: '', ramp: ['#eef2f8', '#0f4a9e'] },
  { id: 'flood_depth_max_m', ko: '최대 침수심', en: 'Max flood depth', unit: 'm', ramp: ['#eef2f8', '#0f4a9e'] },
  { id: 'semi_basement_r', ko: '반지하 비율', en: 'Semi-basement share', unit: '%', ramp: ['#eef2f8', '#c2447e'], pct: true },
  { id: 'elderly_alone_r', ko: '고령 1인세대 비율 (행정동)', en: 'Elderly living alone (dong)', unit: '%', ramp: ['#eef2f8', '#c2447e'], pct: true },
  { id: 'bldg_age30_r', ko: '30년 이상 건물 비율', en: 'Buildings 30y+', unit: '%', ramp: ['#eef2f8', '#9a7328'], pct: true },
  { id: 'pop', ko: '인구 (행정동 전체)', en: 'Population (whole dong)', unit: '', ramp: ['#eef2f8', '#14202e'] },
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
  map.on('mouseenter', 'grid-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'grid-fill', () => map.getCanvas().style.cursor = '');
}
function quantiles(vals, n = 5) { const v = vals.filter(x => x != null).sort((a, b) => a - b); if (!v.length) return []; return Array.from({ length: n - 1 }, (_, i) => v[Math.floor((i + 1) * v.length / n)]); }
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join(''); }
export function show(sgg, attrId) {
  const fc = cache.get(sgg); if (!fc || !map) return null; ensure(); current = sgg; attr = attrId;
  map.getSource('grid').setData(fc);
  const a = ATTRS.find(x => x.id === attrId); if (!a) { map.setPaintProperty('grid-fill', 'fill-color', '#c9d2e0'); return null; }
  const qs = quantiles(fc.features.map(f => f.properties[attrId]));
  const colors = [0, .25, .5, .75, 1].map(t => mix(a.ramp[0], a.ramp[1], t));
  const expr = ['case', ['==', ['get', attrId], null], '#d9dee7', ['step', ['to-number', ['get', attrId]], colors[0], ...qs.flatMap((q, i) => [q, colors[i + 1]])]];
  map.setPaintProperty('grid-fill', 'fill-color', expr);
  return { attr: a, breaks: qs, colors };
}
export function hide() { if (map && map.getSource('grid')) map.getSource('grid').setData({ type: 'FeatureCollection', features: [] }); current = null; }
export function fmt(a, v) { if (v == null) return '—'; const x = a.pct ? v * 100 : v; const u = getLang() === 'en' ? (a.unit_en || a.unit) : a.unit; return (Math.round(x * 10) / 10).toLocaleString() + (u ? ' ' + u : ''); }
