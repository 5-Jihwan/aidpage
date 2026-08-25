// node scripts/test_rules.mjs
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES_DIR = path.join(ROOT, 'rules');
const { loadRules, evaluate, formatKRW, addDays, diffDays } = await import(pathToFileURL(path.join(ROOT, 'js', 'rules.js')).href);

// ---- 0. 모든 JSON 파싱 + 필수 필드 ----
const files = (await readdir(RULES_DIR)).filter((f) => f.endsWith('.json') && f !== 'en.json' && f !== 'changelog.json'); // en=언어 오버레이(객체), changelog=이력
const stats = { files: {}, confidence: { verified: 0, reported: 0, estimate: 0 } };
for (const f of files) {
  const doc = JSON.parse(await readFile(path.join(RULES_DIR, f), 'utf8'));
  assert.ok(doc.meta && doc.meta.title && doc.meta.asof, `${f}: meta.title/asof`);
  const items = doc.rules || doc.steps || doc.entries || [];
  stats.files[f] = items.length;
  for (const r of items) {
    for (const k of ['basis', 'basis_url', 'confidence']) assert.ok(r[k], `${f}:${r.id || r.title} missing ${k}`);
    if (doc.rules) {
      for (const k of ['id', 'group', 'label', 'summary', 'conditions', 'channel', 'amount_text', 'unit', 'where', 'docs', 'effective_from', 'rate_asof', 'notes']) {
        assert.ok(k in r, `${f}:${r.id} missing ${k}`);
      }
      assert.ok(r.amount_krw === null || typeof r.amount_krw === 'number', `${f}:${r.id} amount_krw`);
      if (r.amount_krw == null) assert.ok(r.amount_text, `${f}:${r.id} needs amount_text when amount_krw null`);
    }
    stats.confidence[r.confidence] = (stats.confidence[r.confidence] || 0) + 1;
  }
}

const rules = await loadRules('rules/', async (name) => JSON.parse(await readFile(path.join(RULES_DIR, `${name}.json`), 'utf8')));

const ids = (arr) => arr.map((r) => r.id);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---- 1. 임차·침수·수급·특별재난지역 ----
test('임차 침수 수급 특별재난지역 → 350+200만원, 건보 경감 포함', () => {
  const r = evaluate(rules, { housing: 'rent', damage: ['flood'], household: ['basic'], special_zone: true, hazard: 'rain', event_end: '2026-08-15', today: '2026-08-21' });
  assert.ok(ids(r.cash).includes('cash.house_flood'));
  assert.ok(ids(r.relief_fund).includes('relief_fund.house_flood'));
  assert.equal(r.total_cash_krw, 5_500_000);
  assert.ok(ids(r.auto).includes('indirect.nhis_premium'));
  assert.ok(ids(r.auto).includes('indirect.electricity'));
  assert.ok(ids(r.apply).includes('indirect.telecom'));
  assert.ok(ids(r.apply).includes('indirect.emergency_welfare'), '수급자 → 긴급복지 표시');
  assert.ok(ids(r.insurance).includes('insurance.house_basic'));
  assert.ok(!ids(r.cash).includes('cash.house_full'), '임차는 전파 지원금 비대상');
  assert.ok(!ids(r.apply).includes('indirect.local_tax'), '임차는 재산세 감면 비대상');
});

// ---- 2. 상가 침수 ----
test('상가 침수 → 소상공인 300만원, 의연금 없음', () => {
  const r = evaluate(rules, { housing: 'shop', damage: ['flood'], household: [], special_zone: false, hazard: 'rain', event_end: '2026-08-15', today: '2026-08-21' });
  assert.deepEqual(ids(r.cash), ['cash.small_biz_stability']);
  assert.equal(r.relief_fund.length, 0);
  assert.equal(r.total_cash_krw, 3_000_000);
  assert.ok(ids(r.apply).includes('indirect.sme_guarantee'));
  assert.ok(ids(r.insurance).includes('insurance.small_biz'));
});

// ---- 3. 전파 자가 ----
test('전파 자가 → 범위 텍스트, 의연금 1,000만원, 합계에 미확정 표시', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['full'], household: [], special_zone: true, hazard: 'typhoon', event_end: '2026-08-15', today: '2026-08-21' });
  const full = r.cash.find((x) => x.id === 'cash.house_full');
  assert.ok(full && full.amount_krw === null && /2,000만/.test(full.amount_text));
  assert.ok(!ids(r.cash).includes('cash.tenant_subsidy'));
  assert.equal(r.total_cash_krw, 10_000_000);
  assert.ok(r.total_cash_has_unpriced);
  assert.ok(/미확정/.test(r.total_cash_text));
  assert.ok(ids(r.auto).includes('indirect.tv_license'));
});

