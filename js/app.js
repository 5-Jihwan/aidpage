// SafePic — app.js (ES module, no build step)
import { t, getLang, setLang, applyStatic } from './i18n.js';
import { initShelters, setActive as setShelters, nearest as nearestShelters, KINDS as SHELTER_KINDS } from './shelters.js';
let loadRules = null, evaluate = null, formatKRW = n => (n || 0).toLocaleString('ko-KR') + '원';
try { const m = await import('./rules.js'); loadRules = m.loadRules; evaluate = m.evaluate; if (m.formatKRW) formatKRW = m.formatKRW; } catch (e) { console.warn('rules.js not available', e); }

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KOREA_CENTER = [127.8, 36.3];
const WX_KEYS = ['t', 'feels', 'rain', 'reh', 'wind', 'pm10', 'pm25'];

const state = {
  level: 'nation', sido: null, sgg: null, emd: null,
  geo: { sido: null, sgg: null, emd: null },
  idx: { emd: [], sgg: [], byEmd: new Map(), bySgg: new Map() },
  live: { weather: null, alerts: null, air: null },
  rules: null, meta: null, tab: 'now',
  wxsel: new Set(JSON.parse(localStorage.getItem('safepic.wxsel') || '["t","feels","rain","pm10","pm25"]')),
  lastResult: null,
  shelters: { avail: [], active: new Set(JSON.parse(localStorage.getItem('safepic.shelters') || 'null') || seasonalKinds()) },
};
function seasonalKinds() { const m = new Date().getMonth() + 1; return ['civil_defense', ...(m >= 6 && m <= 9 ? ['heat'] : m === 12 || m <= 2 ? ['cold'] : [])]; }

/* ---------- data ---------- */
async function getJSON(url, fallback = null) {
  try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw 0; return await r.json(); } catch { return fallback; }
}
async function loadCore() {
  const [sido, sgg, emdIdx, sggIdx, meta, weather, alerts, air] = await Promise.all([
    getJSON('data/admin/kr_sido.geojson'), getJSON('data/admin/kr_sgg.geojson'),
    getJSON('data/admin/emd_index.json', []), getJSON('data/admin/sgg_index.json', []),
    getJSON('data/admin/meta.json'), getJSON('data/live/weather.json'), getJSON('data/live/alerts.json'), getJSON('data/live/air.json'),
  ]);
  Object.assign(state.geo, { sido, sgg }); state.meta = meta;
  state.idx.emd = emdIdx; state.idx.sgg = sggIdx;
  emdIdx.forEach(e => state.idx.byEmd.set(String(e.code), e));
  sggIdx.forEach(s => state.idx.bySgg.set(String(s.code), s));
  Object.assign(state.live, { weather, alerts, air });
  if (meta) { $('#aboutAdmin').textContent = `${meta.source || ''} ${meta.version || ''}`.trim(); $('#buildDate').textContent = meta.built || ''; }
  if (loadRules) { try { state.rules = await loadRules('rules/'); } catch (e) { console.warn('rules load failed', e); } }
}
async function ensureEmd() {
  if (state.geo.emd) return state.geo.emd;
  state.geo.emd = await getJSON('data/admin/kr_emd.geojson', { type: 'FeatureCollection', features: [] });
  if (map.getSource('emd')) map.getSource('emd').setData(state.geo.emd);
  return state.geo.emd;
}

/* ---------- map ---------- */
let map;
function bboxOf(features) {
  const b = [180, 90, -180, -90];
  const walk = c => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  features.forEach(f => walk(f.geometry.coordinates)); return b;
}
const featuresWhere = (fc, key, val) => fc ? fc.features.filter(f => String(f.properties[key]) === String(val)) : [];

