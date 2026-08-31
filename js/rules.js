/**
 * rules.js — 재난 나침반 규칙 평가기 (Rules as Code)
 * 브라우저 ES 모듈, 의존성 없음. Node(테스트)에서도 동작.
 *
 * loadRules(base)  : rules/*.json 로드 → { cash, relief_fund, indirect, insurance, heat_cold, procedures, changelog, all }
 * evaluate(rules, input) : 입력 상황에 맞는 항목·합계·마감·할 일·타임라인 산출
 * formatKRW(n)     : 3500000 → "350만원"
 *
 * 매칭 규칙: 규칙의 conditions에 존재하는 키마다 입력값과 교집합이 있어야 함(AND of any-of).
 * hazard: 규칙 목록의 'any' = 재난 종류 무관, 입력의 'any' = 미지정(모든 규칙과 매칭).
 * 키가 없으면 제약 없음. special_zone: true → 특별재난지역만, false → 일반 재난지역만, null/없음 → 무관.
 */

export const RULE_FILES = ['cash', 'relief_fund', 'indirect', 'insurance', 'heat_cold'];
export const AUX_FILES = ['procedures', 'changelog'];

export const LABELS = {
  housing: { own: '자가 주택', rent: '임차(세입자)', shop: '상가·사업장', farm: '농가·농지' },
  damage: { flood: '침수', half: '반파', full: '전파·유실', goods: '가재도구·경미 피해', injury: '부상', death: '사망·실종', heat: '폭염 피해', cold: '한파 피해' },
  household: { basic: '기초생활수급', near_poor: '차상위', single_parent: '한부모', senior: '노인', disabled: '장애인' },
  hazard: { rain: '호우', typhoon: '태풍', heat: '폭염', cold: '한파', quake: '지진', landslide: '산사태', any: '기타·전체' },
  channel: { auto_after_report: '피해신고 후 자동', apply: '별도 신청', info: '안내' },
  confidence: { verified: '검증', reported: '보도·안내 기준', estimate: '추정' },
};

/** fetch 기반 로더. Node에서는 loader 인자로 (name)=>object 를 넘길 수 있음. */
export async function loadRules(base = 'rules/', loader = null) {
  const read = loader || (async (name) => {
    const res = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`rules load failed: ${name} (${res.status})`);
    return res.json();
  });
  const out = { all: [] };
  // 7파일 직렬 왕복이 부팅을 막던 문제 — 병렬로 받고 배열 순서로 합쳐 all의 순서는 그대로 유지
  const [ruleDocs, auxDocs] = await Promise.all([
    Promise.all(RULE_FILES.map(read)), Promise.all(AUX_FILES.map(read)),
  ]);
  RULE_FILES.forEach((name, i) => { out[name] = ruleDocs[i]; for (const r of ruleDocs[i].rules || []) out.all.push(r); });
  AUX_FILES.forEach((name, i) => { out[name] = auxDocs[i]; });
  validateRules(out.all);
  return out;
}

