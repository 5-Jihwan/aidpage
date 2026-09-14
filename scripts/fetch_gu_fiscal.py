"""광역시 자치구 재정력지수 수집(KOSIS OpenAPI) → .work_yearbook/fiscal/gu_fiscal_index.csv (docs/24 §5-5, §8-7).

왜 따로인가: 자치구는 보통교부세 산정에서 광역시 본청에 합산되므로 지방재정365 산정내역에 없다. 각 광역시가 조정교부금
산정용으로 만드는 '기준재정수요충족도(재정력지수)'를 KOSIS(시도 승인통계)에서 받는다.

사용: KOSIS_KEY=... python scripts/fetch_gu_fiscal.py
  - 키는 https://kosis.kr/openapi/ 에서 무료 발급(사용자 조치). 키가 없으면 아무 파일도 건드리지 않는다.
  - TABLES 의 서울 항목은 확인됨(DT_201004_O140019). 나머지 광역시는 KOSIS에서 표 ID를 찾아 채운다(항목명·분류 코드는 표마다 달라
    첫 실행 로그를 보고 COL 매핑을 조정).
출력 CSV 열: code, sido, name, year, fiscal_index, source  — build_threshold.py 가 있으면 읽어 3년 평균(2023~2025)으로 자치구 구간을 채운다.
"""
from __future__ import annotations

import csv
import json
import os
import sys
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".work_yearbook", "fiscal", "gu_fiscal_index.csv")
KEY = os.environ.get("KOSIS_KEY", "").strip()

# orgId: 201 서울 · 202 부산 · 203 대구 · 204 인천 · 205 광주 · 206 대전 · 207 울산 (KOSIS 기관코드 관례; 표 ID는 확인 후 기입)
TABLES = [
    {"sido": "11", "orgId": "201", "tblId": "DT_201004_O140019", "note": "서울 자치구 재정력지수(기준재정수요충족도) — 확인됨"},
    # {"sido": "26", "orgId": "202", "tblId": "", "note": "부산 — 표 ID 미확인"},
    # {"sido": "27", "orgId": "203", "tblId": "", "note": "대구"},
    # {"sido": "28", "orgId": "204", "tblId": "", "note": "인천"},
    # {"sido": "12", "orgId": "205", "tblId": "", "note": "광주(전남광주통합특별시 자치구)"},
    # {"sido": "30", "orgId": "206", "tblId": "", "note": "대전"},
    # {"sido": "31", "orgId": "207", "tblId": "", "note": "울산"},
]
YEARS = ("2021", "2025")


def kosis(params: dict) -> list:
    q = urllib.parse.urlencode({"method": "getList", "apiKey": KEY, "format": "json", "jsonVD": "Y", **params})
    req = urllib.request.Request("https://kosis.kr/openapi/Param/statisticsParameterData.do?" + q, headers={"User-Agent": "aidpage"})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.load(r)
    if isinstance(j, dict) and j.get("err"):
        raise RuntimeError(f"KOSIS err {j.get('err')}: {j.get('errMsg')}")
    return j


def main() -> int:
    if not KEY:
        print("KOSIS_KEY not set — nothing written (사용자: kosis.kr/openapi 키 발급 후 환경변수로 전달)")
        return 0
    idx = json.load(open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))
    by_name = {(s["sido"], s["name"]): str(s["code"]) for s in idx}
    rows = []
    for t in TABLES:
        if not t.get("tblId"):
            continue
        try:
            data = kosis({"orgId": t["orgId"], "tblId": t["tblId"], "itmId": "ALL", "objL1": "ALL", "prdSe": "Y", "startPrdDe": YEARS[0], "endPrdDe": YEARS[1]})
        except Exception as e:  # noqa: BLE001
            print(f"{t['note']}: {e}")
            continue
        print(f"{t['note']}: {len(data)} rows; sample keys {list(data[0].keys()) if data else '-'}")
        for d in data:
            name = (d.get("C1_NM") or "").strip()
            itm = (d.get("ITM_NM") or "").strip()
            if "재정력" not in itm and "충족도" not in itm:
                continue
            code = by_name.get((t["sido"], name))
            if not code:
                print("  unmatched:", name, itm)
                continue
            try:
                v = float(d.get("DT"))
            except (TypeError, ValueError):
                continue
            rows.append({"code": code, "sido": t["sido"], "name": name, "year": d.get("PRD_DE"), "fiscal_index": v, "source": f"KOSIS {t['orgId']}/{t['tblId']} {itm}"})
    if not rows:
        print("no rows — CSV untouched")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["code", "sido", "name", "year", "fiscal_index", "source"], lineterminator="\n")
        w.writeheader()
        for r in sorted(rows, key=lambda x: (x["code"], x["year"])):
            w.writerow(r)
    print(f"wrote {OUT}: {len(rows)} rows, {len({r['code'] for r in rows})} districts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
