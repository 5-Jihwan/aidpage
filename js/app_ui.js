/* 탭·패널·PWA·프로필·토스트·푸시·글자 크기·언어·상황·첫 화면 — 10-14 app.js에서 분리(500줄 규칙). */
import { t, getLang, setLang, LANGS, langName } from './i18n.js?v=20261015a';
import { getVapid, pushSub, pushUnsub, stat } from './api.js?v=20260914b';
import { $, $$, MQ_MOBILE, evaluate, setRulesLang, state } from './app.js?v=20261015a';
import { renderResult, renderRulesTable, renderSiteStats, syncWizardLoc } from './app_wizard.js?v=20261015a';
import { adminNameField, landmarkNameField, localizeLabels, locateMe, map, panelW, syncGrid3D } from './app_map.js?v=20261015a';
import { nameOf, renderRegion, renderTip } from './app_panel.js?v=20261015a';
import { getHome, initShelterUI, renderAll, saveShelterKinds, syncGrid } from './app_layers.js?v=20261015a';
import { _fxSig, applyWxLayer, resetFxDismiss, suggest } from './app_wx.js?v=20261015a';

export function setTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  const at = $('.tab.is-active'); if (at && at.scrollIntoView) at.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); // 폰: 활성 탭을 가운데로(오른쪽 페이드 밑에 걸치지 않게), 점프 대신 미끄러지게
  $$('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === tab));
  if (!state._autoNav) $('#panel').classList.remove('is-collapsed'); $('#panelScroll').scrollTop = 0;
  if (tab === 'about') { renderRulesTable(); renderSiteStats(); }
  setTimeout(() => map && map.resize(), 260);
}

