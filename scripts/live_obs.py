"""실시간 수집 — API허브 관측·지진·태풍·응급실(E-Gen)·미세먼지(fetch_live.py에서 분리)."""
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


import live_common as lc
from live_common import *  # noqa: F401,F403
from live_common import (_DEAD, _DEAD_WHY, _TMO, _base, _hub_raw, _hub_text, _note_slow)  # noqa: F401

# --------------------------------------------------------------------------- 4b. 기상청 API허브 — 종관관측(ASOS) 시간자료 → 시도 대표값, 지진통보
HUB_SFC = "https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php"
HUB_EQK = "https://apihub.kma.go.kr/api/typ01/url/eqk_now.php"
# 시도 → ASOS 대표 관측소 (기상청 공식 지점번호). 광주+전남 통합(12)은 광주 156.
ASOS_SIDO = {"11": (108, "서울"), "26": (159, "부산"), "27": (143, "대구"), "28": (112, "인천"), "12": (156, "광주"),
             "30": (133, "대전"), "31": (152, "울산"), "36": (239, "세종"), "41": (119, "수원"), "51": (101, "춘천"),
             "43": (131, "청주"), "44": (129, "서산"), "52": (146, "전주"), "47": (136, "안동"), "48": (155, "창원"), "50": (184, "제주")}


def _v(x, bad=(-9.0, -99.0, -999.0)):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if f in bad else f


def fetch_hub_obs(prev):
    """ASOS 96지점 시간자료(허브 kma_sfctm2) → 시도별 대표 관측값. 단기예보가 열리기 전의 폴백."""
    sec = {"status": "ok", "by_sido": {}, "source": "기상청 API허브 종관관측(ASOS) 시간자료", "updated": now_kst().isoformat(timespec="seconds")}
    if not KEY_HUB:
        sec["status"] = "no_key"
        return sec
    try:
        tm = (now_kst() - timedelta(minutes=70)).strftime("%Y%m%d%H") + "00"
        rows = _hub_text(HUB_SFC, {"tm": tm, "stn": 0, "help": 0})
        by_stn = {}
        for r in rows:
            if len(r) < 20:
                continue
            # cols: TM STN WD WS GST_WD GST_WS GST_TM PA PS PT PR TA TD HM PV RN RN_DAY ...
            by_stn[int(r[1])] = {"t": _v(r[11]), "reh": _v(r[13]), "wsd": _v(r[3]), "vec": (_v(r[2]) or 0) * 10, "rn1": _v(r[15]), "rn_day": _v(r[16]), "tm": r[0]}
        month = now_kst().month
        for sido, (stn, name) in ASOS_SIDO.items():
            o = by_stn.get(stn)
            if not o:
                continue
            o = dict(o, stn=stn, stn_name=name)
            if o["t"] is not None and o["reh"] is not None:
                fl = feels_like(o["t"], o["reh"], o["wsd"] or 0, month)
                o["feels"], o["feels_kind"] = (fl if isinstance(fl, tuple) else (fl, None))
            sec["by_sido"][sido] = o
        sec["base_time"] = f"{tm[:4]}-{tm[4:6]}-{tm[6:8]}T{tm[8:10]}:00+09:00"
        if not sec["by_sido"]:
            sec = dict(prev or {}, status="error:empty")
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    return sec


def fetch_quake(prev):
    """지진통보(허브 eqk_now): 최근 통보 목록 → 국내 규모 2.0 이상만."""
    sec = {"status": "ok", "items": [], "source": "기상청 API허브 지진통보", "updated": now_kst().isoformat(timespec="seconds")}
    if not KEY_HUB:
        sec["status"] = "no_key"
        return sec
    try:
        txt = _hub_raw(HUB_EQK, {})
        for ln in txt.splitlines():
            if not ln or ln.startswith("#"):
                continue
            p = ln.split(None, 7)
            if len(p) < 8:
                continue
            try:
                tp, tm_fc, seq, tm_eqk, mag, lat, lon = int(p[0]), p[1], p[2], p[3], float(p[4]), float(p[5]), float(p[6])
            except ValueError:
                continue
            rest = p[7].split(",")
            loc = rest[0].strip()
            domestic = 124.0 <= lon <= 132.5 and 33.0 <= lat <= 39.5
            if mag >= 2.0 and domestic:
                sec["items"].append({"type": tp, "announced": tm_fc, "at": tm_eqk[:14], "mag": mag, "lat": lat, "lon": lon, "loc": loc,
                                     "intensity": (rest[1].strip() if len(rest) > 1 else None)})
        sec["items"] = sec["items"][:10]
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    except Exception:  # noqa: BLE001  — 응답은 왔는데 형식이 다를 때만(네트워크·인증 오류는 위 HttpError)
        sec = dict(prev or {}, status="error:parse")
    return sec


