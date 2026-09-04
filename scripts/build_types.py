"""AidPage — 지자체 타입 시스템 v0 (docs/14 §2, docs/15 §2 규칙 기반).

산출:
  data/ref/sgg_types.json   시군구 255: 주 타입(위해)·부 타입(취약>구조)·굵기(노출)·경계·상위분류 + 규칙 메타
  data/ref/emd_types.json   행정동(격자 emd 속성): 같은 규칙, 읍면동 전국 사분위, 해안·행정유형은 시군구 상속
  data/ref/sido_types.json  시도: 인구 가중 타입 분포(단일 타입 없음)

규칙 v0-20260904 (docs/15 §2-2 기준 4·5·6·7):
  위해(주 타입) — 물: flood_r ≥ p75 또는 침수위험개선지구 밀도(/100km²) ≥ p75 / 산: ls_r ≥ p75 또는 slope ≥ p75 또는 기타 위험개선지구 밀도 ≥ p75 [붕괴 proxy]
              바다: coastal == 1 [부분 규칙 — 해안 접촉만] / 없으면 평온. 둘 이상 성립 → complex. (첫 실행의 절대 개수 규칙 ≥5·≥3은 면적 큰 군을 전부 '물'로 만들어 폐기)
  행정동 — 같은 규칙, 읍면동 전국 p75. 산사태 이력 p75가 0이라 ls_r 임계 하한 0.02. 위험개선지구는 시군구 자료라 행정동 판정 미사용.
  취약(부 타입) — 노년: e65 ≥ p75 그리고 ealone ≥ p75 / 홀로: single ≥ p75(노년 아님) / 없으면 구조 — 도심: dens ≥ p75 / 들: kind == '군' [proxy]
  굵기(노출) — dens ≥ p75 이면 bold. 경계 — 임계 ±5% 안이면 edge 표기. 상위분류 — 행정유형 × 해안/내륙.
사분위는 같은 단위 전국(시군구↔시군구, 행정동↔행정동). 순위 숫자 없음. 표준화 초과치로 주 타입 중 최강 선택.
"""
from __future__ import annotations

import csv
import datetime as _dt
import io
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731
VERSION = "v0-20260904"
EDGE = 0.05  # 임계 ±5%

rows = list(csv.DictReader(io.open(P("docs", "lib", "sgg_typology_explore_20260903.csv"), encoding="utf-8")))
rz = json.load(open(P("data", "ref", "riskzone_by_sgg.json"), encoding="utf-8"))["by_sgg"]
demo = json.load(open(P("data", "ref", "sgg_demo.json"), encoding="utf-8"))
idx = {s["code"]: s for s in json.load(open(P("data", "admin", "sgg_index.json"), encoding="utf-8"))}
labels = {r["code"]: r for r in csv.DictReader(io.open(P("docs", "lib", "sgg_typology_labels_20260904.csv"), encoding="utf-8"))}


def pct(vals, q=75):
    v = [float(x) for x in vals if x is not None]
    return float(np.percentile(v, q)) if v else float("nan")


def near(v, thr, rel=EDGE):
    return thr > 0 and abs(v - thr) <= rel * thr


def exceed(v, thr, sd):
    return (v - thr) / sd if sd > 0 else 0.0


