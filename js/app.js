// SafePic — app.js (ES module, no build step)
import { t, getLang, setLang, applyStatic } from './i18n.js?v=20260823i';
import { initGrid, hasGrid, meta as gridMeta, cells as gridCells, available as gridAttrs, show as showGrid, hide as hideGrid, fmt as gridFmt, ATTRS as GRID_ATTRS } from './grid.js?v=20260823i';
import { getReports, postReport, flagReport } from './api.js?v=20260823i';
import { initShelters, setActive as setShelters, nearest as nearestShelters, KINDS as SHELTER_KINDS } from './shelters.js?v=20260823i';
let setRulesLang = () => {}, loadRules = null, evaluate = null, formatKRW = n => (n || 0).toLocaleString('ko-KR') + '원';
try { const m = await import('./rules.js?v=20260823i'); loadRules = m.loadRules; evaluate = m.evaluate; if (m.formatKRW) formatKRW = m.formatKRW; if (m.setRulesLang) setRulesLang = m.setRulesLang; } catch (e) { console.warn('rules.js not available', e); }

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KOREA_CENTER = [127.8, 36.3];
const MQ_MOBILE = '(max-width:900px), (max-width:1200px) and (orientation:portrait)'; // must match css/style.css
const WX_KEYS = ['t', 'feels', 'rain', 'reh', 'wind', 'pm10', 'pm25'];

const state = {
  level: 'nation', sido: null, sgg: null, emd: null,
  geo: { sido: null, sgg: null, emd: null },
  idx: { emd: [], sgg: [], byEmd: new Map(), bySgg: new Map() },
  live: { weather: null, alerts: null, air: null },
  rules: null, meta: null, tab: 'now',
  wxsel: new Set(JSON.parse(localStorage.getItem('safepic.wxsel') || '["t","feels","rain","pm10","pm25"]')),
  lastResult: null,
  shelters: { avail: [], active: new Set(JSON.parse(localStorage.getItem('safepic.shelters') || 'null') || seasonalKinds()) },
};
function seasonalKinds() { const m = new Date().getMonth() + 1; return ['civil_defense', ...(m >= 6 && m <= 9 ? ['heat'] : m === 12 || m <= 2 ? ['cold'] : [])]; }

/* ---------- data ---------- */
async function getJSON(url, fallback = null) {
  try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw 0; return await r.json(); } catch { return fallback; }
}
async function loadCore() {
  const [sido, sgg, emdIdx, sggIdx, meta, weather, alerts, air] = await Promise.all([
    getJSON('data/admin/kr_sido.geojson'), getJSON('data/admin/kr_sgg.geojson'),
    getJSON('data/admin/emd_index.json', []), getJSON('data/admin/sgg_index.json', []),
    getJSON('data/admin/meta.json'), getJSON('data/live/weather.json'), getJSON('data/live/alerts.json'), getJSON('data/live/air.json'),
  ]);
  Object.assign(state.geo, { sido, sgg }); state.meta = meta;
  state.idx.emd = emdIdx; state.idx.sgg = sggIdx;
  emdIdx.forEach(e => state.idx.byEmd.set(String(e.code), e));
  sggIdx.forEach(s => state.idx.bySgg.set(String(s.code), s));
  Object.assign(state.live, { weather, alerts, air });
  state.sit = sessionStorage.getItem('safepic.sit') || null;
  getJSON('data/ref/psych_centers.json').then(j => { state.psych = j; });
  if (meta) { $('#aboutAdmin').textContent = `${meta.source || ''} ${meta.version || ''}`.trim(); $('#buildDate').textContent = meta.built || ''; }
  if (loadRules) { try { state.rules = await loadRules('rules/'); state.rulesEn = await getJSON('rules/en.json'); setRulesLang(getLang()); applyRulesLang(); } catch (e) { console.warn('rules load failed', e); } }
}
async function ensureEmd() {
  if (state.geo.emd) return state.geo.emd;
  state.geo.emd = await getJSON('data/admin/kr_emd.geojson', { type: 'FeatureCollection', features: [] });
  if (map.getSource('emd')) map.getSource('emd').setData(state.geo.emd);
  return state.geo.emd;
}