// ---- 4. 특별재난지역 아님 ----
test('special_zone=false → 특별재난지역 전용 항목 제외', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['flood'], special_zone: false, hazard: 'rain', event_end: '2026-08-15', today: '2026-08-21' });
  const all = [...ids(r.auto), ...ids(r.apply), ...ids(r.info)];
  for (const id of ['indirect.nhis_premium', 'indirect.electricity', 'indirect.telecom', 'indirect.citygas', 'indirect.military_postpone']) {
    assert.ok(!all.includes(id), `${id} should be absent`);
  }
  assert.ok(all.includes('indirect.local_tax'));
  assert.ok(all.includes('indirect.national_tax'));
  assert.ok(all.includes('indirect.nps_exemption'));
  assert.equal(r.total_cash_krw, 5_500_000, '재난지원금 350 + 의연금 200 은 일반지역도 동일');
});

// ---- 5. 마감 계산 ----
test('deadline: 종료일 2026-08-15, 오늘 08-21 → due 08-25, D-4', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['flood'], hazard: 'rain', event_end: '2026-08-15', today: '2026-08-21' });
  assert.equal(r.deadlines.length, 1);
  assert.equal(r.deadlines[0].due, '2026-08-25');
  assert.equal(r.deadlines[0].days_left, 4);
  assert.ok(/D-4/.test(r.todo[0].text));
});

test('deadline: 월말 넘김·마감 경과', () => {
  assert.equal(addDays('2026-08-25', 10), '2026-09-04');
  assert.equal(addDays('2026-12-28', 10), '2027-01-07');
  assert.equal(diffDays('2026-08-21', '2026-08-21'), 0);
  const r = evaluate(rules, { housing: 'own', damage: ['flood'], hazard: 'rain', event_end: '2026-08-01', today: '2026-08-21' });
  assert.equal(r.deadlines[0].days_left, -10);
  assert.ok(/경과/.test(r.todo[0].text));
  const r2 = evaluate(rules, { housing: 'own', damage: ['flood'], hazard: 'rain', today: '2026-08-21' });
  assert.equal(r2.deadlines.length, 0, '종료일 없으면 마감 미산출');
});

// ---- 6. 세입자 반파 ----
test('임차 반파 → 세입자보조 600 + 의연금 500, 전파·반파 자가 항목 없음', () => {
  const r = evaluate(rules, { housing: 'rent', damage: ['half'], hazard: 'rain', special_zone: true, event_end: '2026-08-15', today: '2026-08-21' });
  assert.ok(ids(r.cash).includes('cash.tenant_subsidy'));
  assert.ok(!ids(r.cash).includes('cash.house_half'));
  assert.ok(ids(r.relief_fund).includes('relief_fund.house_half'));
  assert.equal(r.total_cash_krw, 11_000_000);
  assert.ok(ids(r.apply).includes('indirect.temp_housing'));
});

// ---- 7. 부상: exclusive_group 최소값 ----
test('부상 → 의연금 1~7급·8~14급 모두 표시, 합계는 500만원만', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['injury'], hazard: 'rain', today: '2026-08-21' });
  assert.ok(ids(r.relief_fund).includes('relief_fund.injury_severe'));
  assert.ok(ids(r.relief_fund).includes('relief_fund.injury_minor'));
  assert.equal(r.total_cash_krw, 5_000_000);
  assert.ok(ids(r.cash).includes('cash.injury'));
});

// ---- 8. 폭염 ----
test('폭염 + 노인 수급 → 쉼터·에너지바우처, 주택 현금항목 없음', () => {
  const r = evaluate(rules, { housing: 'rent', damage: ['heat'], household: ['senior', 'basic'], hazard: 'heat', today: '2026-08-21' });
  assert.equal(r.cash.length, 0);
  assert.equal(r.relief_fund.length, 0);
  assert.ok(ids(r.heat_cold).includes('heat_cold.heat_shelter'));
  assert.ok(!ids(r.heat_cold).includes('heat_cold.cold_shelter'));
  assert.ok(ids(r.apply).includes('heat_cold.energy_voucher'));
  assert.ok(ids(r.info).includes('heat_cold.heat_illness_care'));
  assert.ok(/쉼터/.test(r.todo[0].text));
  assert.equal(r.deadlines.length, 0);
});

