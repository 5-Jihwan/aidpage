"""재난안전데이터공유플랫폼 정적 데이터셋 전량 다운로드 (배치·수동 실행).

사용: python scripts/fetch_sd_batch.py <kind> [--rows 1000]
kind: flood | flood_depth | flood_line | flood_situ | riskzone | riskzone2 | ls_hist | warnzone
출력: data/ref/sd/<kind>.jsonl (한 행 = JSON 한 줄) + <kind>.meta.json
페이지 단위로 이어받기(.meta.json의 next_page부터 재개). 서비스키는 SD_KEY_* 환경변수.
로컬 실행 예: SD_KEY_FLOOD=... python scripts/fetch_sd_batch.py flood
"""
from __future__ import annotations

import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("LIVE_MAX_CALLS", "100000")  # 배치는 예산 제한 완화
from fetch_live import SD_API, SD_KEY, SD_SETS, get_json, HttpError, log  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "ref", "sd")


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in SD_SETS:
        print(__doc__)
        return 1
    kind = sys.argv[1]
    rows_per = int(sys.argv[sys.argv.index("--rows") + 1]) if "--rows" in sys.argv else 1000
    key = SD_KEY.get(kind)
    if not key:
        log(f"{SD_SETS[kind][1]} not set")
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{kind}.jsonl")
    meta_path = os.path.join(OUT_DIR, f"{kind}.meta.json")
    meta = {"next_page": 1, "total": None}
    if os.path.exists(meta_path):
        meta = json.load(io.open(meta_path, encoding="utf-8"))
    url = SD_API + SD_SETS[kind][0]
    page = int(meta.get("next_page") or 1)
    mode = "a" if page > 1 and os.path.exists(out_path) else "w"
    wrote = 0
    with io.open(out_path, mode, encoding="utf-8", newline="") as f:
        while True:
            try:
                data = get_json(url, {"serviceKey": key, "returnType": "json",
                                      "numOfRows": rows_per, "pageNo": page})
            except HttpError as e:
                log(f"page {page} error {e.code} — resume later from this page")
                break
            hdr = data.get("header", {})
            if str(hdr.get("resultCode", "00")) not in ("00", "0"):
                log(f"page {page} resultCode {hdr.get('resultCode')} — stop")
                break
            body = data.get("body") or []
            for k in ("totalCount", "totalCnt"):
                if data.get(k):
                    meta["total"] = int(data[k])
            if not body:
                meta["done"] = True
                log(f"{kind}: complete (total={meta.get('total')})")
                break
            for r in body:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            wrote += len(body)
            page += 1
            meta["next_page"] = page
            if meta.get("total") and wrote and page % 10 == 0:
                log(f"{kind}: page {page}, rows {wrote}/{meta['total']}")
            json.dump(meta, io.open(meta_path, "w", encoding="utf-8"))
            time.sleep(0.2)
    json.dump(meta, io.open(meta_path, "w", encoding="utf-8"))
    log(f"{kind}: wrote {wrote} rows this run → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
