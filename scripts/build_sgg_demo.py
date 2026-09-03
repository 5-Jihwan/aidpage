"""AidPage — 시군구 인구 프로필 data/ref/sgg_demo.json (build_grid_nation.py 산출물에서 집계).

격자(data/grid/<sgg>.geojson)의 행정동 단위 주민등록 속성(pop·hh·elderly65_r·single_hh_r·
elderly_alone_r, source_level=emd)을 행정동별로 1회씩만 취해 시군구로 합산한다.
결과는 복지서비스 "지역 특성" 줄과 지역 가중(고령·1인세대·군 지역)에 쓰인다.

- 비율은 가중 평균(인구/세대 기준), 전국 시군구 분포의 사분위(p25/p50/p75)를 함께 저장해
  프런트가 "전국 시군구 중 상위 ○%"를 계산할 수 있게 한다.
- gun: 시군구 이름이 '군'으로 끝나면 true (농어촌 대리 지표 — 정확한 농어촌 분류가 아님을 UI에 명시).
- 재실행 안전: 격자 없으면 건너뜀. 손으로 고치지 말고 스크립트를 다시 돌릴 것.
"""
from __future__ import annotations

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


def quantiles(vals: list[float]) -> dict:
    v = sorted(x for x in vals if x is not None)
    if not v:
        return {}
    pick = lambda q: v[min(len(v) - 1, int(round(q * (len(v) - 1))))]  # noqa: E731
    return {"p25": round(pick(0.25), 4), "p50": round(pick(0.5), 4), "p75": round(pick(0.75), 4), "n": len(v)}


def main() -> None:
    idx = {s["code"]: s for s in json.load(open(IDX, encoding="utf-8"))}
    rows: dict[str, dict] = {}
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
            emd[p["emd_code"]] = p  # 같은 행정동 값이 셀마다 반복 — 1회만
        if not emd:
            continue
        pop = sum(int(p["pop"]) for p in emd.values())
        hh = sum(int(p.get("hh") or 0) for p in emd.values())
        w = lambda k, base: (sum((p.get(k) or 0) * (p.get(base) or 0) for p in emd.values()) / (sum(p.get(base) or 0 for p in emd.values()) or 1))  # noqa: E731
        s = idx.get(code, {})
        name = s.get("name", "")
        rows[code] = {
            "pop": pop, "hh": hh, "n_emd": len(emd),
            "e65": round(w("elderly65_r", "pop"), 4),
            "single": round(w("single_hh_r", "hh"), 4),
            "ealone": round(w("elderly_alone_r", "hh"), 4),
            "gun": name.endswith("군"),
        }
    q = {k: quantiles([r[k] for r in rows.values()]) for k in ("e65", "single", "ealone", "pop")}
    out = {"source": "MOIS resident registration (jumin) via data/grid emd attributes", "basis": basis or "2026-07",
           "built": __import__("datetime").date.today().isoformat(), "n": len(rows), "q": q, "sgg": rows}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"[sgg_demo] {len(rows)} sgg -> {OUT} ({os.path.getsize(OUT)//1024} KB) q={q}")


if __name__ == "__main__":
    main()
