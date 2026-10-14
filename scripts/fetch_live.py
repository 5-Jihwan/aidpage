#!/usr/bin/env python3
"""Real-time data collector for disaster-compass (stdlib only).

Writes data/live/weather.json, data/live/alerts.json and data/live/air.json.
Every section degrades gracefully:
  - missing key      -> section status "no_key"
  - HTTP/parse error -> previous file's section is kept, status "error:<code>"
The script never raises; exit code is always 0.

Env:
  DATA_GO_KR_KEY   공공데이터포털 일반 인증키 (기상청 단기예보/특보, 산림청 산사태예측정보, 에어코리아 대기오염정보)
  SAFETYDATA_KEY   재난안전데이터공유플랫폼 (긴급재난문자 DSSP-IF-00247)
  HRFCO_KEY        한강홍수통제소 api.hrfco.go.kr
  SGG_INDEX        override path of sgg_index.json (testing)
  LIVE_MAX_CALLS   hard cap of outbound HTTP calls per run (default 560)
  LIVE_SKIP_VILAGE set to 1 to skip 단기예보 (TMX/TMN/POP) calls
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_common as lc  # noqa: E402
from live_common import *  # noqa: E402,F401,F403  — fetch_sd_live·fetch_sd_batch·test_egen_q가 여기서 이름을 가져간다
from live_alerts import *  # noqa: E402,F401,F403
from live_obs import *  # noqa: E402,F401,F403

ALERT_SECTIONS = ("warnings", "prewarn", "messages", "river", "landslide", "quake", "typhoon")


def keep_fresh_sections(alerts: dict, prev: dict) -> list[str]:
    """실패(error:*)한 섹션이 직전 ok 데이터를 덮지 않게 되돌린다. 되돌린 섹션 이름 목록을 돌려준다.
    화면 쪽 신선도 판정(3h)은 원래 updated 시각으로 그대로 이뤄지므로 오래된 데이터가 '최신'으로 보이진 않는다."""
    kept = []
    for k in ALERT_SECTIONS:
        cur, old = alerts.get(k) or {}, (prev or {}).get(k) or {}
        if not str(cur.get("status") or "").startswith("error") or str(old.get("status")) != "ok":
            continue
        if not (old.get("items") or old.get("text") or old.get("at") or old.get("updated")):
            continue
        alerts[k] = dict(old, last_error=cur.get("status"), last_error_at=alerts.get("updated"))
        kept.append(k)
        log(f"{k}: {cur.get('status')} → keeping previous ok data ({old.get('updated')})")
    return kept


# --------------------------------------------------------------------------- main
def main():
    log(f"keys present: datago={bool(KEY_KMA)} hub={bool(KEY_HUB)} safety={bool(KEY_SAFETY)} hrfco={bool(KEY_HRFCO)} taas={bool(os.environ.get('TAAS_API'))} "
        f"sd={{{','.join(k for k, v in SD_KEY.items() if v) or '-'}}}")
    sgg = load_json(SGG_INDEX, None)
    if not isinstance(sgg, list):
        log("sgg_index missing, using fixture")
        sgg = load_json(os.path.join(ROOT, "scripts", "fixtures", "sgg_index_sample.json"), [])
    prev_w = load_json(WEATHER_PATH, {})
    prev_a = load_json(ALERTS_PATH, {})
    prev_air = load_json(AIR_PATH, {})
    prev_er = load_json(ER_PATH, {})

    def safe(fn, *a):
        try:
            return fn(*a)
        except Exception as e:  # never crash the run
            log("unexpected", fn.__name__, repr(e))
            prev = a[-1] if a else {}
            return dict(prev if isinstance(prev, dict) else {}, status="error:exc")

    weather = safe(fetch_weather, sgg, prev_w)
    weather["hub"] = safe(fetch_hub_obs, (prev_w or {}).get("hub"))
    if not weather.get("by_sgg") and (weather["hub"] or {}).get("by_sido"):
        weather["status"] = "partial:sido"
    alerts = {
        "updated": now_kst().isoformat(timespec="seconds"),
        # safetydata 서비스키가 있으면 플랫폼 경로 우선 (data.go.kr/허브 403 우회)
        "warnings": safe(fetch_warnings_sd, sgg, prev_a.get("warnings")) if SD_KEY["warn"]
                    else safe(fetch_warnings, sgg, prev_a.get("warnings")),
        "prewarn": safe(fetch_prewarn_sd, prev_a.get("prewarn")) if SD_KEY["prewarn"]
                   else dict((prev_a.get("prewarn") or {}), status="no_key"),
        "messages": safe(fetch_messages, prev_a.get("messages")),
        "river": safe(fetch_river, prev_a.get("river")),
        "landslide": safe(fetch_landslide_sd, prev_a.get("landslide")) if (SD_KEY["ls_fcst"] or SD_KEY["ls_pred"])
                     else safe(fetch_landslide, sgg, prev_a.get("landslide")),
        "quake": safe(fetch_quake, prev_a.get("quake")),
        "typhoon": safe(fetch_typhoon, prev_a.get("typhoon")),
    }
    # 실패(error:*)한 섹션이 기존 ok 데이터를 덮지 않게 한다 — 로컬 수집기(fetch_sd_live.py)와 같은 규칙.
    # Actions는 safetydata IP 제한(sd32)으로 늘 실패하므로, 이 보호가 없으면 홈 PC가 올린 정상 특보를
    # 'error' 상태로 바꿔 화면이 '특보 정보 없음'으로 떨어진다(09-08 확인).
    keep_fresh_sections(alerts, prev_a)
    air = safe(fetch_air, sgg, prev_air)
    er = safe(fetch_er, sgg, prev_er)
    weather["calls"] = lc._calls
    air["calls"] = lc._calls
    statuses = [weather.get("status"), air.get("status"), er.get("status"), (weather.get("hub") or {}).get("status")] + [alerts[k].get("status") for k in ("warnings", "prewarn", "messages", "river", "landslide", "quake", "typhoon")]
    if all(st in ("no_key", "todo", None) for st in statuses) and os.path.exists(WEATHER_PATH):
        log("all sections no_key: leaving placeholder files untouched (no commit churn)")
    else:
        save_json(WEATHER_PATH, weather)
        save_json(ALERTS_PATH, alerts)
        save_json(AIR_PATH, air)
        if er.get("status") != "no_key":
            save_json(ER_PATH, er)

    # adaptive cadence flag: active 호우/태풍/대설 경보 -> data/live/.hot
    hot = any(i.get("level") == "경보" and i.get("type") in ("호우", "태풍", "대설")
              for i in (alerts["warnings"].get("items") or []))
    if hot:
        with open(HOT_FLAG, "w", encoding="utf-8") as f:
            f.write(alerts["updated"] + "\n")
    elif os.path.exists(HOT_FLAG):
        os.remove(HOT_FLAG)
    log(f"done calls={lc._calls} weather={weather['status']} warn={alerts['warnings'].get('status')} "
        f"prewarn={alerts['prewarn'].get('status')} ls={alerts['landslide'].get('status')} "
        f"msg={alerts['messages'].get('status')} river={alerts['river'].get('status')} "
        f"air={air.get('status')} hot={hot}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("fatal (suppressed)", repr(e))
    sys.exit(0)

