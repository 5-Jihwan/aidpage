// AidPage — app.js (ES module, no build step)
import { t, getLang, applyStatic } from './i18n.js?v=20261015a';
import { stat } from './api.js?v=20260914b';
import { initMap, map } from './app_map.js?v=20261015a';
import { activeShelterKinds, getHome, initHome, initLegendDrag, renderAll, renderHome, renderLegend, resetNation, selectEmd } from './app_layers.js?v=20261015a';
import { escapeHTML, renderCrumb, renderTip } from './app_panel.js?v=20261015a';
import { applyRulesLang, buildLangButtons, initCards, initLang, initPWA, initPanel, initProfile, initPush, initSize, initWelcome, reportError, setTab } from './app_ui.js?v=20261015a';
import { applyShare, initWizard, lawDoc, lawRefEn, renderRulesTable, renderSiteStats, statVisit, syncWizardLoc } from './app_wizard.js?v=20261015a';
import { initSearch, initWxSel } from './app_wx.js?v=20261015a';

export let setRulesLang = () => {}, loadRules = null, evaluate = null, formatKRW = n => (n || 0).toLocaleString('ko-KR') + '원';

try { const m = await import('./rules.js?v=20261008a'); loadRules = m.loadRules; evaluate = m.evaluate; if (m.formatKRW) formatKRW = m.formatKRW; if (m.setRulesLang) setRulesLang = m.setRulesLang; } catch (e) { console.warn('rules.js not available', e); }

export const $ = (s, r = document) => r.querySelector(s);

export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const KOREA_CENTER = [127.8, 36.3];

export const MQ_MOBILE = '(max-width:900px), (max-width:1200px) and (orientation:portrait)';

export const state = {
  level: 'nation', sido: null, sgg: null, emd: null,
  geo: { sido: null, sgg: null, emd: null },
  idx: { emd: [], sgg: [], byEmd: new Map(), bySgg: new Map(), emdBySgg: new Map(), sggBySido: new Map(), emdCountBySido: new Map() },
  live: { weather: null, alerts: null, air: null },
  rules: null, meta: null, tab: 'now',
  wxmap: localStorage.getItem('safepic.wxmap') || '',
  lastResult: null,
  shelters: { avail: [], active: new Set(JSON.parse(localStorage.getItem('safepic.shelters') || 'null') || seasonalKinds()) },
};

export function seasonalKinds() { const m = new Date().getMonth() + 1; return ['civil_defense', ...(m >= 6 && m <= 9 ? ['heat'] : m === 12 || m <= 2 ? ['cold'] : [])]; }

export async function getJSON(url, fallback = null) {
  try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw 0; return await r.json(); } catch { return fallback; }
}

export async function loadCore() {
  // 실시간(날씨·특보·응급실)은 부팅을 막지 않는다 — 도착하는 대로 화면에 반영.
  // 이걸 부팅 필수 3MB와 한 Promise.all에 묶었던 것이 "버벅임"의 절반이었다(09-02).
  Promise.all([getJSON('data/live/weather.json'), getJSON('data/live/alerts.json'), getJSON('data/live/air.json'), getJSON('data/live/er.json')])
    .then(([weather, alerts, air, er]) => { Object.assign(state.live, { weather, alerts, air, er }); state._coreP.then(() => { if (map) renderAll(); }); });
  const [sido, sgg, emdIdx, sggIdx, meta] = await Promise.all([
    getJSON('data/admin/kr_sido.geojson'), getJSON('data/admin/kr_sgg.geojson'),
    getJSON('data/admin/emd_index.json', []), getJSON('data/admin/sgg_index.json', []),
    getJSON('data/admin/meta.json'),
  ]);
  Object.assign(state.geo, { sido, sgg }); state.meta = meta;
  state.idx.emd = emdIdx; state.idx.sgg = sggIdx;
  emdIdx.forEach(e => {
    state.idx.byEmd.set(String(e.code), e);
    const k = String(e.sgg); const arr = state.idx.emdBySgg.get(k); if (arr) arr.push(e); else state.idx.emdBySgg.set(k, [e]);
    state.idx.emdCountBySido.set(String(e.sido), (state.idx.emdCountBySido.get(String(e.sido)) || 0) + 1);
  });
  sggIdx.forEach(s => {
    state.idx.bySgg.set(String(s.code), s);
    const k = String(s.sido); const arr = state.idx.sggBySido.get(k); if (arr) arr.push(s); else state.idx.sggBySido.set(k, [s]);
  });
  state.sit = sessionStorage.getItem('safepic.sit') || null;
  getJSON('data/ref/psych_centers.json').then(j => { state.psych = j; });
  getJSON('data/ref/tips.json').then(j => { state.tips = j; renderTip(); });
  if (meta) { $('#aboutAdmin').textContent = `${meta.source || ''} ${meta.version || ''}`.trim(); $('#buildDate').textContent = meta.built || ''; }
  if (loadRules) { try { [state.rules, state.rulesEn] = await Promise.all([loadRules('rules/'), getJSON('rules/en.json')]); setRulesLang(getLang()); applyRulesLang(); if (state.tab === 'about') renderRulesTable(); } catch (e) { console.warn('rules load failed', e); } }
}

