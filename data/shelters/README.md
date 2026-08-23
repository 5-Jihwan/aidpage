# data/shelters — nationwide shelter points (keyless sources)

Built 2026-08-23 by `scripts/build_shelters.py` (do not hand-edit). WGS84 points, coords rounded to 1e-5 deg. No geocoding, no fabricated points: rows without usable coordinates are dropped (counts below). 군 시설(부대·사령부·군인아파트 등)은 공개하지 않고 제외한다(`dropped_military`).

Props per feature: `name`, `addr`, `sgg` (5-digit 시군구 code, 2026-07 체계 — 광주+전남 = `12`; from the query 시군구 for safekorea layers, else by address match within sido against `data/admin/sgg_index.json`, else null), `cap` (수용인원, int or null), `type`, `src`, `asof` (YYYY-MM-DD).

## Files

| kind | points | file(s) | bytes |
|---|---|---|---|
| civil_defense | 17,224 | `civil_defense/{sido}.geojson` x16 (see index.json) | 5,769,268 |
| heat | 62,082 | `heat/{sido}.geojson` x16 (see index.json) | 16,842,642 |
| cold | 53,026 | `cold/{sido}.geojson` x16 (see index.json) | 14,307,556 |
| quake | 21,474 | `quake/{sido}.geojson` x17 (see index.json) | 6,329,339 |
| temp_housing | 15,576 | `temp_housing.geojson` | 4,149,837 |
| fire | 685 | `fire.geojson` | 192,978 |
| police | 2,010 | `police.geojson` | 565,148 |
| pharmacy | 18,225 | `pharmacy/{sido}.geojson` x15 (see index.json) | 5,330,123 |
| er | 339 | `er.geojson` | 104,453 |
| dust | 6,036 | `dust.geojson` | 1,744,151 |
| water | 6,242 | `water.geojson` | 1,833,630 |
| tsunami | 632 | `tsunami.geojson` | 169,345 |
| meal | 1,158 | `meal.geojson` | 445,382 |
| townhall | 3,739 | `townhall.geojson` | 892,945 |
| chem | 1,658 | `chem.geojson` | 490,157 |
| health | 2,350 | `health.geojson` | 696,232 |
| steep | 33,994 | `steep/{sido}.geojson` x15 (see index.json) | 7,936,298 |
| wildfire_hist | 9,507 | `wildfire_hist.geojson` | 2,567,727 |
| underpass | 559 | `underpass.geojson` | 143,439 |

`index.json` maps `{kind: {sido_code: path}}` for kinds split per sido (file would exceed 6 MB).


## Sources (all keyless, no login)

### civil_defense
- **지방행정인허가데이터개방 민방위대피시설 (행정안전부, 매일 갱신)**
  - url: https://file.localdata.go.kr/file/download/civil_defense_shelter_info/info
  - page: https://file.localdata.go.kr/file/civil_defense_shelter_info/info
  - datago: https://www.data.go.kr/data/15044951/fileData.do
  - fetched: 2026-08-23
  - asof_max: 2026-08-20
  - raw_rows: 18829
  - status_breakdown: {'사용중': 17236, '사용중지': 1577, '일시중지': 16}
  - license: 이용허락범위 제한 없음 (공공데이터포털 15044951)

### heat
- **전국무더위쉼터표준데이터 (공공데이터포털 표준데이터 15013199)**
  - url: https://www.data.go.kr/data/15013199/standard.do
  - endpoint: https://www.data.go.kr/download/standard.json (keyless, same as page CSV button)
  - fetched: 2026-08-23
  - raw_rows: 42226
  - points: 38696
  - asof_top: [('2020-06-30', 2191), ('2019-09-16', 1144), ('2019-09-20', 980), ('2019-06-27', 970), ('2019-06-04', 956)]
  - license: 공공데이터포털 표준데이터 (이용허락범위 제한 없음)
- **국민안전24(safekorea) 시설안전지도 무더위쉼터 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 62088
  - points: 62082
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### cold
- **국민안전24(safekorea) 시설안전지도 한파쉼터 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 53028
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### quake
- **국민안전24(safekorea) 시설안전지도 지진옥외대피소 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 11182
  - points: 11181
  - license: 공공누리 제1유형 (국민안전24 저작권정책)
- **전국지진해일긴급대피장소표준데이터 (공공데이터포털 표준데이터 15025449)**
  - url: https://www.data.go.kr/data/15025449/standard.do
  - endpoint: https://www.data.go.kr/download/standard.json
  - fetched: 2026-08-23
  - raw_rows: 11136
  - points: 10293
  - license: 공공데이터포털 표준데이터 (이용허락범위 제한 없음)