function initMap() {
  map = new maplibregl.Map({
    container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
    center: [100, 25], zoom: 1.5, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
  map.on('style.load', () => {
    try { map.setProjection({ type: 'globe' }); } catch (e) { console.warn('globe unsupported', e); }
    localizeLabels(); addAdminLayers(); initShelterUI();
    map.flyTo({ center: KOREA_CENTER, zoom: 5.6, duration: 3000, essential: true, curve: 1.3 });
    map.once('moveend', () => { $('#mapHint').textContent = t('hint.drill'); });
  });
}
/* 지명 표기: 기본 타일의 모든 라벨을 한국어(+영어) 또는 영어만으로 통일. 동해는 영어 줄도 East Sea로. */
function localizeLabels() {
  const ko = ['coalesce', ['get', 'name:ko'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const enRaw = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const en = ['case', ['in', 'Japan', ['to-string', enRaw]], 'East Sea', ['in', 'Liancourt', ['to-string', enRaw]], 'Dokdo', enRaw];
  const koFixed = ['case', ['in', 'Japan', ['to-string', ko]], '동해', ['in', '日本海', ['to-string', ko]], '동해', ['in', 'Liancourt', ['to-string', ko]], '독도', ['in', '竹島', ['to-string', ko]], '독도', ko];
  const both = ['format', koFixed, {}, '\n', {}, en, { 'font-scale': 0.8, 'text-color': '#6b7a90' }];
  const field = getLang() === 'en' ? en : ['case', ['==', ['to-string', koFixed], ['to-string', en]], koFixed, both];
  for (const l of map.getStyle().layers || []) {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
    if (['sgg-label', 'emd-label'].includes(l.id)) continue;
    try { map.setLayoutProperty(l.id, 'text-field', field); } catch (e) { /* ignore */ }
  }
}
function addAdminLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('sido', { type: 'geojson', data: state.geo.sido || empty, promoteId: 'code' });
  map.addSource('sgg', { type: 'geojson', data: state.geo.sgg || empty, promoteId: 'code' });
  map.addSource('emd', { type: 'geojson', data: state.geo.emd || empty, promoteId: 'code' });
  const op = ['case', ['boolean', ['feature-state', 'hover'], false], 0.42, ['boolean', ['feature-state', 'sel'], false], 0.34, 0.16];
  const fill = (id, src, color) => map.addLayer({ id, type: 'fill', source: src, paint: { 'fill-color': color, 'fill-opacity': op } });
  const line = (id, src, color, w) => map.addLayer({ id, type: 'line', source: src, paint: { 'line-color': color, 'line-width': w } });
  fill('sido-fill', 'sido', '#1a5fc4'); line('sido-line', 'sido', '#0f4a9e', 1.2);
  fill('sgg-fill', 'sgg', '#9a7328'); line('sgg-line', 'sgg', '#6f5119', 1);
  fill('emd-fill', 'emd', '#0f9d7a'); line('emd-line', 'emd', '#0b6e55', 0.8);
  const lbl = (id, src, minzoom, maxzoom) => map.addLayer({ id, type: 'symbol', source: src, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 }, minzoom, ...(maxzoom ? { maxzoom } : {}) });
  lbl('sgg-label', 'sgg', 8, 11.5); lbl('emd-label', 'emd', 11.5);
  // 독도·울릉도: 저배율에서도 항상 보이도록 전용 마커+라벨
  map.addSource('landmarks', { type: 'geojson', data: 'data/admin/landmarks.geojson' });
  map.addLayer({ id: 'landmark-dot', type: 'circle', source: 'landmarks', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 6], 'circle-color': '#1a5fc4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }, minzoom: 3.5, maxzoom: 11 });
  map.addLayer({ id: 'landmark-label', type: 'symbol', source: 'landmarks', layout: { 'text-field': getLang() === 'en' ? ['get', 'en'] : ['format', ['get', 'ko'], {}, '\n', {}, ['get', 'en'], { 'font-scale': 0.8, 'text-color': '#6b7a90' }], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 0.9], 'text-anchor': 'top' }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 }, minzoom: 3.5 });
  setLevelFilters();

  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; $('#map').appendChild(tip);
  let hover = { src: null, id: null };
  const setHover = (src, id) => {
    if (hover.id != null) map.setFeatureState({ source: hover.src, id: hover.id }, { hover: false });
    hover = { src, id }; if (id != null) map.setFeatureState({ source: src, id }, { hover: true });
    map.getCanvas().style.cursor = id != null ? 'pointer' : '';
  };
  for (const lv of ['sido', 'sgg', 'emd']) {
    map.on('mousemove', `${lv}-fill`, e => {
      const f = e.features[0]; if (!f) return; setHover(lv, f.id);
      const top = map.queryRenderedFeatures(e.point, { layers: ['emd-fill', 'sgg-fill', 'sido-fill'] })[0];
      if (top && top.layer.id === `${lv}-fill`) { tip.hidden = false; tip.innerHTML = `${f.properties.name}<small>${t('lv.' + lv)} · ${t('tip.click')} ${lv === 'emd' ? t('tip.summary') : t('tip.enter')}</small>`; tip.style.left = e.point.x + 'px'; tip.style.top = e.point.y + 'px'; }
    });
    map.on('mouseleave', `${lv}-fill`, () => { setHover(lv, null); tip.hidden = true; });
  }
  map.on('click', 'emd-fill', e => { const f = e.features[0]; if (f) selectEmd(f.properties.code); });
  map.on('click', 'sgg-fill', e => { if (map.queryRenderedFeatures(e.point, { layers: ['emd-fill'] }).length) return; const f = e.features[0]; if (f) selectSgg(f.properties.code); });
  map.on('click', 'sido-fill', e => { if (map.queryRenderedFeatures(e.point, { layers: ['sgg-fill', 'emd-fill'] }).length) return; const f = e.features[0]; if (f) selectSido(f.properties.code); });
  map.on('click', () => $('#mapHint').classList.add('is-hidden'));
}
function setLevelFilters() {
  if (!map || !map.getLayer('sgg-fill')) return;
  const sggF = state.sido ? ['==', ['get', 'sido_code'], String(state.sido)] : ['==', 1, 0];
  const emdF = state.sgg ? ['==', ['get', 'sgg_code'], String(state.sgg)] : ['==', 1, 0];
  ['sgg-fill', 'sgg-line', 'sgg-label'].forEach(l => map.setFilter(l, sggF));
  ['emd-fill', 'emd-line', 'emd-label'].forEach(l => map.setFilter(l, emdF));
  map.setPaintProperty('sido-fill', 'fill-opacity', state.sido ? 0.04 : ['case', ['boolean', ['feature-state', 'hover'], false], 0.42, 0.16]);
}
function fitTo(features) {
  if (!features.length) return;
  const b = bboxOf(features), mobile = matchMedia('(max-width:900px)').matches;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: mobile ? { top: 120, bottom: innerHeight * 0.58, left: 20, right: 20 } : { top: 90, bottom: 60, left: ($('#panel').classList.contains('is-collapsed') ? 0 : parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 460) + 60, right: 80 }, duration: 900 });
}

