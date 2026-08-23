/* SafePic service worker — offline shell + data the user has already seen.
   Strategy
   - app shell (html/css/js/manifest): network-first (fresh deploys), cached copy when offline
   - reference data (admin boundaries, rules, ref): cache-first, refreshed in background
   - live data (data/live/*): network-first, fall back to cache
   - facility/grid files (data/shelters, data/grid): cache-first once fetched (only what the user opened)
   - map tiles / fonts / CDN: never cached here (too big; browser HTTP cache handles them) */
const VERSION = 'safepic-20260823k';
const SHELL = [
  './', './index.html', './css/style.css', './js/app.js', './js/i18n.js', './js/rules.js', './js/shelters.js', './js/grid.js', './js/api.js',
  './manifest.webmanifest',
  './data/admin/kr_sido.geojson', './data/admin/kr_sgg.geojson', './data/admin/emd_index.json', './data/admin/sgg_index.json', './data/admin/meta.json', './data/admin/landmarks.geojson',
  './data/ref/psych_centers.json', './data/shelters/index.json',
  './rules/cash.json', './rules/changelog.json', './rules/heat_cold.json', './rules/insurance.json', './rules/procedures.json', './rules/relief_fund.json', './rules/indirect.json', './rules/en.json',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // tiles, fonts, CDN: leave to the browser
  const p = url.pathname;
  if (p.includes('/data/live/')) { e.respondWith(networkFirst(req)); return; }
  if (p.includes('/data/shelters/') || p.includes('/data/grid/') || p.includes('/data/admin/kr_emd')) { e.respondWith(cacheFirst(req, true)); return; }
  if (p.includes('/data/') || p.includes('/rules/')) { e.respondWith(cacheFirst(req, false)); return; }
  e.respondWith(networkFirst(req)); // html/css/js: always fresh when online, cached when not
});
async function cacheFirst(req, bigData) {
  const c = await caches.open(VERSION);
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
