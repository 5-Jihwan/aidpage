"""도감 '방법 보기(심사자용)' 자료 — data/ref/sgg_type_specs.json (docs/24 §5-3, docs/22 §1·§4).

같은 규칙(build_types.py classify)을 임계 사양·단위 사양만 바꿔 다시 돌려, 시군구별로 타입이 어떻게 달라지는지를 저장한다.
  임계: p70/p75 · p75/p80(기준) · p80/p85 · p75/p75(경사·홀로도 p75)
  단위: 255(기준) · 229(구를 둔 일반시 13곳을 시로 합산 — 위해 면적가중·인구 지표 인구가중·밀도 재계산, docs/22 §4)
scripts/typology_sensitivity.py 의 앞부분(적재·run·thresholds)을 그대로 실행해 규칙 동일성을 보장한다(부트스트랩 등 무거운 분석은 실행하지 않음).

출력: { meta, baseline:'p75', specs: { p70|p75|p80|p7575: {code: T}, u229: {code: T + m: 합산 시 코드} } }
  T = { p: 주 타입(근접·희미 포함), lean: '근접'|'희미'|null, b: 근거, t: 특징[], s: 사회 위해, x: 복합 }
"""
from __future__ import annotations

import io
import json
import os
import sys
from collections import defaultdict
from datetime import date

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731
OUT = P("data", "ref", "sgg_type_specs.json")

src = io.open(P("scripts", "typology_sensitivity.py"), encoding="utf-8").read()
prefix = src.split("base, TH0 = run()")[0]
ns: dict = {"__file__": P("scripts", "typology_sensitivity.py"), "__name__": "typology_sensitivity_prefix"}
exec(compile(prefix, "typology_sensitivity_prefix", "exec"), ns)
rows, run, thresholds, classify, METRICS, MV = ns["rows"], ns["run"], ns["thresholds"], ns["classify"], ns["METRICS"], ns["MV"]


def slim(t):
    return {"p": t.get("primary"), "lean": (t["lean"]["deg"] if t.get("lean") else None), "b": t.get("basis"), "t": t.get("traits") or [], "s": t.get("social"), "x": bool(t.get("complex"))}


def main() -> int:
    base, _ = run()
    specs = {"p75": {c: slim(t) for c, t in base.items()}}
    for name, q, q80 in (("p70", 70, 75), ("p80", 80, 85), ("p7575", 75, 75)):
        out, _ = run(q=q, q80=q80)
        specs[name] = {c: slim(t) for c, t in out.items()}

    # ── 단위 229: typology_sensitivity.py §4와 동일 절차 ──
    groups = defaultdict(list)
    METRO = ("서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "전남광주통합특별시")
    for r in rows:
        nm = r["name"]
        if r["kind"] == "구" and "시" in nm and nm.endswith("구") and r["sido"] not in METRO:
            groups[nm.split("시")[0] + "시"].append(r)
    merged_rows = [r for r in rows if not any(r in g for g in groups.values())]
    gu_to_m = {}
    for city, gs in groups.items():
        area = sum(float(r["area"]) for r in gs)
        pop = sum(float(r["pop"]) for r in gs)
        wa = lambda k: sum(float(r[k]) * float(r["area"]) for r in gs) / area  # noqa: E731
        wp = lambda k: (sum(float(r[k]) * float(r["pop"]) for r in gs if r[k] is not None) / sum(float(r["pop"]) for r in gs if r[k] is not None)) if any(r[k] is not None for r in gs) else None  # noqa: E731
        m = dict(flood_r=wa("flood_r"), ls_r=wa("ls_r"), slope=wa("slope"), e65=wp("e65"), ealone=wp("ealone"), single=wp("single"), dens=pop / area,
                 rzf=wa("rzf"), rzo=wa("rzo"), rzc=wa("rzc"), rzs=wa("rzs"), rzd=wa("rzd"), foreign_r=wp("foreign_r"), disabled_r=wp("disabled_r"), basic_r=wp("basic_r"),
                 traffic_r=gs[0]["traffic_r"], fire_r=None)
        fake = dict(gs[0]); fake["code"] = "M" + gs[0]["code"]; fake["name"] = city; fake["kind"] = "시"; fake["area"] = area; fake["pop"] = pop; fake["coastal"] = max(int(r["coastal"]) for r in gs)
        for k, v in m.items():
            fake[k] = v
        merged_rows.append(fake)
        for r in gs:
            gu_to_m[r["code"]] = fake["code"]
    THm, SDm = thresholds(merged_rows)
    om = {r["code"]: classify({v: (None if r[v] is None else float(r[v])) for v in METRICS}, THm, SDm, r["kind"], int(r["coastal"])) for r in merged_rows}
    for t in om.values():
        if t.get("lean"):
            t["lean"]["deg"] = "근접" if t["lean"]["r"] >= 0.5 else "희미"
    u229 = {}
    for r in rows:
        c = r["code"]
        if c in gu_to_m:
            d = slim(om[gu_to_m[c]]); d["m"] = gu_to_m[c]; d["mn"] = next(city for city, gs in groups.items() if any(x["code"] == c for x in gs))
        else:
            d = slim(om[c])
        u229[c] = d
    specs["u229"] = u229

    # 기준 사양이 배포본(sgg_types.json)과 같은지 확인
    ty = json.load(open(P("data", "ref", "sgg_types.json"), encoding="utf-8"))["sgg"]
    mism = [c for c, t in specs["p75"].items() if c in ty and ty[c]["primary"] != t["p"]]
    if mism:
        print("WARN baseline mismatch vs sgg_types.json:", len(mism), mism[:8])

    def chg(name):
        return sum(1 for c in specs["p75"] if (specs[name][c]["p"], specs[name][c]["lean"] is None) != (specs["p75"][c]["p"], specs["p75"][c]["lean"] is None))

    meta = {
        "version": "specs-" + date.today().isoformat(), "built": date.today().isoformat(), "baseline": "p75",
        "typology_version": json.load(open(P("data", "ref", "sgg_types.json"), encoding="utf-8"))["meta"]["version"],
        "specs": {"p70": "p70/p75", "p75": "p75/p80 (기준)", "p80": "p80/p85", "p7575": "p75/p75 (경사·홀로도 p75)", "u229": "단위 229 (통합시 13곳 합산)"},
        "changed_vs_baseline": {k: chg(k) for k in ("p70", "p80", "p7575", "u229")},
        "n_units_229": len(merged_rows), "n_cities_merged": len(groups), "baseline_mismatch": len(mism),
        "note": "'바뀜' = 성립 주 타입 또는 성립/미성립 여부가 기준 사양과 다른 경우. 규칙·자료는 동일, 임계·단위만 다름(docs/22 §1·§4).",
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "specs": specs}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: changed={meta['changed_vs_baseline']} units229={len(merged_rows)} size={os.path.getsize(OUT) // 1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