/* ---------- map ---------- */
let map;
function bboxOf(features) {
  const b = [180, 90, -180, -90];
  const walk = c => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  features.forEach(f => walk(f.geometry.coordinates)); return b;
}
const featuresWhere = (fc, key, val) => fc ? fc.features.filter(f => String(f.properties[key]) === String(val)) : [];
/* point-in-polygon (ray casting) over a GeoJSON feature */
function pipRing(lon, lat, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside; } return inside; }
function pipFeature(lon, lat, f) { const g = f.geometry; const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]; return polys.some(p => pipRing(lon, lat, p[0]) && !p.slice(1).some(h => pipRing(lon, lat, h))); }
const featureAt = (fc, lon, lat, filter) => fc ? fc.features.find(f => (!filter || filter(f)) && pipFeature(lon, lat, f)) : null;
/* locate me -> sido/sgg/emd by polygon test, then select */
async function locateMe() {
  const btn = $('#btnLocate'); if (!navigator.geolocation) { alert(t('gps.unsupported')); return; }
  btn.classList.add('is-busy'); btn.disabled = true;
  const done = () => { btn.classList.remove('is-busy'); btn.disabled = false; };
  navigator.geolocation.getCurrentPosition(async pos => {
    const lon = pos.coords.longitude, lat = pos.coords.latitude;
    const sd = featureAt(state.geo.sido, lon, lat);
    if (!sd) { done(); alert(t('gps.outside')); return; }
    const sg = featureAt(state.geo.sgg, lon, lat, f => String(f.properties.sido_code) === String(sd.properties.code));
    await ensureEmd();
    const em = sg && featureAt(state.geo.emd, lon, lat, f => String(f.properties.sgg_code) === String(sg.properties.code));
    state.gps = { lon, lat, acc: pos.coords.accuracy, emd: em ? String(em.properties.code) : null };
    if (em) await selectEmd(em.properties.code); else if (sg) await selectSgg(sg.properties.code); else selectSido(sd.properties.code);
    showGpsDot(lon, lat, pos.coords.accuracy);
    done();
  }, err => { done(); alert(err.code === 1 ? t('gps.denied') : t('gps.fail')); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}
function showGpsDot(lon, lat, acc) {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { acc } }] };
  if (map.getSource('gps')) map.getSource('gps').setData(fc);
  else {
    map.addSource('gps', { type: 'geojson', data: fc });
    map.addLayer({ id: 'gps-halo', type: 'circle', source: 'gps', paint: { 'circle-radius': 18, 'circle-color': '#1a5fc4', 'circle-opacity': 0.15 } });
    map.addLayer({ id: 'gps-dot', type: 'circle', source: 'gps', paint: { 'circle-radius': 7, 'circle-color': '#1a5fc4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
  }
}

function initMap() {
  map = new maplibregl.Map({
    container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
    center: [100, 25], zoom: 1.5, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
  map.on('style.load', () => {
    try { map.setProjection({ type: 'globe' }); } catch (e) { console.warn('globe unsupported', e); }
    localizeLabels(); addAdminLayers(); initShelterUI(); initGrid(map); initGridClick();
    map.flyTo({ center: KOREA_CENTER, zoom: 5.6, duration: 3000, essential: true, curve: 1.3 });
    map.once('moveend', () => { $('#mapHint').textContent = t('hint.drill'); });
  });
}
/* 지명 표기: 기본 타일의 모든 라벨을 한국어(+영어) 또는 영어만으로 통일. 동해는 영어 줄도 East Sea로. */
function localizeLabels() {
  const ko = ['coalesce', ['get', 'name:ko'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const enRaw = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const en = ['case', ['in', 'Japan', ['to-string', enRaw]], 'East Sea', ['in', 'Liancourt', ['to-string', enRaw]], 'Dokdo', enRaw];
  const koFixed = ['case', ['in', 'Japan', ['to-string', ko]], '동해', ['in', '日本海', ['to-string', ko]], '동해', ['in', 'Liancourt', ['to-string', ko]], '독도', ['in', '竹島', ['to-string', ko]], '독도', ko];
  const both = ['format', koFixed, {}, '\n', {}, en, { 'font-scale': 0.8, 'text-color': '#6b7a90' }];
  const field = getLang() === 'en' ? en : ['case', ['==', ['to-string', koFixed], ['to-string', en]], koFixed, both];
  for (const l of map.getStyle().layers || []) {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
    if (['sgg-label', 'emd-label'].includes(l.id)) continue;
    try { map.setLayoutProperty(l.id, 'text-field', field); } catch (e) { /* ignore */ }
  }
}
/* visible map area (px) after floating UI: left panel / bottom sheet / top-right stack */
function visiblePadding() {
  const mobile = matchMedia(MQ_MOBILE).matches, p = $('#panel');
  if (mobile) {
    const sheet = p.classList.contains('is-collapsed') ? 72 : p.classList.contains('is-tall') ? innerHeight * 0.9 : innerHeight * 0.5;
    return { top: 120, bottom: Math.round(sheet) + 12, left: 12, right: 12 };
  }
  const pw = p.classList.contains('is-collapsed') ? 0 : (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 460) + 32;
  return { top: 70, bottom: 40, left: pw, right: 170 };
}
/* 🔊 읽어주기 (Web Speech, 키 불필요) */
let speaking = false;
function speak(text, btn) {
  if (!('speechSynthesis' in window)) { alert(t('tts.unsupported')); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; if (btn) btn.classList.remove('is-on'); return; }
  const u = new SpeechSynthesisUtterance(text); u.lang = getLang() === 'en' ? 'en-US' : 'ko-KR'; u.rate = document.documentElement.classList.contains('big') ? 0.9 : 1;
  u.onend = u.onerror = () => { speaking = false; if (btn) btn.classList.remove('is-on'); };
  speaking = true; if (btn) btn.classList.add('is-on'); speechSynthesis.cancel(); speechSynthesis.speak(u);
}
const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim(); };
/* 🖼 결과 카드 이미지 (카톡·가족방 공유용, 1080×1350) */
async function shareImage(res, inp) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const n = nameOf(), place = state.emd ? `${n.sidoName} ${n.sggName} ${n.emdName}` : state.sgg ? `${n.sidoName} ${n.sggName}` : '';
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1a5fc4'; x.fillRect(0, 0, W, 14);
  const F = (sz, w = 400) => `${w} ${sz}px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  const wrap = (txt, maxW, font) => { x.font = font; const out = []; let line = ''; for (const ch of String(txt)) { if (x.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; } if (line) out.push(line); return out; };
  let y = 90;
  x.fillStyle = '#14202e'; x.font = F(34, 700); x.fillText('SafePic', 72, y); x.fillStyle = '#566577'; x.font = F(26); x.fillText(place, 72 + 170, y);
  y += 70; x.fillStyle = '#14202e'; x.font = F(44, 700); x.fillText(inp.proxy ? t('res.proxy') : t('res.mine'), 72, y);
  y += 90; x.fillStyle = '#f7f9fc'; x.fillRect(72, y - 60, W - 144, 150); x.fillStyle = '#14202e'; x.font = F(72, 700); x.fillText(formatKRW(res.total_cash_krw || 0), 100, y + 30); x.fillStyle = '#566577'; x.font = F(24); x.fillText(t('res.cash.s'), 100, y + 70);
  y += 150;
  const dl = (res.deadlines || [])[0];
  if (dl) { x.fillStyle = '#9a7328'; x.font = F(30, 700); x.fillText(dl.days_left < 0 ? t('res.dl.over', { n: -dl.days_left }) : dl.days_left === 0 ? t('res.dl.today') : t('res.dl.d', { n: dl.days_left }), 72, y); x.fillStyle = '#2b3a4d'; x.font = F(26); x.fillText(`${dl.label} · ${dl.due}`, 72 + 200, y); y += 56; }
  const items = [...(res.cash || []), ...(res.relief_fund || []), ...(res.apply || [])].slice(0, 6);
  x.fillStyle = '#14202e'; x.font = F(28, 700); x.fillText(t('res.cash'), 72, y); y += 20;
  for (const r of items) { y += 52; x.fillStyle = '#dbe3ee'; x.fillRect(72, y - 38, W - 144, 1); x.fillStyle = '#14202e'; x.font = F(28); const lines = wrap(r.label, 640, F(28)); x.fillText(lines[0], 72, y); x.fillStyle = '#0f4a9e'; x.font = F(28, 500); const amt = r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : ''); x.fillText(amt, W - 72 - x.measureText(amt).width, y); }
  y += 80; x.fillStyle = '#14202e'; x.font = F(28, 700); x.fillText(t('res.todo'), 72, y);
  for (const td of (res.todo || []).slice(0, 3)) { const lines = wrap('• ' + (td.text || td), W - 144, F(26)); for (const l of lines) { y += 40; x.fillStyle = '#2b3a4d'; x.font = F(26); x.fillText(l, 72, y); } }
  x.fillStyle = '#566577'; x.font = F(22); x.fillText(t('res.disc').slice(0, 60), 72, H - 90); x.fillStyle = '#1a5fc4'; x.font = F(24, 500); x.fillText('5-jihwan.github.io/safepic', 72, H - 50);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'safepic.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'SafePic', text: place }); return; } catch (e) { /* cancelled */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'safepic.png'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
/* 데이터 출처·기준일 배지 (시설·격자·날씨 공통 형식) */
const SRC_NAME = { safekorea: '국민안전24', osm: 'OpenStreetMap', localdata: '지방행정인허가데이터', datago_std: '공공데이터포털 표준데이터' };
function srcBadge(src, asof) { const k = Object.keys(SRC_NAME).find(x => String(src || '').startsWith(x)); const name = k ? SRC_NAME[k] : (src || ''); return (name || asof) ? `<div class="src-badge">${asof ? `${t('badge.asof')} ${asof}` : ''}${asof && name ? ' · ' : ''}${name}</div>` : ''; }
/* 길찾기 딥링크 (키 불필요): 카카오맵 · 구글 · 애플 */
function routeLinks(lon, lat, name) {
  const n = encodeURIComponent(name || 'SafePic');
  return `<div class="route-row"><a href="https://map.kakao.com/link/to/${n},${lat},${lon}" target="_blank" rel="noopener">카카오맵</a><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking" target="_blank" rel="noopener">Google</a><a href="https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w" target="_blank" rel="noopener">Apple</a></div>`;
}
/* 📅 .ics: 기한을 휴대폰 달력에 */
function downloadICS(title, dateISO, desc) {
  const d = dateISO.replace(/-/g, ''), next = new Date(Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SafePic//KO', 'BEGIN:VEVENT', `UID:safepic-${d}-${Math.random().toString(36).slice(2)}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, 'BEGIN:VALARM', 'TRIGGER:-P2D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = `safepic-${d}.ics`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
/* open a popup and make sure it is not hidden behind the panel/controls */
function openPopup(lngLat, html, opts = {}) {
  if (matchMedia(MQ_MOBILE).matches && opts.fromPanel) { $('#panel').classList.add('is-collapsed'); $('#panel').classList.remove('is-tall'); setTimeout(() => map.resize(), 260); }
  const pop = new maplibregl.Popup({ closeButton: !!opts.closeButton, offset: opts.offset || 8, maxWidth: opts.maxWidth || '280px' }).setLngLat(lngLat).setHTML(html).addTo(map);
  setTimeout(() => {
    const pad = visiblePadding(), pt = map.project(lngLat), W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
    const popH = (pop.getElement() && pop.getElement().offsetHeight) || 160;
    const inside = pt.x > pad.left + 20 && pt.x < W - pad.right - 20 && pt.y > pad.top + popH + 10 && pt.y < H - pad.bottom - 10;
    if (!inside) map.easeTo({ center: lngLat, padding: { ...pad, top: pad.top + popH }, duration: 450 });
  }, 280);
  return pop;
}
function addAdminLayers() {
  map.openPopup = openPopup; map.routeLinks = routeLinks; map.srcBadge = srcBadge;
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('sido', { type: 'geojson', data: state.geo.sido || empty, promoteId: 'code' });
  map.addSource('sgg', { type: 'geojson', data: state.geo.sgg || empty, promoteId: 'code' });
  map.addSource('emd', { type: 'geojson', data: state.geo.emd || empty, promoteId: 'code' });
  const op = ['case', ['boolean', ['feature-state', 'hover'], false], 0.32, ['boolean', ['feature-state', 'sel'], false], 0.26, 0];
  const fill = (id, src, color) => map.addLayer({ id, type: 'fill', source: src, paint: { 'fill-color': color, 'fill-opacity': op } });
  const line = (id, src, color, w) => map.addLayer({ id, type: 'line', source: src, paint: { 'line-color': color, 'line-width': w } });
  fill('sido-fill', 'sido', '#1a5fc4'); line('sido-line', 'sido', '#7f95b8', 1);
  fill('sgg-fill', 'sgg', '#9a7328'); line('sgg-line', 'sgg', '#b39868', 0.9);
  fill('emd-fill', 'emd', '#0f9d7a'); line('emd-line', 'emd', '#7fb9a8', 0.8);
  const lbl = (id, src, minzoom, maxzoom) => map.addLayer({ id, type: 'symbol', source: src, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 }, minzoom, ...(maxzoom ? { maxzoom } : {}) });
  lbl('sgg-label', 'sgg', 8, 11.5); lbl('emd-label', 'emd', 11.5);
  // 독도·울릉도: 저배율에서도 항상 보이도록 전용 마커+라벨
  map.addSource('landmarks', { type: 'geojson', data: 'data/admin/landmarks.geojson' });
  map.addLayer({ id: 'landmark-dot', type: 'circle', source: 'landmarks', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 6], 'circle-color': '#1a5fc4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }, minzoom: 3.5, maxzoom: 11 });
  map.addLayer({ id: 'landmark-label', type: 'symbol', source: 'landmarks', layout: { 'text-field': getLang() === 'en' ? ['get', 'en'] : ['format', ['get', 'ko'], {}, '\n', {}, ['get', 'en'], { 'font-scale': 0.8, 'text-color': '#6b7a90' }], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 0.9], 'text-anchor': 'top' }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 }, minzoom: 3.5 });
  setLevelFilters();

  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; $('#map').appendChild(tip);
  let hover = { src: null, id: null };
  const setHover = (src, id) => {
    if (hover.id != null) map.setFeatureState({ source: hover.src, id: hover.id }, { hover: false });
    hover = { src, id }; if (id != null) map.setFeatureState({ source: src, id }, { hover: true });
    map.getCanvas().style.cursor = id != null ? 'pointer' : '';
  };
  for (const lv of ['sido', 'sgg', 'emd']) {
    map.on('mousemove', `${lv}-fill`, e => {
      const f = e.features[0]; if (!f) return; setHover(lv, f.id);
      const top = map.queryRenderedFeatures(e.point, { layers: ['emd-fill', 'sgg-fill', 'sido-fill'] })[0];
      if (top && top.layer.id === `${lv}-fill`) { tip.hidden = false; tip.innerHTML = `${f.properties.name}<small>${t('lv.' + lv)} · ${t('tip.click')} ${lv === 'emd' ? t('tip.summary') : t('tip.enter')}</small>`; tip.style.left = e.point.x + 'px'; tip.style.top = e.point.y + 'px'; }
    });
    map.on('mouseleave', `${lv}-fill`, () => { setHover(lv, null); tip.hidden = true; });
  }
  map.on('click', 'emd-fill', e => { const f = e.features[0]; if (f) selectEmd(f.properties.code); });
  map.on('click', 'sgg-fill', e => { if (map.queryRenderedFeatures(e.point, { layers: ['emd-fill'] }).length) return; const f = e.features[0]; if (f) selectSgg(f.properties.code); });
  map.on('click', 'sido-fill', e => { if (map.queryRenderedFeatures(e.point, { layers: ['sgg-fill', 'emd-fill'] }).length) return; const f = e.features[0]; if (f) selectSido(f.properties.code); });
  map.on('click', () => $('#mapHint').classList.add('is-hidden'));
}
function setLevelFilters() {
  if (!map || !map.getLayer('sgg-fill')) return;
  const NONE = ['==', ['get', 'code'], '__none__']; // valid "match nothing" (['==',1,0] is rejected by MapLibre)
  const sggF = state.sido ? ['==', ['get', 'sido_code'], String(state.sido)] : NONE;
  const emdF = state.sgg ? ['==', ['get', 'sgg_code'], String(state.sgg)] : NONE;
  map.setFilter('sgg-fill', sggF); map.setFilter('sgg-label', state.sido ? sggF : NONE);
  map.setFilter('sgg-line', state.sido ? sggF : null); // nation view keeps the thin 시군구 outline (liked by users)
  ['emd-fill', 'emd-line', 'emd-label'].forEach(l => map.setFilter(l, emdF));
  map.setPaintProperty('sido-fill', 'fill-opacity', state.sido ? 0 : ['case', ['boolean', ['feature-state', 'hover'], false], 0.32, 0]);
  // highlight only the deepest selection (emd > sgg); nothing selected = no fill
  const want = state.emd ? { src: 'emd', id: String(state.emd) } : state.sgg ? { src: 'sgg', id: String(state.sgg) } : null;
  const prev = state._sel;
  if (prev && (!want || prev.src !== want.src || prev.id !== want.id)) { try { map.setFeatureState({ source: prev.src, id: prev.id }, { sel: false }); } catch (e) { /* source may be reloading */ } }
  if (want) { try { map.setFeatureState({ source: want.src, id: want.id }, { sel: true }); } catch (e) { /* ignore */ } }
  state._sel = want;
}
function fitTo(features) {
  if (!features.length) return;
  const b = bboxOf(features), mobile = matchMedia(MQ_MOBILE).matches;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: mobile ? { top: 150, bottom: innerHeight * 0.52, left: 24, right: 24 } : { top: 90, bottom: 60, left: ($('#panel').classList.contains('is-collapsed') ? 0 : parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 460) + 60, right: 80 }, duration: 900 });
}

/* ---------- selection ---------- */
function selectSido(code) {
  Object.assign(state, { level: 'sido', sido: String(code), sgg: null, emd: null });
  setLevelFilters(); fitTo(featuresWhere(state.geo.sido, 'code', code)); renderAll(); ensureEmd();
}
async function selectSgg(code) {
  const s = state.idx.bySgg.get(String(code));
  Object.assign(state, { level: 'sgg', sgg: String(code), emd: null, sido: s ? String(s.sido) : state.sido });
  await ensureEmd(); setLevelFilters(); fitTo(featuresWhere(state.geo.sgg, 'code', code)); renderAll();
}
async function selectEmd(code) {
  const e = state.idx.byEmd.get(String(code)); if (!e) return;
  Object.assign(state, { level: 'emd', emd: String(code), sgg: String(e.sgg), sido: String(e.sido) });
  await ensureEmd(); setLevelFilters();
  const fs = featuresWhere(state.geo.emd, 'code', code); if (fs.length) fitTo(fs); else map.flyTo({ center: [e.lon, e.lat], zoom: 13 });
  if (map.getSource('emd')) { state.geo.emd.features.forEach(f => map.setFeatureState({ source: 'emd', id: f.properties.code }, { sel: false })); map.setFeatureState({ source: 'emd', id: String(code) }, { sel: true }); }
  pushRecent(String(code));
  renderAll(); syncWizardLoc();
  if (matchMedia(MQ_MOBILE).matches) { $('#panel').classList.remove('is-collapsed'); }
}
/* 최근 본 동네 3개 (저장한 내 동네 제외) */
function pushRecent(code) { const r = JSON.parse(localStorage.getItem('safepic.recent') || '[]').filter(c => c !== code); r.unshift(code); localStorage.setItem('safepic.recent', JSON.stringify(r.slice(0, 4))); }
function renderRecent() {
  const row = $('#recentRow'); if (!row) return;
  const home = getHome(), list = JSON.parse(localStorage.getItem('safepic.recent') || '[]').filter(c => c !== home).map(c => state.idx.byEmd.get(c)).filter(Boolean).slice(0, 3);
  row.hidden = !list.length; if (!list.length) return;
  row.innerHTML = `<span class="muted">${t('recent.title')}</span>` + list.map(e => `<button type="button" class="chip" data-c="${e.code}">${e.sgg_name} ${e.name}</button>`).join('');
  $$('button[data-c]', row).forEach(b => b.addEventListener('click', () => selectEmd(b.dataset.c)));
}
function resetNation() {
  Object.assign(state, { level: 'nation', sido: null, sgg: null, emd: null });
  setLevelFilters(); map.flyTo({ center: KOREA_CENTER, zoom: 5.6, duration: 900 }); renderAll();
}
function renderAll() { renderCrumb(); renderRegion(); renderLive(); syncShelterLayers(); syncGrid(); renderHome(); }
/* ---------- saved home (localStorage only) ---------- */
const getHome = () => localStorage.getItem('safepic.home');
function renderHome() {
  renderRecent();
  const h = getHome(), e = h && state.idx.byEmd.get(h), row = $('#homeRow');
  if (row) { row.hidden = !e; if (e) $('#btnGoHome').textContent = t('home.go', { name: `${e.sgg_name} ${e.name}` }); }
  const sb = $('#btnSaveHome'); if (sb) { const on = state.emd && state.emd === h; sb.textContent = on ? t('home.saved') : t('home.save'); sb.classList.toggle('is-on', !!on); sb.hidden = state.level !== 'emd'; }
}
function initHome() {
  $('#btnGoHome').addEventListener('click', () => { const h = getHome(); if (h) selectEmd(h); });
  $('#btnForgetHome').addEventListener('click', () => { localStorage.removeItem('safepic.home'); renderHome(); });
  $('#btnSaveHome').addEventListener('click', () => { if (!state.emd) return; if (getHome() === state.emd) localStorage.removeItem('safepic.home'); else localStorage.setItem('safepic.home', state.emd); renderHome(); });
  $('#btnResetSel').addEventListener('click', () => { resetNation(); $('#wizard').reset(); syncWizardLoc(); });
}
/* ---------- pilot grid (탭③ + 탭① 겹침) ---------- */
let gridAttr = localStorage.getItem('safepic.gridAttr') || 'slope_mean';
async function syncGrid() {
  const box = $('#gridBox'), where = $('#whereGrid');
  if (!state.sgg || !(await hasGrid(state.sgg))) { hideGrid(); if (box) box.hidden = true; if (where) where.hidden = true; $('#wherePending').hidden = false; return; }
  const attrs = gridAttrs(state.sgg); if (!attrs.some(a => a.id === gridAttr)) gridAttr = attrs[0] && attrs[0].id;
  const leg = showGrid(state.sgg, gridAttr);
  state._gridLegend = leg ? { title: (getLang() === 'en' ? leg.attr.en : leg.attr.ko), html: leg.colors.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? '≤ ' + gridFmt(leg.attr, leg.breaks[0]) : i === leg.colors.length - 1 ? '> ' + gridFmt(leg.attr, leg.breaks[leg.breaks.length - 1]) : gridFmt(leg.attr, leg.breaks[i - 1]) + '–' + gridFmt(leg.attr, leg.breaks[i])}</span>`).join('') } : null;
  renderLegend(state.sido ? [...state.shelters.active].filter(k => state.shelters.avail.some(a => a.id === k)) : []);
  const html = `<div class="grid-attrs">${attrs.map(a => `<button type="button" class="chip ${a.id === gridAttr ? 'is-on' : ''}" data-a="${a.id}">${getLang() === 'en' ? a.en : a.ko}</button>`).join('')}</div>` +
    (leg ? `<div class="legend">${leg.colors.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? '≤ ' + gridFmt(leg.attr, leg.breaks[0]) : i === leg.colors.length - 1 ? '> ' + gridFmt(leg.attr, leg.breaks[leg.breaks.length - 1]) : gridFmt(leg.attr, leg.breaks[i - 1]) + '–' + gridFmt(leg.attr, leg.breaks[i])}</span>`).join('')}<span><i style="background:#d9dee7"></i>${t('grid.nodata')}</span></div>` : '') +
    `<div class="fine">${t('grid.note')}</div>`;
  for (const el of [box, where]) { if (!el) continue; el.hidden = false; el.innerHTML = `<h3>${t('grid.title')}</h3>` + html; $$('.chip', el).forEach(b => b.addEventListener('click', () => { gridAttr = b.dataset.a; localStorage.setItem('safepic.gridAttr', gridAttr); syncGrid(); })); }
  $('#wherePending').hidden = true;
  renderCompare();
}
/* ---------- 탭③ 동 2개 비교 (격자 집계) ---------- */
const CMP_ROWS = [
  { id: 'flood_pct', ko: '침수 이력 있는 격자', en: 'Cells with flood history', fmt: v => (v * 100).toFixed(0) + '%', lowerBetter: true, agg: cs => cs.filter(c => c.flood_hist_n > 0).length / cs.length },
  { id: 'depth', ko: '최대 침수심', en: 'Max flood depth', fmt: v => v.toFixed(1) + ' m', lowerBetter: true, agg: cs => Math.max(0, ...cs.map(c => c.flood_depth_max_m || 0)) },
  { id: 'slope', ko: '평균 경사', en: 'Mean slope', fmt: v => v.toFixed(1) + '°', lowerBetter: true, agg: cs => cs.reduce((a, c) => a + (c.slope_mean || 0), 0) / cs.length },
  { id: 'elderly', ko: '고령 1인세대 비율', en: 'Elderly living alone', fmt: v => (v * 100).toFixed(1) + '%', lowerBetter: true, agg: cs => cs[0].elderly_alone_r ?? null },
  { id: 'pop', ko: '인구', en: 'Population', fmt: v => v.toLocaleString('ko-KR'), lowerBetter: null, agg: cs => cs[0].pop ?? null },
];
function renderCompare() {
  const box = $('#compareBox'); if (!box) return;
  const cs = gridCells(state.sgg); if (!cs.length) { box.hidden = true; return; }
  const byEmd = new Map(); for (const f of cs) { const p = f.properties; if (!byEmd.has(p.emd_name)) byEmd.set(p.emd_name, []); byEmd.get(p.emd_name).push(p); }
  const names = [...byEmd.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const cur = state.emd && state.idx.byEmd.get(state.emd), curName = cur && names.includes(cur.name) ? cur.name : names[0];
  const saved = JSON.parse(sessionStorage.getItem('safepic.cmp') || 'null') || [curName, names.find(n => n !== curName)];
  if (!names.includes(saved[0])) saved[0] = curName; if (!names.includes(saved[1])) saved[1] = names.find(n => n !== saved[0]);
  const en = getLang() === 'en', all = [...byEmd.values()].flat();
  const sel = (i) => `<select class="cmp-sel" data-i="${i}">${names.map(n => `<option ${n === saved[i] ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const A = byEmd.get(saved[0]), B = byEmd.get(saved[1]);
  const rows = CMP_ROWS.map(r => { const a = r.agg(A), b = r.agg(B), g = r.agg(all); if (a == null || b == null) return ''; const win = r.lowerBetter == null ? 0 : (a === b ? 0 : (a < b) === r.lowerBetter ? 1 : 2); return `<tr><td>${en ? r.en : r.ko}</td><td class="${win === 1 ? 'win' : ''}">${r.fmt(a)}</td><td class="${win === 2 ? 'win' : ''}">${r.fmt(b)}</td><td class="muted">${g != null ? r.fmt(g) : '—'}</td></tr>`; }).join('');
  const verdict = (() => { const parts = []; for (const r of CMP_ROWS) { if (r.lowerBetter == null) continue; const a = r.agg(A), b = r.agg(B); if (a == null || b == null || a === b) continue; const w = (a < b) === r.lowerBetter ? saved[0] : saved[1]; parts.push(t('cmp.v.' + r.id, { w })); } return parts.slice(0, 3).join(' '); })();
  box.hidden = false;
  box.innerHTML = `<h3>${t('cmp.title')}</h3><div class="cmp-head">${sel(0)}<span class="muted">vs</span>${sel(1)}</div><div class="table-wrap"><table class="cmp-table"><thead><tr><th></th><th>${saved[0]}</th><th>${saved[1]}</th><th class="muted">${t('cmp.avg', { name: nameOf().sggName })}</th></tr></thead><tbody>${rows}</tbody></table></div><p class="cmp-verdict">${verdict}</p><div class="fine">${t('cmp.note')}</div>`;
  $$('.cmp-sel', box).forEach(s => s.addEventListener('change', () => { const v = [...$$('.cmp-sel', box)].map(x => x.value); sessionStorage.setItem('safepic.cmp', JSON.stringify(v)); renderCompare(); }));
}
function initGridClick() {
  map.on('click', 'grid-fill', e => {
    const p = e.features[0].properties, attrs = gridAttrs(state.sgg);
    const rows = attrs.map(a => `<tr><td>${getLang() === 'en' ? a.en : a.ko}</td><td class="mono">${gridFmt(a, p[a.id] == null ? null : +p[a.id])}</td></tr>`).join('') + (p.flood_years ? `<tr><td>${getLang() === 'en' ? 'Flood years' : '침수 연도'}</td><td class="mono">${String(p.flood_years).replace(/[\[\]"]/g, '')}</td></tr>` : '');
    const gm = gridMeta(state.sgg) || {};
    openPopup(e.lngLat, `<b>${p.emd_name || ''}</b> <small class="mono">${p.h3}</small><table class="cell-table">${rows}</table>${srcBadge(gm.src || '서울 침수흔적도 · ' + (gm.dem || 'DEM') + ' · 행안부 주민등록', gm.jumin_basis)}`, { closeButton: true, offset: 6 });
  });
}
async function initShelterUI() {
  state.shelters.avail = await initShelters(map);
  const box = $('#shsel'); if (!state.shelters.avail.length) { box.hidden = true; return; }
  box.hidden = false;
  const GROUPS = [
    { id: 'evac', ko: '대피', en: 'Evacuate', icon: '🛡️', kinds: ['civil_defense', 'temp_housing', 'quake', 'tsunami'] },
    { id: 'rest', ko: '쉼터', en: 'Shelters', icon: '🌡️', kinds: ['heat', 'cold', 'dust'] },
    { id: 'help', ko: '도움', en: 'Help', icon: '🆘', kinds: ['townhall', 'er', 'pharmacy', 'health', 'fire', 'police', 'meal', 'water', 'chem'] },
    { id: 'hazard', ko: '위험 지점', en: 'Hazards', icon: '⚠️', kinds: ['steep', 'wildfire_hist'] },
  ];
  const en = getLang() === 'en', K = id => state.shelters.avail.find(a => a.id === id);
  const chip = k => `<label><input type="checkbox" value="${k.id}" ${state.shelters.active.has(k.id) ? 'checked' : ''}><span>${k.icon} ${en ? k.en : k.ko}</span></label>`;
  box.innerHTML = `<button type="button" class="wxsel-t mono" id="shselT">${t('sh.title')}</button>` + GROUPS.map(g => {
    const ks = g.kinds.map(K).filter(Boolean); if (!ks.length) return '';
    const allOn = ks.every(k => state.shelters.active.has(k.id));
    return `<div class="shgrp"><button type="button" class="shgrp-t ${allOn ? 'is-on' : ''}" data-grp="${g.id}">${g.icon} ${en ? g.en : g.ko}</button><div class="shgrp-k">${ks.map(chip).join('')}</div></div>`;
  }).join('');
  const save = () => { localStorage.setItem('safepic.shelters', JSON.stringify([...state.shelters.active])); syncShelterLayers(); renderRegion(); };
  $('#shselT').addEventListener('click', () => box.classList.toggle('is-open'));
  $$('input', box).forEach(i => i.addEventListener('change', () => { i.checked ? state.shelters.active.add(i.value) : state.shelters.active.delete(i.value); const g = i.closest('.shgrp'); g.querySelector('.shgrp-t').classList.toggle('is-on', $$('input', g).every(x => x.checked)); save(); }));
  $$('.shgrp-t', box).forEach(b => b.addEventListener('click', () => { const g = b.closest('.shgrp'), on = !b.classList.contains('is-on'); $$('input', g).forEach(i => { i.checked = on; on ? state.shelters.active.add(i.value) : state.shelters.active.delete(i.value); }); b.classList.toggle('is-on', on); save(); }));
  document.addEventListener('click', e => { if (!e.target.closest('#shsel')) box.classList.remove('is-open'); });
  syncShelterLayers();
}
function syncShelterLayers() {
  if (!map || !state.shelters.avail.length) return;
  const kinds = state.sido ? [...state.shelters.active].filter(k => state.shelters.avail.some(a => a.id === k)) : [];
  setShelters(kinds, state.sido);
  renderLegend(kinds);
}
/* 지도 범례: 켜진 시설 색 + (격자 표시 중이면) 격자 범례 */
function renderLegend(kinds) {
  const box = $('#mapLegend'); if (!box) return;
  const en = getLang() === 'en';
  const sh = kinds.map(k => state.shelters.avail.find(a => a.id === k)).filter(Boolean);
  const g = state._gridLegend;
  if (!sh.length && !g) { box.hidden = true; return; }
  box.hidden = false;
  const mobile = matchMedia(MQ_MOBILE).matches; box.classList.toggle('is-min', mobile && !state._legendOpen);
  box.innerHTML = `<button type="button" class="lg-toggle" id="lgToggle">${t('legend.title')} ${sh.length ? `<span class="lg-dots">${sh.map(k => `<i style="background:${k.color}"></i>`).join('')}</span>` : ''}</button>` + (sh.length ? `<div class="lg-row">${sh.map(k => `<span><i style="background:${k.color}"></i>${k.icon} ${en ? k.en : k.ko}</span>`).join('')}</div>` : '') +
    (g ? `<div class="lg-row lg-grid"><b>${g.title}</b>${g.html}</div>` : '') + `<small class="lg-src">${t('legend.src')}</small>`;
  $('#lgToggle').addEventListener('click', () => { state._legendOpen = !state._legendOpen; box.classList.toggle('is-min', mobile && !state._legendOpen); });
}
async function renderNearest() {
  const box = $('#nearBox'); if (!box) return;
  const e = state.emd && state.idx.byEmd.get(state.emd);
  if (!e || !state.shelters.avail.length) { box.hidden = true; return; }
  const kinds = [...state.shelters.active].filter(k => { const a = state.shelters.avail.find(x => x.id === k); return a && !a.hazard; });
  const useGps = state.gps && state.gps.emd === e.code;
  const origin = useGps ? [state.gps.lon, state.gps.lat] : [e.lon, e.lat];
  const list = await nearestShelters(origin, kinds, state.sido, 8, true);
  if (state.emd !== e.code) return;
  box.hidden = false;
  box.innerHTML = `<h3>${t('sh.nearest')} <small class="muted">${useGps ? t('sh.fromGps') : t('sh.fromEmd')}</small></h3>` + (list.length ? list.map((x, i) => `<button type="button" class="near-item" data-i="${i}"><span class="near-ic">${x.k.icon}</span><span class="near-main"><b>${x.p.name || '-'}</b><small>${getLang() === 'en' ? x.k.en : x.k.ko}${x.p.cap ? ` · ${x.p.cap}` : ''}</small></span><span class="near-walk mono">${t('sh.walk', { n: x.walk })}</span></button>`).join('') : `<div class="muted" style="font-size:.9rem">${t('sh.none')}</div>`);
  $$('.near-item', box).forEach(b => b.addEventListener('click', () => { const x = list[+b.dataset.i]; map.flyTo({ center: x.c, zoom: 15.5, padding: visiblePadding() }); openPopup(x.c, `<b>${x.p.name || ''}</b><br><small>${x.p.addr || ''}${x.p.tel ? `<br>📞 <a href="tel:${x.p.tel}">${x.p.tel}</a>` : ''}</small>${routeLinks(x.c[0], x.c[1], x.p.name)}`, { fromPanel: true }); }));
}

/* ---------- names / live lookups ---------- */
function nameOf() {
  const e = state.emd && state.idx.byEmd.get(state.emd), s = state.sgg && state.idx.bySgg.get(state.sgg);
  const sidoName = (e && e.sido_name) || (s && s.sido_name) || (state.sido && (featuresWhere(state.geo.sido, 'code', state.sido)[0] || { properties: {} }).properties.name) || '';
  return { sidoName, sggName: (e && e.sgg_name) || (s && s.name) || '', emdName: e ? e.name : '' };
}
const weatherFor = sgg => (state.live.weather && state.live.weather.by_sgg && state.live.weather.by_sgg[String(sgg)]) || null;
const airFor = sgg => (state.live.air && state.live.air.by_sgg && state.live.air.by_sgg[String(sgg)]) || null;
function warningsFor(sgg, sido) {
  const a = state.live.alerts; if (!a || !a.warnings || !a.warnings.items) return [];
  const n = nameOf();
  return a.warnings.items.filter(w => (w.area_codes || []).some(c => c === String(sgg) || c === String(sido)) || (w.areas || []).some(x => (n.sggName && x.includes(n.sggName)) || (n.sidoName && x === n.sidoName)));
}
const pmGrade = (v, pm25) => v == null ? '' : pm25 ? (v <= 15 ? 'g-good' : v <= 35 ? 'g-mod' : v <= 75 ? 'g-bad' : 'g-vbad') : (v <= 30 ? 'g-good' : v <= 80 ? 'g-mod' : v <= 150 ? 'g-bad' : 'g-vbad');
function wxItems(sgg) {
  const w = weatherFor(sgg), a = airFor(sgg), out = [];
  const push = (k, v, unit, cls = '') => { if (state.wxsel.has(k) && v != null) out.push({ k, label: t('wx.' + k), v, unit, cls }); };
  if (w) { push('t', w.t != null ? w.t.toFixed(1) : null, '℃'); push('feels', w.feels != null ? w.feels.toFixed(1) : null, '℃'); push('rain', w.rn1 != null ? w.rn1 : null, 'mm'); push('reh', w.reh, '%'); push('wind', w.wsd, 'm/s'); }
  if (a) { push('pm10', a.pm10, '㎍/㎥', pmGrade(a.pm10)); push('pm25', a.pm25, '㎍/㎥', pmGrade(a.pm25, true)); }
  return out;
}

/* ---------- panel: region ---------- */
function renderCrumb() {
  const n = nameOf(), c = $('#crumb'); c.innerHTML = '';
  const add = (label, go, last) => { const b = document.createElement('button'); b.className = 'crumb-item' + (last ? ' is-last' : ''); b.textContent = label; b.onclick = go; c.appendChild(b); };
  const sep = () => { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; c.appendChild(s); };
  add(t('nav.nation'), resetNation, state.level === 'nation');
  if (state.sido) { sep(); add(n.sidoName, () => selectSido(state.sido), state.level === 'sido'); }
  if (state.sgg) { sep(); add(n.sggName, () => selectSgg(state.sgg), state.level === 'sgg'); }
  if (state.emd) { sep(); add(n.emdName, () => {}, true); }
}
/* ---------- today's to-do (3 lines): warnings > situation > season ---------- */
const ALERT_MAP = { // 특보 종류·단계 → 행동 문구 키 + 자동 시설
  '폭염': { key: 'heat', kinds: ['heat'] }, '호우': { key: 'rain', kinds: ['temp_housing', 'civil_defense'] }, '대설': { key: 'snow', kinds: ['cold'] },
  '강풍': { key: 'wind', kinds: [] }, '한파': { key: 'cold', kinds: ['cold'] }, '건조': { key: 'dry', kinds: [] }, '태풍': { key: 'typhoon', kinds: ['temp_housing', 'civil_defense'] },
  '지진': { key: 'quake', kinds: ['quake'] }, '풍랑': { key: 'sea', kinds: [] }, '황사': { key: 'dust', kinds: ['dust'] },
};
function todoItems() {
  const ws = warningsFor(state.sgg, state.sido), m = new Date().getMonth() + 1, out = [], seen = new Set();
  const add = (key, kind) => { if (seen.has(key) || out.length >= 3) return; seen.add(key); out.push({ text: t('todo.' + key), kind }); };
  const P = getProfile();
  for (const w of ws) { const a = ALERT_MAP[w.type]; if (!a) continue; let lv = /경보/.test(w.level) ? 'warn' : 'adv';
    if (P.floor === 'semi' && a.key === 'rain') lv = 'warn';                       // 반지하: 호우는 주의보도 경보 문구로
    if (a.key === 'heat' && (P.senior || P.child)) add('prof.heat.senior', 'heat');  // 어르신·영유아: 폭염 우선 문구
    if (a.key === 'wind' && P.floor === 'high') add('prof.wind.high');
    add(`alert.${a.key}.${lv}`, a.kinds[0]); }
  if (P.floor === 'semi' && (m >= 6 && m <= 9)) add('prof.semi.summer', 'temp_housing');
  if (P.mob) add('prof.mob', 'temp_housing');
  if (P.pet && (state.sit === 'evacuating' || ws.length)) add('prof.pet');
  if (P.car && ws.some(w => w.type === '호우' || w.type === '태풍')) add('prof.car');
  if (state.sit === 'house_flood' || state.sit === 'shop_flood') { add('sit.photo'); add('sit.report10', 'townhall'); }
  if (state.sit === 'evacuating') { add('sit.evac', 'civil_defense'); add('sit.meds', 'pharmacy'); }
  if (state.sit === 'injury') { add('sit.er', 'er'); add('sit.psych'); }
  if (state.sit === 'no_news') { add('sit.ask', 'townhall'); }
  if (m >= 6 && m <= 9) { add('season.summer.water', 'heat'); add('season.summer.drain'); }
  else if (m === 12 || m <= 2) { add('season.winter.taps', 'cold'); add('season.winter.ice'); }
  else if (m >= 3 && m <= 5) { add('season.spring.fire'); add('season.spring.dust', 'dust'); }
  else { add('season.autumn.typhoon', 'temp_housing'); }
  add('always.shelter', 'civil_defense'); add('always.townhall', 'townhall');
  return out.slice(0, 3);
}
function renderTodo() {
  const box = $('#todoCard'); if (!box) return;
  if (!state.sgg) { box.hidden = true; return; }
  const items = todoItems(); box.hidden = !items.length;
  box.innerHTML = `<h3>${t('todo.title')} <button type="button" class="speak-mini" id="todoSpeak" title="${t('tts.title')}">🔊</button></h3><ol class="todo-list">${items.map((x, i) => `<li><span>${x.text}</span>${x.kind && state.shelters.avail.some(a => a.id === x.kind) ? `<button type="button" class="btn btn-ghost btn-sm" data-kind="${x.kind}">${t('todo.show')}</button>` : ''}</li>`).join('')}</ol>`;
  $('#todoSpeak').addEventListener('click', () => speak(items.map((x, i) => `${i + 1}. ${x.text}`).join('. '), $('#todoSpeak')));
  $$('button[data-kind]', box).forEach(b => b.addEventListener('click', () => { state.shelters.active.add(b.dataset.kind); localStorage.setItem('safepic.shelters', JSON.stringify([...state.shelters.active])); $$('#shsel input').forEach(i => i.checked = state.shelters.active.has(i.value)); syncShelterLayers(); renderNearest(); }));
}
/* ---------- 풍수해보험 안내 (사전 대비) — 보험료표는 공개 자료가 없어 지원율·창구·동네 이력만 ---------- */
function renderInsurance() {
  const box = $('#insCard'); if (!box) return;
  if (state.level !== 'emd' || !state.rules) { box.hidden = true; return; }
  const rules = (state.rules.all || []).filter(r => r.group === 'insurance' && (r.conditions.housing || []).includes('own'));
  if (!rules.length) { box.hidden = true; return; }
  const gen = rules.find(r => r.id === 'insurance.house_general'), full = rules.find(r => /full/.test(r.id));
  const cells = gridCells(state.sgg), e = state.idx.byEmd.get(state.emd);
  const mine = e ? cells.map(f => f.properties).filter(p => p.emd_name === e.name) : [];
  const flood = mine.length ? mine.filter(p => p.flood_hist_n > 0).length : null;
  const hist = flood == null ? '' : `<div class="ins-hist">${t('ins.hist', { n: flood, total: mine.length })}</div>`;
  box.hidden = false;
  box.innerHTML = `<h3>${t('ins.title')}</h3>${hist}<div class="ins-rate"><b>${gen ? gen.amount_text : ''}</b><small class="muted"> · ${full ? full.amount_text : ''} (${t('ins.full.who')})</small></div><div class="fine">${t('ins.where')} · <a href="https://www.mois.go.kr/frt/sub/a06/b08/pungsuhaeIns/screen.do" target="_blank" rel="noopener">${t('ins.link')}</a> · ${t('badge.asof')} ${(state.rules.insurance && state.rules.insurance.meta && state.rules.insurance.meta.asof) || '2026-08'}</div>`;
}
/* ---------- 주민 제보 (Worker KV, 텍스트만, 7일) ---------- */
const REPORT_KINDS = ['shelter_closed', 'drain', 'road', 'water', 'other'];
async function renderReports() {
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
  const res = await getReports(sgg); if (state.sgg !== sgg) return;
  if (res.status !== 'ok') { list.innerHTML = `<div class="muted">${t(res.status === 'offline' ? 'rep.offline' : 'rep.err')}</div>`; } else paint(res.items);
  $('#repForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, btn = f.querySelector('button'); btn.disabled = true;
    const gps = state.gps && state.gps.emd === state.emd ? { lon: state.gps.lon, lat: state.gps.lat } : {};
    const r = await postReport({ sgg, emd: state.emd, kind: f.kind.value, text: f.text.value, ...gps });
    btn.disabled = false;
    if (r.status === 'ok') { f.reset(); const again = await getReports(sgg); if (again.status === 'ok') paint(again.items); }
    else alert(t(r.status === 'rate_limited' ? 'rep.limit' : r.message ? 'rep.nolink' : 'rep.err'));
  });
}
function paintReportMarkers(items) {
  if (!map) return;
  const fc = { type: 'FeatureCollection', features: items.filter(r => r.lon && r.lat).map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { kind: r.kind, text: r.text } })) };
  if (map.getSource('reports')) map.getSource('reports').setData(fc);
  else {
    map.addSource('reports', { type: 'geojson', data: fc });
    map.addLayer({ id: 'reports-dot', type: 'circle', source: 'reports', paint: { 'circle-radius': 7, 'circle-color': '#d9a400', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.on('click', 'reports-dot', e => { const p = e.features[0].properties; openPopup(e.lngLat, `<b>${t('rep.k.' + p.kind)}</b><br><small>${escapeHTML(p.text)}</small>`); });
  }
}
const escapeHTML = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function relTime(ts) { const m = Math.round((Date.now() - ts) / 60000); if (m < 60) return t('rel.min', { n: m }); const h = Math.round(m / 60); if (h < 24) return t('rel.hour', { n: h }); return t('rel.day', { n: Math.round(h / 24) }); }
function renderRegion() {
  const landing = $('#nowLanding'), reg = $('#nowRegion');
  if (state.level === 'nation') { landing.hidden = false; reg.hidden = true; return; }
  landing.hidden = true; reg.hidden = false;
  const n = nameOf();
  $('#regionPath').textContent = [n.sidoName, state.level !== 'sido' && n.sggName].filter(Boolean).join(' › ');
  $('#regionName').textContent = state.level === 'emd' ? n.emdName : state.level === 'sgg' ? n.sggName : n.sidoName;
  $('#levelGuide').innerHTML = ['sido', 'sgg', 'emd'].map(l => `<span class="${state.level === l ? 'on' : ''}">${t('lv.' + l)}</span>`).join('');
  renderTodo(); renderInsurance(); renderReports();
  // weather + air
  const wx = $('#wxCard');
  if (state.sgg) {
    const items = wxItems(state.sgg);
    if (items.length) {
      const srcs = [state.emd && t('wx.basis', { name: nameOf().sggName }), weatherFor(state.sgg) && t('wx.src'), airFor(state.sgg) && t('air.src')].filter(Boolean).join(' · ');
      wx.innerHTML = items.map(i => `<div class="wx-item ${i.cls}"><div class="k">${i.label}</div><div class="v">${i.v}<small>${i.unit}</small></div></div>`).join('') + `<div class="wx-src">${srcs} · ${fmtTime((state.live.weather || {}).updated || (state.live.air || {}).updated)}</div>`;
    } else {
      const st = state.live.weather && state.live.weather.status;
      wx.innerHTML = `<div class="wx-empty">${st === 'no_key' ? t('wx.noKey') : t('wx.noData')}</div>`;
    }
  } else wx.innerHTML = `<div class="wx-empty">${t('wx.pickSgg')}</div>`;
  // warnings
  const ws = warningsFor(state.sgg, state.sido);
  $('#warnCard').innerHTML = ws.map(w => `<div class="warn-item"><span class="warn-level ${/주의보/.test(w.level) ? 'adv' : ''}">${w.type}${w.level}</span><div><div>${(w.areas || []).slice(0, 4).join(', ')}</div><small class="muted">${fmtTime(w.since)}</small></div></div>`).join('');
  // kv
  const e = state.emd && state.idx.byEmd.get(state.emd), kv = [], P = t('kv.places');
  if (state.level === 'sido') kv.push([t('kv.sggCount'), state.idx.sgg.filter(x => String(x.sido) === state.sido).length + P], [t('kv.emdCount'), state.idx.emd.filter(x => String(x.sido) === state.sido).length + P]);
  if (state.level === 'sgg') kv.push([t('kv.emdCount'), state.idx.emd.filter(x => String(x.sgg) === state.sgg).length + P], [t('kv.sido'), n.sidoName]);
  if (e) kv.push([t('kv.sgg'), n.sggName], [t('kv.code'), e.code], [t('kv.grid'), `${e.nx}, ${e.ny}`]);
  $('#regionKv').innerHTML = kv.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');
  $('#regionKv').style.display = kv.length ? '' : 'none';
  $('#regionNote').innerHTML = state.level === 'emd'
    ? (ws.length ? `<b>${t('note.warn', { w: ws.map(w => w.type + w.level).join(', ') })}</b>` : `<small class="muted">${t('note.calm')}</small>`)
    : `<small class="muted">${state.level === 'sido' ? t('note.pickSgg') : t('note.pickEmd')}</small>`;
  const ch = $('#regionChildren'); ch.innerHTML = '';
  let kids = [];
  if (state.level === 'sido') kids = state.idx.sgg.filter(s => String(s.sido) === state.sido).map(s => ({ name: s.name, go: () => selectSgg(s.code) }));
  if (state.level === 'sgg') kids = state.idx.emd.filter(x => String(x.sgg) === state.sgg).map(x => ({ name: x.name, go: () => selectEmd(x.code) }));
  kids.sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(k => { const b = document.createElement('button'); b.textContent = k.name; b.onclick = k.go; ch.appendChild(b); });
  $('#btnFindHere').hidden = !state.sgg;
  renderNearest();
}
function renderLive() { /* live strip retired; weather lives in the region card */ }
function fmtTime(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return String(iso); const p = x => String(x).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

/* ---------- weather selector ---------- */
function initWxSel() {
  $('#wxselT').addEventListener('click', () => $('#wxsel').classList.toggle('is-open'));
  document.addEventListener('click', e => { if (!e.target.closest('#wxsel')) $('#wxsel').classList.remove('is-open'); });
  $$('#wxsel input').forEach(i => { i.checked = state.wxsel.has(i.value); i.addEventListener('change', () => { i.checked ? state.wxsel.add(i.value) : state.wxsel.delete(i.value); localStorage.setItem('safepic.wxsel', JSON.stringify([...state.wxsel])); renderRegion(); renderLive(); }); });
}

/* ---------- search ---------- */
function initSearch() {
  $('#btnLocate').addEventListener('click', locateMe);
  const inp = $('#searchInput'), list = $('#searchList'); let hot = -1, items = [];
  const render = () => { list.innerHTML = items.map((it, i) => `<li class="${i === hot ? 'is-hot' : ''}" data-i="${i}"><span>${it.name}</span><small>${it.path}</small></li>`).join(''); list.hidden = !items.length; };
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); hot = -1; if (!q) { items = []; render(); return; }
    const sg = state.idx.sgg.filter(s => s.name.includes(q)).slice(0, 6).map(s => ({ name: s.name, path: s.sido_name, go: () => selectSgg(s.code) }));
    const em = state.idx.emd.filter(e => e.name.includes(q)).slice(0, 12).map(e => ({ name: e.name, path: `${e.sido_name} ${e.sgg_name}`, go: () => selectEmd(e.code) }));
    items = [...sg, ...em]; render();
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

/* ---------- tabs / panel / lang ---------- */
function setTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === tab));
  $('#panel').classList.remove('is-collapsed'); $('#panelScroll').scrollTop = 0;
  if (tab === 'about') renderRulesTable();
  setTimeout(() => map && map.resize(), 260);
}
function initPanel() {
  const p = $('#panel');
  const saved = +localStorage.getItem('safepic.panelW'); if (saved >= 320) document.documentElement.style.setProperty('--panel-w', saved + 'px');
  const rz = $('#panelResize'); let dragging = false;
  const onMove = e => { if (!dragging) return; const x = (e.touches ? e.touches[0].clientX : e.clientX); const w = Math.min(Math.max(x, 320), Math.min(innerWidth - 360, 820)); document.documentElement.style.setProperty('--panel-w', w + 'px'); };
  const onUp = () => { if (!dragging) return; dragging = false; document.body.classList.remove('is-resizing'); localStorage.setItem('safepic.panelW', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'))); map && map.resize(); };
  rz.addEventListener('mousedown', e => { dragging = true; document.body.classList.add('is-resizing'); e.preventDefault(); });
  rz.addEventListener('touchstart', () => { dragging = true; }, { passive: true });
  addEventListener('mousemove', onMove); addEventListener('touchmove', onMove, { passive: true }); addEventListener('mouseup', onUp); addEventListener('touchend', onUp);
  rz.addEventListener('dblclick', () => { document.documentElement.style.setProperty('--panel-w', '460px'); localStorage.removeItem('safepic.panelW'); map && map.resize(); });
  const drawer = $('#drawer'), bg = $('#drawerBg'), hb = $('#btnPanel');
  const openDrawer = on => { drawer.hidden = !on; bg.hidden = !on; hb.setAttribute('aria-expanded', on); document.body.classList.toggle('drawer-open', on); };
  hb.addEventListener('click', () => openDrawer(drawer.hidden));
  $('#drawerX').addEventListener('click', () => openDrawer(false)); bg.addEventListener('click', () => openDrawer(false));
  addEventListener('keydown', e => { if (e.key === 'Escape') openDrawer(false); });
  $$('.drawer-link[data-tab]').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); openDrawer(false); }));
  const togglePanel = () => { p.classList.toggle('is-collapsed'); p.classList.remove('is-tall'); p.style.height = ''; localStorage.setItem('safepic.panelCollapsed', p.classList.contains('is-collapsed') ? '1' : '0'); setTimeout(() => map && map.resize(), 280); };
  $('#btnPanelToggle').addEventListener('click', () => { togglePanel(); openDrawer(false); });
  $('#panelTab').addEventListener('click', togglePanel);
  if (!matchMedia(MQ_MOBILE).matches && localStorage.getItem('safepic.panelCollapsed') === '1') p.classList.add('is-collapsed');
  // bottom sheet (mobile): the sheet follows the finger, then snaps to collapsed / half / tall
  const g = $('.panel-grip'); let y0 = 0, h0 = 0, sheetDrag = false, moved = false;
  const snapTo = cls => { p.classList.remove('is-collapsed', 'is-tall'); if (cls) p.classList.add(cls); p.style.height = ''; setTimeout(() => map && map.resize(), 280); };
  const shStart = e => { if (!matchMedia(MQ_MOBILE).matches) return; sheetDrag = true; moved = false; y0 = e.touches[0].clientY; h0 = p.getBoundingClientRect().height; p.style.transition = 'none'; };
  const shMove = e => { if (!sheetDrag) return; const dy = e.touches[0].clientY - y0; if (Math.abs(dy) > 4) moved = true; const h = Math.max(64, Math.min(innerHeight - 60, h0 - dy)); p.style.height = h + 'px'; };
  const shEnd = e => { if (!sheetDrag) return; sheetDrag = false; p.style.transition = ''; const dy = e.changedTouches[0].clientY - y0;
    const cur = p.classList.contains('is-collapsed') ? 'is-collapsed' : p.classList.contains('is-tall') ? 'is-tall' : '';
    if (!moved) { snapTo(cur === 'is-tall' ? '' : 'is-tall'); return; }
    // direction + distance, one step at a time: a pull of 70px+ commits (no spring-back to where it was)
    const STEP = 70; let target = cur;
    if (dy > STEP) target = cur === 'is-tall' ? '' : 'is-collapsed';        // down: tall→half→collapsed
    else if (dy < -STEP) target = cur === 'is-collapsed' ? '' : 'is-tall';  // up: collapsed→half→tall
    if (Math.abs(dy) > innerHeight * 0.45) target = dy > 0 ? 'is-collapsed' : 'is-tall'; // long pull jumps to the end
    snapTo(target); };
  g.addEventListener('touchstart', shStart, { passive: true }); g.addEventListener('touchmove', shMove, { passive: true }); g.addEventListener('touchend', shEnd);
  // also allow sheetDrag from the sheet header area when the list is scrolled to the top
  const ps = $('#panelScroll');
  ps.addEventListener('touchstart', e => { if (ps.scrollTop <= 0 && matchMedia(MQ_MOBILE).matches) { shStart(e); sheetDrag = false; y0 = e.touches[0].clientY; } }, { passive: true });
  ps.addEventListener('touchmove', e => { if (!sheetDrag && ps.scrollTop <= 0 && e.touches[0].clientY - y0 > 12 && !p.classList.contains('is-collapsed')) { sheetDrag = true; moved = true; h0 = p.getBoundingClientRect().height; y0 = e.touches[0].clientY; p.style.transition = 'none'; } if (sheetDrag) shMove(e); }, { passive: true });
  ps.addEventListener('touchend', e => { if (sheetDrag) shEnd(e); });
}
function initPWA() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=20260823i').catch(() => {});
  let deferred = null; const row = $('#installRow');
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (!localStorage.getItem('safepic.installDismissed')) row.hidden = false; });
  $('#btnInstall').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; row.hidden = true; });
  $('#btnInstallX').addEventListener('click', () => { row.hidden = true; localStorage.setItem('safepic.installDismissed', '1'); });
  const badge = () => document.documentElement.classList.toggle('offline', !navigator.onLine);
  addEventListener('online', badge); addEventListener('offline', badge); badge();
}
/* ---------- 우리 집 프로필 (localStorage only) ---------- */
function getProfile() { try { return JSON.parse(localStorage.getItem('safepic.profile') || '{}'); } catch { return {}; } }
function initProfile() {
  const P = getProfile();
  const f = $('#pfFloor'); f.value = P.floor || '';
  const boxes = { senior: $('#pfSenior'), child: $('#pfChild'), mob: $('#pfMob'), car: $('#pfCar'), pet: $('#pfPet') };
  for (const k in boxes) boxes[k].checked = !!P[k];
  const save = () => { const o = { floor: f.value || null }; for (const k in boxes) o[k] = boxes[k].checked; localStorage.setItem('safepic.profile', JSON.stringify(o)); renderRegion(); };
  f.addEventListener('change', save); Object.values(boxes).forEach(b => b.addEventListener('change', save));
}
function initSize() {
  const root = document.documentElement, KEY = 'safepic.size';
  const apply = v => { root.classList.toggle('big', v === 'big'); $$('.size-btn').forEach(b => b.classList.toggle('is-on', b.dataset.size === v)); setTimeout(() => map && map.resize(), 50); };
  const set = v => { localStorage.setItem(KEY, v); apply(v); };
  const saved = localStorage.getItem(KEY);
  apply(saved || 'normal');
  $$('.size-btn[data-size]').forEach(b => b.addEventListener('click', () => set(b.dataset.size)));
  const cb = $('#btnContrast'), CK = 'safepic.contrast';
  const applyC = on => { root.classList.toggle('contrast', on); cb.checked = on; };
  applyC(localStorage.getItem(CK) === '1');
  cb.addEventListener('change', () => { localStorage.setItem(CK, cb.checked ? '1' : '0'); applyC(cb.checked); });
  if (!saved && !localStorage.getItem('safepic.sizeCoach')) {
    const c = $('#sizeCoach'); c.hidden = false;
    const done = () => { c.hidden = true; localStorage.setItem('safepic.sizeCoach', '1'); };
    $('#sizeCoachX').addEventListener('click', done);
    $('#btnPanel').addEventListener('click', done, { once: true });
    setTimeout(done, 8000);
  }
}
/* rules are authored in Korean; rules/en.json overlays label/amount_text/summary/where/docs when the UI is English */
const RULE_L10N = ['label', 'amount_text', 'summary', 'where', 'docs'];
function applyRulesLang() {
  if (!state.rules || !state.rules.all) return;
  const en = getLang() === 'en' && state.rulesEn && state.rulesEn.rules;
  for (const r of state.rules.all) {
    if (!r._ko) { r._ko = {}; RULE_L10N.forEach(k => { r._ko[k] = r[k]; }); }
    const o = en && en[r.id];
    RULE_L10N.forEach(k => { r[k] = o && o[k] != null ? o[k] : r._ko[k]; });
  }
  const steps = (state.rules.procedures && state.rules.procedures.steps) || [], enS = getLang() === 'en' && state.rulesEn && state.rulesEn.steps;
  for (const s of steps) {
    if (!s._ko) { s._ko = {}; ['label', 'summary', 'where', 'docs', 'typical_days'].forEach(k => { s._ko[k] = s[k]; }); }
    const o = enS && enS[s.id];
    ['label', 'summary', 'where', 'docs', 'typical_days'].forEach(k => { s[k] = o && o[k] != null ? o[k] : s._ko[k]; });
  }
}
function initLang() {
  const paint = () => $$('.lang-btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === getLang()));
  paint();
  $$('.lang-btn').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang, () => {
    paint(); setRulesLang(getLang()); applyRulesLang(); renderAll(); syncWizardLoc(); if (state.shelters.avail.length) initShelterUI();
    if (map && map.getLayer('eastsea-label')) map.setLayoutProperty('eastsea-label', 'text-field', getLang() === 'en' ? 'East Sea' : '동해\nEast Sea');
    if (state.lastResult && evaluate) { state.lastResult.res = evaluate(state.rules, state.lastResult.inp, getLang()); renderResult(state.lastResult.res, state.lastResult.inp); }
    if ($('#rulesTable').dataset.done) { delete $('#rulesTable').dataset.done; if (state.tab === 'about') renderRulesTable(); }
  })));
}