export function initPanel() {
  const p = $('#panel');
  const saved = +localStorage.getItem('safepic.panelW'); if (saved >= 320) document.documentElement.style.setProperty('--panel-w', saved + 'px');
  const rz = $('#panelResize'); let dragging = false;
  const onMove = e => { if (!dragging) return; const x = (e.touches ? e.touches[0].clientX : e.clientX); const w = Math.min(Math.max(x, 320), Math.min(innerWidth - 360, 820)); document.documentElement.style.setProperty('--panel-w', w + 'px'); };
  const onUp = () => { if (!dragging) return; dragging = false; document.body.classList.remove('is-resizing'); localStorage.setItem('safepic.panelW', panelW()); map && map.resize(); };
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
  // bottom sheet (mobile): the sheet follows the finger and STAYS where it is released (09-07 사용자: "하단바가 고정이 안 된다").
  // 아주 낮으면 접힘, 거의 끝까지 올리면 전체, 절반 근처면 절반으로만 스냅한다. 손잡이의 ⌄ 버튼은 접기/펼치기.
  const g = $('.panel-grip'); let y0 = 0, h0 = 0, lastY = 0, sheetDrag = false, moved = false;
  const topH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || 52;
  const halfH = () => innerHeight * (document.documentElement.classList.contains('big') ? 0.56 : matchMedia('(max-width:900px) and (orientation:landscape), (max-height:500px) and (pointer:coarse)').matches ? 0.6 : 0.5);
  const curState = () => p.classList.contains('is-collapsed') ? 'is-collapsed' : p.classList.contains('is-tall') ? 'is-tall' : '';
  // 지도 컨트롤·힌트·범례가 시트 윗변을 따라가도록 --sheet-h를 유지한다(절반 상태는 CSS 기본값을 쓰므로 변수 제거)
  const syncSheetVar = () => {
    const r = document.documentElement.style;
    if (!matchMedia(MQ_MOBILE).matches) { r.removeProperty('--sheet-h'); return; }
    if (p.style.height) r.setProperty('--sheet-h', p.style.height);
    else if (p.classList.contains('is-collapsed')) r.setProperty('--sheet-h', 'calc(64px + env(safe-area-inset-bottom))');
    else if (p.classList.contains('is-tall')) r.setProperty('--sheet-h', 'calc(100dvh - var(--top-h) - 8px)');
    else r.removeProperty('--sheet-h');
  };
  new MutationObserver(syncSheetVar).observe(p, { attributes: true, attributeFilter: ['class', 'style'] });
  addEventListener('resize', syncSheetVar); syncSheetVar();
  const setSheet = (cls, h) => { p.classList.remove('is-collapsed', 'is-tall'); if (cls) p.classList.add(cls); p.style.height = h ? h + 'px' : ''; try { sessionStorage.setItem('safepic.sheet', JSON.stringify({ cls, h: h || 0 })); } catch { } setTimeout(() => map && map.resize(), 280); };
  const snapTo = cls => setSheet(cls);
  // 손을 뗀 높이에 고정. 예외: 130px 미만(또는 내리는 중 160px 미만) → 접힘, 위쪽 40px 이내 → 전체, 절반 ±28px → 절반
  const settle = (h, dy) => {
    const maxH = innerHeight - topH() - 8;
    if (h < 130 || (dy > 0 && h < 160)) return setSheet('is-collapsed');
    if (h > maxH - 40) return setSheet('is-tall');
    if (Math.abs(h - halfH()) < 28) return setSheet('');
    setSheet('', Math.round(h));
  };
  const shStart = e => { if (!matchMedia(MQ_MOBILE).matches) return; sheetDrag = true; moved = false; y0 = lastY = e.touches[0].clientY; h0 = p.getBoundingClientRect().height; p.style.transition = 'none'; };
  // 첫 실제 이동에서 상태 클래스를 떼고(접힘·전체 높이는 !important) 현재 높이를 인라인으로 옮긴다 — 손가락이 항상 이긴다
  const beginMove = () => { if (moved) return; moved = true; const h = p.getBoundingClientRect().height; p.classList.remove('is-collapsed', 'is-tall'); p.style.height = h + 'px'; };
  const shMove = e => { if (!sheetDrag) return; lastY = e.touches[0].clientY; const dy = lastY - y0; if (Math.abs(dy) > 4) beginMove(); if (!moved) return; const h = Math.max(64, Math.min(innerHeight - topH() - 8, h0 - dy)); p.style.height = h + 'px'; };
  const shEnd = e => { if (!sheetDrag) return; sheetDrag = false; p.style.transition = ''; const dy = e.changedTouches[0].clientY - y0;
    if (!moved) { snapTo(curState() === 'is-tall' ? '' : 'is-tall'); return; }   // 손잡이 탭 = 전체 ↔ 절반
    settle(p.getBoundingClientRect().height, dy); };
  // 알림창 쓸어내리기·뒤로가기 제스처·전화 수신 등은 touchend 없이 touchcancel로 끊긴다 — 같은 규칙으로 그 자리에 고정
  const shCancel = () => {
    const was = sheetDrag; sheetDrag = false; p.style.transition = '';
    if (was && moved) settle(p.getBoundingClientRect().height, lastY - y0);
  };
  const st = $('#sheetToggle');
  if (st) { st.addEventListener('click', e => { e.stopPropagation(); setSheet(curState() === 'is-collapsed' ? '' : 'is-collapsed'); }); ['touchstart', 'touchmove', 'touchend'].forEach(k => st.addEventListener(k, e => e.stopPropagation(), { passive: true })); }
  // 같은 세션 안에서는 마지막 시트 높이를 기억한다(전체·접힘은 복원하지 않음 — 첫 화면이 가려지지 않게)
  try { const sv = JSON.parse(sessionStorage.getItem('safepic.sheet') || 'null'); if (sv && matchMedia(MQ_MOBILE).matches && !sv.cls && sv.h && sv.h < innerHeight - topH() - 48) { p.style.height = sv.h + 'px'; } } catch { }
  g.addEventListener('touchstart', shStart, { passive: true }); g.addEventListener('touchmove', shMove, { passive: true }); g.addEventListener('touchend', shEnd); g.addEventListener('touchcancel', shCancel);
  // also allow sheetDrag from the sheet header area when the list is scrolled to the top
  const ps = $('#panelScroll');
  // y0는 매 터치마다 갱신 — scrollTop>0에서 시작한 제스처가 이전 y0로 오판하지 않게
  // touch-action은 터치가 시작되는 순간 정해진다. 맨 위(scrollTop 0)에서는 'pan-up'(브라우저는 위로 스크롤만 처리, 아래로 당김은 JS 몫)으로,
  // 접힘 상태에서는 'none'(콘텐츠가 숨겨져 있으니 위로 밀어 올리기도 JS 몫)으로 미리 바꿔 둔다.
  // 09-07 갤럭시 태블릿(삼성 인터넷) 보고: 카드 영역에서 끌어내리면 도로 올라옴 — 브라우저가 당김 제스처를 먼저 가져간 것
  const syncTA = () => { ps.style.touchAction = !matchMedia(MQ_MOBILE).matches ? '' : p.classList.contains('is-collapsed') ? 'none' : ps.scrollTop <= 0 ? 'pan-up' : 'pan-y'; };
  ps.addEventListener('scroll', syncTA, { passive: true }); new MutationObserver(syncTA).observe(p, { attributes: true, attributeFilter: ['class'] }); addEventListener('resize', syncTA); syncTA();
  // 09-17: non-passive touchmove 리스너가 '항상' 달려 있으면 브라우저가 매 touchmove마다 JS를 기다려 네이티브 스크롤이 끊긴다(비동기 스크롤 불가).
  // → 시트 제스처가 될 수 있는 터치(맨 위 또는 접힘 상태)에서만 touchstart 때 장착하고 touchend/cancel에서 뗀다. 중간에서 시작한 스크롤은 브라우저가 온전히 처리.
  let armed = false;
  const arm = () => { if (!armed) { ps.addEventListener('touchmove', onSheetMove, { passive: false }); armed = true; } };
  const disarm = () => { if (armed) { ps.removeEventListener('touchmove', onSheetMove); armed = false; } };
  // 09-19: 가로 스크롤 영역(상황 칩·예보 타임라인·표)에서 시작한 터치는 시트 제스처로 장착하지 않는다 — 맨 위에서는 non-passive touchmove가 걸려
  // 가로 스크롤이 JS를 기다리며 끊기고, 손가락이 4px만 아래로 흘러도 preventDefault가 가로 스크롤을 죽였다.
  const X_SCROLL = '.sit-bar,.wx-fcst,.table-wrap';
  ps.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; if (e.target.closest && e.target.closest(X_SCROLL)) return; if ((ps.scrollTop <= 0 || p.classList.contains('is-collapsed')) && matchMedia(MQ_MOBILE).matches) { shStart(e); sheetDrag = false; arm(); } }, { passive: true });
  // ⚠passive:false + "첫 touchmove부터" preventDefault가 핵심 — 안드로이드 크롬은 네이티브
  // 스크롤이 일단 시작되면 이후 touchmove의 cancelable이 false가 되어 preventDefault가 무력화된다.
  // 12px 문턱을 기다렸다 막으면 이미 늦는다(그 사이 브라우저가 제스처를 가져가 touchcancel).
  // 맨 위에서 아래로 당기는 순간(콘텐츠가 더 스크롤될 게 없는 방향)은 첫 이벤트부터 막는다.
  const onSheetMove = e => {
    const dy = e.touches[0].clientY - y0;
    // dy>4: 손가락 잔떨림(위로 스크롤 의도)은 통과시키되, 브라우저 터치 슬롭(~8px)보다 먼저 개입
    const collapsed = p.classList.contains('is-collapsed');
    const pullAtTop = ps.scrollTop <= 0 && dy > 4 && !collapsed && matchMedia(MQ_MOBILE).matches;   // 맨 위에서 아래로 당김 = 시트 내리기
    const pushUp = collapsed && dy < -4 && matchMedia(MQ_MOBILE).matches;                            // 접힘 상태에서 위로 밀기 = 시트 올리기
    if (!sheetDrag && (pullAtTop || pushUp) && Math.abs(dy) > 12) { sheetDrag = true; h0 = p.getBoundingClientRect().height; y0 = lastY = e.touches[0].clientY; p.style.transition = 'none'; beginMove(); }
    if ((sheetDrag || pullAtTop || pushUp) && e.cancelable) e.preventDefault();
    if (sheetDrag) shMove(e);
  };
  // 드래그가 시작되지 않은 채 끝나면 touchstart가 걸어둔 transition:none을 되돌린다
  ps.addEventListener('touchend', e => { disarm(); if (sheetDrag) shEnd(e); else if (p.style.transition) p.style.transition = ''; syncTA(); });
  ps.addEventListener('touchcancel', e => { disarm(); shCancel(e); });
}

