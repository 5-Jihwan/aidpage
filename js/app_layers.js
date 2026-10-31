/* 선택·저장 동네·카카오·문장 카드 열기·격자·시설 층·범례·가까운 시설 — 10-14 app.js에서 분리(500줄 규칙). */
import { t, getLang } from './i18n.js?v=20261031b';
import { hasGrid, meta as gridMeta, cells as gridCells, available as gridAttrs, show as showGrid, hide as hideGrid, fmt as gridFmt } from './grid.js?v=20261031b';
import { stat } from './api.js?v=20260914b';
import { initShelters, setActive as setShelters, setHeatmap as setShelterHeatmap, collect as collectShelters, HEAT_BANDS, nearest as nearestShelters } from './shelters.js?v=20261008a';
import { $, $$, KOREA_CENTER, MQ_MOBILE, ensureEmd, state } from './app.js?v=20261031b';
import { bboxOf, featuresWhere, fitTo, focusClip, map, openPopup, pipFeature, routeLinks, setLevelFilters, srcBadge, visiblePadding } from './app_map.js?v=20261031b';
import { applyWindArrows, applyWxLayer } from './app_wx.js?v=20261031b';
import { applyFolds, syncWizardLoc } from './app_wizard.js?v=20261031b';
import { emdDisp, floodContext, renderCrumb, renderRegion, rn, warningsFor } from './app_panel.js?v=20261031b';
import { getProfile, toast } from './app_ui.js?v=20261031b';

export function selectSido(code) {
  Object.assign(state, { level: 'sido', sido: String(code), sgg: null, emd: null });
  setLevelFilters(); fitTo(featuresWhere(state.geo.sido, 'code', code)); renderAll(); ensureEmd();
}

export async function selectSgg(code) {
  const s = state.idx.bySgg.get(String(code));
  Object.assign(state, { level: 'sgg', sgg: String(code), emd: null, sido: s ? String(s.sido) : state.sido });
  await ensureEmd(); setLevelFilters(); fitTo(featuresWhere(state.geo.sgg, 'code', code)); renderAll();
}

export async function selectEmd(code) {
  const e = state.idx.byEmd.get(String(code)); if (!e) return;
  Object.assign(state, { level: 'emd', emd: String(code), sgg: String(e.sgg), sido: String(e.sido) });
  await ensureEmd(); setLevelFilters();
  const fs = featuresWhere(state.geo.emd, 'code', code); if (fs.length) fitTo(fs); else map.flyTo({ center: [e.lon, e.lat], zoom: 13 });
  pushRecent(String(code)); if (state.wxmap === 'wind') applyWindArrows(true);
  renderAll(); syncWizardLoc();
  // 자동 이동(홈 복원·공유 링크)은 사용자가 내려 둔 시트를 다시 올리지 않는다 (09-07: "내려도 올라온다")
  if (matchMedia(MQ_MOBILE).matches && !state._autoNav) { $('#panel').classList.remove('is-collapsed'); }
}

export function pushRecent(code) { const r = JSON.parse(localStorage.getItem('safepic.recent') || '[]').filter(c => c !== code); r.unshift(code); localStorage.setItem('safepic.recent', JSON.stringify(r.slice(0, 4))); }

export function renderRecent() {
  const row = $('#recentRow'); if (!row) return;
  const home = getHome(), list = JSON.parse(localStorage.getItem('safepic.recent') || '[]').filter(c => c !== home).map(c => state.idx.byEmd.get(c)).filter(Boolean).slice(0, 3);
  row.hidden = !list.length; if (!list.length) return;
  row.innerHTML = `<span class="muted">${t('recent.title')}</span>` + list.map(e => `<button type="button" class="chip" data-c="${e.code}">${rn(e, 'sgg_name')} ${rn(e)}</button>`).join('');
  $$('button[data-c]', row).forEach(b => b.addEventListener('click', () => selectEmd(b.dataset.c)));
}

export function resetNation() {
  Object.assign(state, { level: 'nation', sido: null, sgg: null, emd: null });
  setLevelFilters(); map.flyTo({ center: KOREA_CENTER, zoom: 5.6, duration: 900 }); renderAll();
}

export function renderAll() { renderCrumb(); renderRegion(); syncShelterLayers(); syncGrid(); renderHome(); }

export const getHome = () => localStorage.getItem('safepic.home');

export function renderHome() {
  renderRecent();
  const h = getHome(), e = h && state.idx.byEmd.get(h), row = $('#homeRow');
  if (row) { row.hidden = !e; if (e) $('#btnGoHome').textContent = t('home.go', { name: `${rn(e, 'sgg_name')} ${rn(e)}` }); }
  const sb = $('#btnSaveHome'); if (sb) { const on = state.emd && state.emd === h; sb.textContent = on ? t('home.saved') : t('home.save'); sb.classList.toggle('is-on', !!on); sb.hidden = state.level !== 'emd'; }
}

