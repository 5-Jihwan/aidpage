// node shot.mjs <url> <out.png> [waitMs] [width] [height] — 실제(GPU) Edge를 띄워 CDP로 캡처. 헤드리스는 지도 소프트웨어 렌더로 3분+ 걸려서.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const [url, out, wait = '9000', w = '1460', h = '1600'] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [`--remote-debugging-port=${port}`, `--user-data-dir=${process.env.LOCALAPPDATA}/Temp/edge_shot_${port}`, '--no-first-run', '--no-default-browser-check', `--window-size=${w},${h}`, '--window-position=40,20', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.url.startsWith('http')); } catch {} }
if (!target) { edge.kill(); throw new Error('no page target'); }
await sleep(+wait);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const data = await new Promise((res) => { ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === 1) res(m.result.data); }); ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } })); });
await writeFile(out, Buffer.from(data, 'base64'));
ws.send(JSON.stringify({ id: 2, method: 'Browser.close' })); await sleep(800); edge.kill();
console.log('saved', out);
