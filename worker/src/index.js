/* AidPage API Worker — on-demand proxy for keys that must not live in the browser.
   Routes
     GET /health                      → { status:"ok", has:{bigkinds,law,kma} }
     GET /news?sgg=11620&lang=ko      → BigKinds: 7-day disaster news for a district   (KV 60 min)
     GET /law?mst=...&art=...         → 국가법령정보: one article's text                  (KV 24 h)
     GET /radar  /sat                 → KMA API hub image passthrough                   (KV 10 min)
     POST /kakao/skill                → 카카오톡 채널 챗봇(오픈빌더 스킬 서버), src/kakao.js      (키 불필요)
   Every route answers the same envelope as fetch_live.py: { status, updated, items|... }.
   status: "ok" | "no_key" | "error:<code>" | "rate_limited". Missing key never throws. */

import { kakaoSkill } from './kakao.js';
const VERSION = '0.3.0';
const TTL = { news: 3600, law: 86400, radar: 600, er: 180 };
const RATE = { perMin: 30 };
const ER_DAILY_MAX = 150;  // E-Gen 일 1,000건 중 Actions 수집(~750건)을 빼고 워커 몫

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET' && req.method !== 'POST') return json({ status: 'error:405' }, 405, cors);
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ status: 'error:403' }, 403, cors);

    const ip = req.headers.get('CF-Connecting-IP') || '0';
    // 카카오 오픈빌더는 소수의 서버 IP로 모든 이용자 발화를 보내므로 IP 속도제한에서 제외 (자체 5초 타임아웃·KV 캐시로 보호)
    if (!url.pathname.startsWith('/kakao/') && await rateLimited(env, ip)) return json({ status: 'rate_limited' }, 429, cors);

    try {
      switch (url.pathname) {
        case '/health': return json({ status: 'ok', version: VERSION, updated: now(), has: { bigkinds: !!env.BIGKINDS_KEY, law: !!env.LAW_OC, kma: !!env.KMA_APIHUB_KEY, serp: !!env.SERPAPI_KEY, egen: !!env.DATA_GO_KR_KEY } }, 200, cors);
        case '/news': return json(await news(url, env), 200, cors);
        case '/er': return json(await er(url, env), 200, cors);
        case '/law': return json(await law(url, env), 200, cors);
        case '/radar': case '/sat': return image(url.pathname.slice(1), env, cors);
        case '/reports': return json(await reports(url, env), 200, cors);
        case '/report': return json(await report(req, env, ip), 200, cors);
        case '/report/flag': return json(await flag(req, env, ip), 200, cors);
        case '/stat': return json(await stat(req, env), 200, cors);
        case '/stat/summary': return json(await statSummary(env), 200, cors);
        case '/push/vapid': return json({ status: 'ok', key: env.VAPID_PUB || '' }, 200, cors);
        case '/push/sub': return json(await pushSub(req, env), 200, cors);
        case '/push/unsub': return json(await pushUnsub(req, env), 200, cors);
        case '/push/send': return pushSend(req, env, cors);
        case '/kakao/skill': return json(await kakaoSkill(req, env), 200, cors);
        case '/route': return json(await route(url, env), 200, cors);
        default: return json({ status: 'error:404' }, 404, cors);
      }
    } catch (e) {
      return json({ status: 'error:500', message: String(e && e.message || e).slice(0, 200) }, 200, cors);
    }
  },
};

/* ---------- /route — 카카오모빌리티 도보 길찾기 프록시 (2단계 준비 + 키 승인 자가검증)
   ?from=lon,lat&to=lon,lat → { status, len_m, sec, coords:[[lon,lat]...] }. status: no_key | ok | error:<http> (401=키 오류, 403=제휴 미승인) */