/* ---------- situation presets ---------- */
const PRESETS = { house_flood: { housing: 'own', damage: ['flood'] }, shop_flood: { housing: 'shop', damage: ['flood'] }, injury: { damage: ['injury'] }, no_news: { damage: ['flood'] } };
function applyPreset(sit) {
  const f = $('#wizard'); f.reset(); const p = PRESETS[sit]; if (!p) return;
  if (p.housing) { const r = f.querySelector(`input[name=housing][value=${p.housing}]`); if (r) r.checked = true; }
  (p.damage || []).forEach(v => { const c = f.querySelector(`input[name=damage][value=${v}]`); if (c) c.checked = true; });
}
function initCards() {
  $$('#sitCards .card').forEach(b => b.addEventListener('click', () => {
    const sit = b.dataset.sit; state.sit = sit; sessionStorage.setItem('safepic.sit', sit);
    // situation → facilities that matter right now
    const AUTO = { evacuating: ['civil_defense', 'temp_housing', 'fire', 'water'], house_flood: ['townhall', 'temp_housing'], shop_flood: ['townhall'], injury: ['er', 'pharmacy'], no_news: ['townhall'], before_rain: ['civil_defense', 'townhall'] };
    const PP = getProfile(); if (AUTO[sit]) { const extra = [...(PP.senior ? ['heat', 'cold'] : []), ...(PP.mob ? ['temp_housing'] : []), ...(PP.child || PP.senior ? ['er'] : [])]; [...AUTO[sit], ...extra].forEach(k => state.shelters.active.add(k)); localStorage.setItem('safepic.shelters', JSON.stringify([...state.shelters.active])); $$('#shsel input').forEach(i => i.checked = state.shelters.active.has(i.value)); syncShelterLayers(); }
    if (sit === 'evacuating' || sit === 'before_rain') { $('#mapHint').textContent = t('hint.start'); $('#mapHint').classList.remove('is-hidden'); $('#searchInput').focus(); return; }
    applyPreset(sit); setTab('find'); syncWizardLoc();
    if (sit === 'no_news') setTimeout(() => $('#wizard').requestSubmit(), 50);
  }));
}

