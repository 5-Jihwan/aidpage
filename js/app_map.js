/* map · 3D 지형·건물 · 라벨 · 팝업 · 행정 경계·포커스 — 10-14 app.js에서 분리(500줄 규칙). */
import { t, getLang, ttsLang } from './i18n.js?v=20261031b';
import { initGrid, setExtrude as setGridExtrude } from './grid.js?v=20261031b';
import { $, KOREA_CENTER, MQ_MOBILE, ensureEmd, formatKRW, state } from './app.js?v=20261031b';
import { initGridClick, initShelterUI, selectEmd, selectSgg, selectSido } from './app_layers.js?v=20261031b';
import { acc, applyDrawerFx } from './app_wizard.js?v=20261031b';
import { nameOf, rn } from './app_panel.js?v=20261031b';
import { applyTyphoon, applyWxLayer } from './app_wx.js?v=20261031b';

export let map;

export function bboxOf(features) {
  const b = [180, 90, -180, -90];
  const walk = c => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  features.forEach(f => walk(f.geometry.coordinates)); return b;
}

export const featuresWhere = (fc, key, val) => fc ? fc.features.filter(f => String(f.properties[key]) === String(val)) : [];

export function pipRing(lon, lat, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside; } return inside; }

export function pipFeature(lon, lat, f) { const g = f.geometry; const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]; return polys.some(p => pipRing(lon, lat, p[0]) && !p.slice(1).some(h => pipRing(lon, lat, h))); }

export const featureAt = (fc, lon, lat, filter) => fc ? fc.features.find(f => (!filter || filter(f)) && pipFeature(lon, lat, f)) : null;

export async function locateMe() {
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

export function showGpsDot(lon, lat, acc) {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { acc } }] };
  if (map.getSource('gps')) map.getSource('gps').setData(fc);
  else {
    map.addSource('gps', { type: 'geojson', data: fc });
    map.addLayer({ id: 'gps-halo', type: 'circle', source: 'gps', paint: { 'circle-radius': 18, 'circle-color': '#1a5fc4', 'circle-opacity': 0.15 } });
    map.addLayer({ id: 'gps-dot', type: 'circle', source: 'gps', paint: { 'circle-radius': 7, 'circle-color': '#1a5fc4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
  }
}

export function ensureDem() {
  if (map.getSource('dem')) return;
  map.addSource('dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen/AWS Open Data' });
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
    // 알파 색으로 데이터 레이어 '위'에서도 은은하게 — 아래 깔면 마스크·격자에 묻혀 안 보인다(08-31 사용자 재보고)
    // 넓은 줌(전국·시도)에선 변위가 화면상 1px 미만이라 음영이 유일한 지형 신호 — 저줌일수록 진하게
    paint: { 'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 9, 0.7, 12, 0.55],
             'hillshade-shadow-color': 'rgba(62,79,98,.5)', 'hillshade-highlight-color': 'rgba(255,255,255,.45)' } },
    map.getLayer('sido-fill') ? 'sido-fill' : undefined);
}

export let _terrEx = 1.7;

export const terrainEx = z => z >= 13 ? Math.max(0.5, +(1.7 - (z - 13) * 0.3).toFixed(1)) : 1.7;

export const pitchFor = z => z <= 9 ? 0 : z >= 14 ? 55 : z <= 12 ? (z - 9) / 3 * 30 : 30 + (z - 12) / 2 * 25;

export let _userTilt = false;

export function autoPitchOn() { return localStorage.getItem('safepic.terrain') !== '0' && !_userTilt && !matchMedia(MQ_MOBILE).matches; }

export function syncAutoPitch() {
  if (!map || !autoPitchOn()) return;
  const want = pitchFor(map.getZoom());
  if (Math.abs(map.getPitch() - want) >= 3) map.easeTo({ pitch: want, duration: 450 });
}

