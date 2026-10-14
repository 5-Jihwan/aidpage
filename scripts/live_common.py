"""실시간 수집 공통 — 설정·키·HTTP(호출 예산 _calls, 죽은 서비스 _DEAD)·JSON 입출력·체감온도(fetch_live.py에서 분리, 10-14 500줄 규칙).
_calls는 이 모듈 전역 하나뿐 — 다른 모듈은 lc._calls로 읽고 쓴다."""
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
ER_PATH = os.path.join(LIVE_DIR, "er.json")
AIR_STATIONS_PATH = os.path.join(LIVE_DIR, "air_stations.json")
HOT_FLAG = os.path.join(LIVE_DIR, ".hot")

KST = timezone(timedelta(hours=9))
MAX_CALLS = int(os.environ.get("LIVE_MAX_CALLS", "560"))
TIMEOUT = 15

KEY_KMA = os.environ.get("DATA_GO_KR_KEY", "").strip()
KEY_HUB = os.environ.get("KMA_APIHUB_KEY", "").strip()  # 기상청 API허브 — data.go.kr이 403이면 같은 서비스의 허브 판으로 재시도
KEY_SAFETY = os.environ.get("SAFETYDATA_KEY", "").strip()
KEY_HRFCO = os.environ.get("HRFCO_KEY", "").strip()

# 재난안전데이터공유플랫폼 — 데이터셋별 서비스키(활용신청 건별 발급) + IF 코드
SD_API = "https://www.safetydata.go.kr/V2/api/"
SD_SETS = {  # kind: (IF코드, 환경변수)
    "warn": ("DSSP-IF-00045", "SD_KEY_WARN"),            # 기상청_특보통보문
    "prewarn": ("DSSP-IF-00048", "SD_KEY_PREWARN"),      # 기상청_예비특보
    "warnzone": ("DSSP-IF-10144", "SD_KEY_WARNZONE"),    # 기상특보지역
    "ls_pred": ("DSSP-IF-00735", "SD_KEY_LS_PRED"),      # 산림청_산사태_예측정보
    "ls_fcst": ("DSSP-IF-00734", "SD_KEY_LS_FCST"),      # 산림청_산사태_예보정보
    "ls_hist": ("DSSP-IF-00134", "SD_KEY_LS_HIST"),      # 산사태_발생이력 (배치)
    "flood": ("DSSP-IF-00117", "SD_KEY_FLOOD"),          # 침수흔적도 (배치)
    "flood_depth": ("DSSP-IF-20678", "SD_KEY_FLOOD_DEPTH"),
    "flood_line": ("DSSP-IF-20679", "SD_KEY_FLOOD_LINE"),
    "flood_situ": ("DSSP-IF-10928", "SD_KEY_FLOOD_SITU"),
    "riskzone": ("DSSP-IF-00058", "SD_KEY_RISKZONE"),    # 지역_재해위험지구 (배치)
    "riskzone2": ("DSSP-IF-10075", "SD_KEY_RISKZONE2"),
}
SD_KEY = {k: os.environ.get(env, "").strip() for k, (_, env) in SD_SETS.items()}

KMA_VILAGE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"
KMA_WARN = "https://apis.data.go.kr/1360000/WthrWrnInfoService"
SAFETY_MSG = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247"
HRFCO = "https://api.hrfco.go.kr"
KFS_LANDSLIDE = "https://apis.data.go.kr/1400000/predictionInfoService/predictionInfoList"
AIR_RLTM = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty"
AIR_STN = "https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList"
EGEN_BEDS = "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire"
ER_HOURS = {int(h) for h in os.environ.get("LIVE_ER_HOURS", "6,14,22").split(",") if h.strip().isdigit()}
# E-Gen 재수집 최소 간격(시간). GitHub 크론이 2~5시간 간격으로 불규칙하게 돌아 시각 슬롯(ER_HOURS)을
# 며칠씩 못 맞추는 일이 있었다(09-02~09-08 정체) → 마지막 갱신 후 이 시간이 지났으면 어느 실행에서든 수집.
# 7h → 하루 최대 3회 × 250 시군구 = 750건 (일 한도 1,000).
ER_GAP_H = float(os.environ.get("LIVE_ER_GAP_H", "7"))
ER_BUDGET_S = float(os.environ.get("LIVE_ER_BUDGET_S", "300"))   # E-Gen 수집 벽시계 예산(초)
ER_WORKERS = int(os.environ.get("LIVE_ER_WORKERS", "6"))

_calls = 0


