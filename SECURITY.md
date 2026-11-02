# 보안 · Security

## 무엇이 서버에 남는가
AidPage는 정적 사이트입니다. 지원 찾기 답변은 브라우저 안에서 계산하고 서버로 보내지 않습니다. 서버(Cloudflare Worker)에 남는 것은
- 주민 제보: 글, 시군구·읍면동, 해시한 IP, 약 100 m 단위 좌표(위치를 켠 경우). 7일 뒤 내려감
- 익명 횟수: 방문·제출 등 이벤트 이름과 날짜, 시·도 단위까지
- 웹푸시 구독: 구독 주소와 키, 지역 코드. 180일(알림 자체에는 내용이 실리지 않습니다)
- 카카오 채널: 해시한 사용자 키와 등록한 동네. 180일, 대화 원문은 저장하지 않음

자료를 불러올 때 시군구 코드가 워커로 가고, 지도를 볼 때 지도 타일 서비스에 IP와 보는 구역이 전달됩니다.

## 취약점을 찾으셨다면
공개 이슈 대신 저장소의 **Security → Report a vulnerability**(비공개 제보)를 이용해 주세요. 확인하는 대로 답하고, 고친 뒤 알려 드립니다.
특히 알려 주시면 좋은 것: 입력이 의도와 달리 밖으로 나가는 경로, 제보 기능을 통한 스크립트 삽입, 저장소에 실수로 올라간 키.

## 시설 정보 제거 요청
대피소·시설 위치는 행정안전부 공개 자료를 옮긴 것입니다. 기관 또는 시설 관리자가 특정 시설의 제거를 요청하면 확인 후 다음 빌드에서 제거합니다. 위 취약점 신고와 같은 경로로 알려 주세요.

## 범위 밖
서비스 거부 시험, 타인의 제보를 지우거나 바꾸는 시험, 자동화된 대량 요청은 하지 말아 주세요.

---
*Please report vulnerabilities privately via GitHub "Report a vulnerability". AidPage sends no user input to any server; the Worker stores only short-lived resident reports, anonymous counters, and push subscriptions.*
