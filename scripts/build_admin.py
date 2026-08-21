#!/usr/bin/env python
"""
Build nationwide Korean administrative boundaries for disaster-compass.

Source : vuski/admdongkor (행정동 경계, WGS84) -- derived from 통계청 SGIS (공공누리 1유형), CC BY 4.0
Output : data/admin/{kr_sido,kr_sgg,kr_emd,gwanak_boundary}.geojson,
         emd_index.json, sgg_index.json, meta.json, README.md

Pipeline
  1. download HangJeongDong_ver<VERSION>.geojson (cached in --work dir)
  2. geopandas: normalise attributes (code/name/sgg/sido), compute representative
     points + 기상청 DFS grid (nx, ny) from the UNSIMPLIFIED polygons
  3. mapshaper: dissolve emd -> sgg -> sido, simplify each level (Visvalingam,
     keep-shapes; shared borders stay consistent), write GeoJSON
  4. validate + write indexes / meta / README

Usage: python scripts/build_admin.py [--version 20260701] [--work <dir>] [--emd-pct 6] ...
Requires: geopandas, shapely, Node (npx mapshaper).
"""
import argparse
import datetime
import json
import math
import os
import subprocess
import urllib.request
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "admin"
SEJONG_SGG = "36110"
SEJONG_NAME = "세종특별자치시"
GWANAK = "11620"

# ---------------------------------------------------------------- KMA DFS grid
RE, GRID = 6371.00877, 5.0
SLAT1, SLAT2, OLON, OLAT, XO, YO = 30.0, 60.0, 126.0, 38.0, 43, 136


def dfs_xy_conv(lat, lon):
    """Standard 기상청 단기예보 lat/lon -> (nx, ny) (Lambert conformal conic)."""
    D = math.pi / 180.0
    re = RE / GRID
    slat1, slat2, olon, olat = SLAT1 * D, SLAT2 * D, OLON * D, OLAT * D
    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = sf ** sn * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re * sf / ro ** sn
    ra = math.tan(math.pi * 0.25 + lat * D * 0.5)
    ra = re * sf / ra ** sn
    theta = lon * D - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn
    x = int(ra * math.sin(theta) + XO + 0.5)
    y = int(ro - ra * math.cos(theta) + YO + 0.5)
    return x, y


assert dfs_xy_conv(37.5665, 126.9780) == (60, 127), "DFS sanity check failed (서울시청)"


# ---------------------------------------------------------------- helpers
def sh(cmd):
    print("  $", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, shell=(os.name == "nt"))


def mapshaper(*args):
    sh(["npx", "-y", "mapshaper", *args])


def kb(p):
    return f"{Path(p).stat().st_size / 1024:,.0f} KB"


def download(url, dst):
    if dst.exists() and dst.stat().st_size > 1_000_000:
        print(f"  cached {dst.name} ({kb(dst)})")
        return
    print(f"  downloading {url}")
    urllib.request.urlretrieve(url, dst)
    print(f"  -> {kb(dst)}")


def write_json(path, obj, compact=True):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=2)


def fix_invalid(path, precision):
    """Repair any geometry left invalid by simplification (rare self-touching rings)."""
    df = gpd.read_file(path)
    bad = ~df.is_valid
    if not bad.any():
        return 0
    from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
    from shapely.ops import unary_union

    def fix(geom):
        g = make_valid(geom)
        if isinstance(g, GeometryCollection):
            g = unary_union([p for p in g.geoms if isinstance(p, (Polygon, MultiPolygon))])
        return g
    df.loc[bad, "geometry"] = df.loc[bad, "geometry"].apply(fix)
    df.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=precision, RFC7946="NO")
    return int(bad.sum())


