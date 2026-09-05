# -*- coding: utf-8 -*-
"""사회 위해(교통·화재) 시군구 원천 → data/ref/sgg_social.json  (타입 시스템 v1.3 '두 번째 위해 슬롯' 재료)
원천(data/src/social/, 연 1회 수동 갱신):
  - 한국도로교통공단 「시도 시군구별 교통사고 통계」 csv(cp949; 시도·시군구·사고건수·사망자수·중상자수·경상자수·부상신고자수) — 경찰 접수 인적피해 사고만
  - (화재) 소방청 화재 통계 — 시군구 파일 확보 시 fire 필드 채움
표준화: 인구 10만 명당(분모 = 주민등록 2026-07, sgg_demo.json pop). 통합시(수원시 등)는 시 단위 값이라 소속 구 전부에 같은 값을 준다(메타에 명시)."""
import json, os, io, re, csv, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
V = P("data", "src", "social")
idx = json.load(open(P("data", "admin", "sgg_index.json"), encoding="utf-8"))
demo = json.load(open(P("data", "ref", "sgg_demo.json"), encoding="utf-8"))
def pop_of(code):
    d = demo.get("sgg", demo) if isinstance(demo, dict) else {}
    return (d.get(code) or {}).get("pop")
SHORT = {"서울": "11", "부산": "26", "대구": "27", "인천": "28", "광주": "12", "대전": "30", "울산": "31", "세종": "36", "경기": "41", "강원": "51", "충북": "43", "충남": "44", "전북": "52", "전남": "12", "경북": "47", "경남": "48", "제주": "50"}
sido_codes = {s["sido"] for s in idx}
by_sido = collections.defaultdict(list)
for s in idx: by_sido[s["sido"]].append(s)
def targets(sido, name):
    """이름으로 시군구 코드 목록: 정확 일치 → 통합시('수원시')면 '수원시'로 시작하는 구 전부 → 세종"""
    name = re.sub(r"\s+", "", name)
    ex = [s["code"] for s in by_sido.get(sido, []) if s["name"] == name]
    if ex: return ex
    pre = [s["code"] for s in by_sido.get(sido, []) if s["name"].startswith(name) and s["name"] != name]
    if pre: return pre
    if sido == "36": return [s["code"] for s in by_sido["36"]]
    return []
out = {}; unmatched = []
# ── 교통 ──
fx = sorted(f for f in os.listdir(V) if "교통사고" in f and f.endswith(".csv"))
if fx:
    raw = open(os.path.join(V, fx[-1]), "rb").read()
    txt = None
    for enc in ("utf-8-sig", "cp949"):
        try: txt = raw.decode(enc); break
        except Exception: pass
    year = re.search(r"\((\d{4})\)", fx[-1]); year = year.group(1) if year else "?"
    n = 0
    for r in csv.DictReader(io.StringIO(txt)):
        sido = SHORT.get((r.get("시도") or "").strip())
        if not sido and (r.get("시도") or "").strip() in sido_codes: sido = r["시도"].strip()
        if not sido: unmatched.append(f"{r.get('시도')} {r.get('시군구')}"); continue
        codes = targets(sido, r.get("시군구") or "")
        if not codes: unmatched.append(f"{r.get('시군구')}({sido})"); continue
        acc, dead, sev = int(r["사고건수"]), int(r["사망자수"]), int(r["중상자수"])
        for c in codes:
            d = out.setdefault(c, {}); d.update(traffic_acc=acc, traffic_dead=dead, traffic_severe=sev, traffic_shared=len(codes) > 1); n += 1
    print("traffic rows→codes", n, "year", year, "unmatched", len(unmatched), unmatched[:10])
    traffic_asof = year
else: traffic_asof = None
# ── 화재(확보 시) ──
fire_asof = None
# ── 비율 ──
for code, d in out.items():
    pop = pop_of(code); d["pop_base"] = pop
    if pop:
        # 통합시 공유값은 시 전체 인구로 나눠야 한다 → 같은 시 소속 구 인구 합
        if d.get("traffic_shared"):
            city = idx_name = next(s["name"] for s in idx if s["code"] == code); city = re.match(r"^(.+?시)", city).group(1)
            pop_city = sum(pop_of(s["code"]) or 0 for s in idx if s["name"].startswith(city))
            pop = pop_city or pop
        d["traffic_r"] = round((d["traffic_dead"] + d["traffic_severe"]) / pop * 1e5, 2)   # 사망+중상 / 10만 명
        d["traffic_acc_r"] = round(d["traffic_acc"] / pop * 1e5, 1)
def pct(vals, q):
    v = sorted(x for x in vals if x is not None); return v[min(len(v) - 1, int(round(q / 100 * (len(v) - 1))))] if v else None
keys = ["traffic_r", "traffic_acc_r", "fire_r"]
th = {k: {"p75": pct([d.get(k) for d in out.values()], 75), "p80": pct([d.get(k) for d in out.values()], 80), "median": pct([d.get(k) for d in out.values()], 50)} for k in keys}
meta = {"built": "2026-09-05", "unit": "sgg", "n": len(out), "asof": {"traffic": f"{traffic_asof} (한국도로교통공단 시도 시군구별 교통사고 통계, 경찰 접수 인적피해 사고)", "fire": fire_asof},
        "definitions": {"traffic_r": "(사망자+중상자)/주민등록 인구(2026-07)×10만 — 통합시는 시 단위 값을 소속 구에 공유, 분모도 시 전체 인구", "traffic_acc_r": "사고건수/인구×10만", "fire_r": "미확보"},
        "thresholds": th, "unmatched": unmatched[:40]}
json.dump({"meta": meta, "sgg": out}, open(P("data", "ref", "sgg_social.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("thresholds", json.dumps(th, ensure_ascii=False)); print("n", len(out))
top = sorted(((d["traffic_r"], c) for c, d in out.items() if d.get("traffic_r")), reverse=True)[:12]
nm = {s["code"]: s["sido_name"][:2] + " " + s["name"] for s in idx}
print("traffic_r top:", [(nm[c], v) for v, c in top])
