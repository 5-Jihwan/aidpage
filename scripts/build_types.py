"""AidPage — 지자체 타입 시스템 v0 (docs/14 §2, docs/15 §2 규칙 기반).

산출:
  data/ref/sgg_types.json   시군구 255: 주 타입(위해)·부 타입(취약>구조)·굵기(노출)·경계·상위분류 + 규칙 메타
  data/ref/emd_types.json   행정동(격자 emd 속성): 같은 규칙, 읍면동 전국 사분위, 해안·행정유형은 시군구 상속
  data/ref/sido_types.json  시도: 인구 가중 타입 분포(단일 타입 없음)

규칙 v1.1-20260904 (docs/15 §2-2 기준 4·5·6·7):
  위해(주 타입) — 물: flood_r ≥ p75 또는 침수위험개선지구 밀도(/100km²) ≥ p75 / 산: ls_r ≥ p75 또는 slope ≥ p75 또는 기타 위험개선지구 밀도 ≥ p75 [붕괴 proxy]
              바다: coastal == 1 [부분 규칙 — 해안 접촉만] / 없으면 평온. 둘 이상 성립 → complex. (첫 실행의 절대 개수 규칙 ≥5·≥3은 면적 큰 군을 전부 '물'로 만들어 폐기)
  행정동 — 같은 규칙, 읍면동 전국 p75. 산사태 이력 p75가 0이라 ls_r 임계 하한 0.02. 위험개선지구는 시군구 자료라 행정동 판정 미사용.
  취약(부 타입) — 노년: e65 ≥ p75 그리고 ealone ≥ p75 / 홀로: single ≥ p75(노년 아님) / 없으면 구조 — 도심: dens ≥ p75 / 들: kind == '군' [proxy]
  굵기(노출) — dens ≥ p75 이면 bold. 경계 — 임계 ±5% 안이면 edge 표기. 상위분류 — 행정유형 × 해안/내륙.
사분위는 같은 단위 전국(시군구↔시군구, 행정동↔행정동). 순위 숫자 없음. 표준화 초과치로 주 타입 중 최강 선택.

근거 문헌 (docs/16 §1·§3, 2026-09-04 — 규칙별 인용, 논리 변경 없음):
  위해·취약 분리(주=위해, 부=취약>구조)   Tocchi·Pittore·Polese 2025 NHESS(위해 제외한 취약 원형); Hincks·Carter·Connelly 2023 GEC(ECRT, 위해·노출·취약 3영역 분리)
  물(침수 이력·침수위험지구 밀도)        ECRT V12·V14(하천홍수·노출 인구); Klein 외 2024 ESPON-TITAN(100년 침수면적 %); 지방정부간 재난관리 차이 2016(재해위험지구 수=발생가능성); 구주영 2026(위험개선지구↑→피해↑ = 노출 대리)
  산(산사태 이력·경사·기타 지구)         ECRT V13·V22, class 7(산지=산사태); 장경은 외 2023 KIEAE(홍수 민감도에 경사)
  바다(해안 접촉, 부분 규칙)             ECRT V9·V18; Chang 외 2018 Applied Geography(해안 거주 %·해안 지형) — 해일·태풍 강도 자료 대기
  노년(65+ & 65+ 1인세대)               김강민·황철수 2024(독거노인·65세 이상); KIPA 2017 메타평가(지역안전지수 취약지표 '재난약자수·고령인구'); Lee 2019 LGS(65+ %)
  홀로(1인세대)                          박현수·권설아 2024(1인가구 비율 B=1.18, 계층 최강 설명변수)
  도심(인구밀도) · 굵기(노출=밀도)       Tocchi 2025 1단 범주(도시화·인구 규모); ECRT 노출 축(위해 구역 안 인구·인프라); Lee 2019(빈도×규모 노출 유형)
  들('군' 근사)                          Tocchi 2025 농촌 원형; Chang 2018 1차산업 고용 — 농가·어가 비율로 교체 예정
  전국 p75 상대 임계 · 경계 ±5%          장경은 외 2023(등분위 5등급); KIPA 2017(동일유형 내 상대등급); Tate 2012(임계·변환 민감도 → 경계 표기)
  복합(위해 2개 이상)                    ESPON 위해 상호작용; ECRT class 1·3(다중 위해)
  가중합 지수·순위 금지                  Spielman 외 2020; Greco 외 2019; Cutter 외 2003 원저자 결론(프로파일 해석)
  '기록 없음 ≠ 안전'                     침수흔적도 성격; ECRT class 8("위해 온화"도 클래스로 명명)
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
RZ_MODE = os.environ.get("RZ_MODE", "pos")  # all | pos | tag (docs/14 §7)
VERSION = "v1.2-20260905-" + RZ_MODE
EDGE = 0.05  # 임계 ±5%

rows = list(csv.DictReader(io.open(P("docs", "lib", "sgg_typology_explore_20260903.csv"), encoding="utf-8")))
rz = json.load(open(P("data", "ref", "riskzone_by_sgg.json"), encoding="utf-8"))["by_sgg"]
demo = json.load(open(P("data", "ref", "sgg_demo.json"), encoding="utf-8"))
# v1.2: 취약 3종(외국인주민·등록장애인·기초수급, scripts/build_vuln.py) — 없는 시군구(2026 개편 인천·화성 등)는 None → 해당 부 타입 판정 생략
vuln = json.load(open(P("data", "ref", "sgg_vuln.json"), encoding="utf-8")).get("sgg", {})
# v1.3 초안: 사회 위해(교통·화재, scripts/build_social.py) — 두 번째 위해 슬롯 재료. 없으면 빈 dict
try: social = json.load(open(P("data", "ref", "sgg_social.json"), encoding="utf-8")).get("sgg", {})
except Exception: social = {}
SOCIAL = [("traffic_r", "교통"), ("fire_r", "화재")]
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
    haz = {}; basis = None
    # v1.1(09-04 스크리닝): 물은 '이력' 성립인지 '지정(위험개선지구 밀도)' 성립인지 basis로 구분 — 이력 0인 물 타입이 절반(40/74)이었다
    if m["flood_r"] >= th["flood_r"] or (th["rzf"] > 0 and m["rzf"] >= th["rzf"]):
        haz["물"] = max(exceed(m["flood_r"], th["flood_r"], sd["flood_r"]), exceed(m["rzf"], th["rzf"], sd["rzf"]) if th["rzf"] > 0 else -9)
        basis = "history" if m["flood_r"] >= th["flood_r"] else "zone"
    # v1.1: 잔여 위험지구 밀도(rzo, 6유형 혼합)는 '산' 판정에서 제외(39곳이 이것 하나로 성립) — 유형 코드 분리 후 붕괴지구만 복귀.
    #       경사 단독은 p80(강한 경사)만. 산사태 이력 p75는 유지.
    # v1.2: 위험개선지구 7유형 분리(build_riskzone.py) → 붕괴위험지구 밀도(rzc)만 '산'에 복귀(v1.1에서 뺐던 6유형 혼합 rzo 대체)
    s_basis = None
    # 지정 지구(붕괴·해일·가뭄) 기여 — RZ_MODE: all(전국 p75, z/SD) / pos(보유지 p75 초과분만) / tag(주 타입 미반영)
    def zone_strength(key):
        v = m.get(key) or 0.0
        if RZ_MODE == "tag" or v <= 0: return None
        if RZ_MODE == "pos":
            q, sdp = th.get(key + "_pos", 0), sd.get(key + "_pos", 0)
            return (v - q) / sdp if (q > 0 and sdp > 0 and v >= q) else None
        return (v / sd[key]) if sd.get(key, 0) > 0 else None
    zc = zone_strength("rzc")
    if m["ls_r"] >= th["ls_r"] or m["slope"] >= th["slope80"] or zc is not None:
        cand = [exceed(m["ls_r"], th["ls_r"], sd["ls_r"]), exceed(m["slope"], th["slope80"], sd["slope"])]
        if zc is not None: cand.append(zc)
        haz["산"] = max(cand)
        s_basis = "history" if (m["ls_r"] >= th["ls_r"] or m["slope"] >= th["slope80"]) else "zone"
    if coastal == 1:
        zs = zone_strength("rzs")
        haz["바다"] = zs if zs is not None else 0.0  # 지구 없음/미달 = 접촉만(강도 0)
    zd = zone_strength("rzd")
    if zd is not None: haz["마름"] = zd
    primary = max(haz, key=haz.get) if haz else "평온"
    # 부 타입: 취약 → 구조
    # v1.2: 이방(외국인주민 비율)·돌봄(등록장애인 비율)·살림(기초생활보장 수급권자 비율) 추가 — 국내 재난약자 표준 3종(docs/16). 우선순위는 고정(취약 → 구조)
    vq = lambda k: m.get(k) is not None and th.get(k) is not None and m[k] >= th[k]
    if m["e65"] >= th["e65"] and m["ealone"] >= th["ealone"]:
        secondary = "노년"
    elif m["single"] >= th["single80"]:  # v1.1: p75(.510) ±5% 안에 57곳이 몰려 경계 표시가 무뎌짐 → p80
        secondary = "홀로"
    elif vq("foreign_r"):
        secondary = "이방"
    elif vq("disabled_r"):
        secondary = "돌봄"
    elif vq("basic_r"):
        secondary = "살림"
    elif m["dens"] >= th["dens"]:
        secondary = "도심"
    elif kind == "군":
        secondary = "들"
    else:
        secondary = None
    edge = []
    if near(m["flood_r"], th["flood_r"]): edge.append("물")
    if near(m["ls_r"], th["ls_r"]) or near(m["slope"], th["slope80"]): edge.append("산")
    if th["rzf"] > 0 and near(m["rzf"], th["rzf"]): edge.append("물")
    if near(m["e65"], th["e65"]) or near(m["ealone"], th["ealone"]): edge.append("노년")
    if near(m["single"], th["single80"]): edge.append("홀로")
    for k, nm in (("foreign_r", "이방"), ("disabled_r", "돌봄"), ("basic_r", "살림")):
        if m.get(k) is not None and th.get(k) and near(m[k], th[k]): edge.append(nm)
    if near(m["dens"], th["dens"]): edge.append("도심")
    if th.get("rzc", 0) > 0 and near(m.get("rzc") or 0, th["rzc"]): edge.append("산")
    # v1.1: 결과를 바꿀 수 없는 경계는 표시하지 않는다 — 부 타입 우선순위에서 이미 정해진 것보다 뒤에 오는 경계는 무의미
    ORDER = ["노년", "홀로", "이방", "돌봄", "살림", "도심", "들"]
    if secondary in ORDER: edge = [e for e in edge if e not in ORDER[ORDER.index(secondary) + 1:]]
    # v1.3 초안: 사회 위해 슬롯 — 같은 규칙(전국 p75, 표준화 초과치 최강, ±5% 경계)
    soc = {}
    for k, nm_ in SOCIAL:
        if m.get(k) is not None and th.get(k) and m[k] >= th[k]: soc[nm_] = exceed(m[k], th[k], sd.get(k, 0))
        if m.get(k) is not None and th.get(k) and near(m[k], th[k]): edge.append(nm_)
    social_t = max(soc, key=soc.get) if soc else None
    return dict(social=social_t, social_scores={k: round(v, 2) for k, v in soc.items()}, primary=primary, secondary=secondary, complex=len(haz) >= 2, bold=(primary != "평온" and m["dens"] >= th["dens"]),
                edge=sorted(set(edge)), hazards=sorted(haz, key=haz.get, reverse=True), scores={k: round(v, 2) for k, v in haz.items()},
                basis=(basis if primary == "물" else s_basis if primary == "산" else None))


def label(t):
    s = t["primary"] + ("(지정)" if t.get("basis") == "zone" else "") + "·" + (t["secondary"] or "—")
    if t["bold"]: s += "(굵게)"
    if t["complex"]: s += "[복합]"
    return s


# ───────── 시군구 ─────────
METRICS = ["flood_r", "ls_r", "slope", "e65", "ealone", "single", "dens", "rzf", "rzo", "rzc", "rzs", "rzd", "foreign_r", "disabled_r", "basic_r", "traffic_r", "fire_r"]
for r in rows:  # 위험개선지구 밀도(/100km²) — 절대 개수는 면적 큰 군에 몰려 '물'을 과대 판정했다(v0 첫 실행 교훈)
    z = rz.get(r["code"], {}); fl = int(z.get("flood", 0)); area = max(float(r["area"]), 1.0)
    r["rzf"] = fl / area * 100; r["rzo"] = (int(z.get("n", 0)) - fl) / area * 100
    zt = z.get("t", {}); r["rzc"] = int(zt.get("002", 0)) / area * 100; r["rzs"] = int(zt.get("006", 0)) / area * 100; r["rzd"] = int(zt.get("007", 0)) / area * 100
    vv = vuln.get(r["code"], {})
    for k in ("foreign_r", "disabled_r", "basic_r"): r[k] = vv.get(k)
    ss = social.get(r["code"], {})
    for k in ("traffic_r", "fire_r"): r[k] = ss.get(k)
M = {v: [float(r[v]) for r in rows if r[v] is not None] for v in METRICS}
TH = {v: pct(M[v]) for v in METRICS}
TH["slope80"] = pct(M["slope"], 80); TH["single80"] = pct(M["single"], 80)  # v1.1
SD = {v: (float(np.std(M[v])) if M[v] else 0.0) for v in METRICS}
for k in ("rzc", "rzs", "rzd"):  # pos 모드: 해당 유형 지구 보유 시군구만의 p75·sd
    posv = [x for x in M[k] if x > 0]
    TH[k + "_pos"] = pct(posv) if posv else 0.0; SD[k + "_pos"] = float(np.std(posv)) if posv else 0.0
sgg_out, pair, prim_cnt, cross = {}, Counter(), Counter(), defaultdict(Counter)
for r in rows:
    code = r["code"]; m = {v: (None if r[v] is None else float(r[v])) for v in METRICS}
    z = rz.get(code, {}); fl = int(z.get("flood", 0)); other = int(z.get("n", 0)) - fl
    t = classify(m, TH, SD, r["kind"], int(r["coastal"]))
    upper = f"{r['kind']}·{'해안' if int(r['coastal']) else '내륙'}"
    sgg_out[code] = dict(name=r["name"], sido=idx.get(code, {}).get("sido", r["sido"][:2] if r["sido"] else ""), kind=r["kind"], upper=upper, **t, label=label(t),
                         metrics=dict(flood_r=m["flood_r"], ls_r=m["ls_r"], slope=round(m["slope"], 2), e65=m["e65"], ealone=m["ealone"], single=m["single"], dens=m["dens"], rz_flood=fl, rz_other=other, rzf=round(m["rzf"], 2), rzo=round(m["rzo"], 2), rz_t=z.get("t", {}), rzc=round(m["rzc"], 2), rzs=round(m["rzs"], 2), rzd=round(m["rzd"], 2), foreign_r=m["foreign_r"], disabled_r=m["disabled_r"], basic_r=m["basic_r"], traffic_r=m.get("traffic_r"), fire_r=m.get("fire_r"), pop=int(float(r["pop"]))))
    pair[(t["primary"], t["secondary"] or "—")] += 1; prim_cnt[t["primary"]] += 1
    cross[t["primary"]][labels.get(code, {}).get("cluster_tag", "?")] += 1

meta = dict(version=VERSION, built=_dt.date.today().isoformat(), unit="sgg", n=len(sgg_out),
            thresholds={k: round(v, 4) for k, v in TH.items()}, fixed_thresholds={"edge_rel": EDGE, "emd_ls_r_floor": 0.02},
            rules={"primary": f"[v1.2/{RZ_MODE}] 물: flood_r≥p75 or 침수위험개선지구밀도(rzf,/100km²)≥p75 (basis=history|zone) / 산: ls_r≥p75 or slope≥p80 or 붕괴위험개선지구(rzc, 모드 규칙) (basis=history|zone) / 바다: coastal==1, 강도=해일위험개선지구(rzs, 모드 규칙; 없으면 0=접촉만) / 마름: 상습가뭄재해지구(rzd, 모드 규칙) — 모드: all=전국p75·z/SD, pos=보유지 p75 초과분만, tag=주 타입 미반영 / 없음→평온; 둘 이상→complex; 표준화 초과치 최강이 주 타입 — 근거: ECRT(Hincks 2023) V9·V12·V13·V14·V18·V22, ESPON-TITAN(Klein 2024), 구주영 2026(위험개선지구=노출), 장경은 2023(경사), Chang 2018(해안)",
                   "secondary": "[v1.2] 노년: e65≥p75 & ealone≥p75 / 홀로: single≥p80 / 이방: foreign_r≥p75 / 돌봄: disabled_r≥p75 / 살림: basic_r≥p75 / 도심: dens≥p75 / 들: kind=='군'[proxy] / 없음→null — 우선순위 고정(취약→구조), 취약 3종 근거: 구주영·김강민·KIPA 공통 표준(docs/16) — 근거: 김강민·황철수 2024·KIPA 2017 재난약자(노년), 박현수·권설아 2024(1인가구), Tocchi 2025 1단 범주(도심·농촌)",
                   "bold": "dens≥p75 (노출 대리) — 주 타입이 평온이면 미적용 — 근거: ECRT 노출 축, Chang 2018 해안 거주 %, Lee 2019 빈도×규모", "edge": "임계 ±5% 이내 타입 — 근거: Tate 2012 임계 민감도", "upper": "행정유형(구/시/군) × 해안/내륙 — 근거: Tocchi 2025 상위=범주형 구조, KIPA 2017 5그룹 상대평가",
                   "threshold_basis": "같은 단위 전국 p75 — 근거: 장경은 외 2023 등분위 5등급, KIPA 2017 동일유형 내 상대등급; 순위·가중합 금지 — Spielman 2020, Greco 2019, Cutter 2003",
                   "literature": "docs/16_타입기준_v1_문헌근거_20260904.md"},
            sources={"flood_r,ls_r,slope,dens,coastal": "data/grid(행안부 침수흔적도·산사태 발생이력, Copernicus GLO-30), kr_sgg 경계 접촉 판정 (docs/lib/sgg_typology_explore_20260903.csv)",
                     "e65,ealone,single,pop": "행안부 주민등록 2026-07 (sgg_demo.json)", "rz_flood,rz_other,rz_t,rzc,rzs,rzd": "행안부 자연재해위험개선지구 7유형 (riskzone_by_sgg.json, build_riskzone.py, asof 2026-08-27)",
                     "foreign_r": "행안부 2024 지방자치단체 외국인주민 현황(2024-11-01) ÷ 주민등록 2026-07", "disabled_r": "복지부 등록장애인 현황(2024-12-31) ÷ 주민등록 2026-07", "basic_r": "한국사회보장정보원 복지사업 시군구별 수급권자 현황(2025-12, 기초생활보장 맞춤형급여) ÷ 주민등록 2026-07 (sgg_vuln.json)"},
            caveats=["기록 없음 ≠ 안전: 침수·산사태 이력은 신고·기록된 것만 담는다", "'들' 타입은 행정구역 이름(군)으로 판단한 농어촌 근사치", "'바다' 타입은 해안 접촉 여부만 본 부분 규칙(해일·태풍 강도 미반영)",
                     "서울은 침수흔적도가 촘촘해 '물' 타입이 과대 대표될 수 있음", "'산'의 지정 근거 = 붕괴위험개선지구(유형 002)만 사용(v1.2, 6유형 혼합 proxy 폐기)", "취약 3종 비율의 분모(주민등록 2026-07)는 원천 시점(2024-11·2024-12·2025-12)과 다름 — 근사", "2026 개편 지역(인천 제물포·영종·검단·서해구, 화성시 4구 등)은 취약 3종 원천에 없어 이방·돌봄·살림 판정 생략", "전국 시군구 사분위 기준 상대 판정 — 순위 아님"])
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
for e in emd.values(): e["rzf"] = 0.0; e["rzo"] = 0.0; e["rzc"] = 0.0; e["rzs"] = 0.0; e["rzd"] = 0.0; e["foreign_r"] = None; e["disabled_r"] = None; e["basic_r"] = None; e["traffic_r"] = None; e["fire_r"] = None  # 위험개선지구·취약 3종은 시군구 단위 자료 — 행정동 판정에 미사용
ME = {v: [e[v] for e in emd.values() if e[v] is not None] for v in METRICS}
TH_E = {v: pct(ME[v]) for v in METRICS}; SD_E = {v: (float(np.std(ME[v])) if ME[v] else 0.0) for v in METRICS}
TH_E["slope80"] = pct(ME["slope"], 80); TH_E["single80"] = pct(ME["single"], 80)  # v1.1
TH_E["ls_r"] = max(TH_E["ls_r"], 0.02)  # 행정동 산사태 이력 p75가 0이라 '셀 하나만 있어도 산'이 되는 것을 막는다(v0 첫 실행 교훈)
TH_E["rzf"] = TH_E["rzo"] = TH_E["rzc"] = TH_E["rzs"] = TH_E["rzd"] = 0.0
for k in ("rzc", "rzs", "rzd"): TH_E[k + "_pos"] = 0.0; SD_E[k + "_pos"] = 0.0
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
soc_cnt = Counter(v.get("social") or "—" for v in sgg_out.values()); soc_pair = Counter((v["primary"], v.get("social") or "—") for v in sgg_out.values())
print("\n(b2) 사회 위해 슬롯(v1.3 초안):", dict(soc_cnt), "| 주×사회 상위:", soc_pair.most_common(8))
print("\n(c) 주 타입 × k-means 군집(09-03)")
tags = sorted({t for c in cross.values() for t in c})
print("  " + " | ".join(f"{t[:14]:>14s}" for t in tags))
for p in ["물", "산", "바다", "마름", "평온"]:
    print(f"  {p:<4s}" + " | ".join(f"{cross[p].get(t, 0):14d}" for t in tags))
print("\n(d) 예시")
ex = ["52720", "11500", "11620", "41115", "48860", "12850", "51820", "26350", "47130", "36110", "11680", "41111"]
for c in ex:
    if c in sgg_out: s = sgg_out[c]; print(f"  {s['name']:<10s} {s['label']:<16s} upper={s['upper']} edge={s['edge']} hz={s['scores']}")
print("\n행정동 주 타입 개수:", dict(emd_prim), "| 읍면동 p75:", {k: round(v, 3) for k, v in TH_E.items()})
for f in ("sgg_types.json", "emd_types.json", "sido_types.json"): print(f"  {f}: {os.path.getsize(P('data', 'ref', f)) // 1024} KB")