export let _errSent = 0;

export function reportError() {
  if (_errSent >= 3) return; _errSent++;
  stat(matchMedia(MQ_MOBILE).matches ? 'js_error_m' : 'js_error_d');
}

export function initPWA() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=20260914b').catch(() => {});
  let deferred = null; const row = $('#installRow');
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (!localStorage.getItem('safepic.installDismissed')) row.hidden = false; });
  $('#btnInstall').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; row.hidden = true; });
  $('#btnInstallX').addEventListener('click', () => { row.hidden = true; localStorage.setItem('safepic.installDismissed', '1'); });
  const badge = () => document.documentElement.classList.toggle('offline', !navigator.onLine);
  addEventListener('online', badge); addEventListener('offline', badge); badge();
}

export function getProfile() { try { return JSON.parse(localStorage.getItem('safepic.profile') || '{}'); } catch { return {}; } }

export function initProfile() {
  const P = getProfile();
  const f = $('#pfFloor'); f.value = P.floor || '';
  const boxes = { senior: $('#pfSenior'), child: $('#pfChild'), mob: $('#pfMob'), car: $('#pfCar'), pet: $('#pfPet') };
  for (const k in boxes) boxes[k].checked = !!P[k];
  const save = () => { const o = { floor: f.value || null }; for (const k in boxes) o[k] = boxes[k].checked; localStorage.setItem('safepic.profile', JSON.stringify(o)); renderRegion(); };
  f.addEventListener('change', save); Object.values(boxes).forEach(b => b.addEventListener('change', save));
}