export function syncTerrainEx() {
  if (!map || !map.getTerrain || !map.getTerrain()) return;
  const ex = terrainEx(map.getZoom());
  if (ex !== _terrEx) { _terrEx = ex; map.setTerrain({ source: 'dem', exaggeration: ex }); }
}

export function ensureBldg() {
  if (map.getLayer('bldg-3d')) return;
  const anchor = ['sgg-label', 'emd-label'].find(l => map.getLayer(l));
  map.addLayer({ id: 'bldg-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building',
    minzoom: 14, layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8],
        0, '#e6eaf1', 40, '#cfd8e3', 120, '#b3c0d1'],
      // 줌 14→14.7에서 0→실높이로 자라나는 등장 연출(높이 미기재 건물은 8m 기본)
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.7, ['coalesce', ['get', 'render_height'], 8]],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.7, ['coalesce', ['get', 'render_min_height'], 0]],
      'fill-extrusion-opacity': 0.85,
    } }, anchor);
}

export function set3D(on, ease = true) {
  ensureDem(); ensureBldg();
  map.setLayoutProperty('bldg-3d', 'visibility', on ? 'visible' : 'none');
  applyDrawerFx();
  // ⚠ globe 투영에서는 지형 변위가 적용되지 않는다 — 3D 동안은 mercator로 전환 (08-31 사용자 확인)
  // 3D(지형)는 globe 투영에서 변위가 안 붙어 mercator가 필요하지만, 멀리서 평면 mercator는 극 왜곡으로 "깨져" 보인다(09-04 보고).
  // → 3D 모드에서도 줌 4까지는 구(vertical-perspective), 4~6에서 mercator로 넘어가는 표현식. 지형은 그 줌대에선 보이지 않아 손해 없음.
  try { map.setProjection({ type: on ? ['interpolate', ['linear'], ['zoom'], 4, 'vertical-perspective', 6, 'mercator'] : 'globe' }); } catch (e) { /* 미지원 브라우저 */ }
  _terrEx = on ? terrainEx(map.getZoom()) : 1.7;
  map.setTerrain(on ? { source: 'dem', exaggeration: _terrEx } : null);
  map.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none');
  if (on) { // 격자·행정면 위, 시설 아이콘·라벨 아래로 올려 실제로 보이게
    const anchor = ['sh-pt', 'emd-label', 'sgg-label'].find(l => map.getLayer(l));
    try { map.moveLayer('hillshade', anchor); } catch (e) { /* anchor 미생성 시 그대로 */ }
  }
  _userTilt = false; // 3D를 켤 때마다 자동 추종 복귀
  if (ease) map.easeTo({ pitch: on ? (matchMedia(MQ_MOBILE).matches ? 55 : pitchFor(map.getZoom())) : 0, duration: 800 });
  localStorage.setItem('safepic.terrain', on ? '1' : '0');
  const b = $('.ctrl-3d'); if (b) b.classList.toggle('is-on', on);
  syncGrid3D();
}

export function syncGrid3D() {
  setGridExtrude(localStorage.getItem('safepic.terrain') !== '0' && localStorage.getItem('safepic.grid3d') === '1');
}

export function initMiddleDrag() {
  const cv = map.getCanvas();
  let on = false, x0 = 0, y0 = 0, p0 = 0, b0 = 0;
  cv.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault(); // 브라우저 자동 스크롤 차단
    on = true; _userTilt = true; x0 = e.clientX; y0 = e.clientY; p0 = map.getPitch(); b0 = map.getBearing();
  });
  addEventListener('mousemove', e => {
    if (!on) return;
    map.setPitch(Math.max(0, Math.min(70, p0 - (e.clientY - y0) * 0.4)));
    map.setBearing(b0 + (e.clientX - x0) * 0.25);
  });
  addEventListener('mouseup', e => { if (e.button === 1) on = false; });
  addEventListener('blur', () => { on = false; });
}

