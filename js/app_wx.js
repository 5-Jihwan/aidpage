/* 날씨 색면·바람·태풍·특보 연출·검색 — 10-14 app.js에서 분리(500줄 규칙). */
import { t, getLang } from './i18n.js?v=20261020a';
import { $, $$, state } from './app.js?v=20261020a';
import { airFor, nameOf, rn, warnName, weatherFor } from './app_panel.js?v=20261020a';
import { locateMe, map, setLevelFilters } from './app_map.js?v=20261020a';
import { activeShelterKinds, renderLegend, selectEmd, selectSgg } from './app_layers.js?v=20261020a';

export function initWxSel() {
  $('#wxselT').addEventListener('click', () => $('#wxsel').classList.toggle('is-open'));
  document.addEventListener('click', e => { if (!e.target.closest('#wxsel')) $('#wxsel').classList.remove('is-open'); });
  $$('#wxsel input').forEach(i => { i.checked = (i.value === state.wxmap); i.addEventListener('change', () => { if (!i.checked) return; state.wxmap = i.value; state._wxLast = i.value || null; localStorage.setItem('safepic.wxmap', i.value); applyWxLayer(); }); });
  paintWxTitle();
}

export function paintWxTitle() { const b = $('#wxselT'); if (b) b.textContent = state.wxmap ? `${t('wx.title')}: ${t('wx.' + (state.wxmap === 'wind' ? 'wind' : state.wxmap))}` : t('wx.title'); }

export const WX_RAMP = {
  t:     { key: 't',    stops: [-10, '#2b6cb0', 0, '#90cdf4', 15, '#f7f9fc', 25, '#fbd38d', 30, '#f6ad55', 35, '#e53e3e'], unit: '℃', legend: [-10, 0, 15, 25, 30, 35] },
  feels: { key: 'feels', stops: [-10, '#2b6cb0', 0, '#90cdf4', 20, '#f7f9fc', 31, '#fbd38d', 33, '#f6ad55', 35, '#e53e3e', 38, '#9b2c2c'], unit: '℃', legend: [20, 31, 33, 35, 38] },
  reh:   { key: 'reh',  stops: [20, '#d69e2e', 35, '#f6e05e', 50, '#f7f9fc', 80, '#63b3ed', 100, '#2b6cb0'], unit: '%', legend: [20, 35, 50, 80, 100] },
  wind:  { key: 'wsd',  stops: [0, '#f7f9fc', 4, '#cbd5e0', 9, '#a0aec0', 14, '#ed8936', 20, '#c53030'], unit: 'm/s', legend: [0, 4, 9, 14, 20] },
  rain:  { key: 'rn1',  stops: [0, '#f7f9fc', 1, '#bee3f8', 5, '#63b3ed', 15, '#3182ce', 30, '#1a365d'], unit: 'mm', legend: [0, 1, 5, 15, 30] },
  pm10:  { key: 'pm10', stops: [0, '#48bb78', 30, '#68d391', 31, '#f6e05e', 80, '#ecc94b', 81, '#f6ad55', 150, '#ed8936', 151, '#e53e3e'], unit: '㎍/㎥', legend: [30, 80, 150] },
  pm25:  { key: 'pm25', stops: [0, '#48bb78', 15, '#68d391', 16, '#f6e05e', 35, '#ecc94b', 36, '#f6ad55', 75, '#ed8936', 76, '#e53e3e'], unit: '㎍/㎥', legend: [15, 35, 75] },
};

export function wxValueFor(sggCode, metric) {
  const cfg = WX_RAMP[metric]; if (!cfg) return null;
  if (metric === 'pm10' || metric === 'pm25') { const a = airFor(sggCode); return a && a[cfg.key] != null ? +a[cfg.key] : null; }
  const w = weatherFor(sggCode); return w && w[cfg.key] != null ? +w[cfg.key] : null;
}

