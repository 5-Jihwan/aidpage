# data/live — 실시간 수집 데이터

`scripts/fetch_live.py`(표준 라이브러리만 사용)가 `.github/workflows/live.yml`에 의해
기본 30분마다 실행되어 아래 파일들을 갱신합니다. 키가 없거나 오류가 나도 **절대 실패하지 않고**
해당 섹션의 `status`만 바뀝니다.

| 파일 | 내용 |
|---|---|
| `weather.json` | 시군구별 초단기실황(기온·1h강수·습도·풍속·강수형태) + 체감온도 + 오늘 TMX/TMN/POP |
| `alerts.json` | 기상특보(`warnings`) · 긴급재난문자(`messages`) · 하천수위(`river`) · 산사태(`landslide`) |
| `air.json` | 시군구별 미세먼지(`by_sgg[code]` = pm10·pm25·o3·khai·grade_pm10·grade_pm25·station·nearest). 측정소가 없는 시군구는 최근접 측정소 값 + `nearest: true` |
| `air_stations.json` | 에어코리아 측정소 목록 캐시(주소·위경도). 없거나 30일 지나면 자동 재생성 |
| `.hot` | 호우/태풍/대설 **경보**가 하나라도 발효 중일 때만 생성되는 플래그(내용 = 갱신시각). 커밋되지 않음 |

## status 값

- `ok` — 정상
- `no_key` — 해당 시크릿이 설정되지 않음(프론트는 이 상태에서 "준비 중"으로 표시)
- `error:<code>` — HTTP 상태코드, `net`, `timeout`, `badjson`, `budget`(호출 상한),
  `kma22`(공공데이터포털 일일 트래픽 초과), `kma30`(키 미등록), `sd..`, `kfs..`, `air..`(에어코리아 resultCode).
  이 경우 **이전 파일의 섹션 내용이 그대로 유지**되고 status만 갱신됩니다.
- `partial:<code>` — weather/air. 일부 시군구(또는 일부 시도 호출)만 실패(weather는 실패분 이전 값 유지).
- `todo` / 비어있는 items — 아직 미구현·미발령

## 필요한 시크릿(GitHub → Settings → Secrets and variables → Actions)

| 시크릿 | 발급처 | 신청해야 할 서비스 |
|---|---|---|
| `DATA_GO_KR_KEY` | 공공데이터포털 data.go.kr (일반 인증키 **Decoding** 값 권장) | ① 기상청_단기예보 조회서비스 `https://www.data.go.kr/data/15084084/openapi.do` ② 기상청_기상특보 조회서비스 `https://www.data.go.kr/data/15000415/openapi.do` ③ (선택) 산림청_산사태예측정보 `https://www.data.go.kr/data/15074800/openapi.do` ④ 한국환경공단_에어코리아_대기오염정보 `https://www.data.go.kr/data/15073861/openapi.do` ⑤ 한국환경공단_에어코리아_측정소정보 `https://www.data.go.kr/data/15073877/openapi.do`(측정소 목록/좌표, 30일 1회) — 한 키로 사용하되 **각 데이터셋마다 활용신청** 필요 |
| `SAFETYDATA_KEY` | 재난안전데이터공유플랫폼 safetydata.go.kr | 행정안전부_긴급재난문자 (`DSSP-IF-00247`) `https://www.safetydata.go.kr/disaster-data/view?dataSn=228` |
| `HRFCO_KEY` | 한강홍수통제소 오픈API `https://www.hrfco.go.kr/web/openapiPage/reference.do` | 수위관측소 정보 + 10분 수위 |

## 사용 엔드포인트 (호출 수/회)

| 항목 | 엔드포인트 | 호출 수 |
|---|---|---|
| 초단기실황 | `apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` (base_time=정시, 분<40이면 1시간 전) | 시군구 수 ≈ 250 (동일 nx,ny 캐시) |
| 단기예보 TMX/TMN/POP | `.../getVilageFcst` (02,05,…,23시 발표) | ≈ 250 (`LIVE_SKIP_VILAGE=1`로 끌 수 있음) |
| 기상특보 현황 | `apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus?stnId=108` | 1 |
| 긴급재난문자 | `www.safetydata.go.kr/V2/api/DSSP-IF-00247?crtDt=YYYYMMDD` | 1 |
| 하천수위 | `api.hrfco.go.kr/{KEY}/waterlevel/info.json` + `/waterlevel/list/10M.json` | 2 |
| 산사태예측 | `apis.data.go.kr/1400000/predictionInfoService/predictionInfoList` | 1 |
| 미세먼지(시도별 실시간) | `apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?sidoName=…&ver=1.3&numOfRows=600` | 17 (시도당 1) |
| 측정소 목록 | `apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList?numOfRows=1000` | 1 (30일마다, 캐시 `air_stations.json`) |