export class TiltControl {
  onAdd(m) {
    const d = document.createElement('div'); d.className = 'maplibregl-ctrl maplibregl-ctrl-group ctrl-tilt-group';
    const mk = (txt, dp, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ctrl-tilt'; b.textContent = txt; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', () => { _userTilt = true; m.easeTo({ pitch: Math.max(0, Math.min(70, m.getPitch() + dp)), duration: 300 }); }); d.appendChild(b); return b; };
    const up = mk('\u25B3', 15, '기울이기 / Tilt up'), dn = mk('\u25BD', -15, '평평하게 / Tilt down');
    const sync = () => { const p = m.getPitch(); up.disabled = p >= 69.5; dn.disabled = p <= 0.5; };
    m.on('pitch', sync); m.on('load', sync); sync(); this._d = d; return d;
  }
  onRemove() { this._d.remove(); }
}

export class TerrainToggle {
  onAdd(m) {
    const d = document.createElement('div'); d.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ctrl-3d';
    b.textContent = '3D'; b.title = '지형 3D · 기울여 보기 / Terrain 3D'; b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => set3D(localStorage.getItem('safepic.terrain') === '0'));
    d.appendChild(b); return d;
  }
  onRemove() {}
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
    center: [100, 25], zoom: 1.5, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true },
  });
  // bottom-right는 나중에 추가한 컨트롤이 위로 쌓인다 — 3D를 +/- 아래에 두려면 먼저 추가
  map.addControl(new TerrainToggle(), 'bottom-right');
  map.addControl(new TiltControl(), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  initMiddleDrag();
  map.on('zoomend', () => { syncTerrainEx(); syncAutoPitch(); });
  map.on('pitchstart', e => { if (e && e.originalEvent) _userTilt = true; }); // 사용자가 직접 기울이면 수동 우선
  window.__map = map; // E2E에서 queryTerrainElevation 등 확인용
  map.on('style.load', async () => {
    try { map.setProjection({ type: 'globe' }); } catch (e) { console.warn('globe unsupported', e); }
    localizeLabels(); hideRoadShields();
    // 인트로 비행은 즉시 — 데이터 로딩을 연출이 가려준다
    map.flyTo({ center: KOREA_CENTER, zoom: 5.6, duration: 3000, essential: true, curve: 1.3 });
    await state._coreP; // 행정 경계·인덱스가 있어야 하는 초기화만 대기
    addAdminLayers(); initShelterUI(); initGrid(map); initGridClick();
    // 기본 = 3D 켬 (평면 시작이 "지형 미적용"으로 보인다는 재보고 3회) — 끄면('0') 그 선택을 기억
    map.once('moveend', () => { $('#mapHint').textContent = t('hint.drill'); if (localStorage.getItem('safepic.terrain') !== '0') set3D(true); });
  });
}

export const MIL_KW = ['비행단', '공군', '해군', '육군', '군부대', '부대', '군사', '기지', '사격장', '탄약', '훈련장',
                'military', 'Military', 'Air Base', 'air base', 'Airbase', 'Army', 'Navy', 'Barracks', 'ROKAF', 'USAG', 'USFK'];

export const MIL_EXC = ['찌개', '차량기지', '베이스캠프'];

export function milMaskExpr() {
  const hay = ['concat', ...['name', 'name:ko', 'name:en', 'name:latin'].map(k => ['coalesce', ['to-string', ['get', k]], ''])];
  const kwHit = ['any', ...MIL_KW.map(k => ['in', k, hay])];
  const excHit = ['any', ...MIL_EXC.map(k => ['in', k, hay])];
  return ['any', ['==', ['coalesce', ['get', 'class'], ''], 'military'],  // aerodrome_label class
          ['all', kwHit, ['!', excHit]]];
}

export let _origTextField = null;

