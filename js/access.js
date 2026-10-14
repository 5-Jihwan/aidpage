/* 대피소 접근 문장 카드 (S0, docs/25 (d)안 · docs/30 결정 S1·S4)
   본 사이트는 경로 선을 그리지 않는다. 가까운 대피소 3곳마다 "걸어서 약 n분 · 가는 방향에 침수 이력 칸 n · 지하차도 근처 n"을 문장으로만 보여준다.
   계산은 전국 미리 계산(scripts/access_top3.py → data/access/<sgg>.json)을 읽는다. 옛 기기 경로 계산(sim_worker)과 선이 있는 sim.html은 10-14 폐기(docs/56 N7).
   미리 계산이 없는 자리는 직선 거리로만 안내한다. */
import { t, getLang } from './i18n.js?v=20261014g';
const $ = (s, r = document) => r.querySelector(s);
// 민방위 대피시설은 대부분 지하(공습 대비)라 침수 맥락의 이 카드에서는 뺀다. 지진옥외대피장소는 비를 피할 수 없는 공터라 뺀다.
const SHELTER_KINDS = ['temp_housing', 'tsunami'];
const SLOW = 48, WALK = 67;   // m/분 — 67 = 보통 걸음 약 4 km/h(법정 기준 아님), 48 = 느린 걸음 0.8 m/s(고령·거동 불편 관행, docs/63 G4)
let C = null;
/* v2(10-14): 전국 미리 계산(scripts/access_top3.py) — 칸마다 가까운 임시주거시설 3곳 [번호, 거리 m, 비트].
   비트 1 깊은 침수 기록(0.5 m+) · 2 지하차도 150 m · 4 침수 기록(깊이 무관) · 16 산사태 기록 칸. (8 칸 경사·32 급경사지는 문장에 쓰지 않음 — docs/56 §5 C안: 도시 축대까지 잡혀 주민 7명 중 1명에게 경고가 붙음)
   미리 계산이 없는 자리는 직선 거리로만 안내한다. 걷는 속도는 Atlas·논문 D와 같은 48 m/분(느린 걸음). */
const PRE = new Map(), PRE_V = '20261014a';
const loadPre = sgg => { if (!PRE.has(sgg)) PRE.set(sgg, fetch(`data/access/${sgg}.json?v=${PRE_V}`).then(r => r.ok ? r.json() : null).catch(() => null)); return PRE.get(sgg); };
function cellAt(sgg, lonlat) {
  const cs = C.gridCells(sgg); if (!cs.length) return null;
  const hit = cs.find(f => C.pipFeature(lonlat[0], lonlat[1], f)); if (hit) return hit.properties.h3;
  let best = null, bd = Infinity;   // 경계 밖이면 가장 가까운 칸
  for (const f of cs) { const r = f.geometry.coordinates[0]; const d = (r[0][0] - lonlat[0]) ** 2 + (r[0][1] - lonlat[1]) ** 2; if (d < bd) { bd = d; best = f; } }
  return best && best.properties.h3;
}
async function runPre() {
  const d = await loadPre(S.sgg); if (!d) return false;
  const h = cellAt(S.sgg, S.from), row = h && d.c[h]; if (!row || !row.some(Array.isArray)) return false;   // 빈 행(닿는 시설 없음)은 직선 거리 대체로
  const icon = (C.state.shelters.avail.find(a => a.id === 'temp_housing') || {}).icon || '🏫';
  const legs = row.filter(Array.isArray), extra = row.find(x => !Array.isArray(x));
  const rows = legs.map(([i, len, bits]) => ({ name: d.s[i][0], kind: getLang() === 'ko' ? '이재민 임시주거시설' : '', icon, len, bits }));
  if (rows.length >= 2 && rows.every(r => r.bits & 3)) rows.allhz = true;
  if (extra && extra.x) rows.snap = extra.x;
  const ts = d.t && d.t[h]; if (ts) rows.ts = { name: d.ts[ts[0]][0], len: ts[1] };
  S.rows = rows; C.stat && C.stat('shelter_access_shown'); return true;
}
const S = { sgg: null, from: null, fromLabel: '', rows: null, busy: false, err: null };