export let _toastEl = null, _toastT = 0;

export function toast(msg) {
  if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'toast'; document.body.appendChild(_toastEl); }
  _toastEl.textContent = msg; _toastEl.classList.add('is-on');
  clearTimeout(_toastT); _toastT = setTimeout(() => _toastEl.classList.remove('is-on'), 2600);
}

export function pushIDB(val) {
  return new Promise((res) => {
    const r = indexedDB.open('aidpage-push', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite');
      if (val !== undefined) { tx.objectStore('kv').put(val, 'region'); tx.oncomplete = () => res(val); }
      else { const g = tx.objectStore('kv').get('region'); g.onsuccess = () => res(g.result || null); }
    };
  });
}

export function b64uToU8(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }

export function initPush() {
  const cb = $('#btnPush'); if (!cb) return;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) { cb.disabled = true; return; }
  navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription())
    .then(sub => { cb.checked = !!sub; }).catch(() => {});
  cb.addEventListener('change', async () => {
    cb.disabled = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (cb.checked) {
        if (!state.sgg) { toast(t('push.needRegion')); cb.checked = false; return; }
        if (await Notification.requestPermission() !== 'granted') { toast(t('push.denied')); cb.checked = false; return; }
        const v = await getVapid();
        if (!v || !v.key) { toast(t('push.fail')); cb.checked = false; return; }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(v.key) });
        const n = nameOf();
        const region = { sgg: state.sgg, sido: state.sgg.slice(0, 2), sggName: n.sggName || '', sidoName: n.sidoName || '' };
        await pushIDB(region);
        const j = sub.toJSON();
        const r = await pushSub({ endpoint: sub.endpoint, keys: j.keys, sgg: region.sgg, sido: region.sido });
        if (r.status !== 'ok') { await sub.unsubscribe().catch(() => {}); toast(t('push.fail')); cb.checked = false; return; }
        toast(t('push.on', { r: n.sggName || '' }));
      } else {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await pushUnsub({ endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
        toast(t('push.off'));
      }
    } catch { toast(t('push.fail')); cb.checked = false; }
    finally { cb.disabled = false; }
  });
}