def rep_rows(gdf, keys):
    rows = []
    for _, r in gdf.iterrows():
        p = r.geometry.representative_point()
        lat, lon = round(p.y, 5), round(p.x, 5)
        nx, ny = dfs_xy_conv(lat, lon)
        d = {k: r[k] for k in keys}
        d.update(lat=lat, lon=lon, nx=nx, ny=ny)
        rows.append(d)
    return rows


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="20260701")
    ap.add_argument("--work", default=str(ROOT / ".work_admin"))
    ap.add_argument("--emd-pct", default="20")
    ap.add_argument("--sgg-pct", default="25")
    ap.add_argument("--sido-pct", default="12")
    ap.add_argument("--gwanak-pct", default="60")
    a = ap.parse_args()

    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    src_name = f"HangJeongDong_ver{a.version}.geojson"
    src_url = f"https://raw.githubusercontent.com/vuski/admdongkor/master/ver{a.version}/{src_name}"
    raw = work / src_name

    print("[1] download")
    download(src_url, raw)

    print("[2] normalise attributes (geopandas)")
    g = gpd.read_file(raw)
    assert str(g.crs).upper().endswith("4326")
    g["geometry"] = g.geometry.apply(lambda x: x if x.is_valid else make_valid(x))
    g = g[~g.geometry.is_empty].copy()
    sgg_code = g["sgg"].astype(str)
    emd = gpd.GeoDataFrame({
        "code": g["adm_cd2"].astype(str),
        "name": g["adm_nm"].str.split().str[-1],
        "sgg_code": sgg_code,
        "sgg_name": g["sggnm"].where(sgg_code != SEJONG_SGG, SEJONG_NAME),
        "sido_code": g["sido"].astype(str),
        "sido_name": g["sidonm"],
    }, geometry=g.geometry, crs="EPSG:4326")
    assert emd.code.is_unique and emd.code.str.len().between(8, 10).all()
    prepared = work / "emd_prepared.geojson"
    emd.to_file(prepared, driver="GeoJSON")

    print("[3] mapshaper: simplify + dissolve")
    emd_out = OUT / "kr_emd.geojson"
    sgg_out = OUT / "kr_sgg.geojson"
    sido_out = OUT / "kr_sido.geojson"
    gw_out = OUT / "gwanak_boundary.geojson"
    prep = str(prepared)
    # 행정동 level
    mapshaper("-i", prep, "-simplify", f"{a.emd_pct}%", "keep-shapes", "planar",
              "-clean", "-o", str(emd_out), "precision=0.00001", "format=geojson")
    # 시군구 = dissolve of unsimplified 행정동, then simplify
    mapshaper("-i", prep, "-dissolve", "sgg_code", "copy-fields=sgg_name,sido_code,sido_name",
              "-rename-fields", "code=sgg_code,name=sgg_name",
              "-simplify", f"{a.sgg_pct}%", "keep-shapes", "planar", "-clean",
              "-o", str(sgg_out), "precision=0.00001", "format=geojson")
    # 시도
    mapshaper("-i", prep, "-dissolve", "sido_code", "copy-fields=sido_name",
              "-rename-fields", "code=sido_code,name=sido_name",
              "-simplify", f"{a.sido_pct}%", "keep-shapes", "planar", "-clean",
              "-o", str(sido_out), "precision=0.00001", "format=geojson")
    # 관악구 single polygon, light simplification
    mapshaper("-i", prep, "-filter", f"sgg_code=='{GWANAK}'", "-dissolve", "sgg_code",
              "copy-fields=sgg_name,sido_code,sido_name", "-rename-fields", "code=sgg_code,name=sgg_name",
              "-simplify", f"{a.gwanak_pct}%", "keep-shapes", "planar", "-clean",
              "-o", str(gw_out), "precision=0.000001", "format=geojson")

    for p, prec in ((emd_out, 5), (sgg_out, 5), (sido_out, 5), (gw_out, 6)):
        n = fix_invalid(p, prec)
        if n:
            print(f"  repaired {n} invalid geometries in {p.name}")

    print("[4] indexes (representative points from unsimplified geometry)")
    sgg_full = emd.dissolve(by="sgg_code", aggfunc={"sgg_name": "first", "sido_code": "first",
                                                     "sido_name": "first"}).reset_index()
    emd_idx = [{"code": r["code"], "name": r["name"], "sgg": r["sgg_code"], "sgg_name": r["sgg_name"],
                "sido": r["sido_code"], "sido_name": r["sido_name"],
                "lat": r["lat"], "lon": r["lon"], "nx": r["nx"], "ny": r["ny"]}
               for r in rep_rows(emd, ["code", "name", "sgg_code", "sgg_name", "sido_code", "sido_name"])]
    sgg_idx = [{"code": r["sgg_code"], "name": r["sgg_name"], "sido": r["sido_code"],
                "sido_name": r["sido_name"], "lat": r["lat"], "lon": r["lon"], "nx": r["nx"], "ny": r["ny"]}
               for r in rep_rows(sgg_full, ["sgg_code", "sgg_name", "sido_code", "sido_name"])]
    write_json(OUT / "emd_index.json", emd_idx)
    write_json(OUT / "sgg_index.json", sgg_idx)

    print("[5] validate")
    E, S, D, GW = (gpd.read_file(p) for p in (emd_out, sgg_out, sido_out, gw_out))
    for nm, df in (("emd", E), ("sgg", S), ("sido", D), ("gwanak", GW)):
        bad = int((~df.is_valid).sum())
        assert int(df.is_empty.sum()) == 0, f"{nm}: empty geometries"
        if bad:
            print(f"  WARN {nm}: {bad} invalid geometries after simplification")
    assert set(E.sgg_code) <= set(S.code), "emd.sgg_code not in kr_sgg"
    assert set(S.sido_code) <= set(D.code), "sgg.sido_code not in kr_sido"
    assert len(E) == len(emd) and len(S) == emd.sgg_code.nunique() and len(D) == emd.sido_code.nunique()
    assert len(GW) == 1 and GW.code[0] == GWANAK
    assert {x["code"] for x in emd_idx} == set(E.code) and {x["code"] for x in sgg_idx} == set(S.code)
    emd_by = emd.set_index("code").geometry
    miss = sum(not emd_by[x["code"]].intersects(Point(x["lon"], x["lat"])) for x in emd_idx)
    assert miss == 0, f"{miss} rep points outside polygon"

    counts = {"sido": len(D), "sgg": len(S), "emd": len(E)}
    sizes = {p.name: p.stat().st_size for p in sorted(OUT.glob("*.*json"))}
    meta = {
        "source": "vuski/admdongkor (https://github.com/vuski/admdongkor), derived from 통계청 SGIS 행정동 경계",
        "source_file": src_url,
        "version": a.version,
        "license": "CC BY 4.0 (admdongkor) / 공공누리 제1유형 (SGIS)",
        "crs": "EPSG:4326",
        "level": "행정동 (administrative dong), not 법정동; 리 not included",
        "simplify": {"emd": f"{a.emd_pct}%", "sgg": f"{a.sgg_pct}%", "sido": f"{a.sido_pct}%",
                     "gwanak": f"{a.gwanak_pct}%", "method": "mapshaper visvalingam keep-shapes planar"},
        "built": datetime.date.today().isoformat(),
        "counts": counts,
        "sizes_bytes": sizes,
    }
    write_json(OUT / "meta.json", meta, compact=False)
    write_readme(meta)
    print("\n== result ==")
    for k, v in sizes.items():
        print(f"  {k:24s} {v/1024:8,.0f} KB")
    print("  counts", counts)