/** 최소 스키마 검증 — 누락 시 throw (테스트·빌드에서 조기 발견). */
export function validateRules(all) {
  const ids = new Set();
  const REQ = ['id', 'group', 'label', 'summary', 'conditions', 'channel', 'basis', 'basis_url', 'confidence'];
  for (const r of all) {
    for (const k of REQ) if (!(k in r)) throw new Error(`rule ${r.id || '?'} missing "${k}"`);
    if (ids.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
    ids.add(r.id);
    if (!['verified', 'reported', 'estimate'].includes(r.confidence)) throw new Error(`rule ${r.id} bad confidence`);
    if (!['auto_after_report', 'apply', 'info'].includes(r.channel)) throw new Error(`rule ${r.id} bad channel`);
    if (r.amount_krw != null && typeof r.amount_krw !== 'number') throw new Error(`rule ${r.id} amount_krw must be number|null`);
  }
  return true;
}

// ---------- 매칭 ----------

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeInput(input = {}) {
  return {
    housing: input.housing || null,
    damage: asArray(input.damage),
    household: asArray(input.household),
    special_zone: input.special_zone === true,
    hazard: input.hazard || 'any',
    event_end: input.event_end || null,
    today: input.today || todayISO(),
  };
}

/** 단일 규칙 매칭. 이유 배열도 함께 반환(디버그·UI 설명용). */
export function matchRule(rule, rawInput) {
  const input = normalizeInput(rawInput);
  const c = rule.conditions || {};
  const why = [];

  if ('housing' in c) {
    if (!input.housing || !c.housing.includes(input.housing)) return { ok: false, why: ['housing'] };
    why.push(`housing=${input.housing}`);
  }
  if ('damage' in c) {
    const hit = input.damage.filter((d) => c.damage.includes(d));
    if (!hit.length) return { ok: false, why: ['damage'] };
    why.push(`damage=${hit.join('/')}`);
  }
  if ('household' in c) {
    const hit = input.household.filter((h) => c.household.includes(h));
    if (!hit.length) return { ok: false, why: ['household'] };
    why.push(`household=${hit.join('/')}`);
  }
  if ('hazard' in c) {
    const ok = c.hazard.includes('any') || input.hazard === 'any' || c.hazard.includes(input.hazard);
    if (!ok) return { ok: false, why: ['hazard'] };
    why.push(`hazard=${input.hazard}`);
  }
  if ('special_zone' in c && c.special_zone !== null && c.special_zone !== undefined) {
    if (c.special_zone !== input.special_zone) return { ok: false, why: ['special_zone'] };
    why.push(c.special_zone ? '특별재난지역' : '일반 재난지역');
  }
  return { ok: true, why };
}

// ---------- 날짜 ----------

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(iso, days) {
  const t = parseISO(iso);
  if (t == null) return null;
  const d = new Date(t + days * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function diffDays(fromISO, toISO) {
  const a = parseISO(fromISO), b = parseISO(toISO);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

// ---------- 금액 ----------

let LANG = 'ko';
export function setRulesLang(l) { LANG = l === 'en' ? 'en' : 'ko'; }
export function formatKRW(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (LANG === 'en') {
    if (abs >= 1e6) return `${neg}₩${(abs / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`;
    if (abs >= 1e3) return `${neg}₩${(abs / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`;
    return `${neg}₩${abs.toLocaleString('en-US')}`;
  }
  if (abs >= 10000 && abs % 10000 === 0) {
    const man = abs / 10000;
    if (man >= 10000 && man % 10000 === 0) return `${neg}${(man / 10000).toLocaleString('ko-KR')}억원`;
    return `${neg}${man.toLocaleString('ko-KR')}만원`;
  }
  return `${neg}${abs.toLocaleString('ko-KR')}원`;
}

/** 매칭된 현금성 항목 합계. exclusive_group이 같은 항목은 최소 금액 1건만 반영(보수적). */
export function sumCash(items) {
  let total = 0;
  const groups = new Map();
  for (const r of items) {
    if (r.amount_krw == null) continue;
    if (r.exclusive_group) {
      const cur = groups.get(r.exclusive_group);
      if (cur == null || r.amount_krw < cur) groups.set(r.exclusive_group, r.amount_krw);
    } else total += r.amount_krw;
  }
  for (const v of groups.values()) total += v;
  return total;
}

// ---------- 평가 ----------

const MSG = {
  ko: {
    report_deadline: '피해신고 마감 (재난 종료일 + 10일)', unpriced: ' + 금액 미확정 항목',
    disclaimer: '이 결과는 법령·고시 기준의 "해당 가능성"이며 심사 결과가 아닙니다. 최종 판단은 관할 시·군·구.',
    t_report: (when) => `피해 사진을 찍은 뒤 읍·면·동 주민센터에 자연재난 피해신고서 제출${when}`,
    t_when_over: (n) => ` (마감 ${n}일 경과 — 부득이한 사유 소명 시 연장 가능, §9⑥⑦)`, t_when_today: ' (오늘 마감)', t_when_d: (d, due) => ` (D-${d}, ${due}까지)`,
    t_report_noend: '복구 전에 피해 사진·영상을 확보하고, 재난 종료일부터 10일 이내 읍·면·동 주민센터에 피해신고',
    t_auto_pay: (list, total) => `신고·조사 후 자동 지급 예상: ${list} (합계 ${total})`, t_survey: (list) => `조사 결과에 따라 산정: ${list}`,
    t_apply: (list, more) => `피해사실확인서 발급 후 직접 신청: ${list}${more ? ` 외 ${more}건` : ''}`, t_auto: (list) => `별도 신청 없이 적용 예정(누락 시 확인서로 신청): ${list}`,
    t_shelter: (name) => `가까운 ${name} 확인 (국민안전24·안전디딤돌 앱)`, t_benefit: (list) => `주민센터 신청: ${list}`,
    t_illness: '온열·한랭질환 의심 시 즉시 119. 독거 어르신·장애인은 안부확인 서비스 연계', t_pick: '피해 유형을 선택하면 받을 수 있는 지원과 마감일이 계산됩니다',
    t_ins: (label, amt) => `다음 재난 대비: ${label} (${amt})`,
    fillers: ['관할 시·군·구 재난부서 또는 국민안전24에서 최신 공고 확인', '복구 영수증·견적서는 버리지 말고 보관 (세금 감면·보험 청구에 필요)'],
    shelter_strip: ' 이용',
  },
  en: {
    report_deadline: 'Damage-report deadline (disaster end + 10 days)', unpriced: ' + items without a fixed amount',
    disclaimer: 'This shows "possible eligibility" under current law and notices, not a decision. The municipality decides.',
    t_report: (when) => `Photograph the damage, then file the natural-disaster damage report at the community center${when}`,
    t_when_over: (n) => ` (deadline passed ${n} days ago — extension possible with a valid reason, §9⑥⑦)`, t_when_today: ' (due today)', t_when_d: (d, due) => ` (D-${d}, by ${due})`,
    t_report_noend: 'Before cleaning up, take photos/video; file the damage report at the community center within 10 days of the disaster end',
    t_auto_pay: (list, total) => `Expected automatic payment after report and survey: ${list} (total ${total})`, t_survey: (list) => `Assessed after survey: ${list}`,
    t_apply: (list, more) => `Apply yourself after getting the damage confirmation: ${list}${more ? ` and ${more} more` : ''}`, t_auto: (list) => `Applied without a separate request (use the confirmation if missed): ${list}`,
    t_shelter: (name) => `Find the nearest ${name} (SafeKorea / Safety Didimdol app)`, t_benefit: (list) => `Apply at the community center: ${list}`,
    t_illness: 'Suspected heat/cold illness: call 119 immediately. Elderly living alone and disabled people: welfare-check service.', t_pick: 'Choose a damage type to see support and deadlines',
    t_ins: (label, amt) => `Before the next disaster: ${label} (${amt})`,
    fillers: ['Check the latest notices at your city/county/district disaster division or SafeKorea', 'Keep recovery receipts and estimates (needed for tax relief and insurance claims)'],
    shelter_strip: 'Use a ',
  },
};
export function evaluate(rules, rawInput, lang = 'ko') {
  const M = MSG[lang] || MSG.ko; setRulesLang(lang);
  const input = normalizeInput(rawInput);
  const matched = [];
  for (const r of rules.all || []) {
    const m = matchRule(r, input);
    if (m.ok) matched.push({ ...r, _why: m.why });
  }

  const byGroup = (g) => matched.filter((r) => r.group === g);
  const cash = byGroup('cash');
  const relief_fund = byGroup('relief_fund');
  const insurance = byGroup('insurance');
  const heat_cold = byGroup('heat_cold');
  const indirect = byGroup('indirect');
  const serviceItems = [...indirect, ...heat_cold];
  const auto = serviceItems.filter((r) => r.channel === 'auto_after_report');
  const apply = serviceItems.filter((r) => r.channel === 'apply');
  const info = serviceItems.filter((r) => r.channel === 'info');

  const cashItems = [...cash, ...relief_fund];
  const total_cash_krw = sumCash(cashItems);
  const total_cash_has_unpriced = cashItems.some((r) => r.amount_krw == null);

  // 마감: 규칙별 deadline_days_after_event + 절차 단계 법정기한
  const deadlines = [];
  const seen = new Set();
  const pushDeadline = (label, days, scopeIds) => {
    if (days == null || !input.event_end) return;
    const key = `${label}|${days}`;
    if (seen.has(key)) return;
    seen.add(key);
    const due = addDays(input.event_end, days);
    deadlines.push({ label, due, days_left: diffDays(input.today, due), applies_to: scopeIds });
  };
  const reportIds = matched.filter((r) => r.deadline_days_after_event != null).map((r) => r.id);
  if (reportIds.length) {
    const days = Math.min(...matched.filter((r) => r.deadline_days_after_event != null).map((r) => r.deadline_days_after_event));
    pushDeadline(M.report_deadline, days, reportIds);
  }
  deadlines.sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));

  // 타임라인: 절차 단계 + 예상 날짜
  const steps = (rules.procedures && rules.procedures.steps) || [];
  const timeline = steps.map((s) => {
    let due = null;
    if (s.deadline && s.deadline.days_after_event_end != null && input.event_end) {
      due = addDays(input.event_end, s.deadline.days_after_event_end);
    }
    return {
      step: s.step, id: s.id, label: s.label, summary: s.summary,
      who: s.who, where: s.where, docs: s.docs, typical_days: s.typical_days,
      due, days_left: due ? diffDays(input.today, due) : null,
      basis: s.basis, basis_url: s.basis_url, confidence: s.confidence, notes: s.notes,
    };
  });

  const todo = buildTodo({ input, cash, relief_fund, auto, apply, insurance, heat_cold, deadlines, total_cash_krw, M });

  return {
    input,
    cash, relief_fund, auto, apply, info, insurance, heat_cold,
    matched_ids: matched.map((r) => r.id),
    total_cash_krw,
    total_cash_text: formatKRW(total_cash_krw) + (total_cash_has_unpriced ? M.unpriced : ''),
    total_cash_has_unpriced,
    deadlines,
    todo,
    timeline,
    disclaimer: M.disclaimer,
  };
}

/** 지금 할 일 3가지 — 상황별 우선순위. */
export function buildTodo({ input, cash, relief_fund, auto, apply, insurance, heat_cold, deadlines, total_cash_krw, M = MSG.ko }) {
  const items = [];
  const hasDamage = input.damage.length > 0 && !(input.damage.length === 1 && ['heat', 'cold'].includes(input.damage[0]));
  const report = deadlines.find((d) => d.label === M.report_deadline);

  if (hasDamage) {
    if (report) {
      const dl = report.days_left;
      const when = dl == null ? '' : dl < 0 ? M.t_when_over(-dl) : dl === 0 ? M.t_when_today : M.t_when_d(dl, report.due);
      items.push({ priority: 1, text: M.t_report(when), ref: 'proc.report' });
    } else {
      items.push({ priority: 1, text: M.t_report_noend, ref: 'proc.report' });
    }
    const cashLabels = [...cash, ...relief_fund].filter((r) => r.amount_krw != null).map((r) => `${r.label} ${r.amount_text}`);
    if (cashLabels.length) {
      items.push({ priority: 2, text: M.t_auto_pay(cashLabels.slice(0, 3).join(', '), formatKRW(total_cash_krw)), ref: 'proc.payment' });
    } else if (cash.length) {
      items.push({ priority: 2, text: M.t_survey(cash.map((r) => r.label).slice(0, 2).join(', ')), ref: 'proc.survey' });
    }
    const applyTop = apply.slice(0, 3).map((r) => r.label);
    if (applyTop.length) {
      items.push({ priority: 3, text: M.t_apply(applyTop.join(', '), apply.length > 3 ? apply.length - 3 : 0), ref: 'proc.certificate' });
    } else if (auto.length) {
      items.push({ priority: 3, text: M.t_auto(auto.slice(0, 3).map((r) => r.label).join(', ')), ref: 'proc.certificate' });
    }
  } else if (['heat', 'cold'].includes(input.hazard) || input.damage.some((d) => ['heat', 'cold'].includes(d))) {
    const shelter = heat_cold.find((r) => r.id.endsWith('_shelter'));
    if (shelter) items.push({ priority: 1, text: M.t_shelter(shelter.label.replace(M.shelter_strip, '')), ref: shelter.id });
    const benefit = [...apply].filter((r) => r.group === 'heat_cold' || r.id === 'indirect.emergency_welfare');
    if (benefit.length) items.push({ priority: 2, text: M.t_benefit(benefit.slice(0, 2).map((r) => r.label).join(', ')), ref: benefit[0].id });
    items.push({ priority: 3, text: M.t_illness, ref: 'heat_cold.heat_illness_care' });
  } else {
    items.push({ priority: 1, text: M.t_pick, ref: null });
  }

  if (items.length < 3 && insurance.length) {
    items.push({ priority: 3, text: M.t_ins(insurance[0].label, insurance[0].amount_text), ref: insurance[0].id });
  }
  const fillers = M.fillers;
  for (const f of fillers) if (items.length < 3) items.push({ priority: 3, text: f, ref: null });
  return items.slice(0, 3);
}

export default { loadRules, evaluate, matchRule, formatKRW, sumCash, addDays, diffDays, validateRules, LABELS };
