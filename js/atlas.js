/* AidPage Atlas 화면 로직 — 10-14 atlas.html 인라인 스크립트에서 분리(500줄 규칙). fetch 경로는 문서 기준이라 그대로. */
import { DICT } from './i18n.js?v=20261014e';
import { UI, ICON, COL, TN_EN, INST, INST_MAIN, TRAITS, UPPER_EN } from './atlas_i18n.js?v=20261014e';
const V = '20260912a';
/* ── UI strings (ko/en) ── */

let L = 'ko'; try { L = localStorage.getItem('aidpage-dex-lang') || 'ko'; } catch { }
// 본 사이트 서랍에서 넘어올 때 #c=코드&l=en 형태로 언어를 넘긴다(저장값보다 우선)
const HP = new URLSearchParams(location.hash.slice(1)); if (HP.get('l') === 'en' || HP.get('l') === 'ko') L = HP.get('l');
const T = (k, v) => { let s = (UI[L] && UI[L][k]) ?? UI.ko[k] ?? k; if (v) for (const x in v) s = s.split(`{${x}}`).join(v[x]); return s; };
const tn = k => L === 'en' ? (TN_EN[k] || k) : k;
const D = k => (DICT[L] && DICT[L]['ty.' + k + '.d']) || DICT.ko['ty.' + k + '.d'] || '';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const J = async u => (await fetch(u, { cache: 'no-cache' })).json();
const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const num = (v, d = 0) => v == null ? '—' : Number(v).toLocaleString(L === 'en' ? 'en-US' : 'ko-KR', { maximumFractionDigits: d });
function applyUI() {
  document.documentElement.lang = L;
  $$('[data-ui]').forEach(el => { el.innerHTML = T(el.dataset.ui); }); $$('[data-ui-title]').forEach(el => { el.title = T(el.dataset.uiTitle); }); $$('[data-ui-ph]').forEach(el => { el.placeholder = T(el.dataset.uiPh); });
  $('#langBtn').textContent = L === 'en' ? '한국어' : 'EN';
}

/* ── data ── */
const [Ty, O, IDX, SD, TR, SP, AC] = await Promise.all([J('data/ref/sgg_types.json'), J('data/ref/sgg_ordin.json').catch(() => null), J('data/admin/sgg_index.json'), J('data/ref/sido_types.json').catch(() => null), J('data/ref/sgg_threshold.json').catch(() => null), J('data/ref/sgg_type_specs.json').catch(() => null), J('data/ref/sgg_access.json').catch(() => null)]);
const idx = Object.fromEntries(IDX.map(s => [s.code, s]));
const rows = Object.entries(Ty.sgg).map(([code, s]) => ({ code, s, i: idx[code] || {}, o: O && O.sgg ? O.sgg[code] : null, m: s.metrics || {}, t: TR && TR.sgg ? TR.sgg[code] : null }));
/* 국가 지원 문턱 층(docs/24 §5-1): r.t = { fi3, band 0~4, thr{sub,decl,emd}(억), fi_unit self|parent, fi_missing gu|jeju|unknown, records } */
const thrKey = r => r.t && r.t.band != null ? String(r.t.band) : 'na';
const eok = k => k == null ? '—' : (k / 100000).toLocaleString(L === 'en' ? 'en-US' : 'ko-KR', { maximumFractionDigits: k >= 1e6 ? 0 : 1 });
const THR_COL = ['#f4c95d', '#e7a23a', '#c97c2c', '#9d5622', '#6b3a17'];
/* 대피 접근 지도: 주민 비율 구간(설명용 고정 구간, 순위 아님) */
const ACC_BINS = [5, 15, 30], ACC_COL = ['#dbe7f5', '#9cbfe3', '#4f86c6', '#1f4e8c'];
const accKey = r => { const a = AC && AC.sgg[r.code]; if (!a || !modeArg) return 'na'; const v = a[modeArg]; return String(ACC_BINS.filter(b => v >= b).length); };
/* 금액(억 원) 표기: ko '33억' · en '₩3.3B' (1억 = ₩100M) */
const won = v => v == null ? '—' : L === 'en' ? `₩${(v / 10).toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 1 })}B` : `${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`;
const wonK = k => k == null ? '—' : won(k / 100000);
/* 방법 보기(심사자용, docs/24 §5-3): 임계·단위 사양을 바꿔 같은 규칙을 다시 돌린 결과(sgg_type_specs.json).
   기준(p75/256)이면 null. 단위 230은 p75에서만 계산했으므로 둘 다 바꾸면 단위 230이 우선한다. */
const spec = { q: 'p75', u: '256' };
const specKey = () => spec.u !== '256' ? 'u' + spec.u : (spec.q === 'p75' ? null : spec.q);
const altOf = r => { const k = specKey(); return SP && k && SP.specs[k] ? SP.specs[k][r.code] || null : null; };
const specChanged = r => { const a = altOf(r); return !!a && !a.out && (a.p !== r.s.primary || (a.lean == null) !== (r.s.lean == null)); };
const effP = r => { const a = altOf(r); return a && !a.out ? a.p : r.s.primary; };
const effLean = r => { const a = altOf(r); return a && !a.out ? a.lean != null : isLean(r); };
const byCode = Object.fromEntries(rows.map(r => [r.code, r]));
const nm = r => L === 'en' ? (r.i.name_en || r.i.name) : (r.i.name || r.s.name);
const sidoNm = r => L === 'en' ? (r.i.sido_name_en || r.i.sido_name || '') : (r.i.sido_name || '');
const upperNm = s => L === 'en' ? (UPPER_EN[s.upper] || s.upper || '') : (s.upper || '');
const isLean = r => !!r.s.lean;
const pk = r => r.s.primary + (isLean(r) ? '◌' : '');
const basisKey = r => isLean(r) ? (r.s.lean.deg === '근접' ? 'lean' : 'faint') : r.s.basis || (r.s.primary === '바다' || r.s.primary === '마름' ? 'contact' : null);
const TH = Ty.meta.thresholds || {};
function sortRows() { rows.sort((a, b) => (a.i.sido || a.s.sido).localeCompare(b.i.sido || b.s.sido) || nm(a).localeCompare(nm(b), L === 'en' ? 'en' : 'ko')); }
let sidos = [];
function buildSidos() { sidos = []; rows.forEach(r => { const k = r.i.sido || r.s.sido; let c = sidos.find(x => x.code === k); if (!c) { c = { code: k, name: sidoNm(r) || k, rows: [] }; sidos.push(c); } c.rows.push(r); }); }

/* ── seen ── */
const SEEN_KEY = 'aidpage-dex-seen';
let seen = new Set(); try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { }
function markSeen(code) { if (seen.has(code)) return; seen.add(code); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { } paintProg(); const li = $(`#toc li[data-c="${code}"]`); if (li) li.classList.add('is-seen'); }
function paintProg() { $('#progBar').style.setProperty('--p', (seen.size / rows.length * 100).toFixed(1) + '%'); $('#progTxt').textContent = T('prog', { n: seen.size, t: rows.length }); }