HUB_TYP = "https://apihub.kma.go.kr/api/typ01/url/typ_now.php"


def fetch_typhoon(prev):
    """태풍정보+예측(허브 typ_now): 활성 태풍의 분석(FT=0)·예측(FT=1) 위치·반경. 없으면 items=[]."""
    sec = {"status": "ok", "items": [], "source": "기상청 API허브 태풍정보", "updated": now_kst().isoformat(timespec="seconds")}
    if not KEY_HUB:
        sec["status"] = "no_key"
        return sec
    try:
        rows = _hub_text(HUB_TYP, {"help": 0})
        by = {}
        for r in rows:
            if len(r) < 16:
                continue
            try:
                ft, yy, typ, seq, tmd = int(r[0]), int(r[1]), int(r[2]), int(r[3]), int(r[4])
                lat, lon = float(r[7]), float(r[8])
            except ValueError:
                continue
            key = f"{yy}-{typ:02d}"
            t = by.setdefault(key, {"year": yy, "no": typ, "seq": seq, "analysis": None, "forecast": []})
            pt = {"tmd": tmd, "tm": r[5], "ft_tm": r[6], "lat": lat, "lon": lon, "dir": r[9], "speed": _v(r[10]), "pressure": _v(r[11]),
                  "wind": _v(r[12]), "rad15": _v(r[13]), "rad25": _v(r[14]), "rad70": _v(r[15]) if len(r) > 15 else None}
            if ft == 0:
                t["analysis"] = pt
            else:
                t["forecast"].append(pt)
        for t in by.values():
            t["forecast"].sort(key=lambda p: p["tmd"])
            sec["items"].append(t)
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    except Exception:  # noqa: BLE001
        sec = dict(prev or {}, status="error:parse")
    return sec


# --------------------------------------------------------------------------- 5b. 응급실 실시간 가용병상 (E-Gen)
def egen_stage2(s):
    """E-Gen STAGE2(시군구) 조회어. 일반구는 모시 이름, 세종은 빈 문자열."""
    m = re.match(r"(.+?시).+구$", s["name"])
    if m:
        return m.group(1)
    return "" if str(s.get("sido")) == "36" else s["name"]


