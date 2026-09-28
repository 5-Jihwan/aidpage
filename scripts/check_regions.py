# -*- coding: utf-8 -*-
"""행정구역 변경 감지 — 이미 받아 둔 응답만 읽는다(네트워크 호출 없음).

왜 이렇게 하나(2026-09-28):
  상류 경계 레포(vuski/admdongkor)를 폴링하면 "자료가 새로 나왔다"는 것만 알 뿐,
  정작 우리 파이프라인이 깨지는 순간은 못 잡는다. 진짜 신호는 정부 API 응답 안에 있다.
  실제로 기상청 지진 loc 이 "전남광주 신안군 …"으로 오고(광주·전남 통합), 특보는
  area_codes(50130 등)로 온다. 그래서 data/live/*.json 에 이미 저장된 값만 대조한다.

무엇을 잡나
  - 특보 area_codes 중 sgg_index 에 없는 코드          (시군구 신설·분구)
  - 재난문자 region 의 시도명이 sgg_index 에 없는 것    (시도 통합·개편)
  - 재난문자 region 의 시군구명이 sgg_index 에 없는 것  (시군구 개편)
  - 에어코리아 시도명이 수집기 매핑에 없다고 기록된 것

무엇을 못 잡나
  반대 방향 — 행정구역이 통합돼 코드가 '사라진' 경우. 응답이 안 오는 것과 그 지역에
  해당 자료가 원래 없는 것(E-Gen 미설치 군 등)을 구분할 수 없다. 연 1회 수동 점검 몫.

실행: python scripts/check_regions.py [--selftest]
산출: data/stats/region_check.json (daily.yml 이 data/stats 를 통째로 커밋한다)
종료 코드는 언제나 0 — 감지는 경고이지 차단이 아니다.
"""
import json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
SUB_SGG = ("읍", "면", "동", "리", "가")  # 시군구보다 아래 단위 → 대조 대상 아님


def load(path, default=None):
    try:
        return json.load(open(P(*path), encoding="utf-8"))
    except Exception:
        return default


def sgg_names(idx):
    """대조용 이름 집합. 일반구는 '수원시장안구'와 '장안구' 둘 다 받아 준다(표기가 기관마다 다름)."""
    names = set()
    for s in idx:
        names.add(s["name"])
        m = re.match(r"(.+?시)(.+구)$", s["name"])
        if m:
            names.add(m.group(1))
            names.add(m.group(2))
    return names


def region_tokens(region):
    """'대전광역시 서구 ,대전광역시 중구 ' -> [('대전광역시','서구'), ('대전광역시','중구')]
    읍면동이 붙어 오면 떼고 시군구까지만 본다. 시군구가 없으면 두 번째 값이 None."""
    out = []
    for part in str(region or "").split(","):
        tok = [t for t in part.split() if t]
        while len(tok) > 1 and tok[-1].endswith(SUB_SGG):
            tok.pop()
        if not tok:
            continue
        out.append((tok[0], tok[-1] if len(tok) > 1 else None))
    return out


def check():
    idx = load(("data", "admin", "sgg_index.json"), []) or []
    codes = {s["code"] for s in idx}
    names = sgg_names(idx)
    sidos = {s["sido_name"] for s in idx}
    unknown_codes, unknown_sido, unknown_sgg = set(), set(), set()

    a = load(("data", "live", "alerts.json"), {}) or {}
    warn_items = (a.get("warnings") or {}).get("items") or []
    msg_items = (a.get("messages") or {}).get("items") or []
    for it in warn_items:
        for c in it.get("area_codes") or []:
            if str(c) not in codes:
                unknown_codes.add(str(c))
    for m in msg_items:
        for sido, sgg in region_tokens(m.get("region")):
            if sido and sido not in sidos:
                unknown_sido.add(sido)
            if sgg and sgg not in names:
                unknown_sgg.add("%s %s" % (sido, sgg))

    air = load(("data", "live", "air.json"), {}) or {}
    unknown_air = sorted(set(air.get("unknown_sido") or []))

    out = {
        "updated": a.get("updated") or "",
        "checked": {"warning_codes": sum(len(i.get("area_codes") or []) for i in warn_items),
                    "messages": len(msg_items)},
        "unknown_sgg_codes": sorted(unknown_codes),
        "unknown_sido_names": sorted(unknown_sido),
        "unknown_sgg_names": sorted(unknown_sgg),
        "unknown_air_sido": unknown_air,
        "index": {"sgg": len(idx), "sido": len(sidos)},
    }
    hits = len(unknown_codes) + len(unknown_sido) + len(unknown_sgg) + len(unknown_air)
    out["status"] = "changed" if hits else "ok"

    os.makedirs(P("data", "stats"), exist_ok=True)
    with open(P("data", "stats", "region_check.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if hits:
        msg = ("행정구역 변경 의심 %d건 - 코드 %s / 시도 %s / 시군구 %s / 대기질 %s"
               % (hits, sorted(unknown_codes), sorted(unknown_sido), sorted(unknown_sgg), unknown_air))
        print("::warning title=REGION::" + msg)
        print(msg)
    else:
        print("region check ok - 특보코드 %d, 재난문자 %d건 대조, 미확인 0"
              % (out["checked"]["warning_codes"], out["checked"]["messages"]))
    return out


def selftest():
    idx = load(("data", "admin", "sgg_index.json"), []) or []
    names, sidos = sgg_names(idx), {s["sido_name"] for s in idx}
    # 읍면동이 붙어도 시군구를 집어낸다
    assert region_tokens("대전광역시 서구 ,대전광역시 중구 ") == [("대전광역시", "서구"), ("대전광역시", "중구")]
    assert region_tokens("강원특별자치도 삼척시 도계읍") == [("강원특별자치도", "삼척시")]
    assert region_tokens("충청북도 음성군 대소읍") == [("충청북도", "음성군")]
    assert region_tokens("경기도 수원시 장안구") == [("경기도", "장안구")]
    assert region_tokens("") == []
    # 일반구는 두 표기 모두 통과해야 오탐이 안 난다
    assert {"수원시장안구", "장안구", "수원시"} <= names
    # 현재 저장된 재난문자로 오탐이 0이어야 한다(나면 파싱 규칙이 틀린 것)
    a = load(("data", "live", "alerts.json"), {}) or {}
    for m in (a.get("messages") or {}).get("items") or []:
        for sido, sgg in region_tokens(m.get("region")):
            assert sido in sidos, "미확인 시도: %r" % sido
            assert sgg is None or sgg in names, "미확인 시군구: %r %r" % (sido, sgg)
    print("selftest OK - 시군구 %d, 시도 %d, 재난문자 %d건 오탐 0"
          % (len(idx), len(sidos), len((a.get("messages") or {}).get("items") or [])))


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        check()
