/* 지역 서랍·접힘·방문 집계·지원 찾기 마법사·결과·근거 조문·복지서비스·인쇄·규칙표 — 10-14 app.js에서 분리(500줄 규칙). */
import { t, getLang, setLang } from './i18n.js?v=20261014g';
import { meta as gridMeta, cells as gridCells } from './grid.js?v=20261014g';
import { stat, getStatSummary } from './api.js?v=20260914b';
import { collect as collectShelters, nearest as nearestShelters } from './shelters.js?v=20261008a';
import { $, $$, MQ_MOBILE, evaluate, formatKRW, state } from './app.js?v=20261014g';
import { escapeHTML, nameOf, rn, warnName, warningsFor } from './app_panel.js?v=20261014g';
import { _simMod, activeShelterKinds, renderLegend, saveShelterKinds, selectEmd, selectSgg, selectSido, syncShelterLayers } from './app_layers.js?v=20261014g';
import { OPEN, SITS, SIT_ICON, SIT_KEY, applySituation, onLangChanged, setTab } from './app_ui.js?v=20261014g';
import { downloadICS, map, routeLinks, shareImage, speak } from './app_map.js?v=20261014g';

export let _regionMod = null;

export const regionMod = () => _regionMod || (_regionMod = import('./region.js?v=20261008a'));

export const HIDE_SUM_SIT = new Set(['evacuating', 'injury', 'house_flood', 'shop_flood']);

export function regionCtx() {
  return { state, t, getLang, rn, nameOf, warningsFor, warnName, gridCells, gridMeta, collect: collectShelters, escapeHTML, stat,
    toggleKind: k => { state.shelters.active.add(k); saveShelterKinds(); syncShelterLayers(); renderLegend(activeShelterKinds()); },
    goFind: () => { setTab('find'); syncWizardLoc(); },
    onOpen: () => { applyDrawerFx(); }, onClose: () => { applyDrawerFx(); } };
}

export async function openRegionDrawer() {
  if (state.level === 'nation') return;
  const mobile = matchMedia(MQ_MOBILE).matches;
  const m = await regionMod(); m.init(regionCtx()); await m.open(regionCtx(), { mobile });
  if (mobile) { state._rgTab = 'region'; paintRgTabs(); const p = $('#panel'); if (p && p.classList.contains('is-collapsed')) { p.classList.remove('is-collapsed'); setTimeout(() => map && map.resize(), 260); } }
}

export function paintRgTabs() { $$('#rgTabs button').forEach(b => b.classList.toggle('is-on', (state._rgTab || 'now') === b.dataset.rt)); }

export function closeRegionDrawer() { state._rgTab = 'now'; paintRgTabs(); if (_regionMod) _regionMod.then(m => m.close(false)); }

export async function renderRegionSummary() {
  const box = $('#rgSum'); if (!box) return;
  const tabs = $('#rgTabs');
  if (state.level === 'nation' || HIDE_SUM_SIT.has(state.sit)) { box.hidden = true; if (tabs) tabs.hidden = true; if (state._drawerOpen) closeRegionDrawer(); return; }
  // 시트 모드(폰·태블릿 세로): 탭 바가 진입점. 처음 한 번만 그리고 이후엔 상태만 칠한다
  if (tabs && matchMedia(MQ_MOBILE).matches) {
    tabs.hidden = false;
    if (!tabs.dataset.built || tabs.dataset.lang !== getLang()) {
      tabs.dataset.built = '1'; tabs.dataset.lang = getLang();
      tabs.innerHTML = `<button type="button" data-rt="now">${t('rg.tab.now')}</button><button type="button" data-rt="region">${t('rg.tab.region')}</button>`;
      $$('button', tabs).forEach(b => b.addEventListener('click', () => { if (b.dataset.rt === 'region') openRegionDrawer(); else closeRegionDrawer(); }));
    }
    paintRgTabs();
  } else if (tabs) tabs.hidden = true;
  const m = await regionMod(); m.init(regionCtx()); await m.ensureTypes(); await m.ensureDemo();
  const sig = `${state.level}|${state.sgg}|${state.sit}|${getLang()}`; if (box.dataset.sig === sig) return; box.dataset.sig = sig;
  const ty = state.sgg ? m.typeOf(state.sgg) : null;
  const chips = ty ? m.typeChips(ty, true) : '';
  const scope = ty && state.level === 'emd' ? `<small class="muted">${t('rg.sum.sgg')}</small>` : '';
  const dm = state.sgg ? m.demoOf(state.sgg) : null;
  const nums = dm ? `<small class="muted desktop-only rg-nums">${t('demo.pop')} ${Number(dm.pop).toLocaleString(getLang())} · ${t('demo.e65')} ${(dm.e65 * 100).toFixed(1)}%</small>` : '';
  box.hidden = false;
  box.innerHTML = `<span class="rg-sum-chips">${chips}${scope}${nums}</span><button type="button" class="btn btn-ghost btn-sm desktop-only" id="rgOpen">${t('rg.open')} →</button>`;
  const b = $('#rgOpen'); if (b) b.addEventListener('click', openRegionDrawer);
}

export function applyDrawerFx() {
  if (!map || !map.getLayer('bldg-3d')) return;
  map.setPaintProperty('bldg-3d', 'fill-extrusion-opacity', state._drawerOpen ? 0.35 : 0.85);
}