export function localizeLabels() {
  const style = map.getStyle();
  if (!_origTextField) {
    _origTextField = new Map();
    for (const l of style.layers || []) if (l.type === 'symbol' && l.layout && l.layout['text-field']) _origTextField.set(l.id, l.layout['text-field']);
  }
  const vecSrc = Object.keys(style.sources || {}).find(s => (style.sources[s] || {}).type === 'vector');
  const ko = ['coalesce', ['get', 'name:ko'], ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const enRaw = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  // 동해·독도 표기는 바다·섬 이름에만. 예전엔 'Japan'이 들어간 모든 이름을 바꿔 국가명 '일본'의 영어 줄까지
  // 'East Sea'가 되는 오류(09-04 영어 모드 보고)가 있었다 → 'Sea of Japan'/'Japan Sea'/'日本海'/'일본해'만 매칭.
  const isSeaOfJapan = e => ['any', ['in', 'Sea of Japan', ['to-string', e]], ['in', 'Japan Sea', ['to-string', e]], ['in', '日本海', ['to-string', e]], ['in', '일본해', ['to-string', e]]];
  const isDokdo = e => ['any', ['in', 'Liancourt', ['to-string', e]], ['in', '竹島', ['to-string', e]], ['in', 'Takeshima', ['to-string', e]]];
  const en = ['case', isSeaOfJapan(enRaw), 'East Sea', isDokdo(enRaw), 'Dokdo', enRaw];
  const koFixed = ['case', isSeaOfJapan(ko), '동해', isDokdo(ko), '독도', ko];
  const both = ['format', koFixed, {}, '\n', {}, en, { 'font-scale': 0.8, 'text-color': '#6b7a90' }];
  const base = getLang() !== 'ko' ? en : ['case', ['==', ['to-string', koFixed], ['to-string', en]], koFixed, both];
  const field = ['case', milMaskExpr(), '', base];  // 군사시설명은 빈 문자열로 마스킹
  for (const l of style.layers || []) {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
    if (vecSrc && l.source !== vecSrc) continue;  // 베이스맵 레이어만 (자체 라벨은 각자 관리)
    if (['sgg-label', 'emd-label'].includes(l.id)) continue;
    if (!/name/.test(JSON.stringify(_origTextField.get(l.id) ?? ''))) continue;  // ref 방패·번지수 등은 그대로 둔다
    try { map.setLayoutProperty(l.id, 'text-field', field); } catch (e) { console.warn('localizeLabels', l.id, e); }
    // 바다·호수 이름은 positron 기본색이 연해 안 읽힌다(09-04 보고) → 진한 청회색 + 흰 테두리
    if (/water|marine|ocean|sea/i.test(l.id)) {
      try { map.setPaintProperty(l.id, 'text-color', '#2f5d8f'); map.setPaintProperty(l.id, 'text-halo-color', 'rgba(255,255,255,.9)'); map.setPaintProperty(l.id, 'text-halo-width', 1.2); } catch (e) { /* paint 미지원 레이어 */ }
    }
  }
}

export function hideRoadShields() {
  for (const [id, tf] of _origTextField || []) {
    const s = JSON.stringify(tf);
    if (!/ref/.test(s) || /name/.test(s) || !map.getLayer(id)) continue;
    try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) { console.warn('hideRoadShields', id, e); }
  }
}

export const adminNameField = () => getLang() !== 'ko' ? ['coalesce', ['get', 'name_en'], ['get', 'name']] : ['get', 'name'];

export const landmarkNameField = () => getLang() !== 'ko' ? ['get', 'en'] : ['format', ['get', 'ko'], {}, '\n', {}, ['get', 'en'], { 'font-scale': 0.8, 'text-color': '#6b7a90' }];

export function clampPad(pad) {
  if (!map) return pad;
  const el = map.getContainer(), fit = (a, b, avail) => {
    const s = (a || 0) + (b || 0), room = Math.max(0, avail - 24);
    return s > room && s > 0 ? [Math.floor((a || 0) * room / s), Math.floor((b || 0) * room / s)] : [Math.round(a || 0), Math.round(b || 0)];
  };
  const [left, right] = fit(pad.left, pad.right, el.clientWidth);
  const [top, bottom] = fit(pad.top, pad.bottom, el.clientHeight);
  return { left, right, top, bottom };
}

