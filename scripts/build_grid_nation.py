#!/usr/bin/env python
"""전국(서울 제외) 시군구 H3 res-8 격자 빌드 — 탭③ 전국 확장.

서울(11xxx)은 기존 res-9 유지. 나머지 ~225개 시군구를 res-8(셀 ~0.74km²)로:
  경계    kr_emd.geojson 구별 dissolve
  DEM     Copernicus GLO-30 — 시군구 범위에 걸리는 1°타일 자동 다운로드·병합
          (res-8은 셀이 커서 bbox 평균 샘플링 사용 — 점내부 판정 근사, 주석 참조)
  침수    data/ref/sd/flood.jsonl — 전국 침수흔적도 WKT 폴리곤 38,003개 (EPSG:3857)
  산사태  data/ref/sd/ls_hist.jsonl — 발생 지점 9,656개 (EPSG:3857) → landslide_hist_n
  인구    행안부 주민등록 (구별 keyless POST)
출력: data/grid/<sgg>.geojson (+ compute_shelter_walk로 도보시간)
사용: python scripts/build_grid_nation.py [sgg ...]   # 인자 없으면 전국(서울 제외)
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
from shapely import wkt as shp_wkt
from shapely.geometry import Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from build_grid import ROOT, NULL_SLOTS, JUMIN, JUMIN_YM, cell_poly  # noqa: E402
from build_grid_seoul import fetch_jumin_sgg  # noqa: E402
from compute_shelter_walk import build as shelter_walk  # noqa: E402

RES = 8
WD = os.path.join(ROOT, ".work_grid")


def dem_path(lat, lon):
    name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
    return (f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif",
            os.path.join(WD, f"dem_N{lat:02d}_00_E{lon:03d}_00.tif"))


_missing_tiles = set()


def dem_window(bounds):
    minx, miny, maxx, maxy = bounds
    srcs = []
    for lat in range(int(math.floor(miny)), int(math.floor(maxy)) + 1):
        for lon in range(int(math.floor(minx)), int(math.floor(maxx)) + 1):
            url, path = dem_path(lat, lon)
            if (lat, lon) in _missing_tiles:
                continue
            if not os.path.exists(path):
                try:
                    print(f"  DEM 다운로드 N{lat}E{lon} ...", flush=True)
                    urllib.request.urlretrieve(url, path + ".part")
                    os.replace(path + ".part", path)
                except Exception as e:  # noqa: BLE001  (바다 타일 등 404)
                    print(f"  DEM N{lat}E{lon} 없음({e}) — skip")
                    _missing_tiles.add((lat, lon))
                    continue
            srcs.append(rasterio.open(path))
    if not srcs:
        return None
    arr, tr = rio_merge(srcs, bounds=bounds, nodata=float("nan"))
    z = arr[0].astype("float64")
    lat0 = (miny + maxy) / 2
    dy = abs(tr.e) * 111_320.0
    dx = abs(tr.a) * 111_320.0 * math.cos(math.radians(lat0))
    gy, gx = np.gradient(z, dy, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    for s in srcs:
        s.close()
    return z, slope, tr


def bbox_mean(arr, tr, poly):
    """res-8 셀(~860m)은 픽셀 수백 개라 bbox 평균으로 근사 — 육각형/직사각형 차이는
    이웃 픽셀 평균이라 수 % 이내. (서울 res-9은 정밀 점내부 판정 유지)"""
    bx0, by0, bx1, by1 = poly.bounds
    c0, r1 = ~tr * (bx0, by0)
    c1, r0 = ~tr * (bx1, by1)
    r0, r1 = max(int(r0), 0), min(int(r1) + 1, arr.shape[0])
    c0, c1 = max(int(c0), 0), min(int(c1) + 1, arr.shape[1])
    if r1 <= r0 or c1 <= c0:
        return None
    v = arr[r0:r1, c0:c1]
    return float(np.nanmean(v)) if v.size else None


def load_flood_nation():
    """전국 침수흔적도(WKT 폴리곤, 3857) → GeoDataFrame + sindex."""
    rows = []
    with open(os.path.join(ROOT, "data", "ref", "sd", "flood.jsonl"), encoding="utf-8") as f:
        for l in f:
            r = json.loads(l)
            g = r.get("GEOM")
            if not g or g == "None":
                continue
            try:
                geom = shp_wkt.loads(g)
            except Exception:  # noqa: BLE001
                continue
            try:
                depth = float(r.get("FLDN_DOWA"))
            except (TypeError, ValueError):
                depth = None
            try:
                yr = int(str(r.get("FLDN_YR"))[:4])
            except (TypeError, ValueError):
                continue
            rows.append({"year": yr, "depth": depth, "geometry": geom})
    fl = gpd.GeoDataFrame(rows, crs=3857)
    print(f"침수 폴리곤: {len(fl)}")
    return fl


def load_landslide():
    pts = []
    with open(os.path.join(ROOT, "data", "ref", "sd", "ls_hist.jsonl"), encoding="utf-8") as f:
        for l in f:
            r = json.loads(l)
            try:
                pts.append({"geometry": gpd.points_from_xy([float(r["XMAP_CRTS"])], [float(r["YMAP_CRTS"])])[0]})
            except (TypeError, ValueError, KeyError):
                continue
    g = gpd.GeoDataFrame(pts, crs=3857)
    print(f"산사태 지점: {len(g)}")
    return g


def build_sgg(sgg, emd_all, flood, flood_sidx, ls, ls_sidx):
    emd = emd_all[emd_all["sgg_code"].astype(str) == sgg].reset_index(drop=True)
    if emd.empty:
        print(f"{sgg}: 행정동 없음, skip")
        return False
    boundary = emd.geometry.union_all().buffer(0)
    geo = json.loads(json.dumps(boundary.__geo_interface__))
    core = set(h3.geo_to_cells(h3.geo_to_h3shape(geo), RES))
    cand = set(core)
    for h in core:
        cand |= set(h3.grid_disk(h, 1))
    cells = sorted(h for h in cand if cell_poly(h).intersects(boundary))
    dem = dem_window(boundary.buffer(0.02).bounds)
    emd_tab = fetch_jumin_sgg(sgg)
    emd_sindex = emd.sindex
    emd_m = emd.to_crs(5179)
    feats = []
    # 셀들을 한 번에 3857로 변환 (성능)
    polys = [cell_poly(h) for h in cells]
    pm_all = gpd.GeoSeries(polys, crs=4326).to_crs(3857)
    for h, poly, pm in zip(cells, polys, pm_all):
        cen = poly.centroid
        hit = emd.iloc[list(emd_sindex.query(cen, predicate="within"))]
        edge = hit.empty
        if edge:
            cen_m = gpd.GeoSeries([cen], crs=4326).to_crs(5179).iloc[0]
            hit = emd.iloc[[emd_m.distance(cen_m).idxmin()]]
        code, name = str(hit.iloc[0]["code"]), hit.iloc[0]["name"]
        props = {"h3": h, "emd_code": code, "emd_name": name,
                 "area_km2": round(gpd.GeoSeries([poly], crs=4326).to_crs(5179).area.iloc[0] / 1e6, 4),
                 "edge": bool(edge)}
        props["slope_mean"] = round(bbox_mean(dem[1], dem[2], poly), 2) if dem else None
        props["elev_mean"] = round(bbox_mean(dem[0], dem[2], poly), 1) if dem else None
        for k in NULL_SLOTS:
            props.setdefault(k, None)
        if code in emd_tab:
            props.update(emd_tab[code])
            props["source_level"] = "emd"
        yrs, dmax = set(), None
        for i in flood_sidx.query(pm, predicate="intersects"):
            row = flood.iloc[i]
            yrs.add(int(row["year"]))
            d = row["depth"]
            if d is not None and not (isinstance(d, float) and math.isnan(d)):
                dmax = d if dmax is None else max(dmax, d)
        props["flood_hist_n"] = len(yrs)
        props["flood_years"] = sorted(yrs)
        props["flood_depth_max_m"] = dmax
        props["landslide_hist_n"] = int(len(ls_sidx.query(pm, predicate="intersects")))
        coords = [[round(x, 5), round(y, 5)] for x, y in poly.exterior.coords]
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": [coords]}})
    fc = {"type": "FeatureCollection", "name": f"grid_{sgg}_h3r{RES}",
          "meta": {"sgg_code": sgg, "h3_res": RES, "n_cells": len(feats),
                   "dem": "Copernicus GLO-30 (bbox-mean)", "crs": "EPSG:4326",
                   "jumin_basis": "-".join(JUMIN_YM),
                   "flood_src": "행안부 침수흔적도(전국, 재난안전데이터공유플랫폼)",
                   "landslide_src": "행안부 산사태 발생이력"},
          "features": feats}
    out = os.path.join(ROOT, "data", "grid", f"{sgg}.geojson")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    n_fl = sum(1 for f2 in feats if f2["properties"]["flood_hist_n"])
    n_ls = sum(1 for f2 in feats if f2["properties"]["landslide_hist_n"])
    print(f"{sgg}: cells {len(feats)}, flood {n_fl}, landslide {n_ls}, "
          f"{os.path.getsize(out) / 1e6:.2f} MB", flush=True)
    try:
        shelter_walk(sgg)
    except SystemExit as e:
        print(f"  shelter_walk skip: {e}")
    except Exception as e:  # noqa: BLE001
        print(f"  shelter_walk 실패: {e}")
    return True


def main():
    targets = sys.argv[1:] or None
    sgg_geo = gpd.read_file(os.path.join(ROOT, "data", "admin", "kr_sgg.geojson"))
    all_sgg = sorted(str(c) for c in sgg_geo["code"])
    todo = [s for s in all_sgg if not s.startswith("11")]  # 서울은 res-9 유지
    if targets:
        todo = [s for s in all_sgg if s in targets]
    print(f"대상 시군구: {len(todo)} (res={RES})")
    emd_all = gpd.read_file(os.path.join(ROOT, "data", "admin", "kr_emd.geojson"))
    flood = load_flood_nation()
    flood_sidx = flood.sindex
    ls = load_landslide()
    ls_sidx = ls.sindex
    ok = 0
    for i, sgg in enumerate(todo, 1):
        print(f"--- [{i}/{len(todo)}] {sgg}", flush=True)
        try:
            if build_sgg(sgg, emd_all, flood, flood_sidx, ls, ls_sidx):
                ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {sgg}: {type(e).__name__}: {e}", flush=True)
    print(f"done ok={ok}/{len(todo)}")


if __name__ == "__main__":
    main()
