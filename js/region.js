/* AidPage — "이 지역은" 서랍 (오른쪽, 데스크톱 전용 1단계). docs/08·10·14 설계.
   역할 분리: 왼쪽 패널 = 지금(특보·대피소·할 일), 이 서랍 = 이 지역은(구조·이력·시설 총량·지원 미리보기).
   한 항목 한 집: 특보는 태그 1개만, 가까운 대피소는 총량 행만. 순위 숫자 없음, 사분위 띠까지만.
   lazy import — 평소 0바이트. app.js가 open(ctx) 호출 시 ctx로 상태·도우미를 넘긴다(전역 import 없음). */
let ctx = null, root = null, topic = 'all', _types = null, _demo = null, _rz = null, _sidoDis = null, _welfare = null, _welfareEn = null;
const J = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
const load = async () => {
  [_types, _demo, _rz, _sidoDis] = await Promise.all([_types || J('data/ref/sgg_types.json'), _demo || J('data/ref/sgg_demo.json'), _rz || J('data/ref/riskzone_by_sgg.json'), _sidoDis || J('data/ref/sido_disaster.json')]);
};
const TYPE_ICON = { '물': '💧', '산': '⛰️', '바다': '🌊', '눈': '❄️', '볕': '☀️', '땅': '🪨', '마름': '🏜️', '평온': '◌', '노년': '🧓', '홀로': '🧍', '이방': '🌐', '돌봄': '♿', '살림': '🏚️', '도심': '🏙️', '들': '🌾', '섬': '🏝️', '접경': '🪖' };
const TYPE_EN = { '물': 'Water', '산': 'Mountain', '바다': 'Sea', '눈': 'Snow', '볕': 'Heat', '땅': 'Quake', '마름': 'Drought', '평온': 'Calm', '노년': 'Elderly', '홀로': 'Solo', '이방': 'Migrant', '돌봄': 'Care', '살림': 'Low-income', '도심': 'Urban', '들': 'Rural', '섬': 'Island', '접경': 'Border' };
const tn = k => ctx.getLang() === 'en' ? (TYPE_EN[k] || k) : k;
const pct = v => (v * 100).toFixed(1) + '%';
const fmtN = n => Number(n || 0).toLocaleString(ctx.getLang() === 'en' ? 'en-US' : 'ko-KR');
const esc = s => ctx.escapeHTML(s);

export function typeOf(sgg) { return _types && _types.sgg ? _types.sgg[String(sgg)] : null; }
export function typesLoaded() { return !!_types; }
export async function ensureTypes() { if (!_types) _types = await J('data/ref/sgg_types.json'); return _types; }

/* 타입 칩 HTML — 요약 줄(패널)과 서랍 헤더가 공유. 서열 없음: 굵게=노출 상위 25%, [복합]=위해 2종 이상 */
export function typeChips(ty, small) {
  if (!ty) return '';
  const t = ctx.t;
  const chip = (k, cls) => `<span class="ty-chip ${cls} ${small ? 'sm' : ''}" title="${esc(t('ty.' + k + '.d'))}">${TYPE_ICON[k] || ''} ${tn(k)}</span>`;
  return `<span class="ty-pair">${chip(ty.primary, 'ty-p' + (ty.bold ? ' bold' : ''))}<i class="ty-dot">·</i>${ty.secondary ? chip(ty.secondary, 'ty-s') : `<span class="ty-chip ty-s ${small ? 'sm' : ''} none">—</span>`}${ty.complex ? `<span class="ty-flag" title="${esc(t('ty.complex.d'))}">${t('ty.complex')}</span>` : ''}${ty.edge && ty.edge.length ? `<span class="ty-flag edge" title="${esc(t('ty.edge.d'))}">?</span>` : ''}</span>`;
}

function tier(v, q) { if (!q || v == null) return ''; return v >= q.p75 ? 'hi' : v >= q.p50 ? 'mid' : 'lo'; }
function band(v, q, lv) { const tr = tier(v, q); return tr ? `<span class="rg-band ${tr}">${ctx.t(`demo.tier.${tr}.${lv}`)}</span>` : ''; }

