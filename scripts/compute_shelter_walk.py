"""격자 셀별 가까운 민방위 대피소 도보시간(shelter_min_walk, 분) 계산.

- 입력: data/grid/<sgg>.geojson (H3 폴리곤), data/shelters/civil_defense/<sido>.geojson
- 방법: 셀 중심(꼭짓점 평균) ↔ 대피소 하버사인 최근접, 67 m/분 (js/shelters.js와 동일 규약)
- 제자리 갱신·멱등. 키 불필요(전부 로컬 데이터).
"""
from __future__ import annotations

import io
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALK_M_PER_MIN = 67.0


def centroid(poly):
    ring = poly[0]
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def build(sgg: str):
    gpath = os.path.join(ROOT, "data", "grid", f"{sgg}.geojson")
    spath = os.path.join(ROOT, "data", "shelters", "civil_defense", f"{sgg[:2]}.geojson")
    grid = json.load(io.open(gpath, encoding="utf-8"))
    sh = json.load(io.open(spath, encoding="utf-8"))
    pts = [f["geometry"]["coordinates"] for f in sh["features"]
           if f.get("geometry", {}).get("type") == "Point"]
    if not pts:
        raise SystemExit(f"no shelters for {sgg}")
    R = 6371000.0

    def dist(a, b):
        la1, la2 = math.radians(a[1]), math.radians(b[1])
        dla, dlo = la2 - la1, math.radians(b[0] - a[0])
        s = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
        return 2 * R * math.asin(math.sqrt(s))

    # 성능: 위경도 박스 선별 후 정밀 계산 (관악 469셀 × 서울 2,901지점이면 전수도 무방)
    vals = []
    for f in grid["features"]:
        c = centroid(f["geometry"]["coordinates"])
        d = min(dist(c, p) for p in pts)
        w = max(1, round(d / WALK_M_PER_MIN))
        f["properties"]["shelter_min_walk"] = w
        vals.append(w)
    io.open(gpath, "w", encoding="utf-8", newline="").write(
        json.dumps(grid, ensure_ascii=False, separators=(",", ":")))
    vals.sort()
    print(f"[shelter_walk] {sgg}: cells {len(vals)}, walk min/median/max = "
          f"{vals[0]}/{vals[len(vals) // 2]}/{vals[-1]} 분, shelters {len(pts)}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "11620")