export const panelW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 460;

export function downloadBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function visiblePadding() {
  const mobile = matchMedia(MQ_MOBILE).matches, p = $('#panel');
  if (mobile) {
    const sheet = p.getBoundingClientRect().height || (p.classList.contains('is-collapsed') ? 72 : p.classList.contains('is-tall') ? innerHeight * 0.9 : innerHeight * 0.5);
    return clampPad({ top: 120, bottom: Math.round(sheet) + 12, left: 12, right: 12 });
  }
  const pw = p.classList.contains('is-collapsed') ? 0 : panelW() + 32;
  return clampPad({ top: 70, bottom: 40, left: pw, right: 170 });
}

export let speaking = false, _utts = [];

export function speak(text, btn) {
  if (!('speechSynthesis' in window)) { alert(t('tts.unsupported')); return; }
  const ss = speechSynthesis, stop = () => { speaking = false; _utts = []; if (btn) btn.classList.remove('is-on'); };
  if (speaking) { ss.cancel(); stop(); return; }
  const lg = getLang();
  const voices = ss.getVoices(), want = ttsLang(lg).toLowerCase();
  const voice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === want) || voices.find(v => { const x = v.lang.toLowerCase(); return x.startsWith(lg) && !(lg === 'zh' && /hk|tw|hant|yue/.test(x)); });
  const parts = String(text).split(/\.\s+|\n+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return;
  if (ss.speaking || ss.pending) ss.cancel();
  _utts = parts.map((p, i) => {
    const u = new SpeechSynthesisUtterance(p); u.lang = ttsLang(lg); if (voice) u.voice = voice;
    u.rate = document.documentElement.classList.contains('big') ? 0.9 : 1;
    if (i === parts.length - 1) u.onend = stop;
    u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled') stop(); };
    return u;
  });
  speaking = true; if (btn) btn.classList.add('is-on');
  setTimeout(() => { _utts.forEach(u => ss.speak(u)); setTimeout(() => { if (speaking && !ss.speaking && !ss.pending) { stop(); alert(t('tts.novoice')); } }, 1500); }, 80);
}

export const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim(); };

export async function shareImage(res, inp) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const n = nameOf(), place = state.emd ? `${n.sidoName} ${n.sggName} ${n.emdName}` : state.sgg ? `${n.sidoName} ${n.sggName}` : '';
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1a5fc4'; x.fillRect(0, 0, W, 14);
  const F = (sz, w = 400) => `${w} ${sz}px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  const wrap = (txt, maxW, font) => { x.font = font; const out = []; let line = ''; for (const ch of String(txt)) { if (x.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; } if (line) out.push(line); return out; };
  let y = 90;
  x.fillStyle = '#14202e'; x.font = F(34, 700); x.fillText('AidPage', 72, y); x.fillStyle = '#566577'; x.font = F(26); x.fillText(place, 72 + 170, y);
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
  x.fillStyle = '#566577'; x.font = F(22); x.fillText(t('res.disc').slice(0, 60), 72, H - 90); x.fillStyle = '#1a5fc4'; x.font = F(24, 500); x.fillText('5-jihwan.github.io/aidpage', 72, H - 50);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'safepic.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'AidPage', text: place }); return; } catch (e) { /* cancelled */ } }
  downloadBlob(blob, 'safepic.png');
}

export const SRC_NAME = { 'osm+molit': ['OpenStreetMap + 국토부 지하차도 현황', 'OpenStreetMap + MOLIT underpass list'], safekorea: ['국민안전24', 'SafeKorea'], osm: ['OpenStreetMap', 'OpenStreetMap'], localdata: ['지방행정인허가데이터', 'LocalData'], datago_std: ['공공데이터포털 표준데이터', 'data.go.kr standard data'] };

export function srcBadge(src, asof) { const k = Object.keys(SRC_NAME).find(x => String(src || '').startsWith(x)); const name = k ? SRC_NAME[k][getLang() !== 'ko' ? 1 : 0] : (src || ''); return (name || asof) ? `<div class="src-badge">${asof ? `${t('badge.asof')} ${asof}` : ''}${asof && name ? ' · ' : ''}${name}</div>` : ''; }

export function routeLinks(lon, lat, name) {
  const n = encodeURIComponent(name || 'AidPage');
  return `<div class="route-row"><a href="https://map.kakao.com/link/to/${n},${lat},${lon}" target="_blank" rel="noopener">카카오맵</a><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking" target="_blank" rel="noopener">Google</a><a href="https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w" target="_blank" rel="noopener">Apple</a></div>`;
}

