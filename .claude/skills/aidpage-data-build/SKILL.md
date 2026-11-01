---
name: aidpage-data-build
description: AidPage 화면용 데이터를 만드는 층 작업법. scripts/build_*.py를 고치거나 다시 돌릴 때, data/shelters·data/grid·data/ref·data/access 산출물을 바꿀 때, 시군구 개수나 시설 빈칸을 점검할 때 읽는다.
---

# aidpage-data-build

## 흐름
1. 원자료를 받아 gitignore된 `.work_*/`에 캐시한다. 원천 자료는 `data/src/`에 둔다.
2. `scripts/build_*.py`가 `data/<층>/`에 쓴다. 산출물은 손으로 고치지 않는다.
3. 전국 빌드 뒤 배포 전에 점검한다.
   ```
   python scripts/check_counts.py             # 참조 파일, 격자, 대피 접근
   python scripts/check_counts.py --shelters  # 시설 층별 0건 시군구, 시도 구멍, 위치·코드 불일치까지(느림)
   python scripts/check_counts.py --selftest  # 판정 함수 점검
   node scripts/test_rules.mjs                # 지원 규칙
   node scripts/test_ui_rules.mjs             # 시설 권고 안전 규칙, 번역 키
   ```
   종료 코드 1은 전수 파일에 빠진 곳이 있거나 시설 결함이 상한을 넘었다는 뜻이다. 정읍이 조용히 빠진 일과 개편 구 7곳이 시설 0건으로 공개된 일이 이 점검기를 만든 이유다. 기존 시설 결함은 `check_counts.py`의 `KNOWN_HOLES`, `KNOWN_BAD`에 건수 상한으로 묶여 있다. 고치면 상한을 낮춘다. 같은 검사가 `.github/workflows/check.yml`로도 돈다.
4. 배포된 데이터를 바꿨다면 아래 캐시 규칙을 따른다.

## 캐시 규칙
- 시설·참조·격자는 `sw.js`의 `DATA_CACHE`에 cache-first로 들어간다. 다시 빌드했으면 `safepic-data-N`의 N을 올리고 옆 주석에 이유를 적는다. 안 올리면 기존 방문자는 옛 파일을 계속 본다.
- 대피 접근(`data/access/`)은 `js/access.js`의 `PRE_V`도 올린다.
- 임시주거시설·지진·급경사지 좌표가 바뀌면 그 지점이 들어가는 시군구의 대피 접근을 다시 계산한다. `access_batch.py`는 경계 상자 ±1.5 km 안의 시설을 도착지로 쓰므로 틀린 좌표가 이웃 시군구 결과를 오염시킨다.
- `data/shelters/README.md`의 개수와 날짜를 함께 고친다.
- 일부 층만 다시 빌드하면 `build_shelters.py`가 README를 그 층 내용으로 덮어쓴다. 다시 빌드하기 전에 README를 복사해 두고, 빌드 뒤 되돌려 해당 층만 고친다.
- `--offline` 재빌드는 `SHELTERS_ASOF=<원자료 받은 날>`을 준다. 안 주면 수정일이 없는 행의 `asof`가 오늘로 찍힌다.

## 단위
- 시군구 기준은 `data/admin/sgg_index.json`(256곳)이다. 코드는 2026-07 체계이고 광주와 전남은 `12`로 묶인다.
- 256은 표시 단위, 230은 합산 단위, 227은 기초자치단체 수다. 보고서 숫자를 쓸 때 섞지 않는다.

## 시설 자료 원칙
- 지오코딩을 하지 않고 지점을 만들어 내지 않는다. 좌표가 없는 행은 버리고 개수를 남긴다.
- 빌드 끝에 `reconcile()`이 전 층의 위치를 정리한다. 코드가 비면 좌표로 채우고, 좌표와 주소의 시도가 맞으면 코드를 고친다(`fixed_*`). 판단 근거가 없으면 뺀다(`dropped_location_conflict`).
- 소방서는 공식 자료가 시군구 수의 절반도 안 되는 시도와 0건인 시군구만 OpenStreetMap으로 보충한다(`src: osm`).
- 군 시설은 공개하지 않는다(`dropped_military`).
- 좌표는 1e-5도로 반올림한다.
- 속성은 `name`, `addr`, `sgg`, `cap`, `type`, `src`, `asof`.

## 격자
- `flood_hist_n`, `landslide_hist_n`, `slope_mean`, `pop`은 필수다. 빌더마다 속성이 달라 빠진 적이 있으므로 `check_counts.py`가 본다.

## 참고 문서
- `data/shelters/README.md`
- `docs/14_지자체_타입시스템_설계_20260904.md`
