# data/grid — H3 analysis grid (pilot: 관악구 11620)

Built 2026-08-21 by `scripts/build_grid.py` (do not hand-edit; re-run the script to rebuild).

| item | value |
|---|---|
| File | `11620.geojson` (~0.30 MB, EPSG:4326, coords rounded to 1e-5 deg) |
| Cells | **469** H3 resolution-9 hexagons (~0.105 km² each) — `h3.geo_to_cells` on the 관악구 outline + ring-1 neighbours, kept if the hexagon intersects the boundary. 55 cells have `edge: true` (centroid outside 관악구; their 행정동 is the nearest one). |
| 행정동 | 21 (from `data/admin/kr_emd.geojson`, admdongkor ver20260701), assigned by cell centroid |
| DEM | Copernicus GLO-30 (1 arc-sec, tile N37/E126, keyless from `copernicus-dem-30m` S3). Slope = `arctan(|∇z|)` via `numpy.gradient` on the 30 m grid (dx scaled by cos φ), mean of pixel centres inside each cell. GLO-30 is a **surface** model (buildings/trees included). |

## Properties

| prop | type | filled | source (level) |
|---|---|---|---|
| `h3` | string | all | H3 index (res 9) |
| `emd_code`, `emd_name` | string | all | 행정동 of centroid (10-digit 행안부 code) |
| `area_km2` | number | all | hexagon area, EPSG:5179 |
| `edge` | bool | all | centroid outside 관악구 |
| `slope_mean` (°), `elev_mean` (m) | number | all | Copernicus GLO-30 (cell) |
| `flood_hist_n` | int | all (213 cells > 0) | **서울시 침수흔적도** (서울 열린데이터광장 OA-15636) — number of distinct years 2010–2025 whose flood-trace polygons intersect the cell. 관악구 traces exist for 2010, 2011, 2022, 2023, 2024 (cell) |
| `flood_years` | int[] | all | the years behind `flood_hist_n` |
| `flood_depth_max_m` | number | 213 cells | max `F_SHIM` (침수심, m) of intersecting traces; null where no trace |
| `pop` | int | all | **행안부 주민등록 인구통계** 2026-07, 행정동 총인구수 (`source_level: "emd"` — every cell of a 행정동 carries the same 행정동 total; do not sum across cells) |
| `hh` | int | all | 행정동 세대수 (emd) |
| `elderly65_r` | 0–1 | all | 65세 이상 인구 / 총인구 (emd) |
| `elderly_alone_r` | 0–1 | all | **65세 이상 1인세대 / 총세대수** (행안부 "행정동별 성/연령별 주민등록 1인세대수", emd) |
| `single_hh_r` | 0–1 | all | 1인세대 / 총세대수 (emd) |
| `source_level` | "emd" | all | marks that the table attributes above are 행정동-level, not cell-level |
| `flood_risk_100y` | — | **null** | needs key: 환경부 도시침수지도 API (data.go.kr 15141730) — see `acquisition_plan.md` |
| `semi_basement_r` | — | **null** | no keyless 행정동-level source found — see plan |
| `bldg_age30_r` | — | **null** | needs key: 건축HUB 건축물대장 표제부 — see plan |
| `shelter_min_walk` | — | **null** | to be derived from `data/shelters/` once that layer exists (walk-network or straight-line to nearest shelter) |

Ratios are fractions (0–1); the UI multiplies by 100 (`js/grid.js` `pct: true`).

## Caveats
- 침수흔적도 is a record of *reported* inundation after each event, digitised per 필지 (2022) or block (2010/11); absence of a trace is not absence of risk. 2012–2020 files contain no 관악구 polygons; 2015/2021 were declared no-flood years (no file). The 2022 file was corrected by 서울시 on 2026-01-05.
- `pop`/`hh`/ratios are 행정동 aggregates stamped on every cell of that 행정동 (대학동 alone covers 127 cells, most of them 관악산 forest). Use them for relative comparison between 행정동, not as per-cell counts.
- DEM slope at res 9 (~370 m across) smooths out street-scale gradients; GLO-30 includes buildings.

## Licence / attribution
- Copernicus DEM GLO-30 — © ESA/Airbus, free for any use with attribution ("Copernicus DEM").
- 서울시 침수흔적도 — 서울특별시 (서울 열린데이터광장, 공공누리 제1유형).
- 주민등록 인구통계 — 행정안전부 (jumin.mois.go.kr, 공공누리 제1유형).
- 행정동 경계 — 통계청 SGIS · vuski/admdongkor (CC BY 4.0).