/* ---------- 블록들 ---------- */
function blockPeople(s) {
  const t = ctx.t, lv = s.level, q = _demo && _demo.q;
  let r = null, nat = _demo && _demo.nation;
  if (lv === 'sgg') r = _demo && _demo.sgg && _demo.sgg[String(s.sgg)];
  if (lv === 'sido' && _demo) { // 시군구 합산
    const idx = ctx.state.idx.sggBySido.get(String(s.sido)) || []; let pop = 0, hh = 0, e = 0, a = 0, si = 0;
    for (const g of idx) { const x = _demo.sgg[g.code]; if (!x) continue; pop += x.pop; hh += x.hh; e += x.e65 * x.pop; a += x.ealone * x.hh; si += x.single * x.hh; }
    if (pop) r = { pop, hh, e65: e / pop, ealone: a / (hh || 1), single: si / (hh || 1) };
  }
  if (lv === 'emd') { const cells = ctx.gridCells(s.sgg), e = ctx.state.idx.byEmd.get(s.emd); const c = e && cells.map(f => f.properties).find(p => p.emd_name === e.name); if (c) r = { pop: c.pop, hh: c.hh, e65: c.elderly65_r, ealone: c.elderly_alone_r, single: c.single_hh_r }; }
  if (!r) return '';
  const row = (k, v, extra) => `<div class="rg-row"><span>${t('demo.' + k)}</span><b>${v}</b><small>${extra || ''}</small></div>`;
  const cmp = k => lv === 'sgg' ? band(r[k], q && q[k], 'sgg') : (nat && nat[k] != null ? `<span class="rg-band nat">${t('demo.nat', { v: pct(nat[k]) })}</span>` : '');
  return `<section class="rg-blk" data-topic="people"><h4>${t('rg.people')} <small>${t('rg.people.s', { d: (_demo && _demo.basis) || '' })}</small></h4>
    ${row('pop', fmtN(r.pop), t('demo.hh', { n: fmtN(r.hh) }))}${row('e65', pct(r.e65), cmp('e65'))}${row('ealone', pct(r.ealone), cmp('ealone'))}${row('single', pct(r.single), cmp('single'))}
    <p class="rg-note">${t('rg.people.n')}</p></section>`;
}

function blockHistory(s) {
  const t = ctx.t, lv = s.level;
  const cells = s.sgg ? ctx.gridCells(s.sgg) : [];
  let ps = cells.map(f => f.properties);
  if (lv === 'emd') { const e = ctx.state.idx.byEmd.get(s.emd); ps = e ? ps.filter(p => p.emd_name === e.name) : []; }
  const n = ps.length, fl = ps.filter(p => (p.flood_hist_n || 0) > 0).length, ls = ps.filter(p => (p.landslide_hist_n || 0) > 0).length;
  const slope = n ? ps.reduce((a, p) => a + (p.slope_mean || 0), 0) / n : null;
  const yrs = [...new Set(ps.flatMap(p => p.flood_years || []))].sort();
  const rz = _rz && _rz.by_sgg && s.sgg ? _rz.by_sgg[String(s.sgg)] : null;
  const row = (k, v, c, cls) => `<div class="rg-row"><span>${t('rg.h.' + k)}</span><b>${v}</b><small class="${cls || ''}">${c || ''}</small></div>`;
  let rows = '';
  if (n) {
    rows += row('flood', `${fl} / ${n}`, fl ? (yrs.length ? yrs.slice(-4).join('·') : '') : t('rg.h.none'), fl ? '' : 'mute');
    rows += row('ls', `${ls} / ${n}`, ls ? '' : t('rg.h.none'), ls ? '' : 'mute');
    rows += row('slope', slope.toFixed(1) + '°', slope >= 17 ? t('rg.h.steep') : slope <= 8 ? t('rg.h.flat') : '');
  }
  if (rz && lv !== 'emd') rows += row('rz', fmtN(rz.n), t('rg.h.rz.s', { f: rz.flood, g: rz.grade1 }));
  // 시도 맥락(통계연보, 시도 단위) — 시도 레벨은 본문, 시군구는 '소속 시도' 한 줄
  const sd = _sidoDis && _sidoDis.sido && _sidoDis.sido[String(s.sido)];
  let sidoLine = '';
  if (sd) {
    const yr = sd.years ? `${sd.years[0]}~${sd.years[1]}` : '';
    const parts = [sd.damage_per_capita_krw != null ? t('rg.h.pc', { v: fmtN(sd.damage_per_capita_krw) }) : '', t('rg.h.self', { v: pct(sd.self_burden_ratio) })].filter(Boolean).join(' · ');
    sidoLine = `<div class="rg-row sido"><span>${lv === 'sido' ? t('rg.h.sido.self') : t('rg.h.sido', { n: esc(ctx.nameOf().sidoName || '') })}</span><b></b><small>${parts} <em>(${yr})</em></small></div>`;
  }
  if (!rows && !sidoLine) return '';
  return `<section class="rg-blk" data-topic="history"><h4>${t('rg.hist')} <small>${t('rg.hist.s')}</small></h4>${rows}${sidoLine}<p class="rg-note warn">${t('rg.hist.n')}</p></section>`;
}