def write_readme(m):
    rows = "\n".join(f"| {k} | {v/1024:,.0f} KB |" for k, v in m["sizes_bytes"].items())
    s = m["simplify"]
    c = m["counts"]
    text = f"""# data/admin — Korean administrative boundaries

Built {m['built']} by `scripts/build_admin.py` (do not hand-edit).

| item | value |
|---|---|
| Source | [vuski/admdongkor](https://github.com/vuski/admdongkor) `ver{m['version']}` (`HangJeongDong_ver{m['version']}.geojson`) |
| Upstream | 통계청 SGIS 행정동 경계 (공공누리 제1유형, 출처표시) → corrected/extended by admdongkor |
| License | CC BY 4.0 (data). Attribution required: "통계청 SGIS · vuski/admdongkor" |
| CRS | EPSG:4326 (WGS84), coords rounded to 1e-5 deg (gwanak 1e-6) |
| Level | **행정동** (administrative dong/읍/면). 법정동 and 리 are NOT included. |
| Simplification | mapshaper Visvalingam `keep-shapes planar`, vertices retained: emd {s['emd']}, sgg {s['sgg']}, sido {s['sido']}, gwanak {s['gwanak']}. sgg/sido dissolved from the unsimplified 행정동 layer. |
| Counts | sido {c['sido']}, sgg {c['sgg']}, emd {c['emd']} |

## Files

| file | size |
|---|---|
{rows}

- `kr_sido.geojson` props: `code`(2), `name`
- `kr_sgg.geojson` props: `code`(5), `name`, `sido_code`, `sido_name` — 세종 is one feature `36110 세종특별자치시`
- `kr_emd.geojson` props: `code`(10-digit 행정동 코드, 행안부 체계), `name`, `sgg_code`, `sgg_name`, `sido_code`, `sido_name`
- `emd_index.json` / `sgg_index.json`: `lat`/`lon` = representative point guaranteed inside the (unsimplified) polygon; `nx`/`ny` = 기상청 단기예보 DFS grid (RE 6371.00877, GRID 5 km, SLAT 30/60, OLON 126, OLAT 38, XO 43, YO 136)
- `gwanak_boundary.geojson`: 관악구(11620) dissolved outline
- `meta.json`: machine-readable version of this table

## Caveats
- Version {m['version']} reflects the 2026-07-01 reorganisation (e.g. 광주+전남 → `12 전남광주통합특별시`); codes may differ from older KOSTAT 2018 files.
- 출장소 (no boundary) are not present. Island/marine boundaries follow SGIS conventions.
- `code` is the 10-digit 행정동 code (`adm_cd2`); the 8-digit 통계청 code is not carried.
"""
    (OUT / "README.md").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
