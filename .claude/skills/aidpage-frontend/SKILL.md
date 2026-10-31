---
name: aidpage-frontend
description: AidPage 화면 층 작업법. js/, css/, index.html, sw.js를 고칠 때, 문구나 번역을 바꿀 때, 배포 버전을 올릴 때 읽는다. 도감(Atlas) 화면은 별도 저장소 aidpage-atlas에서 고친다.
---

# aidpage-frontend

## 구조
- 빌드 없는 정적 사이트다. 번들러나 npm 의존성을 넣지 않는다. 지도는 MapLibre다.
- `js/app.js`가 공용 상태 `state`와 `$`, `$$`를 내보내고, 기능은 `app_map`, `app_layers`, `app_panel`, `app_ui`, `app_wizard`, `app_wx`로 나뉜다.
- JS 파일 하나는 500줄을 넘기지 않는다. 넘으면 기능별로 나눈다.
- 사용자 입력이나 외부 자료를 HTML에 넣을 때는 `escapeHTML`을 쓴다.
- `localStorage` 키 접두사와 캐시 이름의 `safepic`은 그대로 둔다. 바꾸면 기존 방문자의 설정과 캐시가 끊긴다.

## 문구
- 화면 글자는 `t(key, vars)` 또는 `data-i18n="key"`로만 넣는다.
- 한국어와 영어는 `js/i18n.js`, 나머지(ja, zh, vi, es, fr)는 `js/i18n/<lang>.js`에 있다.
- 키가 없으면 영어, 그다음 한국어로 대체된다. 새 키는 ko와 en에 꼭 넣고, 나머지 언어는 넣지 못했으면 작업 보고에 적는다.

## 배포 버전
바꾼 파일을 가리키는 `?v=`를 모두 올린다. 날짜 뒤에 그날 순번을 붙인다(`20261020a`).
- `index.html`의 css, js 태그
- `js/*.js`의 import 문과 `js/i18n.js`의 언어 파일 import
- `sw.js`의 `VERSION`

새 모듈을 만들면 `sw.js`의 `SHELL`에 넣을지 판단한다. 데이터 캐시 규칙은 `aidpage-data-build`에 있다.

## 하지 않는 것
`CONTRIBUTING.md`의 원칙을 따른다.
- 이름, 연락처, 주소, 가구 상황을 서버로 보내지 않는다. 계산은 브라우저 안에서 끝난다.
- 지역 순위, 점수, 등급을 만들지 않는다.
- 판정처럼 말하지 않는다. 결과는 해당 가능성이고 최종 판단은 관할 지자체다.
- 길 안내와 실시간 경보를 하지 않는다.

## 반영 순서
보이는 변경은 바로 커밋하거나 푸시하지 않는다. `aidpage-preview`로 화면을 보여 주고 판단을 받은 뒤 반영한다.

## 참고 문서
- `docs/50_다국어_언어선정_글꼴_20261007.md`