export function initHome() {
  $('#btnGoHome').addEventListener('click', () => { const h = getHome(); if (h) selectEmd(h); });
  $('#btnForgetHome').addEventListener('click', () => { localStorage.removeItem('safepic.home'); renderHome(); });
  $('#btnSaveHome').addEventListener('click', () => { if (!state.emd) return; if (getHome() === state.emd) localStorage.removeItem('safepic.home'); else localStorage.setItem('safepic.home', state.emd); renderHome(); });
  $('#btnResetSel').addEventListener('click', () => { resetNation(); $('#wizard').reset(); syncWizardLoc(); });
  $('#btnSim').addEventListener('click', openSimulator);
  initKakao();
}

export const KAKAO_CHANNEL = '_xixnxgxaX';

export function initKakao() {
  const els = $$('[data-kakao]'); if (!els.length) return;
  els.forEach(el => { if (!KAKAO_CHANNEL) { el.hidden = true; return; } el.hidden = false; el.href = `https://pf.kakao.com/${KAKAO_CHANNEL}` + (el.dataset.kakao === 'chat' ? '/chat' : '/friend'); });
}

export let _simMod = null;

export async function openSimulator() {
  const b = $('#btnSim'); b.disabled = true;
  try {
    if (!_simMod) {
      _simMod = await import('./access.js?v=20261031b');   // S0: 본 사이트는 문장 카드만(전국 미리 계산 읽기). 옛 시뮬레이터(sim.js·sim_worker)와 선 그리는 sim.html은 10-14 폐기 샌드박스 전용
      _simMod.initAccess({ state, toast, t, stat, gridCells, collectShelters, nearestShelters, pipFeature, emdDisp, profile: getProfile });
    }
    await _simMod.openAccess();
  } catch (e) { console.warn('simulator load failed', e); toast(t('sim.fail')); }
  finally { b.disabled = false; }
}

export let gridAttr = localStorage.getItem('safepic.gridAttr') || 'slope_mean';