/* ---------- wizard ---------- */
function syncWizardLoc() {
  const n = nameOf(), box = $('#qLoc');
  box.innerHTML = state.sgg ? `<b>${[n.sidoName, n.sggName, state.emd && n.emdName].filter(Boolean).join(' ')}</b><button type="button" class="btn btn-ghost" id="btnChangeLoc">${t('wiz.change')}</button>` : `<span class="muted">${t('wiz.loc.empty')}</span>`;
  const b = $('#btnChangeLoc'); if (b) b.onclick = () => { setTab('now'); $('#searchInput').focus(); };
}
function readWizard() {
  const fd = new FormData($('#wizard'));
  return { housing: fd.get('housing') || null, damage: fd.getAll('damage'), household: fd.getAll('household'), special_zone: $('#qSpecial').checked ? true : null, household_unknown: $('#qUnknown').checked, event_end: fd.get('event_end') || null, today: new Date().toISOString().slice(0, 10), hazard: 'rain', proxy: $('#qProxy').checked, emd: state.emd, sgg: state.sgg };
}
function encodeShare(inp) {
  const p = new URLSearchParams();
  if (inp.emd) p.set('emd', inp.emd); else if (inp.sgg) p.set('sgg', inp.sgg); if (inp.housing) p.set('h', inp.housing);
  if (inp.damage.length) p.set('d', inp.damage.join(',')); if (inp.household.length) p.set('f', inp.household.join(','));
  if (inp.special_zone) p.set('sz', '1'); if (inp.event_end) p.set('end', inp.event_end); if (inp.proxy) p.set('p', '1'); p.set('l', getLang());
  return '#r?' + p.toString();
}
async function applyShare(hash) {
  if (!hash.startsWith('#r?')) return;
  const p = new URLSearchParams(hash.slice(3)), f = $('#wizard'); f.reset();
  if (p.get('l') && p.get('l') !== getLang()) setLang(p.get('l'));
  if (p.get('h')) { const r = f.querySelector(`input[name=housing][value=${p.get('h')}]`); if (r) r.checked = true; }
  (p.get('d') || '').split(',').filter(Boolean).forEach(v => { const c = f.querySelector(`input[name=damage][value=${v}]`); if (c) c.checked = true; });
  (p.get('f') || '').split(',').filter(Boolean).forEach(v => { const c = f.querySelector(`input[name=household][value=${v}]`); if (c) c.checked = true; });
  $('#qSpecial').checked = p.get('sz') === '1'; $('#qProxy').checked = p.get('p') === '1';
  if (p.get('end')) $('#qEnd').value = p.get('end');
  if (p.get('emd')) await selectEmd(p.get('emd')); else if (p.get('sgg')) await selectSgg(p.get('sgg'));
  setTab('find'); f.requestSubmit();
}
function initWizard() {
  const f = $('#wizard');
  f.addEventListener('submit', e => { e.preventDefault(); runResult(); });
  f.addEventListener('reset', () => { $('#result').hidden = true; state.lastResult = null; history.replaceState(null, '', location.pathname); });
  $('#btnFindHere').addEventListener('click', () => { setTab('find'); syncWizardLoc(); });
  syncWizardLoc();
}
function runResult() {
  const inp = readWizard();
  if (!inp.housing && !inp.damage.length) { alert(t('wiz.need')); return; }
  if (!state.rules || !evaluate) { $('#result').hidden = false; $('#result').innerHTML = `<p>${t('ui.nodata')}</p>`; return; }
  const res = evaluate(state.rules, inp, getLang()); state.lastResult = { res, inp };
  renderResult(res, inp); history.replaceState(null, '', encodeShare(inp));
}
/* ⑪ "왜 해당되나": matchRule의 why 토큰 → 사람이 읽는 문구 */
function whyHTML(why) {
  if (!why || !why.length) return '';
  const P = { housing: 'h.', damage: 'd.', household: 'f.' }, out = [];
  for (const w of why) {
    const m = /^(housing|damage|household)=(.+)$/.exec(w);
    if (m) m[2].split('/').forEach(v => { const k = P[m[1]] + ({ near_poor: 'near', single_parent: 'single', disabled: 'dis' }[v] || v); const s = t(k); if (s !== k) out.push(s); });
    else if (w === '특별재난지역') out.push(t('res.sz'));
  }
  return out.length ? `<div class="item-why">✔ ${t('item.why')} ${out.join(' · ')}</div>` : '';
}
/* ⑪ "조건이 하나 다르면": 실패 조건이 정확히 1개인 규칙 */
function nearMisses(inp) {
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
/* ⑦ 준비할 서류: 매칭된 항목의 docs 합집합, 체크 상태는 세션에 저장 */
function docsHTML(res) {
  const items = [...(res.cash || []), ...(res.relief_fund || []), ...(res.apply || []), ...(res.insurance || [])];
  const docs = [...new Set(items.flatMap(r => r.docs || []))];
  if (!docs.length) return '';
  const done = new Set(JSON.parse(sessionStorage.getItem('safepic.docs') || '[]'));
  return `<div class="result-block docs"><h3>${t('res.docs')}</h3><ul class="doc-list">${docs.map((d, i) => `<li><label><input type="checkbox" data-doc="${i}" ${done.has(d) ? 'checked' : ''}><span>${d}</span></label></li>`).join('')}</ul><small class="muted">${t('res.docs.s')}</small></div>`;
}
function itemHTML(r) {
  const amt = r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '');
  const conf = r.confidence === 'verified' ? '' : `<span class="badge est">${r.confidence === 'reported' ? t('badge.reported') : t('badge.est')}</span>`;
  const sz = r.conditions && r.conditions.special_zone === true ? `<span class="badge sz">${t('res.sz')}</span>` : '';
  return `<div class="item"><div class="item-row"><b>${r.label}${sz}${conf}</b><span class="item-amt">${amt}</span></div>${r.summary ? `<div class="item-sum">${r.summary}</div>` : ''}${whyHTML(r._why)}<div class="item-basis">${r.where ? `${r.where} · ` : ''}${r.basis || ''}${r.basis_url ? ` · <a href="${r.basis_url}" target="_blank" rel="noopener">${t('item.src')}</a>` : ''}${r.rate_asof ? ` · ${t('item.asof')} ${r.rate_asof}` : ''}</div></div>`;
}
function renderResult(res, inp) {
  const n = nameOf(), el = $('#result'); el.hidden = false;
  const place = state.emd ? `${n.sidoName} ${n.sggName} ${n.emdName}` : t('res.noloc');
  const dl = (res.deadlines || [])[0];
  const dlHTML = dl
    ? `<div class="deadline ${dl.days_left < 0 ? 'over' : ''}"><div class="d">${dl.days_left < 0 ? t('res.dl.over', { n: -dl.days_left }) : dl.days_left === 0 ? t('res.dl.today') : t('res.dl.d', { n: dl.days_left })}</div><div><b>${dl.label}</b><br><small class="muted">${t('res.dl.ext', { due: dl.due })}</small></div></div>`
    : `<div class="deadline"><div class="d">${t('res.dl.10')}</div><div><b>${t('res.dl.title')}</b><br><small class="muted">${t('res.dl.s')}</small></div></div>`;
  const icsBtn = dl && dl.days_left >= 0 ? `<button type="button" class="btn btn-ghost btn-sm ics" id="btnIcs">📅 ${t('res.ics')}</button>` : '';
  const sec = (title, arr) => `<div class="result-block"><h3>${title}</h3>${arr && arr.length ? arr.map(itemHTML).join('') : `<div class="muted" style="font-size:.9rem">${t('res.none')}</div>`}</div>`;
  const cashItems = [...(res.cash || []), ...(res.relief_fund || [])];
  // 재난심리회복지원센터: 사람이 다치거나 사망한 경우 — 좌표 대신 전화·주소(행안부 현황 2024-08)
  let psychHTML = '';
  if (state.psych && (inp.damage || []).some(d => d === 'injury' || d === 'death')) {
    const cs = state.psych.centers.filter(c => !state.sido || c.sido === state.sido);
    psychHTML = `<div class="result-block psych"><h3>${t('res.psych')}</h3><div class="psych-hot">📞 <a href="tel:${state.psych.hotline}"><b>${state.psych.hotline}</b></a> <small class="muted">${t('res.psych.hot')}</small></div>${cs.map(c => `<div class="psych-c"><b>${c.name}</b> <a href="tel:${c.tel}" class="mono">${c.tel}</a><br><small class="muted">${c.addr}</small></div>`).join('')}<small class="muted">${t('res.psych.src')}</small></div>`;
  }
  el.innerHTML = `
    <div class="result-head"><div><div class="eyebrow mono">${place}${inp.special_zone ? ' · ' + t('res.sz') : ''}</div><h2>${inp.proxy ? t('res.proxy') : t('res.mine')}</h2></div><div class="result-tools"><button type="button" class="btn btn-ghost btn-sm" id="btnSpeak" title="${t('tts.title')}">🔊</button><button type="button" class="btn btn-ghost" id="btnEdit">${t('res.edit')}</button></div></div>
    <div class="result-block"><h3>${t('res.todo')}</h3><ol class="todo">${(res.todo || []).map(x => `<li><div><b>${x.text || x}</b></div></li>`).join('')}</ol></div>
    ${dlHTML}${icsBtn}
    <div class="print-head"><div>${place} · ${inp.today}</div><div>${t('res.print.for')}</div></div>
    <div class="result-block"><h3>${t('res.cash')}</h3><div class="total">${formatKRW(res.total_cash_krw || 0)}<small>${t('res.cash.s')}${res.total_cash_has_unpriced ? t('res.cash.unpriced') : ''}</small></div>${cashItems.map(itemHTML).join('') || `<div class="muted" style="font-size:.9rem">${t('res.cash.none')}</div>`}</div>
    ${sec(t('res.auto'), res.auto)}
    ${sec(t('res.apply'), res.apply)}
    ${res.insurance && res.insurance.length ? sec(t('res.ins'), res.insurance) : ''}
    ${docsHTML(res)}
    ${(() => { const nm = nearMisses(inp); return nm.length ? `<div class="result-block miss ${inp.household_unknown ? 'is-unknown' : ''}"><h3>${inp.household_unknown ? t('res.maybe') : t('res.miss')}</h3>${inp.household_unknown ? `<small class="muted">${t('res.maybe.s')}</small>` : ''}${nm.map(x => `<div class="miss-item"><b>${x.r.label}</b>${x.r.amount_text ? ` <span class="item-amt">${x.r.amount_text}</span>` : ''}<br><small class="muted">→ ${x.cond}</small></div>`).join('')}</div>` : ''; })()}
    ${psychHTML}
    <div class="result-block"><h3>${t('res.proc')}</h3><ol class="timeline">${(res.timeline || []).map(s => `<li><b>${s.label}</b>${s.due ? ` <span class="badge">${t('badge.due', { d: s.due })}${s.days_left != null ? (s.days_left < 0 ? ' · ' + t('badge.over') : ` · D-${s.days_left}`) : ''}</span>` : ''}<small>${[s.summary, s.where, s.docs && s.docs.length && s.docs.join(', '), s.typical_days].filter(Boolean).join(' · ')}</small></li>`).join('')}</ol></div>
    <div class="share-row"><button type="button" class="btn btn-primary" id="btnCopy">${t('res.copy')}</button><button type="button" class="btn btn-ghost" onclick="print()">${t('res.print')}</button><button type="button" class="btn btn-ghost" id="btnImg">🖼 ${t('res.img')}</button><a class="btn btn-ghost" href="https://www.safekorea.go.kr" target="_blank" rel="noopener">${t('res.report')}</a><span class="copied" id="copied"></span></div>
    <div class="disclaimer">${t('res.disc')}</div>`;
  $('#btnEdit').onclick = () => { el.hidden = true; $('#panelScroll').scrollTop = 0; };
  $('#btnImg').onclick = () => shareImage(res, inp);
  $('#btnSpeak').onclick = () => { const txt = [place, formatKRW(res.total_cash_krw || 0) + ' ' + t('res.cash.s'), dl ? `${dl.label} ${dl.due}` : '', ...(res.todo || []).map(x => x.text || x), ...cashItems.map(r => `${r.label} ${r.amount_text || ''}`)].filter(Boolean).join('. '); speak(txt, $('#btnSpeak')); };
  const ib = $('#btnIcs'); if (ib && dl) ib.onclick = () => downloadICS(`${dl.label} — SafePic`, dl.due, `${place}\n${t('res.dl.ext', { due: dl.due })}\n${location.href}`);
  // print-only: nearest community center (피해신고 접수처)
  if (state.emd && state.shelters.avail.some(a => a.id === 'townhall')) { const e = state.idx.byEmd.get(state.emd); nearestShelters([e.lon, e.lat], ['townhall'], state.sido, 1, true).then(l => { if (l[0] && !el.hidden) { const d = document.createElement('div'); d.className = 'result-block print-only'; d.innerHTML = `<h3>${t('res.print.townhall')}</h3><b>${l[0].p.name}</b><br>${l[0].p.addr || ''}${l[0].p.tel ? ` · ${l[0].p.tel}` : ''} · ${t('sh.walk', { n: l[0].walk })}`; el.querySelector('.share-row').before(d); } }); }
  $$('input[data-doc]', el).forEach(c => c.addEventListener('change', () => { const on = $$('input[data-doc]', el).filter(x => x.checked).map(x => x.nextElementSibling.textContent); sessionStorage.setItem('safepic.docs', JSON.stringify(on)); }));
  $('#btnCopy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); $('#copied').textContent = t('res.copied'); setTimeout(() => $('#copied').textContent = '', 2000); } catch { prompt('URL', location.href); } };
  $('#panelScroll').scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
}

/* ---------- rules table ---------- */
function renderRulesTable() {
  const box = $('#rulesTable'); if (!state.rules || box.dataset.done) return;
  const all = state.rules.all || []; box.hidden = false; box.dataset.done = 1;
  const conf = c => ({ verified: t('conf.verified'), reported: t('conf.reported'), estimated: t('conf.estimated'), pending: t('conf.pending') }[c] || c || '');
  box.innerHTML = `<div class="table-wrap" style="max-height:60vh;border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>${t('rules.h.label')}</th><th>${t('rules.h.amount')}</th><th>${t('rules.h.basis')}</th><th>${t('rules.h.asof')}</th><th>${t('rules.h.conf')}</th></tr></thead><tbody>${all.map(r => `<tr><td><b>${r.label}</b><br><small>${r.summary || ''}</small></td><td class="mono">${r.amount_text || (r.amount_krw ? formatKRW(r.amount_krw) : '-')}</td><td>${r.basis || ''}${r.basis_url ? ` <a href="${r.basis_url}" target="_blank" rel="noopener">↗</a>` : ''}</td><td class="mono">${r.rate_asof || r.effective_from || ''}</td><td><span class="conf conf-${r.confidence || 'na'}">${conf(r.confidence)}</span></td></tr>`).join('')}</tbody></table></div><p class="fine">${t('rules.total', { n: all.length })} <a href="https://github.com/5-Jihwan/safepic/issues" target="_blank" rel="noopener">Issue</a></p>`;
}

/* ---------- boot ---------- */
(async function boot() {
  applyStatic();
  $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  const goStart = () => { setTab('now'); resetNation(); const w = $('#wizard'); if (w) { w.reset(); syncWizardLoc(); } const r = $('#result'); if (r) r.hidden = true; $('#mapHint').classList.remove('is-hidden'); };
  $('#brand').addEventListener('click', e => { e.preventDefault(); goStart(); });
  $('#btnStart').addEventListener('click', goStart);
  $('#linkRules').addEventListener('click', e => { e.preventDefault(); renderRulesTable(); $('#rulesTable').scrollIntoView({ behavior: 'smooth' }); });
  initCards(); initWizard(); initSearch(); initPanel(); initLang(); initSize(); initPWA(); initWxSel(); initHome(); initProfile();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const p = $('#panel'); if (!matchMedia(MQ_MOBILE).matches) { p.classList.remove('is-tall'); p.style.height = ''; } map && map.resize(); renderLegend(state.sido ? [...state.shelters.active].filter(k => state.shelters.avail.some(a => a.id === k)) : []); }, 150); });
  await loadCore(); renderCrumb(); renderLive();
  initMap();
  map.once('idle', () => { if (location.hash) applyShare(location.hash); else if (getHome() && state.idx.byEmd.has(getHome())) setTimeout(() => selectEmd(getHome()), 1200); });
  renderHome();
})();