export function initSize() {
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
  /* 지도 위 특보 배너 표시/숨김. 꺼도 특보 자체는 '내 동네' 패널 warnCard에 남는다 — 정보를 없애지 않는다. */
  const fb = $('#btnFxBanner'), FK = 'safepic.fxBanner';
  const applyFB = on => { root.classList.toggle('no-fxbanner', !on); fb.checked = on; };
  applyFB(localStorage.getItem(FK) !== '0');
  const gb = $('#btnGridOn'), GK = 'safepic.gridOn';
  gb.checked = localStorage.getItem(GK) !== '0';
  gb.addEventListener('change', () => { localStorage.setItem(GK, gb.checked ? '1' : '0'); syncGrid(); });
  const g3 = $('#btnGrid3d');
  if (g3) { g3.checked = localStorage.getItem('safepic.grid3d') === '1';
    g3.addEventListener('change', () => { localStorage.setItem('safepic.grid3d', g3.checked ? '1' : '0'); syncGrid3D(); }); }
  fb.addEventListener('change', () => {
    localStorage.setItem(FK, fb.checked ? '1' : '0'); applyFB(fb.checked);
    // 다시 켜면 ×로 닫아둔 것도 함께 되살린다 (발효 중인 특보가 있을 때만)
    if (fb.checked) { resetFxDismiss(); const bn = $('#fxBanner'); if (_fxSig && bn.innerHTML) bn.hidden = false; }
  });
  if (!saved && !localStorage.getItem('safepic.sizeCoach')) {
    const c = $('#sizeCoach'); c.hidden = false;
    const done = () => { c.hidden = true; localStorage.setItem('safepic.sizeCoach', '1'); };
    $('#sizeCoachX').addEventListener('click', done);
    $('#btnPanel').addEventListener('click', done, { once: true });
    setTimeout(done, 8000);
  }
}

export const RULE_L10N = ['label', 'amount_text', 'summary', 'where', 'docs', 'basis'];

export function applyRulesLang() {
  if (!state.rules || !state.rules.all) return;
  const en = getLang() !== 'ko' && state.rulesEn && state.rulesEn.rules;
  for (const r of state.rules.all) {
    if (!r._ko) { r._ko = {}; RULE_L10N.forEach(k => { r._ko[k] = r[k]; }); }
    const o = en && en[r.id];
    RULE_L10N.forEach(k => { r[k] = o && o[k] != null ? o[k] : r._ko[k]; });
  }
  const steps = (state.rules.procedures && state.rules.procedures.steps) || [], enS = getLang() !== 'ko' && state.rulesEn && state.rulesEn.steps;
  for (const s of steps) {
    if (!s._ko) { s._ko = {}; ['label', 'summary', 'where', 'docs', 'typical_days'].forEach(k => { s._ko[k] = s[k]; }); }
    const o = enS && enS[s.id];
    ['label', 'summary', 'where', 'docs', 'typical_days'].forEach(k => { s[k] = o && o[k] != null ? o[k] : s._ko[k]; });
  }
}

export function buildLangButtons() {
  const opt = ([c, n], attrs) => `<button type="button" ${attrs} data-lang="${c}" lang="${c}">${n}</button>`;
  $('#langTop .lang-menu').innerHTML = LANGS.map(l => opt(l, 'role="option"')).join('');
  $('.drawer .lang.pill').innerHTML = LANGS.map(l => opt(l, 'class="lang-btn"')).join('');
  $('#welLang').innerHTML = LANGS.map(l => opt(l, '')).join('');
}

export let onLangChanged = () => {};