def now_kst() -> datetime:
    return datetime.now(KST)


def log(*a):
    print("[fetch_live]", *a, file=sys.stderr)


class HttpError(Exception):
    def __init__(self, code):
        super().__init__(str(code))
        self.code = str(code)


_DEAD = set()  # service base URLs that answered 403/401 (or kept timing out) this run — skip without spending call budget


def _base(url):
    return url.rsplit("/", 1)[0]


def http_get(url: str, params: dict | None = None, raw_key: str | None = None) -> str:
    """GET with call budget. raw_key is appended un-encoded (data.go.kr keys may be pre-encoded)."""
    global _calls
    base = _base(url)
    if base in _DEAD:  # 403/연속 시간초과로 죽은 서비스 — 예산도 시간도 쓰지 않는다
        raise HttpError(_DEAD_WHY.get(base, "403"))
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
            _TMO.pop(base, None)
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise HttpError(e.code)
    except urllib.error.URLError as e:
        _note_slow(base, "timed out" in str(e))
        raise HttpError("timeout" if "timed out" in str(e) else "net")
    except Exception as e:  # timeouts etc.
        _note_slow(base, "timed out" in str(e))
        raise HttpError("timeout" if "timed out" in str(e) else "net")


_TMO: dict[str, int] = {}          # service base → consecutive timeouts this run
_DEAD_WHY: dict[str, str] = {}     # service base → error code to report while dead
DEAD_AFTER_TIMEOUTS = int(os.environ.get("LIVE_DEAD_AFTER_TIMEOUTS", "3"))


def _note_slow(base: str, timed_out: bool):
    """포털이 403 대신 무응답으로 늘어지면 256개 시군구 × 15초 = 1시간이 되어 Actions 15분 제한에 걸리고
    그 실행은 아무것도 저장하지 못한다(09-03~09-08 취소 7회). 같은 서비스가 연속 3회 시간초과면 이번 실행에선 건너뛴다."""
    if not timed_out:
        return
    _TMO[base] = _TMO.get(base, 0) + 1
    if _TMO[base] >= DEAD_AFTER_TIMEOUTS and base not in _DEAD:
        _DEAD.add(base); _DEAD_WHY[base] = "timeout"
        log(f"circuit open: {base} timed out {DEAD_AFTER_TIMEOUTS}x in a row — skipping for this run")


HUB_MAP = {  # data.go.kr 경로 → API허브 typ02 경로 (응답 형식 동일, 인증은 authKey)
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0": "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0",
    "https://apis.data.go.kr/1360000/WthrWrnInfoService": "https://apihub.kma.go.kr/api/typ02/openApi/WthrWrnInfoService",
}


def get_json(url, params=None, raw_key=None):
    if _base(url) in _DEAD:
        raise HttpError(_DEAD_WHY.get(_base(url), "403"))
    try:
        txt = http_get(url, params, raw_key)
    except HttpError as e:
        hub = next((url.replace(k, v) for k, v in HUB_MAP.items() if url.startswith(k)), None)
        if hub and KEY_HUB and e.code in ("403", "401", "kma30", "kma31", "kma32") and _base(hub) not in _DEAD:
            try:
                txt = http_get(hub, dict(params or {}, authKey=KEY_HUB))
            except HttpError as e2:
                if e2.code in ("403", "401"):
                    _DEAD.add(_base(hub)); _DEAD.add(_base(url))
                raise
        else:
            if e.code in ("403", "401"):
                _DEAD.add(_base(url))
            raise
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


def iint(v, default=None):
    f = fnum(v)
    return default if f is None else int(f)


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



def _hub_text(url, params):
    """API허브 typ01 텍스트(EUC-KR) — '#' 주석 제외한 데이터 행을 공백 분리 리스트로."""
    global _calls
    base = _base(url)
    if base in _DEAD:  # 403/연속 시간초과로 죽은 서비스 — 예산도 시간도 쓰지 않는다
        raise HttpError(_DEAD_WHY.get(base, "403"))
    if _calls >= MAX_CALLS:
        raise HttpError("budget")
    _calls += 1
    q = dict(params, authKey=KEY_HUB)
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(q), headers={"User-Agent": "safepic/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            txt = r.read().decode("euc-kr", "replace")
    except urllib.error.HTTPError as e:
        raise HttpError(e.code)
    except Exception as e:  # noqa: BLE001
        raise HttpError("timeout" if "timed out" in str(e) else "net")
    return [ln.split() for ln in txt.splitlines() if ln and not ln.startswith("#")]


