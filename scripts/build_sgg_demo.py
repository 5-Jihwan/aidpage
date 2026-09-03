"""AidPage — 지역 인구 프로필 (build_grid_nation.py 산출물에서 집계).

산출물 2개:
- data/ref/sgg_demo.json  : 시군구(255)·시도(16) 집계 + 전국 합계 + 시군구/읍면동 사분위(q, q_emd)
- data/ref/emd_demo.json  : 읍면동(행정동) 원값 {code: [pop, hh, e65, single, ealone]} — 읍면동 선택 시에만 lazy-load

격자(data/grid/<sgg>.geojson)의 행정동 단위 주민등록 속성(pop·hh·elderly65_r·single_hh_r·
elderly_alone_r, source_level=emd)을 행정동별로 1회씩만 취해 상위 단위로 합산한다.
결과는 ① '내 동네' 탭의 "이 지역은 누가 사나" 카드 ② 지도 호버 툴팁 ③ 복지서비스 "지역 특성"(태그·가중)에 쓰인다.

- 비율은 가중 평균(인구/세대 기준). 사분위(p25/p50/p75)는 같은 단위(시군구↔시군구, 읍면동↔읍면동) 안에서만 비교한다.
  시도는 표본이 16개라 사분위 대신 전국 값(nation)과 나란히 보인다.
- gun: 시군구 이름이 '군'으로 끝나면 true (농어촌 대리 지표 — 정확한 농어촌 분류가 아님을 UI에 명시).
- 시도 묶음은 sgg_index.json의 sido 필드를 따른다(admdongkor 2026-07: 광주+전남 통합 코드 12 등).
- 재실행 안전: 격자 없으면 건너뜀. 손으로 고치지 말고 스크립트를 다시 돌릴 것.
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
GRID = os.path.join(ROOT, "data", "grid")
IDX = os.path.join(ROOT, "data", "admin", "sgg_index.json")
OUT = os.path.join(ROOT, "data", "ref", "sgg_demo.json")
OUT_EMD = os.path.join(ROOT, "data", "ref", "emd_demo.json")
KEYS = ("e65", "single", "ealone", "pop")


def quantiles(vals: list[float]) -> dict:
    v = sorted(x for x in vals if x is not None)
    if not v:
        return {}
    pick = lambda q: v[min(len(v) - 1, int(round(q * (len(v) - 1))))]  # noqa: E731
    return {"p25": round(pick(0.25), 4), "p50": round(pick(0.5), 4), "p75": round(pick(0.75), 4), "n": len(v)}


def aggregate(rows: list[dict]) -> dict:
    """행 목록(pop·hh·e65·single·ealone) → 가중 합산 한 행."""
    pop = sum(int(r["pop"]) for r in rows)
    hh = sum(int(r["hh"]) for r in rows)
    wp = lambda k: (sum((r[k] or 0) * r["pop"] for r in rows) / (pop or 1))  # noqa: E731
    wh = lambda k: (sum((r[k] or 0) * r["hh"] for r in rows) / (hh or 1))  # noqa: E731
    return {"pop": pop, "hh": hh, "e65": round(wp("e65"), 4), "single": round(wh("single"), 4), "ealone": round(wh("ealone"), 4)}


def main() -> None:
    idx = {s["code"]: s for s in json.load(open(IDX, encoding="utf-8"))}
    sgg: dict[str, dict] = {}
    emd_all: dict[str, dict] = {}
    basis = None
    for fn in sorted(os.listdir(GRID)):
        if not fn.endswith(".geojson"):
            continue
        code = fn[:-8]
        doc = json.load(open(os.path.join(GRID, fn), encoding="utf-8"))
        basis = basis or (doc.get("meta") or {}).get("jumin_basis")
        emd: dict[str, dict] = {}
        for f in doc.get("features", []):
            p = f.get("properties") or {}
            if p.get("pop") is None or not p.get("emd_code"):
                continue
            emd[p["emd_code"]] = {"pop": int(p["pop"]), "hh": int(p.get("hh") or 0), "e65": p.get("elderly65_r") or 0,
                                  "single": p.get("single_hh_r") or 0, "ealone": p.get("elderly_alone_r") or 0}
        if not emd:
            continue
        emd_all.update(emd)
        s = idx.get(code, {})
        row = aggregate(list(emd.values()))
        row.update({"n_emd": len(emd), "gun": s.get("name", "").endswith("군"), "sido": s.get("sido")})
        sgg[code] = row
    # 시도 = 시군구 합산(sgg_index의 sido 코드 기준), 전국 = 시군구 전체 합산
    sido: dict[str, dict] = {}
    for code, r in sgg.items():
        sido.setdefault(str(r.get("sido") or code[:2]), []).append(r)
    sido_out = {k: {**aggregate(v), "n_sgg": len(v)} for k, v in sido.items()}
    nation = aggregate(list(sgg.values()))
    for r in sgg.values():
        r.pop("sido", None)
    q = {k: quantiles([r[k] for r in sgg.values()]) for k in KEYS}
    q_emd = {k: quantiles([r[k] for r in emd_all.values()]) for k in KEYS}
    out = {"source": "MOIS resident registration (jumin) via data/grid emd attributes", "basis": basis or "2026-07",
           "built": _dt.date.today().isoformat(), "n": len(sgg), "q": q, "q_emd": q_emd, "nation": nation, "sido": sido_out, "sgg": sgg}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    emd_out = {"basis": basis or "2026-07", "built": out["built"], "cols": ["pop", "hh", "e65", "single", "ealone"],
               "items": {k: [v["pop"], v["hh"], round(v["e65"], 4), round(v["single"], 4), round(v["ealone"], 4)] for k, v in sorted(emd_all.items())}}
    json.dump(emd_out, open(OUT_EMD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"[sgg_demo] sgg={len(sgg)} sido={len(sido_out)} emd={len(emd_all)} -> {OUT} ({os.path.getsize(OUT)//1024} KB), {OUT_EMD} ({os.path.getsize(OUT_EMD)//1024} KB)")
    print(f"[sgg_demo] nation={nation} q_sgg={q['e65']} q_emd={q_emd['e65']}")


if __name__ == "__main__":
    main()
