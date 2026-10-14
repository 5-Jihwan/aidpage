"""빌드 점검(docs/57 C1) — 산출물 개수를 data/admin/sgg_index.json(시군구 256)과 대조한다.

왜: 09-17 정읍(52180)은 격자 인구가 비어 조용히 255곳이 됐고, 10-11 개편 구 7곳은 시설이 0건인 채
공개됐다. 둘 다 "개수를 세는 한 줄"이 없어서 지나갔다. 전국 빌드를 돌린 뒤, 배포 전에 한 번 실행한다.

사용: python scripts/check_counts.py            # 참조 파일·격자·대피 접근
      python scripts/check_counts.py --shelters # + 시설 층별 0건 시군구(46 MB 읽음, 느림)
종료 코드 1 = 전수 파일(격자·인구·타입·문턱·사양·접근 층)에 빠진 곳이 있음. 부분 커버 파일(취약·사회·조례·위험지구)은 경고만.
"""
from __future__ import annotations

import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731


def load(*a):
    return json.load(open(P(*a), encoding="utf-8"))


def main(argv: list[str]) -> int:
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
    nopop = []
    for c in sorted(grid & codes):
        fs = load("data", "grid", f"{c}.geojson").get("features", [])
        if fs and not any(f["properties"].get("pop") is not None for f in fs):
            nopop.append(c)
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
        print("시설 층별 0건 시군구 (전국 층만 FAIL 후보 — 판단은 사람이)")
        index = load("data", "shelters", "index.json")
        for layer, files in index.items():
            cnt = {}
            for sido, rel in files.items():
                fp = P("data", "shelters", rel)
                if not os.path.exists(fp):
                    continue
                for f in load("data", "shelters", rel).get("features", []):
                    s = str(f["properties"].get("sgg") or "")
                    cnt[s] = cnt.get(s, 0) + 1
            zero = codes - set(cnt)
            print(f"  {'warn' if zero else 'OK  '} {layer:16s} 지점 {sum(cnt.values()):7,d}  0건 {len(zero):3d}곳" + (f"  {name(zero)}" if zero else ""))

    print("결과:", "이상 없음" if hard == 0 else f"전수 파일 결함 {hard}건 — 배포 전에 고칠 것")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
