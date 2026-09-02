/* AidPage 카카오톡 채널 챗봇 — 카카오 i 오픈빌더 "스킬 서버" (POST /kakao/skill)
   오픈빌더의 폴백 블록이 모든 발화를 이 스킬로 넘기면, 여기서 키워드로 의도를 가르고
   사이트가 이미 공개 중인 data/live/alerts.json(특보·재난문자·산사태·예비특보)을 읽어 답한다.
   - 키 불필요: 오픈빌더 → 이 URL 호출뿐. 카카오 앱 키·REST 키는 쓰지 않는다.
   - 개인정보: 오픈빌더가 주는 봇 사용자 키(botUserKey, 채널별 가명)만 해시해 "내 동네" 저장(KV, 180일). 발화 원문은 저장하지 않는다.
   - 응답 규격: {version:"2.0", template:{outputs:[simpleText|basicCard], quickReplies:[...]}} — outputs ≤3, quickReplies ≤10, 5초 안에 응답.
   - 원칙: 심사하지 않고 안전 판정하지 않는다. 데이터가 없으면 "없음/정보 없음"이라고 말한다. */
const SITE = 'https://5-jihwan.github.io/aidpage/';
const TTL = { alerts: 300, sgg: 86400, user: 180 * 86400 };
const QR = ['특보', '재난문자', '대피소', '지원 찾기', '내 동네 등록', '도움말'];

export async function kakaoSkill(req, env) {
  if (req.method !== 'POST') return { status: 'ok', hint: 'POST from Kakao i OpenBuilder skill', version: 'kakao-1' };
  let body = {}; try { body = await req.json(); } catch (e) { /* not json */ }
  const utter = String((body.userRequest && body.userRequest.utterance) || '').trim();
  const params = (body.action && body.action.params) || {};
  const uid = body.userRequest && body.userRequest.user && body.userRequest.user.id ? await hash(String(body.userRequest.user.id)) : null;
  const ctx = { env, uid, alerts: () => cachedJSON(env, 'kk:alerts', TTL.alerts, SITE + 'data/live/alerts.json'), sgg: () => cachedJSON(env, 'kk:sgg', TTL.sgg, SITE + 'data/admin/sgg_index.json') };
  return reply(utter, params, ctx);
}

/* ---------- 의도 → 답 ---------- */
export async function reply(utter, params, ctx) {
  const text = (params.region ? params.region + ' ' : '') + utter;
  const idx = await regionIndex(ctx);
  const found = findRegion(text, idx);
  const wants = k => KW[k].some(w => text.includes(w));
  // 지역이 모호하면(예: "중구") 시·도를 고르게 한다
  if (found && found.ambiguous) return out(`"${found.name}"은(는) 여러 시·도에 있어요. 어디의 ${found.name}인가요?`, found.options.map(o => `${o.sidoShort} ${o.name}`));
  let region = found;
  if (!region && ctx.uid) region = await getUser(ctx);
  if (wants('register')) {
    if (!found) return out('등록할 동네를 함께 말해 주세요. 예) "내 동네 등록 관악구"', QR);
    if (ctx.uid) await setUser(ctx, found);
    return out(`${label(found)}을(를) 내 동네로 기억할게요. 이제 "특보"나 "재난문자"만 보내도 이 동네 기준으로 알려드려요.\n(저장되는 건 동네 이름뿐, 대화 내용은 저장하지 않아요)`, QR);
  }
  if (wants('help') || (!utter && !params.region)) return help();
  if (wants('support')) return support(region);
  if (wants('shelter')) return shelter(region);
  if (wants('messages')) { if (!region) return askRegion('재난문자'); return messages(region, ctx); }
  if (wants('alerts')) { if (!region) return askRegion('특보'); return alerts(region, ctx); }
  // 지역명만 온 경우 = 그 동네 지금 상황
  if (found) return alerts(found, ctx);
  return help(true);
}
const KW = {
  register: ['등록', '저장', '기억'],
  help: ['도움', '도움말', '메뉴', '안녕', '시작', '뭐 해', '뭐해', '사용법'],
  support: ['지원', '지원금', '신고', '보상', '의연금', '보험', '피해', '복구'],
  shelter: ['대피소', '대피', '쉼터', '피난'],
  messages: ['재난문자', '문자'],
  alerts: ['특보', '날씨', '경보', '주의보', '위험', '지금', '상황', '비 ', '태풍', '폭염', '한파', '산사태', '지진'],
};
function help(unknown = false) {
  const head = unknown ? '무슨 말씀인지 잘 모르겠어요. 이렇게 물어보실 수 있어요:\n' : 'AidPage예요. 이렇게 물어보실 수 있어요:\n';
  return out(head + '• "관악구 특보" — 지금 발효 중인 특보·산사태 예보\n• "진안군 재난문자" — 최근 24시간 재난문자\n• "대피소" — 가까운 대피소 지도\n• "지원 찾기" — 내 상황에 맞는 지원금·기한\n• "내 동네 등록 관악구" — 다음부터 동네 생략\n\n안내이지 심사가 아니에요. 최종 판단은 관할 지자체입니다.', QR,
    card('AidPage · 내 상황에 맞는 안전, 한 장으로', '지도·특보·지원금·서류를 한 화면에서. 입력은 서버로 가지 않아요.', [btn('AidPage 열기', SITE)]));
}
const askRegion = what => out(`어느 동네의 ${what}인가요? 시·군·구 이름을 알려주세요. 예) "관악구 ${what}"\n"내 동네 등록 관악구"라고 하면 다음부턴 생략할 수 있어요.`, QR);

