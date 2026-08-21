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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE_DIR = os.path.join(ROOT, "data", "live")
SGG_INDEX = os.environ.get("SGG_INDEX") or os.path.join(ROOT, "data", "admin", "sgg_index.json")
WEATHER_PATH = os.path.join(LIVE_DIR, "weather.json")
ALERTS_PATH = os.path.join(LIVE_DIR, "alerts.json")
AIR_PATH = os.path.join(LIVE_DIR, "air.json")
AIR_STATIONS_PATH = os.path.join(LIVE_DIR, "air_stations.json")
HOT_FLAG = os.path.join(LIVE_DIR, ".hot")

KST = timezone(timedelta(hours=9))
MAX_CALLS = int(os.environ.get("LIVE_MAX_CALLS", "560"))
TIMEOUT = 15

KEY_KMA = os.environ.get("DATA_GO_KR_KEY", "").strip()
KEY_SAFETY = os.environ.get("SAFETYDATA_KEY", "").strip()
KEY_HRFCO = os.environ.get("HRFCO_KEY", "").strip()

KMA_VILAGE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"
KMA_WARN = "https://apis.data.go.kr/1360000/WthrWrnInfoService"
SAFETY_MSG = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247"
HRFCO = "https://api.hrfco.go.kr"
KFS_LANDSLIDE = "https://apis.data.go.kr/1400000/predictionInfoService/predictionInfoList"
AIR_RLTM = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"
AIR_STN = "https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList"

_calls = 0


def now_kst() -> datetime:
    return datetime.now(KST)


def log(*a):
    print("[fetch_live]", *a, file=sys.stderr)


class HttpError(Exception):
    def __init__(self, code):
        super().__init__(str(code))
        self.code = str(code)