export async function syncGrid() {
  const box = $('#gridBox'), where = $('#whereGrid');
  const mapOn = localStorage.getItem('safepic.gridOn') !== '0';  // 지도 위 격자 겹침 표시 (설정)
  if (state.sim && state.sim.sgg !== state.sgg) state.sim.close();   // 다른 시·군·구로 이동 = 시뮬레이터 종료(격자가 바뀐다)
  if (!state.sgg || !(await hasGrid(state.sgg))) { state._gridAvail = false; hideGrid(); if (box) box.hidden = true; if (where) where.hidden = true; $('#wherePending').hidden = false; $('#simLaunch').hidden = true; renderLegend(activeShelterKinds()); return; }
  state._gridAvail = true; $('#simLaunch').hidden = !!state.sim;  // 꺼져 있어도 범례에 '켜기' 줄을 남기려면 자료 유무를 알아야 한다
  const attrs = gridAttrs(state.sgg); if (!attrs.some(a => a.id === gridAttr)) gridAttr = attrs[0] && attrs[0].id;
  // 지도 표시를 꺼도 renderPrepare()의 수치는 캐시된 셀에서 계산하므로 그대로 나온다.
  let leg = null;
  if (mapOn) leg = showGrid(state.sgg, gridAttr); else hideGrid();
  // 범례 스팬은 지도 범례와 패널 카드 두 곳에서 쓰므로 한 번만 생성
  const legSpans = !leg ? '' : !leg.breaks.length
    ? `<span><i style="background:${leg.colors[0]}"></i>${gridFmt(leg.attr, leg.only)}</span>`  // 값이 전부 같은 속성
    : leg.colors.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? '≤ ' + gridFmt(leg.attr, leg.breaks[0]) : i === leg.colors.length - 1 ? '> ' + gridFmt(leg.attr, leg.breaks[leg.breaks.length - 1]) : gridFmt(leg.attr, leg.breaks[i - 1]) + '–' + gridFmt(leg.attr, leg.breaks[i])}</span>`).join('');
  state._gridLegend = leg ? { title: (getLang() !== 'ko' ? leg.attr.en : leg.attr.ko), html: legSpans + `<span class="lg-note">${t('grid.rel')} · ${t('grid.d.dark')} ${getLang() !== 'ko' ? (leg.attr.dark_en || '') : (leg.attr.dark || '')}</span>` } : null;
  renderLegend(activeShelterKinds());
  // 선택 지표의 정의·출처와 "색 읽는 법"을 접지 않고 바로 보여준다 (09-07: 기준·정의가 불명확하다는 지적)
  const en = getLang() !== 'ko', A = attrs.find(a => a.id === gridAttr);
  const vals = A ? gridCells(state.sgg).map(f => f.properties[A.id]).filter(x => x != null).sort((a, b) => a - b) : [];
  const stat = A && vals.length ? t('grid.d.cells', { n: vals.length.toLocaleString(), m: gridFmt(A, vals[Math.floor(vals.length / 2)]), x: gridFmt(A, vals[vals.length - 1]) }) : '';
  const scale = !leg ? '' : !leg.breaks.length
    ? `<div class="grid-scale"><div class="gs-one"><i style="background:${leg.colors[0]}"></i>${t('grid.d.same', { v: gridFmt(leg.attr, leg.only) })}</div></div>`
    : `<div class="grid-scale"><div class="gs-lab"><span>${t('grid.d.low')}</span><span>${t('grid.d.high')}</span></div><div class="gs-bar">${leg.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div><div class="gs-vals">${leg.colors.map((_, i) => `<span>${i < leg.breaks.length ? gridFmt(leg.attr, leg.breaks[i]) : ''}</span>`).join('')}</div><div class="gs-dark"><b>${t('grid.d.dark')}</b> ${A ? (en ? A.dark_en : A.dark) : ''} <span class="gs-nd"><i style="background:#d9dee7"></i>${t('grid.nodata')}</span></div></div>`;
  const defCard = A ? `<div class="grid-def"><p>${en ? A.def_en : A.def}</p><small>${t('grid.d.src')} ${en ? A.src_en : A.src}${stat ? ' · ' + stat : ''}</small></div>` : '';
  const html = `<div class="grid-attrs">${attrs.map(a => `<button type="button" class="chip ${a.id === gridAttr ? 'is-on' : ''}" data-a="${a.id}">${en ? a.en : a.ko}</button>`).join('')}</div>` +
    defCard + scale +
    `<div class="fine">${t('grid.note')}</div>` +
    `<details class="grid-how"><summary>${t('grid.how.t')}</summary>${t('grid.how')}</details>`;
  for (const el of [box, where]) { if (!el) continue; el.hidden = !mapOn; el.innerHTML = `<h3>${t('grid.title')}</h3>` + html; $$('.chip', el).forEach(b => b.addEventListener('click', () => { gridAttr = b.dataset.a; localStorage.setItem('safepic.gridAttr', gridAttr); syncGrid(); })); }
  $('#wherePending').hidden = true;
  renderPrepare(); applyFolds();
}

export function probText(T, years = 30) { const p = 1 / T, cum = 1 - Math.pow(1 - p, years); return t('prob.text', { T, p: (p * 100).toFixed(p * 100 < 1 ? 1 : 0), y: years, c: Math.round(cum * 100) }); }

export const PREP_ROWS = [
  { id: 'flood', label: 'prep.r.flood',
    val: cs => ({ n: cs.filter(c => c.flood_hist_n > 0).length, total: cs.length }),
    fmt: v => v.n ? `${t('prep.v.flood', v)} (${Math.round(v.n / v.total * 100)}%)` : t('prep.none.flood'),
    act: v => v.n > 0 ? 'prep.a.flood' : null },
  { id: 'depth', label: 'prep.r.depth',
    val: cs => Math.max(0, ...cs.map(c => c.flood_depth_max_m || 0)) || null,
    fmt: v => v.toFixed(1) + ' m', act: v => v >= 0.5 ? 'prep.a.depth' : null },
  { id: 'lslide', label: 'prep.r.lslide',
    val: cs => { const n = cs.reduce((a, c) => a + (c.landslide_hist_n || 0), 0); return cs.some(c => c.landslide_hist_n != null) ? n : null; },
    fmt: v => v ? `${v}` : t('prep.none.lslide'), act: v => v > 0 ? 'prep.a.lslide' : null },
  { id: 'slope', label: 'prep.r.slope',
    val: cs => cs.reduce((a, c) => a + (c.slope_mean || 0), 0) / cs.length,
    fmt: v => v.toFixed(1) + '°', act: v => v >= 15 ? 'prep.a.slope' : null },
  { id: 'walk', label: 'prep.r.walk',
    val: cs => { const v = cs.map(c => c.shelter_min_walk).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; },
    fmt: v => Math.round(v) + t('risk.min'), act: () => 'prep.a.walk' },
  { id: 'elderly', label: 'prep.r.elderly',
    val: cs => cs[0].elderly_alone_r ?? null,
    fmt: v => (v * 100).toFixed(1) + '%', act: () => null },
];

export function gridSrcText(gm, short) {
  const en = getLang() !== 'ko';
  const flood = gm.flood_src ? (en ? 'MOIS flood-trace maps (nationwide)' : '행안부 침수흔적도(전국)') : (en ? 'Seoul flood-trace maps 2010–2025' : '서울 침수흔적도 2010~2025');
  const ls = gm.landslide_src ? (en ? ' · landslide: MOIS landslide records' : ' · 산사태: 행안부 산사태 발생이력') : '';
  const dem = gm.dem ? String(gm.dem).replace(/\s*\(.*\)$/, '') : 'Copernicus GLO-30';
  if (short) return en ? `${flood} · ${dem} · MOIS registration` : `${flood} · ${dem} · 행안부 주민등록`;
  const res = gm.h3_res || 9;
  return en ? `H3 (res ${res}) cell aggregates · flood: ${flood}${ls} · slope: ${dem} (surface model) · population: MOIS registration by dong${gm.jumin_basis ? ' ' + gm.jumin_basis : ''} · shelter walk: straight-line to civil-defence shelters at 67 m/min. No record does not mean safe.`
            : `격자(H3 res ${res}) 집계 · 침수: ${flood}${ls} · 경사: ${dem}(지표모델) · 인구: 행안부 주민등록(행정동${gm.jumin_basis ? ', ' + gm.jumin_basis : ''}) · 대피소 도보: 민방위 대피소 직선거리(67m/분). 이력이 없다는 것이 안전을 뜻하지 않습니다.`;
}

export function renderPrepare() {
  const box = $('#compareBox'); if (!box) return;
  const cs = gridCells(state.sgg); if (!cs.length) { box.hidden = true; return; }
  const byEmd = new Map(); for (const f of cs) { const p = f.properties; if (!byEmd.has(p.emd_name)) byEmd.set(p.emd_name, []); byEmd.get(p.emd_name).push(p); }
  const names = [...byEmd.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const cur = state.emd && state.idx.byEmd.get(state.emd), curName = cur && names.includes(cur.name) ? cur.name : names[0];
  let sel = sessionStorage.getItem('safepic.prep') || curName;
  if (!names.includes(sel)) sel = curName;
  const A = byEmd.get(sel);
  const rows = PREP_ROWS.map(r => {
    const v = r.val(A); if (v == null) return '';
    const act = r.act(v);
    return `<div class="prep-row"><div class="prep-head"><span>${t(r.label)}</span><b>${r.fmt(v)}</b></div>${act ? `<div class="prep-act">→ ${t(act)}</div>` : ''}</div>`;
  }).join('');
  // 자연재해위험개선지구 (구 단위 공식 지정 현황 — 전국 3,330곳 요약)
  if (state._rz === undefined) {
    state._rz = null;
    fetch('data/ref/riskzone_by_sgg.json').then(r => r.ok ? r.json() : null).then(j => { state._rz = j; renderPrepare(); }).catch(() => {});
  }
  const rz = state._rz && state._rz.by_sgg && state._rz.by_sgg[String(state.sgg)];
  const rzHTML = rz ? `<div class="prep-row"><div class="prep-head"><span>${t('prep.r.rz')}</span><b>${t('prep.v.rz', { n: rz.n })}</b></div><div class="prep-act">→ ${rz.flood ? t('prep.a.rz.flood', { m: rz.flood }) : t('prep.a.rz')}</div></div>` : '';
  box.hidden = false;
  box.innerHTML = `<h3>${t('prep.title')}</h3><div class="cmp-head"><select class="cmp-sel">${names.map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${emdDisp(n)}</option>`).join('')}</select></div>${rows}${rzHTML}<div class="fine">${gridSrcText(gridMeta(state.sgg) || {}, false)}<br>${t('prob.lead')} ${probText(100)} · ${probText(30)}</div>`;
  const s = $('.cmp-sel', box); if (s) s.addEventListener('change', () => { sessionStorage.setItem('safepic.prep', s.value); renderPrepare(); });
}

export function initGridClick() {
  map.on('click', 'grid-fill', e => {
    if (state.simPick) return;
    const p = e.features[0].properties, attrs = gridAttrs(state.sgg);
    const rows = attrs.map(a => `<tr><td>${getLang() !== 'ko' ? a.en : a.ko}</td><td class="mono">${gridFmt(a, p[a.id] == null ? null : +p[a.id])}</td></tr>`).join('') + (p.flood_years ? `<tr><td>${getLang() !== 'ko' ? 'Flood years' : '침수 연도'}</td><td class="mono">${String(p.flood_years).replace(/[\[\]"]/g, '')}</td></tr>` : '');
    const gm = gridMeta(state.sgg) || {};
    openPopup(e.lngLat, `<b>${p.emd_name || ''}</b> <small class="mono">${p.h3}</small><table class="cell-table">${rows}</table>${srcBadge(gridSrcText(gm, true), gm.jumin_basis)}`, { closeButton: true, offset: 6 });
  });
}

export async function initShelterUI() {
  state.shelters.avail = await initShelters(map);
  const box = $('#shsel'); if (!state.shelters.avail.length) { box.hidden = true; return; }
  box.hidden = false;
  const GROUPS = [
    { id: 'evac', ko: '대피', en: 'Evacuate', icon: '🛡️', kinds: ['civil_defense', 'temp_housing', 'quake', 'tsunami'] },
    { id: 'rest', ko: '쉼터', en: 'Shelters', icon: '🌡️', kinds: ['heat', 'cold', 'dust'] },
    { id: 'help', ko: '도움', en: 'Help', icon: '🆘', kinds: ['townhall', 'er', 'pharmacy', 'health', 'fire', 'police', 'meal', 'water', 'chem'] },
    { id: 'hazard', ko: '위험 지점', en: 'Hazards', icon: '⚠️', kinds: ['steep', 'wildfire_hist', 'underpass'] },
  ];
  const en = getLang() !== 'ko', K = id => state.shelters.avail.find(a => a.id === id);
  const chip = k => `<label><input type="checkbox" value="${k.id}" ${state.shelters.active.has(k.id) ? 'checked' : ''}><span>${k.icon} ${en ? k.en : k.ko}</span></label>`;
  const mode0 = shMode();
  const mBtn = (m, ic) => `<button type="button" class="shmode-b ${mode0 === m ? 'is-on' : ''}" data-m="${m}">${ic} ${t('sh.mode.' + m)}</button>`;
  box.innerHTML = `<button type="button" class="wxsel-t" id="shselT">${t('sh.title')}</button>`
    + `<div class="shmode" role="group" aria-label="${t('sh.mode')}">${mBtn('icons', '📍')}${mBtn('heat', '🌡')}${mBtn('area', '🗺')}</div>`
    + GROUPS.map(g => {
    const ks = g.kinds.map(K).filter(Boolean); if (!ks.length) return '';
    const allOn = ks.every(k => state.shelters.active.has(k.id));
    return `<div class="shgrp"><button type="button" class="shgrp-t ${allOn ? 'is-on' : ''}" data-grp="${g.id}">${g.icon} ${en ? g.en : g.ko}</button><div class="shgrp-k">${ks.map(chip).join('')}</div></div>`;
  }).join('');
  if (mode0 !== 'icons') setShelterHeatmap(mode0);
  $$('.shmode-b', box).forEach(b => b.addEventListener('click', () => {
    localStorage.setItem('safepic.shMode', b.dataset.m);
    $$('.shmode-b', box).forEach(x => x.classList.toggle('is-on', x === b));
    setShelterHeatmap(b.dataset.m);
    syncShelterLayers(); // 지층/구역 렌더 + 범례 갱신
  }));
  const save = () => { localStorage.setItem('safepic.shelters', JSON.stringify([...state.shelters.active])); syncShelterLayers(); renderRegion(); };
  $('#shselT').addEventListener('click', () => box.classList.toggle('is-open'));
  $$('input', box).forEach(i => i.addEventListener('change', () => { i.checked ? state.shelters.active.add(i.value) : state.shelters.active.delete(i.value); const g = i.closest('.shgrp'); g.querySelector('.shgrp-t').classList.toggle('is-on', $$('input', g).every(x => x.checked)); save(); }));
  $$('.shgrp-t', box).forEach(b => b.addEventListener('click', () => { const g = b.closest('.shgrp'), on = !b.classList.contains('is-on'); $$('input', g).forEach(i => { i.checked = on; on ? state.shelters.active.add(i.value) : state.shelters.active.delete(i.value); }); b.classList.toggle('is-on', on); save(); }));
  document.addEventListener('click', e => { if (!e.target.closest('#shsel')) box.classList.remove('is-open'); });
  syncShelterLayers();
}

export const activeShelterKinds = () => state.sido ? [...state.shelters.active].filter(k => state.shelters.avail.some(a => a.id === k)) : [];

export function saveShelterKinds() {
  localStorage.setItem('safepic.shelters', JSON.stringify([...state.shelters.active]));
  $$('#shsel input').forEach(i => i.checked = state.shelters.active.has(i.value));
  syncShelterLayers();
}

export function syncShelterLayers() {
  if (!map || !state.shelters.avail.length) return;
  const kinds = activeShelterKinds();
  // 시군구/동을 골랐으면 그 안의 시설만 지도에 — 아이콘 산재 방지
  setShelters(kinds, state.sido, focusClip());
  renderShelterHeat(kinds); // 비동기 — 집계 후 스스로 renderLegend 재호출
  renderLegend(kinds);
}

export const shMode = () => localStorage.getItem('safepic.shMode') || (localStorage.getItem('safepic.shHeat') === '1' ? 'heat' : 'icons');

export const SHHEAT_COLORS = ['#3b82f6', '#a3e635', '#f97316', '#dc2626'];

export let _shHeatSig = null;

export const _shHeatIds = { sgg: new Set(), emd: new Set() };

export function ensureShHeatLayers() {
  if (map.getLayer('shheat-sgg')) return;
  const anchor = ['sgg-label', 'emd-label'].find(l => map.getLayer(l)); // 격자 위·지명 라벨 아래 (3원칙)
  map.addLayer({ id: 'shheat-sgg', type: 'fill', source: 'sgg', paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0 } }, anchor);
  map.addLayer({ id: 'shheat-emd', type: 'fill', source: 'emd', paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0 } }, anchor);
  // 색만 보이면 "몇 곳인지"를 알 수 없다 — 구역을 누르면 이름+실개수 팝업 (드릴다운과 공존)
  [['shheat-sgg', 'sgg'], ['shheat-emd', 'emd']].forEach(([layer, src]) => map.on('click', layer, e => {
    if (shMode() !== 'area' || !e.features || !e.features.length) return;
    const f = e.features[0];
    const st = map.getFeatureState({ source: src, id: String(f.properties.code) });
    if (!st || st.shn == null) return;
    const icons = [...state.shelters.active].map(k => (state.shelters.avail.find(a => a.id === k) || {}).icon || '').join('');
    openPopup(e.lngLat, `<b>${f.properties.name || ''}</b><br><small>${t('shheat.pop', { list: icons, n: st.shn })}</small>`);
  }));
}