export function renderSitBar() {
  const bar = $('#sitBar'); if (!bar) return;
  bar.innerHTML = `<span class="sit-lbl">${t('sit.now')}</span>` + SITS.map(s => `<button type="button" class="sit-chip ${state.sit === s ? 'is-on' : ''}" data-sit="${s}">${SIT_ICON[s]} ${t(SIT_KEY[s])}</button>`).join('') + (state.sit ? `<button type="button" class="sit-chip sit-clear" data-sit="">✕</button>` : '');
  $$('.sit-chip', bar).forEach(b => b.addEventListener('click', () => applySituation(b.dataset.sit || null, false)));
  const on = bar.querySelector('.sit-chip.is-on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}

export const SEC_LABEL = { er: 'sec.er', near: 'sec.near', wx: 'sec.wx', ins: 'sec.ins', rep: 'sec.rep', kv: 'sec.kv', grid: 'sec.grid' };

export let _foldQ = 0;

export function applyFolds() {
  if (_foldQ) return;
  _foldQ = requestAnimationFrame(() => { _foldQ = 0; applyFoldsNow(); });
}

export function applyFoldsNow() {
  const open = new Set(OPEN[state.sit || 'null'] || OPEN.null), ov = state._foldOverride || {};
  $$('.sec').forEach(sec => {
    const id = sec.dataset.sec;
    const hasContent = [...sec.children].some(c => !c.classList.contains('sec-head') && !c.hidden && c.innerHTML.trim());
    sec.classList.toggle('is-empty', !hasContent);
    let head = sec.querySelector(':scope > .sec-head');
    if (!head) { head = document.createElement('button'); head.type = 'button'; head.className = 'sec-head'; sec.prepend(head); head.addEventListener('click', () => { state._foldOverride = state._foldOverride || {}; state._foldOverride[id] = !sec.classList.contains('is-folded'); applyFolds(); }); }
    head.innerHTML = `<span>${t(SEC_LABEL[id])}</span><span class="sec-chev">▾</span>`;
    const folded = id in ov ? ov[id] : !open.has(id);
    sec.classList.toggle('is-folded', folded);
  });
}

export function statVisit() {
  try { if (sessionStorage.getItem('safepic.v')) return; sessionStorage.setItem('safepic.v', '1'); } catch { /* 저장 불가 브라우저: 매 로드 카운트 */ }
  stat('visit');
}

export let _statsShown = false;

export async function renderSiteStats() {
  if (_statsShown) return; _statsShown = true; // 진행 중이거나 표시된 뒤엔 다시 부르지 않는다(실패 시에만 해제)
  const el = $('#siteStats'); if (!el) return;
  const r = await getStatSummary();
  if (!r || r.status !== 'ok' || !r.visits) { _statsShown = false; return; }
  const v = r.visits, f = n => (+n || 0).toLocaleString();
  el.textContent = t('about.stats', { d: f(v.today), m: f(v.month), y: f(v.year), a: f(v.total), s: v.since || '' });
  el.hidden = false;
}

export function syncWizardLoc() {
  const n = nameOf(), box = $('#qLoc');
  box.innerHTML = state.sgg ? `<b>${[n.sidoName, n.sggName, state.emd && n.emdName].filter(Boolean).join(' ')}</b><button type="button" class="btn btn-ghost" id="btnChangeLoc">${t('wiz.change')}</button>` : `<span class="muted">${t('wiz.loc.empty')}</span>`;
  const b = $('#btnChangeLoc'); if (b) b.onclick = () => { setTab('now'); $('#searchInput').focus(); };
}

export function readWizard() {
  const fd = new FormData($('#wizard'));
  return { housing: fd.get('housing') || null, damage: fd.getAll('damage'), household: fd.getAll('household'), special_zone: $('#qSpecial').checked ? true : null, household_unknown: $('#qUnknown').checked, foreign: $('#qForeign').checked, event_end: fd.get('event_end') || null, today: new Date().toISOString().slice(0, 10), hazard: hazardOf(fd.getAll('damage')), proxy: $('#qProxy').checked, emd: state.emd, sgg: state.sgg };
}

export function encodeShare(inp) {
  const p = new URLSearchParams();
  if (inp.emd) p.set('emd', inp.emd); else if (inp.sgg) p.set('sgg', inp.sgg); if (inp.housing) p.set('h', inp.housing);
  if (inp.damage.length) p.set('d', inp.damage.join(',')); if (inp.household.length) p.set('f', inp.household.join(','));
  if (inp.special_zone) p.set('sz', '1'); if (inp.event_end) p.set('end', inp.event_end); if (inp.proxy) p.set('p', '1'); if (inp.foreign) p.set('fr', '1'); p.set('l', getLang());
  return '#r?' + p.toString();
}

export function applyLangParam(l) { return setLang(l, onLangChanged); }

export async function applyShare(hash) {
  if (hash.startsWith('#g?')) {
    const p = new URLSearchParams(hash.slice(3));
    if (p.get('l') && p.get('l') !== getLang()) await applyLangParam(p.get('l'));
    if (p.get('emd') && state.idx.byEmd.has(p.get('emd'))) await selectEmd(p.get('emd')); else if (p.get('sgg') && state.idx.bySgg.has(p.get('sgg'))) await selectSgg(p.get('sgg')); else if (p.get('sido') && state.idx.sggBySido.has(p.get('sido'))) selectSido(p.get('sido'));
    const tab = p.get('tab'); if (tab && ['now', 'find', 'where', 'about'].includes(tab)) setTab(tab);
    if (p.get('view') === 'region') setTimeout(openRegionDrawer, 400);
    if (p.get('sgg') || p.get('emd') || p.get('sido')) { const w = $('#welcome'); if (w) w.hidden = true; }
    return;
  }
  if (!hash.startsWith('#r?')) return;
  const p = new URLSearchParams(hash.slice(3)), f = $('#wizard'); f.reset();
  if (p.get('l') && p.get('l') !== getLang()) await applyLangParam(p.get('l'));   // 사전이 오기 전에 결과를 그리면 한국어로 남는다
  if (p.get('h')) { const r = f.querySelector(`input[name=housing][value=${p.get('h')}]`); if (r) r.checked = true; }
  (p.get('d') || '').split(',').filter(Boolean).forEach(v => { const c = f.querySelector(`input[name=damage][value=${v}]`); if (c) c.checked = true; });
  (p.get('f') || '').split(',').filter(Boolean).forEach(v => { const c = f.querySelector(`input[name=household][value=${v}]`); if (c) c.checked = true; });
  $('#qSpecial').checked = p.get('sz') === '1'; $('#qProxy').checked = p.get('p') === '1'; $('#qForeign').checked = p.get('fr') === '1';
  if (p.get('end')) $('#qEnd').value = p.get('end');
  if (p.get('emd')) await selectEmd(p.get('emd')); else if (p.get('sgg')) await selectSgg(p.get('sgg'));
  setTab('find'); f.requestSubmit();
}

export function initHouseholdOpts() {
  const none = $('#qNone'), unk = $('#qUnknown'), others = $$('#wizard input[name=household]');
  none.addEventListener('change', () => { if (none.checked) { others.forEach(o => o.checked = false); unk.checked = false; } });
  unk.addEventListener('change', () => { if (unk.checked) none.checked = false; });
  others.forEach(o => o.addEventListener('change', () => { if (o.checked) none.checked = false; }));
}

export const _wizTouched = new Set();

export function initWizardFunnel(f) {
  const qs = $$('fieldset.q', f);
  qs.forEach((fs, i) => { if (i === 0) return; fs.addEventListener('change', () => { const k = `wiz_q${i + 1}`; if (_wizTouched.has(k)) return; _wizTouched.add(k); stat(k); }, { passive: true }); });
}

export function initWizard() {
  initHouseholdOpts();
  const f = $('#wizard');
  initWizardFunnel(f);
  f.addEventListener('submit', e => { e.preventDefault(); runResult(); });
  f.addEventListener('reset', () => { $('#result').hidden = true; state.lastResult = null; history.replaceState(null, '', location.pathname); });
  $('#btnFindHere').addEventListener('click', () => { setTab('find'); syncWizardLoc(); });
  syncWizardLoc();
}

export function runResult() {
  const inp = readWizard();
  if (!inp.housing && !inp.damage.length) { alert(t('wiz.need')); return; }
  if (!state.rules || !evaluate) { $('#result').hidden = false; $('#result').innerHTML = `<p>${t('ui.nodata')}</p>`; return; }
  const res = evaluate(state.rules, inp, getLang()); state.lastResult = { res, inp };
  stat('wizard_submit');
  stat(inp.proxy ? 'wiz_proxy' : 'wiz_self');
  if (!(res.matched_ids || []).length) stat('wiz_zero');
  if (inp.sgg) stat(`sub_sido_${String(inp.sgg).slice(0, 2)}`); // 시도 코드 2자리까지만 — 시군구 이하는 보내지 않는다
  renderResult(res, inp); history.replaceState(null, '', encodeShare(inp));
}

export const _lawCache = {};

export async function lawDoc(mst) {
  if (_lawCache[mst] !== undefined) return _lawCache[mst];
  try { const r = await fetch(`data/ref/law/${mst}.json`, { cache: 'no-cache' }); _lawCache[mst] = r.ok ? await r.json() : null; }
  catch { _lawCache[mst] = null; }
  return _lawCache[mst];
}

export function lawRefEn(s) {
  if (getLang() === 'ko' || !s) return s;
  return s.replace(/^제(\d+)조(?:의(\d+))?$/, (m, a, b) => 'Art. ' + a + (b ? '-' + b : ''))
    .replace(/^별표(\d+)(?:의(\d+))?$/, (m, a, b) => 'Annex ' + a + (b ? '-' + b : ''));
}

export function lawFoldHTML(r) {
  const L = r.law;
  // 조문 미연결(조례·행정계획·내부 규정 근거)은 사유를 한 줄로 밝힌다 — 누락과 구분하기 위해
  if (!L || (!L.mst && !L.name)) return r.law_note ? `<small class="fine law-note">${escapeHTML(r.law_note)}</small>` : '';
  const tag = [L.art, L.annex].filter(Boolean).map(lawRefEn).join(' · ');
  return `<details class="lawfold" data-mst="${L.mst || ''}" data-art="${L.art || ''}" data-annex="${L.annex || ''}"><summary>${t('law.fold')}${tag ? ` — ${tag}` : ''}</summary><div class="law-body">${t('law.loading')}</div></details>`;
}

export function whyHTML(why) {
  if (!why || !why.length) return '';
  const P = { housing: 'h.', damage: 'd.', household: 'f.' }, out = [];
  for (const w of why) {
    const m = /^(housing|damage|household)=(.+)$/.exec(w);
    if (m) m[2].split('/').forEach(v => { const k = P[m[1]] + ({ near_poor: 'near', single_parent: 'single', disabled: 'dis' }[v] || v); const s = t(k); if (s !== k) out.push(s); });
    else if (w === '특별재난지역') out.push(t('res.sz'));
  }
  return out.length ? `<div class="item-why">✔ ${t('item.why')} ${out.join(' · ')}</div>` : '';
}

export function nearMisses(inp) {
  const rules = (state.rules && state.rules.all) || [], input = { housing: inp.housing || null, damage: inp.damage || [], household: inp.household || [], special_zone: inp.special_zone === true, hazard: inp.hazard || 'any' };
  const out = [];
  for (const r of rules) {
    if (!['cash', 'relief_fund', 'indirect', 'insurance'].includes(r.group)) continue;
    const c = r.conditions || {}, fail = [];
    if ('housing' in c && !(input.housing && c.housing.includes(input.housing))) fail.push('housing');
    if ('damage' in c && !input.damage.some(d => c.damage.includes(d))) fail.push('damage');
    if ('household' in c && !input.household.some(h => c.household.includes(h))) fail.push('household');
    if ('hazard' in c && !(c.hazard.includes('any') || input.hazard === 'any' || c.hazard.includes(input.hazard))) fail.push('hazard');
    if ('special_zone' in c && c.special_zone != null && c.special_zone !== input.special_zone) fail.push('special_zone');
    if (fail.length !== 1 || fail[0] === 'hazard' || fail[0] === 'damage') continue;
    let cond = '';
    if (fail[0] === 'special_zone') cond = c.special_zone ? t('miss.sz') : t('miss.nosz');
    else if (fail[0] === 'household') cond = t('miss.household', { list: c.household.map(v => t('f.' + ({ near_poor: 'near', single_parent: 'single', disabled: 'dis' }[v] || v))).join('·') });
    else if (fail[0] === 'housing') cond = t('miss.housing', { list: c.housing.map(v => t('h.' + v)).join('·') });
    out.push({ r, cond });
  }
  return out.slice(0, 6);
}

export const DOC_SITES = [
  { re: /피해신고서/, url: 'https://www.safekorea.go.kr', key: 'docs.site.safe' },
  { re: /등본|건축물대장|가족관계|한부모|차상위|증명서/, url: 'https://www.gov.kr', key: 'docs.site.gov' },
];

export const docSiteLink = d => { const s = DOC_SITES.find(x => x.re.test(d)); return s ? ` <a href="${s.url}" target="_blank" rel="noopener">${t(s.key)} ↗</a>` : ''; };

export function docsHTML(res) {
  const items = [...(res.cash || []), ...(res.relief_fund || []), ...(res.apply || []), ...(res.insurance || [])];
  const docs = [...new Set(items.flatMap(r => r.docs || []))];
  if (!docs.length) return '';
  const done = new Set(JSON.parse(sessionStorage.getItem('safepic.docs') || '[]'));
  return `<div class="result-block docs"><h3>${t('res.docs')}</h3><ul class="doc-list">${docs.map((d, i) => `<li><label><input type="checkbox" data-doc="${i}" ${done.has(d) ? 'checked' : ''}><span>${d}</span></label>${docSiteLink(d)}</li>`).join('')}</ul><small class="muted">${t('res.docs.s')}</small></div>`;
}

export function itemHTML(r) {
  const amt = r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '');
  const conf = r.confidence === 'verified' ? '' : `<span class="badge est">${r.confidence === 'reported' ? t('badge.reported') : t('badge.est')}</span>`;
  const sz = r.conditions && r.conditions.special_zone === true ? `<span class="badge sz">${t('res.sz')}</span>` : '';
  return `<div class="item"><div class="item-row"><b>${r.label}${sz}${conf}</b><span class="item-amt">${amt}</span></div>${r.summary ? `<div class="item-sum">${r.summary}</div>` : ''}${whyHTML(r._why)}<div class="item-basis">${r.where ? `${r.where} · ` : ''}${r.basis || ''}${r.basis_url ? ` · <a href="${r.basis_url}"${r.group === 'insurance' ? ' data-stat="ins_click"' : ''} target="_blank" rel="noopener">${t('item.src')}</a>` : ''}${r.rate_asof ? ` · ${t('item.asof')} ${r.rate_asof}` : ''}</div>${lawFoldHTML(r)}</div>`;
}

export let _welfareP = null, _welfareEnP = null, _demoP = null;

export const _refJSON = url => fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);

