// node scripts/test_ui_rules.mjs — 시설 권고 안전 규칙 + 번역 키 점검
// 왜: 민방위 시설(99.5% 지하)이 호우에 권해진 결함(D11)은 화면 코드 안의 표라 test_rules가 못 봤다.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...a) => pathToFileURL(path.join(ROOT, ...a)).href;
const src = (f) => readFile(path.join(ROOT, 'js', f), 'utf8');
const { KINDS } = await import(url('js', 'shelters.js'));
const { DICT, LANGS } = await import(url('js', 'i18n.js'));

// shortcut: app_panel·app_ui는 DOM을 물고 있어 import가 안 되므로 소스에서 표만 떼어 평가한다. 순수 모듈로 분리되면 import로 교체.
const literal = (text, name) => {
  const m = new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n?\\});`).exec(text);
  assert.ok(m, `${name} 표를 소스에서 못 찾음 — 코드가 바뀌었으면 이 테스트도 고칠 것`);
  return Function(`return (${m[1]})`)();
};
const panel = await src('app_panel.js'), ui = await src('app_ui.js'), layers = await src('app_layers.js');
const ALERT_MAP = literal(panel, 'ALERT_MAP'), AUTO = literal(ui, 'AUTO');

const WATER_ALERTS = ['호우', '태풍', '산사태'];
const WATER_SITS = ['house_flood', 'shop_flood', 'before_rain', 'evacuating'];
const kindIds = new Set(KINDS.map((k) => k.id));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('물 재난 특보·상황에 민방위(지하) 시설을 권하지 않음', () => {
  for (const w of WATER_ALERTS) assert.ok(!ALERT_MAP[w].kinds.includes('civil_defense'), w);
  for (const s of WATER_SITS) assert.ok(!AUTO[s].includes('civil_defense'), s);
});

test('물 재난 특보에는 갈 곳이 하나 이상 있음', () => {
  for (const w of WATER_ALERTS) assert.ok(ALERT_MAP[w].kinds.some((k) => !KINDS.find((x) => x.id === k).hazard), w);
});

test('오늘 할 일·가까운 시설 목록이 물 재난 때 민방위를 뺀다', () => {
  assert.ok(/floodContext\(ws\) \? 'temp_housing' : 'civil_defense'/.test(panel), '오늘 할 일 분기');
  assert.ok(/if \(flood\) kinds = .*k !== 'civil_defense'/.test(layers), '가까운 시설 분기');
  const flood = /floodContext = ws => \(ws \|\| \[\]\)\.some\(w => \/([^/]+)\//.exec(panel);
  assert.ok(flood, 'floodContext 정의');
  for (const w of WATER_ALERTS) assert.ok(new RegExp(flood[1]).test(w), `floodContext가 ${w}를 놓침`);
});

test('표에 적힌 시설 종류가 모두 실제로 있음', () => {
  const used = [...Object.values(ALERT_MAP).flatMap((a) => a.kinds), ...Object.values(AUTO).flat()];
  assert.deepEqual(used.filter((k) => !kindIds.has(k)), []);
});

test('민방위 시설 말풍선에 물 재난 경고가 있음', async () => {
  const s = await src('shelters.js');
  assert.ok(/cd: \{ ko: '⚠ 지하 시설/.test(s) && /p\.kind === 'civil_defense' \? `<div class="pop-warn">/.test(s));
});

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const langs = LANGS.map(([c]) => c).filter((c) => c !== 'ko');
const dicts = { en: DICT.en };
for (const c of langs) if (c !== 'en') dicts[c] = (await import(url('js', 'i18n', `${c}.js`))).default;

test('영어판이 한국어 키를 모두 덮음', () => {
  assert.deepEqual(Object.keys(DICT.ko).filter((k) => !(k in DICT.en)), []);
});

test('번역문의 {자리표시}가 한국어와 같음(다르면 화면에 {n}이 그대로 보임)', () => {
  const bad = [];
  for (const [c, d] of Object.entries(dicts)) for (const [k, v] of Object.entries(d)) {
    if (k in DICT.ko && vars(v).join() !== vars(DICT.ko[k]).join()) bad.push(`${c}:${k}`);
  }
  assert.deepEqual(bad, []);
});

test("코드에서 t('고정 키')로 부르는 키가 사전에 있음", async () => {
  const files = (await readdir(path.join(ROOT, 'js'))).filter((f) => f.endsWith('.js'));
  const missing = new Set();
  for (const f of files) for (const m of (await src(f)).matchAll(/\bt\('([\w.-]+)'[,)]/g)) if (!(m[1] in DICT.ko)) missing.add(`${f}:${m[1]}`);
  assert.deepEqual([...missing], []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { await t.fn(); pass++; console.log(`  ok   ${t.name}`); }
  catch (e) { fail++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
