# 보안 · Security

## 무엇이 서버에 남는가
AidPage는 정적 사이트입니다. 입력(주소·피해·가구 상황)은 브라우저 안에서만 계산되고 어디로도 전송되지 않습니다. 서버(Cloudflare Worker)에 남는 것은 다음이 전부입니다.
- 주민 제보 텍스트(7일 뒤 자동 삭제, 좌표는 약 100 m 단위로 뭉갬)
- 익명 횟수(방문·제출 등 이벤트 이름과 날짜, 시·도 단위까지)
- 웹푸시 구독 주소와 구독 지역 코드(알림 자체에는 내용이 실리지 않습니다)

## 취약점을 찾으셨다면
공개 이슈 대신 저장소의 **Security → Report a vulnerability**(비공개 제보)를 이용해 주세요. 확인하는 대로 답하고, 고친 뒤 알려 드립니다.
특히 알려 주시면 좋은 것: 입력이 의도와 달리 밖으로 나가는 경로, 제보 기능을 통한 스크립트 삽입, 저장소에 실수로 올라간 키.

## 범위 밖
서비스 거부 시험, 타인의 제보를 지우거나 바꾸는 시험, 자동화된 대량 요청은 하지 말아 주세요.

---
*Please report vulnerabilities privately via GitHub "Report a vulnerability". AidPage sends no user input to any server; the Worker stores only short-lived resident reports, anonymous counters, and push subscriptions.*