export function applyWxLayer() {
  if (!map || !map.getLayer('sgg-fill')) return;
  const m = state.wxmap, cfg = WX_RAMP[m];
  paintWxTitle();
  const base = ['case', ['boolean', ['feature-state', 'hover'], false], 0.32, ['boolean', ['feature-state', 'sel'], false], 0.26, 0];
  if (!cfg) {
    ['sgg-fill', 'sido-fill', 'emd-fill'].forEach(l => { map.setPaintProperty(l, 'fill-opacity', base); });
    map.setPaintProperty('sgg-fill', 'fill-color', '#9a7328'); map.setPaintProperty('sido-fill', 'fill-color', '#1a5fc4');
    setLevelFilters(); applyWindArrows(false); state._wxLegend = null; renderLegend(activeShelterKinds()); return;
  }
  // push values into feature-state
  const W = state.live.weather || {};
  for (const f of (state.geo.sgg || { features: [] }).features) { const v = wxValueFor(f.properties.code, m); map.setFeatureState({ source: 'sgg', id: f.properties.code }, { wx: v == null ? null : v }); }
  for (const f of (state.geo.sido || { features: [] }).features) {
    const h = W.hub && W.hub.by_sido && W.hub.by_sido[String(f.properties.code)];
    let v = null;
    if (m === 'pm10' || m === 'pm25') { const vals = (state.geo.sgg || { features: [] }).features.filter(g => String(g.properties.sido_code) === String(f.properties.code)).map(g => wxValueFor(g.properties.code, m)).filter(x => x != null); v = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; }
    else v = h && h[cfg.key] != null ? +h[cfg.key] : null;
    map.setFeatureState({ source: 'sido', id: f.properties.code }, { wx: v });
  }
  const color = ['case', ['==', ['feature-state', 'wx'], null], '#d9dee7', ['interpolate', ['linear'], ['coalesce', ['feature-state', 'wx'], 0], ...cfg.stops]];
  const op = ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, ['boolean', ['feature-state', 'sel'], false], 0.8, 0.62];
  map.setPaintProperty('sgg-fill', 'fill-color', color); map.setPaintProperty('sido-fill', 'fill-color', color);
  // nation view: colour sido; after a sido is chosen: colour its sgg
  map.setPaintProperty('sido-fill', 'fill-opacity', state.sido ? 0 : op);
  map.setPaintProperty('sgg-fill', 'fill-opacity', op);
  map.setPaintProperty('emd-fill', 'fill-opacity', base);
  applyWindArrows(m === 'wind');
  state._wxLegend = { title: t('wx.' + m) + (m === 'wind' ? ` · ${t('wx.wind.note')}` : '') + (W.by_sgg && Object.keys(W.by_sgg).length ? '' : ` · ${t('wx.legend.sido')}`), html: cfg.legend.map((v, i) => `<span><i style="background:${colorAt(cfg.stops, v)}"></i>${i === 0 ? '≤' : ''}${v}${cfg.unit}</span>`).join('') };
  renderLegend(activeShelterKinds());
}

export function ensureArrowImage() {
  if (!map || map.hasImage('wind-arrow')) return;
  // 혜성형 화살표: 연한 꼬리(바람이 오는 쪽) → 진한 화살촉(가는 쪽)이 흐름 방향을 읽게 한다
  const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
  x.translate(24, 24); x.lineCap = 'round'; x.lineJoin = 'round';
  x.strokeStyle = 'rgba(15,74,158,.35)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 19); x.lineTo(0, 6); x.stroke();          // 꼬리 (연함)
  x.strokeStyle = 'rgba(15,74,158,.75)'; x.lineWidth = 4.5;
  x.beginPath(); x.moveTo(0, 7); x.lineTo(0, -8); x.stroke();          // 몸통
  x.fillStyle = '#0f4a9e';
  x.beginPath(); x.moveTo(0, -21); x.lineTo(-10, -4); x.lineTo(0, -8); x.lineTo(10, -4); x.closePath(); x.fill();  // 화살촉
  map.addImage('wind-arrow', x.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
}

export const DIR8_KO = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'], DIR8_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function windLabel(vec, wsd) {
  const i = Math.round((((vec || 0) % 360) + 360) % 360 / 45) % 8;  // vec = 바람이 불어오는 방향(도)
  return getLang() !== 'ko' ? `${DIR8_EN[i]} ${wsd.toFixed(1)}` : `${DIR8_KO[i]}풍 ${wsd.toFixed(1)}`;
}