def classify(m, th, sd, kind, coastal):
    """m: dict(flood_r, ls_r, slope, e65, ealone, single, dens, rzf, rzo). th: p75 thresholds. sd: std per metric.
    rzf/rzo = 침수위험개선지구·기타(붕괴 등) 지구 수 / 100km² (시군구만; 행정동은 0). 반환 dict(primary, secondary, complex, bold, edge, hazards, scores)"""
    haz = {}
    if m["flood_r"] >= th["flood_r"] or (th["rzf"] > 0 and m["rzf"] >= th["rzf"]):
        haz["물"] = max(exceed(m["flood_r"], th["flood_r"], sd["flood_r"]), exceed(m["rzf"], th["rzf"], sd["rzf"]) if th["rzf"] > 0 else -9)
    if m["ls_r"] >= th["ls_r"] or m["slope"] >= th["slope"] or (th["rzo"] > 0 and m["rzo"] >= th["rzo"]):
        haz["산"] = max(exceed(m["ls_r"], th["ls_r"], sd["ls_r"]), exceed(m["slope"], th["slope"], sd["slope"]), exceed(m["rzo"], th["rzo"], sd["rzo"]) if th["rzo"] > 0 else -9)
    if coastal == 1:
        haz["바다"] = 0.0  # 부분 규칙: 접촉 여부만이라 강도 없음 → 다른 위해와 동시 성립 시 그쪽이 주 타입
    primary = max(haz, key=haz.get) if haz else "평온"
    # 부 타입: 취약 → 구조
    if m["e65"] >= th["e65"] and m["ealone"] >= th["ealone"]:
        secondary = "노년"
    elif m["single"] >= th["single"]:
        secondary = "홀로"
    elif m["dens"] >= th["dens"]:
        secondary = "도심"
    elif kind == "군":
        secondary = "들"
    else:
        secondary = None
    edge = []
    if near(m["flood_r"], th["flood_r"]): edge.append("물")
    if near(m["ls_r"], th["ls_r"]) or near(m["slope"], th["slope"]) or (th["rzo"] > 0 and near(m["rzo"], th["rzo"])): edge.append("산")
    if th["rzf"] > 0 and near(m["rzf"], th["rzf"]): edge.append("물")
    if near(m["e65"], th["e65"]) or near(m["ealone"], th["ealone"]): edge.append("노년")
    if near(m["single"], th["single"]): edge.append("홀로")
    if near(m["dens"], th["dens"]): edge.append("도심")
    return dict(primary=primary, secondary=secondary, complex=len(haz) >= 2, bold=(primary != "평온" and m["dens"] >= th["dens"]),
                edge=sorted(set(edge)), hazards=sorted(haz, key=haz.get, reverse=True), scores={k: round(v, 2) for k, v in haz.items()})


def label(t):
    s = t["primary"] + "·" + (t["secondary"] or "—")
    if t["bold"]: s += "(굵게)"
    if t["complex"]: s += "[복합]"
    return s


# ───────── 시군구 ─────────
METRICS = ["flood_r", "ls_r", "slope", "e65", "ealone", "single", "dens", "rzf", "rzo"]
for r in rows:  # 위험개선지구 밀도(/100km²) — 절대 개수는 면적 큰 군에 몰려 '물'을 과대 판정했다(v0 첫 실행 교훈)
    z = rz.get(r["code"], {}); fl = int(z.get("flood", 0)); area = max(float(r["area"]), 1.0)
    r["rzf"] = fl / area * 100; r["rzo"] = (int(z.get("n", 0)) - fl) / area * 100
M = {v: [float(r[v]) for r in rows] for v in METRICS}
TH = {v: pct(M[v]) for v in METRICS}
SD = {v: float(np.std(M[v])) for v in METRICS}
sgg_out, pair, prim_cnt, cross = {}, Counter(), Counter(), defaultdict(Counter)
for r in rows:
    code = r["code"]; m = {v: float(r[v]) for v in METRICS}
    z = rz.get(code, {}); fl = int(z.get("flood", 0)); other = int(z.get("n", 0)) - fl
    t = classify(m, TH, SD, r["kind"], int(r["coastal"]))
    upper = f"{r['kind']}·{'해안' if int(r['coastal']) else '내륙'}"
    sgg_out[code] = dict(name=r["name"], sido=idx.get(code, {}).get("sido", r["sido"][:2] if r["sido"] else ""), kind=r["kind"], upper=upper, **t, label=label(t),
                         metrics=dict(flood_r=m["flood_r"], ls_r=m["ls_r"], slope=round(m["slope"], 2), e65=m["e65"], ealone=m["ealone"], single=m["single"], dens=m["dens"], rz_flood=fl, rz_other=other, rzf=round(m["rzf"], 2), rzo=round(m["rzo"], 2), pop=int(float(r["pop"]))))
    pair[(t["primary"], t["secondary"] or "—")] += 1; prim_cnt[t["primary"]] += 1
    cross[t["primary"]][labels.get(code, {}).get("cluster_tag", "?")] += 1

