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
export { Store } from './store.js';
const VERSION = '0.3.4';
const store = env => env.STORE.get(env.STORE.idFromName('global'));   // 10-15: 집계·제보 = Durable Object(store.js)
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
        case '/stat/summary': return json(await statSummary(req, env), 200, cors);
        case '/push/vapid': return json({ status: 'ok', key: env.VAPID_PUB || '' }, 200, cors);
        case '/push/sub': return json(await pushSub(req, env), 200, cors);
        case '/push/unsub': return json(await pushUnsub(req, env), 200, cors);
        case '/push/send': return pushSend(req, env, cors);
        case '/kakao/skill': return json(await kakaoSkill(req, env), 200, cors);
        default: return json({ status: 'error:404' }, 404, cors);
      }
    } catch (e) {
      console.error(e);   // 10-15 docs/64 #10: 내부 메시지는 로그에만
      return json({ status: 'error:500' }, 200, cors);
    }
  },
};

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = !origin || allowed.includes(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' } : {};
}
async function rateLimited(env, ip) {
  // 10-15(code-review): 옛 KV 카운터는 '첫 번째·5의 배수'만 저장해 다시 읽으면 늘 1 → 2에서 멈춰 한 번도 걸리지 않았고,
  //   KV 쓰기 한도(1,000/일)를 갉아먹다 한도가 차면 여기서 예외 → 모든 요청 1101. 바인딩(RL)은 KV를 쓰지 않는다.
  //   바인딩이 없거나 실패하면 막지 않는다(가용성 우선 — 남용 방지는 쓰기 경로의 자체 상한이 2차로 막음).
  try { return env.RL ? !(await env.RL.limit({ key: ip })).success : false; } catch { return false; }
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
  return cached(env, `news:${sgg}:${name}`, TTL.news, async () => {
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
  return cached(env, `er:${sgg}:${sido}:${name}`, TTL.er, async () => {
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
  if (!/^\d{1,8}$/.test(mst) || (art && !/^[제0-9의조항호목①-⑳ ]{1,20}$/.test(art))) return { status: 'error:400', updated: now() };   // 10-15 #13
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
  const list = await store(env).listReports(sgg, REPORT.ttl, REPORT.hideAt);
  return { status: 'ok', updated: now(), items: list };
}
async function report(req, env, ip) {
  let b; try { b = await req.json(); } catch { return { status: 'error:400' }; }
  const sgg = String(b.sgg || ''), kind = String(b.kind || ''), text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, REPORT.maxText);
  if (!/^\d{5}$/.test(sgg) || !REPORT.kinds.includes(kind) || text.length < 4) return { status: 'error:400' };
  if (/https?:\/\/|www\.|\d{3}-\d{3,4}-\d{4}/.test(text)) return { status: 'error:400', message: 'no links or phone numbers' };
  const lon = +b.lon, lat = +b.lat, hasPt = Number.isFinite(lon) && Number.isFinite(lat) && lon > 124 && lon < 132 && lat > 33 && lat < 39;
  const item = { id: Math.random().toString(36).slice(2, 10), t: Date.now(), kind, text, emd: /^\d{10}$/.test(String(b.emd || '')) ? String(b.emd) : null, lon: hasPt ? +lon.toFixed(3) : null, lat: hasPt ? +lat.toFixed(3) : null };
  // 10-15(docs/64 #17): 상한 확인·저장을 DO 안에서 한 번에 — KV 읽기→쓰기 사이 동시 요청이 서로 덮던 것
  const r = await store(env).addReport(sgg, item, await hashIp(ip, env), REPORT);
  return r.status === 'ok' ? { status: 'ok', item: { ...item, flags: 0 } } : r;
}
async function flag(req, env, ip) {
  let b; try { b = await req.json(); } catch { return { status: 'error:400' }; }
  const sgg = String(b.sgg || ''), id = String(b.id || '');
  if (!/^\d{5}$/.test(sgg) || !/^[a-z0-9]{6,10}$/.test(id)) return { status: 'error:400' };
  return store(env).flagReport(sgg, id, await hashIp(ip, env), REPORT.hideAt);
}
async function sha256hex(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const hashIp = async (ip, env) => (await sha256hex(ip + '|' + (env.IP_SALT || env.PUSH_AUTH || 'safepic'))).slice(0, 12);   // 10-15: 비밀 솔트

/* ---------- /push — 웹 푸시 (특보·재난문자 알림) ----------
   페이로드 없는 push(RFC8030)만 보낸다 → RFC8291 암호화가 필요 없고,
   알림 내용은 SW가 push 수신 시 alerts.json을 새로 읽어 구성한다.
   따라서 서버는 "지금 다시 봐" 신호만 전달하며 개인정보를 발송하지 않는다.
   구독 저장: KV psub:<sha256(endpoint)> = { endpoint, sgg, sido, t } (TTL 180일,
   재구독 시 갱신). keys(p256dh/auth)는 향후 페이로드 push 대비로만 보관. */
const PUSH_TTL = 180 * 86400;

async function subKey(endpoint) { return 'psub:' + await sha256hex(endpoint); }

// 10-15(docs/64): 브라우저 푸시 서비스(크롬·엣지 FCM, 파이어폭스, 윈도, 애플)만 받는다
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)\//;
async function pushSub(req, env) {
  if (req.method !== 'POST') return { status: 'error:405' };
  const b = await req.json().catch(() => null);
  if (!b || !b.endpoint || !PUSH_HOSTS.test(b.endpoint) || String(b.endpoint).length > 1000) return { status: 'error:bad_sub' };
  const rec = { endpoint: b.endpoint, keys: b.keys || null,
                sgg: String(b.sgg || '').slice(0, 5), sido: String(b.sido || '').slice(0, 2),
                t: now() };
  await env.CACHE.put(await subKey(b.endpoint), JSON.stringify(rec), { expirationTtl: PUSH_TTL, metadata: { sgg: rec.sgg, sido: rec.sido } });
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

async function sameSecret(a, b) {   // 길이와 무관하게 해시로 같은 시간 비교
  const [x, y] = await Promise.all([sha256hex(a), sha256hex(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
async function pushSend(req, env, cors) {
  if (req.method !== 'POST') return json({ status: 'error:405' }, 405, cors);
  if (!env.PUSH_AUTH || !(await sameSecret(req.headers.get('X-Push-Auth') || '', env.PUSH_AUTH)))   // 10-15 #12: 상수 시간 비교
    return json({ status: 'error:403' }, 403, cors);
  const b = await req.json().catch(() => ({}));
  const sggs = new Set((b.sggs || []).map(String));       // 시군구 코드 5자리
  const sidos = new Set((b.sidos || []).map(String));     // 시도 코드 2자리
  const all = b.all === true;                             // 전국 발송(재난문자 '전국')
  // 10-15(code-review): 대상이 비면 보내지 않는다 — 예전 조건은 빈 본문 {}이 전국 발송이 됐다
  if (!all && sggs.size === 0 && sidos.size === 0) return json({ status: 'ok', matched: 0, sent: 0, note: 'no_target' }, 200, cors);
  const offset = Math.max(0, parseInt(b.offset, 10) || 0), LIMIT = 40;   // 무료 플랜 하위 요청 50 — 남는 건 next로 이어 보낸다

  const keys = [];
  let cursor;
  do {
    const page = await env.CACHE.list({ prefix: 'psub:', cursor });
    for (const k of page.keys) {
      const m = k.metadata;   // 새 구독은 지역이 메타데이터에 있다 → get 없이 거른다
      if (m && !(all || sggs.has(m.sgg) || sidos.has(m.sido))) continue;
      keys.push(k.name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const targets = [];
  for (const name of keys) {
    const rec = await env.CACHE.get(name, 'json');
    if (!rec || !rec.endpoint) continue;
    if (all || sggs.has(rec.sgg) || sidos.has(rec.sido)) targets.push({ key: name, endpoint: rec.endpoint });
  }
  const total = targets.length;
  const batch = targets.slice(offset, offset + LIMIT);
  const next = offset + LIMIT < total ? offset + LIMIT : null;

  let sent = 0, gone = 0, failed = 0;
  const auds = new Map();
  for (let i = 0; i < batch.length; i += 20) {
    await Promise.all(batch.slice(i, i + 20).map(async (t) => {
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
  return json({ status: 'ok', matched: total, sent, gone, failed, next }, 200, cors);
}

/* ── 익명 사용 계측 — 이벤트 이름별 일 단위 카운터. 페이로드는 {ev}뿐(지역·입력·식별자 없음).
   10-15(docs/64 #2): 증분은 Durable Object(SQLite, 원자적)로 — KV 쓰기 한도(계정 공유 1,000/일)를 집계가 다 쓰면 제보·푸시·캐시가 멈췄다.
   10-15 이전 KV 값은 그대로 두고(동결) 조회 때 KV + DO를 더한다.
   키: stat:YYYY-MM-DD:이벤트 (400일) · visit만 월(stat:m:YYYY-MM:visit)·연(stat:y:YYYY:visit)·누적(stat:all:visit) 키를 함께 올린다(무기한).
   09-14: visit(세션당 1회)·깔때기(wiz_q2~q5·wiz_self/proxy·wiz_zero)·시도 단위 제출(sub_sido_NN)·sim_run 추가.
   sub_sido_NN 은 두 자리 시도 코드만 허용 — 시군구 이하 단위는 받지 않는다(소수 카운트 재식별 여지 차단). ── */
const STAT_EVS = new Set(['visit', 'wizard_submit', 'nearmiss_shown', 'welfare_shown', 'print', 'share_copy', 'ins_click', 'welfare_click', 'js_error_m', 'js_error_d', 'region_open', 'region_open_m', 'region_to_find', 'region_maplink',
  'sim_run', 'wiz_q2', 'wiz_q3', 'wiz_q4', 'wiz_q5', 'wiz_self', 'wiz_proxy', 'wiz_zero']);
const STAT_SIDO = /^sub_sido_\d{2}$/;
const STAT_ALLOW = ev => STAT_EVS.has(ev) || STAT_SIDO.test(ev);
const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
/* 최근 N일(기본 14, 최대 30) 이벤트별 카운트 + 방문 합계(오늘·이번 달·올해·누적) — 익명 집계라 공개 조회 무해.
   ?days=N 은 daily.yml 이 repo 패널(data/stats/daily.csv)로 옮길 때 쓴다.
   일별 표는 KV 읽기가 N×이벤트 수(≈25)라 2~5초 걸리고 KV 호출 한도(1,000/요청)에 걸릴 수 있어
   10분 캐시(stat:cache:summary:N)로 답한다. 방문 합계 4개는 매번 새로 읽어 about 줄이 즉시 반영되게 한다. */
const SUMMARY_TTL = 600;
async function statSummary(req, env) {
  const url = new URL(req.url);
  const nDays = Math.min(30, Math.max(1, parseInt(url.searchParams.get('days') || '14', 10) || 14));
  const today = kstDate();
  const ckey = `stat:cache:summary:${nDays}`;
  let days = null, cachedAt = null;
  try { const c = JSON.parse(await env.CACHE.get(ckey) || 'null'); if (c && c.today === today) { days = c.days; cachedAt = c.at; } } catch { /* 캐시 손상 → 재계산 */ }
  if (!days) {
    const list = [];
    for (let i = 0; i < nDays; i++) list.push(kstDate(Date.now() - i * 86400e3));
    const sidoKeys = (await env.CACHE.list({ prefix: 'stat:sido:' })).keys.map(k => k.name.slice(10)); // 10-15 이전 시도 코드(KV)
    const evs = [...STAT_EVS, ...sidoKeys.map(c => `sub_sido_${c}`)];
    const dob = await store(env).scan('stat:2');   // DO 일별 카운터 전부(stat:YYYY-…)
    const legacy = list.filter(d => d <= '2026-10-15');   // KV엔 10-15까지만 있다
    days = {};
    for (const d of list) {
      const row = {};
      if (legacy.includes(d)) await Promise.all(evs.map(async ev => { const v = await env.CACHE.get(`stat:${d}:${ev}`); if (v) row[ev] = +v; }));
      for (const [k, n] of Object.entries(dob)) if (k.startsWith(`stat:${d}:`)) { const ev = k.slice(16); row[ev] = (row[ev] || 0) + n; }
      if (Object.keys(row).length) days[d] = row;
    }
    cachedAt = now();
    await env.CACHE.put(ckey, JSON.stringify({ today, at: cachedAt, days }), { expirationTtl: SUMMARY_TTL });
  }
  const vk = [`stat:${today}:visit`, `stat:m:${today.slice(0, 7)}:visit`, `stat:y:${today.slice(0, 4)}:visit`, 'stat:all:visit'];
  const [kv, dov] = await Promise.all([Promise.all(vk.map(k => env.CACHE.get(k))), store(env).get(vk)]);
  const [t, m, y, all] = vk.map((k, i) => +(kv[i] || 0) + (dov[k] || 0));
  return { status: 'ok', updated: now(), cached_at: cachedAt, today, visits: { today: +(t || 0), month: +(m || 0), year: +(y || 0), total: +(all || 0), since: '2026-09-14' }, days };
}
async function stat(req, env) {
  if (req.method !== 'POST') return { status: 'method' };
  let ev = '';
  try { ev = String((await req.json()).ev || ''); } catch (e) { /* not json */ }
  if (!STAT_ALLOW(ev)) return { status: 'bad' };
  const d = kstDate(); // KST 일자
  await store(env).inc(ev === 'visit' ? [`stat:${d}:visit`, `stat:m:${d.slice(0, 7)}:visit`, `stat:y:${d.slice(0, 4)}:visit`, 'stat:all:visit'] : [`stat:${d}:${ev}`]);
  return { status: 'ok' };
}
