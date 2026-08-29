"""AidPage — 중앙부처 복지서비스 목록 스냅샷 (한국사회보장정보원, data.go.kr B554287).

- DATA_WELFARE_KEY 없으면 아무 파일도 건드리지 않고 종료한다.
- 목록 API를 전 페이지 순회해 data/ref/welfare.json 으로 저장한다.
- 응답은 XML이며, 스키마 확정 전이므로 servList의 자식 태그를 전부 dict로 보존한다
  (프런트가 쓰는 필드만 나중에 슬림화). 실패 시 기존 파일을 덮어쓰지 않는다.
- 일 1회(daily.yml)로 충분한 데이터: 복지 서비스 목록은 분 단위로 변하지 않는다.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "ref", "welfare.json")
KEY = os.environ.get("DATA_WELFARE_KEY", "").strip()
API = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001"
ROWS = 100


def log(msg: str) -> None:
    print(f"[fetch_welfare] {msg}", flush=True)


def fetch_page(page: int) -> ET.Element:
    q = urllib.parse.urlencode({
        "serviceKey": KEY, "callTp": "L", "pageNo": page, "numOfRows": ROWS,
        "srchKeyCode": "001",  # 001=서비스명+내용 전체 검색(키워드 없음 → 전체 목록)
    })
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "aidpage-daily"})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read().decode("utf-8", "replace")
    if body.lstrip().startswith("{"):
        raise RuntimeError(f"unexpected JSON response: {body[:160]}")
    root = ET.fromstring(body)
    # data.go.kr 공통 오류 봉투(OpenAPI_ServiceResponse)면 코드가 있다
    err = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg")
    code = root.findtext(".//returnReasonCode") or root.findtext(".//resultCode")
    if err and (code or "00") not in ("00", "0", "INFO-00", "0000"):
        raise RuntimeError(f"api error {code}: {err}")
    return root


def main() -> int:
    if not KEY:
        log("DATA_WELFARE_KEY not set — skipping (no files touched)")
        return 0
    root = fetch_page(1)
    total_t = root.findtext(".//totalCount")
    if total_t is None:
        # 스키마 표류 감지용: 최상위 구조를 남긴다
        tags = sorted({el.tag for el in root.iter()})[:25]
        raise RuntimeError(f"totalCount missing — schema? tags={tags}")
    total = int(total_t)
    pages = max(1, -(-total // ROWS))
    log(f"total={total} pages={pages}")

    items: list[dict] = []
    for p in range(1, pages + 1):
        r = root if p == 1 else fetch_page(p)
        for sl in r.iter("servList"):
            items.append({c.tag: (c.text or "").strip() for c in sl})
    if not items:
        raise RuntimeError("0 items parsed — schema drift? not overwriting")

    from datetime import datetime, timedelta, timezone
    doc = {
        "updated": datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds"),
        "source": "한국사회보장정보원 중앙부처복지서비스 · 공공데이터포털",
        "total": total,
        "items": items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {OUT} items={len(items)} keys(sample)={sorted(items[0])[:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
