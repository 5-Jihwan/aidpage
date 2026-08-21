# data/admin — Korean administrative boundaries

Built 2026-08-21 by `scripts/build_admin.py` (do not hand-edit).

| item | value |
|---|---|
| Source | [vuski/admdongkor](https://github.com/vuski/admdongkor) `ver20260701` (`HangJeongDong_ver20260701.geojson`) |
| Upstream | 통계청 SGIS 행정동 경계 (공공누리 제1유형, 출처표시) → corrected/extended by admdongkor |
| License | CC BY 4.0 (data). Attribution required: "통계청 SGIS · vuski/admdongkor" |
| CRS | EPSG:4326 (WGS84), coords rounded to 1e-5 deg (gwanak 1e-6) |
| Level | **행정동** (administrative dong/읍/면). 법정동 and 리 are NOT included. |
| Simplification | mapshaper Visvalingam `keep-shapes planar`, vertices retained: emd 20%, sgg 25%, sido 12%, gwanak 60%. sgg/sido dissolved from the unsimplified 행정동 layer. |
| Counts | sido 16, sgg 256, emd 3558 |

## Files

| file | size |
|---|---|
| emd_index.json | 588 KB |
| gwanak_boundary.geojson | 4 KB |
| kr_emd.geojson | 4,176 KB |
| kr_sgg.geojson | 1,702 KB |
| kr_sido.geojson | 399 KB |
| meta.json | 1 KB |
| sgg_index.json | 32 KB |

- `kr_sido.geojson` props: `code`(2), `name`
- `kr_sgg.geojson` props: `code`(5), `name`, `sido_code`, `sido_name` — 세종 is one feature `36110 세종특별자치시`
- `kr_emd.geojson` props: `code`(10-digit 행정동 코드, 행안부 체계), `name`, `sgg_code`, `sgg_name`, `sido_code`, `sido_name`
- `emd_index.json` / `sgg_index.json`: `lat`/`lon` = representative point guaranteed inside the (unsimplified) polygon; `nx`/`ny` = 기상청 단기예보 DFS grid (RE 6371.00877, GRID 5 km, SLAT 30/60, OLON 126, OLAT 38, XO 43, YO 136)
- `gwanak_boundary.geojson`: 관악구(11620) dissolved outline
- `meta.json`: machine-readable version of this table

## Caveats
- Version 20260701 reflects the 2026-07-01 reorganisation (e.g. 광주+전남 → `12 전남광주통합특별시`); codes may differ from older KOSTAT 2018 files.
- 출장소 (no boundary) are not present. Island/marine boundaries follow SGIS conventions.
- `code` is the 10-digit 행정동 code (`adm_cd2`); the 8-digit 통계청 code is not carried.
