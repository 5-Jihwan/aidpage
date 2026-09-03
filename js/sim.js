/* AidPage Simulator — "가는 길 위험" 1단계 (격자 방향 시뮬레이션)
   버튼을 눌렀을 때만 app.js가 lazy import 하고, 경로 탐색은 sim_worker.js(Web Worker)가 맡는다.
   원칙: 안전 판정이 아니다 — 출발지→목적지 사이에 '알려진 위험'(침수 이력·경사·산사태 이력·지하차도 등)이
   어디에 얼마나 있는지, 그리고 그것을 피하면 몇 분이 더 드는지만 보여준다. 도로가 아니라 격자(약 170~460m) 위의 방향. */
import { t, getLang } from './i18n.js?v=20260903a';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const HZ_KINDS = ['underpass', 'steep'];   // 산불이력(2.5MB)은 가중치 0.3에 파일이 너무 커 제외 — 도보 경로 위험은 지하차도·급경사지가 핵심
let C = null, worker = null, mapBound = false;
const S = { sgg: null, from: null, to: null, fromLabel: '', toLabel: '', pick: null, scn: 'auto', res: null, busy: false, err: null };

export function initSim(ctx) { C = ctx; }
export function isOpen() { return !!(C && C.state.sim); }

export async function openSim() {
  const st = C.state; if (!st.sgg) return;
  st.sim = { sgg: st.sgg, close: closeSim, rerender: render }; st.simPick = null;
  Object.assign(S, { sgg: st.sgg, from: null, to: null, fromLabel: '', toLabel: '', pick: null, res: null, err: null, busy: false });
  // 내 위치가 이 시·군·구 안이면 출발지로 미리 채운다 (gps.emd는 10자리 행정동 코드, 앞 5자리 = 시군구)
  if (st.gps && st.gps.emd && String(st.gps.emd).startsWith(String(st.sgg))) setPoint('from', [st.gps.lon, st.gps.lat], t('sim.gps'));
  ensureLayers();
  if (!mapBound) { C.map.on('click', onMapClick); mapBound = true; }
  const l = $('#simLaunch'); if (l) l.hidden = true;
  const b = $('#simBox'); b.hidden = false;
  render();
  b.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
export function closeSim() {
  const st = C.state;
  stopPick();
  st.sim = null; S.res = null; S.from = S.to = null;
  if (C.map.getSource('sim')) C.map.getSource('sim').setData({ type: 'FeatureCollection', features: [] });
  const b = $('#simBox'); if (b) { b.hidden = true; b.innerHTML = ''; }
  const l = $('#simLaunch'); if (l) l.hidden = !st._gridAvail;
}

/* ---------- 지도 ---------- */
function ensureLayers() {
  const map = C.map; if (map.getSource('sim')) return;
  map.addSource('sim', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // 삽입 위치 3원칙: 격자·면 위 / 경계선 위 / 지명 라벨 아래
  const anchor = ['sh-pt', 'emd-label', 'sgg-label'].find(l => map.getLayer(l));
  map.addLayer({ id: 'sim-short', type: 'line', source: 'sim', filter: ['==', ['get', 'kind'], 'short'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6b768a', 'line-width': 3, 'line-dasharray': [1.2, 1.6], 'line-opacity': 0.9 } }, anchor);
  map.addLayer({ id: 'sim-safe-case', type: 'line', source: 'sim', filter: ['==', ['get', 'kind'], 'safe'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.9 } }, anchor);
  map.addLayer({ id: 'sim-safe', type: 'line', source: 'sim', filter: ['==', ['get', 'kind'], 'safe'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a5fc4', 'line-width': 4 } }, anchor);
  map.addLayer({ id: 'sim-pts', type: 'circle', source: 'sim', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'role'], 'from', '#14202e', '#9a7328'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } }, anchor);
  map.addLayer({ id: 'sim-pts-lbl', type: 'symbol', source: 'sim', filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 'lbl'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true },
    paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
}
function draw() {
  const feats = [];
  if (S.res && S.res.ok) {
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: S.res.short.coords }, properties: { kind: 'short' } });
    if (!S.res.same) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: S.res.safe.coords }, properties: { kind: 'safe' } });
    else feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: S.res.short.coords }, properties: { kind: 'safe' } });
  }
  if (S.from) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: S.from }, properties: { role: 'from', lbl: t('sim.from') } });
  if (S.to) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: S.to }, properties: { role: 'to', lbl: t('sim.to') } });
  C.map.getSource('sim').setData({ type: 'FeatureCollection', features: feats });
  if (S.res && S.res.ok) {
    const b = [180, 90, -180, -90];
    for (const c of [...S.res.short.coords, ...S.res.safe.coords]) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }
    C.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: C.padding(), maxZoom: 15.5, duration: 900 });
  }
}
function onMapClick(e) {
  if (!S.pick || !C.state.sim) return;
  const lon = e.lngLat.lng, lat = e.lngLat.lat;
  const cell = cellAt(lon, lat);
  if (!cell) { C.toast(t('sim.outside')); return; }
  const which = S.pick; stopPick();
  setPoint(which, [lon, lat], cell.properties.emd_name ? C.emdDisp(cell.properties.emd_name) : '');
  render(); draw();
}
function cellAt(lon, lat) { return C.gridCells(S.sgg).find(f => C.pipFeature(lon, lat, f)) || null; }
function startPick(which) {
  S.pick = which; C.state.simPick = which;
  document.body.classList.add('map-pick');
  C.onPick(true); C.toast(t('sim.picking'));
  render();
}
function stopPick() {
  if (!S.pick) return;
  S.pick = null; C.state.simPick = null;
  document.body.classList.remove('map-pick');
  C.onPick(false);
}
function setPoint(which, lonlat, label) {
  S[which] = lonlat; S[which + 'Label'] = label || `${lonlat[1].toFixed(4)}, ${lonlat[0].toFixed(4)}`;
  S.res = null; S.err = null;
}