export function initLang() {
  const paint = () => {
    /* 지금 언어를 그 언어로 + 한국어 모르는 사람도 알아보게 영어 'Language'를 덧붙임 */
    $('#langSelT').innerHTML = `🌐 ${langName()}${getLang() === 'en' ? '' : '<small lang="en"> · Language</small>'}`;
    $('#langSelT').setAttribute('aria-label', `${langName()} — 언어 / Language`);
    $$('#welLang button').forEach(b => b.classList.toggle('is-on', b.dataset.lang === getLang()));
    $$('.lang-btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === getLang()));
    $$('#langTop .lang-menu button').forEach(b => b.classList.toggle('is-on', b.dataset.lang === getLang()));
  };
  paint();
  const box = $('#langTop'), lt = $('#langSelT');
  if (box && lt) {
    lt.addEventListener('click', () => { const on = box.classList.toggle('is-open'); lt.setAttribute('aria-expanded', on); });
    document.addEventListener('click', e => { if (!e.target.closest('#langTop')) { box.classList.remove('is-open'); lt.setAttribute('aria-expanded', 'false'); } });
    $$('#langTop .lang-menu button').forEach(mb => mb.addEventListener('click', () => {
      box.classList.remove('is-open'); lt.setAttribute('aria-expanded', 'false');
      const b = $$('.lang-btn').find(x => x.dataset.lang === mb.dataset.lang); if (b) b.click();
    }));
  }
  onLangChanged = () => {
    document.title = t('doc.title');
    paint(); setRulesLang(getLang()); applyRulesLang(); renderAll(); renderTip(); if (state.meta) { $('#aboutAdmin').textContent = `${state.meta.source || ''} ${state.meta.version || ''}`.trim(); $('#buildDate').textContent = state.meta.built || ''; } syncWizardLoc(); if (state.shelters.avail.length) initShelterUI();
    if (map) { localizeLabels(); ['sgg-label', 'emd-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'text-field', adminNameField())); if (map.getLayer('landmark-label')) map.setLayoutProperty('landmark-label', 'text-field', landmarkNameField()); applyWxLayer(); }
    if (state.lastResult && evaluate) { state.lastResult.res = evaluate(state.rules, state.lastResult.inp, getLang()); renderResult(state.lastResult.res, state.lastResult.inp); }
    if (state.tab === 'about') renderRulesTable();
  };
  $$('.lang-btn').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang, onLangChanged)));
  document.addEventListener('i18n:late', () => onLangChanged());   // 부팅 때 3초 넘겨 도착한 사전 — 언어는 i18n.js가 이미 바꿈
}

export const PRESETS = { house_flood: { housing: 'own', damage: ['flood'] }, shop_flood: { housing: 'shop', damage: ['flood'] }, injury: { damage: ['injury'] }, no_news: { damage: ['flood'] },
  // ponytail: 계절로 폭염/한파를 고른다(4~9월 폭염). 지금 기온 자료로 고르는 게 다음 단계
  heat_cold: () => ({ damage: [(m => m >= 4 && m <= 9)(new Date().getMonth() + 1) ? 'heat' : 'cold'] }) };

export function applyPreset(sit) {
  const f = $('#wizard'); f.reset(); const p = typeof PRESETS[sit] === 'function' ? PRESETS[sit]() : PRESETS[sit]; if (!p) return;
  if (p.housing) { const r = f.querySelector(`input[name=housing][value=${p.housing}]`); if (r) r.checked = true; }
  (p.damage || []).forEach(v => { const c = f.querySelector(`input[name=damage][value=${v}]`); if (c) c.checked = true; });
}

export const SITS = ['house_flood', 'shop_flood', 'evacuating', 'before_rain', 'injury', 'no_news', 'heat_cold', 'past', 'proxy'];

export const SIT_ICON = { house_flood: '🏠', shop_flood: '🏪', evacuating: '🚨', before_rain: '🌧️', injury: '🩹', no_news: '⏳', heat_cold: '🌡️', past: '🗓️', proxy: '👥' };

export const SIT_KEY = { house_flood: 'sit.house', shop_flood: 'sit.shop', evacuating: 'sit.evac', before_rain: 'sit.before', injury: 'sit.injury', no_news: 'sit.nonews', heat_cold: 'sit.heat', past: 'sit.past', proxy: 'sit.proxy' };

export const AUTO = { evacuating: ['temp_housing', 'townhall', 'fire', 'water'], house_flood: ['townhall', 'temp_housing'], shop_flood: ['townhall'], injury: ['er', 'pharmacy'], no_news: ['townhall'], heat_cold: ['heat', 'cold'], before_rain: ['temp_housing', 'townhall'] };

export const OPEN = { null: ['wx', 'near', 'er', 'grid'], past: ['near', 'ins', 'grid'], house_flood: ['near', 'wx', 'rep'], shop_flood: ['near', 'wx', 'rep'], evacuating: ['near', 'wx', 'rep', 'er'], before_rain: ['wx', 'grid', 'ins', 'near'], injury: ['er', 'near'], no_news: ['near'], heat_cold: ['near', 'wx'], proxy: ['near', 'wx'] };

