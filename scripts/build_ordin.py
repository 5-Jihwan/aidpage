# -*- coding: utf-8 -*-
"""제도 렌즈 ①: 시군구별 재난·안전 자치법규(조례·규칙) 집계 → data/ref/sgg_ordin.json
국가법령정보 OPEN API(자치법규 검색, target=ordin, 키=.keys.env.parsed LAW_OC). 키워드별로 전수 페이징(display=100) → 자치법규ID로 중복 제거 →
지자체기관명("경기도 가평군")을 sgg_index에 매핑(통합시는 시 조례를 소속 구가 공유, 시·도 조례는 제외).
출력: {code: {n: 재난·안전 자치법규 수, ord: {relief, insurance, heat, cold, landslide, fire, traffic, safety_basic}: 최근 시행일 or null}}
제도 변수는 '타입'이 아니라 '특징'에 붙는다(순위 금지). 원문 링크는 자치법규일련번호(MST)로 재현 가능."""
import json, os, io, re, time, urllib.request, urllib.parse, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
kv = {}
for l in io.open(P(".keys.env.parsed"), encoding="utf-8", errors="ignore"):
    if "=" in l and not l.startswith("#"): k, v = l.strip().split("=", 1); kv[k.strip()] = v.strip().strip('"')
OC = kv.get("LAW_OC"); assert OC, "LAW_OC 없음"
idx = json.load(open(P("data", "admin", "sgg_index.json"), encoding="utf-8"))
SIDO_ALT = {"전라남도": "12", "광주광역시": "12", "전라북도": "52", "강원도": "51", "제주도": "50"}
sido_by_name = {s["sido_name"]: s["sido"] for s in idx}; sido_by_name.update({k: v for k, v in SIDO_ALT.items()})
by_sido = collections.defaultdict(list)
for s in idx: by_sido[s["sido"]].append(s)
def targets(org):
    """'경기도 가평군' / '서울특별시 종로구' / '세종특별자치시' / '전북특별자치도 전주시' → 코드 목록"""
    parts = org.split()
    if not parts: return []
    sido = sido_by_name.get(parts[0])
    if not sido: return []
    if len(parts) == 1: return [s["code"] for s in by_sido[sido]] if sido == "36" else []   # 시·도 조례는 제외, 세종만 시군구 겸함
    name = "".join(parts[1:])
    ex = [s["code"] for s in by_sido[sido] if s["name"] == name]
    if ex: return ex
    return [s["code"] for s in by_sido[sido] if s["name"].startswith(name)]  # 통합시 → 소속 구 공유
# 키워드 → 표식(조례명에 포함되면 해당 표식). 재난 안전 전반 = n 집계용
KW = ["재난", "재해", "방재", "안전관리", "풍수해", "산사태", "폭염", "한파", "화재", "교통안전", "긴급구호", "이재민"]
FLAGS = {"relief": ["구호", "복구", "이재민", "의연금", "지원금"], "insurance": ["풍수해보험", "재난보험", "보험료 지원", "시민안전보험"], "heat": ["폭염", "온열"], "cold": ["한파"],
         "landslide": ["산사태", "급경사"], "fire": ["화재", "소방"], "traffic": ["교통안전", "보행", "교통사고"], "safety_basic": ["안전관리 기본", "재난 및 안전관리", "재난및안전관리"]}
def fetch(q, page):
    u = f"http://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=ordin&type=JSON&query={urllib.parse.quote(q)}&display=100&page={page}"
    for i in range(3):
        try:
            t = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 AidPage"}), timeout=40).read().decode("utf-8", "ignore")
            j = json.loads(t); top = j.get("OrdinSearch") or j
            return int(top.get("totalCnt") or 0), top.get("law") or []
        except Exception as e:
            time.sleep(1.5 * (i + 1))
    return 0, []
seen = {}; nreq = 0
for q in KW:
    total, items = fetch(q, 1); nreq += 1
    pages = (total + 99) // 100
    for pg in range(1, pages + 1):
        if pg > 1: total, items = fetch(q, pg); nreq += 1
        for it in items:
            if not isinstance(it, dict): continue
            if it.get("자치법규종류") not in ("조례", "규칙"): continue
            seen[it.get("자치법규ID")] = it
        time.sleep(0.2)
    print(f"{q}: {total}건 ({pages}p) 누적 고유 {len(seen)}")
out = {}; unmatched = collections.Counter()
for it in seen.values():
    org = (it.get("지자체기관명") or "").strip(); codes = targets(org)
    if not codes: unmatched[org] += 1; continue
    nm = it.get("자치법규명") or ""; eff = it.get("시행일자")
    for c in codes:
        d = out.setdefault(c, {"n": 0, "n_ordin": 0, "ord": {k: None for k in FLAGS}, "shared": len(codes) > 1})
        d["n"] += 1
        if it.get("자치법규종류") == "조례": d["n_ordin"] += 1
        for k, kws in FLAGS.items():
            if any(w in nm for w in kws) and (d["ord"][k] is None or (eff and eff > d["ord"][k])): d["ord"][k] = eff
def pct(vals, q):
    v = sorted(vals); return v[min(len(v) - 1, int(round(q / 100 * (len(v) - 1))))] if v else None
ns = [d["n"] for d in out.values()]
meta = {"built": time.strftime("%Y-%m-%d"), "src": "국가법령정보센터 자치법규 검색 API(target=ordin)", "keywords": KW, "flags": FLAGS, "n_sgg": len(out), "requests": nreq,
        "thresholds": {"n": {"p25": pct(ns, 25), "median": pct(ns, 50), "p75": pct(ns, 75)}}, "flag_coverage": {k: sum(1 for d in out.values() if d["ord"][k]) for k in FLAGS},
        "note": "시·도 조례 제외(세종 예외). 통합시 조례는 소속 구 공유. 조례명 키워드 기반이라 내용상 유사 조례를 놓칠 수 있음. 건수는 순위가 아니라 특징 표기용.",
        "unmatched": unmatched.most_common(20)}
json.dump({"meta": meta, "sgg": out}, open(P("data", "ref", "sgg_ordin.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("sgg", len(out), "requests", nreq, "thresholds", meta["thresholds"], "coverage", meta["flag_coverage"]); print("unmatched", unmatched.most_common(12))
