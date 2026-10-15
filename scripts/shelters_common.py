"""시설 빌더 공통 — HTTP·캐시·행정 색인·좌표·통계·출력(build_shelters.py에서 분리, 10-14 500줄 규칙).
OFFLINE은 build_shelters.main()이 sc.OFFLINE으로 바꾼다(다른 모듈은 sc.OFFLINE으로 읽을 것)."""
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


def feature(kind, lon, lat, name, addr, cap, typ, src, asof, sgg=None):
    if MILITARY.search(f"{name or ''} {addr or ''} {typ or ''}"):
        STATS.add(kind, "dropped_military")
        return None
    if not in_bounds(lon, lat):
        STATS.add(kind, "dropped_no_or_bad_coords")
        return None
    if sgg is not None and sgg not in sgg_index()["codes"]:
        sgg = sgg_from_point(lon, lat) or GJ_JN_OLD.get(sgg)   # 옛 시군구 코드로 받은 행(LEGACY_SK·GJ_JN_OLD)
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



SK_COVERAGE: dict[str, dict] = {}
