"""AidPage — 행정안전부 통계연보 오픈API 수집기 (apis.data.go.kr/1741000/*).

목적: 시군구 유형화(docs/11)의 위해·제도·기관 렌즈 변수. 데이터셋별 요청주소는 공공데이터포털
'데이터 상세 → 상세기능 → 요청주소'에서 복사해 SERVICES에 넣는다(포털이 JS 렌더라 자동 추출 불가).
- 키: repo 루트 .keys.env.parsed 의 DATA_GO_KR_KEY 또는 DATA_WELFARE_KEY(계정 단위 공용 키). 로그에 키 값을 남기지 않는다.
- 저장: data/ref/yearbook/<key>.json = {updated, service, total, unit:'sido'|'sgg'|'unknown', region_field, rows:[...]}
  실패 시 기존 파일을 덮어쓰지 않는다(원자적 쓰기).
- 지역 단위 판정: 응답 레코드의 지역 필드 값이 시군구 인덱스(data/admin/sgg_index.json) 이름과 일치하면 'sgg',
  시도 이름만 보이면 'sido'. 통계연보 계열은 시도 단위인 경우가 많아(15077973·15077974 확인) 이 판정이 첫 호출의 핵심 목적이다.
- 사용법: python scripts/fetch_yearbook.py [service_key ...]   (인자 없으면 SERVICES 전부)
          python scripts/fetch_yearbook.py --probe   (첫 페이지만 받아 필드·단위만 출력, 저장 안 함)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "ref", "yearbook")
ROWS = 1000

# 요청주소(End Point)는 포털에서 복사. None이면 건너뛰고 로그로 알린다.
SERVICES: dict[str, dict] = {
    # 위해 — 지역별 자연재난 시설 피해(건물·선박·농경지·공공시설 피해액, 사망·실종) data.go.kr/data/15107320
    "facility_damage": {"id": "15107320", "url": "https://apis.data.go.kr/1741000/FacilityNaturalDisastersRegion/getFacilityNaturalDisastersRegion"},
    # 정책·재정 — 지역별 자연재해 복구비 재원(국고·지방비·융자·자부담·자력복구) data.go.kr/data/15107326
    "recovery_source": {"id": "15107326", "url": "https://apis.data.go.kr/1741000/RegionDisasterCostsFinances/getRegionDisasterCostsFinances"},
    # 위해(노출) — 연도별 위험개선지구·소규모공공시설 기준 인명피해 우려지역(승인 09-03) data.go.kr/data/15107182
    "risk_area_facility_year": {"id": "15107182", "url": "https://apis.data.go.kr/1741000/AreaWithRiskCasualtYearAf2017/getAreaWithRiskCasualtYearAf2017"},
    # 위해(노출) — 지역별 판(미신청) data.go.kr/data/15107564
    "risk_area_facility": {"id": "15107564", "url": None},
    # 위해(해안) — 지역별 하천 및 해안지역 인명피해 우려지역 data.go.kr/data/15107562
    "risk_area_river_coast": {"id": "15107562", "url": None},
    # 제도 — 특별재난지역 선포(자연재난) data.go.kr/data/15107314
    "special_zone": {"id": "15107314", "url": None},
    # 제도(예방투자) — 지역별 재해복구사업 data.go.kr/data/15107387 (검색 스니펫으로 확인된 요청주소)
    "recovery_project": {"id": "15107387", "url": "http://apis.data.go.kr/1741000/RegionDisasterRecoveryProject/getRegionDisasterRecoveryProject"},
    # 기관 — 지역별 주민대피시설(시도 단위 확인됨) data.go.kr/data/15077973
    "shelter_region": {"id": "15077973", "url": "https://apis.data.go.kr/1741000/AirRaidShelterRegion/getAirRaidShelterRegionList"},
    # 위해(폭염) — 지역별 폭염 인명피해(온열질환자, 시도 단위 확인됨) data.go.kr/data/15077974
    "heat_casualty": {"id": "15077974", "url": "https://apis.data.go.kr/1741000/HeatWaveCasualtiesRegion/getHeatWaveCasualtiesRegionList"},
}


def log(msg: str) -> None:
    print(f"[yearbook] {msg}", flush=True)


def load_keys() -> str:
    p = os.path.join(ROOT, ".keys.env.parsed")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    for name in ("DATA_GO_KR_KEY", "DATA_WELFARE_KEY"):
        if os.environ.get(name, "").strip():
            log(f"using {name}")
            return os.environ[name].strip()
    return ""


def fetch(url: str, key: str, page: int) -> tuple[list[dict], int]:
    """한 페이지. XML(<item>) 또는 JSON 응답 모두 처리. 반환 (rows, totalCount)."""
    q = {"serviceKey": key, "pageNo": page, "numOfRows": ROWS, "type": "json"}
    full = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(q, safe="")
    req = urllib.request.Request(full, headers={"User-Agent": "aidpage-yearbook"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    if body.lstrip().startswith("{"):
        d = json.loads(body)
        # 행안부 통계연보 봉투: {"<ServiceName>":[{"head":[{"totalCount":n},{...},{"RESULT":{"resultCode":"INFO-0",...}}]},{"row":[...]}]}
        # 그 외 data.go.kr 표준 봉투(response.body.items.item)도 함께 처리한다.
        rows, total, code, msg = [], None, "", ""
        def walk(o):
            nonlocal rows, total, code, msg
            if isinstance(o, dict):
                for k, v in o.items():
                    if k == "row" and isinstance(v, list): rows = v
                    elif k == "item": rows = v if isinstance(v, list) else [v]
                    elif k == "totalCount": total = int(v)
                    elif k == "resultCode": code = str(v)
                    elif k == "resultMsg": msg = str(v)
                    else: walk(v)
            elif isinstance(o, list):
                for x in o: walk(x)
        walk(d)
        if code and code not in ("00", "0", "200", "INFO-0", "INFO-000"):
            raise RuntimeError(f"resultCode {code}: {msg}")
        return rows, (total if total is not None else len(rows))
    root = ET.fromstring(body)
    code = (root.findtext(".//resultCode") or "").strip()
    if code and code not in ("00", "0", "200", "INFO-0", "INFO-000"):
        raise RuntimeError(f"resultCode {code}: {root.findtext('.//resultMsg') or root.findtext('.//returnAuthMsg') or ''}")
    rows = [{c.tag: (c.text or "").strip() for c in it} for it in list(root.iter("row")) + list(root.iter("item"))]
    total = int(root.findtext(".//totalCount") or len(rows))
    return rows, total


def detect_unit(rows: list[dict]) -> tuple[str, str]:
    """지역 필드와 단위 추정. 시군구 인덱스 이름과 맞는 값이 있으면 sgg."""
    if not rows:
        return "unknown", ""
    idx = json.load(open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))
    sgg_names = {s["name"] for s in idx} | {s["name"].replace("특별자치", "") for s in idx}
    sido_short = {"서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"}
    best_field, best_unit, best_hits = "", "unknown", 0
    for f in rows[0].keys():
        vals = {str(r.get(f, "")).strip() for r in rows}
        hits_sgg = sum(1 for v in vals if v in sgg_names or any(v.endswith(n) for n in sgg_names if len(n) >= 3))
        hits_sido = sum(1 for v in vals if any(v.startswith(s) for s in sido_short))
        if hits_sgg > best_hits and hits_sgg >= 3:
            best_field, best_unit, best_hits = f, "sgg", hits_sgg
        elif hits_sido > best_hits and best_unit != "sgg" and hits_sido >= 3:
            best_field, best_unit, best_hits = f, "sido", hits_sido
    return best_unit, best_field


def run(name: str, svc: dict, key: str, probe: bool) -> None:
    if not svc.get("url"):
        log(f"{name}: 요청주소 미설정 — 포털(data.go.kr/data/{svc['id']}/openapi.do) 상세기능에서 복사해 SERVICES에 넣으세요")
        return
    try:
        rows, total = fetch(svc["url"], key, 1)
    except urllib.error.HTTPError as e:
        log(f"{name}: HTTP {e.code} — 활용신청 미승인이거나 요청주소 오류일 수 있음"); return
    except Exception as e:  # noqa: BLE001
        log(f"{name}: {str(e)[:160]}"); return
    unit, field = detect_unit(rows)
    log(f"{name}: page1 rows={len(rows)} total={total} fields={list(rows[0].keys())[:14] if rows else []} unit={unit} region_field={field or '-'}")
    if probe or not rows:
        if rows:
            log(f"{name}: sample={json.dumps(rows[0], ensure_ascii=False)[:300]}")
        return
    page = 2
    while len(rows) < total and page <= 200:
        more, _ = fetch(svc["url"], key, page)
        if not more:
            break
        rows.extend(more); page += 1
    os.makedirs(OUT_DIR, exist_ok=True)
    out = {"updated": datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds"), "service": name, "dataset_id": svc["id"],
           "source": "행정안전부 행정안전통계연보 오픈API(공공데이터포털)", "url": svc["url"], "total": total, "unit": unit, "region_field": field, "rows": rows}
    path = os.path.join(OUT_DIR, f"{name}.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    log(f"{name}: wrote {path} rows={len(rows)} ({os.path.getsize(path)//1024} KB)")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    probe = "--probe" in sys.argv
    key = load_keys()
    if not key:
        log("DATA_GO_KR_KEY/DATA_WELFARE_KEY 없음 — 종료(파일 안 건드림)"); return 0
    for name, svc in SERVICES.items():
        if args and name not in args:
            continue
        run(name, svc, key, probe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