// ---- 9. 지진 ----
test('지진 경미피해(goods) 자가 → 의연금 소파 200만원, 침수 항목 없음', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['goods'], hazard: 'quake', today: '2026-08-21' });
  assert.ok(ids(r.relief_fund).includes('relief_fund.house_minor_quake'));
  assert.ok(!ids(r.relief_fund).includes('relief_fund.house_flood'), '침수 의연금은 지진 hazard 제외');
  assert.ok(!ids(r.cash).includes('cash.house_flood'), '침수 지원금은 지진 hazard 제외');
  const r2 = evaluate(rules, { housing: 'own', damage: ['half'], hazard: 'quake', today: '2026-08-21' });
  assert.ok(ids(r2.relief_fund).includes('relief_fund.house_half'));
  assert.ok(!ids(r2.relief_fund).includes('relief_fund.house_minor_quake'));
});

// ---- 10. 농가 ----
test('농가 침수 → 농경지 복구(금액 미확정)·농업자금·온실보험, 주택 침수금 없음', () => {
  const r = evaluate(rules, { housing: 'farm', damage: ['flood'], hazard: 'rain', today: '2026-08-21' });
  assert.ok(ids(r.cash).includes('cash.farm_recovery'));
  assert.ok(!ids(r.cash).includes('cash.house_flood'));
  assert.equal(r.total_cash_krw, 0);
  assert.ok(r.total_cash_has_unpriced);
  assert.ok(ids(r.apply).includes('indirect.farm_loan_relief'));
  assert.ok(ids(r.insurance).includes('insurance.greenhouse'));
});

// ---- 11. 복수 피해 ----
test('자가 침수+가재도구 → 침수 항목 중복 없음(1회 매칭)', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['flood', 'goods'], hazard: 'rain', today: '2026-08-21' });
  assert.equal(ids(r.cash).filter((x) => x === 'cash.house_flood').length, 1);
  assert.equal(r.total_cash_krw, 5_500_000);
});

// ---- 12. 입력 없음 ----
test('빈 입력 → 현금 0, 오류 없음, todo 3개', () => {
  const r = evaluate(rules, {});
  assert.equal(r.total_cash_krw, 0);
  assert.equal(r.todo.length, 3);
  assert.ok(Array.isArray(r.timeline) && r.timeline.length === 6);
});

// ---- 13. formatKRW ----
test('formatKRW', () => {
  assert.equal(formatKRW(3_500_000), '350만원');
  assert.equal(formatKRW(10_000_000), '1,000만원');
  assert.equal(formatKRW(100_000_000), '1억원');
  assert.equal(formatKRW(12_500), '12,500원');
  assert.equal(formatKRW(0), '0원');
  assert.equal(formatKRW(null), '—');
});

// ---- 14. 타임라인 ----
test('timeline: 피해신고 단계에 due 계산', () => {
  const r = evaluate(rules, { housing: 'own', damage: ['flood'], hazard: 'rain', event_end: '2026-08-15', today: '2026-08-21' });
  const rep = r.timeline.find((s) => s.id === 'proc.report');
  assert.equal(rep.due, '2026-08-25');
  assert.equal(rep.days_left, 4);
  assert.equal(r.timeline[0].id, 'proc.evidence');
});

// ---- 15. 모든 규칙 도달 가능성 ----
test('모든 규칙이 최소 1개 입력 조합에서 매칭됨(dead rule 없음)', () => {
  const hit = new Set();
  const housings = ['own', 'rent', 'shop', 'farm'];
  const damages = ['flood', 'half', 'full', 'goods', 'injury', 'death', 'heat', 'cold'];
  const hazards = ['rain', 'typhoon', 'heat', 'cold', 'quake', 'landslide', 'any'];
  for (const housing of housings) for (const d of damages) for (const hz of hazards) for (const sz of [true, false]) {
    const r = evaluate(rules, { housing, damage: [d], household: ['basic', 'near_poor', 'single_parent', 'senior', 'disabled'], special_zone: sz, hazard: hz, today: '2026-08-21' });
    r.matched_ids.forEach((id) => hit.add(id));
  }
  const dead = rules.all.map((r) => r.id).filter((id) => !hit.has(id));
  assert.deepEqual(dead, [], `dead rules: ${dead.join(', ')}`);
});

// ---- run ----
let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); pass++; console.log(`  ok   ${t.name}`); }
  catch (e) { fail++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
}
console.log('\nfiles:', stats.files);
console.log('confidence:', stats.confidence, 'rules total:', rules.all.length);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
