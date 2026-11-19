// node worker/test_wake.mjs — wakeLive가 언제 수집을 깨우는지 확인(네트워크 없이)
import assert from 'node:assert/strict';
import { wakeLive } from './src/wake.js';

const at = m => new Date(Date.UTC(2026, 10, 19, 5, m));
const fake = hotStatus => { const calls = []; const f = async (url, opt = {}) => { calls.push((opt.method || 'GET') + ' ' + url.split('/aidpage/')[1]); return { status: url.includes('/dispatches') ? 204 : hotStatus }; }; f.calls = calls; return f; };

assert.equal(await wakeLive({}, at(0), fake(404)), 'no_token');                      // 토큰이 없으면 조용히 끝
let f = fake(404); assert.equal(await wakeLive({ GH_DISPATCH_TOKEN: 'x' }, at(0), f), 'dispatched'); assert.deepEqual(f.calls, ['POST actions/workflows/live.yml/dispatches']);
f = fake(404); assert.equal(await wakeLive({ GH_DISPATCH_TOKEN: 'x' }, at(30), f), 'dispatched');
f = fake(404); assert.equal(await wakeLive({ GH_DISPATCH_TOKEN: 'x' }, at(10), f), 'off_slot'); assert.equal(f.calls.length, 1);   // 평시 10·20·40·50분은 건너뜀
f = fake(200); assert.equal(await wakeLive({ GH_DISPATCH_TOKEN: 'x' }, at(20), f), 'dispatched'); assert.equal(f.calls.length, 2); // 경보 중이면 10분마다
const bad = async () => ({ status: 403 }); assert.equal(await wakeLive({ GH_DISPATCH_TOKEN: 'x' }, at(0), bad), 'error:403');
console.log('wake ok');