export function applySituation(sit, navigate) {
  state.sit = sit; if (sit) sessionStorage.setItem('safepic.sit', sit); else sessionStorage.removeItem('safepic.sit');
  state._foldOverride = {}; // 상황이 바뀌면 사용자가 손으로 접고 편 기록은 초기화
  const PP = getProfile();
  if (AUTO[sit]) { const extra = [...(PP.senior ? ['heat', 'cold'] : []), ...(PP.mob ? ['temp_housing'] : []), ...(PP.child || PP.senior ? ['er'] : [])]; [...AUTO[sit], ...extra].forEach(k => state.shelters.active.add(k)); saveShelterKinds(); }
  if (!navigate) { renderRegion(); return; }
  if (sit === 'proxy') { $('#wizard').reset(); $('#qProxy').checked = true; setTab('find'); syncWizardLoc(); return; }
  if (sit === 'past') { $('#wizard').reset(); $('#pastHint').hidden = false; setTab('find'); syncWizardLoc(); setTimeout(() => $('#qEnd').focus(), 200); return; }
  if (sit === 'evacuating' || sit === 'before_rain') { $('#mapHint').textContent = t('hint.start'); $('#mapHint').classList.remove('is-hidden'); $('#searchInput').focus(); return; }
  applyPreset(sit); setTab('find'); syncWizardLoc();
  if (sit === 'no_news' || sit === 'heat_cold') setTimeout(() => $('#wizard').requestSubmit(), 50);
}

export function initCards() {
  $$('#sitCards .card').forEach(b => b.addEventListener('click', () => applySituation(b.dataset.sit, true)));
}