export function initAccess(ctx) { C = ctx; }
/** 결과·인쇄 카드가 같은 문장을 가져다 쓴다 (같은 시·군·구에서 계산된 적이 있을 때만) */
export function accessLines() { return S.rows && S.sgg === C.state.sgg ? { from: S.fromLabel, rows: [...S.rows.map(lineText), ...extraLines(S.rows)] } : null; }

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
    if (await runPre()) return;
    const st = C.state;
    const kinds = SHELTER_KINDS.filter(k => st.shelters.avail.some(a => a.id === k));
    const list = kinds.length ? (await C.nearestShelters(S.from, kinds, st.sido, 3)).sort((a, b) => a.d - b.d).slice(0, 3) : [];
    if (!list.length) { S.err = 'noshelter'; return; }
    // 미리 계산이 없는 자리(칸 밖·파일 없음): 직선 거리로만 말한다 — 가는 길 정보는 '모름'(옛 기기 경로 계산 sim_worker는 10-14 폐기, docs/56 N7)
    const rows = list.map(it => ({ name: it.p.name || it.k.ko, kind: getLang() !== 'ko' ? '' : String(it.p.type || '').split(' / ').pop().replace(/\s*\(.*$/, ''), icon: it.k.icon, len: Math.round(it.d), sum: null }));
    rows.sort((a, b) => a.len - b.len);
    S.rows = rows; C.stat && C.stat('shelter_access_shown');
  } catch (e) { console.warn('access failed', e); S.err = 'fail'; }
  finally { S.busy = false; render(); if (C.onDone) C.onDone(); }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 대피소 한 곳 = 이름 + 문장들 (화면·결과·인쇄 카드가 같이 쓴다, HTML 아님) */
function describe(r) {
  if (r.bits != null) {   // v2: 가장 짧은 길 하나에 대해서만 말한다
    const fast = Math.max(1, Math.round(r.len / WALK)), slow = Math.max(1, Math.round(r.len / SLOW));
    const lines = [C.profile && C.profile().mob ? t('acc.walk.slow', { slow, fast }) : t('acc.walk', { fast, slow })], n0 = lines.length;
    if (r.bits & 1) lines.push(t('acc2.deep')); else if (r.bits & 4) lines.push(t('acc2.flood'));
    if (r.bits & 2) lines.push(t('acc2.underpass'));
    if (r.bits & 16) lines.push(t('acc2.lslide'));
    if (lines.length === n0) lines.push(t('acc2.none'));
    return { name: r.kind ? `${r.name} (${r.kind})` : r.name, lines };
  }
  const fast = Math.max(1, Math.round(r.len / WALK)), slow = Math.max(1, Math.round(r.len / SLOW));
  const lines = [C.profile && C.profile().mob ? t('acc.walk.slow', { slow, fast }) : t('acc.walk', { fast, slow }), t('acc.nogrid')];   // 직선 거리 대체(미리 계산 없음)
  return { name: r.kind ? `${r.name} (${r.kind})` : r.name, lines };
}
const extraLines = rows => [rows.allhz ? t('acc2.allhz') : null, rows.snap ? t('acc2.snap', { m: rows.snap }) : null,
  rows.ts ? t('acc2.ts', { name: rows.ts.name, fast: Math.max(1, Math.round(rows.ts.len / WALK)), slow: Math.max(1, Math.round(rows.ts.len / SLOW)) }) : null].filter(Boolean);
const lineText = r => { const d = describe(r); return `${d.name} — ${d.lines.join(' ')}`; };
function render() {
  const box = $('#simBox'); if (!box || !C.state.sim) return;
  const body = S.busy ? `<div class="sim-wait">${t('sim.running')}</div>`
    : S.err ? `<div class="sim-err">${t(S.err === 'noshelter' ? 'sim.noshelter' : 'sim.fail')}</div>`
    : S.rows ? `<ol class="acc-list">${S.rows.map(r => { const d = describe(r); return `<li><b>${esc(r.icon || '')} ${esc(d.name)}</b>${d.lines.map(x => `<span>${esc(x)}</span>`).join('')}</li>`; }).join('')}</ol>${extraLines(S.rows).map(x => `<div class="acc-extra">${esc(x)}</div>`).join('')}`
    : `<div class="muted">${t('acc.needfrom')}</div>`;
  box.innerHTML = `
    <div class="sim-head"><h3>${t('acc.title')}</h3><button type="button" class="btn btn-ghost btn-sm" data-act="close">${t('sim.close')}</button></div>
    <div class="sim-row"><span class="lbl">${t('sim.from')}</span><span class="sim-val ${S.from ? '' : 'muted'}">${S.from ? esc(S.fromLabel) : t('sim.unset')}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="gps"${S.busy ? ' disabled' : ''}>${t('sim.gps')}</button></div>
    ${body}
    ${S.rows && S.rows[0] && S.rows[0].bits != null ? `<div class="fine sim-note">${t('acc2.note')}</div><div class="fine">${t('acc2.src')}</div>` : `<div class="fine sim-note">${t('acc.note')}</div><div class="fine">${t('sim.src')} · ${t('acc.slowsrc')}</div>`}`;
  box.querySelector('[data-act="close"]').onclick = closeAccess;
  box.querySelector('[data-act="gps"]').onclick = useGps;
}
