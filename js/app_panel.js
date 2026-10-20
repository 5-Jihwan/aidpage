/* 실시간 조회·지역 패널·오늘 할 일·보험·제보·재난문자·팁·응급실 — 10-14 app.js에서 분리(500줄 규칙). */
import { t, getLang } from './i18n.js?v=20261020a';
import { cells as gridCells } from './grid.js?v=20261020a';
import { getReports, postReport, flagReport, getER } from './api.js?v=20260914b';
import { nearest as nearestShelters } from './shelters.js?v=20261008a';
import { $, $$, state } from './app.js?v=20261020a';
import { featuresWhere, map, openPopup, pipFeature, speak } from './app_map.js?v=20261020a';
import { renderNearest, resetNation, saveShelterKinds, selectEmd, selectSgg, selectSido } from './app_layers.js?v=20261020a';
import { getProfile } from './app_ui.js?v=20261020a';
import { applyDrawerFx, applyFolds, closeRegionDrawer, openRegionDrawer, regionMod, renderRegionSummary, renderSitBar } from './app_wizard.js?v=20261020a';
import { applyAlertFx } from './app_wx.js?v=20261020a';

export let _nameMemo = null;

export function nameOf() {
  const key = `${state.sido}|${state.sgg}|${state.emd}|${getLang()}`;
  if (_nameMemo && _nameMemo.key === key) return _nameMemo.val;
  const e = state.emd && state.idx.byEmd.get(state.emd), s = state.sgg && state.idx.bySgg.get(state.sgg);
  const sidoProps = state.sido && (featuresWhere(state.geo.sido, 'code', state.sido)[0] || { properties: {} }).properties;
  const sidoName = rn(e, 'sido_name') || rn(s, 'sido_name') || rn(sidoProps) || '';
  const val = { sidoName, sggName: rn(e, 'sgg_name') || rn(s) || '', emdName: e ? rn(e) : '' };
  _nameMemo = { key, val };
  return val;
}

export const rn = (o, k = 'name') => o ? ((getLang() !== 'ko' && o[k + '_en']) || o[k] || '') : '';

export const emdDisp = ko => { if (getLang() === 'ko' || !ko) return ko; const e = (state.idx.emdBySgg.get(String(state.sgg)) || []).find(x => x.name === ko); return (e && e.name_en) || ko; };

export const WX_MAX_AGE_H = 6;

export const tmISO = tm => /^\d{12}$/.test(String(tm || '')) ? `${tm.slice(0, 4)}-${tm.slice(4, 6)}-${tm.slice(6, 8)}T${tm.slice(8, 10)}:${tm.slice(10, 12)}:00+09:00` : null;

export const ageH = iso => { const ms = Date.parse(iso); return isNaN(ms) ? Infinity : (Date.now() - ms) / 36e5; };

export const weatherFor = sgg => {
  const W = state.live.weather; if (!W) return null;
  const w = W.by_sgg && W.by_sgg[String(sgg)]; if (w) { const at = W.base_time || W.updated; return ageH(at) <= WX_MAX_AGE_H ? { ...w, _at: at } : null; }
  const s = state.idx.bySgg.get(String(sgg)); const h = W.hub && W.hub.by_sido && s && W.hub.by_sido[String(s.sido)];
  if (!h) return null; const at = tmISO(h.tm) || W.hub.base_time || W.hub.updated;
  return ageH(at) <= WX_MAX_AGE_H ? { ...h, _sido: true, _at: at } : null; // 시도 대표 관측소 폴백 (단기예보가 열리기 전)
};

export const airFor = sgg => (state.live.air && state.live.air.by_sgg && state.live.air.by_sgg[String(sgg)]) || null;

export function recentQuake() {
  const q = state.live.alerts && state.live.alerts.quake; if (!q || !q.items) return null;
  const it = q.items.find(x => x.mag >= 3.0 && x.at && (Date.now() - new Date(`${x.at.slice(0, 4)}-${x.at.slice(4, 6)}-${x.at.slice(6, 8)}T${x.at.slice(8, 10)}:${x.at.slice(10, 12)}:00+09:00`).getTime()) < 24 * 3600 * 1000);
  return it || null;
}

export function warningsFor(sgg, sido) {
  const a = state.live.alerts; if (!a || !a.warnings || !a.warnings.items) return [...quakeAsWarning(), ...landslideAsWarning()];
  const n = nameOf(); // 항목·필드마다 재계산하지 않도록 1회만
  return [...a.warnings.items.filter(w => (w.area_codes || []).some(c => c === String(sgg) || c === String(sido)) || (w.areas || []).some(x => (n.sggName && x.includes(n.sggName)) || (n.sidoName && x === n.sidoName))), ...quakeAsWarning(), ...landslideAsWarning()];
}

export function landslideAsWarning() {
  const L = state.live.alerts && state.live.alerts.landslide; if (!L || !L.items || !L.items.length) return [];
  const n = nameOf(); if (!n.sggName) return [];
  return L.items
    .filter(it => it.at && Date.now() - Date.parse(it.at) < 24 * 3600 * 1000
      && it.region && it.region.includes(n.sggName) && (!n.sidoName || it.region.includes(n.sidoName)))
    .map(it => ({ type: '산사태', level: it.level, areas: [it.region], since: it.at }));
}

