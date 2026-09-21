# 고치는 데 함께해 주세요 · Contributing

AidPage는 재난 지원 제도를 **조건 → 금액 → 근거 조문 → 기한**으로 옮긴 규칙과, 그 규칙을 주민의 종이 한 장으로 내보내는 도구입니다. 가장 도움이 되는 기여는 **틀린 곳을 알려 주는 것**입니다.

## 무엇을 알려 주면 좋은가
1. **규칙 오류** — 금액·조건·기한·창구·서류가 실제와 다를 때. 근거(조문, 고시, 지자체 공고, 현장 경험)를 함께 적어 주세요. `추정`·`보도 기반`으로 표시된 항목의 원문을 아신다면 특히 반갑습니다.
2. **죽은 링크·옮겨진 페이지**
3. **지역 자료 정정** — 대피소 위치·이름, 행정구역 변경
4. **읽기 어려운 문장** — 어르신·외국인 주민·대신 알아보는 분이 막히는 곳

[이슈 만들기](https://github.com/5-Jihwan/aidpage/issues/new/choose)에서 양식을 고르면 됩니다. **개인정보(이름·주소·전화·피해 내용)는 적지 마세요.**

## 고치지 않는 것 (원칙)
- 이름·연락처·주소·가구 상황을 서버로 보내는 기능 — 계산은 브라우저 안에서 끝납니다.
- 지역의 순위·점수·등급 — 동네를 서열화하지 않습니다.
- 심사·판정 흉내 — 결과는 "해당 가능성"이고 최종 판단은 관할 지자체입니다.
- 길 안내·실시간 경보 — 국가가 하는 일이고, 여기서는 하지 않습니다.

## 코드를 고칠 때
- 빌드가 없는 정적 사이트입니다. 저장소 루트에서 `python -m http.server`로 띄우면 됩니다.
- 규칙을 바꾸면 `rules/en.json`(영어 오버레이)과 `rules/changelog.json`(기준 변경일 때)을 함께 고치고 `node scripts/test_rules.mjs`를 돌려 주세요.
- 바깥 링크를 넣거나 바꾸면 `python scripts/check_links.py --core`(한국 IP에서)로 확인해 주세요. 근거 링크는 부처 누리집의 깊은 주소보다 **법령 한글주소**(`law.go.kr/법령/○○법/제N조`)를 먼저 씁니다 — 조직 개편에도 깨지지 않습니다.
- JS를 바꾸면 `index.html`·`sw.js`의 `?v=` 태그를 올립니다.

---
*In short:* the most valuable contribution is telling us where a rule is wrong, with a source. No personal data in issues. We do not add data collection, rankings, adjudication, or routing.
