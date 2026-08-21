#!/usr/bin/env python
"""Build data/grid/11620.geojson — H3 res-9 analysis grid for 관악구 (11620).

Inputs
  data/admin/gwanak_boundary.geojson   dissolved 관악구 outline (EPSG:4326)
  data/admin/kr_emd.geojson            행정동 polygons (props code/name/sgg_code)
  .work_grid/dem_N37_00_E126_00.tif    Copernicus GLO-30 DEM tile (1x1 deg, 30 m)
      https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N37_00_E126_00_DEM/
      Copernicus_DSM_COG_10_N37_00_E126_00_DEM.tif  (keyless)
  .work_grid/jumin_*.csv    행안부 주민등록 통계 (jumin.mois.go.kr, keyless CSV POST; auto-fetched)
  .work_grid/flood/*.zip    서울시 침수흔적도 shapefiles 2010-2025 (data.seoul.go.kr OA-15636, keyless; auto-fetched)

Output
  data/grid/11620.geojson  (+ data/grid/README.md written separately)

Usage: python scripts/build_grid.py
"""
import json, math, os, sys, urllib.request
import numpy as np
import geopandas as gpd
import h3
import rasterio
from rasterio.windows import from_bounds
from shapely.geometry import Polygon, shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SGG = "11620"
RES = 9
DEM_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
           "Copernicus_DSM_COG_10_N37_00_E126_00_DEM/"
           "Copernicus_DSM_COG_10_N37_00_E126_00_DEM.tif")
DEM = os.path.join(ROOT, ".work_grid", "dem_N37_00_E126_00.tif")
OUT = os.path.join(ROOT, "data", "grid", f"{SGG}.geojson")
EMD_TABLE = os.path.join(ROOT, ".work_grid", "emd_tables.csv")

NULL_SLOTS = ["flood_hist_n", "flood_depth_max_m", "flood_risk_100y",
              "semi_basement_r", "elderly_alone_r", "bldg_age30_r",
              "shelter_min_walk", "pop"]


JUMIN = "https://jumin.mois.go.kr"
JUMIN_YM = ("2026", "07")   # 기준월 (latest available when built)
UA = {"User-Agent": "Mozilla/5.0 (safepic build_grid)"}


def _post(url, data, referer, out):
    """POST form -> file (keyless). Returns bytes; caches to .work_grid."""
    import urllib.parse
    if os.path.exists(out) and os.path.getsize(out) > 100:
        return open(out, "rb").read()
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(),
                                 headers={**UA, "Referer": referer})
    b = urllib.request.urlopen(req, timeout=120).read()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "wb").write(b)
    return b


def _csv_rows(b):
    import csv, io
    return list(csv.reader(io.StringIO(b.decode("cp949"))))


def _num(x):
    return float(str(x).replace(",", "").strip() or 0)


def fetch_jumin():
    """행안부 주민등록 인구통계 (jumin.mois.go.kr) 관악구 행정동별 3개 표 -> dict by 10-digit 행정동 코드.
    pop            : 총인구수 (주민등록 인구 및 세대현황, downloadCsv.do)
    hh             : 세대수
    elderly65_r    : 65세 이상 인구 / 총인구 (연령별 인구현황 5세 구간, downloadCsvAge.do)
    elderly_alone_r: 65세 이상 1인세대 / 총세대수 (성/연령별 주민등록 1인세대수, sexdAge1HshdDown.do)
    single_hh_r    : 1인세대 / 총세대수
    """
    import re
    y, m = JUMIN_YM
    wd = os.path.join(ROOT, ".work_grid")
    base = dict(sltOrgType="2", sltOrgLvl1="1100000000", sltOrgLvl2="1162000000", sltUndefType="",
                searchYearStart=y, searchMonthStart=m, searchYearEnd=y, searchMonthEnd=m,
                category="month", nowYear=y)
    try:
        stat = _csv_rows(_post(f"{JUMIN}/downloadCsv.do?searchYearMonth=month&xlsStats=1",
                               {**base, "gender": "gender", "genderPer": "genderPer", "generation": "generation",
                                "sltOrderType": "1", "sltOrderValue": "ASC"},
                               f"{JUMIN}/statMonth.do", os.path.join(wd, f"jumin_stat_{y}{m}.csv")))
        age = _csv_rows(_post(f"{JUMIN}/downloadCsvAge.do?searchYearMonth=month&xlsStats=1",
                              {**base, "gender": "gender", "sum": "sum", "sltOrderType": "1", "sltOrderValue": "ASC",
                               "sltArgTypes": "5", "sltArgTypeA": "0", "sltArgTypeB": "100"},
                              f"{JUMIN}/ageStatMonth.do", os.path.join(wd, f"jumin_age_{y}{m}.csv")))
        one = _csv_rows(_post(f"{JUMIN}/sexdAge1HshdDown.do?searchYearMonth=month&xlsStats=1&downType=Csv",
                              {**base, "sltArgTypes": "5", "sltArgTypeA": "0", "sltArgTypeB": "100",
                               "sttsGbn": "admm", "sum": "sum", "gender": "gender"},
                              f"{JUMIN}/sexdAge1Hshd.do?sttsGbn=admm", os.path.join(wd, f"jumin_1hh_{y}{m}.csv")))
    except Exception as e:  # network failure: leave slots null
        print("WARN jumin fetch failed:", e)
        return {}

    def code_of(label):
        mm = re.search(r"\((\d{10})\)", label)
        return mm.group(1) if mm else None

    def age65(header, row):
        """sum of 계_ age-band columns whose lower bound >= 65."""
        tot = 0.0
        for h, v in zip(header, row):
            mm = re.match(r".*_계_(\d+)(~\d+세| 이상|세 이상)", h)
            if mm and int(mm.group(1)) >= 65:
                tot += _num(v)
        return tot

    out = {}
    for row in stat[1:]:
        c = code_of(row[0])
        if c and c != "1162000000":
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
    print(f"jumin: {len(out)} 행정동, basis {y}-{m}")
    return out


