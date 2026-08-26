#!/usr/bin/env python
"""서울 25개 구 H3 res-9 격자 일괄 빌드 — build_grid.py(관악 파일럿)의 일반화판.

관악 파일럿과 동일 스키마/방법:
  경계    kr_emd.geojson에서 구별 dissolve (관악은 전용 boundary였음)
  DEM     Copernicus GLO-30 N37E126 + N37E127 (동서울은 127°E 이동) — keyless S3
  인구    행안부 주민등록 (jumin.mois.go.kr, keyless POST) — 구별 3개 표
  침수    서울시 침수흔적도 OA-15636 (keyless) — 서울 전체 1회 로드 후 구별 클립
출력: data/grid/<sgg>.geojson × 25 (이후 compute_shelter_walk.py로 대피소 도보 추가)
사용: python scripts/build_grid_seoul.py [sgg ...]   # 인자 없으면 25개 전부
"""
import json
import math
import os
import sys
import urllib.request

import numpy as np
import geopandas as gpd
import h3
import rasterio
from rasterio.merge import merge as rio_merge
from shapely.geometry import Point, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from build_grid import (ROOT, RES, NULL_SLOTS, JUMIN, JUMIN_YM, UA, FLOOD_SEQ,  # noqa: E402
                        _post, _csv_rows, _num, cell_poly)
from compute_shelter_walk import build as shelter_walk  # noqa: E402

WD = os.path.join(ROOT, ".work_grid")
DEM_TILES = {
    "E126": ("https://copernicus-dem-30m.s3.amazonaws.com/"
             "Copernicus_DSM_COG_10_N37_00_E126_00_DEM/Copernicus_DSM_COG_10_N37_00_E126_00_DEM.tif",
             os.path.join(WD, "dem_N37_00_E126_00.tif")),
    "E127": ("https://copernicus-dem-30m.s3.amazonaws.com/"
             "Copernicus_DSM_COG_10_N37_00_E127_00_DEM/Copernicus_DSM_COG_10_N37_00_E127_00_DEM.tif",
             os.path.join(WD, "dem_N37_00_E127_00.tif")),
}


def fetch_jumin_sgg(sgg: str) -> dict:
    """행안부 주민등록 3개 표 → {행정동코드: {pop,hh,elderly65_r,single_hh_r,elderly_alone_r}}"""
    import re
    y, m = JUMIN_YM
    base = dict(sltOrgType="2", sltOrgLvl1="1100000000", sltOrgLvl2=f"{sgg}00000", sltUndefType="",
                searchYearStart=y, searchMonthStart=m, searchYearEnd=y, searchMonthEnd=m,
                category="month", nowYear=y)
    try:
        stat = _csv_rows(_post(f"{JUMIN}/downloadCsv.do?searchYearMonth=month&xlsStats=1",
                               {**base, "gender": "gender", "genderPer": "genderPer", "generation": "generation",
                                "sltOrderType": "1", "sltOrderValue": "ASC"},
                               f"{JUMIN}/statMonth.do", os.path.join(WD, f"jumin_stat_{sgg}_{y}{m}.csv")))
        age = _csv_rows(_post(f"{JUMIN}/downloadCsvAge.do?searchYearMonth=month&xlsStats=1",
                              {**base, "gender": "gender", "sum": "sum", "sltOrderType": "1", "sltOrderValue": "ASC",
                               "sltArgTypes": "5", "sltArgTypeA": "0", "sltArgTypeB": "100"},
                              f"{JUMIN}/ageStatMonth.do", os.path.join(WD, f"jumin_age_{sgg}_{y}{m}.csv")))
        one = _csv_rows(_post(f"{JUMIN}/sexdAge1HshdDown.do?searchYearMonth=month&xlsStats=1&downType=Csv",
                              {**base, "sltArgTypes": "5", "sltArgTypeA": "0", "sltArgTypeB": "100",
                               "sttsGbn": "admm", "sum": "sum", "gender": "gender"},
                              f"{JUMIN}/sexdAge1Hshd.do?sttsGbn=admm", os.path.join(WD, f"jumin_1hh_{sgg}_{y}{m}.csv")))
    except Exception as e:  # noqa: BLE001
        print(f"WARN jumin {sgg} fetch failed:", e)
        return {}

    def code_of(label):
        mm = re.search(r"\((\d{10})\)", label)
        return mm.group(1) if mm else None

    def age65(header, row):
        tot = 0.0
        for h, v in zip(header, row):
            mm = re.match(r".*_계_(\d+)(~\d+세| 이상|세 이상)", h)
            if mm and int(mm.group(1)) >= 65:
                tot += _num(v)
        return tot

    out = {}
    for row in stat[1:]:
        c = code_of(row[0])
        if c and c != f"{sgg}00000":
            out[c] = {"pop": int(_num(row[1])), "hh": int(_num(row[2]))}
    for row in age[1:]:
        c = code_of(row[0])
        if c in out and out[c]["pop"]:
            out[c]["elderly65_r"] = round(age65(age[0], row) / out[c]["pop"], 4)
    for row in one[1:]:
        c = code_of(row[0])
        if c in out and out[c]["hh"]:
            out[c]["single_hh_r"] = round(_num(row[1]) / out[c]["hh"], 4)
            out[c]["elderly_alone_r"] = round(age65(one[0], row) / out[c]["hh"], 4)
    return out