export function quakeAsWarning() { const q = recentQuake(); const T = state.live.alerts && state.live.alerts.typhoon; const out = q ? [{ type: '지진', level: '속보', areas: [`${q.loc} · M${q.mag}`], since: q.announced }] : []; for (const t of (T && T.items) || []) { const a = t.analysis || (t.forecast || [])[0]; if (a) out.push({ type: '태풍', level: '정보', areas: [`${t.year} ${t.no}호 · ${a.wind || '?'}m/s · ${a.pressure || '?'}hPa`], since: a.tm }); } return out; }

export const pmGrade = (v, pm25) => v == null ? '' : pm25 ? (v <= 15 ? 'g-good' : v <= 35 ? 'g-mod' : v <= 75 ? 'g-bad' : 'g-vbad') : (v <= 30 ? 'g-good' : v <= 80 ? 'g-mod' : v <= 150 ? 'g-bad' : 'g-vbad');

export function wxItems(sgg) {
  const w = weatherFor(sgg), a = airFor(sgg), out = [];
  const push = (k, v, unit, cls = '') => { if (v != null) out.push({ k, label: t('wx.' + k), v, unit, cls }); };
  if (w) { push('t', w.t != null ? w.t.toFixed(1) : null, '℃'); push('feels', w.feels != null ? w.feels.toFixed(1) : null, '℃'); push('rain', w.rn1 != null ? w.rn1 : null, 'mm'); push('reh', w.reh, '%'); push('wind', w.wsd, 'm/s'); }
  if (a) { push('pm10', a.pm10, '㎍/㎥', pmGrade(a.pm10)); push('pm25', a.pm25, '㎍/㎥', pmGrade(a.pm25, true)); }
  return out;
}

export const SKY_ICON = { 1: '☀️', 3: '⛅', 4: '☁️' }, PTY_ICON = { 1: '🌧️', 2: '🌨️', 3: '❄️', 4: '🌦️', 5: '💧', 6: '🌨️', 7: '❄️' };

export function fcstHTML(w) {
  const f = w && !w._sido && w.fcst3h; if (!f || !f.length) return '';
  const today = String(new Date().getDate()).padStart(2, '0');
  return `<div class="wx-fcst" role="list" aria-label="${t('wx.fcst')}">` + f.map(s =>
    `<div class="fs" role="listitem"><small>${s.d && s.d !== today ? t('wx.tmr') + ' ' : ''}${t('wx.hh', { h: +s.t.slice(0, 2) })}</small><span class="ic">${PTY_ICON[s.pty] || SKY_ICON[s.sky] || '☀️'}</span><b>${s.ta != null ? Math.round(s.ta) + '°' : '–'}</b><small class="pop">${s.pop >= 20 ? Math.round(s.pop) + '%' : ''}</small></div>`
  ).join('') + '</div>';
}

export function renderCrumb() {
  const n = nameOf(), c = $('#crumb'); c.innerHTML = '';
  const add = (label, go, last) => { const b = document.createElement('button'); b.className = 'crumb-item' + (last ? ' is-last' : ''); b.textContent = label; b.onclick = go; c.appendChild(b); };
  const sep = () => { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; c.appendChild(s); };
  add(t('nav.nation'), resetNation, state.level === 'nation');
  if (state.sido) { sep(); add(n.sidoName, () => selectSido(state.sido), state.level === 'sido'); }
  if (state.sgg) { sep(); add(n.sggName, () => selectSgg(state.sgg), state.level === 'sgg'); }
  if (state.emd) { sep(); add(n.emdName, () => {}, true); }
}

export const WARN_EN = { '폭염': 'Heat', '호우': 'Heavy rain', '대설': 'Heavy snow', '강풍': 'Strong wind', '한파': 'Cold wave', '건조': 'Dry', '태풍': 'Typhoon', '지진': 'Earthquake', '풍랑': 'High seas', '황사': 'Yellow dust', '산사태': 'Landslide', '주의보': ' advisory', '경보': ' warning', '속보': ' bulletin', '정보': ' info' };

export const warnName = (type, level) => getLang() !== 'ko' ? (WARN_EN[type] || type) + (WARN_EN[level] || ' ' + level) : type + level;

export const floodContext = ws => (ws || []).some(w => /호우|태풍|산사태|홍수/.test(w.type || '')) || ['house_flood', 'shop_flood', 'before_rain'].includes(state.sit);

export const evacKind = ws => (ws || []).some(w => w.type === '지진') ? 'quake' : 'temp_housing';