export const loadWelfare = () => _welfareP || (_welfareP = _refJSON('data/ref/welfare.json'));

export const loadWelfareEn = () => _welfareEnP || (_welfareEnP = _refJSON('data/ref/welfare_en.json'));

export const loadDemo = () => _demoP || (_demoP = _refJSON('data/ref/sgg_demo.json'));

export const WF_BASE = ['재난', '재해', '풍수해', '이재민', '긴급', '위기'];

export const WF_HH = { basic: ['기초생활', '수급', '저소득'], near_poor: ['차상위', '저소득'], single_parent: ['한부모', '조손'], senior: ['노인', '어르신', '고령'], disabled: ['장애'] };

export const WF_FR = ['외국인', '다문화', '결혼이민', '통번역'];

export const WF_REGION = { elderly: ['노인', '어르신', '고령', '독거'], alone: ['독거', '돌봄', '응급안전'], rural: ['농업', '어업', '어촌', '농어촌', '도서'] };

export function regionProfile(demo) {
  if (!demo || !demo.sgg || !state.sgg) return null;
  const r = demo.sgg[String(state.sgg)]; if (!r) return null;
  const q = demo.q || {}, tier = (k, v) => !q[k] ? '' : v >= q[k].p75 ? 'hi' : v >= q[k].p50 ? 'mid' : 'lo';
  const tags = [];
  if (tier('e65', r.e65) === 'hi') tags.push('elderly');
  if (tier('ealone', r.ealone) === 'hi') tags.push('alone');
  if (r.gun) tags.push('rural');
  return { ...r, tags, tierE65: tier('e65', r.e65), basis: demo.basis || '' };
}