/* ---------- 입력 도우미 ---------- */
function useGps() {
  const st = C.state;
  const apply = (lon, lat) => {
    if (!cellAt(lon, lat)) { C.toast(t('sim.outside')); return; }
    setPoint('from', [lon, lat], t('sim.gps')); render(); draw();
  };
  if (st.gps && Date.now() - (st.gps.at || 0) < 5 * 60 * 1000) { apply(st.gps.lon, st.gps.lat); return; }
  if (!navigator.geolocation) { C.toast(t('gps.unsupported')); return; }
  S.busy = true; render();
  navigator.geolocation.getCurrentPosition(pos => { S.busy = false; st.gps = { ...(st.gps || {}), lon: pos.coords.longitude, lat: pos.coords.latitude, at: Date.now() }; apply(pos.coords.longitude, pos.coords.latitude); },
    err => { S.busy = false; render(); C.toast(err.code === 1 ? t('gps.denied') : t('gps.fail')); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}
async function useShelter() {
  if (!S.from) { C.toast(t('sim.needFrom')); return; }
  const st = C.state;
  const kinds = ['civil_defense', 'temp_housing', 'quake', 'tsunami'].filter(k => st.shelters.avail.some(a => a.id === k));
  if (!kinds.length) { C.toast(t('sim.noshelter')); return; }
  S.busy = true; render();
  try {
    const list = await C.nearestShelters(S.from, kinds, st.sido, 1);
    if (!list.length) { C.toast(t('sim.noshelter')); return; }
    const it = list[0];
    setPoint('to', it.c, `${it.k.icon} ${it.p.name || ''}`.trim());
  } finally { S.busy = false; render(); draw(); }
}

/* ---------- 실행 ---------- */
function scenario() {
  if (S.scn === 'rain') return { rain: true, lslide: false };
  if (S.scn === 'lslide') return { rain: false, lslide: true };
  if (S.scn === 'calm') return { rain: false, lslide: false };
  const types = C.warningsFor().map(w => String(w.type || ''));
  return { rain: types.some(x => /호우|태풍|홍수|폭풍해일/.test(x)), lslide: types.some(x => /산사태/.test(x)) };
}
async function run() {
  if (!S.from || !S.to || S.busy) return;
  S.busy = true; S.err = null; S.res = null; render();
  try {
    const cells = C.gridCells(S.sgg).map(f => {
      const ring = f.geometry.coordinates[0], m = ring.length - 1; let x = 0, y = 0;
      for (let i = 0; i < m; i++) { x += ring[i][0]; y += ring[i][1]; }
      const p = f.properties;
      return { h3: p.h3, c: [x / m, y / m], ring, p: { flood_hist_n: p.flood_hist_n, flood_depth_max_m: p.flood_depth_max_m, slope_mean: p.slope_mean, landslide_hist_n: p.landslide_hist_n, emd_name: p.emd_name } };
    });
    // 위험 지점: 격자 범위 + 300m 안의 것만 워커로 (시도 단위 파일이라 수천 개일 수 있음)
    const b = [180, 90, -180, -90];
    for (const c of cells) { b[0] = Math.min(b[0], c.c[0]); b[1] = Math.min(b[1], c.c[1]); b[2] = Math.max(b[2], c.c[0]); b[3] = Math.max(b[3], c.c[1]); }
    const pad = 0.005;
    const hz = [];
    for (const k of HZ_KINDS) for (const f of await C.collectShelters([k], C.state.sido)) hz.push({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], kind: k });
    const hzIn = hz.filter(h => h.lon >= b[0] - pad && h.lon <= b[2] + pad && h.lat >= b[1] - pad && h.lat <= b[3] + pad);
    const scn = scenario();
    const res = await compute({ cells, from: S.from, to: S.to, hazards: hzIn, scn });
    S.res = { ...res, scn };
    if (!res.ok) S.err = res.error;
    else C.stat && C.stat('sim_run');
  } catch (e) { console.warn('sim failed', e); S.err = 'fail'; }
  finally { S.busy = false; render(); draw(); }
}
function compute(payload) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) worker = new Worker('js/sim_worker.js?v=20260903a');
      const to = setTimeout(() => { try { worker.terminate(); } catch (e) { /* */ } worker = null; reject(new Error('timeout')); }, 20000);
      worker.onmessage = ev => { clearTimeout(to); resolve(ev.data); };
      worker.onerror = ev => { clearTimeout(to); worker = null; reject(ev.error || new Error(ev.message || 'worker')); };
      worker.postMessage(payload);
    } catch (e) { reject(e); }
  });
}

