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
const VERSION = 'safepic-20260828a';   // 앱 셸 전용 — 배포마다 바뀐다
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