const KAKAO_WALK = 'https://apis-navi.kakaomobility.com/affiliate/walking/v1/directions';   // 제휴 전용
const KAKAO_CAR = 'https://apis-navi.kakaomobility.com/v1/directions';                      // 공개 (플랫폼 REST 키)
async function route(url, env) {
  if (!env.KAKAO_REST_KEY) return { status: 'no_key', updated: now() };
  const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(from) || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(to)) return { status: 'error:400', updated: now() };
  const mode = url.searchParams.get('mode') === 'car' ? 'car' : 'walk';
  return cached(env, `route:${mode}:${from}|${to}`, 3600, async () => {
    const r = await fetch(`${mode === 'car' ? KAKAO_CAR : KAKAO_WALK}?origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`, { headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` } });
    if (!r.ok) return { status: `error:${r.status}`, updated: now(), body: (await r.text()).slice(0, 200) };
    const j = await r.json();
    const rt = (j.routes || [])[0]; if (!rt) return { status: 'error:noroute', updated: now() };
    const coords = [];
    for (const sec of rt.sections || []) for (const rd of sec.roads || []) { const v = rd.vertexes || []; for (let i = 0; i + 1 < v.length; i += 2) coords.push([v[i], v[i + 1]]); }
    return { status: 'ok', mode, updated: now(), len_m: rt.summary && rt.summary.distance, sec: rt.summary && rt.summary.duration, coords };
  });
}
/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = !origin || allowed.includes(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' } : {};
}
async function rateLimited(env, ip) {
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt(await env.CACHE.get(key) || '0', 10) + 1;
  // KV writes are the scarce resource (1,000/day free) — only write every 5th hit after the first
  if (n === 1 || n % 5 === 0) await env.CACHE.put(key, String(n), { expirationTtl: 120 });
  return n > RATE.perMin;
}
async function cached(env, key, ttl, producer) {
  const hit = await env.CACHE.get(key, 'json');
  if (hit) return { ...hit, cached: true };
  const fresh = await producer();
  if (fresh && fresh.status === 'ok') await env.CACHE.put(key, JSON.stringify(fresh), { expirationTtl: ttl });
  return fresh;
}

/* ---------- /news — BigKinds ---------- */
const DISASTER_Q = '(침수 OR 호우 OR 태풍 OR 산사태 OR 폭염 OR 한파 OR 대설 OR 지진 OR 싱크홀 OR 지반침하 OR 대피 OR 재난지원금 OR 특별재난지역)';
async function news(url, env) {
  const sgg = url.searchParams.get('sgg') || '', name = (url.searchParams.get('name') || '').slice(0, 40);
  if (!/^\d{5}$/.test(sgg) || !name) return { status: 'error:400', updated: now(), items: [] };
  if (!env.BIGKINDS_KEY) return { status: 'no_key', updated: now(), items: [] };
  return cached(env, `news:${sgg}`, TTL.news, async () => {
    const to = new Date(), from = new Date(Date.now() - 7 * 86400000);
    const d = x => x.toISOString().slice(0, 10);
    const body = { access_key: env.BIGKINDS_KEY, argument: { query: `"${name}" AND ${DISASTER_Q}`, published_at: { from: d(from), until: d(to) }, sort: { date: 'desc' }, return_from: 0, return_size: 8, fields: ['title', 'published_at', 'provider', 'news_id', 'hilight'] } };
    const r = await fetch('https://tools.kinds.or.kr/search/news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return { status: `error:${r.status}`, updated: now(), items: [] };
    const j = await r.json();
    const docs = (j.return_object && j.return_object.documents) || [];
    // title/provider/date/link only — no body text is stored or re-served (BigKinds terms)
    return { status: 'ok', updated: now(), total: j.return_object && j.return_object.total_hits, items: docs.map(x => ({ title: x.title, at: x.published_at, provider: x.provider, id: x.news_id, url: `https://www.bigkinds.or.kr/v2/news/newsDetailView.do?newsId=${encodeURIComponent(x.news_id)}` })) };
  });
}

/* ---------- /er — 응급실 실시간 가용병상 (중앙응급의료센터 E-Gen) ----------
   fetch_live.py의 fetch_er와 같은 API·같은 행 형태({id,name,tel,beds,or,ct,mri,icu,at}).
   시군구당 3분 KV 캐시 + 일 상한(ER_DAILY_MAX)으로 E-Gen 일 1,000건 한도를 지킨다.
   키는 시크릿 DATA_GO_KR_KEY (data.go.kr 인코딩된 형태 그대로 저장). */
const unxml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
async function er(url, env) {
  const sgg = url.searchParams.get('sgg') || '';
  const sido = (url.searchParams.get('sido') || '').slice(0, 20);
  const name = (url.searchParams.get('name') || '').slice(0, 20);
  if (!/^\d{5}$/.test(sgg) || !sido || !name) return { status: 'error:400', updated: now(), rows: [] };
  if (!env.DATA_GO_KR_KEY) return { status: 'no_key', updated: now(), rows: [] };
  return cached(env, `er:${sgg}`, TTL.er, async () => {
    const bkey = `erbudget:${Math.floor(Date.now() / 86400000)}`;
    const n = parseInt(await env.CACHE.get(bkey) || '0', 10) + 1;
    if (n > ER_DAILY_MAX) return { status: 'rate_limited', updated: now(), rows: [] };
    await env.CACHE.put(bkey, String(n), { expirationTtl: 172800 });
    const q = new URLSearchParams({ STAGE1: sido, STAGE2: name, pageNo: '1', numOfRows: '30' });
    const r = await fetch(`https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire?${q}&serviceKey=${env.DATA_GO_KR_KEY}`);
    if (!r.ok) return { status: `error:${r.status}`, updated: now(), rows: [] };
    const xml = await r.text();
    const code = (xml.match(/<resultCode>([^<]*)/) || [])[1];
    if (code && code !== '00') return { status: `error:egen${code}`, updated: now(), rows: [] };
    const num = v => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; };
    const rows = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const g = tag => { const mm = m[1].match(new RegExp(`<${tag}>([^<]*)`)); return mm ? unxml(mm[1].trim()) : ''; };
      return { id: g('hpid'), name: g('dutyName'), tel: g('dutyTel3') || g('dutyTel1'),
               beds: num(g('hvec')), or: num(g('hvoc')), ct: g('hvctayn') === 'Y', mri: g('hvmriayn') === 'Y',
               icu: num(g('hvicc')), at: g('hvidate') };
    }).filter(x => x.id);
    return { status: 'ok', updated: now(), rows };
  });
}

