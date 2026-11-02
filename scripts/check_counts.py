"""빌드 점검(docs/57 C1) — 산출물 개수를 data/admin/sgg_index.json(시군구 256)과 대조한다.

왜: 09-17 정읍(52180)은 격자 인구가 비어 조용히 255곳이 됐고, 10-11 개편 구 7곳은 시설이 0건인 채
공개됐다. 둘 다 "개수를 세는 한 줄"이 없어서 지나갔다. 전국 빌드를 돌린 뒤, 배포 전에 한 번 실행한다.

사용: python scripts/check_counts.py            # 참조 파일·격자·대피 접근
      python scripts/check_counts.py --shelters # + 시설 층별 0건 시군구·시도 구멍·위치 불일치(46 MB 읽음, 느림)
      python scripts/check_counts.py --selftest # 판정 함수 자체 점검
종료 코드 1 = 전수 파일(격자·인구·타입·문턱·사양·접근 층)에 빠진 곳이 있음. 부분 커버 파일(취약·사회·조례·위험지구)은 경고만.
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shelters_common import addr_sido_wrong, fire_name, reconcile  # noqa: E402

P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731


def load(*a):
    return json.load(open(P(*a), encoding="utf-8"))


KOREA = (124.0, 33.0, 132.0, 39.0)
BOX_MARGIN = 0.05  # 도(약 5 km) — 격자가 없는 시군구 가장자리 시설을 오탐하지 않을 여유
COASTAL = {"tsunami"}  # 원래 해안 시도에만 있는 층
# 남은 기존 결함. 고치면 줄일 것 — 늘어나면 FAIL.
KNOWN_HOLES: dict[str, set[str]] = {"meal": {"36"}, "underpass": {"51"}}
KNOWN_BAD: dict[str, int] = {"underpass": 1}  # 동서지하차도: 새만금 바다 위 도로라 어느 시군구 경계에도 안 든다


def bbox(features):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for x in c:
                walk(x)

    for f in features:
        walk(f["geometry"]["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


def in_box(box, lon, lat):
    return box is None or (box[0] - BOX_MARGIN <= lon <= box[2] + BOX_MARGIN and box[1] - BOX_MARGIN <= lat <= box[3] + BOX_MARGIN)


def shelter_layers():
    """(층 이름, 전 지점). 시도별로 나뉜 층은 index.json, 단일 파일 층은 data/shelters/<층>.geojson."""
    index = load("data", "shelters", "index.json")
    for layer, files in index.items():
        feats = []
        for rel in files.values():
            if os.path.exists(P("data", "shelters", rel)):
                feats += load("data", "shelters", rel).get("features", [])
        yield layer, feats
    for fn in sorted(os.listdir(P("data", "shelters"))):
        if fn.endswith(".geojson"):
            yield fn[:-8], load("data", "shelters", fn).get("features", [])


def selftest():
    assert addr_sido_wrong("경기도 안산시 단원구 동산로 29", "대구광역시")      # 실제 사례: 공단파출소
    assert addr_sido_wrong("전라북도 김제시 죽산면 죽산로 119-7", "경기도")
    assert not addr_sido_wrong("광주시 오포로859번길 29", "경기도")              # 경기 광주시
    assert not addr_sido_wrong("광주이씨 묘역", "경기도")
    assert not addr_sido_wrong("전라남도 여수시 삼산면 덕흥1길 30", "전남광주통합특별시")  # 옛 표기
    assert not addr_sido_wrong("충북 청주시 상당구 중고개로", "충청북도")
    assert not addr_sido_wrong("?서울특별시 양천구 목동서로 41", "서울특별시")
    assert not addr_sido_wrong(None, "서울특별시")
    box = bbox([{"geometry": {"coordinates": [[[127.0, 37.0], [127.1, 37.2]]]}}])
    assert box == (127.0, 37.0, 127.1, 37.2)
    assert in_box(box, 127.14, 37.0) and not in_box(box, 127.2, 37.0) and in_box(None, 0, 0)
    # 빌더의 판정 규칙(reconcile) — 모두 실제 사례
    fx = lambda lon, lat, addr, sgg: {"geometry": {"coordinates": [lon, lat]}, "properties": {"addr": addr, "sgg": sgg}}  # noqa: E731
    f = fx(129.91213, 37.5516, None, "11440")                                    # 합정동주민센터: 주소 없고 좌표는 동해상
    assert not reconcile("x", f)
    f = fx(126.91, 37.55, None, "11440")                                         # 제자리
    assert reconcile("x", f) and f["properties"]["sgg"] == "11440"
    f = fx(126.79338, 37.31293, "경기도 안산시 단원구 동산로 29", "27710")          # 공단파출소: 코드만 대구 달성군
    assert reconcile("x", f) and f["properties"]["sgg"] == "41273"
    f = fx(126.68577, 37.6105, "서구 검단로 449", None)                           # 코드 없음 → 좌표로
    assert reconcile("x", f) and f["properties"]["sgg"] == "28290"
    f = fx(127.51, 36.1, "서울특별시 중구", "44710")                               # 지하차도: 이름만 겹친 주소
    assert reconcile("underpass", f) and f["properties"]["addr"] is None and f["properties"]["sgg"] == "44710"
    assert not reconcile("wildfire_hist", fx(127.51, 36.1, "서울특별시 중구", "44710"))  # 다른 층은 판단 근거 없음
    assert fire_name("(청주동부소방서) (( Cheongjudongbu Fire Station ))") == "청주동부소방서"
    assert fire_name("함양119안전센터(Hamyang fire station)") == "함양119안전센터"
    assert fire_name("수원남부소방서(경기소방본부)") == "수원남부소방서"
    assert fire_name("군산소방서 경암119안전센터") == "군산소방서 경암119안전센터"
    print("selftest OK")


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        selftest()
        return 0
    idx = {s["code"]: s["name"] for s in load("data", "admin", "sgg_index.json")}
    codes = set(idx)
    hard = 0
    name = lambda cs: ", ".join(f"{c} {idx.get(c, '?')}" for c in sorted(cs)[:8]) + (" …" if len(cs) > 8 else "")  # noqa: E731

    def row(label, have, full=True, extra=""):
        nonlocal hard
        miss = codes - set(have)
        ok = not miss
        mark = "OK " if ok else ("FAIL" if full else "warn")
        if full and not ok:
            hard += 1
        print(f"  {mark:4s} {label:34s} {len(set(have) & codes):3d}/{len(codes)}" + (f"  빠짐: {name(miss)}" if miss else "") + (f"  {extra}" if extra else ""))

    print("전수 파일 (빠지면 FAIL)")
    grid = {f[:-8] for f in os.listdir(P("data", "grid")) if f.endswith(".geojson")}
    row("data/grid/*.geojson", grid)
    nopop, nokey = [], []
    KEYS = ("flood_hist_n", "landslide_hist_n", "slope_mean")   # 10-14: 서울 빌더에 landslide_hist_n이 통째로 없던 결함 재발 방지
    boxes = {}
    for c in sorted(grid & codes):
        fs = load("data", "grid", f"{c}.geojson").get("features", [])
        if "--shelters" in argv and fs:
            boxes[c] = bbox(fs)
        if fs and not any(f["properties"].get("pop") is not None for f in fs):
            nopop.append(c)
        if fs and any(k not in fs[0]["properties"] for k in KEYS):
            nokey.append(c)
    if nokey:
        hard += 1
        print(f"  FAIL 격자 필수 속성 {KEYS} 빠짐(빌더마다 속성이 다름): {name(nokey)}")
    else:
        print("  OK   격자 필수 속성 있음")
    if nopop:
        hard += 1
        print(f"  FAIL 격자 인구 속성 전부 null(주민등록 수신 실패 — 09-17 정읍 사례): {name(nopop)}")
    else:
        print("  OK   격자 인구 속성(pop) 있음")
    row("sgg_demo.json", load("data", "ref", "sgg_demo.json")["sgg"])
    ty = load("data", "ref", "sgg_types.json")
    row(f"sgg_types.json ({ty['meta'].get('version', '?')})", ty["sgg"])
    row("sgg_threshold.json", load("data", "ref", "sgg_threshold.json")["sgg"])
    specs = load("data", "ref", "sgg_type_specs.json")["specs"]
    for k, v in specs.items():
        row(f"sgg_type_specs.json [{k}]", v)
    if os.path.exists(P("data", "ref", "sgg_access.json")):
        row("sgg_access.json", load("data", "ref", "sgg_access.json")["sgg"])

    print("부분 커버 파일 (경고만 — 2026 개편 구·제주 행정시 등은 원천에 없을 수 있음)")
    row("sgg_vuln.json", load("data", "ref", "sgg_vuln.json")["sgg"], full=False)
    row("sgg_social.json", load("data", "ref", "sgg_social.json")["sgg"], full=False)
    row("sgg_ordin.json", load("data", "ref", "sgg_ordin.json")["sgg"], full=False)
    row("riskzone_by_sgg.json (지구 없는 곳은 정상)", load("data", "ref", "riskzone_by_sgg.json")["by_sgg"], full=False)
    acc = {f[:-5] for f in os.listdir(P("data", "access"))} if os.path.isdir(P("data", "access")) else set()
    row("data/access/<sgg>.json (N4 배치 진행)", acc, full=False)

    if "--shelters" in argv:
        print("시설 층별 점검 (0건 시군구는 판단은 사람이 / 시도 구멍·위치 불일치 증가는 FAIL)")
        sgg_all = {s["code"]: s for s in load("data", "admin", "sgg_index.json")}
        sido_sgg = {}
        for s in sgg_all.values():
            sido_sgg[s["sido"]] = sido_sgg.get(s["sido"], 0) + 1
        for layer, feats in shelter_layers():
            cnt, by_sido, nosgg, outside, addr, abroad, seen = {}, {}, 0, 0, 0, 0, 0
            for f in feats:
                p, s = f["properties"], str(f["properties"].get("sgg") or "")
                lon, lat = f["geometry"]["coordinates"]
                cnt[s] = cnt.get(s, 0) + 1
                abroad += not (KOREA[0] <= lon <= KOREA[2] and KOREA[1] <= lat <= KOREA[3])
                info = sgg_all.get(s)
                if not info:
                    nosgg += 1
                    continue
                by_sido[info["sido"]] = by_sido.get(info["sido"], 0) + 1
                out = not in_box(boxes.get(s), lon, lat)
                wrong = addr_sido_wrong(p.get("addr"), info["sido_name"])
                outside += out
                addr += wrong
                seen += out or wrong
            seen += nosgg
            zero = codes - set(cnt)
            print(f"  {'warn' if zero else 'OK  '} {layer:16s} 지점 {sum(cnt.values()):7,d}  0건 {len(zero):3d}곳" + (f"  {name(zero)}" if zero else ""))
            if abroad:
                hard += 1
                print(f"  FAIL {layer}: 한반도 밖 좌표 {abroad}건")
            if layer not in COASTAL:
                holes = {c for c, n in sido_sgg.items() if by_sido.get(c, 0) < n / 2}
                new = holes - KNOWN_HOLES.get(layer, set())
                if new:
                    hard += 1
                    print(f"  FAIL {layer}: 시도 통째로 비다시피 함(시군구 수의 절반 미만) {sorted(new)}")
                if holes - new:
                    print(f"  warn {layer}: 알려진 시도 구멍 {sorted(holes - new)}")
            limit = KNOWN_BAD.get(layer, 0)
            if seen > limit:
                hard += 1
                print(f"  FAIL {layer}: 위치·코드 불일치 {seen}건 > 상한 {limit} (시군구 밖 {outside}·주소 시도 다름 {addr}·코드 없음 {nosgg})")
            elif seen:
                print(f"  warn {layer}: 위치·코드 불일치 {seen}건 (시군구 밖 {outside}·주소 시도 다름 {addr}·코드 없음 {nosgg}, 상한 {limit})")

    print("결과:", "이상 없음" if hard == 0 else f"전수 파일 결함 {hard}건 — 배포 전에 고칠 것")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
