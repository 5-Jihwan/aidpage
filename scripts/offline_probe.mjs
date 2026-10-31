// node scripts/offline_probe.mjs — 실제 Edge로 한 번 연 뒤 서버를 끄고, 지연 로드 모듈이 서비스워커 캐시에서 나오는지 본다. FAILED가 나오면 sw.js의 SHELL을 본다.
import { spawn } from 'node:child_process';
const web = 8793, port = 9300 + Math.floor(Math.random() * 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', ['-m', 'http.server', String(web), '--bind', '127.0.0.1'], { stdio: 'ignore' });
await sleep(1500);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [`--remote-debugging-port=${port}`, `--user-data-dir=${process.env.LOCALAPPDATA}/Temp/edge_probe_${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=900,700', `http://127.0.0.1:${web}/index.html`], { stdio: 'ignore' });
let target;
try {
  for (let i = 0; i < 40 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page' && t.url.startsWith('http')); } catch {} }
  if (!target) throw new Error('no page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (wait.has(m.id)) { wait.get(m.id)(m.result); wait.delete(m.id); } });
  const ev = expression => new Promise(res => { const i = ++id; wait.set(i, r => res(r?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
  await ev(`navigator.serviceWorker.ready.then(() => 1)`);
  await sleep(6000);
  console.log('controlled', await ev(`!!navigator.serviceWorker.controller`), '| caches', await ev(`caches.keys().then(k => k.join(','))`));
  server.kill(); await sleep(1000);
  console.log('server', await ev(`fetch('sw.js?probe=' + Date.now(), { cache: 'no-store' }).then(r => 'up ' + r.status).catch(() => 'down')`));
  for (const m of ['access', 'region']) console.log(m, await ev(`import('/js/${m}.js?probe=1').then(() => 'loaded').catch(e => 'FAILED: ' + e.message)`));
  ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' })); await sleep(800);
} finally { server.kill(); edge.kill(); }
