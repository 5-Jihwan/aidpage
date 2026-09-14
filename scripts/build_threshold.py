"""도감 '국가 지원 문턱' 층 + '기록된 결과' 층 — data/ref/sgg_threshold.json (docs/24 §5-1·5-2).

입력(로컬 전용 .work_yearbook/, gitignore):
  fiscal/fiscal_index_3yr_avg.csv  지방재정365 보통교부세 산정내역 → 시·군 재정력지수 3년 평균(연도 X = X-2..X 평균)
  thresholds.csv                   규정 제5조① 국고지원 기준·시행령 제69조① 선포 기준 연혁(체계 A~D)
  subsidy_sgg_coded.csv            재해연보 국고지원(우심) 시군구 2012~2024 (334행)
  declarations_coded.csv           재해연보 특별재난지역 선포 2012~2024 (350행, 시군구·읍면동 단위)
  data/ref/yearbook/woosim_sgg.json 2024 연보 4-4.6 시군구별 우심피해 10년(공개 파일)
출력: data/ref/sgg_threshold.json — 코드별 { fi3, fi_years, band, thr{sub,decl,emd}, fi_unit, records{...} }

단위 규칙: 재정력지수·국고지원·선포는 '시' 단위. 일반구가 있는 통합시(수원·창원 등 14곳)는 도감이 구 단위이므로
  시의 값을 모든 구에 붙이고 fi_unit='parent'로 표시한다. 광역시 자치구·제주(행정시)는 교부세 산정에서 본청에
  합산돼 지수가 없다 → fi3=null (KOSIS 확보 후 채움).
현행 문턱 = 체계 D(2024-11-19~). 사건연도 Y의 구간은 (Y-3~Y-1) 평균이므로 2026년 사건 = 2023~2025 평균 = csv year 2025.
예측 아님: 기록은 연보에 인쇄된 사실만 옮긴다.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import date

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.path.join(ROOT, ".work_yearbook")
OUT = os.path.join(ROOT, "data", "ref", "sgg_threshold.json")
FISCAL_YEAR = "2025"  # 2023~2025 평균 → 2026년 사건에 적용

SIDO_SHORT = {"서울": "11", "전남": "12", "광주": "12", "부산": "26", "대구": "27", "인천": "28", "대전": "30", "울산": "31",
              "세종": "36", "경기": "41", "충북": "43", "충남": "44", "경북": "47", "경남": "48", "제주": "50", "강원": "51", "전북": "52"}
METRO = ("11", "26", "27", "28", "30", "31", "12")


def rd(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main() -> int:
    idx = json.load(open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))
    types = json.load(open(os.path.join(ROOT, "data", "ref", "sgg_types.json"), encoding="utf-8"))["sgg"]
    by_code = {str(s["code"]): s for s in idx}
    codes = sorted(set(by_code) | set(types))

    # ── 문턱 체계 D(현행) ──
    bands = []
    for r in rd(os.path.join(W, "thresholds.csv")):
        if r["effective_from"] == "2024-11-19":
            bands.append({"lo": float(r["band_low"]), "hi": float(r["band_high"]) if r["band_high"] else None,
                          "sub": float(r["subsidy_threshold_eok"]), "decl": float(r["declaration_threshold_eok"]), "emd": float(r["emd_threshold_eok"])})
    bands.sort(key=lambda b: b["lo"])
    assert len(bands) == 5, bands

    def band_of(v):
        for i, b in enumerate(bands):
            if v >= b["lo"] and (b["hi"] is None or v < b["hi"]):
                return i
        return None

    # ── 이름 → 코드 (시 단위 → 구 단위 확장) ──
    def find_codes(sido_short, name):
        sido = SIDO_SHORT.get(sido_short)
        if not sido:
            return []
        exact = [c for c, s in by_code.items() if s["sido"] == sido and s["name"] == name]
        if exact:
            return exact
        return [c for c, s in by_code.items() if s["sido"] == sido and s["name"].startswith(name)]

    def expand(c):
        """연보·재정 코드(시 단위) → 도감 코드 목록. 시 코드가 도감에 없으면 같은 4자리 접두의 구들로."""
        if c == "JEJU":  # 연보가 제주를 도 단위로 적는 사건 → 두 행정시에 함께 붙인다(rec_unit=parent)
            return ["50110", "50130"]
        if c in by_code:
            return [c]
        return [k for k in by_code if k[:4] == c[:4]]

    # ── 재정력지수 ──
    fi, fi_unit, fi_years, miss = {}, {}, {}, []
    rows_f = rd(os.path.join(W, "fiscal", "fiscal_index_3yr_avg.csv"))
    # 기본 2025(2023~25 평균). 시도 이관 등으로 2025 행이 없는 곳(군위 2023-07 대구 편입)은 2026 행(2024~26 평균)으로 보완.
    for year in (FISCAL_YEAR, str(int(FISCAL_YEAR) + 1)):
        for r in rows_f:
            if r["year"] != year:
                continue
            cs = find_codes(r["sido"], r["sgg_name"])
            if not cs:
                miss.append((year, r["sido"], r["sgg_name"]))
                continue
            for c in cs:
                if c in fi:
                    continue
                fi[c] = float(r["fiscal_index_3yr"])
                fi_unit[c] = "self" if len(cs) == 1 else "parent"
                fi_years[c] = r["years_used"]
    if miss:
        print("fiscal unmatched:", miss)
    # 자치구(광역시) — scripts/fetch_gu_fiscal.py 가 KOSIS에서 받아 둔 CSV가 있으면 2023~2025 평균으로 채운다(없으면 건너뜀)
    gu_csv = os.path.join(W, "fiscal", "gu_fiscal_index.csv")
    if os.path.exists(gu_csv):
        acc = defaultdict(list)
        for r in rd(gu_csv):
            if str(r["year"])[:4] in ("2023", "2024", "2025"):
                acc[r["code"]].append(float(r["fiscal_index"]))
        for c, vs in acc.items():
            if c not in fi and vs:
                fi[c] = round(sum(vs) / len(vs), 4); fi_unit[c] = "self"; fi_years[c] = "2023-2025 (KOSIS 자치구)"
        print(f"gu fiscal (KOSIS): {len(acc)} districts")

    # ── 기록: 국고지원 / 선포 / 우심피해 ──
    sub, dec = defaultdict(list), defaultdict(list)
    for r in rd(os.path.join(W, "subsidy_sgg_coded.csv")):
        c = r["code"]
        if not c:
            continue
        for t in expand(c):
            sub[t].append({"y": int(r["year"]), "p": r["event_period"], "ev": r["event_name"], "dmg_k": int(r["damage_thousand_krw"] or 0)})
    for r in rd(os.path.join(W, "declarations_coded.csv")):
        c = r["code"]
        if not c:
            continue
        for t in expand(c):
            dec[t].append({"y": int(r["year"]), "p": r["event_period"], "ev": r["event_name"], "date": r["declaration_date"], "emd": r["emd_or_blank"] or None})
    woo = json.load(open(os.path.join(ROOT, "data", "ref", "yearbook", "woosim_sgg.json"), encoding="utf-8"))
    ws = defaultdict(lambda: {"n": 0, "dmg_k": 0, "years": {}})
    for r in woo["rows"]:
        if r.get("level") != "sgg" or not r.get("code"):
            continue
        for t in expand(r["code"]):
            if r["year"] == "총괄":
                ws[t]["n"] = r["n"]
                ws[t]["dmg_k"] = r["dmg_k"]
            else:
                ws[t]["years"][r["year"]] = [r["n"], r["dmg_k"]]

    out = {}
    for c in codes:
        s = by_code.get(c, {})
        v = fi.get(c)
        b = band_of(v) if v is not None else None
        name = s.get("name", "")
        missing = None
        if v is None:
            if s.get("sido") in METRO and name.endswith("구"):
                missing = "gu"
            elif s.get("sido") == "50":
                missing = "jeju"
            else:
                missing = "unknown"
        out[c] = {
            "fi3": v, "fi_years": fi_years.get(c), "band": b,
            "thr": {"sub": bands[b]["sub"], "decl": bands[b]["decl"], "emd": bands[b]["emd"]} if b is not None else None,
            "fi_unit": fi_unit.get(c),
            "parent": (name.split("시")[0] + "시") if fi_unit.get(c) == "parent" else ("제주특별자치도" if c in ("50110", "50130") else None),
            "rec_unit": "parent" if (fi_unit.get(c) == "parent" or c in ("50110", "50130")) else "self",
            "fi_missing": missing,
            "records": {
                "subsidy": sorted(sub.get(c, []), key=lambda x: (x["y"], x["p"])),
                "decl": sorted(dec.get(c, []), key=lambda x: (x["y"], x["p"])),
                "woosim": ws.get(c),
            },
        }
    n_fi = sum(1 for x in out.values() if x["fi3"] is not None)
    meta = {
        "version": "thr-v1-" + date.today().isoformat(),
        "built": date.today().isoformat(),
        "rule": {
            "sub": "자연재난 구호 및 복구 비용 부담기준 등에 관한 규정 제5조①(금액 기준 시행 2024-11-19, 현행 개정 2025-11-27)",
            "decl": "재난 및 안전관리 기본법 시행령 제69조① (시군구 = 국고지원 기준의 2.5배, 읍면동 = 시군구 기준의 1/4)",
            "fi": "재정력지수 = 기준재정수입액 ÷ 기준재정수요액, 최근 3년 평균 (행정안전부 보통교부세 산정내역, 지방재정365)",
        },
        "bands": bands, "fiscal_year": FISCAL_YEAR, "fiscal_years_used": "2023-2025",
        "history": "재해연보 2012~2024 (국고지원·특별재난지역 선포), 2024 연보 4-4.6 우심피해 2015~2024",
        "n": len(out), "n_fiscal": n_fi,
        "n_subsidy_rows": sum(len(x["records"]["subsidy"]) for x in out.values()),
        "n_decl_rows": sum(len(x["records"]["decl"]) for x in out.values()),
        "caveats": [
            "문턱은 '피해액이 기준 이상이면 국고지원(우심) 대상'이라는 규정상 규칙이며 심사·판정이 아니다.",
            "문턱 산정 피해액은 농작물·동산·공장 등을 제외한 시설 피해액이다(규정 제5조). 카드의 우심피해 금액은 연보 인쇄값 그대로다.",
            "일반구가 있는 시(수원·창원 등)는 시 단위 값이 모든 구에 같이 붙는다(fi_unit=parent).",
            "광역시 자치구·제주(행정시)는 보통교부세 산정에 본청 합산이라 재정력지수를 아직 확보하지 못했다(KOSIS 시·구 재정력 표 확보 후 채움).",
            "국고지원·선포 기록은 재해연보에 인쇄된 사건만이며 예측이 아니다. 연보 판마다 표기가 다른 사례 6건은 원본 CSV note 참조.",
        ],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "sgg": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: n={len(out)} fiscal={n_fi} subsidy_rows={meta['n_subsidy_rows']} decl_rows={meta['n_decl_rows']} size={os.path.getsize(OUT) // 1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