/* ── filters ── */
const F = { prim: new Set(), basis: new Set(), soc: new Set(), trait: new Set(), inst: new Set(), thr: new Set(), flag: new Set() };
function count(fn) { const c = {}; rows.forEach(r => (fn(r) || []).forEach(k => { if (k) c[k] = (c[k] || 0) + 1; })); return c; }
function chips(el, counts, set, labelOf = k => k, order = null, cls = () => '') {
  const ents = Object.entries(counts); if (order) ents.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])); else ents.sort((a, b) => b[1] - a[1]);
  el.innerHTML = ents.map(([k, n]) => `<button type="button" class="chip ${set.has(k) ? 'is-on' : ''} ${cls(k)}" data-k="${esc(k)}">${ICON[k.replace('◌', '')] || ''} ${esc(labelOf(k))}<b>${n}</b></button>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; set.has(k) ? set.delete(k) : set.add(k); b.classList.toggle('is-on'); applyFilters(); }));
}
function buildFilters() {
  chips($('#fPrim'), count(r => [pk(r)]), F.prim, k => k.endsWith('◌') ? `${tn(k.slice(0, -1))} ${T('bs.lean')}·${T('bs.faint')}` : tn(k), ['물', '산', '바다', '마름', '물◌', '산◌', '마름◌'], k => k.endsWith('◌') ? 'lean' : '');
  chips($('#fBasis'), count(r => [basisKey(r)]), F.basis, k => T('bs.' + k), ['history', 'zone', 'contact', 'lean', 'faint']);
  chips($('#fSoc'), count(r => [r.s.social || '—']), F.soc, k => k === '—' ? T('none') : tn(k));
  chips($('#fTrait'), count(r => r.s.traits || []), F.trait, tn, TRAITS);
  if (O) chips($('#fInst'), count(r => r.o ? Object.keys(r.o.ord).filter(k => r.o.ord[k]) : []), F.inst, k => INST[k][L === 'en' ? 1 : 0], Object.keys(INST)); else $('#fInst').closest('details').hidden = true;
  if (TR) chips($('#fThr'), count(r => [thrKey(r)]), F.thr, k => k === 'na' ? T('thr.na.s') : T('thr.b' + k), ['0', '1', '2', '3', '4', 'na']); else $('#fThr').closest('details').hidden = true;
}
$$('#fFlag button').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; F.flag.has(k) ? F.flag.delete(k) : F.flag.add(k); b.classList.toggle('is-on'); applyFilters(); }));
$('#q').addEventListener('input', applyFilters);
function match(r) {
  const q = $('#q').value.trim().toLowerCase();
  return (!q || (r.i.name || '').includes(q) || (r.i.name_en || '').toLowerCase().includes(q) || (r.i.sido_name || '').includes(q) || (r.i.sido_name_en || '').toLowerCase().includes(q))
    && (!F.prim.size || F.prim.has(pk(r))) && (!F.basis.size || F.basis.has(basisKey(r))) && (!F.soc.size || F.soc.has(r.s.social || '—'))
    && (!F.trait.size || [...F.trait].every(k => (r.s.traits || []).includes(k)))
    && (!F.inst.size || (r.o && [...F.inst].every(k => r.o.ord[k])))
    && (!F.thr.size || F.thr.has(thrKey(r)))
    && (!F.flag.has('edge') || (r.s.edge && r.s.edge.length)) && (!F.flag.has('complex') || r.s.complex) && (!F.flag.has('bold') || r.s.bold) && (!F.flag.has('unseen') || !seen.has(r.code)) && (!F.flag.has('chg') || specChanged(r));
}
let visible = rows.slice();
function applyFilters() {
  visible = rows.filter(match); const vis = new Set(visible.map(r => r.code));
  $$('#toc li').forEach(li => li.classList.toggle('dim', !vis.has(li.dataset.c)));
  $$('#toc .ch').forEach(ch => { const n = ch.querySelectorAll('li:not(.dim)').length, tot = ch.querySelectorAll('li').length; ch.querySelector('button small').textContent = n === tot ? `${n}` : `${n}/${tot}`; });
  const anyF = F.prim.size + F.basis.size + F.soc.size + F.trait.size + F.inst.size + F.thr.size + F.flag.size + ($('#q').value.trim() ? 1 : 0);
  [['#nPrim', F.prim, k => k.endsWith('◌') ? tn(k.slice(0, -1)) + '◌' : tn(k)], ['#nBasis', F.basis, k => T('bs.' + k)], ['#nSoc', F.soc, tn], ['#nTrait', F.trait, tn], ['#nInst', F.inst, k => INST[k][L === 'en' ? 1 : 0]]].forEach(([s, set, f]) => { $(s).textContent = set.size ? [...set].map(f).join('·') : ''; });
  $('#toc .empty')?.remove(); if (!visible.length) $('#toc').insertAdjacentHTML('afterbegin', `<div class="empty">${T('empty')}</div>`);
  $('#lgNote').textContent = anyF ? T('filt', { n: visible.length }) : '';
  if (map) paintMap();
}

/* ── toc ── */
function buildToc() {
  $('#toc').innerHTML = `<button type="button" class="pro-link" id="proLink">${T('pro.toc')}</button>` + sidos.map(c => `<div class="ch" data-s="${c.code}"><button type="button">${esc(c.name)}<small>${c.rows.length}</small></button><ul>${c.rows.map(r => `<li data-c="${r.code}" class="${seen.has(r.code) ? 'is-seen' : ''} ${isLean(r) ? 'lean' : ''}" style="--c:${COL[r.s.primary]}"><span class="sw"></span><span class="nm">${esc(nm(r))}</span><span class="ic">${ICON[r.s.primary]}${r.s.social ? ICON[r.s.social] : ''}</span><span class="seen"></span></li>`).join('')}</ul></div>`).join('');
  $$('#toc li').forEach(li => li.addEventListener('click', () => show(li.dataset.c)));
  $$('#toc .ch > button').forEach(b => b.addEventListener('click', () => showCover(b.parentElement.dataset.s)));
  $('#proLink').addEventListener('click', showIntro); $('#proLink').classList.toggle('is-cur', inIntro);
}

/* ── geometry → svg ── */
let GEO = null, SIDO = null, KR_PATH = '', KR_TF = null;
function ringsOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
function fitTf(geoms, W, H, pad = 6) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, lat0 = 0, n = 0;
  geoms.forEach(g => ringsOf(g).forEach(poly => poly[0].forEach(([x, y]) => { lat0 += y; n++; })));
  const k = Math.cos((lat0 / n) * Math.PI / 180);
  geoms.forEach(g => ringsOf(g).forEach(poly => poly[0].forEach(([x, y]) => { x *= k; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); })));
  const s = Math.min((W - pad * 2) / (maxx - minx || 1), (H - pad * 2) / (maxy - miny || 1));
  const ox = (W - (maxx - minx) * s) / 2, oy = (H - (maxy - miny) * s) / 2;
  return { k, s, minx, maxy, ox, oy, px: ([x, y]) => [((x * k - minx) * s + ox), ((maxy - y) * s + oy)] };
}
function pathOf(g, tf, step = 1) {
  let d = '';
  ringsOf(g).forEach(poly => poly.forEach(ring => { const pts = ring.filter((_, i) => i % step === 0 || i === ring.length - 1); d += pts.map((p, i) => (i ? 'L' : 'M') + tf.px(p).map(v => v.toFixed(1)).join(',')).join('') + 'Z'; }));
  return d;
}
async function loadGeo() {
  if (GEO) return; [GEO, SIDO] = await Promise.all([J('data/admin/kr_sgg.geojson'), J('data/admin/kr_sido.geojson')]);
  KR_TF = fitTf(SIDO.features.map(f => f.geometry), 70, 92, 3);
  KR_PATH = SIDO.features.map(f => pathOf(f.geometry, KR_TF, 4)).join('');
  GEO.features.forEach(f => { const r = byCode[f.properties.code]; if (r) r.g = f.geometry; });
  if (cur) show(cur, true); if (map) mapAddData();
}
const geoP = loadGeo();
function silhouette(r) {
  if (!r.g) return '<svg class="sil" viewBox="0 0 220 220"><text x="110" y="115" text-anchor="middle" font-size="12" fill="#9aa5b5">…</text></svg>';
  const tf = fitTf([r.g], 220, 220, 12);
  return `<svg class="sil" viewBox="0 0 220 220"><path class="${isLean(r) ? 'lean' : ''}" d="${pathOf(r.g, tf)}"/></svg>`;
}
function locSticker(r) {
  const c = r.i.lat != null ? KR_TF?.px([r.i.lon, r.i.lat]) : null;
  const me = r.g && KR_TF ? `<path class="me" d="${pathOf(r.g, KR_TF, 3)}"/>` : '';
  return `<svg viewBox="0 0 70 92"><path class="kr" d="${KR_PATH}"/>${me}${c ? `<circle class="ring" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="7"/>` : ''}</svg>`;
}

/* ── card ── */
const bar = (l, v, thr, fmt, opts = {}) => {
  const na = v == null; const w = na || !thr ? 0 : Math.min(v / (thr * 2), 1) * 100; const over = !na && thr != null && v >= thr;
  return `<div class="bar ${over ? 'over' : ''} ${na ? 'na' : ''}"><span class="l">${l}${thr != null ? `<small>${opts.tl || T('p25')} ${fmt(thr)}</small>` : ''}</span><span class="n ${over ? 'over' : ''}">${fmt(v)}</span><span class="t"><i style="--w:${w.toFixed(1)}%"></i>${thr != null ? '<em></em>' : ''}${!na && thr && v > thr * 2 ? '<b class="of">▸</b>' : ''}</span>${opts.ref ? `<span class="ref ${opts.refHit ? 'hit' : ''}">${opts.ref}</span>` : ''}</div>`;
};
function primaryWhy(s) {
  const m = s.metrics || {};
  if (s.lean) return T('why.lean', { top: tn(s.lean.type), r: Math.round(s.lean.r * 100), list: Object.entries(s.lean.cand || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${tn(k)} ${Math.round(v * 100)}%`).join(' · ') });
  if (s.primary === '물') return s.basis === 'zone' ? T('why.water.zone', { v: num(m.rzf, 1) }) : T('why.water', { v: pct(m.flood_r), t: pct(TH.flood_r) });
  if (s.primary === '산') return s.basis === 'zone' ? T('why.mt.zone') : T('why.mt', { v: pct(m.ls_r), s: num(m.slope, 1), t: pct(TH.ls_r), st: num(TH.slope80, 1) });
  if (s.primary === '바다') return T('why.sea') + (m.rzs ? T('why.sea.rz', { v: num(m.rzs, 1) }) : T('why.sea.p'));
  if (s.primary === '마름') return T('why.dry', { v: num(m.rzd, 1) });
  return '';
}
function leanFlag(s, cls = 'ty-flag lean') { return s.lean ? `<span class="${cls}" title="${esc(D(s.lean.deg === '근접' ? 'basis.lean' : 'basis.faint'))}">${T(s.lean.deg === '근접' ? 'd.lean' : 'd.faint')} ${Math.round(s.lean.r * 100)}%</span>` : ''; }
/* 방법 보기 상자 — 기준 사양 대비 이 사양에서의 타입 */
function specHtml(r) {
  const a = altOf(r); if (!a) return '';
  const k = specKey(), chg = specChanged(r);
  if (a.out) return `<div class="spec"><div class="k">${T('mb.card')} · ${esc(specLabel(k))}</div><div class="d">${T('mb.u227out')}</div></div>`;
  const tp = (p, lean) => p ? `${ICON[p] || ''} ${tn(p)}${lean ? ` (${lean === '근접' ? T('bs.lean') : T('bs.faint')})` : ''}` : T('b.none');
  const tr = arr => (arr || []).length ? arr.map(k => `${ICON[k] || ''}${tn(k)}`).join('·') : T('none');
  const base = r.s;
  return `<div class="spec ${chg ? 'chg' : ''}"><div class="k">${T('mb.card')} · ${esc(specLabel(k))}${a.m ? ` · ${T('mb.u230', { m: esc(a.mn || '') })}` : ''}</div>
    <div class="v"><b>${tp(a.p, a.lean)}</b><span class="tag ${chg ? 'on' : ''}">${chg ? T('mb.chg') : T('mb.same')}</span><small>${T('mb.base')}: ${tp(base.primary, base.lean && base.lean.deg)}</small></div>
    <div class="d">${T('tr.k').split(' ·')[0]}: ${tr(a.t)} <small>(${T('mb.base')}: ${tr(base.traits)})</small>${a.s !== (base.social || null) ? ` · ${T('b.soc')}: ${a.s ? tn(a.s) : T('b.none')} <small>(${T('mb.base')}: ${base.social ? tn(base.social) : T('b.none')})</small>` : ''}</div></div>`;
}
/* 국가 지원 문턱 상자 — "피해 X억부터 국고지원" + 선포 기준. 심사·판정 아님(규정상 규칙). */
function thrHtml(r) {
  const t = r.t; if (!TR || !t) return '';
  const rule = TR.meta.rule || {};
  if (t.band == null) {
    const why = t.fi_missing === 'gu' ? T('thr.na.gu') : t.fi_missing === 'jeju' ? T('thr.na.jeju') : T('thr.na');
    return `<div class="thr na"><div class="k">${T('thr.k')}</div><div class="v"><span class="big">${T('thr.range', { a: won(TR.meta.bands[0].sub), b: won(TR.meta.bands[4].sub) })}</span></div><div class="d">${esc(why)}</div></div>`;
  }
  const b = TR.meta.bands[t.band], unit = t.fi_unit === 'parent' ? ` · ${T('thr.unit.parent', { p: esc(t.parent || '') })}` : '';
  return `<div class="thr" style="--tc:${THR_COL[t.band]}"><div class="k">${T('thr.k')}</div>
    <div class="v"><span class="big">${T('thr.sub', { v: won(b.sub) })}</span><span class="ty-chip ty-t sm">${T('thr.fi', { v: t.fi3.toFixed(3), y: t.fi_years || '' })} · ${T('thr.b' + t.band)}</span></div>
    <div class="d">${T('thr.decl', { v: won(b.decl), e: won(b.emd) })}${unit}<br><small>${esc(rule.sub || '')}</small></div></div>`;
}
/* 기록된 결과 — 재해연보에 인쇄된 사실만. 예측 아님. */
function recHtml(r) {
  const t = r.t; if (!TR || !t) return '';
  const R = t.records || {}, sub = R.subsidy || [], dec = R.decl || [], w = R.woosim;
  const unit = t.rec_unit === 'parent' ? `<small class="muted">${T('rec.unit.parent', { p: esc(t.parent || '') })}</small>` : '';
  const li = (arr, f) => arr.map(f).join(' · ');
  const subS = sub.length ? `<div class="it has"><b>${T('rec.sub', { n: sub.length })}</b><small>${li(sub, x => `${x.y} ${esc(x.ev)} ${wonK(x.dmg_k)}`)}</small></div>` : `<div class="it"><b>${T('rec.sub', { n: 0 })}</b></div>`;
  const nS = dec.filter(x => !x.emd).length, nE = dec.length - nS;
  const decS = dec.length ? `<div class="it has"><b>${T('rec.decl', { n: dec.length })}</b><small>${nE ? T('rec.decl.mix', { s: nS, e: nE }) + ' · ' : ''}${li(dec, x => `${x.y} ${esc(x.ev)}${x.emd ? ` (${esc(x.emd)})` : ''}`)}</small></div>` : `<div class="it"><b>${T('rec.decl', { n: 0 })}</b></div>`;
  const wooS = w && w.n ? `<div class="it has"><b>${T('rec.woo', { n: w.n, v: wonK(w.dmg_k) })}</b><small>${Object.entries(w.years || {}).filter(([, [n]]) => n > 0).map(([y, [n, d]]) => `${y}: ${n}${T('rec.cnt')} ${wonK(d)}`).join(' · ')}</small></div>` : `<div class="it"><b>${T('rec.woo.none')}</b></div>`;
  return `<h3>${T('rec')} <small>${T('rec.s')}</small></h3>${unit}<div class="rec">${subS}${decS}${wooS}</div>`;
}
/* 대피 접근 층(docs/53·55 A4): 칸 단위 보행망 계산을 인구 가중으로 모은 값. 길 안내·예측 아님. 구를 둔 시는 시 전체(보고 단위 227) 값을 함께. */
function accHtml(r) {
  if (!AC) return '';
  const a = AC.sgg[r.code], h = `<h3>${T('acc')} <small>${T('acc.s')}</small></h3>`;
  if (!a) return h + `<div class="inst-sum">${T('acc.wait', { d: AC.meta.n_done, t: AC.meta.n_total })}</div>`;
  const p1 = v => v == null ? '—' : v.toFixed(1);
  const m = SP?.specs?.u230?.[r.code]?.m, c = m && AC.city[m];
  const city = c ? `<small class="muted">${T('acc.city', { c: esc(c.name), h: p1(c.hz), f: p1(c.far60) })}</small>` : '';
  return h + city + `<div class="rec"><div class="it ${a.hz ? 'has' : ''}"><b>${T('acc.hz', { v: p1(a.hz) })}</b><small>${T('acc.hz.s', { v: p1(a.hz_all) })}${a.alt > 0 ? ' · ' + T('acc.alt', { v: p1(a.alt) }) : ''}</small></div>`
    + `<div class="it ${a.far60 ? 'has' : ''}"><b>${T('acc.far', { v: p1(a.far60) })}</b><small>${T('acc.far.s', { v: p1(a.far30), m: a.med ?? '—' })}</small></div></div>`
    + `<small class="muted">${(a.snap ?? 0) >= 5 ? T('acc.snap', { v: p1(a.snap) }) + ' ' : ''}${T('acc.note')}</small>`;
}
const peerKey = s => `${s.primary}|${s.lean ? s.lean.deg : ''}|${s.kind || ''}`;
const degTxt = d => L === 'en' ? (d === '근접' ? 'near' : 'faint') : d;
function peerHtml(r) {
  const k = peerKey(r.s), ps = rows.filter(x => x.code !== r.code && peerKey(x.s) === k).sort((a, b) => nm(a).localeCompare(nm(b), L === 'en' ? 'en' : 'ko'));
  const sub = T('peer.s', { t: esc(tn(r.s.primary) + (r.s.lean ? ` (${degTxt(r.s.lean.deg)})` : '')), k: esc(r.s.kind || '') });
  if (!ps.length) return `<h3>${T('peer')} <small>${sub}</small></h3><div class="inst-sum">${T('peer.none')}</div>`;
  return `<details class="peers"${ps.length <= 12 ? ' open' : ''}><summary>${T('peer')} <small>${sub} · ${ps.length}</small></summary><div class="pl">${ps.map(x => `<button type="button" data-c="${x.code}">${esc(nm(x))}<small>${esc(sidoNm(x))}</small></button>`).join('')}</div><p class="fine">${T('peer.note')}</p></details>`;
}
/* D1 데이터 요청(10-14 사용자 결정): 공개 내려받기 대신 메일 신청 + 이용 동의서. 파일은 scripts/export_atlas_data.py로 운영자가 만든다 */
const DL_TO = 'ojh121523@gmail.com';
const dlMail = () => `mailto:${DL_TO}?subject=${encodeURIComponent(`[AidPage Atlas] 데이터 이용 신청 (${Ty.meta.version || ''})`)}&body=${encodeURIComponent('이름:\n소속:\n용도(연구·교육·행정 등):\n쓰려는 범위(필요한 열·지역):\n결과물 형태(논문·보고서 등):\n\n이용 동의서를 받은 뒤 파일을 보내 드립니다.')}`;
/* 막대 근거 한 줄(docs/61, 10-14): 공인 기준이 시군구 값에 바로 맞는 지표는 기준과 해당 여부, 법이 '지정·기록'만 정한 지표는 그 사실,
   기준이 없는 지표는 "공인 기준 없음 · 전국 값"을 쓴다. 출처는 짧게, 자세한 조문은 방법 보기/docs/61. */