export function applyWindArrows(on) {
  if (!map) return;
  if (!on) { if (map.getLayer('wind-arrows')) map.setLayoutProperty('wind-arrows', 'visibility', 'none'); return; }
  ensureArrowImage();
  const pts = [];
  const list = state.sido ? state.idx.sgg.filter(s => String(s.sido) === state.sido) : state.idx.sgg;
  const seen = new Set();
  for (const s of list) {
    const w = weatherFor(s.code); if (!w || w.wsd == null) continue;
    const key = state.sido ? s.code : (w._sido ? s.sido : s.code); // nation view with sido-level data: one arrow per sido
    if (seen.has(key)) continue; seen.add(key);
    let lon = s.lon, lat = s.lat;
    if (!state.sido && w._sido) { const sib = state.idx.sgg.filter(z => String(z.sido) === String(s.sido)); lon = sib.reduce((a, z) => a + z.lon, 0) / sib.length; lat = sib.reduce((a, z) => a + z.lat, 0) / sib.length; }
    pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { rot: ((w.vec || 0) + 180) % 360, wsd: w.wsd, label: windLabel(w.vec, w.wsd) } });
  }
  const fc = { type: 'FeatureCollection', features: pts };
  if (map.getSource('wind')) map.getSource('wind').setData(fc);
  else {
    map.addSource('wind', { type: 'geojson', data: fc });
    map.addLayer({ id: 'wind-arrows', type: 'symbol', source: 'wind', layout: { 'icon-image': 'wind-arrow', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-size': ['interpolate', ['linear'], ['get', 'wsd'], 0, 0.45, 5, 0.8, 14, 1.4], 'icon-allow-overlap': true, 'text-field': ['concat', ['get', 'label'], ' m/s'], 'text-size': 10, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'], 'text-optional': true }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['get', 'wsd'], 0, 0.35, 3, 0.9], 'text-color': '#0f4a9e', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } });
  }
  map.setLayoutProperty('wind-arrows', 'visibility', 'visible');
  startWindFlow();
}

export let _windRAF = null;

export function startWindFlow() {
  if (_windRAF || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const tick = now => {
    if (!map || !map.getLayer('wind-arrows') || map.getLayoutProperty('wind-arrows', 'visibility') === 'none') { _windRAF = null; return; }
    const ph = ((now - t0) / 1400) % 1; // 0→1 loop
    map.setLayoutProperty('wind-arrows', 'icon-offset', [0, -ph * 14]);
    map.setPaintProperty('wind-arrows', 'icon-opacity', ['interpolate', ['linear'], ['get', 'wsd'], 0, 0.3, 3, 0.95 - ph * 0.35]);
    _windRAF = requestAnimationFrame(tick);
  };
  _windRAF = requestAnimationFrame(tick);
}

export function applyTyphoon() {
  if (!map) return;
  const T = state.live.alerts && state.live.alerts.typhoon; const items = (T && T.items) || [];
  const feats = [];
  for (const t of items) {
    const pts = [t.analysis, ...(t.forecast || [])].filter(Boolean);
    if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) }, properties: { kind: 'track' } });
    pts.forEach((p, i) => { feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { kind: i === 0 ? 'now' : 'fc', label: i === 0 ? `태풍 ${t.no}호 · ${p.wind || ''}m/s` : `+${p.tmd}h`, r25: p.rad25 || 0 } }); });
  }
  const fc = { type: 'FeatureCollection', features: feats };
  if (map.getSource('typhoon')) map.getSource('typhoon').setData(fc);
  else if (feats.length) {
    map.addSource('typhoon', { type: 'geojson', data: fc });
    map.addLayer({ id: 'typhoon-track', type: 'line', source: 'typhoon', filter: ['==', ['get', 'kind'], 'track'], paint: { 'line-color': '#c8432b', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'typhoon-pts', type: 'circle', source: 'typhoon', filter: ['!=', ['get', 'kind'], 'track'], paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'now'], 9, 6], 'circle-color': ['case', ['==', ['get', 'kind'], 'now'], '#c8432b', '#fff'], 'circle-stroke-color': '#c8432b', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'typhoon-lbl', type: 'symbol', source: 'typhoon', filter: ['!=', ['get', 'kind'], 'track'], layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#c8432b', 'text-halo-color': '#fff', 'text-halo-width': 1.3 } });
  }
}

