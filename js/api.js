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