export function clearShHeat() {
  for (const src of ['sgg', 'emd']) { _shHeatIds[src].forEach(id => map.setFeatureState({ source: src, id }, { shn: null })); _shHeatIds[src].clear(); }
  ['shheat-sgg', 'shheat-emd'].forEach(l => map.getLayer(l) && map.setPaintProperty(l, 'fill-opacity', 0));
  state._shLegend = null;
}

export async function renderShelterHeat(kinds) {
  if (!map || !map.getLayer('sgg-fill')) return;
  ensureShHeatLayers();
  const on = shMode() === 'area';
  if (!on || !kinds.length || !state.sido) { if (_shHeatSig) { _shHeatSig = null; clearShHeat(); renderLegend(kinds); } return; }
  const perEmd = !!state.sgg; // 시군구(또는 동) 선택 = 읍면동별, 시도만 선택 = 시군구별
  const sig = [...kinds].sort().join(',') + '|' + state.sido + '|' + (perEmd ? 'e' + state.sgg : 's');
  if (sig === _shHeatSig) return;
  const src = perEmd ? 'emd' : 'sgg';
  let polys;
  if (perEmd) { await ensureEmd(); polys = featuresWhere(state.geo.emd, 'sgg_code', state.sgg); }
  else polys = featuresWhere(state.geo.sgg, 'sido_code', state.sido);
  const feats = await collectShelters(kinds, state.sido);
  if (!polys.length) return;
  // 개수 세기: bbox 선별 후에만 point-in-polygon
  const boxes = polys.map(f => ({ f, b: bboxOf([f]) }));
  const counts = new Map();
  for (const ft of feats) {
    const c = ft.geometry && ft.geometry.coordinates; if (!c) continue;
    for (const { f, b } of boxes) {
      if (c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) continue;
      if (pipFeature(c[0], c[1], f)) { const id = String(f.properties.code); counts.set(id, (counts.get(id) || 0) + 1); break; }
    }
  }
  _shHeatSig = sig;
  clearShHeat();
  const vals = [...counts.values()].sort((a, b) => a - b);
  if (!vals.length) { renderLegend(kinds); return; }
  // 브레이크 = 0 제외 4분위, 겹치면 한 칸씩 벌린다 (밴드 경계가 항상 오름차순이도록)
  const q = p => vals[Math.min(vals.length - 1, Math.round(p * (vals.length - 1)))];
  let b1 = Math.max(1, q(0.25)), b2 = Math.max(b1 + 1, q(0.5)), b3 = Math.max(b2 + 1, q(0.75));
  counts.forEach((n, id) => { map.setFeatureState({ source: src, id }, { shn: n }); _shHeatIds[src].add(id); });
  const color = ['step', ['coalesce', ['feature-state', 'shn'], 0], 'rgba(0,0,0,0)',
    1, SHHEAT_COLORS[0], b1 + 1, SHHEAT_COLORS[1], b2 + 1, SHHEAT_COLORS[2], b3 + 1, SHHEAT_COLORS[3]];
  const active = perEmd ? 'shheat-emd' : 'shheat-sgg', idle = perEmd ? 'shheat-sgg' : 'shheat-emd';
  map.setPaintProperty(active, 'fill-color', color);
  map.setPaintProperty(active, 'fill-opacity', 0.55);
  map.setPaintProperty(idle, 'fill-opacity', 0);
  const max = vals[vals.length - 1];
  state._shLegend = { u: perEmd ? 'emd' : 'sgg', bins: [
    { lo: 1, hi: b1, c: SHHEAT_COLORS[0] }, { lo: b1 + 1, hi: b2, c: SHHEAT_COLORS[1] },
    { lo: b2 + 1, hi: b3, c: SHHEAT_COLORS[2] }, { lo: b3 + 1, hi: max > b3 ? null : b3 + 1, c: SHHEAT_COLORS[3] },
  ] };
  renderLegend(kinds);
}