const NAT = Ty.meta.nat || {};   // 전국 합산 비교값 — build_types.py가 같은 자료로 계산(meta.nat)
function refOf(k, m, s) {
  const pc = v => (v * 100).toFixed(1) + '%', en = L === 'en';
  switch (k) {
    case 'flood_r': return m.flood_r > 0 ? { t: en ? 'Flood traces on record <small>(Natural Disaster Countermeasures Act art. 21)</small>' : '침수흔적 기록 있음 <small>(자연재해대책법 제21조 침수흔적도)</small>', hit: 1 } : { t: en ? 'No flood trace on record — not the same as safe' : '침수흔적 기록 없음 — 안전하다는 뜻은 아님' };
    case 'ls_r': { const n = en ? ' · official hazard ratings score each slope on site, so no threshold for a municipal share' : ' · 법정 위험 판정은 사면마다 현장 점수라 시군구 비율 문턱은 없음'; return m.ls_r > 0 ? { t: (en ? 'Landslide on record' : '산사태 발생 기록 있음') + `<small>${n}</small>`, hit: 1 } : { t: (en ? 'No landslide on record — not the same as safe' : '산사태 발생 기록 없음 — 안전하다는 뜻은 아님') + `<small>${n}</small>` }; }
    case 'slope': return { t: en ? 'Statutory steep slope (34°+) is defined per slope face, not comparable to an average' : '법정 급경사지(34° 이상)는 비탈면 하나 기준이라 평균과 견주지 않음 <small>(급경사지법 시행령 제2조)</small>' };
    case 'rzf': { const n = (m.rz_flood || 0); return n ? { t: en ? `${n} designated flood-risk improvement zone(s) <small>(Natural Disaster Countermeasures Act art. 12; designated for recorded or expected damage; no density threshold)</small>` : `법정 침수위험지구 <b>${n}곳</b> 지정 <small>(자연재해대책법 제12조 · 기록 또는 예상 위험으로 지정, 밀도 문턱 없음)</small>`, hit: 1 } : { t: en ? 'No designated flood-risk zone' : '법정 침수위험지구 지정 없음' }; }
    case 'e65': { const v = m.e65; if (v == null) return null; const lv = v >= .2 ? (en ? 'super-aged (20%+)' : '초고령화사회(20% 이상)') : v >= .14 ? (en ? 'aged (14–20%)' : '고령사회(14~20%)') : (en ? 'ageing (7–14%)' : '고령화사회(7~14%)');
      return { t: (en ? 'Reference: ' : '기준: ') + `<b>${lv}</b> <small>(${en ? 'Statistics Korea SGIS; only 7% is the UN 1956 line' : '통계청 고령화 단계 기준 · UN 기준은 7%만'})</small>`, hit: v >= .2 }; }
    case 'foreign_r': { const v = m.foreign_r; if (v == null) return null; const cnt = Math.round(v * (m.pop || 0)), hit = v >= .05 || cnt >= 10000;
      return { t: (hit ? (en ? '<b>Meets</b> ' : '<b>해당</b> ') : (en ? 'Below ' : '미해당 ')) + (en ? 'the MOIS foreign-resident concentration area line (10,000+ or 5%+)' : '외국인주민 집중거주지역 기준(1만 명 이상 또는 5% 이상)') + ` <small>(${en ? 'MOIS 2025; includes naturalised citizens and their children' : '행정안전부 2025 · 귀화자·자녀 포함'})</small>`, hit }; }
    case 'dens': return { t: en ? 'OECD/EU urban centre is 1,500+/km² on a 1 km² grid — average shown for reference' : '참고: OECD·EU 도시 중심 1,500명/km²+는 1 km² 격자 기준(평균과 단위 다름) <small>(Eurostat 2021)</small>' };
    default: if (NAT[k] == null || m[k] == null) return null;
      { const x = m[k] / NAT[k], xr = x >= 0.95 && x <= 1.05 ? (en ? 'about the same as' : '비슷') : (en ? `${x.toFixed(1)}× ` : `의 ${x.toFixed(1)}배`);
        const nat = k === 'traffic_r' ? num(NAT[k], 1) + (en ? '/100k' : '명/10만') : pc(NAT[k]);
        const tail = k === 'traffic_r' ? (en ? ' <small>(serious = ≥3 weeks of treatment; differs from the international MAIS3+ definition)</small>' : ' <small>(중상 = 3주 이상 치료 진단 · 국제 기준과 다름)</small>') : '';
        return { t: en ? `No official threshold · ${xr.startsWith('about') ? xr + ' the national ' + nat : xr + 'the national ' + nat} (same data)${tail}` : `공인 기준 없음 · 전국 ${nat}${xr === '비슷' ? (k === 'traffic_r' ? '과 비슷' : '와 비슷') : xr}(같은 자료)${tail}` }; }
  }
}
const rb = (k, m, s) => { const r = refOf(k, m, s); return r ? { ref: r.t, refHit: r.hit } : {}; };
function card(r) {
  const s = r.s, m = r.m, o = r.o, tc = COL[s.primary] || COL.none;
  const hz = s.hazards && s.hazards.length ? `<div class="hz">${T('hz')} · ${s.hazards.map(h => `${ICON[h]} <b>${tn(h)} ${s.scores?.[h] != null ? s.scores[h].toFixed(2) : ''}</b>`).join(' · ')} <span title="${esc(T('hz.t'))}">ⓘ</span></div>` : '';
  const traits = (s.traits || []).length ? s.traits.map(k => `<div class="trait"><span class="ty-chip ty-t sm">${ICON[k]} ${tn(k)}</span><span>${esc(D(k))}</span></div>`).join('') : `<div class="trait"><span class="none">${T('tr.none')}</span></div>`;
  const instHtml = o ? `<div class="inst-sum">${T('inst.n', { n: o.n, o: o.n_ordin != null ? T('inst.o', { c: o.n_ordin }) : '', m: O.meta.thresholds?.n?.median ?? '—', sh: o.shared ? T('inst.sh') : '' })}</div><div class="inst">${Object.entries(INST).map(([k, [l, le, ic]]) => { const v = o.ord[k]; return `<div class="it ${v ? 'has' : ''}"><b>${ic} ${L === 'en' ? le : l}</b><small>${v ? T('inst.has') + String(v).replace(/^(\d{4})(\d{2}).*$/, '$1.$2') : T('inst.no')}</small></div>`; }).join('')}</div>` : `<div class="inst-sum">${T(/^50(110|130)$/.test(r.code) ? 'inst.jeju' : 'inst.none')}</div>`;
  return `<article class="sp" style="--tc:${tc}">
    <div class="sp-l">${silhouette(r)}
      <div class="sp-loc">${locSticker(r)}<div class="txt"><b>${esc(sidoNm(r))}</b>${esc(upperNm(s))}<br>${r.i.lat != null ? `${r.i.lat.toFixed(2)}N ${r.i.lon.toFixed(2)}E` : ''}</div></div>
      <div class="sp-code">${r.code} · ${esc(L === 'en' ? (r.i.name || '') : (r.i.name_en || ''))}</div>
    </div>
    <div class="sp-r">
      <div class="eyebrow"><span>${esc(sidoNm(r))}</span><span>${esc(upperNm(s))}</span><span>${esc(Ty.meta.version)}</span></div>
      <h2>${esc(nm(r))}<small>${esc(L === 'en' ? (r.i.name || '') : (r.i.name_en || ''))}</small></h2>
      <div class="sp-lab">${esc(s.label || '')}</div>
      ${specHtml(r)}
      <div class="types">
        <div class="tybox ${s.lean ? 'lean' : ''}" style="--tc:${tc}"><div class="k">${T('b.nat')}</div><div class="v"><span class="big"><i>${ICON[s.primary]}</i>${tn(s.primary)}</span>${leanFlag(s)}${s.bold ? `<span class="ty-flag bold" title="${esc(T('b.bold.t'))}">${T('b.bold')}</span>` : ''}${s.basis === 'zone' ? `<span class="ty-flag basis" title="${esc(D('basis.zone'))}">${T('b.zone')}</span>` : ''}${s.complex ? `<span class="ty-flag" title="${esc(D('complex'))}">${T('b.complex')}</span>` : ''}${s.edge && s.edge.length ? `<span class="ty-flag edge" title="${esc(T('b.edge.t', { l: s.edge.map(tn).join(', ') }))}">${T('b.edge', { n: s.edge.length })}</span>` : ''}</div><div class="d">${primaryWhy(s)}</div>${hz}</div>
        <div class="tybox" style="--tc:${s.social ? COL[s.social] : COL.none}"><div class="k">${T('b.soc')}</div><div class="v ${s.social ? '' : 'none'}"><span class="big">${s.social ? `<i>${ICON[s.social]}</i>${tn(s.social)}` : T('b.none')}</span></div><div class="d">${s.social ? T('why.soc', { v: num(m.traffic_r), k: s.kind, t: num(s.social_q?.traffic_r) }) : T('why.soc.no', { v: num(m.traffic_r), k: s.kind, t: num(s.social_q?.traffic_r) })}</div></div>
      </div>
      <div class="traits"><div class="k">${T('tr.k')}</div>${traits}</div>
      ${thrHtml(r)}
      <h3>${T('why')} <small>${T('why.s')}</small></h3>
      <div class="dxbars">
        <div class="grp">${T('g.nat')}</div>
        ${bar(T('m.flood'), m.flood_r, TH.flood_r, pct, rb('flood_r', m, s))}${bar(T('m.ls'), m.ls_r, TH.ls_r, pct, rb('ls_r', m, s))}${bar(T('m.slope'), m.slope, TH.slope80, v => v == null ? '—' : num(v, 1) + '°', { tl: T('p20'), ...rb('slope', m, s) })}${bar(T('m.rzf'), m.rzf, TH.rzf, v => v == null ? '—' : num(v, 1) + '/100km²', rb('rzf', m, s))}
        <div class="grp">${T('g.ppl')}</div>
        ${bar(T('m.e65'), m.e65, TH.e65, pct, rb('e65', m, s))}${bar(T('m.ealone'), m.ealone, TH.ealone, pct, rb('ealone', m, s))}${bar(T('m.single'), m.single, TH.single80, pct, { tl: T('p20'), ...rb('single', m, s) })}${bar(T('m.dens'), m.dens, TH.dens, v => v == null ? '—' : num(v) + '/km²', rb('dens', m, s))}${bar(T('m.foreign'), m.foreign_r, TH.foreign_r, pct, rb('foreign_r', m, s))}${bar(T('m.dis'), m.disabled_r, TH.disabled_r, pct, rb('disabled_r', m, s))}${bar(T('m.basic'), m.basic_r, TH.basic_r, pct, rb('basic_r', m, s))}
        <div class="grp">${T('g.soc', { k: esc(s.kind) })}</div>
        ${bar(T('m.traffic'), m.traffic_r, s.social_q?.traffic_r, v => num(v), rb('traffic_r', m, s))}<div class="bar na"><span class="l">${T('m.fire')}</span><span class="n">${T('wait')}</span><span class="t"><i></i></span></div>
      </div>
      <p class="refnote">${L === 'en' ? '"Top 25%" is a position in the national distribution, not a safety standard, and can shift when other places change. Each line under a bar cites the law, agency definition or national value it rests on; where none exists it says so.' : '"상위 25%"는 전국 분포 안의 위치일 뿐 안전 기준을 넘었다는 뜻이 아니며, 다른 지역 값이 바뀌면 달라질 수 있습니다. 막대 아래 줄은 법령·기관 정의·전국 값 중 근거가 있는 것을 밝히고, 없으면 없다고 씁니다.'}</p>
      <h3>${T('inst')} <small>${T('inst.s')}</small></h3>
      ${instHtml}
      ${recHtml(r)}
      ${accHtml(r)}
      ${peerHtml(r)}
      <div class="sp-nav" id="spNav"></div>
    </div>
  </article>
  <div class="sp-foot">${T('foot', { p: num(m.pop), s: esc(Object.values(Ty.meta.sources || {}).slice(0, 3).join(' / ')) })}</div>`;
}
let cur = null, curSido = null;
function show(code, keep = false) {
  const r = byCode[code]; if (!r) return; cur = code; curSido = null;
  if (!keep) $('#app').classList.remove('rail-open');
  inIntro = false; { const pl = $('#proLink'); if (pl) pl.classList.remove('is-cur'); }
  $('#book').innerHTML = card(r);
  const list = visible.length ? visible : rows; const i = list.findIndex(x => x.code === code);
  const prev = list[(i - 1 + list.length) % list.length], next = list[(i + 1) % list.length];
  $('#spNav').innerHTML = `<button type="button" class="nb prev" data-c="${prev.code}"><small>${T('prev')}</small>${ICON[prev.s.primary]} ${esc(nm(prev))}</button><button type="button" class="nb next" data-c="${next.code}"><small>${T('next')}</small>${ICON[next.s.primary]} ${esc(nm(next))}</button><div class="lk"><button type="button" id="toMap">${T('tomap')}</button><button type="button" id="saveImg">${T('save')}</button><a href="./#g?sgg=${r.code}&l=${L}">${T('site')}</a><a href="./#g?sgg=${r.code}&view=region&l=${L}">${T('region')}</a></div>`;
  $$('#spNav .nb').forEach(b => b.addEventListener('click', () => { show(b.dataset.c); $('#book').scrollTop = 0; }));
  $('#toMap').addEventListener('click', () => { setView('map'); focusMap(code); });
  $('#saveImg').addEventListener('click', () => exportCard(r));
  $$('#book .peers button[data-c]').forEach(b => b.addEventListener('click', () => { show(b.dataset.c); $('#book').scrollTop = 0; }));
  $$('#toc li').forEach(li => li.classList.toggle('is-cur', li.dataset.c === code)); $$('#toc .ch > button').forEach(b => b.classList.remove('is-cur'));
  if (!keep) { $(`#toc li[data-c="${code}"]`)?.scrollIntoView({ block: 'nearest' }); $('#book').scrollTop = 0; markSeen(code); history.replaceState(null, '', '#c=' + code); }
  if (map && view === 'map') focusMap(code);
}
let inIntro = false;
function showIntro() {
  cur = null; curSido = null; inIntro = true; $('#app').classList.remove('rail-open'); setView('book');
  const bands = (TR && TR.meta && TR.meta.bands) || [], nF = (TR && TR.meta && TR.meta.n_fiscal) || '—';
  const band = b => `<span><b>${L === 'en' ? '₩' + (b.sub / 10).toFixed(1) + 'B' : b.sub + T('pro.thr.u')}</b>${T('pro.thr.fi')} ${b.lo}${b.hi == null ? '+' : '~' + b.hi}</span>`;
  $('#book').innerHTML = `<div class="cov pro"><div class="eyebrow"><span>${T('pro.eye')}</span><span>AidPage Atlas ${esc(Ty.meta.version || '')}</span></div>
    <h2>${T('pro.h')}</h2><p class="pro-lead">${T('pro.lead', { n: SP?.meta?.n_units_227 || 227, m: rows.length, c: SP?.meta?.n_cities_merged || 13, g: SP ? Object.values(SP.specs.u230 || {}).filter(a => a.m).length : 39 })}</p>
    <h3>${T('pro.h1')}</h3><p>${T('pro.p1a')}</p><p>${T('pro.p1b')}</p>${bands.length ? `<div class="thr">${bands.map(band).join('')}</div><p class="fine">${T('pro.thr.note')}</p>` : ''}
    <div class="q">${T('pro.q')}</div>
    <h3>${T('pro.h2')}</h3><ol><li>${T('pro.l1')}</li><li>${T('pro.l2')}</li><li>${T('pro.l3')}</li><li>${T('pro.l4')}</li></ol>
    <h3>${T('pro.h3')}</h3><ul><li>${T('pro.n1')}</li><li>${T('pro.n2')}</li><li>${T('pro.n3')}</li><li>${T('pro.n4', { f: nF, n: rows.length })}</li></ul>
    <h3>${T('pro.h4')}</h3><p>${T('pro.p4a')}</p><p>${T('pro.p4b')}</p>
    <h3>${T('pro.h5')}</h3><ul><li>${T('pro.r1')}</li><li>${T('pro.r2')}</li><li>${T('pro.r3')}</li></ul>
    <h3>${T('dl.h')}</h3><p>${T('dl.p', { v: esc(Ty.meta.version || '') })}</p><div class="go"><a class="mailbtn" href="${dlMail()}">${T('dl.mail')}</a></div>
    <div class="go"><button type="button" class="pri" id="proGo1">${T('pro.go1')}</button><button type="button" id="proGo2">${T('pro.go2')}</button><button type="button" id="proGo3">${T('pro.go3')}</button></div></div>`;
  $('#proGo1').addEventListener('click', () => showCover(sidos[0].code)); $('#proGo2').addEventListener('click', random); $('#proGo3').addEventListener('click', () => setView('map'));
  $$('#toc li').forEach(li => li.classList.remove('is-cur')); $$('#toc .ch > button').forEach(b => b.classList.remove('is-cur')); const pl = $('#proLink'); if (pl) pl.classList.add('is-cur');
  $('#book').scrollTop = 0; history.replaceState(null, '', '#p=intro');
}
function showCover(sc) {
  const c = sidos.find(x => x.code === sc); if (!c) return; cur = null; curSido = sc; inIntro = false; { const pl = $('#proLink'); if (pl) pl.classList.remove('is-cur'); } $('#app').classList.remove('rail-open');
  const sd = SD && SD.sido ? SD.sido[sc] : null;
  const light = h => { const p = i => parseInt(h.slice(i, i + 2), 16); return '#' + [1, 3, 5].map(i => Math.round(p(i) + (255 - p(i)) * .55).toString(16).padStart(2, '0')).join(''); };
  const split = k => { const base = k.replace(/\(.*\)$/, ''), deg = (/\((.+)\)$/.exec(k) || [])[1]; return { base, deg }; };
  const lab = k => { const { base, deg } = split(k); return k === '—' ? T('none') : tn(base) + (deg ? ' ' + T(deg === '근접' ? 'd.lean' : 'd.faint') : ''); };
  const stack = (obj, labk, colOf) => { const ents = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]); return `<div class="stk"><div class="k">${T(labk)}</div><div class="bar2">${ents.map(([k, v]) => { const { base, deg } = split(k); const col = colOf(k); return `<span style="flex:${v};--c:${col}" class="${col === COL.none || deg ? 'lt' : ''}" title="${esc(lab(k))} ${v}%">${v >= 9 ? `${ICON[base] || ''} ${lab(k)} ${Math.round(v)}%` : ''}</span>`; }).join('')}</div><div class="lg">${ents.map(([k, v]) => `<span><i style="--c:${colOf(k)}"></i>${ICON[split(k).base] || ''} ${lab(k)} ${v}%</span>`).join('')}</div></div>`; };
  const primCol = k => { const { base, deg } = split(k); return deg ? light(COL[base] || '#888') : (COL[base] || COL.none); };
  const goldRamp = ['#9a7328', '#b58f4a', '#c9a86e', '#d9c194', '#e8d8b8', '#f0e6d2', '#f6f0e4'];
  const secCol = (() => { let i = 0; const m = {}; return k => k === '—' ? COL.none : (m[k] ??= goldRamp[Math.min(i++, goldRamp.length - 1)]); })();
  $('#book').innerHTML = `<div class="cov"><div class="eyebrow"><span>${T('ch')}</span><span>${T('chn', { n: c.rows.length })}</span></div><h2>${esc(c.name)}</h2>
    <div class="stat"><div><b>${c.rows.length}</b>${T('sgg')}</div>${sd ? `<div><b>${num(sd.pop)}</b>${T('pop')}</div>` : ''}<div><b>${c.rows.filter(r => seen.has(r.code)).length}/${c.rows.length}</b>${T('seenn')}</div></div>
    ${sd ? stack(sd.primary_pct, 'st.prim', primCol) + stack(sd.social_pct, 'st.soc', k => k === '—' ? COL.none : COL[k]) + stack(sd.secondary_pct, 'st.sec', secCol) : `<p class="fine">${T('nodist')}</p>`}
    <p class="fine" style="margin:12px 0 0">${T('cov.note')}</p>
    <div class="dxcards">${c.rows.map(r => `<button type="button" class="${isLean(r) ? 'lean' : ''}" data-c="${r.code}" style="--c:${COL[r.s.primary]}"><i></i>${ICON[r.s.primary]} ${esc(nm(r))}${r.s.social ? ' ' + ICON[r.s.social] : ''}</button>`).join('')}</div>
    ${SD && SD.meta && SD.meta.caveats && L === 'ko' ? `<div class="cav">${SD.meta.caveats.map(x => '· ' + esc(x)).join('<br>')}</div>` : ''}</div>`;
  $$('#book .dxcards button').forEach(b => b.addEventListener('click', () => show(b.dataset.c)));
  $$('#toc li').forEach(li => li.classList.remove('is-cur')); $$('#toc .ch > button').forEach(b => b.classList.toggle('is-cur', b.parentElement.dataset.s === sc));
  $('#book').scrollTop = 0; history.replaceState(null, '', '#s=' + sc);
}
function random() { const list = visible.length ? visible : rows; const pool = list.filter(r => !seen.has(r.code)); const src = pool.length ? pool : list; show(src[Math.floor(Math.random() * src.length)].code); }
$('#rnd').addEventListener('click', random);

