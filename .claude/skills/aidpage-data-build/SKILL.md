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
   python scripts/check_counts.py --shelters  # 시설 층별 0건 시군구까지(느림)
   ```
   종료 코드 1은 전수 파일에 빠진 곳이 있다는 뜻이다. 정읍이 조용히 빠진 일과 개편 구 7곳이 시설 0건으로 공개된 일이 이 점검기를 만든 이유다.
4. 배포된 데이터를 바꿨다면 아래 캐시 규칙을 따른다.

## 캐시 규칙
- 시설·참조·격자는 `sw.js`의 `DATA_CACHE`에 cache-first로 들어간다. 다시 빌드했으면 `safepic-data-N`의 N을 올리고 옆 주석에 이유를 적는다. 안 올리면 기존 방문자는 옛 파일을 계속 본다.
- 대피 접근(`data/access/`)은 `js/access.js`의 `PRE_V`도 올린다.
- `data/shelters/README.md`의 개수와 날짜를 함께 고친다.

## 단위
- 시군구 기준은 `data/admin/sgg_index.json`(256곳)이다. 코드는 2026-07 체계이고 광주와 전남은 `12`로 묶인다.
- 256은 표시 단위, 230은 합산 단위, 227은 기초자치단체 수다. 보고서 숫자를 쓸 때 섞지 않는다.

## 시설 자료 원칙
- 지오코딩을 하지 않고 지점을 만들어 내지 않는다. 좌표가 없는 행은 버리고 개수를 남긴다.
- 군 시설은 공개하지 않는다(`dropped_military`).
- 좌표는 1e-5도로 반올림한다.
- 속성은 `name`, `addr`, `sgg`, `cap`, `type`, `src`, `asof`.

## 격자
- `flood_hist_n`, `landslide_hist_n`, `slope_mean`, `pop`은 필수다. 빌더마다 속성이 달라 빠진 적이 있으므로 `check_counts.py`가 본다.

## 참고 문서
- `data/shelters/README.md`
- `docs/14_지자체_타입시스템_설계_20260904.md`