export function welfarePick(items, inp, prof) {
  const hhKw = [...new Set((inp.household || []).flatMap(h => WF_HH[h] || []))];
  const frKw = inp.foreign ? WF_FR : [];
  const rgKw = [...new Set((prof ? prof.tags : []).flatMap(k => WF_REGION[k] || []))];
  const scored = [];
  for (const it of items) {
    const name = it['서비스명'] || '', sum = it['서비스요약'] || '';
    let s = 0, rg = 0;
    for (const k of WF_BASE) { if (name.includes(k)) s += 3; else if (sum.includes(k)) s += 1; }
    for (const k of hhKw) { if (name.includes(k)) s += 2; else if (sum.includes(k)) s += 1; }
    for (const k of frKw) { if (name.includes(k)) s += 2; else if (sum.includes(k)) s += 1; }
    for (const k of rgKw) { if (name.includes(k)) rg += 2; else if (sum.includes(k)) rg += 1; }
    if (s + rg > 0) scored.push({ it, s, rg });
  }
  /* 본 목록은 재난·긴급·가구 점수(s)순 — 지역 가중(rg)은 동점 정렬과 별도 "지역 특성" 묶음에만 쓴다.
     (진안군처럼 태그 3개가 겹치면 rg가 6까지 올라 풍수해보험(3)을 밀어내던 것을 막는다) */
  const main = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.rg - a.rg);
  const top = main.slice(0, 6), topIds = new Set(top.map(x => x.it['서비스아이디']));
  const regional = scored.filter(x => x.rg > 0 && !topIds.has(x.it['서비스아이디'])).sort((a, b) => b.rg - a.rg || b.s - a.s).slice(0, 4);
  const seen = new Set([...topIds, ...regional.map(x => x.it['서비스아이디'])]);
  const rest = [...main, ...scored.filter(x => x.s === 0).sort((a, b) => b.rg - a.rg)].filter(x => !seen.has(x.it['서비스아이디']));
  return { top, regional, rest, n: top.length + regional.length + rest.length };
}

export function wfContact(s, tr) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!tr) return s.length > 90 ? s.slice(0, 90) + '…' : s;
  const keys = Object.keys(tr.orgs || {}), out = [], re = /([^\d]*?)(\d[\d\-\/~,.()+ ]*\d|\d)(?=\s|$)/g; let m;
  while ((m = re.exec(s)) && out.length < 3) {
    const org = m[1].trim().replace(/^[·,]\s*/, ''), num = m[2].trim();
    const k = tr.orgs[org] ? org : keys.find(x => org.endsWith(x));
    out.push(k ? `${tr.orgs[k]} ${num}` : num);
  }
  return out.join(' · ') || s;
}

export function regionHTML(prof) {
  if (!prof) return '';
  const n = nameOf(), pc = v => (v * 100).toFixed(1);
  const tierKey = prof.tierE65 ? `res.welfare.rg.${prof.tierE65}` : '';
  return `<div class="wf-region"><b>${t('res.welfare.rg')}</b> ${t('res.welfare.rg.line', { sgg: escapeHTML(n.sggName || ''), e65: pc(prof.e65), single: pc(prof.single), ealone: pc(prof.ealone) })}${tierKey ? ` <span class="badge">${t(tierKey)}</span>` : ''}${prof.tags.map(k => `<div class="rg-tag">${t('res.welfare.rg.' + k)}</div>`).join('')}<small>${t('res.welfare.rg.src', { d: escapeHTML(prof.basis) })}</small></div>`;
}

