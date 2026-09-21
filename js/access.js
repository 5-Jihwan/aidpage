/* 대피소 접근 문장 카드 (S0, docs/25 (d)안 · docs/30 결정 S1·S4)
   본 사이트는 경로 선을 그리지 않는다. 가까운 대피소 3곳마다 "걸어서 약 n분 · 가는 방향에 침수 이력 칸 n · 지하차도 근처 n"을 문장으로만 보여준다.
   계산은 기존 sim_worker.js의 짧은 길을 '세는' 용도로만 재사용한다(피하는 길은 쓰지 않는다). 선이 있는 옛 시뮬레이터는 sim.html(연구 샌드박스)에만 남는다.
   ponytail: 전국 배치(S2)가 끝나면 이 실시간 계산은 미리 계산된 JSON 읽기로 바뀌고 sim_worker.js는 폐기된다. */
import { t, getLang } from './i18n.js?v=20260921a';
const $ = (s, r = document) => r.querySelector(s);
const HZ_KINDS = ['underpass', 'steep'];
// 민방위 대피시설은 대부분 지하(공습 대비)라 침수 맥락의 이 카드에서는 뺀다. 지진옥외대피장소는 비를 피할 수 없는 공터라 뺀다.
const SHELTER_KINDS = ['temp_housing', 'tsunami'];
const SLOW = 45, WALK = 67;   // m/분 — 67 = 민방위 기준(기존), 45 = 느린 걸음(고령·거동 불편, docs/30)
let C = null, worker = null;
const S = { sgg: null, from: null, fromLabel: '', rows: null, busy: false, err: null };

export function initAccess(ctx) { C = ctx; }
/** 결과·인쇄 카드가 같은 문장을 가져다 쓴다 (같은 시·군·구에서 계산된 적이 있을 때만) */
export function accessLines() { return S.rows && S.sgg === C.state.sgg ? { from: S.fromLabel, rows: S.rows.map(lineText) } : null; }

export async function openAccess() {
  const st = C.state; if (!st.sgg) return;
  st.sim = { sgg: st.sgg, close: closeAccess };   // app.js는 state.sim으로 "열려 있음·시군구 바뀌면 닫기"를 다룬다
  Object.assign(S, { sgg: st.sgg, from: null, fromLabel: '', rows: null, err: null, busy: false });
  const l = $('#simLaunch'); if (l) l.hidden = true;
  $('#simBox').hidden = false;
  // 출발점: 방금 잡은 내 위치가 이 시·군·구 안이면 그것, 아니면 고른 동의 가운데
  if (st.gps && st.gps.emd && String(st.gps.emd).startsWith(String(st.sgg))) setFrom([st.gps.lon, st.gps.lat], t('sim.gps'));
  else if (st.emd) { const e = st.idx.byEmd.get(st.emd); if (e) setFrom([e.lon, e.lat], t('acc.from.emd', { name: C.emdDisp(e.name) })); }
  render();
  $('#simBox').scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (S.from) run();
}
export function closeAccess() {
  C.state.sim = null;
  const b = $('#simBox'); if (b) { b.hidden = true; b.innerHTML = ''; }
  const l = $('#simLaunch'); if (l) l.hidden = !C.state._gridAvail;
}
function setFrom(lonlat, label) { S.from = lonlat; S.fromLabel = label; S.rows = null; S.err = null; }