export const FX_PRI = ['지진', '태풍', '호우', '대설', '한파', '폭염', '강풍', '건조', '황사'];

export const FX_KEY = { '지진': 'quake', '태풍': 'typhoon', '호우': 'rain', '대설': 'snow', '한파': 'cold', '폭염': 'heat', '강풍': 'wind', '건조': 'dry', '황사': 'dust' };

export let _fxSig = null, _fxDismissed = null;

export function resetFxDismiss() { _fxDismissed = null; }

export function applyAlertFx(ws) {
  const fx = $('#wxFx'), bn = $('#fxBanner'); if (!fx || !bn) return;
  let best = null;
  for (const w of ws || []) {
    const k = FX_KEY[w.type]; if (!k) continue;
    const lv = /경보|속보/.test(w.level) ? 'warn' : 'adv';
    const pri = FX_PRI.indexOf(w.type) - (lv === 'warn' ? 0.5 : 0);
    if (!best || pri < best.pri) best = { k, lv, pri, w };
  }
  const sig = best ? `${best.k}:${best.lv}:${getLang()}` : '';
  if (sig === _fxSig) return; _fxSig = sig;
  if (!best) { fx.className = 'wx-fx'; bn.hidden = true; return; }
  fx.className = `wx-fx on fx-${best.k} lv-${best.lv}`;
  // 닫은 특보는 다시 띄우지 않는다. 종류·등급이 바뀌면 sig가 달라져 자동으로 다시 뜬다.
  if (sig === _fxDismissed) bn.hidden = true;
  else {
    bn.className = `fx-banner lv-${best.lv}`;
    const nmB = nameOf();
    bn.innerHTML = `<b>${warnName(best.w.type, best.w.level)}</b><span>${t(`todo.alert.${best.k}.${best.lv}`).replace(/^[^—–-]*[—–-]\s*/, '')}<small class="fx-why">${t('todo.why.alert', { w: warnName(best.w.type, best.w.level), area: nmB.emdName || nmB.sggName || '' })}</small></span>`
      + `<button type="button" class="fx-x" aria-label="${t('fx.close')}" title="${t('fx.close')}">×</button>`;
    bn.onclick = e => { if (e.target.closest('.fx-x')) { _fxDismissed = sig; bn.hidden = true; } };
    bn.hidden = false;
  }
  if (best.k === 'quake' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const m = $('#map'); m.classList.remove('quake-shake'); void m.offsetWidth; m.classList.add('quake-shake');
  }
}

export function colorAt(stops, v) { for (let i = 0; i < stops.length - 2; i += 2) { if (v <= stops[i]) return stops[i + 1]; if (v < stops[i + 2]) return stops[i + 1]; } return stops[stops.length - 1]; }

export function suggest(q, nSgg, nEmd) {
  const ql = q.toLowerCase(), hit = o => o.name.includes(q) || (o.name_en || '').toLowerCase().includes(ql);
  const sg = [], em = [];
  for (const s of state.idx.sgg) { if (hit(s)) { sg.push({ name: rn(s), path: rn(s, 'sido_name'), go: () => selectSgg(s.code) }); if (sg.length >= nSgg) break; } }
  for (const e of state.idx.emd) { if (hit(e)) { em.push({ name: rn(e), path: `${rn(e, 'sido_name')} ${rn(e, 'sgg_name')}`, go: () => selectEmd(e.code) }); if (em.length >= nEmd) break; } }
  return [...sg, ...em];
}

export function initSearch() {
  $('#btnLocate').addEventListener('click', locateMe);
  const inp = $('#searchInput'), list = $('#searchList'); let hot = -1, items = [];
  const render = () => { list.innerHTML = items.map((it, i) => `<li class="${i === hot ? 'is-hot' : ''}" data-i="${i}"><span>${it.name}</span><small>${it.path}</small></li>`).join(''); list.hidden = !items.length; };
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); hot = -1;
    items = q ? suggest(q, 6, 12) : []; render();
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