### temp_housing
- **국민안전24(safekorea) 시설안전지도 이재민임시주거시설 + 지진겸용임시주거시설 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 15601
  - raw_rows_quake_layer: 6192
  - quake_only_added: 0
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### fire
- **국민안전24(safekorea) 시설안전지도 소방서·119안전센터 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 685
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### police
- **국민안전24(safekorea) 시설안전지도 경찰서·지구대 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 2010
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### pharmacy
- **국민안전24(safekorea) 시설안전지도 약국 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 18226
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### er
- **국민안전24(safekorea) 시설안전지도 응급의료센터 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 339
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### dust
- **국민안전24(safekorea) 시설안전지도 미세먼지쉼터 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 6036
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### water
- **국민안전24(safekorea) 시설안전지도 비상급수시설 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 6310
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### tsunami
- **국민안전24(safekorea) 시설안전지도 지진해일대피소 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 636
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### meal
- **전국무료급식소표준데이터 (공공데이터포털 표준데이터 15013107)**
  - url: https://www.data.go.kr/data/15013107/standard.do
  - endpoint: https://www.data.go.kr/download/standard.json (keyless)
  - fetched: 2026-08-23
  - raw_rows: 1267
  - points: 1158
  - columns: None
  - license: 공공데이터포털 표준데이터 (이용허락범위 제한 없음)

### townhall
- **OpenStreetMap 주민센터·행정복지센터·읍면사무소 (Overpass API)**
  - url: https://www.openstreetmap.org
  - endpoint: https://overpass-api.de/api/interpreter
  - fetched: 2026-08-23
  - raw_rows: 6443
  - license: ODbL 1.0 — © OpenStreetMap contributors (attribution shown on map)