export const ALERT_MAP = { // 특보 종류·단계 → 행동 문구 키 + 자동 시설
  '폭염': { key: 'heat', kinds: ['heat'] }, '호우': { key: 'rain', kinds: ['temp_housing', 'townhall', 'underpass'] }, '대설': { key: 'snow', kinds: ['cold'] },
  '강풍': { key: 'wind', kinds: [] }, '한파': { key: 'cold', kinds: ['cold'] }, '건조': { key: 'dry', kinds: [] }, '태풍': { key: 'typhoon', kinds: ['temp_housing', 'townhall'] },
  '지진': { key: 'quake', kinds: ['quake'] }, '풍랑': { key: 'sea', kinds: [] }, '황사': { key: 'dust', kinds: ['dust'] },
  '산사태': { key: 'lslide', kinds: ['temp_housing'] },
};

export function todoItems() {
  const ws = warningsFor(state.sgg, state.sido), m = new Date().getMonth() + 1, out = [], seen = new Set();
  const add = (key, kind, src, why) => { if (seen.has(key) || out.length >= 3) return; seen.add(key); out.push({ text: t('todo.' + key), kind, src: src || null, why: why || null }); };
  const P = getProfile(), n = nameOf(), here = n.emdName || n.sggName || '';
  // "왜 이 안내가 뜨나"(docs/18 §3): 내 위치 + 발동 조건 + 이력. 효과는 가설 — 방법·한계에 명시
  const cellsHere = state.emd ? gridCells(state.sgg).filter(f => String(f.properties.emd_code) === String(state.emd)) : [];
  const histLine = k => { if (!cellsHere.length) return ''; if (k === 'rain' || k === 'typhoon') { const f = cellsHere.filter(c => c.properties.flood_hist_n > 0).length; return f ? ' · ' + t('todo.why.hist', { emd: here, p: Math.round(f / cellsHere.length * 100) }) : ''; } if (k === 'lslide') { const sl = cellsHere.reduce((a, c) => a + (c.properties.slope_mean || 0), 0) / cellsHere.length; return sl ? ' · ' + t('todo.why.slope', { emd: here, s: sl.toFixed(1) }) : ''; } return ''; };
  const whyAlert = (w, k) => t('todo.why.alert', { w: warnName(w.type, w.level), area: here }) + histLine(k);
  const whyProf = k => t('todo.why.prof', { p: t('todo.pf.' + k) });
  const sitEl = state.sit && document.querySelector(`[data-sit="${state.sit}"]`); const whySit = t('todo.why.sit', { s: sitEl ? (sitEl.querySelector('b') || sitEl).textContent.trim() : state.sit });
  const whySeason = t('todo.why.season', { m }), whyAlways = t('todo.why.always');
  for (const w of ws) { const a = ALERT_MAP[w.type]; if (!a) continue; let lv = /경보/.test(w.level) ? 'warn' : 'adv';
    if (P.floor === 'semi' && a.key === 'rain') lv = 'warn';                       // 반지하: 호우는 주의보도 경보 문구로
    if (a.key === 'heat' && (P.senior || P.child)) add('prof.heat.senior', 'heat', null, whyAlert(w, a.key) + ' · ' + whyProf(P.senior ? 'senior' : 'child'));  // 어르신·영유아: 폭염 우선 문구
    if (a.key === 'wind' && P.floor === 'high') add('prof.wind.high', null, null, whyAlert(w, a.key) + ' · ' + whyProf('high'));
    add(`alert.${a.key}.${lv}`, a.kinds[0], 'kma', whyAlert(w, a.key) + (P.floor === 'semi' && a.key === 'rain' ? ' · ' + whyProf('semi') : '')); }
  if (P.floor === 'semi' && (m >= 6 && m <= 9)) add('prof.semi.summer', 'temp_housing', null, whyProf('semi') + ' · ' + whySeason);
  if (P.mob) add('prof.mob', 'temp_housing', null, whyProf('mob'));
  if (P.pet && (state.sit === 'evacuating' || ws.length)) add('prof.pet', null, null, whyProf('pet'));
  if (P.car && ws.some(w => w.type === '호우' || w.type === '태풍')) add('prof.car', null, null, whyProf('car') + ' · ' + whyAlert(ws.find(w => w.type === '호우' || w.type === '태풍'), 'rain'));
  if (state.sit === 'house_flood' || state.sit === 'shop_flood') { add('sit.photo', null, null, whySit); add('sit.report10', 'townhall', null, whySit); }
  if (state.sit === 'evacuating') { add('sit.evac', evacKind(ws), null, whySit); add('sit.meds', 'pharmacy', null, whySit); }
  if (state.sit === 'injury') { add('sit.er', 'er', null, whySit); add('sit.psych', null, null, whySit); }
  if (state.sit === 'no_news') { add('sit.ask', 'townhall', null, whySit); }
  if (m >= 6 && m <= 9) { add('season.summer.water', 'heat', null, whySeason); add('season.summer.drain', null, null, whySeason); }
  else if (m === 12 || m <= 2) { add('season.winter.taps', 'cold', null, whySeason); add('season.winter.ice', null, null, whySeason); }
  else if (m >= 3 && m <= 5) { add('season.spring.fire', null, null, whySeason); add('season.spring.dust', 'dust', null, whySeason); }
  else { add('season.autumn.typhoon', 'temp_housing', null, whySeason); }
  add('always.shelter', floodContext(ws) ? 'temp_housing' : 'civil_defense', null, whyAlways); add('always.townhall', 'townhall', null, whyAlways);
  return out.slice(0, 3);
}

