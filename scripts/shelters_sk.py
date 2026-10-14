"""국민안전24(safekorea) 시설안전지도 층 — 시군구별 조회, 옛 코드(LEGACY_SK·GJ_JN_OLD) 보완, 공용 빌더(build_shelters.py에서 분리)."""
from __future__ import annotations

import json
import os
import time
import urllib.parse

import shelters_common as sc
from shelters_common import *  # noqa: F401,F403

# ----------------------------------------------------------------------------- safekorea 시설안전지도 (keyless POST)

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


# 2026-07-01 개편(인천 중·동·서구 → 제물포·영종·서해·검단구, 화성시 → 4개 구) 뒤에도 safekorea는 옛 코드로만 자료를 줌(새 코드 = 0건, 10-10 확인).
# 옛 코드도 요청하고, 그 행은 feature()에서 위치로 새 구를 정한다.
LEGACY_SK = {"28110", "28140", "28260", "41590"}
# 10-14: 광주·전남 통합(sido 12) 뒤에도 일부 층(응급의료센터·미세먼지쉼터·광주 경찰서)은 옛 코드(광주 29xxx·전남 46xxx)로만 자료를 줌(새 12xxx = 0건).
# 다른 층(임시주거시설·무더위쉼터 등)은 새 코드로 잘 와서 이름 대조로는 중복이 남을 수 있음 → 옛 코드 결과는 대응 새 코드가 0건일 때만 쓴다.
# 10-14 정정(code-review): 통합 때 전남 시군은 번호가 다시 매겨져 뒤 세 자리가 옛 코드와 다르다(광양 46230→12190 등) → 행정 코드표 그대로 명시.
GJ_JN_OLD = {
    "46110": "12110",  # 목포시
    "46130": "12130",  # 여수시
    "46150": "12150",  # 순천시
    "46170": "12170",  # 나주시
    "46230": "12190",  # 광양시
    "46710": "12710",  # 담양군
    "46720": "12720",  # 곡성군
    "46730": "12730",  # 구례군
    "46770": "12740",  # 고흥군
    "46780": "12750",  # 보성군
    "46790": "12760",  # 화순군
    "46800": "12770",  # 장흥군
    "46810": "12780",  # 강진군
    "46820": "12790",  # 해남군
    "46830": "12800",  # 영암군
    "46840": "12810",  # 무안군
    "46860": "12820",  # 함평군
    "46870": "12830",  # 영광군
    "46880": "12840",  # 장성군
    "46890": "12850",  # 완도군
    "46900": "12860",  # 진도군
    "46910": "12870",  # 신안군
    "29110": "12210",  # 동구
    "29140": "12240",  # 서구
    "29155": "12270",  # 남구
    "29170": "12300",  # 북구
    "29200": "12330",  # 광산구
}


def safekorea_layer(layer: str) -> dict[str, list[dict]]:
    """Fetch one 시설안전지도 layer for every 시군구 (256 codes from data/admin)."""
    table, kor = SK_LAYERS[layer]
    out = {}
    codes = sorted(sgg_index()["codes"] | LEGACY_SK | set(GJ_JN_OLD))
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

        # 0건 저장본이 7일 넘으면 다시 받음 — 개편 직후엔 새 코드가 비어 있다가 나중에 채워짐(10-11: 광주·전남 8월 저장본 0건 → 지금은 있음)
        cp = CACHE / name
        if not sc.OFFLINE and cp.exists() and time.time() - cp.stat().st_mtime > 7 * 86400 and '"rows": []' in cp.read_text(encoding="utf-8")[-200:]:
            cp.unlink()
        if not (CACHE / name).exists() and (sc.OFFLINE or time.time() - t0 > budget):
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
    # 옛 코드(LEGACY_SK) 행은 같은 구(위치로 정함) 안에 같은 이름의 행이 새 코드 결과에 있으면 뺌.
    #  층·구마다 safekorea가 새 코드로 일부만 줌(10-11: 효행구 새 코드 1건 + 옛 화성시 코드 48건). 같은 시설도 두 결과의 좌표가 수십 m 달라 좌표로는 못 맞춤.
    nm = lambda r: (f"{r.get('occuDate')} {clean(r.get('resn')) or ''}" if r.get("occuDate") else  # noqa: E731  산불이력 = 날짜+원인
                    clean(r.get("rstrNm")) or clean(r.get("title")) or clean(r.get("vtAcmdfcltyNm")) or clean(r.get("facilNm")) or clean(r.get("facilityName")))
    have = {(c, nm(r)) for c, rs in out.items() if c not in LEGACY_SK for r in rs}
    for lc in (LEGACY_SK | set(GJ_JN_OLD)) & set(out):   # 옛 코드 행은 새 코드 결과에 같은 (위치로 정한 구, 이름)이 있으면 뺌
        keep = []
        for r in out[lc]:
            lo, la = sk_xy(r)
            nc = sgg_from_point(lo, la) if lo is not None and la is not None else None
            if (nc, nm(r)) not in have:
                keep.append(r)
        out[lc] = keep
    # 0건 시군구 경고(10-11 교훈: 행정구역 개편 뒤 새 코드가 조용히 0건이었음). 층에 따라 0이 정상인 곳도 있어 경고만
    zero = sorted(c for c in sgg_index()["codes"] if c in out and not out[c] and not any(sgg_from_point(*sk_xy(r)) == c for lc in (LEGACY_SK | set(GJ_JN_OLD)) & set(out) for r in out[lc] if sk_xy(r)[0] is not None))
    if zero:
        print(f"  ⚠ safekorea {kor}: 0건 시군구 {len(zero)}곳 {zero[:12]}{' …' if len(zero) > 12 else ''}", flush=True)
    SK_COVERAGE[layer] = {"fetched_sgg": len(out), "total_sgg": len(codes), "skipped_sgg": skipped, "zero_sgg": zero}
    if skipped:
        FAILURES.append({"src": f"safekorea {kor}", "err": f"time budget {budget:.0f}s exhausted; {len(skipped)} of {len(codes)} 시군구 not fetched (partial layer)"})
    return out



def dms(d, m, sec):
    d, m, sec = to_float(d), to_float(m), to_float(sec)
    if d is None:
        return None
    return d + (m or 0) / 60 + (sec or 0) / 3600


def sk_xy(r):
    """safekorea 행의 경위도 — 층마다 형식이 다름(lo/la · 도분초 · web mercator)."""
    lon, lat = to_float(r.get("lo")), to_float(r.get("la"))
    if lon is None and r.get("facilLode") is not None:  # 비상급수시설: DMS
        lon, lat = dms(r.get("facilLode"), r.get("facilLomi"), r.get("facilLose")), dms(r.get("facilLade"), r.get("facilLami"), r.get("facilLase"))
    if lon is None and r.get("gisCrdntPnttmLodg") is not None:  # 급경사지: DMS (시점)
        lon, lat = dms(r.get("gisCrdntPnttmLodg"), r.get("gisCrdntPnttmLoMin"), r.get("gisCrdntPnttmLoSecnd")), dms(r.get("gisCrdntPnttmLadg"), r.get("gisCrdntPnttmLaMin"), r.get("gisCrdntPnttmLaSecnd"))
    if lon is not None and abs(lon) > 1000:  # 산불이력: web mercator (EPSG:3857) in lo/la
        R_ = 6378137.0
        lon, lat = lon / R_ * 180 / math.pi, (2 * math.atan(math.exp(lat / R_)) - math.pi / 2) * 180 / math.pi
    return lon, lat


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
                lon, lat = sk_xy(r)
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