def load_flood_seoul():
    """침수흔적도 전 연도 → GeoDataFrame(year, depth, geometry EPSG:5179) + sindex. 서울 전체 1회."""
    import zipfile, glob, warnings
    wd = os.path.join(WD, "flood")
    os.makedirs(wd, exist_ok=True)
    rows = []
    for yr, seq in FLOOD_SEQ.items():
        z = os.path.join(wd, f"{seq}.zip")
        try:
            _post("https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false",
                  dict(infId="OA-15636", seqNo="", seq=str(seq), infSeq="1"),
                  "https://data.seoul.go.kr/dataList/OA-15636/F/1/datasetView.do", z)
        except Exception as e:  # noqa: BLE001
            print(f"WARN flood {yr} download failed: {e}")
            continue
        d = os.path.join(wd, f"x{seq}")
        if not glob.glob(os.path.join(d, "*.shp")):
            os.makedirs(d, exist_ok=True)
            zf = zipfile.ZipFile(z)
            for i in zf.infolist():
                if i.is_dir():
                    continue
                ext = os.path.splitext(i.filename)[1].lower()
                open(os.path.join(d, f"f{seq}{ext}"), "wb").write(zf.read(i))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            g = gpd.read_file(glob.glob(os.path.join(d, "*.shp"))[0], encoding="cp949")
        g = g[g.geometry.notna()]
        g["geometry"] = g.buffer(0)
        if g.crs is None:
            g = g.set_crs(5179)
        elif g.crs.to_epsg() != 5179:
            g = g.to_crs(5179)
        depth = g["F_SHIM"] if "F_SHIM" in g else None
        for idx, geom in zip(g.index, g.geometry):
            dv = None
            if depth is not None:
                try:
                    dv = float(depth.loc[idx])
                except (TypeError, ValueError):
                    dv = None
            rows.append({"year": yr, "depth": dv, "geometry": geom})
        print(f"flood {yr}: {len(g)} polygons (서울 전체)")
    fl = gpd.GeoDataFrame(rows, crs=5179)
    return fl