FLOOD_SEQ = {  # data.seoul.go.kr OA-15636 서울시 침수흔적도, file seq per year (2015/2021: no-flood years, no file)
    2010: 4, 2011: 5, 2012: 6, 2013: 7, 2014: 8, 2016: 9, 2017: 10, 2018: 11, 2019: 12, 2020: 13,
    2022: 30, 2023: 31, 2024: 32, 2025: 103}


def fetch_flood(boundary):
    """서울시 침수흔적도 (OA-15636) shapefiles -> [(year, geom EPSG:5179, 침수심 m|None)] clipped to 관악구."""
    import zipfile, glob, warnings
    wd = os.path.join(ROOT, ".work_grid", "flood")
    os.makedirs(wd, exist_ok=True)
    bnd_m = gpd.GeoSeries([boundary], crs=4326).to_crs(5179).iloc[0]
    out = []
    for yr, seq in FLOOD_SEQ.items():
        z = os.path.join(wd, f"{seq}.zip")
        try:
            _post("https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false",
                  dict(infId="OA-15636", seqNo="", seq=str(seq), infSeq="1"),
                  "https://data.seoul.go.kr/dataList/OA-15636/F/1/datasetView.do", z)
        except Exception as e:
            print(f"WARN flood {yr} download failed: {e}")
            continue
        d = os.path.join(wd, f"x{seq}")
        if not glob.glob(os.path.join(d, "*.shp")):
            os.makedirs(d, exist_ok=True)
            zf = zipfile.ZipFile(z)
            for i in zf.infolist():  # zip member names are cp949-mangled; rename to ascii
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
        g = g[g.intersects(bnd_m)]
        depth = g["F_SHIM"] if "F_SHIM" in g else None
        for idx, geom in zip(g.index, g.geometry):
            dv = None
            if depth is not None:
                try:
                    dv = float(depth.loc[idx])
                except (TypeError, ValueError):
                    dv = None
            out.append((yr, geom, dv))
        print(f"flood {yr}: {len(g)} polygons in 관악구")
    return out


def cell_poly(h):
    # h3 v4 returns (lat, lng) pairs
    return Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(h)])