export function downloadICS(title, dateISO, desc) {
  const d = dateISO.replace(/-/g, ''), next = new Date(Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AidPage//KO', 'BEGIN:VEVENT', `UID:safepic-${d}-${Math.random().toString(36).slice(2)}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, 'BEGIN:VALARM', 'TRIGGER:-P2D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  downloadBlob(new Blob([ics], { type: 'text/calendar' }), `safepic-${d}.ics`);
}

export let _curPop = null;

export function openPopup(lngLat, html, opts = {}) {
  if (matchMedia(MQ_MOBILE).matches && opts.fromPanel) { const pn = $('#panel'); pn.classList.add('is-collapsed'); pn.classList.remove('is-tall'); pn.style.height = ''; setTimeout(() => map.resize(), 260); }
  if (_curPop) { try { _curPop.remove(); } catch (e) { /* already gone */ } }
  const pop = new maplibregl.Popup({ closeButton: !!opts.closeButton, offset: opts.offset || 8, maxWidth: opts.maxWidth || '280px' }).setLngLat(lngLat).setHTML(html).addTo(map);
  _curPop = pop; pop.on('close', () => { if (_curPop === pop) _curPop = null; });
  setTimeout(() => {
    const pad = visiblePadding(), pt = map.project(lngLat), W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
    const popH = (pop.getElement() && pop.getElement().offsetHeight) || 160;
    const inside = pt.x > pad.left + 20 && pt.x < W - pad.right - 20 && pt.y > pad.top + popH + 10 && pt.y < H - pad.bottom - 10;
    if (!inside) map.easeTo({ center: lngLat, padding: clampPad({ ...pad, top: pad.top + popH }), duration: 450 });
  }, 280);
  return pop;
}

export function addAdminLayers() {
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
  const lbl = (id, src, minzoom, maxzoom) => map.addLayer({ id, type: 'symbol', source: src, layout: { 'text-field': adminNameField(), 'text-size': 12, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 }, minzoom, ...(maxzoom ? { maxzoom } : {}) });
  // minzoom 주의: 큰 도(전남·경북)는 시도 화면맞춤 줌이 7 안팎 — 8이면 군·구 라벨이 통째로 안 보인다 (08-27 전수조사)
  lbl('sgg-label', 'sgg', 6, 11.5); lbl('emd-label', 'emd', 7.5); // 7.5 = 옹진군(fit 7.8)까지 커버
  // 독도·울릉도: 저배율에서도 항상 보이도록 전용 마커+라벨
  map.addSource('landmarks', { type: 'geojson', data: 'data/admin/landmarks.geojson' });
  map.addLayer({ id: 'landmark-dot', type: 'circle', source: 'landmarks', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 6], 'circle-color': '#1a5fc4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }, minzoom: 3.5, maxzoom: 11 });
  map.addLayer({ id: 'landmark-label', type: 'symbol', source: 'landmarks', layout: { 'text-field': landmarkNameField(), 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 0.9], 'text-anchor': 'top' }, paint: { 'text-color': '#14202e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 }, minzoom: 3.5 });
  setLevelFilters();
  setTimeout(() => { applyWxLayer(); applyTyphoon(); }, 0);

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
      if (top && top.layer.id === `${lv}-fill`) { tip.hidden = false; tip.innerHTML = `${rn(f.properties)}<small>${t('lv.' + lv)} · ${t('tip.click')} ${lv === 'emd' ? t('tip.summary') : t('tip.enter')}</small>`; tip.style.left = e.point.x + 'px'; tip.style.top = e.point.y + 'px'; }
    });
    map.on('mouseleave', `${lv}-fill`, () => { setHover(lv, null); tip.hidden = true; });
  }
  // 시설 아이콘·클러스터 위를 눌렀을 땐 지역 드릴다운 금지 (펼침이 flyTo에 즉시 접히던 버그)
  const overShelter = e => { const ls = ['sh-pt', 'sh-cluster'].filter(l => map.getLayer(l)); return ls.length && map.queryRenderedFeatures(e.point, { layers: ls }).length; };
  map.on('click', 'emd-fill', e => { if (state.simPick || overShelter(e)) return; const f = e.features[0]; if (f) selectEmd(f.properties.code); });
  map.on('click', 'sgg-fill', e => { if (state.simPick || overShelter(e)) return; if (map.queryRenderedFeatures(e.point, { layers: ['emd-fill'] }).length) return; const f = e.features[0]; if (f) selectSgg(f.properties.code); });
  map.on('click', 'sido-fill', e => { if (state.simPick || overShelter(e)) return; if (map.queryRenderedFeatures(e.point, { layers: ['sgg-fill', 'emd-fill'] }).length) return; const f = e.features[0]; if (f) selectSido(f.properties.code); });
  map.on('click', () => $('#mapHint').classList.add('is-hidden'));
}

export const EMPTYFC = { type: 'FeatureCollection', features: [] };

export const FOCUS_BOX = [[116, 29], [143, 29], [143, 45], [116, 45], [116, 29]];

export function focusFeatures() {
  if (state.emd && state.geo.emd) { const fs = featuresWhere(state.geo.emd, 'code', state.emd); if (fs.length) return fs; }
  if (state.sgg) return featuresWhere(state.geo.sgg, 'code', state.sgg);
  return []; // 시도·전국은 무대가 너무 커서 연출하지 않는다
}

export function focusClip() {
  const fs = focusFeatures(); if (!fs.length) return null;
  const b = bboxOf(fs);
  return { sig: `${state.sgg}|${state.emd || ''}`,
           keep: (lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && fs.some(f => pipFeature(lon, lat, f)) };
}

export function applyFocus() {
  if (!map || !map.getLayer('sgg-fill')) return;
  if (!map.getSource('focus-mask')) {
    map.addSource('focus-mask', { type: 'geojson', data: EMPTYFC });
    map.addSource('focus-sel', { type: 'geojson', data: EMPTYFC });
    // 스택: 베이스맵 < 마스크 < 그림자 < 행정 면·선 < 링 < 라벨 (경계선·라벨은 흐리지 않아 길찾기 유지)
    map.addLayer({ id: 'focus-mask', type: 'fill', source: 'focus-mask', paint: { 'fill-color': '#f7f9fc', 'fill-opacity': 0.55 } }, 'sido-fill');
    map.addLayer({ id: 'focus-shadow', type: 'fill', source: 'focus-sel', paint: { 'fill-color': '#14202e', 'fill-opacity': 0.25, 'fill-translate': [8, 12], 'fill-translate-anchor': 'viewport' } }, 'sido-fill');
    map.addLayer({ id: 'focus-ring-casing', type: 'line', source: 'focus-sel', paint: { 'line-color': '#fff', 'line-width': 5 } }, 'sgg-label');
    map.addLayer({ id: 'focus-ring', type: 'line', source: 'focus-sel', paint: { 'line-color': '#0f4a9e', 'line-width': 2 } }, 'sgg-label');
  }
  const fs = focusFeatures();
  if (!fs.length) { map.getSource('focus-mask').setData(EMPTYFC); map.getSource('focus-sel').setData(EMPTYFC); return; }
  map.getSource('focus-sel').setData({ type: 'FeatureCollection', features: fs.map(f => ({ type: 'Feature', geometry: f.geometry, properties: {} })) });
  // 마스크 = 큰 사각에서 선택 폴리곤 outer ring들을 구멍으로 (earcut은 순서만 보므로 winding 무관)
  const holes = [];
  for (const f of fs) { const g = f.geometry; for (const p of (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates])) holes.push(p[0]); }
  map.getSource('focus-mask').setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [FOCUS_BOX, ...holes] }, properties: {} });
}

