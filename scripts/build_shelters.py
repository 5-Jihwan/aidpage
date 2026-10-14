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


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shelters_common as sc  # noqa: E402
from shelters_common import *  # noqa: E402,F401,F403
from shelters_sk import *  # noqa: E402,F401,F403

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


def build_underpass() -> list[dict]:
    """지하차도 (위험 지점) — geometry from OpenStreetMap tunnel ways (centre point), attributes joined by name
    from 국토교통부 '시설물안전법 대상 지하차도 현황' (data.go.kr 15124755, 938 rows; addresses only, no coords).
    Unmatched MOLIT rows are NOT placed (no geocoding)."""
    kind = "underpass"
    q = ('[out:json][timeout:240];area["ISO3166-1"="KR"]->.kr;(way["name"~"지하차도|지하도로|굴다리|언더패스"]["highway"](area.kr);'
         'way["tunnel"]["highway"]["name"~"지하"](area.kr););out center tags;')
    raw = cached("osm_underpass.json", lambda: http("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "safepic/0.1"}, timeout=300))
    j = json.loads(raw)
    molit_raw = cached("molit_underpass.csv", lambda: http("https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002881351&fileDetailSn=1&insertDataPrcus=N", headers={"User-Agent": "Mozilla/5.0"}), binary=True)
    import csv, io
    norm = lambda t: re.sub(r"\s|\(.*?\)|제|지하차도|지하도로|지하도|굴다리|언더패스|_", "", t or "")
    molit = {}
    for r in csv.DictReader(io.StringIO(molit_raw.decode("cp949", "ignore"))):
        molit.setdefault(norm(r.get("시설물명")), []).append(r)
    feats, seen = [], set()
    for e in j.get("elements", []):
        t = e.get("tags", {}); name = clean(t.get("name")); c = e.get("center") or {}
        if not name or "보도" in name: continue  # 지하보도(pedestrian) excluded
        STATS.add(kind, "raw_ways")
        lon, lat = to_float(c.get("lon")), to_float(c.get("lat"))
        key = (norm(name), round(lon or 0, 2), round(lat or 0, 2))
        if key in seen: STATS.add(kind, "dropped_duplicate_way"); continue
        seen.add(key)
        sgg = sgg_from_point(lon, lat) if in_bounds(lon, lat) else None
        m = molit.get(norm(name), [])
        # disambiguate by sido name in 위치 vs matched sgg's sido
        mrow = None
        if m:
            prov = (t.get("addr:province", "") + t.get("addr:city", ""))
            mrow = m[0] if len(m) == 1 else next((r for r in m if r.get("위치", "").split(" ")[0][:2] in prov), None)
        typ = None
        if mrow:
            STATS.add(kind, "molit_matched")
            typ = f"{mrow.get('종별') or ''} · {mrow.get('항목명') or ''}".strip(" ·")
        addr = (mrow or {}).get("위치") or t.get("addr:full") or None
        f = feature(kind, lon, lat, name, addr, None, typ, "osm+molit" if mrow else "osm", TODAY, sgg=sgg)
        if f: feats.append(f)
    SOURCES[kind].append({"name": "OpenStreetMap 지하차도 tunnel ways (centre points) + 국토교통부 시설물안전법 대상 지하차도 현황(15124755) 이름 대조",
                          "url": "https://www.data.go.kr/data/15124755/fileData.do", "endpoint": "https://overpass-api.de/api/interpreter",
                          "fetched": TODAY, "raw_rows": len(j.get("elements", [])), "molit_rows": sum(len(v) for v in molit.values()),
                          "license": "ODbL 1.0 (OSM) · 공공누리 (MOLIT)"})
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
    "underpass": build_underpass,
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use only cached raw files")
    ap.add_argument("--kinds", default=",".join(BUILDERS), help="comma list of kinds to build")
    a = ap.parse_args()
    sc.OFFLINE = a.offline
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