/* ── card image export (canvas, no library) ── */
async function exportCard(r) {
  const s = r.s, m = r.m, W = 1080, H = 1350, cv = $('#cv'), x = cv.getContext('2d'); cv.width = W; cv.height = H;
  try { await document.fonts.load('700 60px GyeonggiTitle'); await document.fonts.load('500 30px GyeonggiTitle'); } catch { }
  const FD = w => `${w} GyeonggiTitle, Pretendard, "Malgun Gothic", sans-serif`, FB = w => `${w} Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI Emoji", sans-serif`, MONO = w => `${w} "DM Mono", Menlo, monospace`;
  const tc = COL[s.primary] || COL.none, ink = '#14202e', mute = '#566577', line = '#dbe3ee';
  x.fillStyle = '#f7f9fc'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.beginPath(); x.roundRect(40, 40, W - 80, H - 80, 36); x.fill(); x.strokeStyle = line; x.lineWidth = 2; x.stroke();
  x.fillStyle = tc; x.fillRect(40, 40, W - 80, 14);
  x.fillStyle = mute; x.font = MONO('24px'); x.fillText(`${sidoNm(r)} · ${upperNm(s)} · ${r.code}`, 80, 120);
  x.fillStyle = ink; x.font = FD('700 84px'); x.fillText(nm(r), 80, 205);
  x.fillStyle = mute; x.font = MONO('26px'); x.fillText(L === 'en' ? (r.i.name || '') : (r.i.name_en || ''), 80, 245);
  if (r.g) { const tf = fitTf([r.g], 300, 300, 10); const p = new Path2D(pathOf(r.g, tf)); x.save(); x.translate(700, 90); x.fillStyle = tc; if (s.lean) { x.globalAlpha = .3; x.fill(p); x.globalAlpha = 1; x.setLineDash([8, 5]); x.strokeStyle = tc; x.lineWidth = 3; x.stroke(p); } else { x.shadowColor = 'rgba(20,32,46,.2)'; x.shadowBlur = 24; x.shadowOffsetY = 10; x.fill(p); } x.restore(); }
  let y = 330; x.font = FB('600 40px'); x.fillStyle = ink;
  const typeLine = `${ICON[s.primary]} ${tn(s.primary)}${s.lean ? ` (${T(s.lean.deg === '근접' ? 'd.lean' : 'd.faint')} ${Math.round(s.lean.r * 100)}%)` : ''}${s.bold ? ` · ${T('b.bold')}` : ''}${s.complex ? ` · ${T('b.complex')}` : ''}   ${s.social ? `${ICON[s.social]} ${tn(s.social)}` : ''}`;
  x.fillText(typeLine, 80, y); y += 44;
  x.font = FB('500 28px'); x.fillStyle = mute; const wrap = (txt, maxW) => { const out = []; let cur = ''; for (const ch of txt) { if (x.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; } else cur += ch; } if (cur) out.push(cur); return out; };
  for (const ln of wrap(primaryWhy(s), W - 160).slice(0, 3)) { x.fillText(ln, 80, y); y += 36; }
  y += 10; x.font = FB('500 30px'); x.fillStyle = ink; x.fillText(`${T('tr.k').split(' ·')[0]}: ${(s.traits || []).length ? s.traits.map(k => `${ICON[k]} ${tn(k)}`).join('  ') : '—'}`, 80, y); y += 50;
  const rowsB = [[T('m.flood'), m.flood_r, TH.flood_r, pct], [T('m.ls'), m.ls_r, TH.ls_r, pct], [T('m.slope'), m.slope, TH.slope80, v => num(v, 1) + '°'], [T('m.e65'), m.e65, TH.e65, pct], [T('m.ealone'), m.ealone, TH.ealone, pct], [T('m.single'), m.single, TH.single80, pct], [T('m.dens'), m.dens, TH.dens, v => num(v) + '/km²'], [T('m.traffic'), m.traffic_r, s.social_q?.traffic_r, v => num(v)]];
  x.font = MONO('22px'); x.fillStyle = mute; x.fillText(T('why') + ' · ' + T('why.s').split(' ·')[0], 80, y); y += 30;
  for (const [l, v, thr, f] of rowsB) {
    const over = v != null && thr != null && v >= thr; const w = v == null || !thr ? 0 : Math.min(v / (thr * 2), 1);
    x.font = FB('500 26px'); x.fillStyle = mute; x.fillText(l, 80, y + 22); x.font = MONO('26px'); x.fillStyle = over ? '#0f4a9e' : ink; x.textAlign = 'right'; x.fillText(v == null ? '—' : f(v), W - 80, y + 22); x.textAlign = 'left';
    x.fillStyle = '#eef2f8'; x.beginPath(); x.roundRect(80, y + 34, W - 160, 12, 6); x.fill(); if (w > 0) { x.fillStyle = over ? '#1a5fc4' : '#c7d3e6'; x.beginPath(); x.roundRect(80, y + 34, (W - 160) * w, 12, 6); x.fill(); } x.fillStyle = '#9a7328'; x.fillRect(80 + (W - 160) / 2 - 1, y + 30, 3, 20);
    y += 66;
  }
  if (r.o) { y += 6; x.font = FB('500 26px'); x.fillStyle = ink; x.fillText(`${T('inst')}: ${r.o.n} · ${INST_MAIN.filter(k => r.o.ord[k]).map(k => INST[k][2] + ' ' + INST[k][L === 'en' ? 1 : 0]).join(' · ') || T('inst.no')}`, 80, y); y += 40; }
  x.font = MONO('20px'); x.fillStyle = mute; x.fillText(T('cv.rule', { v: Ty.meta.version }), 80, H - 90); x.fillText(T('cv.src'), 80, H - 60);
  cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `aidpage_dex_${r.i.name_en || r.code}.png`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }, 'image/png');
}