export function initWelcome() {
  const w = $('#welcome'); if (!w) return;
  const groups = $('#welGroups'), sub = $('#welSub'), loc = $('#welLoc'), skip = $('#welSkip');
  let pendingSit = null, locFrom = 'groups';
  const show = step => { groups.hidden = step !== 'groups'; sub.hidden = step !== 'sub'; loc.hidden = step !== 'loc'; skip.hidden = step === 'loc';
    $('#welH1').hidden = $('#welLead').hidden = step === 'loc'; };  // 위치 스텝은 "어디세요?"가 유일한 질문이어야 한다
  /* via='sheet'(끌어내림·건너뛰기·배경 탭) = "지도부터 볼게요" → 폰에서는 홈 시트를 하단에 접어 둔다.
     닫힌 자리에 같은 문구(지금 어떤 상황이세요?)의 패널이 50dvh로 다시 서 있으면 "내렸는데 하단 고정이
     안 된다"로 읽힌다(09-03 보고). 상황 카드를 골라 launch()로 닫힐 때는 접지 않는다. */
  const close = via => {
    w.hidden = true;
    if (via === 'sheet' && matchMedia(MQ_MOBILE).matches) { const p = $('#panel'); p.classList.add('is-collapsed'); p.classList.remove('is-tall'); p.style.height = ''; setTimeout(() => map && map.resize(), 280); }
  };
  const open = () => { w.hidden = false; pendingSit = null; show('groups'); };
  state._welOpen = open;
  const toLoc = (sit, from) => { pendingSit = sit; locFrom = from; show('loc'); };
  /* 위치까지 답했거나 건너뜀 → 닫고 기존 동선으로. via: gps|sel(검색 선택)|map(직접 고르기)
     대피·대비는 위치가 정해지면 안내(검색 포커스)가 필요 없으므로 map일 때만 navigate */
  const launch = via => {
    const s = pendingSit; close();
    if (s === 'evacuating' || s === 'before_rain') applySituation(s, via === 'map');
    else applySituation(s, true);
  };
  const GROUP_SIT = { evac: 'evacuating', prep: 'before_rain', proxy: 'proxy' };
  const DAMAGE_SITS = ['house_flood', 'shop_flood', 'injury', 'no_news', 'past'];
  $$('#welGroups .wcard').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.g;
    if (GROUP_SIT[g]) { toLoc(GROUP_SIT[g], 'groups'); return; }
    const sc = $('#welSubCards');
    sc.innerHTML = DAMAGE_SITS.map(s => `<button type="button" class="wcard" data-sit="${s}"><span class="card-ic">${SIT_ICON[s]}</span><b>${t(SIT_KEY[s])}</b><small>${t(SIT_KEY[s] + '.s')}</small></button>`).join('');
    $$('.wcard', sc).forEach(x => x.addEventListener('click', () => toLoc(x.dataset.sit, 'sub')));
    show('sub');
  }));
  /* 카드 안 언어 스위치 — 서랍의 .lang-btn 핸들러(전체 리렌더 포함)에 위임 */
  const paintWelLang = () => $$('#welLang button').forEach(b => b.classList.toggle('is-on', b.dataset.lang === getLang()));
  paintWelLang();
  $$('#welLang button').forEach(b => b.addEventListener('click', () => {
    const lb = $$('.lang-btn').find(x => x.dataset.lang === b.dataset.lang); if (lb) lb.click();   // 강조는 사전 로드 뒤 paint()가
  }));
  $('#welBack').addEventListener('click', () => show('groups'));
  $('#welLocBack').addEventListener('click', () => show(locFrom));
  $('#welGps').addEventListener('click', () => { launch('gps'); (state._coreP || Promise.resolve()).then(() => locateMe()); });
  $('#welLocSkip').addEventListener('click', () => launch('map'));
  $('#welSkip').addEventListener('click', () => close('sheet'));
  /* 오버레이 안 지역 검색 — 본검색과 같은 suggest(), 목록은 카드 아래 정적 배치 */
  const inp = $('#welSearch'), list = $('#welSearchList'); let items = [];
  const render = () => { list.innerHTML = items.map((it, i) => `<li data-i="${i}"><span>${it.name}</span><small>${it.path}</small></li>`).join(''); list.hidden = !items.length; };
  inp.addEventListener('input', () => { const q = inp.value.trim(); items = q ? suggest(q, 4, 8) : []; render(); });
  list.addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return;
    const it = items[+li.dataset.i]; items = []; render(); inp.value = '';
    launch('sel'); it.go();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !w.hidden) close(); });
  /* 폰: 카드가 하단 고정·상단 라운드라 영락없는 바텀시트 모양 — 사용자는 끌어내려 닫기를
     기대하는데 지금까진 모달이라 무반응이었다(“스크롤바가 내려가지 않는다” 보고의 실체).
     맨 위에서 아래로 당기면 카드가 손가락을 따라오고, 110px 이상 내리면 닫힌다.
     panel 시트와 같은 이유로 passive:false + 첫 move부터 preventDefault(안드로이드 크롬은
     네이티브 스크롤이 시작되면 이후 move가 cancelable=false). */
  const card = w.querySelector('.welcome-card');
  let wy0 = 0, wLast = 0, wDrag = false;
  const wClose = () => { wDrag = false; card.style.transition = 'transform .18s ease'; card.style.transform = 'translateY(110%)'; setTimeout(() => { close('sheet'); card.style.transition = ''; card.style.transform = ''; }, 180); };
  const wBack = () => { wDrag = false; card.style.transition = 'transform .2s ease'; card.style.transform = ''; setTimeout(() => { card.style.transition = ''; }, 220); };
  card.addEventListener('touchstart', e => { if (!matchMedia(MQ_MOBILE).matches) return; wy0 = wLast = e.touches[0].clientY; wDrag = false; }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (!matchMedia(MQ_MOBILE).matches) return;
    wLast = e.touches[0].clientY; const dy = wLast - wy0;
    if (!wDrag && card.scrollTop <= 0 && dy > 4) { wDrag = true; card.style.transition = 'none'; }
    if (wDrag && e.cancelable) e.preventDefault();
    if (wDrag) card.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  card.addEventListener('touchend', e => {
    if (!wDrag) return;
    const dy = e.changedTouches[0].clientY - wy0;
    if (dy > 72) wClose(); else wBack();
  });
  // 취소(브라우저 제스처 가로채기)여도 60px 이상 내려갔으면 닫는다 — 되돌리면 "용수철"
  card.addEventListener('touchcancel', () => { if (!wDrag) return; if (wLast - wy0 > 60) wClose(); else wBack(); });
  w.addEventListener('click', e => { if (e.target === w) close('sheet'); }); // 배경 탭 = 닫기 (시트 관례)
  if (!location.hash && !getHome()) open();
}
