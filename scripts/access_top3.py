"""문장 카드 v2(docs/56 N4) — 칸마다 가까운 임시주거시설 3곳까지의 보행 거리와 '가장 짧은 길에 무엇이 있나'를 미리 계산.
보행망·간선 위해는 access_batch.network() 그대로. 출력 data/access/<sgg>.json (사이트가 읽음, 기기 계산 sim_worker 대체):
  { s: [[이름, lon, lat], ...], c: { h3: [[시설 번호, 거리 m(길에 붙이는 거리 포함), 비트], ...3] } }
  비트: 1 깊은 침수 기록(0.5 m+) · 2 지하차도 150 m · 4 침수 기록(깊이 무관)
        · 8 평균 경사 15°+ 칸 · 16 산사태 기록 칸 · 32 지정 급경사지 150 m (8·16은 길 중간점이 든 격자 칸 값, v1 sim_worker와 같은 기준)
  길에서 300 m+ 떨어진 칸은 c에 'x': 붙인 거리 m 를 덧붙임.
  해안 시군구는 ts(지진해일 대피장소 목록)·t({h3: [번호, 거리 m, 비트]} 가장 가까운 1곳)도 담음 — 카드 표시는 결정 대기(docs/57).
사용: python scripts/access_top3.py 11620 52720 | all   (all = 이미 만든 곳 건너뜀)
"""
from __future__ import annotations

import heapq

import h3
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from access_batch import ROOT, UNDERPASS_M, kdtree, load, network, points  # noqa: E402

K = 3
DST = os.path.join(ROOT, 'data', 'access')


def k_nearest(G, src, k=K):
    """출발 노드 → 가장 가까운 시설 k곳(서로 다른)과 그 최단 경로의 위해 비트 OR. 시설 여러 곳에서 동시에 퍼지는 다익스트라."""
    best: dict = {}
    heap = [(0.0, sid, 0, n) for n, sids in src.items() for sid in sids]
    heapq.heapify(heap)
    while heap:
        d, sid, f, n = heapq.heappop(heap)
        lab = best.setdefault(n, {})
        if sid in lab or len(lab) >= k: continue
        lab[sid] = (d, f)
        for m, e in G[n].items():
            nb = best.get(m)
            if nb is None or (sid not in nb and len(nb) < k):
                heapq.heappush(heap, (d + e['len'], sid, f | e['f'], m))
    return best


def build(sgg):
    cells, cent, bbox, lat0, flood, G, nodes, k, snap, *_ = network(sgg)
    props = {c['properties']['h3']: c['properties'] for c in cells}
    res = h3.get_resolution(cells[0]['properties']['h3'])
    sf = load('data/shelters/index.json')['steep'].get(sgg[:2])
    st = points(f'data/shelters/{sf}', bbox) if sf else []
    st_tree = kdtree([p for p, _ in st], lat0)[0] if st else None
    for a, b, e in G.edges(data=True):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        cp = props.get(h3.latlng_to_cell(mid[1], mid[0], res)) or {}
        e['f'] |= (8 if (cp.get('slope_mean') or 0) >= 15 else 0) | (16 if (cp.get('landslide_hist_n') or 0) > 0 else 0)             | (32 if st_tree is not None and st_tree.query((mid[0] * k, mid[1] * 110540.0))[0] <= UNDERPASS_M else 0)

    def labels(kind, kk):
        pts = points(f'data/shelters/{kind}.geojson', bbox)
        src: dict = {}
        for i, (p, _) in enumerate(pts):
            src.setdefault(nodes[snap(p)[1]], []).append(i)
        return pts, (k_nearest(G, src, kk) if src else {})

    sh, best = labels('temp_housing', K)
    used, c = {}, {}
    for h, p in cent.items():
        sd, si = snap(p)
        lab = best.get(nodes[si]) or {}
        row = [[used.setdefault(sid, len(used)), round(d + sd), f] for sid, (d, f) in sorted(lab.items(), key=lambda x: x[1][0])]
        if sd > 300: row.append({'x': round(sd)})
        c[h] = row
    s = [None] * len(used)
    for sid, j in used.items():
        (lo, la), name = sh[sid]
        s[j] = [name, round(lo, 5), round(la, 5)]
    out = {'s': s, 'c': c}
    ts, tb = labels('tsunami', 1)
    if tb:
        tu, t = {}, {}
        for h, p in cent.items():
            sd, si = snap(p)
            for sid, (d, f) in (tb.get(nodes[si]) or {}).items():
                t[h] = [tu.setdefault(sid, len(tu)), round(d + sd), f]
        out['ts'] = [None] * len(tu)
        for sid, j in tu.items():
            out['ts'][j] = [ts[sid][1], round(ts[sid][0][0], 5), round(ts[sid][0][1], 5)]
        out['t'] = t
    return out


def main(args) -> int:
    os.makedirs(DST, exist_ok=True)
    codes = sorted(f[:-8] for f in os.listdir(os.path.join(ROOT, 'data', 'grid')) if f[:5].isdigit() and f.endswith('.geojson')) if args == ['all'] else args
    for sgg in codes:
        out = os.path.join(DST, f'{sgg}.json')
        if args == ['all'] and os.path.exists(out): continue
        d = build(sgg)
        with open(out + '.tmp', 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(out + '.tmp', out)   # 'all' 재실행이 반쪽 파일을 완료로 보지 않게(10-15)
        print(sgg, len(d['s']), 'shelters', len(d['c']), 'cells', os.path.getsize(out) // 1024, 'KB', flush=True)
    return 0


if __name__ == '__main__':
    # 자체 점검: 경로 A-B-C(길이 1·1), B-C 간선만 깊은 침수 → C에서 A까지 비트 1, 가장 가까운 순
    import networkx as nx
    T = nx.Graph(); T.add_edge('A', 'B', len=1, f=0); T.add_edge('B', 'C', len=1, f=1); T.add_edge('C', 'D', len=5, f=0)
    b = k_nearest(T, {'A': [0], 'D': [1]}, k=2)
    assert b['C'] == {0: (2, 1), 1: (5, 0)} and b['B'] == {0: (1, 0), 1: (6, 1)}, b
    sys.exit(main(sys.argv[1:]))