export function setLevelFilters() {
  if (!map || !map.getLayer('sgg-fill')) return;
  const NONE = ['==', ['get', 'code'], '__none__']; // valid "match nothing" (['==',1,0] is rejected by MapLibre)
  const sggF = state.sido ? ['==', ['get', 'sido_code'], String(state.sido)] : NONE;
  const emdF = state.sgg ? ['==', ['get', 'sgg_code'], String(state.sgg)] : NONE;
  map.setFilter('sgg-fill', sggF); map.setFilter('sgg-label', state.sido ? sggF : NONE);
  map.setFilter('sgg-line', state.sido ? sggF : null); // nation view keeps the thin 시군구 outline (liked by users)
  ['emd-fill', 'emd-line', 'emd-label'].forEach(l => map.setFilter(l, emdF));
  if (!state.wxmap) map.setPaintProperty('sido-fill', 'fill-opacity', state.sido ? 0 : ['case', ['boolean', ['feature-state', 'hover'], false], 0.32, 0]);
  else map.setPaintProperty('sido-fill', 'fill-opacity', state.sido ? 0 : ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.62]);
  // highlight only the deepest selection (emd > sgg); nothing selected = no fill
  const want = state.emd ? { src: 'emd', id: String(state.emd) } : state.sgg ? { src: 'sgg', id: String(state.sgg) } : null;
  const prev = state._sel;
  if (prev && (!want || prev.src !== want.src || prev.id !== want.id)) { try { map.setFeatureState({ source: prev.src, id: prev.id }, { sel: false }); } catch (e) { /* source may be reloading */ } }
  if (want) { try { map.setFeatureState({ source: want.src, id: want.id }, { sel: true }); } catch (e) { /* ignore */ } }
  state._sel = want;
  applyFocus();
}

export function fitTo(features) {
  if (!features.length) return;
  const b = bboxOf(features), mobile = matchMedia(MQ_MOBILE).matches;
  const pad = mobile ? { top: 150, bottom: innerHeight * 0.52, left: 24, right: 24 }
    : { top: 90, bottom: 60, left: ($('#panel').classList.contains('is-collapsed') ? 0 : panelW()) + 60, right: 80 };
  // 카메라 계산이 실패해도 호출한 쪽(GPS·검색·드릴다운)이 중단되면 안 된다.
  try {
    // 사용자가 이미 그 지역 안을 더 깊이 보고 있으면 카메라를 밖으로 빼지 않는다 —
    // 줌인해 두고 지역을 눌렀는데 fit이 줌을 되돌리던 문제("다시 확대해야") 방지
    const cam = map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: clampPad(pad) });
    const c = map.getCenter();
    const inside = c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3];
    if (cam && inside && map.getZoom() > cam.zoom + 0.3) return;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: clampPad(pad), duration: 900 });
  }
  catch (err) { console.warn('fitTo', err); try { map.flyTo({ center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], duration: 600 }); } catch (e2) { /* 지도 없음 */ } }
}