### chem
- **국민안전24(safekorea) 시설안전지도 화학사고대피소 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 1658
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### health
- **국민안전24(safekorea) 시설안전지도 보건소 (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 2350
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### steep
- **국민안전24(safekorea) 시설안전지도 급경사지(붕괴위험 관리지점) (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 36383
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### wildfire_hist
- **국민안전24(safekorea) 시설안전지도 산불발생이력(2013~) (행정안전부, 시군구별 조회)**
  - url: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?menuSn=2
  - endpoint: https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilityDataList.do
  - fetched: 2026-08-23
  - raw_rows: 9515
  - license: 공공누리 제1유형 (국민안전24 저작권정책)

### underpass
- **OpenStreetMap 지하차도 tunnel ways (centre points) + 국토교통부 시설물안전법 대상 지하차도 현황(15124755) 이름 대조**
  - url: https://www.data.go.kr/data/15124755/fileData.do
  - endpoint: https://overpass-api.de/api/interpreter
  - fetched: 2026-08-23
  - raw_rows: 1087
  - molit_rows: 938
  - license: ODbL 1.0 (OSM) · 공공누리 (MOLIT)

## Processing stats (per kind)

- **civil_defense**: {"raw_rows": 18829, "dropped_not_in_use": 1593, "dropped_no_or_bad_coords": 7, "dropped_military": 5}
- **heat**: {"std_raw_rows": 42226, "dropped_no_or_bad_coords": 3527, "sgg_unmatched": 1179, "dropped_military": 9, "safekorea_raw_rows": 62088, "chosen_safekorea": 1}
- **cold**: {"raw_rows": 53028, "dropped_military": 2}
- **quake**: {"outdoor_raw_rows": 11182, "dropped_military": 9, "tsunami_raw_rows": 11136, "dropped_no_or_bad_coords": 835, "sgg_unmatched": 167}
- **temp_housing**: {"raw_rows": 15601, "dropped_no_or_bad_coords": 4, "dropped_duplicate": 21}
- **fire**: {"raw_rows": 685}
- **police**: {"raw_rows": 2010}
- **pharmacy**: {"raw_rows": 18226, "dropped_military": 1}
- **er**: {"raw_rows": 339}
- **dust**: {"raw_rows": 6036}
- **water**: {"raw_rows": 6310, "dropped_no_or_bad_coords": 62, "dropped_military": 6}
- **tsunami**: {"raw_rows": 636, "dropped_military": 4}
- **meal**: {"std_raw_rows": 1267, "dropped_no_or_bad_coords": 109, "sgg_unmatched": 21}
- **townhall**: {"raw_rows": 6443, "dropped_untagged": 223, "dropped_transit": 2481}
- **chem**: {"raw_rows": 1658}
- **health**: {"raw_rows": 2350}
- **steep**: {"raw_rows": 36383, "dropped_no_or_bad_coords": 2384, "dropped_military": 5}
- **wildfire_hist**: {"raw_rows": 9515, "dropped_military": 8}
- **underpass**: {"raw_ways": 1067, "molit_matched": 330, "dropped_duplicate_way": 508, "sgg_unmatched": 1}

Notes:
- civil_defense keeps only `운영상태 = 사용중` (사용중지/일시중지 dropped, see status_breakdown). `type` = 시설구분 / 지상·지하.
- heat: both the 표준데이터 (15013199) and the safekorea current-year layer are fetched; the larger set is written (`chosen_*` in stats). `type` on safekorea rows is the raw 쉼터유형 code.
- quake mixes 지진옥외대피장소 (safekorea) and 지진해일긴급대피장소 (표준데이터 15025449); distinguish with `type`.
- temp_housing: 이재민임시주거시설 layer, with `(지진겸용)` appended to `type` when the same facility also appears in the 지진겸용 layer.
- safekorea rows often lack a road address (`addr` null); `sgg` is still set from the queried 시군구.
- Split files: sido code `00` collects rows whose address has no recognisable 시도 prefix (`sgg` null); tiny bucket, safe to ignore or merge.
- quake 지진해일긴급대피장소 rows come from the 표준데이터 with 2020-era `asof` dates; safekorea 지진옥외대피소 rows are current (lastModfDt).
- CRS: sources deliver EPSG:4326 lat/lon directly; fallback reprojection (5179/5186/5181/5174 auto-detect) is only used when lat/lon is missing and a projected x/y exists (`reprojected_from_*` in stats). All points validated to lon 124–132 / lat 33–39.

## Not obtainable keyless (as of build date)

- **flood**: 전국 단위 수해대피소 데이터셋 없음. 공공데이터포털에는 지자체별 파일만 존재(예: 15099625 서울특별시_수해대피소공간정보, 15114035 진주시, 15113913 평택시, 15113802 진천군 등)이며 모두 fileDownload.do 로그인 필요. safekorea 시설안전지도에도 수해대피소 레이어 없음.
- **quake (표준데이터)**: 15072620 전국지진옥외대피장소표준데이터, 15072622 전국지진겸용임시주거시설표준데이터는 totalCount=0 (빈 데이터셋) → safekorea 레이어로 대체
- **temp_housing (행안부 파일)**: 15124965 행정안전부_이재민임시주거시설정보: 51행(집계표) + fileDownload.do는 비로그인 시 '%PDF-1.7' 안내문 반환(.work_shelters/temp_housing_15124965_login_guidance.pdf) → 사용 불가
- **civil_defense (표준데이터)**: 15021098 전국민방위대피시설표준데이터는 5,204행(2021 기준, 일부 지자체만) → localdata.go.kr 전국 18,8xx행(매일 갱신)으로 대체
- **cold (표준데이터)**: 전국 한파쉼터 표준데이터셋 없음(지자체별 파일만: 15088136 서울, 15153730 부산 등, 로그인 필요) → safekorea 레이어 사용
- data.go.kr `cmm/cmm/fileDownload.do?atchFileId=...` (파일데이터) requires a logged-in session: without one it returns a guidance PDF. Only 표준데이터 (`/download/standard.json`) is keyless.

## safekorea layer coverage (시군구 fetched / 256)

- heat: 256/256 — complete
- cold: 256/256 — complete
- quake_outdoor: 256/256 — complete
- temp_housing: 256/256 — complete
- temp_housing_quake: 256/256 — complete
- fire: 256/256 — complete
- police: 256/256 — complete
- pharmacy: 256/256 — complete
- er: 256/256 — complete
- dust: 256/256 — complete
- water: 256/256 — complete
- tsunami: 256/256 — complete
- chem: 256/256 — complete
- health: 256/256 — complete
- steep: 256/256 — complete
- wildfire_hist: 256/256 — complete

Re-run `python scripts/build_shelters.py` (optionally `SK_BUDGET_S=1200`) to fill missing 시군구; fetched ones are cached in .work_shelters/sk_*.json.

## License / attribution

- 공공데이터포털 표준데이터 및 지방행정인허가데이터: 이용허락범위 제한 없음 (출처 표시 권장: 행정안전부 / 공공데이터포털).
- 국민안전24(safekorea.go.kr) 시설안전지도: 공공누리 제1유형 (출처표시) — 출처: 행정안전부 국민안전24.
- 시군구 코드/경계: `data/admin` (통계청 SGIS · vuski/admdongkor, CC BY 4.0).