function useGps() {
  const st = C.state;
  const apply = (lon, lat) => {
    if (!C.gridCells(S.sgg).some(f => C.pipFeature(lon, lat, f))) { C.toast(t('sim.outside')); return; }
    setFrom([lon, lat], t('sim.gps')); run();
  };
  if (st.gps && Date.now() - (st.gps.at || 0) < 5 * 60 * 1000) { apply(st.gps.lon, st.gps.lat); return; }
  if (!navigator.geolocation) { C.toast(t('gps.unsupported')); return; }
  S.busy = true; render();
  navigator.geolocation.getCurrentPosition(pos => { S.busy = false; st.gps = { ...(st.gps || {}), lon: pos.coords.longitude, lat: pos.coords.latitude, at: Date.now() }; apply(pos.coords.longitude, pos.coords.latitude); },
    () => { S.busy = false; render(); C.toast(t('gps.fail')); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

async function run() {
  if (!S.from || S.busy) return;
  S.busy = true; S.err = null; S.rows = null; render();
  try {
    const st = C.state;
    const kinds = SHELTER_KINDS.filter(k => st.shelters.avail.some(a => a.id === k));
    const list = kinds.length ? (await C.nearestShelters(S.from, kinds, st.sido, 3)).sort((a, b) => a.d - b.d).slice(0, 3) : [];
    if (!list.length) { S.err = 'noshelter'; return; }
    const cells = C.gridCells(S.sgg).map(f => {
      const ring = f.geometry.coordinates[0], m = ring.length - 1; let x = 0, y = 0;
      for (let i = 0; i < m; i++) { x += ring[i][0]; y += ring[i][1]; }
      const p = f.properties;
      return { h3: p.h3, c: [x / m, y / m], ring, p: { flood_hist_n: p.flood_hist_n, flood_depth_max_m: p.flood_depth_max_m, slope_mean: p.slope_mean, landslide_hist_n: p.landslide_hist_n, emd_name: p.emd_name } };
    });
    const hazards = [];
    for (const k of HZ_KINDS) for (const f of await C.collectShelters([k], st.sido)) hazards.push({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], kind: k });
    const rows = [];
    for (const it of list) {
      const r = await compute({ cells, from: S.from, to: it.c, hazards, scn: { rain: false, lslide: false } });
      // 대피소가 격자 밖(다른 시·군·구)이면 직선 거리만 말한다 — 위험 칸은 '모름'
      rows.push({ name: it.p.name || it.k.ko, kind: getLang() === 'en' ? '' : String(it.p.type || '').split(' / ').pop().replace(/\s*\(.*$/, ''), icon: it.k.icon, len: r.ok ? r.short.len_m : Math.round(it.d), sum: r.ok ? r.short.sum : null });
    }
    rows.sort((a, b) => a.len - b.len);
    S.rows = rows; C.stat && C.stat('shelter_access_shown');
  } catch (e) { console.warn('access failed', e); S.err = 'fail'; }
  finally { S.busy = false; render(); if (C.onDone) C.onDone(); }
}
function compute(payload) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) worker = new Worker('js/sim_worker.js?v=20260914b');
      const to = setTimeout(() => { try { worker.terminate(); } catch (e) { /* */ } worker = null; reject(new Error('timeout')); }, 20000);
      worker.onmessage = ev => { clearTimeout(to); resolve(ev.data); };
      worker.onerror = ev => { clearTimeout(to); worker = null; reject(ev.error || new Error(ev.message || 'worker')); };
      worker.postMessage(payload);
    } catch (e) { reject(e); }
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 대피소 한 곳 = 이름 + 문장들 (화면·결과·인쇄 카드가 같이 쓴다, HTML 아님) */
function describe(r) {
  const fast = Math.max(1, Math.round(r.len / WALK)), slow = Math.max(1, Math.round(r.len / SLOW));
  const slowFirst = !!(C.profile && C.profile().mob);   // 우리 집 프로필 '거동 불편'이면 느린 걸음을 앞에
  const lines = [slowFirst ? t('acc.walk.slow', { slow, fast }) : t('acc.walk', { fast, slow })];
  if (!r.sum) lines.push(t('acc.nogrid'));
  else {
    const hz = r.sum.hz || {}, n0 = lines.length;
    if (r.sum.flood) lines.push(t('acc.flood', { n: r.sum.flood }));
    if (hz.underpass) lines.push(t('acc.underpass', { n: hz.underpass }));
    if (r.sum.steep || hz.steep) lines.push(t('acc.steep', { n: (r.sum.steep || 0) + (hz.steep || 0) }));
    if (r.sum.lslide) lines.push(t('acc.lslide', { n: r.sum.lslide }));
    if (lines.length === n0) lines.push(t('acc.none'));
  }
  return { name: r.kind ? `${r.name} (${r.kind})` : r.name, lines };
}
const lineText = r => { const d = describe(r); return `${d.name} — ${d.lines.join(' ')}`; };
function render() {
  const box = $('#simBox'); if (!box || !C.state.sim) return;
  const body = S.busy ? `<div class="sim-wait">${t('sim.running')}</div>`
    : S.err ? `<div class="sim-err">${t(S.err === 'noshelter' ? 'sim.noshelter' : 'sim.fail')}</div>`
    : S.rows ? `<ol class="acc-list">${S.rows.map(r => { const d = describe(r); return `<li><b>${esc(r.icon || '')} ${esc(d.name)}</b>${d.lines.map(x => `<span>${esc(x)}</span>`).join('')}</li>`; }).join('')}</ol>`
    : `<div class="muted">${t('acc.needfrom')}</div>`;
  box.innerHTML = `
    <div class="sim-head"><h3>${t('acc.title')}</h3><button type="button" class="btn btn-ghost btn-sm" data-act="close">${t('sim.close')}</button></div>
    <div class="sim-row"><span class="lbl">${t('sim.from')}</span><span class="sim-val ${S.from ? '' : 'muted'}">${S.from ? esc(S.fromLabel) : t('sim.unset')}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="gps"${S.busy ? ' disabled' : ''}>${t('sim.gps')}</button></div>
    ${body}
    <div class="fine sim-note">${t('acc.note')}</div><div class="fine">${t('sim.src')} · ${t('acc.slowsrc')} · <a href="sim.html" target="_blank" rel="noopener">${t('acc.sandbox')}</a></div>`;
  box.querySelector('[data-act="close"]').onclick = closeAccess;
  box.querySelector('[data-act="gps"]').onclick = useGps;
}
