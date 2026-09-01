/* AidPage service worker — offline shell + data the user has already seen.
   Strategy
   - app shell (html/css/js/manifest): network-first (fresh deploys), cached copy when offline
   - reference data (admin boundaries, rules, ref): cache-first, refreshed in background
   - live data (data/live/*): network-first, fall back to cache
   - facility/grid files (data/shelters, data/grid): cache-first once fetched (only what the user opened)
   - fonts/: own cache 'safepic-fonts' that survives version bumps
   - map tiles / CDN: never cached here (browser HTTP cache handles them)
   캐시를 셸/데이터로 나눈 이유: 예전엔 참조·시설·격자까지 VERSION 캐시에 있어서,
   셸 버전을 올릴 때마다(하루 10여 회) 138MB 격자를 포함한 전부가 삭제·재다운로드됐다.
   버전을 타는 건 셸뿐이고, 데이터는 DATA_CACHE에서 배포와 무관하게 살아남는다. */
const VERSION = 'safepic-20260901o';   // 앱 셸 전용 — 배포마다 바뀐다
const DATA_CACHE = 'safepic-data-1';   // 참조·시설·격자 — 셸 버전을 올려도 살아남는다
const FONT_CACHE = 'safepic-fonts';
const KEEP = [VERSION, DATA_CACHE, FONT_CACHE];
const SHELL = [   // → VERSION 캐시 (배포마다 교체)
  './', './index.html', './css/style.css', './js/app.js', './js/i18n.js', './js/rules.js', './js/shelters.js', './js/grid.js', './js/api.js',
  './manifest.webmanifest',
];
const SHELL_DATA = [  // → DATA_CACHE (배포와 무관하게 유지). cacheFirst가 읽는 캐시와 같아야 프리캐시가 쓸모 있다.
  './data/admin/kr_sido.geojson', './data/admin/kr_sgg.geojson', './data/admin/emd_index.json', './data/admin/sgg_index.json', './data/admin/meta.json', './data/admin/landmarks.geojson',
  './data/ref/psych_centers.json', './data/ref/tips.json', './data/shelters/index.json',
  './rules/cash.json', './rules/changelog.json', './rules/heat_cold.json', './rules/insurance.json', './rules/procedures.json', './rules/relief_fund.json', './rules/indirect.json', './rules/en.json',
];
const precache = (name, urls) => caches.open(name).then(c => Promise.allSettled(urls.map(u => c.add(u).catch(() => null))));
self.addEventListener('install', e => {
  e.waitUntil(Promise.all([precache(VERSION, SHELL), precache(DATA_CACHE, SHELL_DATA)]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // tiles, fonts, CDN: leave to the browser
  const p = url.pathname;
  if (p.includes('/data/live/')) { e.respondWith(networkFirst(req)); return; }
  if (p.includes('/fonts/')) { e.respondWith(fontCache(req)); return; }
  if (p.includes('/data/shelters/') || p.includes('/data/grid/') || p.includes('/data/admin/kr_emd')) { e.respondWith(cacheFirst(req, true)); return; }
  if (p.includes('/data/') || p.includes('/rules/')) { e.respondWith(cacheFirst(req, false)); return; }
  e.respondWith(networkFirst(req)); // html/css/js: always fresh when online, cached when not
});
async function fontCache(req) {
  const c = await caches.open(FONT_CACHE);
  const hit = await c.match(req); if (hit) return hit;
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch { return Response.error(); }
}
async function cacheFirst(req, bigData) {
  const c = await caches.open(DATA_CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) { if (!bigData) refresh(req, c); return hit; }
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch { return hit || Response.error(); }
}
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  // bypass the HTTP cache for the app shell so a fixed deploy reaches users immediately
  const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  try { const r = await fetch(fresh); if (r.ok) c.put(req, r.clone()); return r; } catch { return (await c.match(req, { ignoreSearch: true })) || Response.error(); }
}
function refresh(req, c) { fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); }).catch(() => {}); }

/* ── 웹 푸시 — 서버는 페이로드 없이 "신호"만 보낸다(개인정보 미발송).
   수신 시 alerts.json을 새로 읽어, 구독한 지역에 해당하는 특보·재난문자로
   "지금 무엇을 하면 되는가" 알림을 구성한다. 지역은 구독 시 페이지가 IndexedDB에 저장. ── */
function pushDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('aidpage-push', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function pushRegion() {
  try {
    const db = await pushDB();
    return await new Promise((res) => {
      const g = db.transaction('kv').objectStore('kv').get('region');
      g.onsuccess = () => res(g.result || null); g.onerror = () => res(null);
    });
  } catch { return null; }
}
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const reg = await pushRegion();  // { sgg, sido, sggName, sidoName }
    let title = 'AidPage', body = '새 재난 정보가 있습니다. 열어서 확인하세요.', tag = 'aidpage-alert';
    try {
      const r = await fetch('data/live/alerts.json', { cache: 'no-cache' });
      const d = await r.json();
      const hit = [];
      for (const w of (d.warnings && d.warnings.items) || []) {
        const codes = w.area_codes || [];
        if (!reg || codes.includes(reg.sgg) || codes.some(c => String(c).slice(0, 2) === reg.sido))
          hit.push(`${w.type} ${w.level}`);
      }
      const msgs = ((d.messages && d.messages.items) || []).filter(m => {
        const rg = m.region || '';
        return !reg || rg.includes(reg.sggName || '\u0000') || rg.includes(reg.sidoName || '\u0000') || /전국/.test(rg);
      });
      if (hit.length) {
        title = `${reg && reg.sggName ? reg.sggName + ' — ' : ''}${hit[0]} 발효`;
        body = '대피소 위치와 지금 할 일을 확인하세요.';
        tag = 'aidpage-warn';
      } else if (msgs.length) {
        title = `${reg && reg.sggName ? reg.sggName + ' ' : ''}긴급재난문자`;
        body = (msgs[0].text || '').slice(0, 120);
        tag = 'aidpage-msg';
      }
    } catch { /* 오프라인 등 — 기본 문구로 알림 */ }
    await self.registration.showNotification(title, {
      body, tag, renotify: false, icon: 'og.png', badge: 'og.png',
      data: { url: self.registration.scope },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.registration.scope)) return w.focus();
    return clients.openWindow(url);
  })());
});