export async function renderWelfare(inp) {
  const en = getLang() !== 'ko';
  const [doc, tr, demo] = await Promise.all([loadWelfare(), en ? loadWelfareEn() : null, state.sgg ? loadDemo() : null]);
  const box = $('#welfareBox'); // fetch 동안 결과가 다시 그려졌으면 새 box에 그린다
  if (!doc || !doc.items || !box) return;
  const prof = regionProfile(demo);
  const picked = welfarePick(doc.items, inp, prof);
  if (!picked.n) return;
  const trOf = it => (tr && tr.items && tr.items[it['서비스아이디']]) || null;
  const name = it => { const x = trOf(it); return x && x[0] ? x[0] : (it['서비스명'] || ''); };
  const summ = it => { const x = trOf(it); return x && x[1] ? x[1] : (it['서비스요약'] || ''); };
  const agency = it => (tr && tr.agency && tr.agency[it['소관부처명']]) || it['소관부처명'] || '';
  const item = ({ it, rg }) => `<div class="item"><div class="item-row"><b>${escapeHTML(name(it))}${rg ? `<span class="badge rg">${t('badge.rg')}</span>` : ''}</b><span class="item-amt">${escapeHTML(agency(it))}</span></div>${summ(it) ? `<div class="item-sum">${escapeHTML(summ(it))}</div>` : ''}<div class="item-basis">${it['대표문의'] ? `${escapeHTML(wfContact(it['대표문의'], tr))} · ` : ''}${it['서비스URL'] ? `<a href="${escapeHTML(it['서비스URL'])}" data-stat="${(it['서비스명'] || '').includes('보험') ? 'ins_click' : 'welfare_click'}" target="_blank" rel="noopener">${t('res.welfare.link')} ↗</a>` : ''}</div></div>`;
  const { top, regional, rest } = picked;
  const untranslated = en && tr ? [...top, ...regional, ...rest].filter(p => !trOf(p.it)).length : 0;
  stat('welfare_shown');
  box.hidden = false;
  const wd = box.closest('details'); if (wd) { wd.hidden = false; const ws = wd.querySelector('.acc-s'); if (ws) ws.textContent = t('res.n', { n: picked.n }); }
  box.innerHTML = `<h3>${t('res.welfare')}</h3><small class="muted">${t('res.welfare.s')}</small>${inp.foreign ? `<small class="muted">${t('res.welfare.fr')}</small>` : ''}${regionHTML(prof)}${top.map(item).join('')}${regional.length ? `<div class="wf-regional"><div class="wf-sub">${t('res.welfare.rg.list')}</div>${regional.map(item).join('')}</div>` : ''}${rest.length ? `<details class="wf-more"><summary>${t('res.welfare.more', { n: picked.n })}</summary>${rest.map(item).join('')}</details>` : ''}<small class="muted">${t('res.welfare.src', { d: (doc.updated || '').slice(0, 10) })}${en ? ` ${t(untranslated ? 'res.welfare.tr.part' : 'res.welfare.tr', { n: untranslated })}` : ''}</small>`;
}

export function firstVariant(res, inp, dl) {
  const hasDamage = (inp.damage || []).some(d => d !== 'heat' && d !== 'cold');
  if (!hasDamage) return (res.heat_cold || []).some(r => r.id.endsWith('_shelter')) ? 'shelter' : null;
  if (state.sit === 'no_news') return 'nonews';
  return dl && dl.days_left < 0 ? 'late' : 'report';
}

export const fmtMD = iso => { const [y, m, d] = String(iso).split('-').map(Number); return getLang() === 'ko' ? `${m}월 ${d}일` : new Date(y, m - 1, d).toLocaleDateString(getLang(), { month: 'short', day: 'numeric' }); };

export const hazardOf = d => d.includes('heat') && !d.includes('cold') ? 'heat' : d.includes('cold') && !d.includes('heat') ? 'cold' : 'rain';

export function firstBoxHTML(v, res, inp, dl, icsBtn) {
  const step = id => (res.timeline || []).find(s => s.id === id) || {};
  const row = (k, val) => val ? `<dt>${t(k)}</dt><dd>${val}</dd>` : '';
  const where = kind => `<span id="firstWhere" data-kind="${kind}">${kind === 'townhall' ? (step('proc.report').where || '') : t('first.where.app')}</span>`;
  const send = inp.proxy ? '' : `<button type="button" class="btn btn-ghost btn-sm" id="btnSend">${t('first.send')}</button>`;
  const px = inp.proxy ? row('first.proxy', t('first.proxy.v')) : '';
  let cls = '', doText, rows, acts = send;
  if (v === 'shelter') {
    const cold = res.heat_cold.find(r => r.id.endsWith('_shelter')).id.includes('cold');
    doText = t(cold ? 'first.do.cold' : 'first.do.heat');
    rows = row('first.where', where(cold ? 'cold' : 'heat')) + row('first.ill', t(cold ? 'first.ill.cold' : 'first.ill.heat'));
    acts = '';
  } else if (v === 'nonews') {
    cls = ' wait'; doText = t('first.do.nonews');
    rows = row('first.where', where('townhall')) + row('first.ask', t('first.ask.v')) + row('first.bring', t('first.bring.nonews')) + row('first.none', t('first.none.v'));
  } else if (v === 'late') {
    const n = (res.auto || []).length + (res.apply || []).length;
    cls = ' late'; doText = t('first.do.late', { n: -dl.days_left });
    rows = row('first.where', where('townhall')) + px + row('first.say', t('first.say.v')) + (n ? row('first.still', t('first.still.v', { n })) : '');
    acts = `<button type="button" class="btn btn-ghost btn-sm" id="btnStill">${t('first.still.btn')}</button>` + send;
  } else {
    doText = !dl ? t('first.do.noend') : dl.days_left === 0 ? t('first.do.today') : t('first.do.report', { date: fmtMD(dl.due), dday: t('res.dl.d', { n: dl.days_left }) });
    // ponytail: '가져갈 것'은 절차 데이터의 앞 3개(서식·신분증·사진)+통장 사본에 기대는 순서 의존. procedures.json에 first_docs 필드가 생기면 그걸로 교체
    const bring = [...(step('proc.report').docs || []).slice(0, 3), ...(step('proc.payment').docs || []).slice(0, 1), inp.housing === 'rent' ? t('first.lease') : null].filter(Boolean).map(d => d.replace(/\s*\([^)]*\)/g, ''));   // 괄호 설명은 상자에서 뺀다(전체는 '준비할 서류'에)
    rows = row('first.where', where('townhall')) + row('first.bring', bring.map(escapeHTML).join(' · ')) + px + row('first.before', t('first.photo'));
    acts = icsBtn + send;
  }
  return `<div class="first${cls}"><h3>${t('first.h')}</h3><div class="first-do">${doText}</div><dl>${rows}</dl><div class="first-acts" id="firstActs">${acts}</div></div>`;
}

