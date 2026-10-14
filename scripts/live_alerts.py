"""실시간 수집 — 날씨(초단기실황·단기예보)·특보·safetydata·긴급재난문자·하천·산사태(fetch_live.py에서 분리)."""
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
from live_common import (_DEAD, _DEAD_WHY, _TMO, _base, _hub_text, _note_slow)  # noqa: F401

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
        if not skip_vilage and lc._calls < MAX_CALLS - 20:
            try:
                if key not in cache_vil:
                    data = get_json(f"{KMA_VILAGE}/getVilageFcst",
                                    {"pageNo": 1, "numOfRows": 1000, "dataType": "JSON",
                                     "base_date": vd, "base_time": vt, "nx": nx, "ny": ny}, KEY_KMA)
                    today = now.strftime("%Y%m%d")
                    hh = now.strftime("%H00")
                    v = {"tmx": None, "tmn": None, "pop": None, "fcst3h": []}
                    slots: dict[str, dict] = {}  # "YYYYMMDDHHMM" -> {ta,pty,pop,wsd,sky}
                    nowkey = now.strftime("%Y%m%d%H%M")
                    for it in kma_items(data):
                        d8, t4 = str(it.get("fcstDate", "")), str(it.get("fcstTime", ""))
                        c, val = it.get("category"), it.get("fcstValue")
                        if d8 == today:
                            if c == "TMX":
                                v["tmx"] = fnum(val)
                            elif c == "TMN":
                                v["tmn"] = fnum(val)
                            elif c == "POP" and v["pop"] is None and t4 >= hh:
                                v["pop"] = fnum(val)
                        if c in ("TMP", "PTY", "POP", "WSD", "SKY") and d8 + t4 > nowkey:
                            s = slots.setdefault(d8 + t4, {})
                            s["ta" if c == "TMP" else c.lower()] = fnum(val)
                    # 3시간 간격 8슬롯 = 24시간 타임라인
                    for k in sorted(slots)[:24][::3][:8]:
                        s = slots[k]
                        v["fcst3h"].append({"t": k[8:12], "d": k[6:8],
                                            "ta": s.get("ta"), "pty": iint(s.get("pty")),
                                            "pop": s.get("pop"), "wsd": s.get("wsd"),
                                            "sky": iint(s.get("sky"))})
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


_SEA_RE = re.compile(r"바다|해상|먼바다|앞바다|평수구역")


def match_area_codes(area_text, sgg):
    """Best-effort mapping of KMA area text (e.g. '서울', '경기도(수원, 성남)', '전북(진안)') to sgg codes.
    해상 구역(먼바다 등)은 육지 시군구에 매칭하지 않는다 — '남해동부먼바다'가 남해군에 걸리던 오탐 방지."""
    if _SEA_RE.search(area_text):
        return []
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


# --------------------------------------------------------------------------- safetydata 공통
def sd_rows(kind: str, want: int = 100, newest: bool = True) -> list[dict]:
    """플랫폼 목록 API에서 행을 가져온다. newest=True면 totalCount로 마지막 페이지를 계산해
    최신 행을 확보한다(기본 정렬이 오래된 순인 데이터셋 대비)."""
    ifcode, _ = SD_SETS[kind]
    key = SD_KEY.get(kind)
    if not key:
        raise HttpError("no_key")
    url = SD_API + ifcode
    base = {"serviceKey": key, "returnType": "json", "numOfRows": want}
    data = get_json(url, dict(base, pageNo=1))
    hdr = data.get("header", {})
    if str(hdr.get("resultCode", "00")) not in ("00", "0"):
        raise HttpError("sd" + str(hdr.get("resultCode")))
    rows = data.get("body") or []
    total = 0
    for k in ("totalCount", "totalCnt", "TotalCount"):
        try:
            total = int(data.get(k) or 0)
            if total:
                break
        except (TypeError, ValueError):
            pass
    if newest and total > want:
        last = (total + want - 1) // want
        data = get_json(url, dict(base, pageNo=last))
        rows = data.get("body") or []
        if len(rows) < want and last > 1:  # 마지막 페이지가 얇으면 앞 페이지 보충
            prev = get_json(url, dict(base, pageNo=last - 1))
            rows = (prev.get("body") or []) + rows
    return rows


def sd_active_warn_text(rows: list[dict]) -> tuple[str, str]:
    """특보통보문 행들 → (최신 발표시각, 현재 발효현황 텍스트)."""
    rows = sorted(rows, key=lambda r: str(r.get("PRSNTN_TM") or "").strip(), reverse=True)
    if not rows:
        return "", ""
    r0 = rows[0]
    return str(r0.get("PRSNTN_TM") or "").strip(), str(r0.get("SPNE_FRMNT_PRCON_CN") or "").strip()