async function blockFacilities(s) {
  const t = ctx.t; if (!s.sido) return '';
  const kinds = ['civil_defense', 'heat', 'cold', 'quake', 'steep'];
  // 종류별로 따로 센다(collect 피처에 종류 정보가 없음)
  const byKind = {};
  for (const k of kinds) { const fc = await ctx.collect([k], s.sido); byKind[k] = (s.sgg ? fc.filter(f => String(f.properties.sgg) === String(s.sgg)) : fc).length; }
  const pop = (_demo && _demo.sgg && s.sgg && _demo.sgg[String(s.sgg)] && _demo.sgg[String(s.sgg)].pop) || null;
  const row = (k, label) => byKind[k] == null ? '' : `<div class="rg-row"><span>${label}</span><b>${fmtN(byKind[k])}</b><small>${pop && k === 'civil_defense' ? t('rg.f.per', { v: (byKind[k] / pop * 1e4).toFixed(1) }) : ''}<button type="button" class="rg-map" data-kind="${k}">${t('rg.f.map')}</button></small></div>`;
  const er = (ctx.state.live.er && ctx.state.live.er.by_sgg && s.sgg && ctx.state.live.er.by_sgg[String(s.sgg)]) || null;
  return `<section class="rg-blk" data-topic="facility"><h4>${t('rg.fac')} <small>${t('rg.fac.s')}</small></h4>
    ${row('civil_defense', t('rg.f.cd'))}${row('heat', t('rg.f.heat'))}${row('cold', t('rg.f.cold'))}${row('quake', t('rg.f.quake'))}${row('steep', t('rg.f.steep'))}
    ${er && er.length != null ? `<div class="rg-row"><span>${t('rg.f.er')}</span><b>${fmtN(er.length)}</b><small>${t('rg.f.er.s')}</small></div>` : ''}
    <p class="rg-note">${t('rg.fac.n')}</p></section>`;
}

/* 지원 미리보기: 타입 → 키워드 → 복지 3건 (집은 '지원 찾기' 탭) */
const TY_KW = { '물': ['풍수해', '침수', '재난'], '산': ['산사태', '재난', '재해'], '바다': ['어선', '어업', '풍수해'], '평온': ['재난', '풍수해'], '노년': ['노인', '독거', '어르신'], '홀로': ['1인', '긴급복지', '돌봄'], '들': ['농업', '농어'], '도심': ['긴급복지'] };
async function blockSupport(s, ty) {
  const t = ctx.t; if (!ty) return '';
  if (!_welfare) _welfare = await J('data/ref/welfare.json');
  if (ctx.getLang() === 'en' && !_welfareEn) _welfareEn = await J('data/ref/welfare_en.json');
  if (!_welfare || !_welfare.items) return '';
  const kws = [...new Set([...(TY_KW[ty.primary] || []), ...(TY_KW[ty.secondary] || [])])];
  const scored = [];
  for (const it of _welfare.items) { const name = it['서비스명'] || '', sum = it['서비스요약'] || ''; let sc = 0; for (const k of kws) { if (name.includes(k)) sc += 3; else if (sum.includes(k)) sc += 1; } if (sc) scored.push([sc, it]); }
  const top = scored.sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
  if (!top.length) return '';
  const nm = it => { const x = _welfareEn && _welfareEn.items && _welfareEn.items[it['서비스아이디']]; return x && x[0] ? x[0] : it['서비스명']; };
  const ag = it => (_welfareEn && _welfareEn.agency && _welfareEn.agency[it['소관부처명']]) || it['소관부처명'] || '';
  return `<section class="rg-blk" data-topic="support"><h4>${t('rg.sup')} <small>${t('rg.sup.s')}</small></h4>
    ${top.map(it => `<a class="rg-link" href="${esc(it['서비스URL'] || '#')}" target="_blank" rel="noopener" data-stat="welfare_click">${esc(nm(it))}<small>${esc(ag(it))}</small></a>`).join('')}
    <button type="button" class="btn btn-primary btn-sm rg-find">${t('rg.sup.go')}</button></section>`;
}