export const _accOpen = () => { try { return new Set(JSON.parse(sessionStorage.getItem('safepic.acc') || '[]')); } catch { return new Set(); } };

export const acc = (id, title, sum, body, { open = false, solo = true, hidden = false } = {}) => body ? `<details class="acc${solo ? ' acc-solo' : ''}" data-acc="${id}"${open || (id !== 'more' && _accOpen().has(id)) ? ' open' : ''}${hidden ? ' hidden' : ''}><summary><span>${title}</span><span class="acc-s">${sum || ''}</span></summary><div class="acc-in">${body}</div></details>` : '';

export function printSheetHTML(res, cashItems) {
  const items = [...cashItems, ...(res.auto || []), ...(res.apply || []), ...(res.insurance || [])];
  if (!items.length) return '';
  const conf = r => r.confidence === 'verified' ? '' : ` <span class="ps-conf">${r.confidence === 'reported' ? t('badge.reported') : t('badge.est')}</span>`;
  const rows = items.map(r => `<tr><td><b>${r.label}</b>${conf(r)}<div class="ps-law">${escapeHTML(r.basis || '')}${r.rate_asof ? ` · ${t('item.asof')} ${r.rate_asof}` : ''}</div></td><td>${r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '')}</td><td>${escapeHTML((r.where || '').replace(/\s*\([^)]*\)/g, ''))}</td></tr>`).join('');
  const docs = [...new Set(items.flatMap(r => r.docs || []).map(d => d.replace(/\s*\([^)]*\)/g, '')))].map(escapeHTML).join(' · ');   // 괄호를 뗀 뒤에 중복 제거(영어에서 같은 이름이 두 번 나왔다)
  return `<div class="print-only print-sheet"><h3>${t('print.got')}</h3><table><thead><tr><th>${t('print.h.item')}</th><th>${t('print.h.what')}</th><th>${t('print.h.where')}</th></tr></thead><tbody>${rows}</tbody></table>${docs ? `<p class="ps-docs"><b>${t('print.docs')}</b> ${docs}</p>` : ''}<p class="ps-docs">${t('res.scope')}</p><div class="ps-staff"><b>${t('print.staff.h')}</b> ${t('print.staff')}</div><div class="ps-foot">${t('print.foot')} · 5-jihwan.github.io/aidpage</div></div>`;
}

export function proxyHTML() {
  const blank = k => `<span>${t(k)} <i></i></span>`;
  return `<div class="deliver"><b>${t('dlv.h')}</b><button type="button" class="btn btn-primary btn-sm" id="dlvPrint">🖨 ${t('dlv.print')}</button><button type="button" class="btn btn-ghost btn-sm" id="dlvSend">${t('dlv.send')}</button><button type="button" class="btn btn-ghost btn-sm" id="dlvCopy">${t('dlv.copy')}</button></div>
    <div class="print-only ps-proxy">${blank('print.px.victim')}${blank('print.px.helper')}${blank('print.px.rel')}${blank('print.px.tel')}</div>
    <div class="result-block px"><h3>${t('px.h')}</h3><ul><li>${t('px.2')}</li><li>${t('px.3')}</li></ul></div>`;
}