def fetch_warnings_sd(sgg, prev):
    """기상특보 — 재난안전데이터공유플랫폼 특보통보문(DSSP-IF-00045).
    최신 통보문의 '특보발효현황내용'(o 특보명 : 지역 형식)을 기존 파서로 해석한다."""
    sec = {"updated": now_kst().isoformat(timespec="seconds"), "status": "ok", "items": [],
           "raw": None, "issued": None, "source": "기상청 특보통보문 · 재난안전데이터공유플랫폼"}
    try:
        tm, text = sd_active_warn_text(sd_rows("warn", 100))
        since = fmt_tm(tm[:12]) if tm else None
        sec["issued"] = since
        sec["raw"] = text[:4000]
        if text and text.replace("o", "").replace("없음", "").strip():
            sec["items"] = parse_warn_text(text, sgg, since)
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    return sec


def fetch_prewarn_sd(prev):
    """예비특보 — 최신 관측분의 예비특보 발효현황 텍스트(컬럼명 SPNE_FRMNT_PRCON_TM가 실제 내용)."""
    sec = {"updated": now_kst().isoformat(timespec="seconds"), "status": "ok",
           "at": None, "text": "", "none": True,
           "source": "기상청 예비특보 · 재난안전데이터공유플랫폼"}
    try:
        rows = sorted(sd_rows("prewarn", 50),
                      key=lambda r: str(r.get("OBSRVN_DT") or ""), reverse=True)
        if rows:
            r0 = rows[0]
            sec["at"] = fmt_tm(str(r0.get("OBSRVN_DT") or "")[:12])
            text = str(r0.get("SPNE_FRMNT_PRCON_TM") or "").strip()
            sec["text"] = text[:2000]
            sec["none"] = text.replace("o", "").replace("없음", "").strip() == ""
    except HttpError as e:
        sec = dict(prev or {}, status=f"error:{e.code}")
    return sec


def _sd_dt(s):
    try:
        return datetime.strptime(str(s)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST)
    except ValueError:
        return None


def fetch_landslide_sd(prev):
    """산사태 — 예보(공식 발령, DSSP-IF-00734) + 예측(1시간 분석, DSSP-IF-00735)."""
    sec = {"updated": now_kst().isoformat(timespec="seconds"), "status": "ok", "items": [],
           "source": "산림청 산사태 예보·예측 · 재난안전데이터공유플랫폼"}
    now = now_kst()
    errs = []
    ok_any = False
    try:  # 공식 예보: 지역별 마지막 상태가 '발령'이고 48시간 이내인 것
        rows = sd_rows("ls_fcst", 100)
        ok_any = True
        last_by_region: dict[str, dict] = {}
        for r in sorted(rows, key=lambda r: str(r.get("FRCST_APNT_DT") or "")):
            rg = str(r.get("OCRN_FRCST_APNT_INST_NM") or "").strip()
            if rg:
                last_by_region[rg] = r
        for rg, r in last_by_region.items():
            dt = _sd_dt(r.get("FRCST_APNT_DT"))
            if str(r.get("FRCST_APNT_STTS") or "").strip() != "발령":
                continue
            if not dt or (now - dt) > timedelta(hours=48):
                continue
            sec["items"].append({"kind": "fcst", "level": str(r.get("FRCST_APNT_KND_CD_NM") or ""),
                                 "region": rg, "at": dt.isoformat(timespec="seconds")})
    except HttpError as e:
        errs.append(e.code)
    try:  # 예측: 최신 분석 시각 배치(6시간 이내)만
        rows = sd_rows("ls_pred", 100)
        ok_any = True
        latest = max((str(r.get("PREDC_ANLS_DT") or "") for r in rows), default="")
        dt = _sd_dt(latest)
        if dt and (now - dt) <= timedelta(hours=6):
            for r in rows:
                if str(r.get("PREDC_ANLS_DT") or "") == latest:
                    sec["items"].append({"kind": "pred", "level": str(r.get("LNLD_FRCST_NM") or ""),
                                         "region": str(r.get("SGG_NM") or "").strip(),
                                         "at": dt.isoformat(timespec="seconds")})
    except HttpError as e:
        errs.append(e.code)
    if errs and not ok_any:
        sec = dict(prev or {}, status="error:" + errs[0])
    elif errs:
        sec["status"] = "partial:" + errs[0]
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