def fetch_er(sgg, prev):
    """중앙응급의료센터 E-Gen 응급실 실시간 가용병상 (data.go.kr B552657, 일 1,000건).
    자치단체 단위로 하루 3번(LIVE_ER_HOURS, KST)만 돌려 ~700건/일. 다른 시각엔 이전 파일 유지."""
    import xml.etree.ElementTree as ET
    sec = {"status": "ok", "by_sgg": {}, "source": "중앙응급의료센터 E-Gen", "updated": now_kst().isoformat(timespec="seconds")}
    if not KEY_KMA:
        sec["status"] = "no_key"
        return sec
    _n = now_kst()
    if isinstance(prev, dict) and prev.get("by_sgg"):
        try:
            _age_h = (_n - datetime.fromisoformat(str(prev.get("updated")))).total_seconds() / 3600
        except (TypeError, ValueError):
            _age_h = 1e9
        _gap = ER_GAP_H if str(prev.get("status", "ok")) == "ok" else min(ER_GAP_H, 1.0)  # 부분 수집이면 1시간 뒤 재시도
        if _age_h < _gap:  # 마지막 수집 후 간격 안이면 이전 파일 유지
            return dict(prev, status=prev.get("status", "ok"), skipped=f"fresh:{_age_h:.1f}h")
    # 250곳 순차 호출은 E-Gen이 느릴 때 15초 × 250 = 1시간이 되어 Actions 제한(15분)에 걸린다 →
    # 6개 동시 + 벽시계 예산(ER_BUDGET_S) 안에서만 수집, 못 받은 시군구는 이전 값을 유지(partial:time).
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    import time as _time

    # E-Gen은 자치단체 단위로만 조회된다. 일반구(수원시장안구 등 39곳)를 그대로 STAGE2에 넣으면 빈 응답이 와서
    # 그 39곳이 전부 조용히 비어 있었다(2026-09-28 확인: 응답 182/256, 일반구는 39곳 중 0곳). 모시 이름으로 한 번
    # 묻고 결과를 소속 구에 공유한다 — 교통 통계(build_social.py)와 같은 처리이고 호출도 26건 줄어든다.
    # 세종은 단층이라 STAGE2를 비운다. 조회어 규칙은 egen_stage2()에 있고 scripts/test_egen_q.py가 지킨다.
    groups = {}
    for s in sgg:
        groups.setdefault((s.get("sido_name", ""), egen_stage2(s)), []).append(str(s["code"]))

    def one(key):
        stage1, stage2 = key
        txt = http_get(EGEN_BEDS, {"STAGE1": stage1, "STAGE2": stage2, "pageNo": 1, "numOfRows": 30}, KEY_KMA)
        root = ET.fromstring(txt)
        code = root.findtext(".//resultCode")
        if code not in (None, "00"):
            raise HttpError("egen" + str(code))
        rows = []
        for it in root.iter("item"):
            g = lambda k: (it.findtext(k) or "").strip()
            rows.append({"id": g("hpid"), "name": g("dutyName"), "tel": g("dutyTel3") or g("dutyTel1"),
                         "beds": fnum(g("hvec")), "or": fnum(g("hvoc")), "ct": g("hvctayn") == "Y", "mri": g("hvmriayn") == "Y",
                         "icu": fnum(g("hvicc")), "at": g("hvidate")})
        return rows

    errs = 0; got = 0; empty = 0; budget_hit = False; deadline = _time.monotonic() + ER_BUDGET_S
    ex = ThreadPoolExecutor(max_workers=ER_WORKERS)
    futs = {ex.submit(one, k): k for k in groups}
    pending = set(futs)
    try:
        while pending:
            left = deadline - _time.monotonic()
            if left <= 0:
                sec["status"] = "partial:time"
                break
            done, pending = wait(pending, timeout=min(left, 5), return_when=FIRST_COMPLETED)
            for f in done:
                k = futs[f]
                try:
                    rows = f.result()
                    if rows:
                        for c in groups[k]:
                            sec["by_sgg"][c] = rows
                        got += len(groups[k])
                    else:
                        empty += 1  # 오류가 아니라 '해당 지역 결과 0건' — 조회어가 안 맞으면 여기로 샌다
                except HttpError as e:
                    errs += 1
                    if e.code == "budget":
                        budget_hit = True
                except Exception:  # 파싱 오류 등
                    errs += 1
            if budget_hit:
                sec["status"] = "partial:budget"
                break
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    if not sec["by_sgg"]:
        sec = dict(prev or {}, status="error:egen")
    else:
        if sec["status"].startswith("partial") and isinstance(prev, dict) and prev.get("by_sgg"):
            merged = dict(prev["by_sgg"]); merged.update(sec["by_sgg"]); sec["by_sgg"] = merged
            sec["fresh_sgg"] = got
        if errs:
            sec["errors"] = errs
        if empty:
            sec["empty_q"] = empty
    log(f"er: fetched={got}/{len(sgg)} queries={len(groups)} empty={empty} errors={errs} status={sec['status']}")
    return sec


# --------------------------------------------------------------------------- 6. 대기질 (에어코리아)
AIR_SIDOS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "경기", "강원", "충북", "충남",
             "전북", "전남", "경북", "경남", "제주", "세종"]
# 에어코리아 sidoName -> sgg_index sido code (2026-07 광주+전남 통합 = 12)
AIR_SIDO_CODE = {"서울": "11", "부산": "26", "대구": "27", "인천": "28", "광주": "12", "대전": "30",
                 "울산": "31", "세종": "36", "경기": "41", "강원": "51", "충북": "43", "충남": "44",
                 "전북": "52", "전남": "12", "경북": "47", "경남": "48", "제주": "50"}