export async function renderRiskLine() {
  const box = $('#riskLine'); if (!box) return;
  if (!state.sgg) { box.hidden = true; return; }
  const parts = [];
  const ws = warningsFor(state.sgg, state.sido), A = state.live.alerts;
  const fresh = A && A.status === 'ok' && A.updated && (Date.now() - Date.parse(A.updated)) < 3 * 3600 * 1000;
  parts.push(ws.length ? `<span class="rl-bad">⚠ ${t('risk.inWarn', { w: ws.map(w => warnName(w.type, w.level)).join(', ') })}</span>` : fresh ? `<span class="rl-ok">${t('risk.noWarn')}</span>` : `<span class="muted">${t('risk.unknown')}</span>`);
  // 강수 지표: 비가 실제로 올 때만 한 세그먼트. 임계값은 호우특보 기준 근사
  // (주의보 = 3h 60㎜ 또는 12h 110㎜) — 시간당 20㎜/일 110㎜↑ 위험, 5㎜/50㎜↑ 주의.
  const wx = weatherFor(state.sgg);
  if (wx && ((wx.rn1 || 0) >= 1 || (wx.rn_day || 0) >= 10)) {
    const cls = (wx.rn1 >= 20 || wx.rn_day >= 110) ? 'rl-bad' : (wx.rn1 >= 5 || wx.rn_day >= 50) ? 'rl-warn' : '';
    const seg = [];
    if (wx.rn1 != null) seg.push(t('risk.rain.h', { n: wx.rn1 }));
    if (wx.rn_day != null) seg.push(t('risk.rain.d', { n: Math.round(wx.rn_day) }));
    parts.push(`<span${cls ? ` class="${cls}"` : ''}>☔ ${seg.join(' · ')}${wx._sido && wx.stn_name ? t('risk.rain.stn', { s: wx.stn_name }) : ''}</span>`);
  }
  // 하천 수위(HRFCO — 키 등록 전엔 items가 비어 조용히 잠듦): 선택 시군구 안 관측소가
  // 주의보 수위 이상일 때만 최악 1곳을 표시. 단계 = 심각>경보>주의보 순 판정.
  const rv = state.live.alerts && state.live.alerts.river;
  if (rv && rv.items && rv.items.length) {
    const sf = featuresWhere(state.geo.sgg, 'code', state.sgg)[0];
    const inSgg = sf ? rv.items.filter(it => it.lon != null && pipFeature(it.lon, it.lat, sf)) : [];
    const grade = it => it.severe != null && it.level_m >= it.severe ? 3 : it.alarm != null && it.level_m >= it.alarm ? 2 : it.attn != null && it.level_m >= it.attn ? 1 : 0;
    const worst = inSgg.map(it => ({ it, g: grade(it) })).filter(x => x.g > 0).sort((a, b) => b.g - a.g)[0];
    if (worst) parts.push(`<span class="${worst.g >= 2 ? 'rl-bad' : 'rl-warn'}">🌊 ${t('risk.river', { s: worst.it.station, lv: t('risk.river.g' + worst.g), m: worst.it.level_m })}</span>`);
  }
  const e = state.emd && state.idx.byEmd.get(state.emd);
  if (e) {
    const cells = gridCells(state.sgg).map(f => f.properties).filter(p => p.emd_name === e.name);
    if (cells.length) { const k = cells.filter(p => p.flood_hist_n > 0).length; parts.push(k ? `<span class="rl-bad">${t('risk.flood', { n: k, total: cells.length })}</span>` : `<span>${t('risk.flood0', { total: cells.length })}</span>`); }
    if (state.shelters.avail.some(a => a.id === 'underpass' || a.id === 'steep')) {
      const hz = await nearestShelters([e.lon, e.lat], ['underpass', 'steep'].filter(k => state.shelters.avail.some(a => a.id === k)), state.sido, 2, true);
      const near = hz.filter(h => h.d <= 500);
      if (near.length) parts.push(`<span class="rl-warn">${t('risk.hazardNear', { list: near.map(h => `${h.k.icon} ${h.p.name} ${h.walk}${t('risk.min')}`).join(' · ') })}</span>`);
    }
  }
  if (state.emd !== (e && e.code) && e) return;
  box.hidden = false; box.innerHTML = parts.join('<span class="rl-sep"> · </span>') + `<small class="muted rl-basis">${t('risk.basis')}</small>`;
}

