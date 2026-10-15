"""공공데이터포털(data.go.kr) 승인 상태 점검 — 한국 IP인 이 PC에서 실행한다.

목적: GitHub Actions(해외 IP)에서는 apis.data.go.kr이 403/무응답을 돌려주는 일이 있어
"활용신청 미승인"과 "해외 IP 차단"을 구분할 수 없다. 여기서 성공(resultCode 00)하면 키·승인은 정상이고
Actions 문제이므로 로컬 수집기로 옮기면 되고, 코드 30(미신청)·31(기간만료)·다른 오류면 포털 마이페이지 조치.

사용: .keys.env(gitignore됨)에 DATA_GO_KR_KEY=... 한 줄을 넣고  `python scripts/probe_datago.py`
      키 값은 출력하지 않는다.
"""
from __future__ import annotations

import datetime as dt
import io
import os
import re
import sys
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_key() -> str:
    k = os.environ.get("DATA_GO_KR_KEY", "").strip()
    for p in (".keys.env", ".keys.env.parsed"):
        fp = os.path.join(ROOT, p)
        if k or not os.path.exists(fp):
            continue
        for line in io.open(fp, encoding="utf-8"):
            m = re.match(r"^DATA_GO_KR_KEY=(.*)$", line.strip())
            if m:
                k = m.group(1).strip().strip("\"'")
    return k


def call(name: str, url: str, params: dict) -> None:
    q = urllib.parse.urlencode(params, safe="=%+/")
    try:
        with urllib.request.urlopen(urllib.request.Request(url + "?" + q, headers={"User-Agent": "aidpage-probe"}), timeout=25) as r:
            body = r.read()[:600].decode("utf-8", "replace")
            http = r.status
    except urllib.error.HTTPError as e:
        body = e.read()[:600].decode("utf-8", "replace"); http = e.code
    except Exception as e:  # noqa: BLE001
        print(f"{name:14s} EXC {str(e)[:120]}"); return
    m = re.search(r"resultCode>\s*(\d+)|\"resultCode\"\s*:\s*\"?(\d+)|<returnReasonCode>(\d+)|resultCode=(\d+)", body)
    code = next((g for g in (m.groups() if m else ()) if g), "?")
    msg = re.search(r"resultMsg>([^<]*)|\"resultMsg\"\s*:\s*\"([^\"]*)|<returnAuthMsg>([^<]*)", body)
    msg = next((g for g in (msg.groups() if msg else ()) if g), "")
    verdict = {"00": "정상 → 키·승인 OK(Actions면 해외 IP 문제)", "0": "정상", "30": "미신청/키 불일치 → 포털에서 활용신청", "31": "기간 만료 → 연장", "22": "일일 한도 초과", "99": "포털 오류"}.get(code, "확인 필요")
    print(f"{name:14s} HTTP {http} | resultCode {code} {msg[:40]} | {verdict}")


def main() -> None:
    k = load_key()
    if not k:
        print("DATA_GO_KR_KEY 없음 — .keys.env에 DATA_GO_KR_KEY=... 를 넣거나 환경변수로 주세요"); return
    now = dt.datetime.now() - dt.timedelta(hours=1)
    call("기상청 초단기실황", "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
         dict(serviceKey=k, numOfRows=10, pageNo=1, dataType="JSON", base_date=now.strftime("%Y%m%d"), base_time=now.strftime("%H00"), nx=60, ny=127))
    call("에어코리아", "https://apis.data.go.kr/B552584/ArpltnInfoInqireSvc/getCtprvnRltmMesureDnsty",
         dict(serviceKey=k, returnType="json", numOfRows=5, pageNo=1, sidoName="서울", ver="1.0"))
    call("E-Gen 응급실", "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire",
         dict(serviceKey=k, STAGE1="서울특별시", STAGE2="관악구", numOfRows=3, pageNo=1))
    call("통계연보 시설피해", "https://api.odcloud.kr/api/15107320/v1/uddi:placeholder", dict(serviceKey=k, page=1, perPage=1)) if False else None


if __name__ == "__main__":
    main()