export async function ensureEmd() {
  if (state.geo.emd) return state.geo.emd;
  state.geo.emd = await getJSON('data/admin/kr_emd.geojson', { type: 'FeatureCollection', features: [] });
  if (map.getSource('emd')) map.getSource('emd').setData(state.geo.emd);
  return state.geo.emd;
}

if ('speechSynthesis' in window) speechSynthesis.getVoices();

addEventListener('error', reportError);

addEventListener('unhandledrejection', reportError);

document.addEventListener('toggle', async e => {
  const d = e.target; if (!(d instanceof HTMLElement) || !d.classList.contains('lawfold') || !d.open) return;
  const body = d.querySelector('.law-body'); if (!body || body.dataset.done) return;
  body.dataset.done = '1';
  const doc = d.dataset.mst ? await lawDoc(d.dataset.mst) : null;
  const parts = [];
  if (doc) {
    const en = getLang() !== 'ko', lawName = (en && doc.name_en) || doc.name || '';
    if (d.dataset.art && doc.arts && doc.arts[d.dataset.art]) parts.push(`<h5>${escapeHTML(lawName)} ${lawRefEn(d.dataset.art)}</h5>${en ? `<small class="fine">${t('law.origko')}</small>` : ''}<p>${escapeHTML(doc.arts[d.dataset.art])}</p>`);
    if (d.dataset.annex && doc.annexes && doc.annexes[d.dataset.annex]) parts.push(`<h5>${lawRefEn(d.dataset.annex)}</h5><pre class="law-annex">${escapeHTML(doc.annexes[d.dataset.annex])}</pre>`);
    if (parts.length && (doc.effective || doc.updated)) parts.push(`<small class="fine">${t('law.asof', { d: doc.effective || doc.updated })}</small>`);
  }
  body.innerHTML = parts.join('') || `<small class="muted">${t('law.pending')}</small>`;
}, true);

addEventListener('beforeprint', () => $$('details.acc, details.disc').forEach(d => { d.dataset.was = d.open ? '1' : ''; d.open = true; }));

addEventListener('afterprint', () => $$('details.acc, details.disc').forEach(d => { d.open = !!d.dataset.was; }));

(async function boot() {
  applyStatic();
  document.title = t('doc.title');
  $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  const goStart = () => { setTab('now'); resetNation(); const w = $('#wizard'); if (w) { w.reset(); syncWizardLoc(); } const r = $('#result'); if (r) r.hidden = true; $('#mapHint').classList.remove('is-hidden'); if (state._welOpen) state._welOpen(); };
  $('#brand').addEventListener('click', e => { e.preventDefault(); goStart(); });
  $('#btnStart').addEventListener('click', goStart);
  $('#linkRules').addEventListener('click', e => { e.preventDefault(); renderRulesTable(); $('#rulesTable').scrollIntoView({ behavior: 'smooth' }); });
  // 계측 리스너는 부팅 시 1회만 — renderResult 안에 두면 렌더마다 중복 등록돼 비콘이 다발로 나간다(09-02 자체 검증에서 적발)
  addEventListener('beforeprint', () => stat('print'), { once: true });
  document.addEventListener('click', e => { const a = e.target.closest('a[data-stat]'); if (a) stat(a.dataset.stat); }, true);
  buildLangButtons(); initCards(); initWelcome(); initWizard(); initSearch(); initPanel(); initLang(); initSize(); initPush(); initPWA(); initWxSel(); initHome(); initProfile(); initLegendDrag();
  statVisit();
  setTimeout(renderSiteStats, 6000); // 소개 탭을 열기 전에 미리 받아 둔다(요약 API 1~5초)
  // 지금 도는 앱 버전 — "구버전 캐시인가?"를 사용자가 서랍에서 10초 만에 확인
  { const v = new URL(import.meta.url).searchParams.get('v'); const el = $('#appVer'); if (el && v) el.textContent = 'app v' + v; }
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const p = $('#panel'); if (!matchMedia(MQ_MOBILE).matches) { p.classList.remove('is-tall'); p.style.height = ''; } map && map.resize(); renderLegend(activeShelterKinds()); }, 150); });
  // 지도와 core 데이터를 병렬로 — 예전엔 3MB JSON을 다 받은 뒤에야 지도가 시작됐다(09-02 개선)
  state._coreP = loadCore();
  initMap();
  await state._coreP; renderCrumb();
  let _restored = false;
  const restore = async () => { if (_restored) return; _restored = true; await state._coreP; const auto = async fn => { state._autoNav = true; try { await fn(); } finally { state._autoNav = false; } }; if (location.hash) auto(() => applyShare(location.hash)); else if (getHome() && state.idx.byEmd.has(getHome())) setTimeout(() => auto(() => selectEmd(getHome())), 1200); };
  map.once('idle', restore); setTimeout(restore, 6000);
  renderHome();
})();