export let _legendFit = null;

export function initLegendDrag() {
  const box = $('#mapLegend'); if (!box) return;
  const wrap = box.offsetParent || document.body, KEY = 'safepic.legendPos';
  const apply = pos => { if (!pos) return; box.style.left = pos.x + 'px'; box.style.top = pos.y + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto'; };
  const clamp = pos => {
    const w = wrap.clientWidth, h = wrap.clientHeight, bw = box.offsetWidth || 120, bh = box.offsetHeight || 40;
    return { x: Math.min(Math.max(4, pos.x), Math.max(4, w - bw - 4)), y: Math.min(Math.max(4, pos.y), Math.max(4, h - bh - 4)) };
  };
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  // 숨겨진 상태에선 offsetWidth가 0이라 클램프가 무의미하다 — 보이게 된 뒤 _legendFit으로 다시 맞춘다.
  _legendFit = () => { const p = saved(); if (p) apply(clamp(p)); };
  apply(saved());
  let st = null;
  // setPointerCapture 이후엔 이벤트가 box로 재타깃되므로, 누른 줄은 pointerdown 시점에 기억해 둔다.
  box.addEventListener('pointerdown', e => { st = { px: e.clientX, py: e.clientY, bx: box.offsetLeft, by: box.offsetTop, moved: false, hit: e.target.closest('[data-lg]') }; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', e => {
    if (!st) return;
    const dx = e.clientX - st.px, dy = e.clientY - st.py;
    if (!st.moved && Math.hypot(dx, dy) < 7) return;
    st.moved = true; apply({ x: st.bx + dx, y: st.by + dy });
  });
  box.addEventListener('pointerup', () => {
    if (!st) return;
    if (st.moved) { const pos = clamp({ x: box.offsetLeft, y: box.offsetTop }); apply(pos); localStorage.setItem(KEY, JSON.stringify(pos)); }
    else if (st.hit) toggleLegendLayer(st.hit.dataset.lg);  // 끌지 않고 눌렀으면 = 레이어 스위치
    st = null;
  });
  box.addEventListener('pointercancel', () => { st = null; });
  box.addEventListener('dblclick', () => { localStorage.removeItem(KEY); box.style.left = box.style.top = box.style.right = box.style.bottom = ''; });
  window.addEventListener('resize', () => { const p = saved(); if (p) apply(clamp(p)); });
}

export function toggleLegendLayer(key) {
  if (key === 'grid') {
    const K = 'safepic.gridOn', on = localStorage.getItem(K) !== '0';
    localStorage.setItem(K, on ? '0' : '1');
    const cb = $('#btnGridOn'); if (cb) cb.checked = !on;   // 설정 서람과 동기화
    syncGrid();
  } else if (key === 'wx') {
    if (state.wxmap) { state._wxLast = state.wxmap; state.wxmap = ''; }
    else if (state._wxLast) state.wxmap = state._wxLast;
    else return;
    localStorage.setItem('safepic.wxmap', state.wxmap);
    $$('#wxsel input').forEach(i => { i.checked = (i.value === state.wxmap); });
    applyWxLayer();
  }
}

export function renderLegend(kinds) {
  const box = $('#mapLegend'); if (!box) return;
  const en = getLang() !== 'ko';
  const sh = kinds.map(k => state.shelters.avail.find(a => a.id === k)).filter(Boolean);
  const g = state._gridLegend, wxl = state._wxLegend;
  const gridOff = !!state._gridAvail && localStorage.getItem('safepic.gridOn') === '0';
  const wxOff = !wxl && !!state._wxLast;
  if (!sh.length && !g && !wxl && !gridOff && !wxOff) { box.hidden = true; return; }
  box.hidden = false;
  const mobile = matchMedia(MQ_MOBILE).matches; box.classList.toggle('is-min', mobile && !state._legendOpen);
  box.title = t('legend.drag');
  const onRow = (key, l) => `<div class="lg-row lg-grid is-sw" data-lg="${key}" title="${t('legend.tap.off')}"><b>${l.title}</b>${l.html}</div>`;
  const offRow = (key, title) => `<div class="lg-row lg-grid is-sw is-off" data-lg="${key}" title="${t('legend.tap.on')}"><b>${title}</b><span class="lg-off">${t('legend.off')}</span></div>`;
  // 시설 행: 모드별 — icons=색점, heat=지층 등급(상대), area=구역별 실개수
  const L = state._shLegend, m0 = shMode();
  const areaMode = m0 === 'area' && sh.length && L, kernMode = m0 === 'heat' && sh.length;
  const heatMode = areaMode || kernMode;
  const binLbl = b => b.lo === b.hi ? t('legend.heat.n1', { n: b.lo }) : b.hi == null ? t('legend.heat.np', { n: b.lo }) : t('legend.heat.n', { lo: b.lo, hi: b.hi });
  const shRow = !sh.length ? '' : areaMode
    ? `<div class="lg-row lg-heatrow"><b>${t('legend.heat')} · ${t('legend.heat.u.' + L.u)}</b><span class="lg-bands">${L.bins.map(b => `<span class="lg-band"><i style="background:${b.c}"></i>${binLbl(b)}</span>`).join('')}</span><small class="lg-heat-s">${t('legend.heat.s', { list: sh.map(k => k.icon).join('') })}</small></div>`
    : kernMode
    ? `<div class="lg-row lg-heatrow"><b>${t('legend.heatk')}</b><span class="lg-bands">${HEAT_BANDS.map(b => `<span class="lg-band"><i style="background:${b.c}"></i>${t(b.key)}</span>`).join('')}</span><small class="lg-heat-s">${t('legend.heatk.s', { list: sh.map(k => k.icon).join('') })}</small></div>`
    : `<div class="lg-row">${sh.map(k => `<span><i style="background:${k.color}"></i>${k.icon} ${en ? k.en : k.ko}</span>`).join('')}</div>`;
  box.innerHTML = `<button type="button" class="lg-toggle" id="lgToggle">${t('legend.title')} ${sh.length ? `<span class="lg-dots">${areaMode ? L.bins.map(b => `<i style="background:${b.c}"></i>`).join('') : kernMode ? HEAT_BANDS.map(b => `<i style="background:${b.c}"></i>`).join('') : sh.map(k => `<i style="background:${k.color}"></i>`).join('')}</span>` : ''}</button>` + shRow +
    (wxl ? onRow('wx', wxl) : wxOff ? offRow('wx', t('wx.' + state._wxLast)) : '') +
    (g ? onRow('grid', g) : gridOff ? offRow('grid', t('grid.title')) : '') + `<small class="lg-src">${t('legend.src')}</small>`;
  $('#lgToggle').addEventListener('click', () => { state._legendOpen = !state._legendOpen; box.classList.toggle('is-min', mobile && !state._legendOpen); });
  if (_legendFit) _legendFit();  // 창이 줄어 저장 위치가 화면 밖이면 범례가 통째로 사라진다
}

export async function renderNearest() {
  const box = $('#nearBox'); if (!box) return;
  const e = state.emd && state.idx.byEmd.get(state.emd);
  if (!e || !state.shelters.avail.length) { box.hidden = true; return; }
  let kinds = [...state.shelters.active].filter(k => { const a = state.shelters.avail.find(x => x.id === k); return a && !a.hazard; });
  const flood = floodContext(warningsFor(state.sgg, state.sido));
  if (flood) kinds = [...new Set([...kinds.filter(k => k !== 'civil_defense'), ...['temp_housing', 'townhall'].filter(k => state.shelters.avail.some(a => a.id === k))])];
  const useGps = state.gps && state.gps.emd === e.code;
  const origin = useGps ? [state.gps.lon, state.gps.lat] : [e.lon, e.lat];
  const list = await nearestShelters(origin, kinds, state.sido, 8, true);
  if (state.emd !== e.code) return;
  box.hidden = false;
  box.innerHTML = `<h3>${t('sh.nearest')} <small class="muted">${useGps ? t('sh.fromGps') : t('sh.fromEmd')}</small></h3>` + (list.length ? list.map((x, i) => `<button type="button" class="near-item" data-i="${i}"><span class="near-ic">${x.k.icon}</span><span class="near-main"><b>${x.p.name || '-'}</b><small>${getLang() !== 'ko' ? x.k.en : x.k.ko}${x.p.cap ? ` · ${x.p.cap}` : ''}</small></span><span class="near-walk mono">${t('sh.walk', { n: x.walk })}</span></button>`).join('') : `<div class="muted" style="font-size:.9rem">${t('sh.none')}</div>`);
  box.insertAdjacentHTML('beforeend', `${flood ? `<small class="near-note near-flood">${t('near.flood')}</small>` : ''}<small class="near-note">${t('sh.desig')}</small>`);
  applyFolds();
  $$('.near-item', box).forEach(b => b.addEventListener('click', () => { const x = list[+b.dataset.i]; map.flyTo({ center: x.c, zoom: 15.5, padding: visiblePadding() }); openPopup(x.c, `<b>${x.p.name || ''}</b><br><small>${x.p.addr || ''}${x.p.tel ? `<br>📞 <a href="tel:${x.p.tel}">${x.p.tel}</a>` : ''}</small>${routeLinks(x.c[0], x.c[1], x.p.name)}`, { fromPanel: true }); }));
}