/* ---------- 화면 ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hzName(kind) { const k = (C.KINDS || []).find(x => x.id === kind); return k ? (getLang() === 'en' ? k.en : k.ko).replace(/\(.*?\)/, '').trim() : kind; }
function pathCard(kind, P) {
  const li = [];
  if (P.sum.flood) li.push(`<li class="bad">${t('sim.r.flood', { n: P.sum.flood })}${P.sum.depth ? ` · ${t('sim.r.depth', { m: P.sum.depth.toFixed(1) })}` : ''}</li>`);
  if (P.sum.steep) li.push(`<li class="warn">${t('sim.r.steep', { n: P.sum.steep })}</li>`);
  if (P.sum.lslide) li.push(`<li class="bad">${t('sim.r.lslide', { n: P.sum.lslide })}</li>`);
  for (const k in P.sum.hz) li.push(`<li class="${k === 'underpass' ? 'bad' : 'warn'}">${t('sim.r.hz', { name: hzName(k), n: P.sum.hz[k] })}</li>`);
  if (!li.length) li.push(`<li class="ok">${t('sim.r.none')}</li>`);
  if (P.sum.unknown) li.push(`<li class="muted">${t('sim.r.unknown', { n: P.sum.unknown })}</li>`);
  return `<div class="sim-card ${kind}"><h4><i></i>${t(kind === 'safe' ? 'sim.r.safe' : 'sim.r.short')}</h4><div class="m">${t('sim.r.len', { km: (P.len_m / 1000).toFixed(1), min: P.walk_min })} · ${t('sim.r.cells', { n: P.sum.cells })}</div><ul>${li.join('')}</ul></div>`;
}
function resultHTML() {
  if (S.busy && !S.res) return `<div class="sim-wait">${t('sim.running')}</div>`;
  if (S.err) return `<div class="sim-err">${t(S.err === 'outside' ? 'sim.outside' : S.err === 'noroute' ? 'sim.noroute' : 'sim.fail')}</div>`;
  const R = S.res; if (!R || !R.ok) return '';
  const scnKey = R.scn.rain && R.scn.lslide ? 'sim.scn.both' : R.scn.rain ? 'sim.scn.rain' : R.scn.lslide ? 'sim.scn.lslide' : 'sim.scn.calm';
  const head = `<div class="sim-scn">${t('sim.r.basis', { scn: t(scnKey), d: R.d0 })}</div>`;
  if (R.same) return head + pathCard('safe', R.short) + `<div class="sim-gain">${t('sim.r.same')}</div>`;
  const hzN = P => Object.values(P.sum.hz).reduce((a, b) => a + b, 0);
  const gain = t('sim.r.gain', { min: Math.max(0, R.safe.walk_min - R.short.walk_min), a: R.short.sum.flood + R.short.sum.lslide + R.short.sum.steep + hzN(R.short), b: R.safe.sum.flood + R.safe.sum.lslide + R.safe.sum.steep + hzN(R.safe) });
  return head + pathCard('short', R.short) + pathCard('safe', R.safe) + `<div class="sim-gain">${gain}</div>`;
}
function render() {
  const box = $('#simBox'); if (!box || !C.state.sim) return;
  const pk = w => S.pick === w ? ' is-picking' : '';
  const dis = S.busy ? ' disabled' : '';
  box.innerHTML = `
    <div class="sim-head"><h3>${t('sim.title')}</h3><button type="button" class="btn btn-ghost btn-sm" data-act="close">${t('sim.close')}</button></div>
    <p class="fine">${t('sim.lead')}</p>
    <div class="sim-row"><span class="lbl">${t('sim.from')}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="gps"${dis}>${t('sim.gps')}</button>
      <button type="button" class="btn btn-ghost btn-sm${pk('from')}" data-act="pickFrom"${dis}>${S.pick === 'from' ? t('sim.picking') : t('sim.pick')}</button>
      <span class="sim-val ${S.from ? '' : 'muted'}">${S.from ? esc(S.fromLabel) : t('sim.unset')}</span></div>
    <div class="sim-row"><span class="lbl">${t('sim.to')}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="shelter"${dis}>${t('sim.shelter')}</button>
      <button type="button" class="btn btn-ghost btn-sm${pk('to')}" data-act="pickTo"${dis}>${S.pick === 'to' ? t('sim.picking') : t('sim.pick')}</button>
      <span class="sim-val ${S.to ? '' : 'muted'}">${S.to ? esc(S.toLabel) : t('sim.unset')}</span></div>
    <div class="sim-row"><span class="lbl">${t('sim.scn')}</span>
      <select class="sim-sel" id="simScn"${dis}>${['auto', 'rain', 'lslide', 'calm'].map(v => `<option value="${v}"${S.scn === v ? ' selected' : ''}>${t('sim.scn.' + v)}</option>`).join('')}</select></div>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="run"${(!S.from || !S.to || S.busy) ? ' disabled' : ''}>${S.busy ? t('sim.running') : t('sim.run')}</button>
      ${S.res || S.from || S.to ? `<button type="button" class="btn btn-ghost btn-sm" data-act="reset"${dis}>${t('sim.reset')}</button>` : ''}</div>
    <div class="sim-res">${resultHTML()}</div>
    <div class="sim-legend legend"><span><i class="ln short"></i>${t('sim.legend.short')}</span><span><i class="ln safe"></i>${t('sim.legend.safe')}</span><span><i style="background:#14202e;border-radius:50%"></i>${t('sim.from')}</span><span><i style="background:#9a7328;border-radius:50%"></i>${t('sim.to')}</span></div>
    <div class="fine sim-note">${t('sim.note')}</div><div class="fine">${t('sim.src')}</div>`;
  $$('[data-act]', box).forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'close') closeSim();
    else if (a === 'gps') useGps();
    else if (a === 'shelter') useShelter();
    else if (a === 'pickFrom' || a === 'pickTo') { const w = a === 'pickFrom' ? 'from' : 'to'; if (S.pick === w) { stopPick(); render(); } else startPick(w); }
    else if (a === 'run') run();
    else if (a === 'reset') { stopPick(); S.from = S.to = null; S.res = null; S.err = null; render(); draw(); }
  }));
  const sel = $('#simScn', box); if (sel) sel.addEventListener('change', () => { S.scn = sel.value; S.res = null; S.err = null; render(); draw(); });
}
