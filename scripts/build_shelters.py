#!/usr/bin/env python3
"""Build nationwide shelter point layers (data/shelters/*.geojson) from KEYLESS sources.

No API keys, no geocoding, no fabricated points. Raw downloads are cached in .work_shelters/.

Sources (all keyless, see data/shelters/README.md):
  civil_defense : localdata.go.kr (지방행정인허가데이터) 민방위대피시설 CSV
                  https://file.localdata.go.kr/file/download/civil_defense_shelter_info/info
  heat          : data.go.kr 표준데이터 15013199 전국무더위쉼터표준데이터 (/download/standard.json)
                  + safekorea.go.kr 시설안전지도 무더위쉼터 (used when larger / fresher)
  cold          : safekorea.go.kr 시설안전지도 한파쉼터 (facilityDataList.do, per 시군구)
  quake         : safekorea.go.kr 지진옥외대피소 (per 시군구)
                  + data.go.kr 표준데이터 15025449 전국지진해일긴급대피장소표준데이터
  temp_housing  : safekorea.go.kr 이재민임시주거시설 / 지진겸용임시주거시설 (per 시군구)
  flood         : not obtainable nationwide keyless (see README)

Usage:  python scripts/build_shelters.py [--offline] [--kinds civil_defense,heat,...]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import math
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".work_shelters"
OUT = ROOT / "data" / "shelters"
ADMIN = ROOT / "data" / "admin"
TODAY = dt.date.today().isoformat()
MAX_BYTES = 5 * 1024 * 1024  # split per sido above this (hard limit is 6 MB)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE  # safekorea.go.kr chain is not always trusted by python

LON_RANGE = (124.0, 132.0)
LAT_RANGE = (33.0, 39.0)

OFFLINE = False

# ----------------------------------------------------------------------------- http

def http(url: str, *, data: bytes | None = None, headers: dict | None = None,
         timeout: int = 300, retries: int = 3) -> bytes:
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + 3 * i)
    raise RuntimeError(f"GET {url} failed: {last}")


def cached(name: str, fetch, binary: bool = False):
    """Return cached bytes/str for name, fetching with fetch() when missing."""
    p = CACHE / name
    if p.exists():
        return p.read_bytes() if binary else p.read_text(encoding="utf-8")
    if OFFLINE:
        raise RuntimeError(f"offline and {p} missing")
    CACHE.mkdir(exist_ok=True)
    b = fetch()
    if binary:
        p.write_bytes(b)
        return b
    s = b.decode("utf-8") if isinstance(b, bytes) else b
    p.write_text(s, encoding="utf-8")
    return s


# ----------------------------------------------------------------------------- admin index

SIDO_PREFIX = [
    ("서울", "11"), ("부산", "26"), ("대구", "27"), ("인천", "28"),
    ("광주", "12"), ("전남", "12"), ("전라남도", "12"),
    ("대전", "30"), ("울산", "31"), ("세종", "36"), ("경기", "41"),
    ("강원", "51"), ("충청북도", "43"), ("충북", "43"), ("충청남도", "44"), ("충남", "44"),
    ("전라북도", "52"), ("전북", "52"), ("경상북도", "47"), ("경북", "47"),
    ("경상남도", "48"), ("경남", "48"), ("제주", "50"),
]
SIDO_NAME = {"11": "서울특별시", "26": "부산광역시", "27": "대구광역시", "28": "인천광역시",
             "12": "전남광주통합특별시", "30": "대전광역시", "31": "울산광역시", "36": "세종특별자치시",
             "41": "경기도", "51": "강원특별자치도", "43": "충청북도", "44": "충청남도",
             "52": "전북특별자치도", "47": "경상북도", "48": "경상남도", "50": "제주특별자치도"}

_SGG_INDEX = None


def sgg_index():
    global _SGG_INDEX
    if _SGG_INDEX is None:
        rows = json.loads((ADMIN / "sgg_index.json").read_text(encoding="utf-8"))
        by_sido = defaultdict(list)
        for r in rows:
            by_sido[r["sido"]].append((r["name"].replace(" ", ""), r["code"]))
        for k in by_sido:  # longest names first so 수원시장안구 wins over 광주시 etc.
            by_sido[k].sort(key=lambda t: -len(t[0]))
        _SGG_INDEX = {"by_sido": by_sido, "codes": {r["code"] for r in rows},
                      "rows": rows}
    return _SGG_INDEX


def sido_from_addr(addr: str | None) -> str | None:
    if not addr:
        return None
    a = addr.strip()
    for pre, code in SIDO_PREFIX:
        if a.startswith(pre):
            return code
    return None


def sgg_from_addr(addr: str | None) -> str | None:
    """5-digit sgg code by matching the address against sgg names within its sido."""
    sido = sido_from_addr(addr)
    if not sido:
        return None
    idx = sgg_index()["by_sido"].get(sido, [])
    toks = addr.split()
    rest = "".join(toks[1:]) if len(toks) > 1 else ""
    if sido == "36":
        return "36110"
    # 광주광역시 X구 → names are plain 구 names in sido 12; 전라남도 X시 likewise
    for name, code in idx:
        if rest.startswith(name):
            return code
    return None


# ----------------------------------------------------------------------------- geometry helpers

def to_float(v):
    try:
        if v is None or v == "" or v == "null":
            return None
        return float(str(v).strip())
    except ValueError:
        return None


def in_bounds(lon, lat):
    return lon is not None and lat is not None and LON_RANGE[0] <= lon <= LON_RANGE[1] \
        and LAT_RANGE[0] <= lat <= LAT_RANGE[1]


_TRANSFORMERS = {}


def project(x, y, epsg):
    from pyproj import Transformer
    t = _TRANSFORMERS.get(epsg)
    if t is None:
        t = _TRANSFORMERS[epsg] = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    lon, lat = t.transform(x, y)
    return lon, lat


def detect_and_project(x, y):
    """Given a projected (x, y) try 5179 / 5174 / 5181 / 5186 and keep the one that lands in Korea."""
    for epsg in (5179, 5186, 5181, 5174):
        try:
            lon, lat = project(x, y, epsg)
        except Exception:  # noqa: BLE001
            continue
        if in_bounds(lon, lat):
            return lon, lat, epsg
    return None, None, None


def to_int(v):
    f = to_float(v)
    if f is None:
        return None
    try:
        return int(round(f))
    except (ValueError, OverflowError):
        return None


def clean(s):
    if s is None:
        return None
    s = str(s).strip()
    return s or None


def epoch_ms_to_date(v):
    try:
        return dt.datetime.fromtimestamp(int(v) / 1000, dt.timezone.utc).date().isoformat()
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------------------- stats

class Stats:
    def __init__(self):
        self.d = defaultdict(Counter)

    def add(self, kind, key, n=1):
        self.d[kind][key] += n

    def get(self, kind):
        return dict(self.d[kind])


STATS = Stats()
SOURCES: dict[str, list[dict]] = defaultdict(list)
FAILURES: list[dict] = []


# 군 시설(부대·사단·사령부·군인아파트 등)은 공개 지도에 올리지 않는다 (2026-08-23 결정).
MILITARY = re.compile(r"군부대|[0-9]+\s*(부대|사단|연대|대대|여단)|공수부대|사령부|해병대|육군|(?<!남)해군(?!전적비|과학기술고)|공군|국방부|훈련소|예비군|군인아파트|특전사|부대\s*(앞|내|정문)")


def feature(kind, lon, lat, name, addr, cap, typ, src, asof, sgg=None):
    if MILITARY.search(f"{name or ''} {addr or ''} {typ or ''}"):
        STATS.add(kind, "dropped_military")
        return None
    if not in_bounds(lon, lat):
        STATS.add(kind, "dropped_no_or_bad_coords")
        return None
    if sgg is None:
        sgg = sgg_from_addr(addr)
    if sgg is None:
        STATS.add(kind, "sgg_unmatched")
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {"name": name, "addr": addr, "sgg": sgg, "cap": cap, "type": typ,
                       "src": src, "asof": asof},
    }


# ----------------------------------------------------------------------------- data.go.kr 표준데이터 (keyless)

def datago_std_rows(pk: str) -> tuple[list[dict], dict]:
    """Download a 공공데이터포털 표준데이터셋 through the same keyless JSON endpoints the
    web page's CSV button uses (/download/columList.json + /download/standard.json)."""
    H = {"Accept": "application/json", "Referer": f"https://www.data.go.kr/data/{pk}/standard.do"}
    hdr = json.loads(cached(f"hdr_{pk}.json",
                            lambda: http(f"https://www.data.go.kr/download/columList.json?pk={pk}&ext=CSV", headers=H)))
    p = CACHE / f"std_{pk}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8")), hdr
    if OFFLINE:
        raise RuntimeError(f"offline and {p} missing")
    tv = hdr["tableVO"]
    total = int(hdr["totalCount"])
    per = 10000
    rows = []
    for page in range(1, (total + per - 1) // per + 1):
        q = [("publicDataPk", pk)] + [("colNmList", c) for c in tv["colNmList"]] + [
            ("totalCount", total), ("svcTableNm", tv["svcTableNm"]), ("perPage", per), ("page", page)]
        url = "https://www.data.go.kr/download/standard.json?" + urllib.parse.urlencode(q)
        rows += json.loads(http(url, headers=H))
        print(f"  std {pk} page {page}: {len(rows)}/{total}", flush=True)
    p.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows, hdr


# ----------------------------------------------------------------------------- safekorea 시설안전지도 (keyless POST)

SK_COVERAGE: dict[str, dict] = {}
SK_URL = "https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do"
SK_REF = "https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2"
SK_LAYERS = {
    # key: (tableNm, tableKorNm)
    "cold": ("TFK_CDW_RSTR_TEMP", "한파쉼터"),
    "heat": ("TFK_HTW_RSTR_TEMP", "무더위쉼터"),
    "quake_outdoor": ("TFK_ACMD_SPCE_FCLTY_TEMP", "지진옥외대피소"),
    "temp_housing": ("TFK_ACMDFCLTY_TEMP", "이재민임시주거시설"),
    "temp_housing_quake": ("TFK_ACMDFCLTY_TEMP", "지진겸용임시주거시설"),
    # 2026-08-23 additions (same keyless endpoint; every row carries lo/la/title/adres)
    "fire": ("TFK_FIRE_STATION_TEMP", "소방서"),
    "police": ("TFK_POLICE_STATION_TEMP", "경찰서"),
    "pharmacy": ("TB_SFK_HSPTL_INFO", "약국"),
    "er": ("TB_SFK_ESR_MDLCR_CNTR", "응급의료센터"),
    "dust": ("TFK_FIND_DUST_RSTR_FCLTY_TEMP", "미세먼지쉼터"),
    "water": ("TFK_CIVIL_EMR_FACL_TEMP", "비상급수시설"),
    "tsunami": ("TFK_TSUNAMI_SHELTER_TEMP", "지진해일대피소"),
    # 2026-08-23 (2): shelters + hazard points
    "chem": ("TFK_CHMSTRY_ACDNT_SHLTR_TEMP", "화학사고대피소"),
    "health": ("TB_SFK_HSPTL_INFO", "보건소"),
    "steep": ("TB_SFK_ASS", "급경사지"),
    "wildfire_hist": ("TB_SFK_FFIRE_OCRN_HSTRY", "산불발생이력_전체"),
}


def safekorea_layer(layer: str) -> dict[str, list[dict]]:
    """Fetch one 시설안전지도 layer for every 시군구 (256 codes from data/admin)."""
    table, kor = SK_LAYERS[layer]
    out = {}
    codes = sorted(sgg_index()["codes"])
    budget = float(os.environ.get("SK_BUDGET_S", "240"))  # wall-clock seconds of *new* fetching per layer
    t0 = time.time()
    skipped = []
    H = {"Referer": SK_REF, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json"}
    for i, sgg in enumerate(codes):
        name = f"sk_{layer}_{sgg}.json"

        def fetch(sgg=sgg):
            size = 2000
            recs, page = [], 1
            while True:
                d = urllib.parse.urlencode({"tableNm": table, "tableKorNm": kor, "sggCd": sgg,
                                            "page": page, "size": size}).encode()
                j = json.loads(http(SK_URL, data=d, headers=H, timeout=120, retries=1))
                # 'mapList' = all rows for the map (not paged); 'list' = paged table
                lst = j.get("mapList") or j.get("list") or []
                recs += lst
                if j.get("mapList") or page >= int(j.get("totalPages") or 1):
                    break
                page += 1
            return json.dumps({"sgg": sgg, "totalCnt": j.get("totalCnt"), "rows": recs},
                              ensure_ascii=False).encode("utf-8")

        if not (CACHE / name).exists() and (OFFLINE or time.time() - t0 > budget):
            skipped.append(sgg)
            continue
        try:
            j = json.loads(cached(name, fetch))
        except Exception as e:  # noqa: BLE001
            FAILURES.append({"src": f"safekorea {kor}", "sgg": sgg, "err": str(e)})
            continue
        out[sgg] = j["rows"]
        if i % 32 == 0:
            print(f"  safekorea {kor}: {i + 1}/{len(codes)} sgg", flush=True)
    SK_COVERAGE[layer] = {"fetched_sgg": len(out), "total_sgg": len(codes), "skipped_sgg": skipped}
    if skipped:
        FAILURES.append({"src": f"safekorea {kor}", "err": f"time budget {budget:.0f}s exhausted; {len(skipped)} of {len(codes)} 시군구 not fetched (partial layer)"})
    return out


# ----------------------------------------------------------------------------- builders

def build_civil_defense() -> list[dict]:
    url = "https://file.localdata.go.kr/file/download/civil_defense_shelter_info/info"
    raw = cached("civil_defense_localdata.csv",
                 lambda: http(url, headers={"Referer": "https://file.localdata.go.kr/file/civil_defense_shelter_info/info"}),
                 binary=True)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949")
    rows = list(csv.DictReader(io.StringIO(text)))
    kind = "civil_defense"
    feats = []
    asof_max = ""
    status = Counter()
    for r in rows:
        STATS.add(kind, "raw_rows")
        st = clean(r.get("운영상태"))
        status[st] += 1
        if st != "사용중":
            STATS.add(kind, "dropped_not_in_use")
            continue
        lat = to_float(r.get("위도(EPSG4326)"))
        lon = to_float(r.get("경도(EPSG4326)"))
        if not in_bounds(lon, lat):
            x, y = to_float(r.get("좌표정보X(EPSG5179)")), to_float(r.get("좌표정보Y(EPSG5179)"))
            if x is not None and y is not None:
                lon, lat, epsg = detect_and_project(x, y)
                if epsg:
                    STATS.add(kind, f"reprojected_from_{epsg}")
        addr = clean(r.get("도로명전체주소")) or clean(r.get("소재지전체주소"))
        typ = " / ".join(x for x in (clean(r.get("시설구분")), clean(r.get("시설위치(지상/지하)"))) if x)
        asof = (clean(r.get("데이터갱신시점")) or "")[:10] or None
        if asof and asof > asof_max:
            asof_max = asof
        f = feature(kind, lon, lat, clean(r.get("시설명")), addr, to_int(r.get("최대수용인원")),
                    typ or None, "localdata", asof)
        if f:
            feats.append(f)
    SOURCES[kind].append({"name": "지방행정인허가데이터개방 민방위대피시설 (행정안전부, 매일 갱신)",
                          "url": url, "page": "https://file.localdata.go.kr/file/civil_defense_shelter_info/info",
                          "datago": "https://www.data.go.kr/data/15044951/fileData.do",
                          "fetched": TODAY, "asof_max": asof_max, "raw_rows": len(rows),
                          "status_breakdown": dict(status),
                          "license": "이용허락범위 제한 없음 (공공데이터포털 15044951)"})
    return feats


def build_heat() -> list[dict]:
    kind = "heat"
    feats_std = []
    rows, hdr = datago_std_rows("15013199")
    asof = Counter()
    for r in rows:
        STATS.add(kind, "std_raw_rows")
        lon, lat = to_float(r.get("LONGITUDE")), to_float(r.get("LATITUDE"))
        addr = clean(r.get("RDNMADR")) or clean(r.get("LNMADR"))
        a = clean(r.get("REFERENCE_DATE"))
        asof[a] += 1
        f = feature(kind, lon, lat, clean(r.get("SHLTR_NM")), addr, to_int(r.get("ACEPTNC_POSBL_CO")),
                    clean(r.get("SHLTR_TYPE")), "datago_std_15013199", a)
        if f:
            feats_std.append(f)
    SOURCES[kind].append({"name": "전국무더위쉼터표준데이터 (공공데이터포털 표준데이터 15013199)",
                          "url": "https://www.data.go.kr/data/15013199/standard.do",
                          "endpoint": "https://www.data.go.kr/download/standard.json (keyless, same as page CSV button)",
                          "fetched": TODAY, "raw_rows": len(rows), "points": len(feats_std),
                          "asof_top": asof.most_common(5),
                          "license": "공공데이터포털 표준데이터 (이용허락범위 제한 없음)"})
    # safekorea current-year layer
    feats_sk = []
    try:
        per = safekorea_layer("heat")
        for sgg, recs in per.items():
            for r in recs:
                STATS.add(kind, "safekorea_raw_rows")
                lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
                f = feature(kind, lon, lat, clean(r.get("rstrNm")) or clean(r.get("title")),
                            clean(r.get("rnDtlAdres")) or clean(r.get("adres")),
                            to_int(r.get("usePsblNmpr")), clean(r.get("fcltyTy")),
                            "safekorea", epoch_ms_to_date(r.get("modfTime")) or TODAY, sgg=sgg)
                if f:
                    feats_sk.append(f)
        SOURCES[kind].append({"name": "국민안전24(safekorea) 시설안전지도 무더위쉼터 (행정안전부, 시군구별 조회)",
                              "url": SK_REF, "endpoint": SK_URL, "fetched": TODAY,
                              "raw_rows": sum(len(v) for v in per.values()), "points": len(feats_sk),
                              "license": "공공누리 제1유형 (국민안전24 저작권정책)"})
    except Exception as e:  # noqa: BLE001
        FAILURES.append({"src": "safekorea 무더위쉼터", "err": str(e)})
    # choose the richer one; record the decision
    if len(feats_sk) > len(feats_std):
        STATS.add(kind, "chosen_safekorea")
        return feats_sk
    STATS.add(kind, "chosen_datago_std")
    return feats_std


SK_FCLTY_TY = {  # 쉼터유형 codes seen on safekorea (best effort; unknown codes are kept raw)
    "001": "경로당", "002": "마을회관", "003": "경로당", "004": "주민센터", "005": "복지회관",
    "006": "금융기관", "007": "공공시설", "008": "기타",
}


def build_cold() -> list[dict]:
    kind = "cold"
    feats = []
    per = safekorea_layer("cold")
    for sgg, recs in per.items():
        for r in recs:
            STATS.add(kind, "raw_rows")
            if clean(r.get("useAt")) == "N":
                STATS.add(kind, "dropped_useAt_N")
                continue
            lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
            f = feature(kind, lon, lat, clean(r.get("rstrNm")) or clean(r.get("title")),
                        clean(r.get("rnDtlAdres")) or clean(r.get("adres")),
                        to_int(r.get("usePsblNmpr")), clean(r.get("fcltyTy")),
                        "safekorea", epoch_ms_to_date(r.get("modfTime")) or TODAY, sgg=sgg)
            if f:
                feats.append(f)
    SOURCES[kind].append({"name": "국민안전24(safekorea) 시설안전지도 한파쉼터 (행정안전부, 시군구별 조회)",
                          "url": SK_REF, "endpoint": SK_URL, "fetched": TODAY,
                          "raw_rows": sum(len(v) for v in per.values()),
                          "license": "공공누리 제1유형 (국민안전24 저작권정책)"})
    return feats


def build_quake() -> list[dict]:
    kind = "quake"
    feats = []
    per = safekorea_layer("quake_outdoor")
    for sgg, recs in per.items():
        for r in recs:
            STATS.add(kind, "outdoor_raw_rows")
            lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
            if not in_bounds(lon, lat) and r.get("xcord") and r.get("ycord"):
                lon, lat, epsg = detect_and_project(to_float(r["xcord"]), to_float(r["ycord"]))
                if epsg:
                    STATS.add(kind, f"reprojected_from_{epsg}")
            f = feature(kind, lon, lat, clean(r.get("vtAcmdfcltyNm")) or clean(r.get("title")),
                        clean(r.get("rnDtlAdres")) or clean(r.get("adres")),
                        to_int(r.get("vtAcmdPsblNmpr")), "지진옥외대피장소",
                        "safekorea", epoch_ms_to_date(r.get("lastModfDt")) or TODAY, sgg=sgg)
            if f:
                feats.append(f)
    SOURCES[kind].append({"name": "국민안전24(safekorea) 시설안전지도 지진옥외대피소 (행정안전부, 시군구별 조회)",
                          "url": SK_REF, "endpoint": SK_URL, "fetched": TODAY,
                          "raw_rows": sum(len(v) for v in per.values()), "points": len(feats),
                          "license": "공공누리 제1유형 (국민안전24 저작권정책)"})
    # 지진해일긴급대피장소 (coastal) from 표준데이터
    n0 = len(feats)
    rows, hdr = datago_std_rows("15025449")
    for r in rows:
        STATS.add(kind, "tsunami_raw_rows")
        lon, lat = to_float(r.get("LONGITUDE")), to_float(r.get("LATITUDE"))
        addr = clean(r.get("RDNMADR")) or clean(r.get("LNMADR"))
        typ = "지진해일긴급대피장소" + (f" ({clean(r.get('SHELTER_SE'))})" if clean(r.get("SHELTER_SE")) else "")
        f = feature(kind, lon, lat, clean(r.get("SHELTER_NM")), addr, to_int(r.get("ACEPTNC_CO")),
                    typ, "datago_std_15025449", clean(r.get("REFERENCE_DATE")))
        if f:
            feats.append(f)
    SOURCES[kind].append({"name": "전국지진해일긴급대피장소표준데이터 (공공데이터포털 표준데이터 15025449)",
                          "url": "https://www.data.go.kr/data/15025449/standard.do",
                          "endpoint": "https://www.data.go.kr/download/standard.json", "fetched": TODAY,
                          "raw_rows": len(rows), "points": len(feats) - n0,
                          "license": "공공데이터포털 표준데이터 (이용허락범위 제한 없음)"})
    return feats


def build_temp_housing() -> list[dict]:
    kind = "temp_housing"
    per_all = safekorea_layer("temp_housing")
    per_q = safekorea_layer("temp_housing_quake")
    quake_keys = set()
    for sgg, recs in per_q.items():
        for r in recs:
            lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
            if lon is not None and lat is not None:
                quake_keys.add((sgg, clean(r.get("vtAcmdfcltyNm")) or clean(r.get("title")), round(lon, 5), round(lat, 5)))
    feats = []
    seen = set()
    for sgg, recs in per_all.items():
        for r in recs:
            STATS.add(kind, "raw_rows")
            lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
            name = clean(r.get("vtAcmdfcltyNm")) or clean(r.get("title"))
            key = (sgg, name, round(lon, 5) if lon else None, round(lat, 5) if lat else None)
            if key in seen:
                STATS.add(kind, "dropped_duplicate")
                continue
            seen.add(key)
            se = clean(r.get("acmdfcltySeNm"))
            typ = "이재민임시주거시설" + (" (지진겸용)" if key in quake_keys else "") + (f" / {se}" if se else "")
            f = feature(kind, lon, lat, name, clean(r.get("rnDtlAdres")) or clean(r.get("adres")),
                        to_int(r.get("vtAcmdPsblNmpr")), typ, "safekorea",
                        epoch_ms_to_date(r.get("lastModfDt")) or TODAY, sgg=sgg)
            if f:
                feats.append(f)
    # rows only present in the 지진겸용 layer (should be a subset, but be safe)
    extra = 0
    for sgg, recs in per_q.items():
        for r in recs:
            lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
            name = clean(r.get("vtAcmdfcltyNm")) or clean(r.get("title"))
            key = (sgg, name, round(lon, 5) if lon else None, round(lat, 5) if lat else None)
            if key in seen:
                continue
            seen.add(key)
            STATS.add(kind, "raw_rows_quake_only")
            f = feature(kind, lon, lat, name, clean(r.get("rnDtlAdres")) or clean(r.get("adres")),
                        to_int(r.get("vtAcmdPsblNmpr")), "이재민임시주거시설 (지진겸용)", "safekorea",
                        epoch_ms_to_date(r.get("lastModfDt")) or TODAY, sgg=sgg)
            if f:
                feats.append(f)
                extra += 1
    SOURCES[kind].append({"name": "국민안전24(safekorea) 시설안전지도 이재민임시주거시설 + 지진겸용임시주거시설 (행정안전부, 시군구별 조회)",
                          "url": SK_REF, "endpoint": SK_URL, "fetched": TODAY,
                          "raw_rows": sum(len(v) for v in per_all.values()),
                          "raw_rows_quake_layer": sum(len(v) for v in per_q.values()),
                          "quake_only_added": extra,
                          "license": "공공누리 제1유형 (국민안전24 저작권정책)"})
    return feats


def dms(d, m, sec):
    d, m, sec = to_float(d), to_float(m), to_float(sec)
    if d is None:
        return None
    return d + (m or 0) / 60 + (sec or 0) / 3600


def make_sk_builder(kind: str, layer: str, label: str, tel_keys=("tel", "dutyTel1", "fcltyTelno", "telRmk", "shltrChargerCttpc")):
    """Generic builder for a 시설안전지도 layer: title/adres/lo/la (+tel)."""
    def build() -> list[dict]:
        feats = []
        per = safekorea_layer(layer)
        for sgg, recs in per.items():
            for r in recs:
                STATS.add(kind, "raw_rows")
                if clean(r.get("useYn")) == "N" or clean(r.get("useAt")) == "N" or clean(r.get("delYn")) == "Y":
                    STATS.add(kind, "dropped_inactive")
                    continue
                lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
                if lon is None and r.get("facilLode") is not None:  # 비상급수시설: DMS
                    lon, lat = dms(r.get("facilLode"), r.get("facilLomi"), r.get("facilLose")), dms(r.get("facilLade"), r.get("facilLami"), r.get("facilLase"))
                if lon is None and r.get("gisCrdntPnttmLodg") is not None:  # 급경사지: DMS (시점)
                    lon, lat = dms(r.get("gisCrdntPnttmLodg"), r.get("gisCrdntPnttmLoMin"), r.get("gisCrdntPnttmLoSecnd")), dms(r.get("gisCrdntPnttmLadg"), r.get("gisCrdntPnttmLaMin"), r.get("gisCrdntPnttmLaSecnd"))
                if lon is not None and abs(lon) > 1000:  # 산불이력: web mercator (EPSG:3857) in lo/la
                    R_ = 6378137.0
                    lon, lat = lon / R_ * 180 / math.pi, (2 * math.atan(math.exp(lat / R_)) - math.pi / 2) * 180 / math.pi
                name = clean(r.get("title")) or clean(r.get("facilityName")) or clean(r.get("facilNm")) or clean(r.get("rstrNm"))
                if r.get("occuDate"):  # 산불이력: "2017-03-10 입산자 실화"
                    od = str(r.get("occuDate")); name = f"{od[:4]}-{od[4:6]}-{od[6:8]} {clean(r.get('resn')) or ''}".strip()
                addr = clean(r.get("adres")) or clean(r.get("addrNm")) or clean(r.get("rnDtlAdres")) or clean(r.get("facilRdAddr")) or clean(r.get("facilAddr"))
                cap = to_int(r.get("usePsblNmpr")) or to_int(r.get("emgySickbdCnt")) or to_int(r.get("aceptncNmpr"))
                typ = clean(r.get("facilityType")) or clean(r.get("facilGbnNm")) or clean(r.get("fcltyTy")) or clean(r.get("facilGb")) or clean(r.get("prtnfcNm")) or (f"{r.get('facilPow')} {r.get('facilUnit')}".strip() if r.get("facilPow") else None)
                if r.get("occuYear"):
                    typ = f"{to_float(r.get('ar'))}ha" if (to_float(r.get("ar")) or 0) > 0 else None
                f = feature(kind, lon, lat, name, addr, cap, typ, "safekorea",
                            epoch_ms_to_date(r.get("modfTime")) or epoch_ms_to_date(r.get("createDate")) or TODAY, sgg=sgg)
                if f:
                    tel = next((clean(r.get(k)) for k in tel_keys if clean(r.get(k))), None)
                    if tel and r.get("telnoPlcCd") and k_is(tel, r):  # 응급의료센터: 지역번호 분리
                        tel = f"{r.get('telnoPlcCd')}-{tel}"
                    if tel:
                        f["properties"]["tel"] = tel
                    feats.append(f)
        SOURCES[kind].append({"name": f"국민안전24(safekorea) 시설안전지도 {label} (행정안전부, 시군구별 조회)",
                              "url": SK_REF, "endpoint": SK_URL, "fetched": TODAY,
                              "raw_rows": sum(len(v) for v in per.values()),
                              "license": "공공누리 제1유형 (국민안전24 저작권정책)"})
        return feats
    return build


def k_is(tel, r):
    return tel == clean(r.get("telRmk"))


def build_meal() -> list[dict]:
    """전국무료급식소표준데이터 (공공데이터포털 표준데이터 15013107, keyless CSV endpoint)."""
    kind = "meal"
    feats = []
    rows, hdr = datago_std_rows("15013107")
    for r in rows:
        STATS.add(kind, "std_raw_rows")
        lon, lat = to_float(r.get("LONGITUDE")), to_float(r.get("LATITUDE"))
        addr = clean(r.get("RDNMADR")) or clean(r.get("LNMADR"))
        name = clean(r.get("FCLTY_NM")) or clean(r.get("FCLTYNM")) or clean(r.get("FACILITY_NM"))
        typ = clean(r.get("MLSV_TRGET"))  # 급식 대상(노인·노숙인 등)
        f = feature(kind, lon, lat, name, addr, to_int(r.get("ACEPTNC_POSBL_CO")) or None, typ,
                    "datago_std_15013107", clean(r.get("REFERENCE_DATE")) or TODAY)
        if f:
            tel = clean(r.get("PHONE_NUMBER")) or clean(r.get("PHONENUMBER"))
            if tel:
                f["properties"]["tel"] = tel
            t = " ".join(x for x in (clean(r.get("MLSV_DATE")), clean(r.get("MLSV_TIME"))) if x) or None
            if t:
                f["properties"]["hours"] = t
            feats.append(f)
    if not rows:
        FAILURES.append({"src": "datago_std 15013107 무료급식소", "err": "no rows"})
    SOURCES[kind].append({"name": "전국무료급식소표준데이터 (공공데이터포털 표준데이터 15013107)",
                          "url": "https://www.data.go.kr/data/15013107/standard.do",
                          "endpoint": "https://www.data.go.kr/download/standard.json (keyless)",
                          "fetched": TODAY, "raw_rows": len(rows), "points": len(feats),
                          "columns": hdr.get("colNmList") if isinstance(hdr, dict) else None,
                          "license": "공공데이터포털 표준데이터 (이용허락범위 제한 없음)"})
    return feats


# ----------------------------------------------------------------------------- OSM Overpass (keyless) — 주민센터

_SGG_POLYS = None


def _pip(lon, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def sgg_from_point(lon, lat):
    global _SGG_POLYS
    if _SGG_POLYS is None:
        g = json.loads((ROOT / "data" / "admin" / "kr_sgg.geojson").read_text(encoding="utf-8"))
        _SGG_POLYS = []
        for f in g["features"]:
            geom = f["geometry"]
            polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
            for poly in polys:
                ring = poly[0]
                xs = [c[0] for c in ring]; ys = [c[1] for c in ring]
                _SGG_POLYS.append((min(xs), min(ys), max(xs), max(ys), ring, str(f["properties"].get("code"))))
    for x0, y0, x1, y1, ring, code in _SGG_POLYS:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and _pip(lon, lat, ring):
            return code
    return None


def build_townhall() -> list[dict]:
    """읍·면·동 주민센터(행정복지센터) — OpenStreetMap via Overpass (ODbL). 피해신고 접수처."""
    kind = "townhall"
    q = ('[out:json][timeout:180];area["ISO3166-1"="KR"]->.kr;'
         '(nwr["name"~"주민센터|행정복지센터|면사무소|읍사무소"](area.kr););out center tags;')
    raw = cached("osm_townhall.json", lambda: http("https://overpass-api.de/api/interpreter",
                                                   data=urllib.parse.urlencode({"data": q}).encode(),
                                                   headers={"User-Agent": "safepic/0.1"}, timeout=300))
    j = json.loads(raw)
    feats = []
    for e in j.get("elements", []):
        t = e.get("tags", {})
        STATS.add(kind, "raw_rows")
        if t.get("highway") or t.get("public_transport") or t.get("railway"):
            STATS.add(kind, "dropped_transit")
            continue
        if not (t.get("amenity") == "townhall" or t.get("office") == "government" or t.get("building")):
            STATS.add(kind, "dropped_untagged")
            continue
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        addr = t.get("addr:full") or " ".join(x for x in (t.get("addr:city"), t.get("addr:district"), t.get("addr:street"), t.get("addr:housenumber")) if x) or None
        lon, lat = to_float(lon), to_float(lat)
        sgg = sgg_from_point(lon, lat) if in_bounds(lon, lat) else None
        f = feature(kind, lon, lat, clean(t.get("name")), addr, None, None, "osm", TODAY, sgg=sgg)
        if f:
            if t.get("phone") or t.get("contact:phone"):
                f["properties"]["tel"] = t.get("phone") or t.get("contact:phone")
            feats.append(f)
    SOURCES[kind].append({"name": "OpenStreetMap 주민센터·행정복지센터·읍면사무소 (Overpass API)",
                          "url": "https://www.openstreetmap.org", "endpoint": "https://overpass-api.de/api/interpreter",
                          "fetched": TODAY, "raw_rows": len(j.get("elements", [])),
                          "license": "ODbL 1.0 — © OpenStreetMap contributors (attribution shown on map)"})
    return feats


BUILDERS = {
    "civil_defense": build_civil_defense,
    "heat": build_heat,
    "cold": build_cold,
    "quake": build_quake,
    "temp_housing": build_temp_housing,
    "fire": make_sk_builder("fire", "fire", "소방서·119안전센터"),
    "police": make_sk_builder("police", "police", "경찰서·지구대"),
    "pharmacy": make_sk_builder("pharmacy", "pharmacy", "약국"),
    "er": make_sk_builder("er", "er", "응급의료센터"),
    "dust": make_sk_builder("dust", "dust", "미세먼지쉼터"),
    "water": make_sk_builder("water", "water", "비상급수시설"),
    "tsunami": make_sk_builder("tsunami", "tsunami", "지진해일대피소"),
    "meal": build_meal,
    "townhall": build_townhall,
    "chem": make_sk_builder("chem", "chem", "화학사고대피소"),
    "health": make_sk_builder("health", "health", "보건소"),
    "steep": make_sk_builder("steep", "steep", "급경사지(붕괴위험 관리지점)"),
    "wildfire_hist": make_sk_builder("wildfire_hist", "wildfire_hist", "산불발생이력(2013~)"),
}

NOT_OBTAINABLE = [
    {"kind": "flood", "why": "전국 단위 수해대피소 데이터셋 없음. 공공데이터포털에는 지자체별 파일만 존재"
                             "(예: 15099625 서울특별시_수해대피소공간정보, 15114035 진주시, 15113913 평택시, 15113802 진천군 등)이며 "
                             "모두 fileDownload.do 로그인 필요. safekorea 시설안전지도에도 수해대피소 레이어 없음."},
    {"kind": "quake (표준데이터)", "why": "15072620 전국지진옥외대피장소표준데이터, 15072622 전국지진겸용임시주거시설표준데이터는 "
                                     "totalCount=0 (빈 데이터셋) → safekorea 레이어로 대체"},
    {"kind": "temp_housing (행안부 파일)", "why": "15124965 행정안전부_이재민임시주거시설정보: 51행(집계표) + fileDownload.do는 "
                                           "비로그인 시 '%PDF-1.7' 안내문 반환(.work_shelters/temp_housing_15124965_login_guidance.pdf) → 사용 불가"},
    {"kind": "civil_defense (표준데이터)", "why": "15021098 전국민방위대피시설표준데이터는 5,204행(2021 기준, 일부 지자체만) → "
                                            "localdata.go.kr 전국 18,8xx행(매일 갱신)으로 대체"},
    {"kind": "cold (표준데이터)", "why": "전국 한파쉼터 표준데이터셋 없음(지자체별 파일만: 15088136 서울, 15153730 부산 등, 로그인 필요) → safekorea 레이어 사용"},
]


# ----------------------------------------------------------------------------- output

def dump_fc(path: Path, feats: list[dict]) -> int:
    fc = {"type": "FeatureCollection", "features": feats}
    s = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(s, encoding="utf-8")
    return len(s.encode("utf-8"))


def write_kind(kind: str, feats: list[dict], index: dict) -> dict:
    """Write data/shelters/{kind}.geojson, or split per sido if > MAX_BYTES."""
    single = OUT / f"{kind}.geojson"
    size = dump_fc(single, feats)
    info = {"count": len(feats), "files": {f"{kind}.geojson": size}}
    if size <= MAX_BYTES:
        # drop any stale split dir
        d = OUT / kind
        if d.exists():
            for p in d.glob("*.geojson"):
                p.unlink()
            d.rmdir()
        return info
    single.unlink()
    info["files"] = {}
    by_sido = defaultdict(list)
    for f in feats:
        sgg = f["properties"]["sgg"]
        sido = sgg[:2] if sgg else (sido_from_addr(f["properties"]["addr"]) or "00")
        by_sido[sido].append(f)
    index[kind] = {}
    for sido, fs in sorted(by_sido.items()):
        p = OUT / kind / f"{sido}.geojson"
        sz = dump_fc(p, fs)
        info["files"][f"{kind}/{sido}.geojson"] = sz
        index[kind][sido] = f"{kind}/{sido}.geojson"
        if sz > MAX_BYTES:
            print(f"  WARNING {p} is {sz} bytes > 6 MB", file=sys.stderr)
    return info


def validate(feats):
    for f in feats:
        lon, lat = f["geometry"]["coordinates"]
        assert in_bounds(lon, lat), f
        assert f["properties"]["sgg"] is None or f["properties"]["sgg"] in sgg_index()["codes"], f


def write_readme(results: dict, index: dict):
    L = []
    L.append("# data/shelters — nationwide shelter points (keyless sources)\n")
    L.append(f"Built {TODAY} by `scripts/build_shelters.py` (do not hand-edit). WGS84 points, coords rounded to 1e-5 deg. "
             "No geocoding, no fabricated points: rows without usable coordinates are dropped (counts below). 군 시설(부대·사령부·군인아파트 등)은 공개하지 않고 제외한다(`dropped_military`).\n")
    L.append("Props per feature: `name`, `addr`, `sgg` (5-digit 시군구 code, 2026-07 체계 — 광주+전남 = `12`; from the query 시군구 for safekorea layers, "
             "else by address match within sido against `data/admin/sgg_index.json`, else null), `cap` (수용인원, int or null), `type`, `src`, `asof` (YYYY-MM-DD).\n")
    L.append("## Files\n")
    L.append("| kind | points | file(s) | bytes |")
    L.append("|---|---|---|---|")
    for kind, info in results.items():
        files = ", ".join(f"`{k}`" for k in info["files"]) if len(info["files"]) <= 3 else f"`{kind}/{{sido}}.geojson` x{len(info['files'])} (see index.json)"
        L.append(f"| {kind} | {info['count']:,} | {files} | {sum(info['files'].values()):,} |")
    if index:
        L.append("\n`index.json` maps `{kind: {sido_code: path}}` for kinds split per sido (file would exceed 6 MB).\n")
    L.append("\n## Sources (all keyless, no login)\n")
    for kind, srcs in SOURCES.items():
        L.append(f"### {kind}")
        for s in srcs:
            L.append(f"- **{s['name']}**")
            for k, v in s.items():
                if k == "name":
                    continue
                L.append(f"  - {k}: {v}")
        L.append("")
    L.append("## Processing stats (per kind)\n")
    for kind in results:
        L.append(f"- **{kind}**: {json.dumps(STATS.get(kind), ensure_ascii=False)}")
    L.append("\nNotes:")
    L.append("- civil_defense keeps only `운영상태 = 사용중` (사용중지/일시중지 dropped, see status_breakdown). `type` = 시설구분 / 지상·지하.")
    L.append("- heat: both the 표준데이터 (15013199) and the safekorea current-year layer are fetched; the larger set is written (`chosen_*` in stats). `type` on safekorea rows is the raw 쉼터유형 code.")
    L.append("- quake mixes 지진옥외대피장소 (safekorea) and 지진해일긴급대피장소 (표준데이터 15025449); distinguish with `type`.")
    L.append("- temp_housing: 이재민임시주거시설 layer, with `(지진겸용)` appended to `type` when the same facility also appears in the 지진겸용 layer.")
    L.append("- safekorea rows often lack a road address (`addr` null); `sgg` is still set from the queried 시군구.")
    L.append("- Split files: sido code `00` collects rows whose address has no recognisable 시도 prefix (`sgg` null); tiny bucket, safe to ignore or merge.")
    L.append("- quake 지진해일긴급대피장소 rows come from the 표준데이터 with 2020-era `asof` dates; safekorea 지진옥외대피소 rows are current (lastModfDt).")
    L.append("- CRS: sources deliver EPSG:4326 lat/lon directly; fallback reprojection (5179/5186/5181/5174 auto-detect) is only used when lat/lon is missing and a projected x/y exists (`reprojected_from_*` in stats). All points validated to lon 124–132 / lat 33–39.\n")
    L.append("## Not obtainable keyless (as of build date)\n")
    for n in NOT_OBTAINABLE:
        L.append(f"- **{n['kind']}**: {n['why']}")
    L.append("- data.go.kr `cmm/cmm/fileDownload.do?atchFileId=...` (파일데이터) requires a logged-in session: without one it returns a guidance PDF. Only 표준데이터 (`/download/standard.json`) is keyless.")
    if SK_COVERAGE:
        L.append("\n## safekorea layer coverage (시군구 fetched / 256)\n")
        for layer, c in SK_COVERAGE.items():
            L.append(f"- {layer}: {c['fetched_sgg']}/{c['total_sgg']}" + (f" — PARTIAL, missing 시군구: {' '.join(c['skipped_sgg'])}" if c['skipped_sgg'] else " — complete"))
        L.append("\nRe-run `python scripts/build_shelters.py` (optionally `SK_BUDGET_S=1200`) to fill missing 시군구; fetched ones are cached in .work_shelters/sk_*.json.")
    if FAILURES:
        L.append("\n## Fetch failures\n")
        for f in FAILURES[:50]:
            L.append(f"- {json.dumps(f, ensure_ascii=False)}")
        if len(FAILURES) > 50:
            L.append(f"- ... {len(FAILURES) - 50} more")
    L.append("\n## License / attribution\n")
    L.append("- 공공데이터포털 표준데이터 및 지방행정인허가데이터: 이용허락범위 제한 없음 (출처 표시 권장: 행정안전부 / 공공데이터포털).")
    L.append("- 국민안전24(safekorea.go.kr) 시설안전지도: 공공누리 제1유형 (출처표시) — 출처: 행정안전부 국민안전24.")
    L.append("- 시군구 코드/경계: `data/admin` (통계청 SGIS · vuski/admdongkor, CC BY 4.0).")
    (OUT / "README.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def main():
    global OFFLINE
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use only cached raw files")
    ap.add_argument("--kinds", default=",".join(BUILDERS), help="comma list of kinds to build")
    a = ap.parse_args()
    OFFLINE = a.offline
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    results = {}
    index = {}
    idx_path = OUT / "index.json"
    if idx_path.exists():
        index = json.loads(idx_path.read_text(encoding="utf-8"))
    for kind in a.kinds.split(","):
        kind = kind.strip()
        if kind not in BUILDERS:
            print("unknown kind", kind, file=sys.stderr)
            continue
        print(f"== {kind}", flush=True)
        try:
            feats = BUILDERS[kind]()
        except Exception as e:  # noqa: BLE001
            FAILURES.append({"kind": kind, "err": repr(e)})
            print(f"  FAILED {kind}: {e!r}", file=sys.stderr)
            continue
        validate(feats)
        index.pop(kind, None)
        results[kind] = write_kind(kind, feats, index)
        print(f"  {kind}: {len(feats)} points, stats={STATS.get(kind)}", flush=True)
    if index:
        idx_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    elif idx_path.exists():
        idx_path.unlink()
    write_readme(results, index)
    print(json.dumps({"results": results, "failures": FAILURES}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