meta = dict(version=VERSION, built=_dt.date.today().isoformat(), unit="sgg", n=len(sgg_out),
            thresholds={k: round(v, 4) for k, v in TH.items()}, fixed_thresholds={"edge_rel": EDGE, "emd_ls_r_floor": 0.02},
            rules={"primary": "물: flood_r≥p75 or 침수위험개선지구밀도(rzf,/100km²)≥p75 / 산: ls_r≥p75 or slope≥p75 or 기타위험개선지구밀도(rzo)≥p75[붕괴 proxy] / 바다: coastal==1[부분 규칙] / 없음→평온; 둘 이상→complex; 표준화 초과치 최강이 주 타입",
                   "secondary": "노년: e65≥p75 & ealone≥p75 / 홀로: single≥p75 / 도심: dens≥p75 / 들: kind=='군'[proxy] / 없음→null",
                   "bold": "dens≥p75 (노출 대리) — 주 타입이 평온이면 미적용", "edge": "임계 ±5% 이내 타입", "upper": "행정유형(구/시/군) × 해안/내륙"},
            sources={"flood_r,ls_r,slope,dens,coastal": "data/grid(행안부 침수흔적도·산사태 발생이력, Copernicus GLO-30), kr_sgg 경계 접촉 판정 (docs/lib/sgg_typology_explore_20260903.csv)",
                     "e65,ealone,single,pop": "행안부 주민등록 2026-07 (sgg_demo.json)", "rz_flood,rz_other": "행안부 자연재해위험개선지구 (riskzone_by_sgg.json, asof 2026-08-27)"},
            caveats=["기록 없음 ≠ 안전: 침수·산사태 이력은 신고·기록된 것만 담는다", "'들' 타입은 행정구역 이름(군)으로 판단한 농어촌 근사치", "'바다' 타입은 해안 접촉 여부만 본 부분 규칙(해일·태풍 강도 미반영)",
                     "서울은 침수흔적도가 촘촘해 '물' 타입이 과대 대표될 수 있음", "'산'의 붕괴 proxy = 위험개선지구 중 침수 이외 유형 수(붕괴·유실·고립·해일·가뭄 혼합)", "전국 시군구 사분위 기준 상대 판정 — 순위 아님"])
