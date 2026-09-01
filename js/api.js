// AidPage — Cloudflare Worker client. Every call degrades to { status } on failure; never throws.
export const API = 'https://safepic-api.safepic.workers.dev';
async function call(path, opts = {}) {
  try {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return await r.json();
  } catch { return { status: 'offline' }; }
}
export const getReports = sgg => call(`/reports?sgg=${encodeURIComponent(sgg)}`);
export const postReport = body => call('/report', { method: 'POST', body: JSON.stringify(body) });
export const flagReport = (sgg, id) => call('/report/flag', { method: 'POST', body: JSON.stringify({ sgg, id }) });
export const getNews = (sgg, name) => call(`/news?sgg=${encodeURIComponent(sgg)}&name=${encodeURIComponent(name)}`);
export const getER = (sgg, sido, name) => call(`/er?sgg=${encodeURIComponent(sgg)}&sido=${encodeURIComponent(sido)}&name=${encodeURIComponent(name)}`);
export const getVapid = () => call('/push/vapid');
export const pushSub = body => call('/push/sub', { method: 'POST', body: JSON.stringify(body) });
export const pushUnsub = body => call('/push/unsub', { method: 'POST', body: JSON.stringify(body) });

/* 익명 사용 계측 — 이벤트 이름만 보낸다(지역·입력·식별자 없음). 하루 단위 카운터.
   전송 실패는 조용히 무시: 계측이 본 기능을 방해하면 안 된다. */
export function stat(ev) {
  try {
    const body = JSON.stringify({ ev });
    if (navigator.sendBeacon) navigator.sendBeacon(API + '/stat', new Blob([body], { type: 'application/json' }));
    else fetch(API + '/stat', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch (e) { /* no-op */ }
}
