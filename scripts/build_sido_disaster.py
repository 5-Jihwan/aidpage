"""AidPage — 시도 재난 맥락 변수 data/ref/sido_disaster.json (통계연보 API 산출물 가공).

입력: data/ref/yearbook/facility_damage.json(지역별 자연재난 시설 피해, 2016~), recovery_source.json(복구비 재원, 2016~)
      — 둘 다 **시도 단위**(fetch_yearbook가 판정). 시군구 유형화의 직접 입력은 아니고, 시도 맥락 변수·검증용.
산출(시도별, 최근 N년 합산):
  pop_per_capita_damage  인구 1인당 피해액(천원) — 인구는 sgg_demo 시도 합산(주민등록 2026-07, 연도 불일치는 문서에 명시)
  share_*                피해액 구성비(건물·선박·농경지·공공시설·기타)  → 재난 유형 신호(농경지↑=농촌형, 선박↑=해안형, 건물↑=도심형)
  self_burden_ratio      (자부담+자력복구)/총복구액 — 개인이 떠안는 복구 비중(첫 고리 명제와 직결)
  local_share            지방비/지원복구 소계, state_share 국고/지원복구 소계
  deaths, victims        사망·실종, 이재민 합계
단위: 통계연보 피해액·복구액은 백만원. 시도 이름은 통계연보 약칭(서울·경기·전북…) → sgg_index의 sido 코드로 매핑.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YB = os.path.join(ROOT, "data", "ref", "yearbook")
OUT = os.path.join(ROOT, "data", "ref", "sido_disaster.json")
YEARS = 8  # 최근 8년(2016~2023 전부)

# 통계연보 약칭 → sgg_index sido 코드 (admdongkor 2026-07: 광주+전남 통합 코드 12)
SHORT2CODE = {"서울": "11", "부산": "26", "대구": "27", "인천": "28", "광주": "12", "전남": "12", "대전": "30", "울산": "31", "세종": "36",
              "경기": "41", "강원": "51", "충북": "43", "충남": "44", "전북": "52", "경북": "47", "경남": "48", "제주": "50"}


def num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def main() -> None:
    dmg = json.load(open(os.path.join(YB, "facility_damage.json"), encoding="utf-8"))
    rec = json.load(open(os.path.join(YB, "recovery_source.json"), encoding="utf-8"))
    demo = json.load(open(os.path.join(ROOT, "data", "ref", "sgg_demo.json"), encoding="utf-8"))
    years = sorted({r["wrttimeid"] for r in dmg["rows"]})[-YEARS:]
    agg: dict[str, dict] = {}
    for r in dmg["rows"]:
        if r["wrttimeid"] not in years or r["region"] == "합계":
            continue
        code = SHORT2CODE.get(r["region"])
        if not code:
            continue
        a = agg.setdefault(code, {"names": set(), "tot": 0, "bld": 0, "ship": 0, "farm": 0, "pub": 0, "etc": 0, "deaths": 0, "victims": 0, "rec_tot": 0, "sup": 0, "state": 0, "local": 0, "loan": 0, "selfpay": 0, "selfrec": 0})
        a["names"].add(r["region"])
        a["tot"] += num(r["damage_amount_tot"]); a["bld"] += num(r["building_damage_amount"]); a["ship"] += num(r["ship_damage_amount"])
        a["farm"] += num(r["farmland_damage_amount"]); a["pub"] += num(r["public_facility_damage_amount"]); a["etc"] += num(r["etc"])
        a["deaths"] += num(r["death_disappearance"]); a["victims"] += num(r["victim"])
    for r in rec["rows"]:
        if r["wrttimeid"] not in years or r["region"] == "합계":
            continue
        code = SHORT2CODE.get(r["region"])
        if not code or code not in agg:
            continue
        a = agg[code]
        a["rec_tot"] += num(r["total_recovery_amount"]); a["sup"] += num(r["support_recovery_subtotal"]); a["state"] += num(r["support_recovery_state_coffer"])
        a["local"] += num(r["support_recovery_local_rate"]); a["loan"] += num(r["support_recovery_loan"]); a["selfpay"] += num(r["support_recovery_self_pay"]); a["selfrec"] += num(r["self_recovery"])
    # 시도 인구 = sgg_demo의 시군구 인구를 sgg_index의 sido 코드로 합산(sgg_demo에 sido 합계가 없을 때도 동작)
    idx = json.load(open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))
    sido_pop: dict[str, int] = {}
    for sg in idx:
        r = (demo.get("sgg") or {}).get(sg["code"])
        if r:
            sido_pop[str(sg["sido"])] = sido_pop.get(str(sg["sido"]), 0) + int(r.get("pop") or 0)
    out_sido = {}
    for code, a in agg.items():
        pop = ((demo.get("sido") or {}).get(code, {}) or {}).get("pop") or sido_pop.get(code) or 0
        t = a["tot"] or 1; rt = a["rec_tot"] or 1; sup = a["sup"] or 1
        out_sido[code] = {
            "names": sorted(a["names"]), "years": [years[0], years[-1]],
            "damage_total_mw": round(a["tot"]), "damage_per_capita_krw": round(a["tot"] * 1e6 / pop) if pop else None,
            "share_building": round(a["bld"] / t, 3), "share_ship": round(a["ship"] / t, 3), "share_farmland": round(a["farm"] / t, 3), "share_public": round(a["pub"] / t, 3), "share_etc": round(a["etc"] / t, 3),
            "deaths": int(a["deaths"]), "victims": int(a["victims"]),
            "recovery_total_mw": round(a["rec_tot"]), "self_burden_ratio": round((a["selfpay"] + a["selfrec"]) / rt, 3), "state_share": round(a["state"] / sup, 3), "local_share": round(a["local"] / sup, 3), "loan_share": round(a["loan"] / sup, 3),
        }
    out = {"source": "행정안전부 행정안전통계연보 오픈API 15107320(지역별 자연재난 시설 피해)·15107326(지역별 자연재해 복구비 재원), 시도 단위", "unit_note": "금액 백만원(mw). 1인당 피해액은 주민등록 2026-07 인구로 나눈 근사치(연도 불일치). 광주·전남은 행정동 경계 통합코드 12로 합산.",
           "years": years, "built": _dt.date.today().isoformat(), "sido": out_sido}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"[sido_disaster] {len(out_sido)} sido, years {years[0]}~{years[-1]} -> {OUT}")
    rows = sorted(out_sido.items(), key=lambda kv: -(kv[1]["damage_per_capita_krw"] or 0))
    print(f"{'시도':10s} {'1인당피해(원)':>12s} {'농경지':>6s} {'건물':>6s} {'선박':>6s} {'공공':>6s} {'자부담+자력':>10s} {'국고':>6s} {'지방비':>6s}")
    for code, v in rows:
        print(f"{'·'.join(v['names']):10s} {v['damage_per_capita_krw'] or 0:12,d} {v['share_farmland']:6.2f} {v['share_building']:6.2f} {v['share_ship']:6.2f} {v['share_public']:6.2f} {v['self_burden_ratio']:10.2f} {v['state_share']:6.2f} {v['local_share']:6.2f}")


if __name__ == "__main__":
    main()