json.dump({"meta": meta, "sgg": sgg_out}, open(P("data", "ref", "sgg_types.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# ───────── 행정동 ─────────
emd = {}
GRID = P("data", "grid")
for fn in sorted(os.listdir(GRID)):
    if not fn.endswith(".geojson"): continue
    sgg = fn[:-8]
    if sgg not in sgg_out: continue
    fc = json.load(open(os.path.join(GRID, fn), encoding="utf-8"))
    by = defaultdict(list)
    for f in fc["features"]:
        p = f["properties"]
        if p.get("emd_code") and p.get("pop") is not None: by[p["emd_code"]].append(p)
    for ec, cells in by.items():
        n = len(cells); c0 = cells[0]
        area = sum(float(c.get("area_km2") or 0) for c in cells) or n * 0.105
        emd[ec] = dict(sgg=sgg, name=c0.get("emd_name", ""), pop=int(c0["pop"]),
                       flood_r=sum(1 for c in cells if (c.get("flood_hist_n") or 0) > 0) / n, ls_r=sum(1 for c in cells if (c.get("landslide_hist_n") or 0) > 0) / n,
                       slope=float(np.mean([c.get("slope_mean") or 0 for c in cells])), e65=float(c0.get("elderly65_r") or 0), ealone=float(c0.get("elderly_alone_r") or 0),
                       single=float(c0.get("single_hh_r") or 0), dens=int(c0["pop"]) / max(area, 0.05))
for e in emd.values(): e["rzf"] = 0.0; e["rzo"] = 0.0  # 위험개선지구는 시군구 단위 자료 — 행정동 판정에 미사용
ME = {v: [e[v] for e in emd.values()] for v in METRICS}
TH_E = {v: pct(ME[v]) for v in METRICS}; SD_E = {v: float(np.std(ME[v])) for v in METRICS}
TH_E["ls_r"] = max(TH_E["ls_r"], 0.02)  # 행정동 산사태 이력 p75가 0이라 '셀 하나만 있어도 산'이 되는 것을 막는다(v0 첫 실행 교훈)
TH_E["rzf"] = TH_E["rzo"] = 0.0
COLS = ["code", "sgg", "name", "pop", "primary", "secondary", "bold", "complex", "edge", "label"]
emd_rows, emd_prim = [], Counter()
for ec, e in emd.items():
    s = sgg_out[e["sgg"]]
    t = classify({v: e[v] for v in METRICS}, TH_E, SD_E, s["kind"], 1 if s["upper"].endswith("해안") else 0)
    emd_rows.append([ec, e["sgg"], e["name"], e["pop"], t["primary"], t["secondary"], int(t["bold"]), int(t["complex"]), "|".join(t["edge"]), label(t)])
    emd_prim[t["primary"]] += 1
emd_meta = dict(version=VERSION, built=meta["built"], unit="emd", n=len(emd_rows), thresholds={k: round(v, 4) for k, v in TH_E.items()},
                note="행정동 위해 = 해당 행정동 격자 셀 중 이력>0 셀 비율·평균 경사(격자 있는 시군구만). 위험개선지구·굵기 분모는 시군구 상속 없음(dens는 행정동 인구/격자 면적). 해안·행정유형은 시군구 상속.",
                caveats=meta["caveats"])
json.dump({"meta": emd_meta, "cols": COLS, "rows": emd_rows}, open(P("data", "ref", "emd_types.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# ───────── 시도 분포 ─────────
sido = defaultdict(lambda: {"pop": 0, "primary": Counter(), "secondary": Counter(), "n": 0, "names": set()})
for code, s in sgg_out.items():
    sd = str(s["sido"]); pop = s["metrics"]["pop"]
    d = sido[sd]; d["pop"] += pop; d["n"] += 1; d["primary"][s["primary"]] += pop; d["secondary"][s["secondary"] or "—"] += pop
    d["names"].add(idx.get(code, {}).get("sido_name", ""))
sido_out = {k: dict(name=sorted(x for x in v["names"] if x), n_sgg=v["n"], pop=v["pop"],
                    primary_pct={t: round(c / v["pop"] * 100, 1) for t, c in v["primary"].most_common()},
                    secondary_pct={t: round(c / v["pop"] * 100, 1) for t, c in v["secondary"].most_common()}) for k, v in sido.items()}
json.dump({"meta": dict(version=VERSION, built=meta["built"], unit="sido", note="시군구 타입의 인구 가중 분포(%). 시도에 단일 타입을 붙이지 않는다.", caveats=meta["caveats"]), "sido": sido_out},
          open(P("data", "ref", "sido_types.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# ───────── 리포트 ─────────
print(f"[types] {VERSION} sgg={len(sgg_out)} emd={len(emd_rows)} sido={len(sido_out)}")
print("thresholds(p75 sgg):", {k: round(v, 3) for k, v in TH.items()})
print("\n(a) 주×부 타입 쌍 빈도 (시군구)")
for (p, s), c in pair.most_common(): print(f"  {p}·{s:<3s} {c:4d}")
print("\n(b) 주 타입 개수:", dict(prim_cnt), "| 복합:", sum(1 for s in sgg_out.values() if s["complex"]), "| 굵게:", sum(1 for s in sgg_out.values() if s["bold"]), "| 경계 있음:", sum(1 for s in sgg_out.values() if s["edge"]))
print("\n(c) 주 타입 × k-means 군집(09-03)")
tags = sorted({t for c in cross.values() for t in c})
print("  " + " | ".join(f"{t[:14]:>14s}" for t in tags))
for p in ["물", "산", "바다", "평온"]:
    print(f"  {p:<4s}" + " | ".join(f"{cross[p].get(t, 0):14d}" for t in tags))
print("\n(d) 예시")
ex = ["52720", "11500", "11620", "41115", "48860", "12850", "51820", "26350", "47130", "36110", "11680", "41111"]
for c in ex:
    if c in sgg_out: s = sgg_out[c]; print(f"  {s['name']:<10s} {s['label']:<16s} upper={s['upper']} edge={s['edge']} hz={s['scores']}")
print("\n행정동 주 타입 개수:", dict(emd_prim), "| 읍면동 p75:", {k: round(v, 3) for k, v in TH_E.items()})
for f in ("sgg_types.json", "emd_types.json", "sido_types.json"): print(f"  {f}: {os.path.getsize(P('data', 'ref', f)) // 1024} KB")