async function alerts(region, ctx) {
  const A = await ctx.alerts();
  if (!A) return out(`${label(region)} 특보 정보를 지금 불러오지 못했어요. 잠시 후 다시 물어봐 주세요.`, QR, siteCard(region));
  const lines = [];
  const ws = (A.warnings && A.warnings.items || []).filter(w => matchWarn(w, region));
  for (const w of ws) lines.push(`⚠ ${w.type || ''}${w.level || ''} ${w.since ? '(' + hhmm(w.since) + '~)' : ''}`.trim());
  const ls = (A.landslide && A.landslide.items || []).filter(it => it.region && (region.sidoOnly || it.region.includes(region.name)) && it.region.includes(region.sidoName) && fresh(it.at, 24));
  for (const it of ls) lines.push(`⛰ 산사태 ${it.level} (산림청, ${hhmm(it.at)})`);
  const pre = A.prewarn && !A.prewarn.none && A.prewarn.text && A.prewarn.text.includes(region.sidoShort) && fresh(A.prewarn.updated || A.prewarn.at, 36) ? '📋 예비특보: ' + A.prewarn.text.replace(/\s+/g, ' ').slice(0, 200) : '';
  const stale = !fresh(A.updated, 3);
  let text = `${label(region)} · ${A.updated ? hhmm(A.updated) + ' 기준' : ''}\n`;
  text += lines.length ? lines.join('\n') : (stale ? '특보 정보 없음 (수집이 3시간 이상 지났어요)' : '지금 발효 중인 특보 없음');
  if (pre) text += '\n' + pre;
  const ms = msgsFor(A, region).slice(0, 2);
  if (ms.length) text += '\n\n최근 재난문자\n' + ms.map(fmtMsg).join('\n');
  text += '\n\n[기상청 특보 · 행안부 재난문자 · AidPage 안내]';
  return out(text.slice(0, 990), QR, siteCard(region));
}
async function messages(region, ctx) {
  const A = await ctx.alerts();
  if (!A) return out('재난문자를 지금 불러오지 못했어요. 잠시 후 다시 물어봐 주세요.', QR, siteCard(region));
  const ms = msgsFor(A, region);
  const head = `${label(region)} 재난문자 (최근 24시간, ${ms.length}건)\n`;
  const body = ms.length ? ms.slice(0, 5).map(fmtMsg).join('\n') : '이 지역·전국 대상 문자가 없어요.';
  return out((head + body + '\n\n[행안부 · 재난안전데이터공유플랫폼]').slice(0, 990), QR, siteCard(region));
}
function shelter(region) {
  const text = (region ? `${label(region)} 대피소는 지도에서 가까운 순으로 볼 수 있어요.` : '동네를 고르면 가까운 대피소를 걸어서 몇 분인지와 함께 보여드려요.') +
    '\n민방위 대피소·무더위/한파 쉼터·지진 옥외대피소·임시주거시설을 함께 표시해요. 물이 흐르는 길과 지하차도는 피하세요.';
  return out(text, QR, card('가까운 대피소 보기', '📍 내 위치 버튼을 누르면 가장 가까운 3곳이 나와요', [btn('지도 열기', region ? SITE + (region.sidoOnly ? '#g?sido=' : '#g?sgg=') + region.code : SITE)]));
}
function support(region) {
  const text = '피해를 입으셨다면 순서는 이래요:\n1) 치우기 전에 사진(물 자국·가전·벽)\n2) 재난이 끝난 날부터 10일 안에 주민센터 피해신고\n3) 피해사실확인서로 지원금·감면 신청\n\n"지원 찾기"에서 집·가게·피해 종류 다섯 가지만 고르면 받을 수 있는 항목과 서류를 보여드려요. 결과는 해당 가능성이고 심사는 지자체가 해요.';
  return out(text, QR, card('지원 찾기', '현금 지원 · 감면 · 의연금 · 긴급복지 · 서류 체크리스트', [btn('지원 찾기 열기', region ? SITE + (region.sidoOnly ? '#g?sido=' : '#g?sgg=') + region.code + '&tab=find' : SITE + '#g?tab=find'), btn('국민안전24 피해신고', 'https://www.safekorea.go.kr/')]));
}