export function renderTodo() {
  const box = $('#todoCard'); if (!box) return;
  if (!state.sgg) { box.hidden = true; return; }
  const items = todoItems(); box.hidden = !items.length;
  const n = nameOf(), place = [n.sggName, state.emd && n.emdName].filter(Boolean).join(' ');
  const SRC = { kma: t('src.kma'), mois: t('src.mois'), safepic: t('src.safepic') }; // 출처는 '특보 기준' 표기 — 문구 자체는 AidPage 안내
  box.innerHTML = `<h3>${t('todo.title')} <small class="muted">${place}</small> <button type="button" class="speak-mini" id="todoSpeak" title="${t('tts.title')}">🔊</button></h3><ol class="todo-list">${items.map((x, i) => `<li><span>${x.src ? `<b class="todo-src">[${SRC[x.src] || x.src}]</b> ` : ''}${x.text}${x.why ? `<small class="todo-why">${x.why}</small>` : ''}</span>${x.kind && state.shelters.avail.some(a => a.id === x.kind) ? `<button type="button" class="btn btn-ghost btn-sm" data-kind="${x.kind}">${t('todo.show')}</button>` : ''}</li>`).join('')}</ol>`;
  $('#todoSpeak').addEventListener('click', () => speak(items.map((x, i) => `${i + 1}. ${x.text}`).join('. '), $('#todoSpeak')));
  $$('button[data-kind]', box).forEach(b => b.addEventListener('click', () => { state.shelters.active.add(b.dataset.kind); saveShelterKinds(); renderNearest(); }));
}

export function renderInsurance() {
  const box = $('#insCard'); if (!box) return;
  if (state.level !== 'emd' || !state.rules) { box.hidden = true; return; }
  const rules = (state.rules.all || []).filter(r => r.group === 'insurance' && (r.conditions.housing || []).includes('own'));
  if (!rules.length) { box.hidden = true; return; }
  const gen = rules.find(r => r.id === 'insurance.house_general'), full = rules.find(r => /full/.test(r.id));
  const cells = gridCells(state.sgg), e = state.idx.byEmd.get(state.emd);
  const mine = e ? cells.map(f => f.properties).filter(p => p.emd_name === e.name) : [];
  const flood = mine.length ? mine.filter(p => p.flood_hist_n > 0).length : null;
  const hist = `<div class="ins-hist"><button type="button" class="linkish" id="insToRegion">${t('ins.hist.go')}</button></div>`; // 09-04: 침수 셀 수치는 서랍 재난 이력 블록이 집(격자 로딩 전에도 링크는 항상)
  box.hidden = false;
  box.innerHTML = `<h3>${t('ins.title')}</h3><div class="ins-rate"><b>${gen ? gen.amount_text : ''}</b><small class="muted"> · ${full ? full.amount_text : ''} (${t('ins.full.who')})</small></div><a class="btn btn-primary btn-sm ins-cta" href="https://www.mois.go.kr/frt/sub/a06/b11/insuranceOverview/screen.do" data-stat="ins_click" target="_blank" rel="noopener">☂ ${t('ins.cta')}</a><div class="fine">${t('ins.where')} · ${t('badge.asof')} ${(state.rules.insurance && state.rules.insurance.meta && state.rules.insurance.meta.asof) || '2026-08'}</div>`;
  if (hist) { box.insertAdjacentHTML('beforeend', hist); const b = $('#insToRegion'); if (b) b.addEventListener('click', openRegionDrawer); }
}

export const REPORT_KINDS = ['shelter_closed', 'drain', 'road', 'water', 'other'];

export async function renderReports() {
  const box = $('#reportBox'); if (!box) return;
  if (!state.sgg) { box.hidden = true; return; }
  const sgg = state.sgg; box.hidden = false;
  const form = `<form class="rep-form" id="repForm"><select name="kind" required>${REPORT_KINDS.map(k => `<option value="${k}">${t('rep.k.' + k)}</option>`).join('')}</select><input name="text" maxlength="140" minlength="4" required placeholder="${t('rep.ph')}"><button type="submit" class="btn btn-primary btn-sm">${t('rep.send')}</button></form><small class="fine">${t('rep.rules')}</small>`;
  box.innerHTML = `<h3>${t('rep.title')} <small class="muted">${nameOf().sggName}</small></h3><div id="repList" class="muted" style="font-size:.9rem">…</div>${form}`;
  const list = $('#repList');
  const paint = items => {
    if (!items.length) { list.innerHTML = `<div class="muted">${t('rep.none')}</div>`; return; }
    list.innerHTML = items.map(r => `<div class="rep-item"><span class="rep-k">${t('rep.k.' + r.kind)}</span><span class="rep-t">${escapeHTML(r.text)}</span><small class="muted">${relTime(r.t)}${r.emd && state.idx.byEmd.get(r.emd) ? ' · ' + state.idx.byEmd.get(r.emd).name : ''}</small><button type="button" class="rep-flag" data-id="${r.id}" title="${t('rep.flag')}">⚑</button></div>`).join('');
    $$('.rep-flag', list).forEach(b => b.addEventListener('click', async () => { b.disabled = true; const r = await flagReport(sgg, b.dataset.id); b.textContent = r.status === 'ok' ? '✓' : '⚑'; }));
    paintReportMarkers(items);
  };
  state._repCache = state._repCache || {};
  const c = state._repCache[sgg];
  const res = c && Date.now() - c.t < 60000 ? c.res : await getReports(sgg);
  state._repCache[sgg] = { t: Date.now(), res };
  if (state.sgg !== sgg) return; applyFolds();
  if (res.status !== 'ok') { list.innerHTML = `<div class="muted">${t(res.status === 'offline' ? 'rep.offline' : 'rep.err')}</div>`; } else paint(res.items);
  $('#repForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, btn = f.querySelector('button'); btn.disabled = true;
    // 지오프라이버시(docs/18 §5): 제보 핀 좌표는 약 100 m(소수 3자리)로 뭉개서 보낸다 — 집 위치가 특정되지 않게
    const gps = state.gps && state.gps.emd === state.emd ? { lon: +state.gps.lon.toFixed(3), lat: +state.gps.lat.toFixed(3) } : {};
    const r = await postReport({ sgg, emd: state.emd, kind: f.kind.value, text: f.text.value, ...gps });
    btn.disabled = false;
    if (r.status === 'ok') { f.reset(); const again = await getReports(sgg); if (again.status === 'ok') paint(again.items); }
    else alert(t(r.status === 'rate_limited' ? 'rep.limit' : r.message ? 'rep.nolink' : 'rep.err'));
  });
}