export function renderResult(res, inp) {
  const n = nameOf(), el = $('#result'); el.hidden = false;
  const place = state.emd ? `${n.sidoName} ${n.sggName} ${n.emdName}` : t('res.noloc');
  const dl = (res.deadlines || [])[0];
  const dlHTML = dl
    ? `<div class="deadline ${dl.days_left < 0 ? 'over' : ''}"><div class="d">${dl.days_left < 0 ? t('res.dl.over', { n: -dl.days_left }) : dl.days_left === 0 ? t('res.dl.today') : t('res.dl.d', { n: dl.days_left })}</div><div><b>${dl.label}</b><br><small class="muted">${t('res.dl.ext', { due: dl.due })}</small></div></div>`
    : `<div class="deadline"><div class="d">${t('res.dl.10')}</div><div><b>${t('res.dl.title')}</b><br><small class="muted">${t('res.dl.s')}</small></div></div>`;
  const icsBtn = dl && dl.days_left >= 0 ? `<button type="button" class="btn btn-ghost btn-sm ics" id="btnIcs">📅 ${t('res.ics')}</button>` : '';
  // 기한이 지난 사람에게: 막다른 길이 아니라 "아직 가능한 것"
  const lateHTML = dl && dl.days_left < 0 ? `<div class="result-block late"><h3>${t('late.title')}</h3><ol class="late-list"><li>${t('late.ext')}</li><li>${t('late.cert')}</li><li>${t('late.fund')}</li><li>${t('late.appeal')}</li><li>${t('late.psych')}</li><li>${t('late.ins')}</li></ol><small class="muted">${t('late.src')}</small></div>` : '';
  const sec = (title, arr) => `<div class="result-block"><h3>${title}</h3>${arr && arr.length ? arr.map(itemHTML).join('') : `<div class="muted" style="font-size:.9rem">${t('res.none')}</div>`}</div>`;
  const cashItems = [...(res.cash || []), ...(res.relief_fund || [])];
  // 재난심리회복지원센터: 사람이 다치거나 사망한 경우 — 좌표 대신 전화·주소(행안부 현황 2024-08)
  let psychHTML = '';
  if (state.psych && (inp.damage || []).some(d => d === 'injury' || d === 'death')) {
    const cs = state.psych.centers.filter(c => !state.sido || c.sido === state.sido);
    psychHTML = `<div class="result-block psych"><h3>${t('res.psych')}</h3><div class="psych-hot">📞 <a href="tel:${state.psych.hotline}"><b>${state.psych.hotline}</b></a> <small class="muted">${t('res.psych.hot')}</small></div>${cs.map(c => `<div class="psych-c"><b>${c.name}</b> <a href="tel:${c.tel}" class="mono">${c.tel}</a><br><small class="muted">${c.addr}</small></div>`).join('')}<small class="muted">${t('res.psych.src')}</small></div>`;
  }
  const v = firstVariant(res, inp, dl);
  const nGot = cashItems.length + (res.auto || []).length + (res.apply || []).length + (res.insurance || []).length, nUnpriced = cashItems.filter(r => r.amount_krw == null).length;
  const gotSum = `${res.total_cash_krw ? `<b>${t('res.got.sum', { amt: formatKRW(res.total_cash_krw) })}</b>${nUnpriced ? t('res.got.unpriced', { n: nUnpriced }) : ''} · ` : ''}${[['res.got.c', cashItems.length], ['res.got.a', (res.auto || []).length], ['res.got.p', (res.apply || []).length]].filter(x => x[1]).map(x => t(x[0], { n: x[1] })).join(' · ')}`;
  const nm = nearMisses(inp); if (nm.length) stat('nearmiss_shown');
  const docsN = new Set([...(res.cash || []), ...(res.relief_fund || []), ...(res.apply || []), ...(res.insurance || [])].flatMap(r => r.docs || [])).size;
  // P1·P2: 당사자에겐 돈 한 줄. 건수·항목은 '자세히 보기' 안으로, 금액 상향 안내는 ⓘ 안으로
  const moneyHTML = cashItems.length ? `<div class="money"><span>${t('res.money')}</span><b>${res.total_cash_krw ? t('res.got.sum', { amt: formatKRW(res.total_cash_krw) }) + (nUnpriced ? ' + α' : '') : t('res.money.tbd')}</b><button type="button" class="money-i" id="moneyI" aria-expanded="false" aria-controls="moneyPop" aria-label="${t('res.money.i')}">i</button></div><p class="money-pop" id="moneyPop" hidden>${t('res.cash.raise')}</p>` : '';
  const stepsHTML = v && v !== 'shelter' ? `<div class="steps">${['report', 'survey', 'pay', 'more'].map((k, i) => `<span class="${i === (v === 'nonews' ? 1 : 0) ? 'on' : ''}">${t('step.' + k)}</span>`).join('<i></i>')}</div>` : '';
  el.innerHTML = `
    <div class="print-head"><div><b>AidPage</b> ${t('brand.sub')}</div><div>${place} · ${inp.today} · ${t(inp.proxy ? 'print.proxy' : 'print.self')}</div></div>
    <div class="result-head"><div><div class="eyebrow mono">${place}${inp.special_zone ? ' · ' + t('res.sz') : ''}</div><h2>${inp.proxy ? t('res.proxy') : t('res.mine')}</h2><div class="fine xlat-note">${t('lang.rulesEn')}</div></div><div class="result-tools"><button type="button" class="btn btn-ghost btn-sm" id="btnSpeak" title="${t('tts.title')}">🔊</button><button type="button" class="btn btn-ghost" id="btnEdit">${t('res.edit')}</button></div></div>
    ${v ? firstBoxHTML(v, res, inp, dl, icsBtn) + (inp.proxy ? proxyHTML() : '') + stepsHTML : `<div class="result-block"><h3>${t('res.todo')}</h3><ol class="todo">${(res.todo || []).map(x => `<li><div><b>${x.text || x}</b></div></li>`).join('')}</ol></div>${dlHTML}${icsBtn}`}
    ${acc('late', t('late.title'), '', lateHTML, { open: true })}
    ${inp.foreign ? `<div class="result-block foreign"><h3>${t('fr.title')}</h3><p>${t('fr.ok')}</p><p>${t('fr.cash')}</p><p>${t('fr.emergency')}</p><p>${t('fr.check')}</p><div class="fr-call">📞 ${t('fr.call')}</div></div>` : ''}
    ${moneyHTML}
    ${acc('psych', t('res.psych'), '', psychHTML)}
    <div class="share-row"><button type="button" class="btn btn-primary" id="btnCopy">${t('res.copy')}</button><button type="button" class="btn btn-ghost" onclick="print()">${t('res.print')}</button><button type="button" class="btn btn-ghost" id="btnImg">🖼 ${t('res.img')}</button><a class="btn btn-ghost" href="https://www.safekorea.go.kr" target="_blank" rel="noopener">${t('res.report')}</a><span class="copied" id="copied"></span></div>
    ${acc('more', t('res.more'), t('res.more.s'), `${nGot ? acc('got', t('res.got'), gotSum, `<div class="result-block"><h3>${t('res.cash')}</h3><div class="total">${formatKRW(res.total_cash_krw || 0)}<small>${t('res.cash.s')}${res.total_cash_has_unpriced ? t('res.cash.unpriced') : ''}</small></div>${cashItems.map(itemHTML).join('') || `<div class="muted" style="font-size:.9rem">${t('res.cash.none')}</div>`}</div>${sec(t('res.auto'), res.auto)}${sec(t('res.apply'), res.apply)}${res.insurance && res.insurance.length ? sec(t('res.ins'), res.insurance) : ''}`, { solo: false }) : v === 'nonews' ? `<p class="muted first-hint">${t('first.nonews.hint')}</p>` : ''}

    ${(() => { const A = _simMod && _simMod.accessLines && _simMod.accessLines(); return A ? `<div class="result-block access"><h3>${t('acc.print')} <small class="muted">${escapeHTML(A.from)}</small></h3><ol>${A.rows.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ol><small class="muted">${t('acc.note')}</small></div>` : ''; })()}
    ${acc('docs', t('res.docs'), t('res.docs.n', { n: docsN }), docsHTML(res))}
    ${acc('miss', inp.household_unknown ? t('res.maybe') : t('res.miss'), t('res.n', { n: nm.length }), nm.length ? `<div class="result-block miss ${inp.household_unknown ? 'is-unknown' : ''}"><h3>${inp.household_unknown ? t('res.maybe') : t('res.miss')}</h3>${inp.household_unknown ? `<small class="muted">${t('res.maybe.s')}</small>` : ''}${nm.map(x => `<div class="miss-item"><b>${x.r.label}</b>${x.r.amount_text ? ` <span class="item-amt">${x.r.amount_text}</span>` : ''}<br><small class="muted">→ ${x.cond}</small></div>`).join('')}</div>` : '')}
    ${acc('welfare', t('res.welfare'), '', `<div class="result-block welfare" id="welfareBox" hidden></div>`, { hidden: true })}
    ${acc('proc', t('res.proc.all'), t('res.proc.n', { n: (res.timeline || []).length }), `<div class="result-block"><h3>${t('res.proc')}</h3><ol class="timeline">${(res.timeline || []).map(s => `<li><b>${s.label}</b>${s.due ? ` <span class="badge">${t('badge.due', { d: s.due })}${s.days_left != null ? (s.days_left < 0 ? ' · ' + t('badge.over') : ` · D-${s.days_left}`) : ''}</span>` : ''}<small>${[s.summary, s.where, s.docs && s.docs.length && s.docs.join(', '), s.typical_days].filter(Boolean).join(' · ')}</small></li>`).join('')}</ol></div>`)}
`, { solo: false, open: !!inp.proxy })}
    ${printSheetHTML(res, cashItems)}
    <p class="res-scope">${t('res.scope.s')}</p>
    <details class="disc"><summary>${t('res.disc.s')} <u>${t('res.disc.more')}</u></summary><div class="disclaimer">${t('res.disc')}</div></details>`;
  renderWelfare(inp);
  $$('details.acc', el).forEach(d => d.dataset.acc !== 'more' && d.addEventListener('toggle', () => { const o = _accOpen(); d.open ? o.add(d.dataset.acc) : o.delete(d.dataset.acc); sessionStorage.setItem('safepic.acc', JSON.stringify([...o])); }));
  const sendIt = () => navigator.share ? navigator.share({ title: document.title, url: location.href }).catch(() => {}) : $('#btnCopy').click();
  const bs = $('#btnSend'); if (bs) bs.onclick = sendIt;
  if ($('#dlvPrint')) { $('#dlvPrint').onclick = () => print(); $('#dlvSend').onclick = sendIt; $('#dlvCopy').onclick = () => $('#btnCopy').click(); }
  const bl = $('#btnStill'); if (bl) bl.onclick = () => { const d = $('details[data-acc="late"]', el); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  $('#btnEdit').onclick = () => { el.hidden = true; $('#panelScroll').scrollTop = 0; };
  $('#btnImg').onclick = () => shareImage(res, inp);
  const mi = $('#moneyI', el); if (mi) mi.onclick = () => { const p = $('#moneyPop', el); p.hidden = !p.hidden; mi.setAttribute('aria-expanded', String(!p.hidden)); };
  $('#btnSpeak').onclick = () => { const fb = $('.first', el); const txt = [place, fb ? [...fb.querySelectorAll('.first-do, dt, dd')].map(n => (n.firstChild && n.firstChild.textContent || n.textContent).trim()).join('. ') : '', formatKRW(res.total_cash_krw || 0) + ' ' + t('res.cash.s'), dl ? `${dl.label} ${dl.due}` : '', ...(res.todo || []).map(x => x.text || x), ...cashItems.map(r => `${r.label} ${r.amount_text || ''}`)].filter(Boolean).join('. '); speak(txt, $('#btnSpeak')); };
  const ib = $('#btnIcs'); if (ib && dl) ib.onclick = () => downloadICS(`${dl.label} — AidPage`, dl.due, `${place}\n${t('res.dl.ext', { due: dl.due })}\n${location.href}`);
  // print-only: nearest community center (피해신고 접수처)
  const fw = $('#firstWhere', el), fk = fw ? fw.dataset.kind : 'townhall';
  if (state.emd && state.shelters.avail.some(a => a.id === fk)) { const e = state.idx.byEmd.get(state.emd); nearestShelters([e.lon, e.lat], [fk], state.sido, 1, true).then(l => { if (l[0] && !el.hidden) { if (fw && fw.isConnected) { fw.innerHTML = `<b>${escapeHTML(l[0].p.name)}</b> · ${t('sh.walk', { n: l[0].walk })}`; const fa = $('#firstActs', el); if (fa) fa.insertAdjacentHTML('afterbegin', `${l[0].p.tel ? `<a class="btn btn-ghost btn-sm" href="tel:${l[0].p.tel}">📞 ${t('first.call')}</a>` : ''}`); fw.closest('dd').insertAdjacentHTML('beforeend', routeLinks(l[0].c[0], l[0].c[1], l[0].p.name)); } if (fk !== 'townhall') return; const d = document.createElement('div'); d.className = 'result-block print-only'; d.innerHTML = `<h3>${t('res.print.townhall')}</h3><b>${l[0].p.name}</b><br>${l[0].p.addr || ''}${l[0].p.tel ? ` · ${l[0].p.tel}` : ''} · ${t('sh.walk', { n: l[0].walk })}`; (el.querySelector('.first') || el.querySelector('.share-row'))[el.querySelector('.first') ? 'after' : 'before'](d); } }); }
  $$('input[data-doc]', el).forEach(c => c.addEventListener('change', () => { const on = $$('input[data-doc]', el).filter(x => x.checked).map(x => x.nextElementSibling.textContent); sessionStorage.setItem('safepic.docs', JSON.stringify(on)); }));
  $('#btnCopy').onclick = async () => { stat('share_copy'); try { await navigator.clipboard.writeText(location.href); $('#copied').textContent = t('res.copied'); setTimeout(() => $('#copied').textContent = '', 2000); } catch { prompt('URL', location.href); } };
  $('#panelScroll').scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
}

export function renderRulesTable() {
  const box = $('#rulesTable'); if (!state.rules) return;
  if (box.dataset.done === getLang()) return;
  const all = state.rules.all || []; box.hidden = false; box.dataset.done = getLang();
  const conf = c => ({ verified: t('conf.verified'), reported: t('conf.reported'), estimate: t('conf.estimated') }[c] || c || '');  // 값 어휘는 rules.js validateRules와 동일해야 한다
  box.innerHTML = `<div class="table-wrap" style="max-height:60vh;border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>${t('rules.h.label')}</th><th>${t('rules.h.amount')}</th><th>${t('rules.h.basis')}</th><th>${t('rules.h.asof')}</th><th>${t('rules.h.conf')}</th></tr></thead><tbody>${all.map(r => `<tr><td><b>${r.label}</b><br><small>${r.summary || ''}</small></td><td class="mono">${r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '-')}</td><td>${r.basis || ''}${r.basis_url ? ` <a href="${r.basis_url}" target="_blank" rel="noopener">↗</a>` : ''}</td><td class="mono">${r.rate_asof || r.effective_from || ''}</td><td><span class="conf conf-${r.confidence || 'na'}">${conf(r.confidence)}</span></td></tr>`).join('')}</tbody></table></div><p class="fine">${t('rules.total', { n: all.length })} <a href="https://github.com/5-Jihwan/aidpage/issues" target="_blank" rel="noopener">Issue</a></p>`;
}
