#!/usr/bin/env python
"""Build data/grid/11620.geojson — H3 res-9 analysis grid for 관악구 (11620).

Inputs
  data/admin/gwanak_boundary.geojson   dissolved 관악구 outline (EPSG:4326)
  data/admin/kr_emd.geojson            행정동 polygons (props code/name/sgg_code)
  .work_grid/dem_N37_00_E126_00.tif    Copernicus GLO-30 DEM tile (1x1 deg, 30 m)
      https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N37_00_E126_00_DEM/
      Copernicus_DSM_COG_10_N37_00_E126_00_DEM.tif  (keyless)
  .work_grid/emd_tables.csv (optional)  행정동-level attributes, see README

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

    # --- optional 행정동 table
    emd_tab = {}
    if os.path.exists(EMD_TABLE):
        import csv
        with open(EMD_TABLE, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                emd_tab[row["emd_code"]] = {k: (float(v) if v not in ("", None) else None)
                                           for k, v in row.items() if k != "emd_code"}
        print(f"emd table: {len(emd_tab)} rows, cols {list(next(iter(emd_tab.values())).keys())}")

    # --- equal-area CRS for km2
    feats = []
    emd_sindex = emd.sindex
    for h in cells:
        poly = cell_poly(h)
        area_km2 = gpd.GeoSeries([poly], crs=4326).to_crs(5179).area.iloc[0] / 1e6
        cen = poly.centroid
        hit = emd.iloc[list(emd_sindex.query(cen, predicate="within"))]
        if hit.empty:  # centroid outside 구 (edge cell): nearest 행정동
            hit = emd.iloc[[emd.distance(cen).idxmin()]]
        code, name = str(hit.iloc[0]["code"]), hit.iloc[0]["name"]
        props = {
            "h3": h, "emd_code": code, "emd_name": name,
            "area_km2": round(area_km2, 4),
            "slope_mean": round(sample(slope, poly), 2),
            "elev_mean": round(sample(z, poly), 1),
        }
        for k in NULL_SLOTS:
            props[k] = None
        if code in emd_tab:
            for k, v in emd_tab[code].items():
                if k in NULL_SLOTS and v is not None:
                    props[k] = v
            props["source_level"] = "emd"
        coords = [[round(x, 5), round(y, 5)] for x, y in poly.exterior.coords]
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": [coords]}})

    fc = {"type": "FeatureCollection",
          "name": f"grid_{SGG}_h3r{RES}",
          "meta": {"sgg_code": SGG, "h3_res": RES, "n_cells": len(feats),
                   "dem": "Copernicus GLO-30 (N37E126)", "crs": "EPSG:4326"},
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