/* ---------- /law — 국가법령정보 ---------- */
async function law(url, env) {
  const mst = url.searchParams.get('mst') || '', art = (url.searchParams.get('art') || '').slice(0, 20);
  if (!/^\d{1,8}$/.test(mst)) return { status: 'error:400', updated: now() };
  if (!env.LAW_OC) return { status: 'no_key', updated: now() };
  return cached(env, `law:${mst}:${art}`, TTL.law, async () => {
    const q = new URLSearchParams({ OC: env.LAW_OC, target: 'law', MST: mst, type: 'JSON' });
    const r = await fetch('https://www.law.go.kr/DRF/lawService.do?' + q);
    if (!r.ok) return { status: `error:${r.status}`, updated: now() };
    const j = await r.json();
    const L = j['법령'] || {};
    const arts = [].concat((L['조문'] && L['조문']['조문단위']) || []);
    const pick = art ? arts.filter(a => String(a['조문번호']) === art.replace(/[^0-9]/g, '')) : arts.slice(0, 3);
    return { status: 'ok', updated: now(), name: L['기본정보'] && L['기본정보']['법령명_한글'], effective: L['기본정보'] && L['기본정보']['시행일자'], articles: pick.map(a => ({ no: a['조문번호'], title: a['조문제목'], text: a['조문내용'], items: [].concat(a['항'] || []).map(h => h['항내용']).filter(Boolean) })) };
  });
}

