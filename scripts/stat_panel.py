"""AidPage 익명 사용 집계 → repo 패널 (data/stats/daily.csv).

워커 KV(stat:YYYY-MM-DD:이벤트, 400일)는 배포·삭제로 사라질 수 있어, daily.yml이 매일
`/stat/summary?days=N` 을 받아 날짜×이벤트 long 형식으로 누적한다. 같은 날짜·이벤트는 새 값으로
덮어쓴다(당일 카운트는 계속 늘므로 최근 며칠은 매번 갱신). 방문 합계(월·연·누적)는 visits.csv 에 1행/일.

개인정보 없음: 값은 정수 카운트뿐. 이벤트 sub_sido_NN 은 시·도 2자리 코드 단위.
연구 용도: 일별 방문·제출·깔때기(wiz_q2~q5, wiz_self/proxy, wiz_zero) 시계열. 재난문자·특보 발령일과
붙여 "정보 탐색 수요의 시차"를 보는 게 1차 용도(docs/23 §3).

사용: python scripts/stat_panel.py [--days 3] [--api URL]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "stats")
DAILY = os.path.join(OUT_DIR, "daily.csv")
VISITS = os.path.join(OUT_DIR, "visits.csv")
API = "https://safepic-api.safepic.workers.dev"


def fetch(api: str, days: int) -> dict:
    req = urllib.request.Request(f"{api}/stat/summary?days={days}", headers={"User-Agent": "aidpage-stat-panel"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def read_rows(path: str, key_cols: tuple[str, ...]) -> dict[tuple, dict]:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8", newline="") as f:
        return {tuple(row[k] for k in key_cols): row for row in csv.DictReader(f)}


def write_rows(path: str, cols: list[str], rows: dict[tuple, dict]) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for k in sorted(rows):
            w.writerow(rows[k])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--api", default=API)
    a = ap.parse_args()
    try:
        j = fetch(a.api, a.days)
    except Exception as e:  # noqa: BLE001
        print(f"::warning::stat summary unavailable: {e}")
        return 0
    if j.get("status") != "ok":
        print(f"::warning::stat summary status={j.get('status')}")
        return 0

    daily = read_rows(DAILY, ("date", "event"))
    n_new = 0
    for d, row in (j.get("days") or {}).items():
        for ev, n in row.items():
            k = (d, ev)
            if k not in daily or daily[k]["count"] != str(n):
                n_new += 1
            daily[k] = {"date": d, "event": ev, "count": str(int(n))}
    write_rows(DAILY, ["date", "event", "count"], daily)

    v = j.get("visits")
    if v:
        today = j.get("today") or ""
        visits = read_rows(VISITS, ("date",))
        visits[(today,)] = {"date": today, "today": str(v.get("today", 0)), "month": str(v.get("month", 0)), "year": str(v.get("year", 0)), "total": str(v.get("total", 0))}
        write_rows(VISITS, ["date", "today", "month", "year", "total"], visits)

    print(f"stat panel: {len(daily)} rows ({n_new} updated), visits total={v.get('total') if v else '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
