"""AidPage — 중앙부처 복지서비스 목록 스냅샷 (한국사회보장정보원, odcloud 15083323).

- 2026-09-01 전환: 예전 실시간 API(B554287 NationalWelfarelistV001)는 활용신청이
  안 된 서비스라 코드 30(미등록 키)만 돌려줬다. 실제 승인된 건 odcloud 파일기반
  API(namespace 15083323)로, 연 1~2회 갱신되는 스냅샷(현재 2025-07-22, 367건).
- 스냅샷 uddi가 갱신될 때마다 바뀌므로 swagger 문서에서 최신본을 자동 탐색하고,
  문서 접속 실패 시 마지막으로 확인된 uddi로 폴백한다.
- DATA_WELFARE_KEY 없으면 아무 파일도 건드리지 않고 종료한다. 키는 로그에 남기지 않는다.
- 전 페이지 순회해 data/ref/welfare.json 저장. 실패 시 기존 파일을 덮어쓰지 않는다.
- 실행 주체는 로컬 수집기(fetch_sd_live.maybe_welfare) 단독 — daily.yml의 해외
  러너는 data.go.kr 접속이 자주 매달려 08-31에 이관했다(odcloud도 동일 계열 인프라).
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "ref", "welfare.json")
# 계정 공용 키 폴백 유지 (data.go.kr 인증키는 계정 단위).
KEYS = [(n, os.environ.get(n, "").strip()) for n in ("DATA_WELFARE_KEY", "DATA_GO_KR_KEY")]
KEYS = [(n, k) for n, k in KEYS if k]
BASE = "https://api.odcloud.kr/api"
SWAGGER = "https://infuser.odcloud.kr/oas/docs?namespace=15083323/v1"
# 2026-09-01 확인 최신(중앙부처 복지서비스_20250722) — swagger 탐색 실패 시 폴백
FALLBACK_PATH = "/15083323/v1/uddi:3929b807-3420-44d7-a851-cc741fce65a1"
ROWS = 100


def log(msg: str) -> None:
    print(f"[fetch_welfare] {msg}", flush=True)


def _open(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "aidpage-daily"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300] if e.fp else ""
        raise RuntimeError(f"HTTP {e.code}: {detail}") from None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise RuntimeError(f"net: {getattr(e, 'reason', e)}") from None


def latest_path() -> str:
    """swagger 문서에서 summary 끝의 _YYYYMMDD가 가장 큰 스냅샷 경로를 고른다."""
    try:
        doc = json.loads(_open(SWAGGER))
        best: tuple[str, str] | None = None
        for path, ops in doc.get("paths", {}).items():
            summary = (ops.get("get") or {}).get("summary", "")
            m = re.search(r"_(\d{8})$", summary)
            stamp = m.group(1) if m else "00000000"
            if best is None or stamp > best[0]:
                best = (stamp, path)
        if best and best[0] != "00000000":
            log(f"snapshot {best[0]} selected")
            return best[1]
    except (RuntimeError, ValueError) as e:
        log(f"swagger lookup failed ({str(e)[:120]}) — using fallback path")
    return FALLBACK_PATH


def fetch_page(path: str, page: int) -> dict:
    tail = f"?page={page}&perPage={ROWS}"
    last: RuntimeError | None = None
    for name, raw in KEYS:
        # 포털이 인코딩된 키를 주는 경우가 있어 변형도 시도. 키 값은 절대 로그에 남기지 않는다.
        for key in dict.fromkeys([raw, urllib.parse.unquote(raw), urllib.parse.quote(raw, safe="")]):
            try:
                body = _open(f"{BASE}{path}{tail}&serviceKey={key}")
                doc = json.loads(body)
                if "data" not in doc:  # 인증은 통과했지만 봉투가 다르면 사유를 남긴다
                    raise RuntimeError(f"no data field: {body[:160]}")
                if page == 1:
                    log(f"key {name} accepted")
                return doc
            except (RuntimeError, ValueError) as e:
                last = e if isinstance(e, RuntimeError) else RuntimeError(str(e)[:200])
        if page == 1:
            log(f"key {name} rejected: {str(last)[:200]}")
    raise last or RuntimeError("no usable key")


def main() -> int:
    if not KEYS:
        log("DATA_WELFARE_KEY/DATA_GO_KR_KEY not set — skipping (no files touched)")
        return 0
    path = latest_path()
    doc1 = fetch_page(path, 1)
    total = int(doc1.get("totalCount", 0))
    pages = max(1, -(-total // ROWS))
    log(f"total={total} pages={pages}")

    items: list[dict] = list(doc1["data"])
    for p in range(2, pages + 1):
        items.extend(fetch_page(path, p)["data"])
    if not items:
        raise RuntimeError("0 items — not overwriting")

    from datetime import datetime, timedelta, timezone
    out = {
        "updated": datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds"),
        "source": "한국사회보장정보원 복지서비스정보(중앙부처) · 공공데이터포털",
        "total": total,
        "items": items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # 원자적 쓰기 — 중간에 죽으면 깨진 JSON이 자동 커밋·배포될 수 있다 (수집기 --push 경로)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT} items={len(items)} keys(sample)={sorted(items[0])[:12]}")
    report_translation_gap(items)
    return 0


# js/app.js의 WF_BASE·WF_HH·WF_FR·WF_REGION과 같은 키워드 집합 — 화면에 올라올 수 있는 항목만 번역 대상이다.
PICK_KW = ["재난", "재해", "풍수해", "이재민", "긴급", "위기", "기초생활", "수급", "저소득", "차상위", "한부모", "조손",
           "노인", "어르신", "고령", "장애", "농업", "어업", "어촌", "농어촌", "도서", "독거", "돌봄", "응급안전",
           "외국인", "다문화", "결혼이민", "통번역"]


def report_translation_gap(items: list[dict]) -> None:
    """스냅샷이 갱신되면 신규 서비스가 영문 참고번역(welfare_en.json) 없이 올라올 수 있다.
    누락을 로그로만 알린다(번역 파일은 손으로 관리 — 자동 생성·지어내기 금지)."""
    en_path = os.path.join(ROOT, "data", "ref", "welfare_en.json")
    try:
        en = json.load(open(en_path, encoding="utf-8")).get("items", {})
    except (OSError, ValueError):
        log("welfare_en.json unreadable — translation gap check skipped")
        return
    need = [it for it in items if any(k in (it.get("서비스명") or "") or k in (it.get("서비스요약") or "") for k in PICK_KW)]
    miss = [it for it in need if it.get("서비스아이디") not in en]
    msg = f"translation coverage: {len(need) - len(miss)}/{len(need)} pickable items have EN text"
    if miss:
        msg += "; missing: " + ", ".join(f"{m.get('서비스아이디') or ''} {m.get('서비스명') or ''}" for m in miss[:10])
    log(msg)


if __name__ == "__main__":
    sys.exit(main())