/* ---------- /radar /sat — KMA API hub image passthrough ---------- */
async function image(kind, env, cors) {
  if (!env.KMA_APIHUB_KEY) return json({ status: 'no_key', updated: now() }, 200, cors);
  // 10-minute bucket so every viewer shares one upstream fetch
  const bucket = Math.floor(Date.now() / 600000);
  const key = `img:${kind}:${bucket}`;
  const hit = await env.CACHE.get(key, 'arrayBuffer');
  const headers = { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' };
  if (hit) return new Response(hit, { headers });
  const src = kind === 'radar'
    ? `https://apihub.kma.go.kr/api/typ03/cgi/rdr/nph-rdr_cmp_img?cmp=HSP&obs=ECHO&color=C4&qcd=HSP&tm=&size=800&map=HR&authKey=${env.KMA_APIHUB_KEY}`
    : `https://apihub.kma.go.kr/api/typ03/cgi/sat/nph-gk2a_img?sat=G2&area=ko&ch=rgb-true&tm=&size=800&authKey=${env.KMA_APIHUB_KEY}`;
  const r = await fetch(src);
  if (!r.ok) return json({ status: `error:${r.status}`, updated: now() }, 200, cors);
  const buf = await r.arrayBuffer();
  await env.CACHE.put(key, buf, { expirationTtl: TTL.radar });
  return new Response(buf, { headers });
}

/* ---------- /reports /report /report/flag — 주민 제보 (text only, per-district, 7-day expiry) ---------- */
const REPORT = { kinds: ['shelter_closed', 'drain', 'road', 'water', 'other'], maxText: 140, perIpDay: 3, perSggDay: 50, ttl: 7 * 86400, hideAt: 3 };
async function reports(url, env) {
  const sgg = url.searchParams.get('sgg') || '';
  if (!/^\d{5}$/.test(sgg)) return { status: 'error:400', items: [] };
  const list = (await env.CACHE.get(`rep:${sgg}`, 'json')) || [];
  const cut = Date.now() - REPORT.ttl * 1000;
  return { status: 'ok', updated: now(), items: list.filter(r => r.t > cut && r.flags < REPORT.hideAt).map(({ ip, ...r }) => r) };
}
async function report(req, env, ip) {
  let b; try { b = await req.json(); } catch { return { status: 'error:400' }; }
  const sgg = String(b.sgg || ''), kind = String(b.kind || ''), text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, REPORT.maxText);
  if (!/^\d{5}$/.test(sgg) || !REPORT.kinds.includes(kind) || text.length < 4) return { status: 'error:400' };
  if (/https?:\/\/|www\.|\d{3}-\d{3,4}-\d{4}/.test(text)) return { status: 'error:400', message: 'no links or phone numbers' };
  const day = Math.floor(Date.now() / 86400000), ipKey = `repip:${ip}:${day}`;
  const nIp = parseInt(await env.CACHE.get(ipKey) || '0', 10);
  if (nIp >= REPORT.perIpDay) return { status: 'rate_limited' };
  const key = `rep:${sgg}`, cut = Date.now() - REPORT.ttl * 1000;
  const list = ((await env.CACHE.get(key, 'json')) || []).filter(r => r.t > cut);
  if (list.filter(r => r.t > Date.now() - 86400000).length >= REPORT.perSggDay) return { status: 'rate_limited' };
  const lon = +b.lon, lat = +b.lat, hasPt = Number.isFinite(lon) && Number.isFinite(lat) && lon > 124 && lon < 132 && lat > 33 && lat < 39;
  const item = { id: Math.random().toString(36).slice(2, 10), t: Date.now(), kind, text, emd: /^\d{10}$/.test(String(b.emd || '')) ? String(b.emd) : null, lon: hasPt ? +lon.toFixed(4) : null, lat: hasPt ? +lat.toFixed(4) : null, flags: 0, ip: await hashIp(ip) };
  list.unshift(item);
  await env.CACHE.put(key, JSON.stringify(list.slice(0, 200)), { expirationTtl: REPORT.ttl });
  await env.CACHE.put(ipKey, String(nIp + 1), { expirationTtl: 86400 });
  const { ip: _i, ...pub } = item; return { status: 'ok', item: pub };
}
async function flag(req, env, ip) {
  let b; try { b = await req.json(); } catch { return { status: 'error:400' }; }
  const sgg = String(b.sgg || ''), id = String(b.id || '');
  if (!/^\d{5}$/.test(sgg) || !/^[a-z0-9]{6,10}$/.test(id)) return { status: 'error:400' };
  const fkey = `repflag:${id}:${await hashIp(ip)}`;
  if (await env.CACHE.get(fkey)) return { status: 'ok', dup: true };
  const key = `rep:${sgg}`, list = (await env.CACHE.get(key, 'json')) || [];
  const it = list.find(r => r.id === id); if (!it) return { status: 'error:404' };
  it.flags = (it.flags || 0) + 1;
  await env.CACHE.put(key, JSON.stringify(list), { expirationTtl: REPORT.ttl });
  await env.CACHE.put(fkey, '1', { expirationTtl: REPORT.ttl });
  return { status: 'ok', flags: it.flags, hidden: it.flags >= REPORT.hideAt };
}
async function sha256hex(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const hashIp = async ip => (await sha256hex(ip + '|safepic')).slice(0, 12);

/* ---------- /push — 웹 푸시 (특보·재난문자 알림) ----------
   페이로드 없는 push(RFC8030)만 보낸다 → RFC8291 암호화가 필요 없고,
   알림 내용은 SW가 push 수신 시 alerts.json을 새로 읽어 구성한다.
   따라서 서버는 "지금 다시 봐" 신호만 전달하며 개인정보를 발송하지 않는다.
   구독 저장: KV psub:<sha256(endpoint)> = { endpoint, sgg, sido, t } (TTL 180일,
   재구독 시 갱신). keys(p256dh/auth)는 향후 페이로드 push 대비로만 보관. */
const PUSH_TTL = 180 * 86400;

async function subKey(endpoint) { return 'psub:' + await sha256hex(endpoint); }

async function pushSub(req, env) {
  if (req.method !== 'POST') return { status: 'error:405' };
  const b = await req.json().catch(() => null);
  if (!b || !b.endpoint || !/^https:\/\//.test(b.endpoint)) return { status: 'error:bad_sub' };
  const rec = { endpoint: b.endpoint, keys: b.keys || null,
                sgg: String(b.sgg || '').slice(0, 5), sido: String(b.sido || '').slice(0, 2),
                t: now() };
  await env.CACHE.put(await subKey(b.endpoint), JSON.stringify(rec), { expirationTtl: PUSH_TTL });
  return { status: 'ok' };
}

async function pushUnsub(req, env) {
  if (req.method !== 'POST') return { status: 'error:405' };
  const b = await req.json().catch(() => null);
  if (!b || !b.endpoint) return { status: 'error:bad_sub' };
  await env.CACHE.delete(await subKey(b.endpoint));
  return { status: 'ok' };
}

/* VAPID(RFC8292): aud별 ES256 JWT. 서명키는 시크릿 VAPID_JWK(JWK JSON). */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function vapidHeader(env, aud) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const body = enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:ojh121523@gmail.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUB}`;
}

async function pushSend(req, env, cors) {
  if (req.method !== 'POST') return json({ status: 'error:405' }, 405, cors);
  if (!env.PUSH_AUTH || req.headers.get('X-Push-Auth') !== env.PUSH_AUTH)
    return json({ status: 'error:403' }, 403, cors);
  const b = await req.json().catch(() => ({}));
  const sggs = new Set((b.sggs || []).map(String));       // 시군구 코드 5자리
  const sidos = new Set((b.sidos || []).map(String));     // 시도 코드 2자리
  const all = b.all === true;                             // 전국 발송(재난문자 '전국')

  const targets = [];
  let cursor;
  do {
    const page = await env.CACHE.list({ prefix: 'psub:', cursor });
    for (const k of page.keys) {
      const rec = await env.CACHE.get(k.name, 'json');
      if (!rec || !rec.endpoint) continue;
      if (all || sggs.has(rec.sgg) || sidos.has(rec.sido) || (rec.sgg && sggs.size === 0 && sidos.size === 0))
        targets.push({ key: k.name, endpoint: rec.endpoint });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  let sent = 0, gone = 0, failed = 0;
  const auds = new Map();
  for (let i = 0; i < targets.length; i += 20) {
    await Promise.all(targets.slice(i, i + 20).map(async (t) => {
      try {
        const aud = new URL(t.endpoint).origin;
        if (!auds.has(aud)) auds.set(aud, await vapidHeader(env, aud));
        const r = await fetch(t.endpoint, {
          method: 'POST',
          headers: { 'TTL': '1800', 'Urgency': 'high', 'Authorization': auds.get(aud) },
        });
        if (r.status === 404 || r.status === 410) { gone++; await env.CACHE.delete(t.key); }
        else if (r.ok || r.status === 201) sent++;
        else failed++;
      } catch { failed++; }
    }));
  }
  return json({ status: 'ok', matched: targets.length, sent, gone, failed }, 200, cors);
}

/* ── 익명 사용 계측 — 이벤트 이름별 일 단위 카운터. 페이로드는 {ev}뿐(지역·입력·식별자 없음).
   KV 증분은 동시 요청에서 일부 유실될 수 있으나(비원자적) 추세 파악용으론 충분하다.
   조회는 wrangler kv key list/get (stat:YYYY-MM-DD:이벤트). 400일 보존. ── */
const STAT_EVS = new Set(['wizard_submit', 'nearmiss_shown', 'welfare_shown', 'print', 'share_copy', 'ins_click', 'welfare_click']);
/* 최근 14일 이벤트별 카운트 — 익명 집계라 공개 조회 무해. 사업 지표 대시보드용. */
async function statSummary(env) {
  const days = [];
  for (let i = 0; i < 14; i++) days.push(new Date(Date.now() + 9 * 3600e3 - i * 86400e3).toISOString().slice(0, 10));
  const out = {};
  for (const d of days) {
    const row = {};
    for (const ev of STAT_EVS) {
      const v = await env.CACHE.get(`stat:${d}:${ev}`);
      if (v) row[ev] = +v;
    }
    if (Object.keys(row).length) out[d] = row;
  }
  return { status: 'ok', days: out };
}
async function stat(req, env) {
  if (req.method !== 'POST') return { status: 'method' };
  let ev = '';
  try { ev = String((await req.json()).ev || ''); } catch (e) { /* not json */ }
  if (!STAT_EVS.has(ev)) return { status: 'bad' };
  const key = `stat:${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}:${ev}`; // KST 일자
  const n = parseInt(await env.CACHE.get(key) || '0', 10) + 1;
  await env.CACHE.put(key, String(n), { expirationTtl: 400 * 86400 });
  return { status: 'ok' };
}
