#!/usr/bin/env python3
"""SafePic — 공공데이터포털 활용신청 제출용 샘플 (기상청 단기예보 2.0 초단기실황 + 기상특보, 표준 라이브러리만)

목적: 읍면동 단위 "내 동네" 화면에 현재 기온·체감·습도·바람·강수와 발효 중인 특보를 표시하고,
특보를 생활 행동 문구("오늘 할 일")로 바꿔 보여주기 위함.

실행:
  set DATA_GO_KR_KEY=발급받은_일반인증키(Decoding)
  python scripts/samples/kma_sample.py 60 127        # 관악구 격자 (nx ny)

운영 시: GitHub Actions가 초단기실황은 매시 정시(250시군구 × 24 = 6,000/일), 단기예보는 발표시각 8회(2,000/일),
특보는 30분(48/일)만 호출해 일 10,000건 한도 안에서 동작합니다. 키는 GitHub Secrets에만 둡니다.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

KEY = os.environ.get("DATA_GO_KR_KEY", "").strip()
VILAGE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
WARN = "https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList"


def get(url: str, **params):
    q = {"serviceKey": KEY, "dataType": "JSON", "pageNo": 1, "numOfRows": 100, **params}
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(q, safe=""), timeout=15) as r:
        return json.loads(r.read())


def main() -> int:
    if not KEY:
        print("DATA_GO_KR_KEY 환경변수가 없습니다."); return 1
    nx, ny = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("60", "127")
    # 초단기실황은 매시 40분 이후 직전 정시 자료가 안정적
    t = datetime.now() - timedelta(minutes=40)
    base_date, base_time = t.strftime("%Y%m%d"), t.strftime("%H00")
    try:
        j = get(VILAGE, base_date=base_date, base_time=base_time, nx=nx, ny=ny)
        items = j["response"]["body"]["items"]["item"]
        obs = {i["category"]: i["obsrValue"] for i in items}
        print(f"== 초단기실황 {base_date} {base_time} · 격자({nx},{ny}) · 출처: 기상청")
        print(f"  기온 {obs.get('T1H')}℃  습도 {obs.get('REH')}%  풍속 {obs.get('WSD')}m/s  풍향 {obs.get('VEC')}°  1시간 강수 {obs.get('RN1')}mm  강수형태 {obs.get('PTY')}")
    except Exception as e:  # noqa: BLE001
        print(f"  실황 호출 실패: {e.__class__.__name__} — 키 승인 전이거나 시각 오류일 수 있습니다.")
    try:
        w = get(WARN, stnId="108", fromTmFc=(datetime.now() - timedelta(days=2)).strftime("%Y%m%d"), toTmFc=datetime.now().strftime("%Y%m%d"))
        body = w["response"]["body"]
        n = body.get("totalCount", 0)
        print(f"== 기상특보 목록 (전국, 최근 2일): {n}건")
        for it in (body.get("items", {}).get("item") or [])[:5]:
            print(f"  {it.get('tmFc')}  {it.get('title', '')[:70]}")
    except Exception as e:  # noqa: BLE001
        print(f"  특보 호출 실패: {e.__class__.__name__}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
