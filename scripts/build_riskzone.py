# -*- coding: utf-8 -*-
"""자연재해위험개선지구 → 시군구별 7유형 집계 (docs/17 §0 ①)
입력: data/ref/sd/riskzone.jsonl + riskzone2.jsonl (재난안전데이터공유플랫폼 DSSP-IF-00052·00775, 로컬 배치, gitignore)
출력: data/ref/riskzone_by_sgg.json — {asof, src, types, by_sgg:{code:{n, flood, grade1, t:{"001":n,...}}}}
유형 코드(DST_RSK_DSTRCT_TYPE_CD, 세부유형 문자열 교차표로 확인 2026-09-05):
  001 침수위험 · 002 붕괴위험(산사태·급경사·절개지) · 003 취약방재시설(저수지·제방) · 004 고립위험 · 005 유실위험(하천) · 006 해일위험 · 007 상습가뭄재해
집계 단위 = STDG_CD 앞 5자리(법정동 코드 → 시군구). 두 파일은 관리번호 기준 중복 제거(합집합).
기존 키 n·flood는 재계산, grade1은 원자료에 등급 필드가 없어 이전 파일 값을 이월한다(앱 미사용)."""
import json, os, collections, io
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
TYPES = {"001": "침수위험", "002": "붕괴위험", "003": "취약방재시설", "004": "고립위험", "005": "유실위험", "006": "해일위험", "007": "상습가뭄재해"}
rows = {}
for fn in ("riskzone.jsonl", "riskzone2.jsonl"):
    p = P("data", "ref", "sd", fn)
    if not os.path.exists(p): continue
    for l in io.open(p, encoding="utf-8"):
        if not l.strip(): continue
        r = json.loads(l); k = r.get("DST_RSK_DSTRCT_MNG_NO") or (r.get("STDG_CD"), r.get("DST_RSK_DSTRCT_NM"), r.get("DSGN_YMD"))
        if k not in rows: rows[k] = r
        else:  # 세부유형 문자열은 riskzone2에만 있으므로 보강
            for f in ("DST_RSK_DSTRCT_DTL_TYPE_CD", "DST_RSK_DSTRCT_TYPE_CD"):
                if not rows[k].get(f) and r.get(f): rows[k][f] = r[f]
idx = {s["code"] for s in json.load(open(P("data", "admin", "sgg_index.json"), encoding="utf-8"))}
old = {}
try: old = json.load(open(P("data", "ref", "riskzone_by_sgg.json"), encoding="utf-8")).get("by_sgg", {})
except Exception: pass
by = {}; miss = collections.Counter()
for r in rows.values():
    # 시군구 코드: 플랫폼의 지역코드(DST_RSK_DSTRCT_RGN_CD, 앱과 같은 체계 — 전남·광주 통합 12xxx) 우선, 없으면 법정동 코드 앞 5자리
    cands = [str(r.get("DST_RSK_DSTRCT_RGN_CD") or "")[:5], str(r.get("STDG_CD") or "")[:5]]
    code = next((c for c in cands if c in idx), None)
    if not code:
        miss[cands[0] or cands[1]] += 1; continue
    t = str(r.get("DST_RSK_DSTRCT_TYPE_CD") or "").zfill(3)
    d = by.setdefault(code, {"n": 0, "flood": 0, "grade1": 0, "t": collections.Counter()})
    d["n"] += 1; d["t"][t] += 1
    if t == "001": d["flood"] += 1
    pass
out = {"asof": "2026-08-27", "src": "행정안전부 자연재해위험개선지구(재난안전데이터공유플랫폼 DSSP-IF-00052·00775, 관리번호 기준 중복 제거)",
       "types": TYPES, "n_total": sum(d["n"] for d in by.values()),
       "by_sgg": {c: {"n": d["n"], "flood": d["flood"], "grade1": int(old.get(c, {}).get("grade1", 0)), "t": dict(sorted(d["t"].items()))} for c, d in sorted(by.items())}}
json.dump(out, open(P("data", "ref", "riskzone_by_sgg.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
tot = collections.Counter()
for d in by.values(): tot.update(d["t"])
print("rows", len(rows), "sgg", len(by), "total", out["n_total"], "| by type", {TYPES.get(k, k): v for k, v in sorted(tot.items())})
print("unmatched codes", miss.most_common(8))
print("sample", list(out["by_sgg"].items())[:2])
