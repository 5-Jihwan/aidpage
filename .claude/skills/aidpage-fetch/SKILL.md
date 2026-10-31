---
name: aidpage-fetch
description: AidPage 공공 API 수집 층 작업법. scripts/fetch_*.py, live_*.py를 고치거나 새 API·데이터셋을 붙일 때, 수집이 403·시간초과로 실패할 때, .github/workflows를 고칠 때 읽는다.
---

# aidpage-fetch

## 파일
- `scripts/live_common.py`: 키, HTTP, 호출 예산, 체감온도. `_calls`는 이 모듈 전역 하나뿐이고 다른 모듈은 `lc._calls`로 읽고 쓴다.
- `scripts/live_alerts.py`, `live_obs.py`: `fetch_live.py`가 불러 쓰는 특보·관측 수집.
- `scripts/fetch_daily.py`: 법령 본문 수집과 개정 감지.
- `.github/workflows/live.yml`: 10분마다 깨어나 평시엔 30분 슬롯만 수집하고, `data/live/.hot`이 있으면 매 10분 수집한다. 제한 시간 15분.
- `.github/workflows/daily.yml`: 하루 한 번(`20 19 * * *`, UTC) 법령·통계·행정구역 점검.

## 새 수집을 붙일 때
1. 호출은 `http_get`, `get_json`을 쓴다. `urllib`을 직접 부르면 호출 예산(`MAX_CALLS`)과 서비스 차단(`_DEAD`)을 벗어난다.
2. 키는 환경변수로만 읽는다. 로컬은 `.keys.env.parsed`(gitignore)에서, Actions는 secrets에서 온다. 새 키는 `live.yml`의 `env`에도 넣는다.
3. 재난안전데이터공유플랫폼은 데이터셋마다 따로 승인된다. `SD_SETS`에 `(IF코드, 환경변수)`를 추가한다.
4. 키가 없으면 파일을 건드리지 않고 끝낸다. `fetch_daily.py`가 기준이다.

## 실패를 읽는 법
- 403, 401: 미승인이거나 키 문제. `_DEAD`에 올라 그 실행에서는 다시 부르지 않는다.
- 연속 시간초과 3회: 같은 서비스를 건너뛴다. 없으면 256개 시군구 × 15초가 되어 Actions 15분 제한에 걸리고, 그 실행은 아무것도 저장하지 못한다.
- HTTP 200이어도 오류일 수 있다. 미등록 키는 200과 XML로 온다. 그래서 파싱까지 `get_json` 안에서 처리한다.
- 기상청 서비스는 `HUB_MAP`으로 API허브 판에 재시도한다.

## 지킬 것
- 로그에는 키 존재 여부만 남긴다(`fetch_live.py`의 `keys present:`). `serviceKey`가 URL에 붙으므로 전체 URL을 찍지 않는다.
- Windows 콘솔에서도 돌도록 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`를 둔다.
- `data/live/`는 수집기가 쓴다. 손으로 고치지 않는다.
- Actions가 main에 `live ...`, `ref: ...` 커밋을 계속 올린다. 푸시 전에 원격을 받는다.
- 워크플로의 `uses:`는 커밋 해시로 고정한다.

## 참고 문서
- `docs/02_외부API_통합설계_20260821.md`
- `docs/12_API목록_분류_20260903.md`
