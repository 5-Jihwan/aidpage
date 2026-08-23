#!/usr/bin/env python3
"""SafePic — 공공데이터포털 활용신청 제출용 샘플 (응급의료 E-Gen, 표준 라이브러리만 사용)

목적: 사용자가 "가족이 다쳤어요"를 고르면 거주 시군구 기준으로 *지금 수용 가능한* 응급실을
안내하기 위해, 응급실 실시간 가용병상·중증질환 수용가능·기관 메시지를 조회합니다.

실행:
  set DATA_GO_KR_KEY=발급받은_일반인증키(Decoding)      (Windows)
  export DATA_GO_KR_KEY=...                               (macOS/Linux)
  python scripts/samples/egen_sample.py 서울특별시 관악구

키는 환경변수로만 읽고 코드·로그에 남기지 않습니다. 결과는 화면 출력 + data/live/er_sample.json 저장.
운영 시에는 GitHub Actions가 하루 3회 시군구 250곳을 순회(≈750건/일, 한도 1,000건 이내)하고,
원 데이터는 재배포하지 않으며 화면에 출처·조회시각을 표기합니다.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

BASE = "https://apis.data.go.kr/B552657/ErmctInfoInqireService"
OPS = {
    "beds": "getEmrrmRltmUsefulSckbdInfoInqire",   # 응급실 실시간 가용병상정보
    "severe": "getSrsillDissAceptncPosblInfoInqire",  # 중증질환자 수용가능정보
    "msg": "getEmrrmSrsillDissMsgInqire",           # 응급실 및 중증질환 메시지
}
KEY = os.environ.get("DATA_GO_KR_KEY", "").strip()


def call(op: str, **params) -> list[dict]:
    """한 번 호출해 <item> 목록을 dict 리스트로 돌려준다. 실패 시 빈 리스트(예외 없음)."""
    q = {"serviceKey": KEY, "pageNo": 1, "numOfRows": 50, **params}
    url = f"{BASE}/{op}?" + urllib.parse.urlencode(q, safe="")
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            root = ET.fromstring(r.read())
    except Exception as e:  # noqa: BLE001
        print(f"  [{op}] 호출 실패: {e.__class__.__name__}", file=sys.stderr)
        return []
    code = root.findtext(".//resultCode")
    if code not in (None, "00"):
        print(f"  [{op}] resultCode={code} {root.findtext('.//resultMsg')}", file=sys.stderr)
        return []
    return [{c.tag: (c.text or "").strip() for c in item} for item in root.iter("item")]


def main() -> int:
    if not KEY:
        print("DATA_GO_KR_KEY 환경변수가 없습니다. 키는 코드에 적지 말고 환경변수로 넣어 주세요.")
        return 1
    sido = sys.argv[1] if len(sys.argv) > 1 else "서울특별시"
    sgg = sys.argv[2] if len(sys.argv) > 2 else "관악구"
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    print(f"== 응급실 실시간 가용병상 · {sido} {sgg} · 조회 {now} (출처: 중앙응급의료센터 E-Gen)")

    beds = call(OPS["beds"], STAGE1=sido, STAGE2=sgg)
    for b in beds:
        print(f"  {b.get('dutyName','?'):<22} 응급실 가용 {b.get('hvec','-'):>3}  수술실 {b.get('hvoc','-'):>3}  "
              f"CT {b.get('hvctayn','-')}  MRI {b.get('hvmriayn','-')}  갱신 {b.get('hvidate','')}")
    print(f"  → {len(beds)}곳")

    print("== 중증질환 수용가능 (예: 뇌출혈수술 MKioskTy1, 심근경색 MKioskTy4)")
    severe = call(OPS["severe"], STAGE1=sido, STAGE2=sgg)
    for s in severe[:10]:
        print(f"  {s.get('dutyName','?'):<22} 뇌출혈 {s.get('MKioskTy1','-')}  심근경색 {s.get('MKioskTy4','-')}  "
              f"중증외상 {s.get('MKioskTy10','-')}  화상 {s.get('MKioskTy8','-')}")

    print("== 기관 메시지 (장비 고장·진료 불가 공지)")
    msgs = call(OPS["msg"], Q0=sido, Q1=sgg)
    for m in msgs[:10]:
        print(f"  {m.get('dutyName','?'):<22} {m.get('symBlkMsg','')[:60]}  ({m.get('symBlkSttDtm','')}~{m.get('symBlkEndDtm','')})")

    out = {"source": "중앙응급의료센터 E-Gen (data.go.kr B552657)", "queried_at": now, "sido": sido, "sgg": sgg,
           "beds": beds, "severe": severe, "messages": msgs}
    os.makedirs("data/live", exist_ok=True)
    with open("data/live/er_sample.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("저장: data/live/er_sample.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