/* ── map ── */
let map = null, view = 'book', mode = 'prim', modeArg = null, hoverCode = null;
function setView(v) {
  view = v; $$('#viewSeg button').forEach(b => b.classList.toggle('is-on', b.dataset.view === v));
  $('#book').hidden = v !== 'book'; $('#mapWrap').hidden = v !== 'map';
  if (v === 'map') { initMap(); requestAnimationFrame(() => map && map.resize()); if (cur) focusMap(cur); }
}
$$('#viewSeg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
function initMap() {
  if (map) return;
  map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', bounds: [[124.6, 33.0], [131.9, 38.7]], fitBoundsOptions: { padding: 30 }, attributionControl: { compact: true }, maxZoom: 12, minZoom: 5 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('load', () => { geoP.then(mapAddData); });
}
function mapAddData() {
  if (!map || !GEO || map.getSource('sgg') || !map.isStyleLoaded()) { if (map && GEO && !map.getSource('sgg')) map.once('idle', mapAddData); return; }
  map.addSource('sgg', { type: 'geojson', data: GEO, promoteId: 'code' });
  map.addSource('sido', { type: 'geojson', data: SIDO });
  const before = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  map.addLayer({ id: 'sgg-fill', type: 'fill', source: 'sgg', paint: { 'fill-color': '#ccc', 'fill-opacity': 0.55 } }, before);
  map.addLayer({ id: 'sgg-line', type: 'line', source: 'sgg', paint: { 'line-color': '#fff', 'line-width': 0.6, 'line-opacity': 0.8 } }, before);
  map.addLayer({ id: 'sido-line', type: 'line', source: 'sido', paint: { 'line-color': '#14202e', 'line-width': 1, 'line-opacity': 0.35 } }, before);
  map.addLayer({ id: 'sgg-hover', type: 'line', source: 'sgg', paint: { 'line-color': '#14202e', 'line-width': 2 }, filter: ['==', ['get', 'code'], '__none__'] }, before);
  map.addLayer({ id: 'sgg-sel', type: 'line', source: 'sgg', paint: { 'line-color': '#1a5fc4', 'line-width': 3 }, filter: ['==', ['get', 'code'], '__none__'] }, before);
  map.addLayer({ id: 'sgg-label', type: 'symbol', source: 'sgg', minzoom: 7, layout: { 'text-field': ['get', L === 'en' ? 'name_en' : 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 10, 14], 'text-allow-overlap': false, 'text-padding': 4 }, paint: { 'text-color': '#14202e', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.4 } });
  const pop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  map.on('mousemove', 'sgg-fill', e => { const f = e.features[0]; const r = byCode[f.properties.code]; if (!r) return; map.getCanvas().style.cursor = 'pointer'; if (hoverCode !== r.code) { hoverCode = r.code; map.setFilter('sgg-hover', ['==', ['get', 'code'], r.code]); } pop.setLngLat(e.lngLat).setHTML(`<b>${esc(nm(r))}</b> <span style="color:#566577">${esc(sidoNm(r)).slice(0, L === 'en' ? 12 : 2)}</span><br>${ICON[r.s.primary]} ${tn(r.s.primary)}${r.s.lean ? ` (${T(r.s.lean.deg === '근접' ? 'd.lean' : 'd.faint')} ${Math.round(r.s.lean.r * 100)}%)` : ''}${r.s.social ? ` · ${ICON[r.s.social]} ${tn(r.s.social)}` : ''}${(r.s.traits || []).length ? `<br><span style="color:#9a7328">${r.s.traits.map(t => ICON[t] + tn(t)).join(' ')}</span>` : ''}`).addTo(map); });
  map.on('mouseleave', 'sgg-fill', () => { map.getCanvas().style.cursor = ''; hoverCode = null; map.setFilter('sgg-hover', ['==', ['get', 'code'], '__none__']); pop.remove(); });
  map.on('click', 'sgg-fill', e => { const r = byCode[e.features[0].properties.code]; if (r) { cur = r.code; markSeen(r.code); $$('#toc li').forEach(li => li.classList.toggle('is-cur', li.dataset.c === r.code)); focusMap(r.code, true); history.replaceState(null, '', '#m=' + r.code); } });
  paintMap(); if (cur) focusMap(cur);
}
function colorExpr() {
  const vis = new Set(visible.map(r => r.code));
  const pairs = [], op = [];
  rows.forEach(r => { let c = COL.none; if (mode === 'prim') c = COL[effP(r)] || COL.none; else if (mode === 'soc') c = r.s.social ? COL[r.s.social] : COL.none; else if (mode === 'trait') c = modeArg && (r.s.traits || []).includes(modeArg) ? COL.trait : COL.none; else if (mode === 'inst') c = modeArg && r.o && r.o.ord[modeArg] ? COL.inst : COL.none; else if (mode === 'thr') c = r.t && r.t.band != null ? THR_COL[r.t.band] : COL.none; else if (mode === 'acc') { const k = accKey(r); c = k === 'na' ? COL.none : ACC_COL[+k]; } pairs.push(r.code, c); op.push(r.code, vis.has(r.code) ? (mode === 'prim' && effLean(r) ? 0.25 : 0.6) : 0.06); });
  return { color: ['match', ['get', 'code'], ...pairs, COL.none], op: ['match', ['get', 'code'], ...op, 0.05] };
}
function paintMap() {
  if (!map || !map.getLayer('sgg-fill')) return; const e = colorExpr(); map.setPaintProperty('sgg-fill', 'fill-color', e.color); map.setPaintProperty('sgg-fill', 'fill-opacity', e.op);
  if (map.getLayer('sgg-label')) map.setLayoutProperty('sgg-label', 'text-field', ['get', L === 'en' ? 'name_en' : 'name']);
  const vis = visible, cnt = fn => { const c = {}; vis.forEach(r => { const k = fn(r); if (k) c[k] = (c[k] || 0) + 1; }); return c; };
  let lg = '';
  if (mode === 'prim') { const c = cnt(r => effLean(r) ? null : effP(r)), nl = vis.filter(effLean).length, nc = specKey() ? vis.filter(specChanged).length : 0; lg = ['물', '산', '바다', '마름'].map(k => `<span><i style="--c:${COL[k]}"></i>${ICON[k]} ${tn(k)}<span class="n">${c[k] || 0}</span></span>`).join('') + `<span><i class="lean" style="--c:${COL['산']}"></i>${T('lg.lean')}<span class="n">${nl}</span></span>` + (specKey() ? `<span>▲ ${T('lg.chg')} · ${esc(specLabel(specKey()))}<span class="n">${nc}</span></span>` : ''); }
  else if (mode === 'soc') { const c = cnt(r => r.s.social || '—'); lg = `<span><i style="--c:${COL['교통']}"></i>🚗 ${tn('교통')}<span class="n">${c['교통'] || 0}</span></span><span><i style="--c:${COL.none}"></i>${T('b.none')}<span class="n">${c['—'] || 0}</span></span>`; }
  else if (mode === 'trait') { const n = modeArg ? vis.filter(r => (r.s.traits || []).includes(modeArg)).length : 0; lg = `<span><i style="--c:${COL.trait}"></i>${ICON[modeArg] || ''} ${modeArg ? tn(modeArg) : T('lg.pick.trait')}<span class="n">${n}</span></span><span><i style="--c:${COL.none}"></i>${T('b.none')}<span class="n">${vis.length - n}</span></span>`; }
  else if (mode === 'thr') { const c = cnt(thrKey); lg = ['0', '1', '2', '3', '4'].map(k => `<span><i style="--c:${THR_COL[+k]}"></i>${T('thr.b' + k)}<span class="n">${c[k] || 0}</span></span>`).join('') + `<span><i style="--c:${COL.none}"></i>${T('thr.na.s')}<span class="n">${c.na || 0}</span></span>`; }
  else if (mode === 'acc') { const c = cnt(accKey), lb = ['0~5%', '5~15%', '15~30%', '30%+']; lg = lb.map((l, k) => `<span><i style="--c:${ACC_COL[k]}"></i>${l}<span class="n">${c[k] || 0}</span></span>`).join('') + `<span><i style="--c:${COL.none}"></i>${T('acc.na')}<span class="n">${c.na || 0}</span></span>`; }
  else { const n = modeArg ? vis.filter(r => r.o && r.o.ord[modeArg]).length : 0; lg = `<span><i style="--c:${COL.inst}"></i>${modeArg ? INST[modeArg][2] + ' ' + INST[modeArg][L === 'en' ? 1 : 0] + T('lg.has') : T('lg.pick.inst')}<span class="n">${n}</span></span><span><i style="--c:${COL.none}"></i>${T('none')}<span class="n">${vis.length - n}</span></span>`; }
  $('#legend').innerHTML = lg;
}
$$('#modeSeg button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.m; $$('#modeSeg button').forEach(x => x.classList.toggle('is-on', x === b));
  const sel = $('#modeSel');
  if (mode === 'trait') { sel.hidden = false; sel.innerHTML = TRAITS.map(k => `<option value="${k}">${ICON[k]} ${tn(k)} — ${esc(D(k))}</option>`).join(''); modeArg = sel.value; }
  else if (mode === 'inst') { sel.hidden = false; sel.innerHTML = Object.entries(INST).map(([k, [l, le, ic]]) => `<option value="${k}">${ic} ${L === 'en' ? le : l}</option>`).join(''); modeArg = sel.value; }
  else if (mode === 'acc') { sel.hidden = false; sel.innerHTML = ['hz', 'far60'].map(k => `<option value="${k}">${T('acc.m.' + k)}</option>`).join(''); modeArg = sel.value; }
  else { sel.hidden = true; modeArg = null; }
  paintMap();
}));
$('#modeSel').addEventListener('change', e => { modeArg = e.target.value; paintMap(); });
function focusMap(code, quiet = false) {
  const r = byCode[code]; if (!map || !r) return;
  if (map.getLayer('sgg-sel')) map.setFilter('sgg-sel', ['==', ['get', 'code'], code]);
  if (r.i.lat != null && !quiet) map.flyTo({ center: [r.i.lon, r.i.lat], zoom: Math.max(map.getZoom(), 8.5), duration: 900 });
  const c = $('#mpCard'); c.hidden = false;
  c.innerHTML = `<button class="x" id="mpX" aria-label="닫기">✕</button><h4>${ICON[r.s.primary]} ${esc(nm(r))}<small>${esc(sidoNm(r))}</small></h4>
    <div class="ty-pair"><span class="ty-chip ty-p${r.s.bold ? ' bold' : ''}${r.s.lean ? ' lean' : ''}">${ICON[r.s.primary]} ${tn(r.s.primary)}</span>${leanFlag(r.s)}${r.s.basis === 'zone' ? `<span class="ty-flag basis">${T('b.zone')}</span>` : ''}${r.s.complex ? `<span class="ty-flag">${T('b.complex')}</span>` : ''}<i class="ty-dot">·</i>${r.s.social ? `<span class="ty-chip ty-s2">${ICON[r.s.social]} ${tn(r.s.social)}</span>` : '<span class="ty-chip ty-s2 none">—</span>'}</div>
    <div class="tr">${(r.s.traits || []).map(k => `<span class="ty-chip ty-t sm">${ICON[k]} ${tn(k)}</span>`).join('') || `<span class="ty-chip ty-t sm none">${T('tr.none').split(' —')[0]}</span>`}</div>
    ${r.o ? `<div class="fine">${T('card.law', { n: r.o.n })}${INST_MAIN.filter(k => r.o.ord[k]).map(k => INST[k][2]).join(' ') || T('inst.no')}</div>` : ''}
    <div class="go"><button type="button" id="mpOpen">${T('card.open')}</button><a href="./#g?sgg=${r.code}&view=region&l=${L}">${T('region')}</a></div>`;
  $('#mpX').addEventListener('click', () => { c.hidden = true; map.setFilter('sgg-sel', ['==', ['get', 'code'], '__none__']); });
  $('#mpOpen').addEventListener('click', () => { setView('book'); show(r.code); });
}