AIR_STATIONS_MAX_AGE = timedelta(days=30)
GRADE_RANK = {None: -1, "좋음": 0, "보통": 1, "나쁨": 2, "매우나쁨": 3}


def air_items(data):
    resp = data.get("response", data)
    hdr = resp.get("header", {})
    code = str(hdr.get("resultCode", "00"))
    if code not in ("00", "0"):
        raise HttpError("air" + code)
    its = resp.get("body", {}).get("items", [])
    if isinstance(its, dict):
        its = its.get("item", [])
    return its if isinstance(its, list) else [its]


def air_val(v):
    """'-' / '' / None -> None, else float."""
    if v is None or str(v).strip() in ("", "-"):
        return None
    return fnum(v)


def grade_pm10(v):
    if v is None:
        return None
    return "좋음" if v <= 30 else "보통" if v <= 80 else "나쁨" if v <= 150 else "매우나쁨"


def grade_pm25(v):
    if v is None:
        return None
    return "좋음" if v <= 15 else "보통" if v <= 35 else "나쁨" if v <= 75 else "매우나쁨"


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    m = xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2
    return round(m, 3)


def _haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def _station_latlon(st):
    """dmX/dmY: WGS84 (dmX=위도, dmY=경도 per 에어코리아 문서); swap defensively if reversed."""
    x, y = fnum(st.get("dmX")), fnum(st.get("dmY"))
    if x is None or y is None:
        return None, None
    if 32 <= x <= 40 and 123 <= y <= 133:
        return x, y
    if 32 <= y <= 40 and 123 <= x <= 133:
        return y, x
    return None, None


def load_air_stations():
    """측정소 목록 (getMsrstnList) cached at data/live/air_stations.json, rebuilt if missing or >30 days.
    Returns {stationName: {"addr":..., "lat":..., "lon":...}} or None if unavailable."""
    cached = load_json(AIR_STATIONS_PATH, None)
    if isinstance(cached, dict) and cached.get("stations"):
        try:
            if now_kst() - datetime.fromisoformat(cached["fetched"]) < AIR_STATIONS_MAX_AGE:
                return cached["stations"]
        except (KeyError, ValueError, TypeError):
            pass
    stations, page = {}, 1
    try:
        while page <= 10:
            data = get_json(AIR_STN, {"returnType": "json", "numOfRows": 1000, "pageNo": page}, KEY_KMA)
            its = air_items(data)
            for it in its:
                name = str(it.get("stationName") or "").strip()
                if not name:
                    continue
                lat, lon = _station_latlon(it)
                stations[name] = {"addr": str(it.get("addr") or "").strip(), "lat": lat, "lon": lon}
            if len(its) < 1000:
                break
            page += 1
    except HttpError as e:
        log("air stations fetch failed", e.code)
        if isinstance(cached, dict) and cached.get("stations"):
            return cached["stations"]  # stale but usable
        return stations or None
    save_json(AIR_STATIONS_PATH, {"fetched": now_kst().isoformat(timespec="seconds"),
                                  "count": len(stations), "stations": stations})
    return stations


def match_station_sgg(addr, sido_code, sgg):
    """sgg (within sido_code) whose name appears in the station address; longest match wins."""
    rows = [r for r in sgg if str(r.get("sido")) == sido_code and r.get("name")]
    if len(rows) == 1:  # 세종 등 단일 시군구
        return str(rows[0]["code"])
    addr = re.sub(r"\s+", "", addr or "")  # sgg_index uses '수원시장안구'; addr has '수원시 장안구'
    best, best_len = None, 0
    for r in rows:
        nm = r["name"]
        if nm in addr and len(nm) > best_len:
            best, best_len = str(r["code"]), len(nm)
    if best is None:  # suffix-stripped retry (e.g. '고양시' vs addr '고양 덕양구')
        for r in rows:
            nm = r["name"].rstrip("시군구")
            if len(nm) >= 2 and nm in addr and len(nm) > best_len:
                best, best_len = str(r["code"]), len(nm)
    return best