/* ---------- selection ---------- */
function selectSido(code) {
  Object.assign(state, { level: 'sido', sido: String(code), sgg: null, emd: null });
  setLevelFilters(); fitTo(featuresWhere(state.geo.sido, 'code', code)); renderAll(); ensureEmd();
}
async function selectSgg(code) {
  const s = state.idx.bySgg.get(String(code));
  Object.assign(state, { level: 'sgg', sgg: String(code), emd: null, sido: s ? String(s.sido) : state.sido });
  await ensureEmd(); setLevelFilters(); fitTo(featuresWhere(state.geo.sgg, 'code', code)); renderAll();
}
async function selectEmd(code) {
  const e = state.idx.byEmd.get(String(code)); if (!e) return;
  Object.assign(state, { level: 'emd', emd: String(code), sgg: String(e.sgg), sido: String(e.sido) });
  await ensureEmd(); setLevelFilters();
  const fs = featuresWhere(state.geo.emd, 'code', code); if (fs.length) fitTo(fs); else map.flyTo({ center: [e.lon, e.lat], zoom: 13 });
  if (map.getSource('emd')) { state.geo.emd.features.forEach(f => map.setFeatureState({ source: 'emd', id: f.properties.code }, { sel: false })); map.setFeatureState({ source: 'emd', id: String(code) }, { sel: true }); }
  renderAll(); syncWizardLoc();
}
function resetNation() {
  Object.assign(state, { level: 'nation', sido: null, sgg: null, emd: null });
  setLevelFilters(); map.flyTo({ center: KOREA_CENTER, zoom: 5.6, duration: 900 }); renderAll();
}
function renderAll() { renderCrumb(); renderRegion(); renderLive(); syncShelterLayers(); }
async function initShelterUI() {
  state.shelters.avail = await initShelters(map);
  const box = $('#shsel'); if (!state.shelters.avail.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<button type="button" class="wxsel-t mono" id="shselT">${t('sh.title')}</button>` + state.shelters.avail.map(k => `<label><input type="checkbox" value="${k.id}" ${state.shelters.active.has(k.id) ? 'checked' : ''}><span>${k.icon} ${getLang() === 'en' ? k.en : k.ko}</span></label>`).join('');
  $('#shselT').addEventListener('click', () => box.classList.toggle('is-open'));
  $$('input', box).forEach(i => i.addEventListener('change', () => { i.checked ? state.shelters.active.add(i.value) : state.shelters.active.delete(i.value); localStorage.setItem('safepic.shelters', JSON.stringify([...state.shelters.active])); syncShelterLayers(); renderRegion(); }));
  document.addEventListener('click', e => { if (!e.target.closest('#shsel')) box.classList.remove('is-open'); });
  syncShelterLayers();
}
function syncShelterLayers() {
  if (!map || !state.shelters.avail.length) return;
  const kinds = state.sido ? [...state.shelters.active].filter(k => state.shelters.avail.some(a => a.id === k)) : [];
  setShelters(kinds, state.sido);
}
async function renderNearest() {
  const box = $('#nearBox'); if (!box) return;
  const e = state.emd && state.idx.byEmd.get(state.emd);
  if (!e || !state.shelters.avail.length) { box.hidden = true; return; }
  const kinds = [...state.shelters.active].filter(k => state.shelters.avail.some(a => a.id === k));
  const list = await nearestShelters([e.lon, e.lat], kinds, state.sido, 3);
  if (state.emd !== e.code) return;
  box.hidden = false;
  box.innerHTML = `<h3>${t('sh.nearest')}</h3>` + (list.length ? list.map((x, i) => `<button type="button" class="near-item" data-i="${i}"><span class="near-ic">${x.k.icon}</span><span class="near-main"><b>${x.p.name || '-'}</b><small>${getLang() === 'en' ? x.k.en : x.k.ko}${x.p.cap ? ` · ${x.p.cap}` : ''}</small></span><span class="near-walk mono">${t('sh.walk', { n: x.walk })}</span></button>`).join('') : `<div class="muted" style="font-size:.9rem">${t('sh.none')}</div>`);
  $$('.near-item', box).forEach(b => b.addEventListener('click', () => { const x = list[+b.dataset.i]; map.flyTo({ center: x.c, zoom: 15.5 }); new maplibregl.Popup({ closeButton: false, offset: 8 }).setLngLat(x.c).setHTML(`<b>${x.p.name || ''}</b><br><small>${x.p.addr || ''}</small>`).addTo(map); }));
}

/* ---------- names / live lookups ---------- */
function nameOf() {
  const e = state.emd && state.idx.byEmd.get(state.emd), s = state.sgg && state.idx.bySgg.get(state.sgg);
  const sidoName = (e && e.sido_name) || (s && s.sido_name) || (state.sido && (featuresWhere(state.geo.sido, 'code', state.sido)[0] || { properties: {} }).properties.name) || '';
  return { sidoName, sggName: (e && e.sgg_name) || (s && s.name) || '', emdName: e ? e.name : '' };
}
const weatherFor = sgg => (state.live.weather && state.live.weather.by_sgg && state.live.weather.by_sgg[String(sgg)]) || null;
const airFor = sgg => (state.live.air && state.live.air.by_sgg && state.live.air.by_sgg[String(sgg)]) || null;
function warningsFor(sgg, sido) {
  const a = state.live.alerts; if (!a || !a.warnings || !a.warnings.items) return [];
  const n = nameOf();
  return a.warnings.items.filter(w => (w.area_codes || []).some(c => c === String(sgg) || c === String(sido)) || (w.areas || []).some(x => (n.sggName && x.includes(n.sggName)) || (n.sidoName && x === n.sidoName)));
}
const pmGrade = (v, pm25) => v == null ? '' : pm25 ? (v <= 15 ? 'g-good' : v <= 35 ? 'g-mod' : v <= 75 ? 'g-bad' : 'g-vbad') : (v <= 30 ? 'g-good' : v <= 80 ? 'g-mod' : v <= 150 ? 'g-bad' : 'g-vbad');
function wxItems(sgg) {
  const w = weatherFor(sgg), a = airFor(sgg), out = [];
  const push = (k, v, unit, cls = '') => { if (state.wxsel.has(k) && v != null) out.push({ k, label: t('wx.' + k), v, unit, cls }); };
  if (w) { push('t', w.t != null ? w.t.toFixed(1) : null, '℃'); push('feels', w.feels != null ? w.feels.toFixed(1) : null, '℃'); push('rain', w.rn1 != null ? w.rn1 : null, 'mm'); push('reh', w.reh, '%'); push('wind', w.wsd, 'm/s'); }
  if (a) { push('pm10', a.pm10, '㎍/㎥', pmGrade(a.pm10)); push('pm25', a.pm25, '㎍/㎥', pmGrade(a.pm25, true)); }
  return out;
}

/* ---------- panel: region ---------- */
function renderCrumb() {
  const n = nameOf(), c = $('#crumb'); c.innerHTML = '';
  const add = (label, go, last) => { const b = document.createElement('button'); b.className = 'crumb-item' + (last ? ' is-last' : ''); b.textContent = label; b.onclick = go; c.appendChild(b); };
  const sep = () => { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; c.appendChild(s); };
  add(t('nav.nation'), resetNation, state.level === 'nation');
  if (state.sido) { sep(); add(n.sidoName, () => selectSido(state.sido), state.level === 'sido'); }
  if (state.sgg) { sep(); add(n.sggName, () => selectSgg(state.sgg), state.level === 'sgg'); }
  if (state.emd) { sep(); add(n.emdName, () => {}, true); }
}
function renderRegion() {
  const landing = $('#nowLanding'), reg = $('#nowRegion');
  if (state.level === 'nation') { landing.hidden = false; reg.hidden = true; return; }
  landing.hidden = true; reg.hidden = false;
  const n = nameOf();
  $('#regionPath').textContent = [n.sidoName, state.level !== 'sido' && n.sggName].filter(Boolean).join(' › ');
  $('#regionName').textContent = state.level === 'emd' ? n.emdName : state.level === 'sgg' ? n.sggName : n.sidoName;
  $('#levelGuide').innerHTML = ['sido', 'sgg', 'emd'].map(l => `<span class="${state.level === l ? 'on' : ''}">${t('lv.' + l)}</span>`).join('');
  // weather + air
  const wx = $('#wxCard');
  if (state.sgg) {
    const items = wxItems(state.sgg);
    if (items.length) {
      const srcs = [weatherFor(state.sgg) && t('wx.src'), airFor(state.sgg) && t('air.src')].filter(Boolean).join(' · ');
      wx.innerHTML = items.map(i => `<div class="wx-item ${i.cls}"><div class="k">${i.label}</div><div class="v">${i.v}<small>${i.unit}</small></div></div>`).join('') + `<div class="wx-src">${srcs} · ${fmtTime((state.live.weather || {}).updated || (state.live.air || {}).updated)}</div>`;
    } else {
      const st = state.live.weather && state.live.weather.status;
      wx.innerHTML = `<div class="wx-empty">${st === 'no_key' ? t('wx.noKey') : t('wx.noData')}</div>`;
    }
  } else wx.innerHTML = `<div class="wx-empty">${t('wx.pickSgg')}</div>`;
  // warnings
  const ws = warningsFor(state.sgg, state.sido);
  $('#warnCard').innerHTML = ws.map(w => `<div class="warn-item"><span class="warn-level ${/주의보/.test(w.level) ? 'adv' : ''}">${w.type}${w.level}</span><div><div>${(w.areas || []).slice(0, 4).join(', ')}</div><small class="muted">${fmtTime(w.since)}</small></div></div>`).join('');
  // kv
  const e = state.emd && state.idx.byEmd.get(state.emd), kv = [], P = t('kv.places');
  if (state.level === 'sido') kv.push([t('kv.sggCount'), state.idx.sgg.filter(x => String(x.sido) === state.sido).length + P], [t('kv.emdCount'), state.idx.emd.filter(x => String(x.sido) === state.sido).length + P]);
  if (state.level === 'sgg') kv.push([t('kv.emdCount'), state.idx.emd.filter(x => String(x.sgg) === state.sgg).length + P], [t('kv.sido'), n.sidoName]);
  if (e) kv.push([t('kv.sgg'), n.sggName], [t('kv.code'), e.code], [t('kv.grid'), `${e.nx}, ${e.ny}`]);
  $('#regionKv').innerHTML = kv.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');
  $('#regionKv').style.display = kv.length ? '' : 'none';
  $('#regionNote').innerHTML = state.level === 'emd'
    ? (ws.length ? `<b>${t('note.warn', { w: ws.map(w => w.type + w.level).join(', ') })}</b>` : `<small class="muted">${t('note.calm')}</small>`)
    : `<small class="muted">${state.level === 'sido' ? t('note.pickSgg') : t('note.pickEmd')}</small>`;
  const ch = $('#regionChildren'); ch.innerHTML = '';
  let kids = [];
  if (state.level === 'sido') kids = state.idx.sgg.filter(s => String(s.sido) === state.sido).map(s => ({ name: s.name, go: () => selectSgg(s.code) }));
  if (state.level === 'sgg') kids = state.idx.emd.filter(x => String(x.sgg) === state.sgg).map(x => ({ name: x.name, go: () => selectEmd(x.code) }));
  kids.sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(k => { const b = document.createElement('button'); b.textContent = k.name; b.onclick = k.go; ch.appendChild(b); });
  $('#btnFindHere').hidden = state.level !== 'emd';
  renderNearest();
}
function renderLive() { /* live strip retired; weather lives in the region card */ }
function fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return String(iso); const p = x => String(x).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

/* ---------- weather selector ---------- */
function initWxSel() {
  $('#wxselT').addEventListener('click', () => $('#wxsel').classList.toggle('is-open'));
  document.addEventListener('click', e => { if (!e.target.closest('#wxsel')) $('#wxsel').classList.remove('is-open'); });
  $$('#wxsel input').forEach(i => { i.checked = state.wxsel.has(i.value); i.addEventListener('change', () => { i.checked ? state.wxsel.add(i.value) : state.wxsel.delete(i.value); localStorage.setItem('safepic.wxsel', JSON.stringify([...state.wxsel])); renderRegion(); renderLive(); }); });
}

/* ---------- search ---------- */
function initSearch() {
  const inp = $('#searchInput'), list = $('#searchList'); let hot = -1, items = [];
  const render = () => { list.innerHTML = items.map((it, i) => `<li class="${i === hot ? 'is-hot' : ''}" data-i="${i}"><span>${it.name}</span><small>${it.path}</small></li>`).join(''); list.hidden = !items.length; };
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); hot = -1; if (!q) { items = []; render(); return; }
    const sg = state.idx.sgg.filter(s => s.name.includes(q)).slice(0, 6).map(s => ({ name: s.name, path: s.sido_name, go: () => selectSgg(s.code) }));
    const em = state.idx.emd.filter(e => e.name.includes(q)).slice(0, 12).map(e => ({ name: e.name, path: `${e.sido_name} ${e.sgg_name}`, go: () => selectEmd(e.code) }));
    items = [...sg, ...em]; render();
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { hot = Math.min(hot + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hot = Math.max(hot - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && items.length) { items[hot >= 0 ? hot : 0].go(); items = []; render(); inp.blur(); }
    else if (e.key === 'Escape') { items = []; render(); }
  });
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (!li) return; items[+li.dataset.i].go(); items = []; render(); inp.value = ''; });
  document.addEventListener('click', e => { if (!e.target.closest('#search')) { items = []; render(); } });
}

/* ---------- tabs / panel / lang ---------- */
function setTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === tab));
  $('#panel').classList.remove('is-collapsed'); $('#panelScroll').scrollTop = 0;
  if (tab === 'about') renderRulesTable();
  setTimeout(() => map && map.resize(), 260);
}
function initPanel() {
  const p = $('#panel');
  const saved = +localStorage.getItem('safepic.panelW'); if (saved >= 320) document.documentElement.style.setProperty('--panel-w', saved + 'px');
  const rz = $('#panelResize'); let dragging = false;
  const onMove = e => { if (!dragging) return; const x = (e.touches ? e.touches[0].clientX : e.clientX); const w = Math.min(Math.max(x, 320), Math.min(innerWidth - 360, 820)); document.documentElement.style.setProperty('--panel-w', w + 'px'); };
  const onUp = () => { if (!dragging) return; dragging = false; document.body.classList.remove('is-resizing'); localStorage.setItem('safepic.panelW', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'))); map && map.resize(); };
  rz.addEventListener('mousedown', e => { dragging = true; document.body.classList.add('is-resizing'); e.preventDefault(); });
  rz.addEventListener('touchstart', () => { dragging = true; }, { passive: true });
  addEventListener('mousemove', onMove); addEventListener('touchmove', onMove, { passive: true }); addEventListener('mouseup', onUp); addEventListener('touchend', onUp);
  rz.addEventListener('dblclick', () => { document.documentElement.style.setProperty('--panel-w', '460px'); localStorage.removeItem('safepic.panelW'); map && map.resize(); });
  $('#btnPanel').addEventListener('click', () => { p.classList.toggle('is-collapsed'); p.classList.remove('is-tall'); setTimeout(() => map && map.resize(), 280); });
  const g = $('.panel-grip'); let y0 = 0;
  g.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  g.addEventListener('touchend', e => { const dy = e.changedTouches[0].clientY - y0; if (dy < -30) { p.classList.remove('is-collapsed'); p.classList.add('is-tall'); } else if (dy > 30) { p.classList.remove('is-tall'); p.classList.add('is-collapsed'); } });
  g.addEventListener('click', () => { p.classList.toggle('is-tall'); p.classList.remove('is-collapsed'); });
}
function initLang() {
  const paint = () => $$('.lang-btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === getLang()));
  paint();
  $$('.lang-btn').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang, () => {
    paint(); renderAll(); syncWizardLoc(); if (state.shelters.avail.length) initShelterUI();
    if (map && map.getLayer('eastsea-label')) map.setLayoutProperty('eastsea-label', 'text-field', getLang() === 'en' ? 'East Sea' : '동해\nEast Sea');
    if (state.lastResult) renderResult(state.lastResult.res, state.lastResult.inp);
    if ($('#rulesTable').dataset.done) { delete $('#rulesTable').dataset.done; if (state.tab === 'about') renderRulesTable(); }
  })));
}

/* ---------- situation presets ---------- */
const PRESETS = { house_flood: { housing: 'own', damage: ['flood'] }, shop_flood: { housing: 'shop', damage: ['flood'] }, injury: { damage: ['injury'] }, no_news: { damage: ['flood'] } };
function applyPreset(sit) {
  const f = $('#wizard'); f.reset(); const p = PRESETS[sit]; if (!p) return;
  if (p.housing) { const r = f.querySelector(`input[name=housing][value=${p.housing}]`); if (r) r.checked = true; }
  (p.damage || []).forEach(v => { const c = f.querySelector(`input[name=damage][value=${v}]`); if (c) c.checked = true; });
}
function initCards() {
  $$('#sitCards .card').forEach(b => b.addEventListener('click', () => {
    const sit = b.dataset.sit;
    if (sit === 'evacuating') { ['civil_defense', 'flood', 'temp_housing'].forEach(k => state.shelters.active.add(k)); $$('#shsel input').forEach(i => i.checked = state.shelters.active.has(i.value)); syncShelterLayers(); }
    if (sit === 'evacuating' || sit === 'before_rain') { $('#mapHint').textContent = t('hint.start'); $('#mapHint').classList.remove('is-hidden'); $('#searchInput').focus(); return; }
    applyPreset(sit); setTab('find'); syncWizardLoc();
    if (sit === 'no_news') setTimeout(() => $('#wizard').requestSubmit(), 50);
  }));
}

/* ---------- wizard ---------- */
function syncWizardLoc() {
  const n = nameOf(), box = $('#qLoc');
  box.innerHTML = state.emd ? `<b>${n.sidoName} ${n.sggName} ${n.emdName}</b><button type="button" class="btn btn-ghost" id="btnChangeLoc">${t('wiz.change')}</button>` : `<span class="muted">${t('wiz.loc.empty')}</span>`;
  const b = $('#btnChangeLoc'); if (b) b.onclick = () => { setTab('now'); $('#searchInput').focus(); };
}
function readWizard() {
  const fd = new FormData($('#wizard'));
  return { housing: fd.get('housing') || null, damage: fd.getAll('damage'), household: fd.getAll('household'), special_zone: $('#qSpecial').checked ? true : null, event_end: fd.get('event_end') || null, today: new Date().toISOString().slice(0, 10), hazard: 'rain', proxy: $('#qProxy').checked, emd: state.emd };
}
function encodeShare(inp) {
  const p = new URLSearchParams();
  if (inp.emd) p.set('emd', inp.emd); if (inp.housing) p.set('h', inp.housing);
  if (inp.damage.length) p.set('d', inp.damage.join(',')); if (inp.household.length) p.set('f', inp.household.join(','));
  if (inp.special_zone) p.set('sz', '1'); if (inp.event_end) p.set('end', inp.event_end); if (inp.proxy) p.set('p', '1'); p.set('l', getLang());
  return '#r?' + p.toString();
}
async function applyShare(hash) {
  if (!hash.startsWith('#r?')) return;
  const p = new URLSearchParams(hash.slice(3)), f = $('#wizard'); f.reset();
  if (p.get('l') && p.get('l') !== getLang()) setLang(p.get('l'));
  if (p.get('h')) { const r = f.querySelector(`input[name=housing][value=${p.get('h')}]`); if (r) r.checked = true; }
  (p.get('d') || '').split(',').filter(Boolean).forEach(v => { const c = f.querySelector(`input[name=damage][value=${v}]`); if (c) c.checked = true; });
  (p.get('f') || '').split(',').filter(Boolean).forEach(v => { const c = f.querySelector(`input[name=household][value=${v}]`); if (c) c.checked = true; });
  $('#qSpecial').checked = p.get('sz') === '1'; $('#qProxy').checked = p.get('p') === '1';
  if (p.get('end')) $('#qEnd').value = p.get('end');
  if (p.get('emd')) await selectEmd(p.get('emd'));
  setTab('find'); f.requestSubmit();
}
function initWizard() {
  const f = $('#wizard');
  f.addEventListener('submit', e => { e.preventDefault(); runResult(); });
  f.addEventListener('reset', () => { $('#result').hidden = true; state.lastResult = null; history.replaceState(null, '', location.pathname); });
  $('#btnFindHere').addEventListener('click', () => { setTab('find'); syncWizardLoc(); });
  syncWizardLoc();
}
function runResult() {
  const inp = readWizard();
  if (!inp.housing && !inp.damage.length) { alert(t('wiz.need')); return; }
  if (!state.rules || !evaluate) { $('#result').hidden = false; $('#result').innerHTML = `<p>${t('ui.nodata')}</p>`; return; }
  const res = evaluate(state.rules, inp); state.lastResult = { res, inp };
  renderResult(res, inp); history.replaceState(null, '', encodeShare(inp));
}
function itemHTML(r) {
  const amt = r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '');
  const conf = r.confidence === 'verified' ? '' : `<span class="badge est">${r.confidence === 'reported' ? t('badge.reported') : t('badge.est')}</span>`;
  const sz = r.conditions && r.conditions.special_zone === true ? `<span class="badge sz">${t('res.sz')}</span>` : '';
  return `<div class="item"><div class="item-row"><b>${r.label}${sz}${conf}</b><span class="item-amt">${amt}</span></div>${r.summary ? `<div class="item-sum">${r.summary}</div>` : ''}<div class="item-basis">${r.where ? `${r.where} · ` : ''}${r.basis || ''}${r.basis_url ? ` · <a href="${r.basis_url}" target="_blank" rel="noopener">${t('item.src')}</a>` : ''}${r.rate_asof ? ` · ${t('item.asof')} ${r.rate_asof}` : ''}</div></div>`;
}
function renderResult(res, inp) {
  const n = nameOf(), el = $('#result'); el.hidden = false;
  const place = state.emd ? `${n.sidoName} ${n.sggName} ${n.emdName}` : t('res.noloc');
  const dl = (res.deadlines || [])[0];
  const dlHTML = dl
    ? `<div class="deadline ${dl.days_left < 0 ? 'over' : ''}"><div class="d">${dl.days_left < 0 ? t('res.dl.over', { n: -dl.days_left }) : dl.days_left === 0 ? t('res.dl.today') : t('res.dl.d', { n: dl.days_left })}</div><div><b>${dl.label}</b><br><small class="muted">${t('res.dl.ext', { due: dl.due })}</small></div></div>`
    : `<div class="deadline"><div class="d">${t('res.dl.10')}</div><div><b>${t('res.dl.title')}</b><br><small class="muted">${t('res.dl.s')}</small></div></div>`;
  const sec = (title, arr) => `<div class="result-block"><h3>${title}</h3>${arr && arr.length ? arr.map(itemHTML).join('') : `<div class="muted" style="font-size:.9rem">${t('res.none')}</div>`}</div>`;
  const cashItems = [...(res.cash || []), ...(res.relief_fund || [])];
  el.innerHTML = `
    <div class="result-head"><div><div class="eyebrow mono">${place}${inp.special_zone ? ' · ' + t('res.sz') : ''}</div><h2>${inp.proxy ? t('res.proxy') : t('res.mine')}</h2></div><button type="button" class="btn btn-ghost" id="btnEdit">${t('res.edit')}</button></div>
    <div class="result-block"><h3>${t('res.todo')}</h3><ol class="todo">${(res.todo || []).map(x => `<li><div><b>${x.text || x}</b></div></li>`).join('')}</ol></div>
    ${dlHTML}
    <div class="result-block"><h3>${t('res.cash')}</h3><div class="total">${formatKRW(res.total_cash_krw || 0)}<small>${t('res.cash.s')}${res.total_cash_has_unpriced ? t('res.cash.unpriced') : ''}</small></div>${cashItems.map(itemHTML).join('') || `<div class="muted" style="font-size:.9rem">${t('res.cash.none')}</div>`}</div>
    ${sec(t('res.auto'), res.auto)}
    ${sec(t('res.apply'), res.apply)}
    ${res.insurance && res.insurance.length ? sec(t('res.ins'), res.insurance) : ''}
    <div class="result-block"><h3>${t('res.proc')}</h3><ol class="timeline">${(res.timeline || []).map(s => `<li><b>${s.label}</b>${s.due ? ` <span class="badge">${t('badge.due', { d: s.due })}${s.days_left != null ? (s.days_left < 0 ? ' · ' + t('badge.over') : ` · D-${s.days_left}`) : ''}</span>` : ''}<small>${[s.summary, s.where, s.docs && s.docs.length && s.docs.join(', '), s.typical_days].filter(Boolean).join(' · ')}</small></li>`).join('')}</ol></div>
    <div class="share-row"><button type="button" class="btn btn-primary" id="btnCopy">${t('res.copy')}</button><button type="button" class="btn btn-ghost" onclick="print()">${t('res.print')}</button><a class="btn btn-ghost" href="https://www.safekorea.go.kr" target="_blank" rel="noopener">${t('res.report')}</a><span class="copied" id="copied"></span></div>
    <div class="disclaimer">${t('res.disc')}</div>`;
  $('#btnEdit').onclick = () => { el.hidden = true; $('#panelScroll').scrollTop = 0; };
  $('#btnCopy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); $('#copied').textContent = t('res.copied'); setTimeout(() => $('#copied').textContent = '', 2000); } catch { prompt('URL', location.href); } };
  $('#panelScroll').scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
}

/* ---------- rules table ---------- */
function renderRulesTable() {
  const box = $('#rulesTable'); if (!state.rules || box.dataset.done) return;
  const all = state.rules.all || []; box.hidden = false; box.dataset.done = 1;
  box.innerHTML = `<div style="overflow:auto;max-height:60vh;border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>label</th><th>amount</th><th>basis</th><th>as of</th><th>conf.</th></tr></thead><tbody>${all.map(r => `<tr><td><b>${r.label}</b><br><small>${r.summary || ''}</small></td><td class="mono">${r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '-')}</td><td>${r.basis || ''}${r.basis_url ? ` <a href="${r.basis_url}" target="_blank" rel="noopener">↗</a>` : ''}</td><td class="mono">${r.rate_asof || r.effective_from || ''}</td><td class="mono">${r.confidence || ''}</td></tr>`).join('')}</tbody></table></div><p class="fine">${t('rules.total', { n: all.length })} <a href="https://github.com/5-Jihwan/safepic/issues" target="_blank" rel="noopener">Issue</a></p>`;
}

/* ---------- boot ---------- */
(async function boot() {
  applyStatic();
  $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#brand').addEventListener('click', e => { e.preventDefault(); setTab('now'); resetNation(); });
  $('#linkRules').addEventListener('click', e => { e.preventDefault(); renderRulesTable(); $('#rulesTable').scrollIntoView({ behavior: 'smooth' }); });
  initCards(); initWizard(); initSearch(); initPanel(); initLang(); initWxSel();
  await loadCore(); renderCrumb(); renderLive();
  initMap();
  map.once('idle', () => { if (location.hash) applyShare(location.hash); });
})();