export function paintReportMarkers(items) {
  if (!map) return;
  const fc = { type: 'FeatureCollection', features: items.filter(r => r.lon && r.lat).map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { kind: r.kind, text: r.text } })) };
  if (map.getSource('reports')) map.getSource('reports').setData(fc);
  else {
    map.addSource('reports', { type: 'geojson', data: fc });
    map.addLayer({ id: 'reports-dot', type: 'circle', source: 'reports', paint: { 'circle-radius': 7, 'circle-color': '#d9a400', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.on('click', 'reports-dot', e => { const p = e.features[0].properties; openPopup(e.lngLat, `<b>${t('rep.k.' + p.kind)}</b><br><small>${escapeHTML(p.text)}</small>`); });
  }
}

export const escapeHTML = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function msgsFor() {
  const M = state.live.alerts && state.live.alerts.messages;
  if (!M || !M.items || !M.items.length) return [];
  const e = state.emd && state.idx.byEmd.get(state.emd), s = state.sgg && state.idx.bySgg.get(state.sgg);
  const sgg = (e && e.sgg_name) || (s && s.name) || '';
  const sido = (e && e.sido_name) || (s && s.sido_name) || '';
  return M.items.filter(m => { const r = m.region || ''; return (sgg && r.includes(sgg)) || (sido && r.includes(sido)) || /전국/.test(r); }).slice(0, 30);
}

export function renderMsgs() {
  const box = $('#msgCard'); if (!box) return;
  const ms = state.sgg ? msgsFor() : [];
  box.hidden = !ms.length; if (!ms.length) { box.innerHTML = ''; return; }
  const item = m => `<div class="msg-item${/위급|긴급/.test(m.step || '') ? ' is-urgent' : ''}"><div class="msg-head"><span class="msg-type">${escapeHTML(m.type || '') || t('msg.alert')}</span><small class="muted">${m.time ? relTime(Date.parse(m.time)) : ''} · ${escapeHTML((m.region || '').split(',')[0])}</small></div><div class="msg-text">${escapeHTML(m.text || '')}</div></div>`;
  box.innerHTML = `<h3>${t('msg.title')}</h3>` + ms.slice(0, 3).map(item).join('')
    + (ms.length > 3 ? `<details class="msg-more"><summary>${t('msg.more', { n: ms.length - 3 })}</summary>${ms.slice(3).map(item).join('')}</details>` : '')
    + `<small class="fine">${t('msg.src')}</small>`;
}

export function relTime(ts) { const m = Math.round((Date.now() - ts) / 60000); if (m < 60) return t('rel.min', { n: m }); const h = Math.round(m / 60); if (h < 24) return t('rel.hour', { n: h }); return t('rel.day', { n: Math.round(h / 24) }); }

export const TIP_MS = () => (document.documentElement.classList.contains('big') ? 14000 : 9000);

export function stopTipTimer() { if (state._tipTimer) { clearTimeout(state._tipTimer); state._tipTimer = null; } }

export function startTipTimer() {
  stopTipTimer();
  if (state._tipManual || state._tipHold || document.hidden) return;
  if (!state.tips || state.tips.tips.length < 2) return;
  state._tipTimer = setTimeout(() => renderTip(1, { auto: true }), TIP_MS());
}

export function renderTip(step = 0, opts = {}) {
  const box = $('#tipCard'); if (!box || !state.tips || !state.tips.tips.length) return;
  if (step !== 0 && !opts.auto) state._tipManual = true;   // 사용자가 조작하면 자동 넘김 중단
  const tips = state.tips.tips, day = Math.floor(Date.now() / 86400000);
  state._tipIdx = ((state._tipIdx == null ? day : state._tipIdx) + step + tips.length) % tips.length;
  const tp = tips[state._tipIdx], en = getLang() !== 'ko';
  box.hidden = false;
  box.innerHTML = `<div class="tip-head"><span class="tip-label">${t('tip.title')}</span><span class="tip-nav"><button type="button" class="tip-btn" data-d="-1" aria-label="prev">‹</button><span class="mono">${state._tipIdx + 1}/${tips.length}</span><button type="button" class="tip-btn" data-d="1" aria-label="next">›</button></span></div><p class="tip-text">${en ? tp.en : tp.ko}</p><small class="tip-src">${t('tip.src')} ${en ? (tp.src_en || tp.src) : tp.src}</small>${state._tipManual ? '' : `<span class=\"tip-prog\" style=\"animation-duration:${TIP_MS()}ms\"></span>`}`;
  $$('.tip-btn', box).forEach(b => b.addEventListener('click', () => renderTip(+b.dataset.d)));
  if (!box.dataset.tipBound) {   // 카드는 다시 그려도 요소는 같으므로 1회만 바인딩
    box.dataset.tipBound = '1';
    // 재개할 때는 같은 팁을 다시 그린다 — 그래야 진행 표시줄과 타이머가 0에서 함께 출발한다.
    const hold = on => { state._tipHold = on; on ? stopTipTimer() : renderTip(0); };
    box.addEventListener('mouseenter', () => hold(true));
    box.addEventListener('mouseleave', () => hold(false));
    box.addEventListener('focusin', () => hold(true));
    box.addEventListener('focusout', () => hold(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTipTimer(); else if (!state._tipManual && !state._tipHold) renderTip(0);
    });
  }
  startTipTimer();
}

export const ER_FRESH_MS = 120000;

export function refreshER() {
  const sgg = state.sgg; if (!sgg) return;
  const s = state.idx.bySgg.get(String(sgg)); if (!s || !s.sido_name || !s.name) return;
  state._erAt = state._erAt || {};
  if (state._erAt[sgg] && Date.now() - state._erAt[sgg] < ER_FRESH_MS) return;
  state._erAt[sgg] = Date.now();
  getER(sgg, s.sido_name, s.name).then(j => {
    if (!j || j.status !== 'ok' || !Array.isArray(j.rows) || !j.rows.length) return;
    if (!state.live.er) state.live.er = { by_sgg: {} };
    if (!state.live.er.by_sgg) state.live.er.by_sgg = {};
    state.live.er.by_sgg[sgg] = j.rows;
    state.live.er.updated = j.updated;
    if (String(state.sgg) === String(sgg)) renderER();
  });
}

export function renderER() {
  const box = $('#erCard'); if (!box) return;
  refreshER();
  const E = state.live.er; const rows = E && E.by_sgg && state.sgg ? E.by_sgg[state.sgg] : null;
  if (!rows || !rows.length) { box.hidden = true; return; }
  const open = rows.filter(r => (r.beds || 0) > 0).sort((a, b) => (b.beds || 0) - (a.beds || 0));
  const stale = E.updated && (Date.now() - Date.parse(E.updated)) > 10 * 3600 * 1000;
  box.hidden = false;
  box.innerHTML = `<h3>${t('er.title')} <small class="muted">${open.length}/${rows.length}${t('er.cnt')}</small></h3>` +
    (open.length ? open.slice(0, 4).map(r => `<div class="er-item"><b>${escapeHTML(r.name)}</b><span class="er-meta">${t('er.beds')} <b class="mono">${escapeHTML(r.beds)}</b>${r.ct ? ' · CT' : ''}${r.mri ? ' · MRI' : ''}${r.icu ? ` · ${t('er.icu')} ${escapeHTML(r.icu)}` : ''}</span>${r.tel ? `<a href="tel:${r.tel.replace(/[^0-9-]/g, '')}" class="er-tel">📞 ${escapeHTML(r.tel)}</a>` : ''}</div>`).join('') : `<div class="muted">${t('er.none')}</div>`) +
    `<small class="muted er-src">${t('er.src')} · ${fmtTime(E.updated)}${stale ? ` · ${t('er.stale')}` : ''} · ${t('er.call')}</small>`;
}

export function renderRegion() {
  const landing = $('#nowLanding'), reg = $('#nowRegion');
  if (state.level === 'nation') { landing.hidden = false; reg.hidden = true; applyAlertFx([]); closeRegionDrawer(); return; }
  landing.hidden = true; reg.hidden = false;
  const n = nameOf();
  $('#regionPath').textContent = [n.sidoName, state.level !== 'sido' && n.sggName].filter(Boolean).join(' › ');
  $('#regionName').textContent = state.level === 'emd' ? n.emdName : state.level === 'sgg' ? n.sggName : n.sidoName;
  $('#levelGuide').innerHTML = ['sido', 'sgg', 'emd'].map(l => `<span class="${state.level === l ? 'on' : ''}">${t('lv.' + l)}</span>`).join('');
  renderTodo(); renderInsurance(); renderReports(); renderRiskLine(); renderER(); renderMsgs(); renderSitBar(); renderRegionSummary(); if (state._drawerOpen) { regionMod().then(m => m.refresh()); applyDrawerFx(); } setTimeout(applyFolds, 0);
  // weather + air
  const wx = $('#wxCard');
  if (state.sgg) {
    const items = wxItems(state.sgg);
    if (items.length) {
      const wf = weatherFor(state.sgg);
      const srcs = [wf && wf._sido ? t('wx.basis.stn', { name: wf.stn_name }) : state.emd && t('wx.basis', { name: n.sggName }), wf && (wf._sido ? t('wx.src.asos') : t('wx.src')), airFor(state.sgg) && t('air.src')].filter(Boolean).join(' · ');
      wx.innerHTML = items.map(i => `<div class="wx-item ${i.cls}"><div class="k">${i.label}</div><div class="v">${i.v}<small>${i.unit}</small></div></div>`).join('') + fcstHTML(wf) + `<div class="wx-src">${srcs} · ${fmtTime((wf && wf._at) || (state.live.air || {}).updated)}${wf && ageH(wf._at) > 2 ? ` · <b>${t('wx.ago', { h: Math.floor(ageH(wf._at)) })}</b>` : ''}</div>`;
    } else {
      const st = state.live.weather && state.live.weather.status;
      const W0 = state.live.weather, last = W0 && ((W0.hub && W0.hub.base_time) || W0.base_time);   // 자료는 있는데 오래돼서 감춘 경우를 구분해 말한다
      wx.innerHTML = `<div class="wx-empty">${st === 'no_key' ? t('wx.noKey') : last && ageH(last) > WX_MAX_AGE_H ? t('wx.stale', { t: fmtTime(last) }) : t('wx.noData')}</div>`;
    }
  } else wx.innerHTML = `<div class="wx-empty">${t('wx.pickSgg')}</div>`;
  // warnings
  const ws = warningsFor(state.sgg, state.sido);
  applyAlertFx(ws);
  // 예비특보 — 수집만 되고 안 쓰이던 데이터(alerts.prewarn). 통보문이 시도 약칭('서울','충북')을
  // 쓰므로 코드→약칭 매핑으로 내 지역 언급이 있을 때만 표시(매핑 불가·전국이면 표시).
  const SIDO_SHORT = { 11: '서울', 26: '부산', 27: '대구', 28: '인천', 29: '광주', 30: '대전', 31: '울산', 36: '세종', 41: '경기', 43: '충북', 44: '충남', 45: '전북', 52: '전북', 46: '전남', 47: '경북', 48: '경남', 50: '제주', 51: '강원' };
  const pw = state.live.alerts && state.live.alerts.prewarn;
  const short = SIDO_SHORT[String(state.sido)];
  const pwShow = pw && pw.status === 'ok' && !pw.none && pw.text && pw.at
    && (Date.now() - Date.parse(pw.at)) < 36 * 3600 * 1000
    && (!short || pw.text.includes(short) || pw.text.includes('전국'));
  const pwHTML = pwShow ? `<div class="warn-item prewarn"><span class="warn-level pre">${t('warn.pre')}</span><div><div class="pre-text">${escapeHTML(pw.text.trim())}</div><small class="muted">${t('warn.pre.s')} · ${fmtTime(pw.at)}</small></div></div>` : '';
  $('#warnCard').innerHTML = ws.map(w => `<div class="warn-item"><span class="warn-level ${/주의보/.test(w.level) ? 'adv' : ''}">${warnName(w.type, w.level)}</span><div><div>${(w.areas || []).slice(0, 4).join(', ')}</div><small class="muted">${fmtTime(w.since)}</small></div></div>`).join('') + pwHTML;
  // kv — 인덱스는 loadCore에서 만든 Map으로 조회 (renderRegion은 핫패스: 전수 filter 금지)
  const e = state.emd && state.idx.byEmd.get(state.emd), kv = [], P = t('kv.places');
  const sggOfSido = state.idx.sggBySido.get(String(state.sido)) || [], emdOfSgg = state.idx.emdBySgg.get(String(state.sgg)) || [];
  // 09-04: 지역 정보(kv) 행은 '이 지역은' 서랍의 취약 인구 블록으로 이동(docs/08 §3 한 항목 한 집). 패널엔 비움.
  $('#regionKv').innerHTML = kv.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');
  $('#regionKv').hidden = !kv.length;
  $('#regionNote').innerHTML = state.level === 'emd'
    ? (ws.length ? `<b>${t('note.warn', { w: ws.map(w => warnName(w.type, w.level)).join(', ') })}</b>` : `<small class="muted">${t('note.calm')}</small>`)
    : `<small class="muted">${state.level === 'sido' ? t('note.pickSgg') : t('note.pickEmd')}</small>`;
  const ch = $('#regionChildren'); ch.innerHTML = '';
  let kids = [];
  if (state.level === 'sido') kids = sggOfSido.map(s => ({ name: rn(s), go: () => selectSgg(s.code) }));
  if (state.level === 'sgg') kids = emdOfSgg.map(x => ({ name: rn(x), go: () => selectEmd(x.code) }));
  kids.sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(k => { const b = document.createElement('button'); b.textContent = k.name; b.onclick = k.go; ch.appendChild(b); });
  $('#btnFindHere').hidden = !state.sgg;
  renderNearest();
}

export function fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return String(iso); const p = x => String(x).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