def http_get(url: str, params: dict | None = None, raw_key: str | None = None) -> str:
    """GET with call budget. raw_key is appended un-encoded (data.go.kr keys may be pre-encoded)."""
    global _calls
    if _calls >= MAX_CALLS:
        raise HttpError("budget")
    _calls += 1
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    if raw_key:
        # data.go.kr "Encoding" keys contain %2B etc. Use Decoding key if possible; we pass as-is.
        url = url + ("&" if "?" in url else "?") + "serviceKey=" + urllib.parse.quote(raw_key, safe="%")
    req = urllib.request.Request(url, headers={"User-Agent": "disaster-compass/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise HttpError(e.code)
    except urllib.error.URLError:
        raise HttpError("net")
    except Exception as e:  # timeouts etc.
        raise HttpError("timeout" if "timed out" in str(e) else "net")


def get_json(url, params=None, raw_key=None):
    txt = http_get(url, params, raw_key)
    try:
        return json.loads(txt)
    except ValueError:
        # data.go.kr returns XML error envelopes (e.g. 22 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS)
        m = re.search(r"<returnReasonCode>(\d+)</returnReasonCode>", txt)
        raise HttpError("kma" + m.group(1) if m else "badjson")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def fnum(v, default=None):
    try:
        x = float(v)
        return default if math.isnan(x) else x
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- 체감온도
def feels_like(t, reh, wsd, month):
    """Return (value, type).
    May-Sep: 기상청 2022 여름철 체감온도 (Steadman 기반, Stull 습구온도 Tw).
    Oct-Apr: 겨울철 체감온도 (JAG/TI wind chill, T<=10C and V>=1.3 m/s)."""
    if t is None:
        return None, None
    if 5 <= month <= 9:
        if reh is None:
            return None, None
        tw = (t * math.atan(0.151977 * math.sqrt(reh + 8.313659))
              + math.atan(t + reh) - math.atan(reh - 1.67633)
              + 0.00391838 * reh ** 1.5 * math.atan(0.023101 * reh) - 4.686035)
        v = -0.2442 + 0.55399 * tw + 0.45535 * t - 0.0022 * tw ** 2 + 0.00278 * tw * t + 3.0
        return round(v, 1), "heat"
    if wsd is None:
        return round(t, 1), "none"
    v_kmh = wsd * 3.6
    if t <= 10 and v_kmh >= 4.8:
        v = 13.12 + 0.6215 * t - 11.37 * v_kmh ** 0.16 + 0.3965 * t * v_kmh ** 0.16
        return round(v, 1), "windchill"
    return round(t, 1), "none"


# --------------------------------------------------------------------------- 1. 초단기실황 / 단기예보
def ncst_base(dt: datetime):
    """초단기실황 published ~HH:10; use previous hour when minute < 40."""
    if dt.minute < 40:
        dt = dt - timedelta(hours=1)
    return dt.strftime("%Y%m%d"), dt.strftime("%H00")


def vilage_base(dt: datetime):
    """단기예보 issued 02,05,...,23 at ~HH:10."""
    d = dt - timedelta(minutes=10)
    hours = [2, 5, 8, 11, 14, 17, 20, 23]
    h = max([x for x in hours if x <= d.hour], default=None)
    if h is None:
        d = d - timedelta(days=1)
        h = 23
    return d.strftime("%Y%m%d"), f"{h:02d}00"


def kma_items(data):
    resp = data.get("response", {})
    code = str(resp.get("header", {}).get("resultCode"))
    if code not in ("00", "0"):
        if code == "03":  # NO_DATA
            return []
        raise HttpError("kma" + code)
    items = resp.get("body", {}).get("items", {})
    if not items:
        return []
    items = items.get("item", [])
    return items if isinstance(items, list) else [items]


def fetch_weather(sgg, prev):
    out = {"updated": now_kst().isoformat(timespec="seconds"), "status": "ok",
           "base_time": None, "by_sgg": {}}
    if not KEY_KMA:
        out["status"] = "no_key"
        return out
    old = (prev or {}).get("by_sgg", {}) or {}
    now = now_kst()
    bd, bt = ncst_base(now)
    out["base_time"] = f"{bd[:4]}-{bd[4:6]}-{bd[6:]}T{bt[:2]}:00+09:00"
    vd, vt = vilage_base(now)
    skip_vilage = os.environ.get("LIVE_SKIP_VILAGE") == "1"
    month = now.month
    errors: dict[str, int] = {}
    new = {}
    cache_ncst, cache_vil = {}, {}
    stop = False
    for row in sgg:
        code = str(row["code"])
        nx, ny = row.get("nx"), row.get("ny")
        if nx is None or ny is None:
            continue
        if stop:
            if code in old:
                new[code] = old[code]
            continue
        key = (nx, ny)
        rec = {"t": None, "feels": None, "feels_type": None, "rn1": None, "reh": None,
               "wsd": None, "pty": None, "tmx": None, "tmn": None, "pop": None}
        try:
            if key not in cache_ncst:
                data = get_json(f"{KMA_VILAGE}/getUltraSrtNcst",
                                {"pageNo": 1, "numOfRows": 10, "dataType": "JSON",
                                 "base_date": bd, "base_time": bt, "nx": nx, "ny": ny}, KEY_KMA)
                cache_ncst[key] = {it["category"]: fnum(it.get("obsrValue")) for it in kma_items(data)}
            obs = cache_ncst[key]
            rec["t"] = obs.get("T1H")
            rec["rn1"] = obs.get("RN1")
            rec["reh"] = obs.get("REH")
            rec["wsd"] = obs.get("WSD")
            rec["pty"] = int(obs["PTY"]) if obs.get("PTY") is not None else None
            rec["feels"], rec["feels_type"] = feels_like(rec["t"], rec["reh"], rec["wsd"], month)
        except HttpError as e:
            errors[e.code] = errors.get(e.code, 0) + 1
            if code in old:
                new[code] = old[code]  # keep stale record
            if e.code == "budget" or e.code == "kma22":  # budget / quota exceeded -> stop hammering
                stop = True
            continue
        if not skip_vilage and _calls < MAX_CALLS - 20:
            try:
                if key not in cache_vil:
                    data = get_json(f"{KMA_VILAGE}/getVilageFcst",
                                    {"pageNo": 1, "numOfRows": 300, "dataType": "JSON",
                                     "base_date": vd, "base_time": vt, "nx": nx, "ny": ny}, KEY_KMA)
                    today = now.strftime("%Y%m%d")
                    hh = now.strftime("%H00")
                    v = {"tmx": None, "tmn": None, "pop": None}
                    for it in kma_items(data):
                        if it.get("fcstDate") != today:
                            continue
                        c, val = it.get("category"), it.get("fcstValue")
                        if c == "TMX":
                            v["tmx"] = fnum(val)
                        elif c == "TMN":
                            v["tmn"] = fnum(val)
                        elif c == "POP" and v["pop"] is None and str(it.get("fcstTime", "")) >= hh:
                            v["pop"] = fnum(val)
                    cache_vil[key] = v
                rec.update(cache_vil[key])
            except HttpError as e:
                k = "vilage:" + e.code
                errors[k] = errors.get(k, 0) + 1
                if e.code in ("kma22", "budget"):
                    skip_vilage = True
        new[code] = rec
    out["by_sgg"] = new
    if errors:
        worst = max(errors, key=errors.get)
        fresh = sum(1 for r in new.values() if r.get("t") is not None)
        out["status"] = ("partial:" if fresh else "error:") + worst.split(":")[-1]
        out["errors"] = errors
    return out


# --------------------------------------------------------------------------- 2. 기상특보
WARN_TYPES = ["폭풍해일", "호우", "태풍", "강풍", "대설", "한파", "폭염", "건조", "풍랑", "해일", "황사"]
_WARN_RE = re.compile(r"(" + "|".join(WARN_TYPES) + r")\s*(경보|주의보)\s*[:：]\s*([^\n\r]+)")


def match_area_codes(area_text, sgg):
    """Best-effort mapping of KMA area text (e.g. '서울', '경기도(수원, 성남)', '전북(진안)') to sgg codes."""
    codes = set()
    base = re.sub(r"\(.*?\)", "", area_text).strip()
    inner = " ".join(re.findall(r"\((.*?)\)", area_text))
    for row in sgg:
        sn, nm = row.get("sido_name", ""), row.get("name", "")
        sido_hit = bool(base) and (base in sn or sn[:2] == base[:2])
        if inner:
            if sido_hit and nm and nm.rstrip("시군구") in inner:
                codes.add(str(row["code"]))
        elif sido_hit:
            codes.add(str(row["code"]))
        elif nm and nm in area_text:
            codes.add(str(row["code"]))
    return sorted(codes)


def parse_warn_text(text, sgg, since):
    items = []
    for m in _WARN_RE.finditer(text or ""):
        typ, level, body = m.group(1), m.group(2), m.group(3).strip()
        # split on commas outside parentheses
        raw_areas = [a.strip() for a in re.split(r",(?![^()]*\))", body) if a.strip()]
        codes = set()
        for a in raw_areas:
            codes.update(match_area_codes(a, sgg))
        items.append({"type": typ, "level": level, "areas": raw_areas,
                      "area_codes": sorted(codes), "since": since, "raw": m.group(0).strip()})
    return items


def fmt_tm(s):
    s = str(s or "")
    if re.fullmatch(r"\d{12}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:]}+09:00"
    return s or None


def fetch_warnings(sgg, prev):
    sec = {"status": "ok", "items": [], "raw": None, "issued": None}
    if not KEY_KMA:
        sec["status"] = "no_key"
        return sec
    try:
        # 특보현황조회 (stnId 108 = 전국/기상청본청). Items carry free-text blocks t1..t7/other.
        data = get_json(f"{KMA_WARN}/getPwnStatus",
                        {"pageNo": 1, "numOfRows": 10, "dataType": "JSON", "stnId": 108}, KEY_KMA)
        its = kma_items(data)
        if not its:
            return sec  # no active warnings
        it = its[0]
        since = fmt_tm(it.get("tmFc"))
        sec["issued"] = since
        text = "\n".join(str(it.get(k) or "") for k in ("t1", "t2", "t3", "t4", "t5", "t6", "t7", "other"))
        sec["raw"] = text[:4000]
        sec["items"] = parse_warn_text(text, sgg, since)
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    return sec


# --------------------------------------------------------------------------- 3. 긴급재난문자
def fetch_messages(prev):
    sec = {"status": "ok", "items": []}
    if not KEY_SAFETY:
        sec["status"] = "no_key"
        return sec
    try:
        now = now_kst()
        since = now - timedelta(hours=24)
        items = []
        # crtDt = 조회시작일자 (YYYYMMDD); fetch from yesterday, filter last 24h locally.
        data = get_json(SAFETY_MSG, {"serviceKey": KEY_SAFETY, "returnType": "json",
                                     "pageNo": 1, "numOfRows": 400,
                                     "crtDt": since.strftime("%Y%m%d")})
        hdr = data.get("header", {})
        if str(hdr.get("resultCode", "00")) not in ("00", "0"):
            raise HttpError("sd" + str(hdr.get("resultCode")))
        for r in data.get("body") or []:
            t = str(r.get("CRT_DT") or "")
            ts = None
            for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                try:
                    ts = datetime.strptime(t[:19], fmt).replace(tzinfo=KST)
                    break
                except ValueError:
                    pass
            if ts and ts < since:
                continue
            items.append({"time": ts.isoformat(timespec="seconds") if ts else t,
                          "region": r.get("RCPTN_RGN_NM"), "text": r.get("MSG_CN"),
                          "type": r.get("DST_SE_NM"), "step": r.get("EMRG_STEP_NM"),
                          "id": r.get("SN")})
        seen, dedup = set(), []
        for it in sorted(items, key=lambda x: x["time"] or "", reverse=True):
            k = it.get("id") or (it["time"], it["text"])
            if k in seen:
                continue
            seen.add(k)
            dedup.append(it)
        sec["items"] = dedup[:200]
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    return sec


# --------------------------------------------------------------------------- 4. 하천 수위
def _rows(d):
    if isinstance(d, dict):
        for k in ("content", "list", "data", "items"):
            if k in d:
                return d[k] or []
    return d if isinstance(d, list) else []


def _g(r, *keys):
    for k in keys:
        for kk in (k, k.upper(), k.lower()):
            if kk in r and r[kk] not in ("", None):
                return r[kk]
    return None


def fetch_river(prev):
    sec = {"status": "ok", "items": []}
    if not KEY_HRFCO:
        sec["status"] = "no_key"
        return sec
    try:
        info = get_json(f"{HRFCO}/{KEY_HRFCO}/waterlevel/info.json")
        latest = get_json(f"{HRFCO}/{KEY_HRFCO}/waterlevel/list/10M.json")
        lv = {}
        for r in _rows(latest):
            c = str(_g(r, "wlobscd") or "")
            if c and (c not in lv or str(_g(r, "ymdhm")) > str(_g(lv[c], "ymdhm"))):
                lv[c] = r
        items = []
        for r in _rows(info):
            c = str(_g(r, "wlobscd") or "")
            if not c:
                continue
            d = lv.get(c, {})
            ymdhm = str(_g(d, "ymdhm") or "")
            t = (f"{ymdhm[:4]}-{ymdhm[4:6]}-{ymdhm[6:8]}T{ymdhm[8:10]}:{ymdhm[10:12]}+09:00"
                 if len(ymdhm) == 12 else None)
            attn, warn = fnum(_g(r, "attwl")), fnum(_g(r, "wrnwl"))
            level = fnum(_g(d, "wl"))
            if level is None or (attn is None and warn is None):
                continue  # keep only flood-relevant stations with a fresh reading
            items.append({"station": _g(r, "obsnm"), "code": c,
                          "lat": fnum(_g(r, "lat")), "lon": fnum(_g(r, "lon")),
                          "level_m": level, "attn": attn, "warn": warn,
                          "alarm": fnum(_g(r, "almwl")), "severe": fnum(_g(r, "srswl")),
                          "time": t, "agency": _g(r, "agcnm")})
        # stations closest to / above 주의 first; cap 300
        items.sort(key=lambda x: -(x["level_m"] / x["attn"]) if x["attn"] else 0)
        sec["total_stations"] = len(items)
        sec["items"] = items[:300]
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    return sec


# --------------------------------------------------------------------------- 5. 산사태
def fetch_landslide(sgg, prev):
    """산림청_산사태예측정보 (data.go.kr 15074800, needs its own 활용신청 on the same key).
    Endpoint verified on the portal page; response item field semantics are UNVERIFIED."""
    sec = {"status": "ok", "items": [], "source": "https://www.data.go.kr/data/15074800/openapi.do"}
    if not KEY_KMA:
        sec["status"] = "no_key"
        return sec
    try:
        data = get_json(KFS_LANDSLIDE, {"pageNo": 1, "numOfRows": 500, "_type": "json"}, KEY_KMA)
        resp = data.get("response", data)
        hdr = resp.get("header", {})
        if str(hdr.get("resultCode", "00")) not in ("00", "0"):
            raise HttpError("kfs" + str(hdr.get("resultCode")))
        its = resp.get("body", {}).get("items", {})
        its = its.get("item", its) if isinstance(its, dict) else its
        if isinstance(its, dict):
            its = [its]
        for r in its or []:
            name = str(r.get("sgg") or "")
            codes = [str(s["code"]) for s in sgg if s.get("name") and s["name"] in name]
            sec["items"].append({"level": r.get("lndslFrcstNm"), "area": name,
                                 "area_codes": codes, "time": r.get("prctnInfoAnlssDt")})
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
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


# --------------------------------------------------------------------------- main
def main():
    sgg = load_json(SGG_INDEX, None)
    if not isinstance(sgg, list):
        log("sgg_index missing, using fixture")
        sgg = load_json(os.path.join(ROOT, "scripts", "fixtures", "sgg_index_sample.json"), [])
    prev_w = load_json(WEATHER_PATH, {})
    prev_a = load_json(ALERTS_PATH, {})
    prev_air = load_json(AIR_PATH, {})

    def safe(fn, *a):
        try:
            return fn(*a)
        except Exception as e:  # never crash the run
            log("unexpected", fn.__name__, repr(e))
            prev = a[-1] if a else {}
            return dict(prev if isinstance(prev, dict) else {}, status="error:exc")

    weather = safe(fetch_weather, sgg, prev_w)
    alerts = {
        "updated": now_kst().isoformat(timespec="seconds"),
        "warnings": safe(fetch_warnings, sgg, prev_a.get("warnings")),
        "messages": safe(fetch_messages, prev_a.get("messages")),
        "river": safe(fetch_river, prev_a.get("river")),
        "landslide": safe(fetch_landslide, sgg, prev_a.get("landslide")),
    }
    air = safe(fetch_air, sgg, prev_air)
    weather["calls"] = _calls
    air["calls"] = _calls
    statuses = [weather.get("status"), air.get("status")] + [alerts[k].get("status") for k in ("warnings", "messages", "river", "landslide")]
    if all(st in ("no_key", "todo", None) for st in statuses) and os.path.exists(WEATHER_PATH):
        log("all sections no_key: leaving placeholder files untouched (no commit churn)")
    else:
        save_json(WEATHER_PATH, weather)
        save_json(ALERTS_PATH, alerts)
        save_json(AIR_PATH, air)

    # adaptive cadence flag: active 호우/태풍/대설 경보 -> data/live/.hot
    hot = any(i.get("level") == "경보" and i.get("type") in ("호우", "태풍", "대설")
              for i in (alerts["warnings"].get("items") or []))
    if hot:
        with open(HOT_FLAG, "w", encoding="utf-8") as f:
            f.write(alerts["updated"] + "\n")
    elif os.path.exists(HOT_FLAG):
        os.remove(HOT_FLAG)
    log(f"done calls={_calls} weather={weather['status']} warn={alerts['warnings'].get('status')} "
        f"msg={alerts['messages'].get('status')} river={alerts['river'].get('status')} "
        f"air={air.get('status')} hot={hot}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("fatal (suppressed)", repr(e))
    sys.exit(0)