def main():
    bnd = gpd.read_file(os.path.join(ROOT, "data", "admin", "gwanak_boundary.geojson"))
    boundary = bnd.geometry.union_all()
    emd = gpd.read_file(os.path.join(ROOT, "data", "admin", "kr_emd.geojson"))
    emd = emd[emd["sgg_code"].astype(str) == SGG].reset_index(drop=True)
    print(f"boundary ok, 행정동 {len(emd)}")

    # --- H3 cells: polygon_to_cells (centroid-in) + ring-1, filtered by intersection
    geo = json.loads(json.dumps(boundary.__geo_interface__))
    core = set(h3.geo_to_cells(h3.geo_to_h3shape(geo), RES))
    cand = set(core)
    for h in core:
        cand |= set(h3.grid_disk(h, 1))
    cells = sorted(h for h in cand if cell_poly(h).intersects(boundary))
    print(f"core {len(core)}, candidates {len(cand)}, kept {len(cells)}")

    # --- DEM
    if not os.path.exists(DEM):
        os.makedirs(os.path.dirname(DEM), exist_ok=True)
        print("downloading DEM ...")
        urllib.request.urlretrieve(DEM_URL, DEM)
    minx, miny, maxx, maxy = boundary.buffer(0.01).bounds
    with rasterio.open(DEM) as src:
        win = from_bounds(minx, miny, maxx, maxy, src.transform)
        z = src.read(1, window=win).astype("float64")
        tr = src.window_transform(win)
        nod = src.nodata
    if nod is not None:
        z[z == nod] = np.nan
    # pixel size in metres (GLO-30: 1 arc-sec; x spacing shrinks with latitude)
    lat0 = (miny + maxy) / 2
    dy = abs(tr.e) * 111_320.0
    dx = abs(tr.a) * 111_320.0 * math.cos(math.radians(lat0))
    gy, gx = np.gradient(z, dy, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    print(f"DEM window {z.shape}, px {dx:.1f}x{dy:.1f} m, elev {np.nanmin(z):.0f}-{np.nanmax(z):.0f} m")

    def sample(arr, poly):
        """mean of pixels whose centre falls inside poly (fallback: nearest pixel)."""
        bx0, by0, bx1, by1 = poly.bounds
        c0, r1 = ~tr * (bx0, by0)
        c1, r0 = ~tr * (bx1, by1)
        r0, r1 = max(int(math.floor(r0)), 0), min(int(math.ceil(r1)), arr.shape[0] - 1)
        c0, c1 = max(int(math.floor(c0)), 0), min(int(math.ceil(c1)), arr.shape[1] - 1)
        vals = []
        from shapely.geometry import Point
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                x, y = tr * (c + 0.5, r + 0.5)
                if poly.contains(Point(x, y)):
                    vals.append(arr[r, c])
        if not vals:
            cx, cy = poly.centroid.x, poly.centroid.y
            c, r = ~tr * (cx, cy)
            vals = [arr[int(r), int(c)]]
        return float(np.nanmean(vals))

    # --- 행정동 tables (행안부 주민등록, 기준월 JUMIN_YM) -> emd_tab[code] = {...}
    emd_tab = fetch_jumin()
    # --- 침수흔적도 polygons (EPSG:5179) -> list of (year, geom, depth_m)
    flood = fetch_flood(boundary)

    # --- equal-area CRS for km2
    feats = []
    emd_sindex = emd.sindex
    emd_m = emd.to_crs(5179)
    for h in cells:
        poly = cell_poly(h)
        area_km2 = gpd.GeoSeries([poly], crs=4326).to_crs(5179).area.iloc[0] / 1e6
        cen = poly.centroid
        hit = emd.iloc[list(emd_sindex.query(cen, predicate="within"))]
        edge = hit.empty
        if edge:  # centroid outside 구 (edge cell): nearest 행정동 (metric CRS)
            cen_m = gpd.GeoSeries([cen], crs=4326).to_crs(5179).iloc[0]
            hit = emd.iloc[[emd_m.distance(cen_m).idxmin()]]
        code, name = str(hit.iloc[0]["code"]), hit.iloc[0]["name"]
        props = {
            "h3": h, "emd_code": code, "emd_name": name,
            "area_km2": round(area_km2, 4),
            "edge": bool(edge),  # centroid outside 관악구 (partial cell)
            "slope_mean": round(sample(slope, poly), 2),
            "elev_mean": round(sample(z, poly), 1),
        }
        for k in NULL_SLOTS:
            props[k] = None
        if code in emd_tab:
            props.update(emd_tab[code])
            props["source_level"] = "emd"
        # flood traces: count distinct years + max recorded depth intersecting the cell
        pm = gpd.GeoSeries([poly], crs=4326).to_crs(5179).iloc[0]
        yrs, dmax = set(), None
        for yr, geom, depth in flood:
            if geom.intersects(pm):
                yrs.add(yr)
                if depth is not None:
                    dmax = depth if dmax is None else max(dmax, depth)
        props["flood_hist_n"] = len(yrs)
        props["flood_years"] = sorted(yrs)
        props["flood_depth_max_m"] = dmax
        coords = [[round(x, 5), round(y, 5)] for x, y in poly.exterior.coords]
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": [coords]}})

    n_emd = sum(1 for f in feats if f["properties"].get("source_level") == "emd")
    n_fl = sum(1 for f in feats if f["properties"]["flood_hist_n"])
    print(f"cells with emd tables {n_emd}, with flood history {n_fl}")
    fc = {"type": "FeatureCollection",
          "name": f"grid_{SGG}_h3r{RES}",
          "meta": {"sgg_code": SGG, "h3_res": RES, "n_cells": len(feats),
                   "dem": "Copernicus GLO-30 (N37E126)", "crs": "EPSG:4326",
                   "jumin_basis": "-".join(JUMIN_YM), "flood_years_covered": sorted(FLOOD_SEQ)},
          "features": feats}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: {len(feats)} cells, {os.path.getsize(OUT)/1e6:.2f} MB")
    sl = [p["properties"]["slope_mean"] for p in feats]
    el = [p["properties"]["elev_mean"] for p in feats]
    print(f"slope {min(sl)}-{max(sl)} deg, elev {min(el)}-{max(el)} m")


if __name__ == "__main__":
    main()