/* ---------- 지역 ---------- */
async function regionIndex(ctx) {
  const list = await ctx.sgg();
  if (!Array.isArray(list)) return { sgg: [], sido: [] };
  const sidoMap = new Map();
  const sgg = list.map(s => { const sidoShort = shortSido(s.sido_name); if (!sidoMap.has(s.sido)) sidoMap.set(s.sido, { code: s.sido, name: s.sido_name, short: sidoShort }); return { code: String(s.code), name: s.name, base: s.name.replace(/(특별자치)?[시군구]$/, ''), sido: String(s.sido), sidoName: s.sido_name, sidoShort }; });
  return { sgg, sido: [...sidoMap.values()] };
}
export function shortSido(n) {
  if (!n) return '';
  if (/특별자치|광역시|특별시/.test(n)) return n.slice(0, 2);
  if (n.endsWith('도')) return n.length === 3 ? n.slice(0, 2) : n[0] + n[2];
  return n.slice(0, 2);
}
export function findRegion(text, idx) {
  const t = text.replace(/\s+/g, ' ');
  const sido = idx.sido.find(s => t.includes(s.name)) || idx.sido.find(s => t.includes(s.short));
  // 긴 이름부터 (예: "남해군" vs "해남군", "고성군" 중복)
  const cands = idx.sgg.filter(s => t.includes(s.name) || (s.base.length >= 2 && new RegExp(s.base + '(시|군|구|\\s|$|에|의|은|는|도)').test(t)));
  let hits = cands;
  if (sido) hits = cands.filter(s => s.sido === sido.code);
  if (!hits.length && sido && !cands.length) return { code: sido.code, name: '', sido: sido.code, sidoName: sido.name, sidoShort: sido.short, sidoOnly: true };  // 시·도만 말한 경우 = 시·도 단위로 답한다
  if (!hits.length) hits = cands;
  if (!hits.length) return null;
  const names = new Set(hits.map(h => h.name));
  if (names.size === 1 && hits.length > 1) return { ambiguous: true, name: hits[0].name, options: hits.slice(0, 8) };
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0];
}
const label = r => r.sidoOnly ? r.sidoName : `${r.sidoShort} ${r.name}`;
function matchWarn(w, r) {
  const codes = w.area_codes || [], areas = w.areas || [];
  if (r.sidoOnly) return codes.some(c => c.startsWith(r.sido)) || areas.some(a => a.includes(r.sidoShort));
  return codes.includes(r.code) || codes.includes(r.sido) || areas.some(a => a.includes(r.name) || a === r.sidoName);
}
function msgsFor(A, r) {
  const items = (A.messages && A.messages.items) || [];
  return items.filter(m => { const g = (m.region || '').trim(); if (r.sidoOnly) return g.startsWith(r.sidoName) || g === '전국'; return g.includes(r.name) || g === r.sidoName || g.startsWith(r.sidoName + ' ') && !/[시군구]/.test(g.slice(r.sidoName.length + 1)) || g === '전국'; })
    .sort((a, b) => String(b.time).localeCompare(String(a.time)));
}
const fmtMsg = m => { const g = (m.region || '').trim(); const where = g.includes(' ') ? g.replace(/^\S+\s/, '') : shortSido(g) || g; return `${hhmm(m.time)} [${where}] ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 90)}`; };
const hhmm = s => { const m = String(s || '').match(/T(\d{2}:\d{2})/); return m ? m[1] : String(s || '').slice(11, 16); };
const fresh = (s, hours) => { const t = Date.parse(s || ''); return !!t && Date.now() - t < hours * 3600e3; };

/* ---------- 응답 조립 ---------- */
function out(text, quick = QR, extraCard = null) {
  const outputs = [{ simpleText: { text } }];
  if (extraCard) outputs.push(extraCard);
  return { version: '2.0', template: { outputs, quickReplies: quick.slice(0, 10).map(l => ({ label: l, action: 'message', messageText: l })) } };
}
const btn = (label, url) => ({ action: 'webLink', label, webLinkUrl: url });
const card = (title, description, buttons) => ({ basicCard: { title, description, buttons: buttons.slice(0, 3) } });
const siteCard = r => card('AidPage에서 자세히', r ? `${label(r)} 지도 · 대피소 · 오늘 할 일` : '지도 · 대피소 · 지원 찾기', [btn('AidPage 열기', r ? SITE + (r.sidoOnly ? '#g?sido=' : '#g?sgg=') + r.code : SITE)]);

/* ---------- 저장·캐시 ---------- */
async function hash(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s + '|aidpage-kakao')); return [...new Uint8Array(d)].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join(''); }
async function getUser(ctx) { try { return await ctx.env.CACHE.get('kk:u:' + ctx.uid, 'json'); } catch (e) { return null; } }
async function setUser(ctx, r) { const v = { code: r.code, name: r.name, sido: r.sido, sidoName: r.sidoName, sidoShort: r.sidoShort }; await ctx.env.CACHE.put('kk:u:' + ctx.uid, JSON.stringify(v), { expirationTtl: TTL.user }); }
async function cachedJSON(env, key, ttl, url) {
  try { const hit = await env.CACHE.get(key, 'json'); if (hit) return hit; } catch (e) { /* */ }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'AidPage-Kakao/1.0' } }); if (!r.ok) return null;
    const j = await r.json();
    try { await env.CACHE.put(key, JSON.stringify(j), { expirationTtl: ttl }); } catch (e) { /* KV 한도 초과 시 캐시 없이 진행 */ }
    return j;
  } catch (e) { return null; }
}