def fetch_air(sgg, prev):
    """한국환경공단_에어코리아_대기오염정보 (data.go.kr 15073861): 시도별 실시간 측정정보 -> 시군구 집계.
    Shares DATA_GO_KR_KEY (needs its own 활용신청). Station list from 측정소정보 getMsrstnList."""
    out = {"updated": now_kst().isoformat(timespec="seconds"), "status": "ok",
           "data_time": None, "by_sgg": {},
           "source": "https://www.data.go.kr/data/15073861/openapi.do"}
    if not KEY_KMA:
        out["status"] = "no_key"
        return out
    stations = load_air_stations() or {}
    readings = {}  # stationName -> rec
    errors: dict[str, int] = {}
    unknown_sido = set()  # 매핑에 없는 시도명 — 조용히 폴백하면 시도 개편을 못 본다(scripts/check_regions.py)
    latest_time = None
    for sido in AIR_SIDOS:
        try:
            data = get_json(AIR_RLTM, {"returnType": "json", "numOfRows": 600, "pageNo": 1,
                                       "sidoName": sido, "ver": "1.3"}, KEY_KMA)
            for it in air_items(data):
                name = str(it.get("stationName") or "").strip()
                if not name:
                    continue
                pm10, pm25 = air_val(it.get("pm10Value")), air_val(it.get("pm25Value"))
                sido_nm = str(it.get("sidoName") or sido).strip()
                if sido_nm not in AIR_SIDO_CODE:
                    unknown_sido.add(sido_nm)
                rec = {"station": name, "sido_code": AIR_SIDO_CODE.get(sido_nm, AIR_SIDO_CODE[sido]),
                       "pm10": pm10, "pm25": pm25,
                       "o3": air_val(it.get("o3Value")), "khai": air_val(it.get("khaiValue")),
                       "grade_pm10": grade_pm10(pm10), "grade_pm25": grade_pm25(pm25),
                       "time": str(it.get("dataTime") or "")}
                readings[name] = rec
                if rec["time"] and (latest_time is None or rec["time"] > latest_time):
                    latest_time = rec["time"]
        except HttpError as e:
            errors[e.code] = errors.get(e.code, 0) + 1
            if e.code in ("budget", "kma22", "air22"):
                break
    if latest_time:
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})", latest_time)
        out["data_time"] = (f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}+09:00"
                            if m else latest_time)
    if unknown_sido:
        out["unknown_sido"] = sorted(unknown_sido)
    if not readings:
        res = dict(prev or {}, status="error:" + (max(errors, key=errors.get) if errors else "empty"))
        res["updated"] = out["updated"]
        if errors:
            res["errors"] = errors
        return res

    by_sgg_st: dict[str, list] = {}
    located = []  # (lat, lon, rec) for nearest-station fallback
    for name, rec in readings.items():
        st = stations.get(name) or {}
        code = match_station_sgg(st.get("addr", ""), rec["sido_code"], sgg)
        if code:
            by_sgg_st.setdefault(code, []).append(rec)
        if st.get("lat") is not None:
            located.append((st["lat"], st["lon"], rec))

    def aggregate(recs, nearest):
        recs = [r for r in recs if r["pm10"] is not None or r["pm25"] is not None] or recs
        g10 = max((r["grade_pm10"] for r in recs), key=lambda g: GRADE_RANK.get(g, -1), default=None)
        g25 = max((r["grade_pm25"] for r in recs), key=lambda g: GRADE_RANK.get(g, -1), default=None)
        return {"pm10": _median(r["pm10"] for r in recs), "pm25": _median(r["pm25"] for r in recs),
                "o3": _median(r["o3"] for r in recs), "khai": _median(r["khai"] for r in recs),
                "grade_pm10": g10, "grade_pm25": g25,
                "station": ",".join(r["station"] for r in recs), "nearest": nearest}

    new = {}
    for row in sgg:
        code = str(row["code"])
        if code in by_sgg_st:
            new[code] = aggregate(by_sgg_st[code], False)
            continue
        lat, lon = row.get("lat"), row.get("lon")
        if lat is None or lon is None or not located:
            continue
        best = min(located, key=lambda t: _haversine(lat, lon, t[0], t[1]))
        new[code] = aggregate([best[2]], True)
    out["by_sgg"] = new
    out["stations"] = len(readings)
    out["stations_located"] = len(located)
    if errors:
        out["status"] = "partial:" + max(errors, key=errors.get)
        out["errors"] = errors
    return out