/* ---------- 렌더 ---------- */
export async function render() {
  if (!root || !ctx) return;
  const s = ctx.state, t = ctx.t;
  if (s.level === 'nation') { close(); return; }
  await load();
  const n = ctx.nameOf();
  const name = s.level === 'emd' ? n.emdName : s.level === 'sgg' ? n.sggName : n.sidoName;
  const ty = s.level === 'sgg' ? typeOf(s.sgg) : null;
  const ws = ctx.warningsFor(s.sgg, s.sido);
  const warnTag = ws.length ? `<span class="tag danger">${esc(ctx.warnName(ws[0].type, ws[0].level))}${ws.length > 1 ? ` +${ws.length - 1}` : ''}</span>` : `<span class="tag teal">${t('rg.nowarn')}</span>`;
  const UP_EN = { '구': 'gu', '시': 'si', '군': 'gun', '해안': 'coastal', '내륙': 'inland' };
  const upperTxt = ty && ty.upper ? (ctx.getLang() === 'en' ? ty.upper.split('·').map(x => UP_EN[x] || x).join(' · ') : ty.upper) : '';
  const upper = upperTxt ? `<span class="tag" title="${esc(t('rg.upper.d'))}">${esc(upperTxt)}</span>` : '';
  const sidoDist = s.level === 'sido' && _types ? await sidoDistHTML(s.sido) : '';
  const [people, hist, fac, sup] = await Promise.all([blockPeople(s), blockHistory(s), blockFacilities(s), blockSupport(s, ty)]);
  root.innerHTML = `<div class="rg-head"><div><div class="eyebrow">${t('rg.eyebrow')}</div><h3>${esc(name)}</h3></div><button type="button" class="rg-x" aria-label="${t('rg.close')}">✕</button></div>
    <div class="rg-tags">${ty ? typeChips(ty) : ''}${upper}${warnTag}</div>${sidoDist}
    <div class="rg-filters">${['all', 'people', 'history', 'facility', 'support'].map(k => `<button type="button" class="chip ${topic === k ? 'is-on' : ''}" data-topic="${k}">${t('rg.topic.' + k)}</button>`).join('')}</div>
    <div class="rg-body">${people}${hist}${fac}${sup}</div>
    <p class="rg-src">${t('rg.src')}</p>`;
  applyTopic();
  root.querySelector('.rg-x').addEventListener('click', () => close(true));
  root.querySelectorAll('.rg-filters .chip').forEach(b => b.addEventListener('click', () => { topic = b.dataset.topic; root.querySelectorAll('.rg-filters .chip').forEach(x => x.classList.toggle('is-on', x === b)); applyTopic(); }));
  root.querySelectorAll('.rg-map').forEach(b => b.addEventListener('click', () => { ctx.toggleKind(b.dataset.kind); ctx.stat('region_maplink'); }));
  const f = root.querySelector('.rg-find'); if (f) f.addEventListener('click', () => { ctx.stat('region_to_find'); ctx.goFind(); });
}
function applyTopic() { root.querySelectorAll('.rg-blk').forEach(b => { b.hidden = topic !== 'all' && b.dataset.topic !== topic; }); }
async function sidoDistHTML(sido) {
  const st = await J('data/ref/sido_types.json'); const d = st && st.sido && st.sido[String(sido)]; if (!d) return '';
  const bar = (obj) => Object.entries(obj).filter(([k]) => k !== '—').sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `<span class="rg-dist"><i>${TYPE_ICON[k] || ''}</i>${tn(k)} <b>${v.toFixed(0)}%</b></span>`).join('');
  return `<div class="rg-sido"><small>${ctx.t('rg.sido.dist', { n: d.n_sgg })}</small><div>${bar(d.primary_pct)}</div><div>${bar(d.secondary_pct)}</div></div>`;
}

export function init(c) { ctx = c; root = document.getElementById('regionDrawer'); if (!init._esc) { init._esc = true; addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(true); }); } }
export function isOpen() { return !!(root && !root.hidden); }
export async function open(c) {
  ctx = c; root = document.getElementById('regionDrawer'); if (!root) return;
  topic = 'all'; root.hidden = false; document.querySelector('.stage').classList.add('has-drawer');
  ctx.state._drawerOpen = true; ctx.onOpen && ctx.onOpen();
  ctx.stat('region_open');
  await render();
}
export function close(user) {
  if (!root) return;
  root.hidden = true; document.querySelector('.stage').classList.remove('has-drawer');
  if (ctx) { ctx.state._drawerOpen = false; ctx.onClose && ctx.onClose(user); }
}
export function refresh() { if (isOpen()) render(); }