/* ── dict, rail, keys, lang, hash ── */
function buildDict() {
  $('#dictT').innerHTML = ['물', '산', '바다', '마름', '교통', '화재', ...TRAITS].map(k => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${COL[k] || COL.trait};margin-right:6px;vertical-align:-1px"></span>${ICON[k]} ${tn(k)}</td><td>${esc(D(k))}</td></tr>`).join('')
    + `<tr><td>${T('d.lean')}</td><td>${esc(D('basis.lean'))}</td></tr><tr><td>${T('d.faint')}</td><td>${esc(D('basis.faint'))}</td></tr><tr><td>${T('d.bold')}</td><td>${T('d.bold.d')}</td></tr><tr><td>${T('d.zone')}</td><td>${esc(D('basis.zone'))}</td></tr><tr><td>${T('d.complex')}</td><td>${esc(D('complex'))}</td></tr><tr><td>${T('d.edge')}</td><td>${esc(D('edge'))}</td></tr>`;
  $('#dictFoot').innerHTML = T('dict.foot');
}
$('#unitBtn').addEventListener('click', () => { $('#unitBody').innerHTML = T('unit.body'); $('#unitDlg').showModal(); }); $('#unitX').addEventListener('click', () => $('#unitDlg').close());
$('#dictBtn').addEventListener('click', () => $('#dict').showModal()); $('#dictX').addEventListener('click', () => $('#dict').close());
/* 목록 여닫기: 폰은 덮개(rail-open), 넓은 화면은 접기(rail-closed, 이 브라우저에 기억) */
const MOB = matchMedia('(max-width:760px)');
try { if (localStorage.getItem('atlas.railClosed') === '1') $('#app').classList.add('rail-closed'); } catch {}
$('#railBtn').addEventListener('click', () => {
  if (MOB.matches) { $('#app').classList.toggle('rail-open'); return; }
  const c = $('#app').classList.toggle('rail-closed');
  try { localStorage.setItem('atlas.railClosed', c ? '1' : '0'); } catch {}
  requestAnimationFrame(() => map && map.resize());
});
function applySpec() {
  const k = specKey(), n = k ? rows.filter(specChanged).length : 0;
  $('#nSpec').textContent = k ? `${n}` : '';
  $('#chipChg').hidden = !k; if (!k && F.flag.has('chg')) { F.flag.delete('chg'); $('#chipChg').classList.remove('is-on'); }
  $('#specNote').innerHTML = !SP ? T('mb.nodata') : k ? T('mb.note', { n, t: rows.length, s: esc(specLabel(k)) }) + (spec.u !== '256' && spec.q !== 'p75' ? ' ' + T('mb.u230only') : '') : T('mb.base.note');
  $$('#toc li').forEach(li => { const r = byCode[li.dataset.c]; li.classList.toggle('chg', !!r && specChanged(r)); });
  applyFilters(); if (cur) show(cur, true); if (map) paintMap();
}
const specLabel = k => L === 'en' ? ({ p70: 'p70/p75', p75: 'p75/p80 (baseline)', p80: 'p80/p85', p7575: 'p75/p75 (slope & single-person p75)', u230: '230 units (13 multi-district cities merged)', u227: '227 units (reporting unit: 230 minus Sejong and Jeju’s 2 administrative cities)' })[k] : (SP && SP.meta.specs[k]) || k;
$('#specQ').addEventListener('change', e => { spec.q = e.target.value; applySpec(); });
$('#specU').addEventListener('change', e => { spec.u = e.target.value; applySpec(); });
function rebuild() {
  applyUI(); sortRows(); buildSidos(); buildFilters(); buildToc(); buildDict(); paintProg();
  $('#ver').textContent = T('ver', { v: Ty.meta.version, n: rows.length });
  applyFilters();
  if (cur) show(cur, true); else if (curSido) showCover(curSido); else if (inIntro) showIntro();
  if (SP) applySpec(); else $('#methodBox').hidden = true;
}
$('#langBtn').addEventListener('click', () => { L = L === 'en' ? 'ko' : 'en'; try { localStorage.setItem('aidpage-dex-lang', L); } catch { } for (const k in F) F[k].clear(); rebuild(); if (map) { const sel = $('#modeSel'); if (!sel.hidden) $('#modeSeg button.is-on').click(); paintMap(); if (cur) focusMap(cur, true); } });
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea') || $('#dict').open) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const list = visible.length ? visible : rows; const i = cur ? list.findIndex(x => x.code === cur) : -1; const n = list[((i < 0 ? 0 : i) + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; if (n) { if (view === 'map') { cur = n.code; focusMap(n.code); } else show(n.code); } }
  else if (e.key === 'r' || e.key === 'R') random(); else if (e.key === 'm' || e.key === 'M') setView(view === 'map' ? 'book' : 'map');
});
rebuild();
const hc = HP.get('c'), hs = HP.get('s'), hm = HP.get('m');
if (hc && byCode[hc]) show(hc);
else if (hs && sidos.find(x => x.code === hs)) showCover(hs);
else if (hm && byCode[hm]) { cur = hm; setView('map'); }
else showIntro();