합계 ≈ 522/회 (+1 측정소 재생성 시; 상한 `LIVE_MAX_CALLS`=520이므로 단기예보를 켠 채로 쓰려면 `LIVE_MAX_CALLS=540` 권장 — 공기질은 마지막에 호출되어 상한에 걸리면 `error:budget`). 30분 주기 → 하루 48회 × ~500 = **약 24,000 콜/일** →
공공데이터포털 개발계정 한도(일 10,000)로는 초과하므로 다음 중 하나를 택하세요:
- 운영계정 전환(활용사례 등록 후 트래픽 증량), 또는
- `LIVE_SKIP_VILAGE=1`(≈ 250/회, 12,000/일) + cron을 1시간(`0 * * * *`)으로, 또는
- 단기예보만 1일 2~3회 별도 잡으로 분리.

## 체감온도

- 5~9월: 기상청 2022 여름철 체감온도 — Stull(2011) 습구온도 Tw 기반
  `-0.2442 + 0.55399·Tw + 0.45535·T − 0.0022·Tw² + 0.00278·Tw·T + 3.0` → `feels_type: "heat"`
- 10~4월: 겨울철 체감온도(JAG/TI 풍속냉각), T≤10℃ & 풍속≥1.3 m/s일 때 적용 → `"windchill"`, 아니면 `"none"`(=기온)

## 주기 조정 (adaptive)

GitHub cron 최소 간격은 5분입니다. 기본은 `*/30`. 호우/태풍/대설 경보가 발효되면 스크립트가
`data/live/.hot`을 만들고 워크플로가 `::warning HOT` 주석을 남깁니다. 그때 수동으로:

1. `.github/workflows/live.yml`의 cron을 `"*/10 * * * *"`로 바꿔 커밋, 또는
2. Actions 탭에서 `live-data` → Run workflow를 수동 실행.

자동 전환은 워크플로가 스스로 파일을 고쳐야 하므로(권한·루프 위험) 의도적으로 제외했습니다.
`.hot`은 `.gitignore` 대상이며 커밋되지 않습니다.

## 히스토리 관리

같은 `main` 브랜치에 30분마다 커밋되므로 저장소가 빠르게 자랍니다(대략 연 17,000 커밋).
- 로컬에서 `git gc --aggressive --prune=now`를 가끔 실행하세요.
- 규모가 커지면 `live` 전용 브랜치(또는 orphan 브랜치)로 옮기고 프론트에서
  `raw.githubusercontent.com/<user>/disaster-compass/live/data/live/*.json`을 읽는 방식으로 전환을 권장합니다.

## 미검증 항목(키 발급 후 첫 실행 시 확인)

- `getPwnStatus` 응답의 텍스트 필드(`t1`~`t7`, `other`) 구성 — 스크립트는 전부 이어붙여
  `폭염경보 : 서울, 부산(해운대구…)` 패턴을 정규식으로 파싱하며, 원문은 `warnings.raw`에 보존됩니다.
  패턴이 다르면 `getWthrWrnMsg`(통보문) 로 교체하면 됩니다.
- 긴급재난문자 V2 응답 컬럼명(`CRT_DT`, `MSG_CN`, `RCPTN_RGN_NM`, `DST_SE_NM`, `EMRG_STEP_NM`, `SN`)과
  `crtDt`의 의미(조회시작일자).
- 한강홍수통제소 JSON의 최상위 키(`content` 가정; `list`/`data`도 허용) 및 소문자 필드명.
- 산사태예측정보 응답 구조(`response.body.items.item[]`, 필드 `lndslFrcstNm`, `sgg`, `prctnInfoAnlssDt`).
- 에어코리아 `getCtprvnRltmMesureDnsty` ver=1.3 응답 필드(`stationName`, `sidoName`, `dataTime`="YYYY-MM-DD HH:mm",
  `pm10Value`, `pm25Value`, `o3Value`, `khaiValue`; 결측은 `"-"`)와 `getMsrstnList`의 `addr`, `dmX`(위도)/`dmY`(경도, WGS84).
  스크립트는 dmX/dmY가 뒤바뀐 경우를 자동 보정하며, 주소→시군구 매칭은 `sgg_index.name`(공백 제거)이 주소에 포함되는지로 판단
  (광주/전남 sidoName은 통합 시도코드 12로 매핑). 등급은 `pm10Grade1h`/`pm25Grade1h` 대신 농도 기준
  (PM10 0-30/31-80/81-150/151+, PM2.5 0-15/16-35/36-75/76+)으로 스크립트가 계산합니다.