def dem_window(bounds):
    """(minx,miny,maxx,maxy) EPSG:4326 → (elev array, slope array, transform)."""
    srcs = []
    for _, (url, path) in DEM_TILES.items():
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            print("downloading DEM", os.path.basename(path), "...")
            urllib.request.urlretrieve(url, path)
        srcs.append(rasterio.open(path))
    arr, tr = rio_merge(srcs, bounds=bounds, nodata=float("nan"))
    z = arr[0].astype("float64")
    lat0 = (bounds[1] + bounds[3]) / 2
    dy = abs(tr.e) * 111_320.0
    dx = abs(tr.a) * 111_320.0 * math.cos(math.radians(lat0))
    gy, gx = np.gradient(z, dy, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    for s in srcs:
        s.close()
    return z, slope, tr


def sample(arr, tr, poly):
    bx0, by0, bx1, by1 = poly.bounds
    c0, r1 = ~tr * (bx0, by0)
    c1, r0 = ~tr * (bx1, by1)
    r0, r1 = max(int(math.floor(r0)), 0), min(int(math.ceil(r1)), arr.shape[0] - 1)
    c0, c1 = max(int(math.floor(c0)), 0), min(int(math.ceil(c1)), arr.shape[1] - 1)
    vals = []
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            x, y = tr * (c + 0.5, r + 0.5)
            if poly.contains(Point(x, y)):
                vals.append(arr[r, c])
    if not vals:
        cx, cy = poly.centroid.x, poly.centroid.y
        c, r = ~tr * (cx, cy)
        vals = [arr[int(min(max(r, 0), arr.shape[0] - 1)), int(min(max(c, 0), arr.shape[1] - 1))]]
    return float(np.nanmean(vals))


def build_sgg(sgg, emd_all, flood, flood_sidx):
    emd = emd_all[emd_all["sgg_code"].astype(str) == sgg].reset_index(drop=True)
    if emd.empty:
        print(f"{sgg}: 행정동 없음, skip")
        return
    boundary = emd.geometry.union_all().buffer(0)
    geo = json.loads(json.dumps(boundary.__geo_interface__))
    core = set(h3.geo_to_cells(h3.geo_to_h3shape(geo), RES))
    cand = set(core)
    for h in core:
        cand |= set(h3.grid_disk(h, 1))
    cells = sorted(h for h in cand if cell_poly(h).intersects(boundary))
    z, slope, tr = dem_window(boundary.buffer(0.01).bounds)
    emd_tab = fetch_jumin_sgg(sgg)
    emd_sindex = emd.sindex
    emd_m = emd.to_crs(5179)
    feats = []
    for h in cells:
        poly = cell_poly(h)
        pm = gpd.GeoSeries([poly], crs=4326).to_crs(5179).iloc[0]
        area_km2 = pm.area / 1e6
        cen = poly.centroid
        hit = emd.iloc[list(emd_sindex.query(cen, predicate="within"))]
        edge = hit.empty
        if edge:
            cen_m = gpd.GeoSeries([cen], crs=4326).to_crs(5179).iloc[0]
            hit = emd.iloc[[emd_m.distance(cen_m).idxmin()]]
        code, name = str(hit.iloc[0]["code"]), hit.iloc[0]["name"]
        props = {"h3": h, "emd_code": code, "emd_name": name,
                 "area_km2": round(area_km2, 4), "edge": bool(edge),
                 "slope_mean": round(sample(slope, tr, poly), 2),
                 "elev_mean": round(sample(z, tr, poly), 1)}
        for k in NULL_SLOTS:
            props[k] = None
        if code in emd_tab:
            props.update(emd_tab[code])
            props["source_level"] = "emd"
        yrs, dmax = set(), None
        for i in flood_sidx.query(pm, predicate="intersects"):
            row = flood.iloc[i]
            yrs.add(int(row["year"]))
            if row["depth"] is not None and not (isinstance(row["depth"], float) and math.isnan(row["depth"])):
                dmax = row["depth"] if dmax is None else max(dmax, row["depth"])
        props["flood_hist_n"] = len(yrs)
        props["flood_years"] = sorted(yrs)
        props["flood_depth_max_m"] = dmax
        coords = [[round(x, 5), round(y, 5)] for x, y in poly.exterior.coords]
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": [coords]}})
    fc = {"type": "FeatureCollection", "name": f"grid_{sgg}_h3r{RES}",
          "meta": {"sgg_code": sgg, "h3_res": RES, "n_cells": len(feats),
                   "dem": "Copernicus GLO-30 (N37E126+E127)", "crs": "EPSG:4326",
                   "jumin_basis": "-".join(JUMIN_YM), "flood_years_covered": sorted(FLOOD_SEQ)},
          "features": feats}
    out = os.path.join(ROOT, "data", "grid", f"{sgg}.geojson")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    n_fl = sum(1 for f2 in feats if f2["properties"]["flood_hist_n"])
    print(f"{sgg}: cells {len(feats)}, flood-cells {n_fl}, emd-tables {len(emd_tab)}, "
          f"{os.path.getsize(out) / 1e6:.2f} MB")
    shelter_walk(sgg)


def main():
    targets = sys.argv[1:] or None
    sgg_geo = gpd.read_file(os.path.join(ROOT, "data", "admin", "kr_sgg.geojson"))
    seoul = sorted(str(c) for c in sgg_geo["code"] if str(c).startswith("11"))
    if targets:
        seoul = [s for s in seoul if s in targets]
    print("대상 구:", len(seoul))
    emd_all = gpd.read_file(os.path.join(ROOT, "data", "admin", "kr_emd.geojson"))
    flood = load_flood_seoul()
    flood_sidx = flood.sindex
    for i, sgg in enumerate(seoul, 1):
        print(f"--- [{i}/{len(seoul)}] {sgg}")
        try:
            build_sgg(sgg, emd_all, flood, flood_sidx)
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {sgg}: {e}")
    print("done")


if __name__ == "__main__":
    main()
