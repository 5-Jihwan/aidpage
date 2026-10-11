"""대피 접근 계기 1단계(docs/53): 격자 칸마다 '위해를 피해 도착지에 닿을 수 있나'를 OSM 보행망으로 잰다.

사용: python scripts/access_batch.py 11620 52720
- 보행망: OSM Overpass(키 없음) → .work_access/osm_<sgg>.json 캐시
- 시나리오 flood: 위해 = 길이 실제 침수흔적 폴리곤과 겹침(민감도: 깊이 0.5 m 이상만) + 지하차도 150 m, 도착지 = 이재민 임시주거시설
- 시나리오 quake: 위해 없음(시간만), 도착지 = 지진 옥외대피장소
- 출력: docs/access/<sgg>_cells.csv, docs/access/summary.json
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import h3
import networkx as nx
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, '.work_access')
OUT = os.path.join(ROOT, 'docs', 'access')
WALK, SLOW = 67.0, 48.0          # m/분 — 민방위 규약 / 고령·거동 불편(약 0.8 m/s)
BUF_DEG = 0.015                  # 경계 상자 여유 약 1.5 km — 시군구 밖 도착지도 잡게
UNDERPASS_M = 150.0
MIN_COMP = 1000                  # 이 크기 이상의 길 덩어리는 모두 남김 — 섬(다리 없는)마다 따로 이어진 길. 작은 조각(단지 안 길 등)만 버림
NO_WALK = 'motorway|motorway_link|trunk_link|construction|proposed|raceway|bus_guideway'
R = 6371008.8


def load(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return json.load(f)


def hav(a, b):
    (lo1, la1), (lo2, la2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))


def centroid(geom):
    ring = geom['coordinates'][0]
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def overpass(sgg, bbox, what='walk'):
    os.makedirs(WORK, exist_ok=True)
    cache = os.path.join(WORK, f'osm_{sgg}.json' if what == 'walk' else f'osm_{what}_{sgg}.json')
    if os.path.exists(cache):
        return json.load(open(cache, encoding='utf-8'))
    s, w, n, e = bbox
    q = (f'[out:json][timeout:180];way["highway"]["highway"!~"{NO_WALK}"]["foot"!="no"]["access"!="private"]({s},{w},{n},{e});out geom;'
         if what == 'walk' else f'[out:json][timeout:180];way["building"]({s},{w},{n},{e});out center;')
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(),
                                 headers={'User-Agent': 'AidPage-research/1.0 (github.com/5-Jihwan/aidpage)'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                d = json.load(r)
            json.dump(d, open(cache, 'w', encoding='utf-8'))
            return d
        except Exception as ex:  # Overpass는 붐비면 429/504 — 잠깐 쉬고 재시도
            print('  overpass retry', attempt + 1, ex)
            time.sleep(20 * (attempt + 1))
    raise RuntimeError('overpass failed')


def points(kind_path, bbox):
    s, w, n, e = bbox
    out = []
    for f in load(kind_path)['features']:
        lo, la = f['geometry']['coordinates'][:2]
        if s <= la <= n and w <= lo <= e:
            out.append(((lo, la), f['properties'].get('name') or ''))
    return out


def kdtree(coords, lat0):
    k = math.cos(math.radians(lat0)) * 111320.0
    return cKDTree([(lo * k, la * 110540.0) for lo, la in coords]), k


def flood_polygons(sgg, bbox):
    """실제 침수흔적 폴리곤(EPSG:5179) — 서울은 서울시 침수흔적도 캐시, 그 밖은 행안부 전국 침수흔적도."""
    import glob, warnings
    import geopandas as gpd
    from shapely.geometry import box
    s, w, n, e = bbox
    clip = gpd.GeoSeries([box(w, s, e, n)], crs=4326).to_crs(5179).iloc[0]
    if sgg.startswith('11'):
        parts = []
        for shp in glob.glob(os.path.join(ROOT, '.work_grid', 'flood', 'x*', '*.shp')):
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                g = gpd.read_file(shp, encoding='cp949')
            g = g[g.geometry.notna()]
            g = g.set_crs(5179) if g.crs is None else g.to_crs(5179)
            g['depth'] = g['F_SHIM'].astype(float) if 'F_SHIM' in g else None
            parts.append(g[['depth', 'geometry']])
        fl = gpd.GeoDataFrame(__import__('pandas').concat(parts, ignore_index=True), crs=5179)
    else:
        sys.path.insert(0, os.path.join(ROOT, 'scripts'))
        from build_grid_nation import load_flood_nation
        fl = load_flood_nation().to_crs(5179)
    fl = fl[fl.intersects(clip)].copy()
    fl['geometry'] = fl.buffer(0)
    return fl


EXPORT_PATHS = os.environ.get('ACCESS_PATHS', '1') == '1'


def feature(t):
    """보행 시설 구분 — 횡단보도·육교(보행 다리)·계단·지하보도. 재생 안내와 휠체어 지표에 쓴다."""
    hw = t.get('highway', '')
    if t.get('footway') == 'crossing' or hw == 'crossing': return 'cross'
    foot = hw in ('footway', 'path', 'steps', 'pedestrian', 'corridor')
    if foot and t.get('tunnel') not in (None, 'no'): return 'tunnel'
    if foot and t.get('bridge') not in (None, 'no'): return 'bridge'
    if hw == 'steps': return 'steps'
    return ''


def pick_cases(rows):
    """재생할 대표 칸: 인구 많은 우회 사례 3 · 출발부터 침수 1 · 갇힘 1 · 가장 먼 사례 1."""
    def top(f, n=1, key=lambda r: -r['pop']):
        return sorted([r for r in rows if f(r)], key=key)[:n]
    detour = top(lambda r: r['hz_on_shortest'] == 1 and not r['in_flood'] and not r['trapped'] and r['safe_min'] and r['walk_min']
                 and r['safe_min'] - r['walk_min'] >= 1.5 and r['pop'] > 0, 3)
    out = [('detour', r) for r in detour]
    out += [('start', r) for r in top(lambda r: r['in_flood'] and r['pop'] > 0)]
    out += [('trapped', r) for r in top(lambda r: r['trapped'] and r['pop'] > 0)]
    out += [('far', r) for r in top(lambda r: r['safe_min'] and r['pop'] >= 20, key=lambda r: -r['safe_min'])]
    seen, uniq = set(), []
    for k, r in out:
        if r['h3'] not in seen: seen.add(r['h3']); uniq.append((k, r))
    return uniq


def export_paths(sgg, G, safe, rows, cent, snap, nodes, shelters, fl):
    """대표 칸마다 지름길(전체 그래프)·무위해 길(위해 간선 제외)을 GeoJSON으로 — walk.html 재생용."""
    import geopandas as gpd
    from shapely.geometry import LineString
    sname = {}
    for p0, name in shelters:
        sname.setdefault(nodes[snap(p0)[1]], name)
    srcs = list(sname)
    feats, lines = [], []
    for kind, r in pick_cases(rows):
        start = nodes[snap(cent[r['h3']])[1]]
        for route, graph in (('shortest', G), ('safe', safe)):
            src = [x for x in srcs if x in graph]
            if start not in graph or not src:
                continue
            try:
                dist, path = nx.multi_source_dijkstra(graph, src, target=start, weight='len')
            except nx.NetworkXNoPath:
                continue
            path = path[::-1]  # 칸 → 시설
            hz = [int(G[a][b]['hz']) for a, b in zip(path, path[1:])]
            ft = [G[a][b].get('ft', '') for a, b in zip(path, path[1:])]
            feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [list(map(lambda v: round(v, 6), q)) for q in path]},
                          'properties': {'case': f"{kind}:{r['h3']}", 'kind': kind, 'route': route, 'emd': r['emd'], 'pop': r['pop'],
                                         'meters': round(dist), 'min': round(dist / WALK, 1), 'min_slow': round(dist / SLOW, 1),
                                         'hz': hz, 'ft': ft, 'n_cross': sum(1 for i, f in enumerate(ft) if f == 'cross' and (i == 0 or ft[i - 1] != 'cross')),
                                         'stairs': any(f in ('steps', 'bridge') for f in ft), 'hz_m': round(sum(G[a][b]['len'] for (a, b), h in zip(zip(path, path[1:]), hz) if h)),
                                         'dest': sname.get(path[-1], '')}})
            lines.append(LineString(path))
    near = gpd.GeoSeries(lines, crs=4326).to_crs(5179).buffer(400).union_all() if lines else None
    fz = fl[fl.intersects(near)].copy() if near is not None else fl.iloc[0:0]
    fz['geometry'] = fz.geometry.simplify(2)
    fz = fz.to_crs(4326)
    flood = [{'type': 'Feature', 'geometry': g.__geo_interface__, 'properties': {'depth': None if d != d else d}}
             for g, d in zip(fz.geometry, fz['depth'])]
    json.dump({'type': 'FeatureCollection', 'features': feats, 'flood': {'type': 'FeatureCollection', 'features': flood}},
              open(os.path.join(OUT, f'paths_{sgg}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'  paths {sgg}: {len(feats)} routes, {len(flood)} flood polygons nearby')


def run(sgg):
    idx = load('data/shelters/index.json')
    sido = sgg[:2]
    cells = load(f'data/grid/{sgg}.geojson')['features']
    cent = {c['properties']['h3']: centroid(c['geometry']) for c in cells}
    lons = [p[0] for p in cent.values()]; lats = [p[1] for p in cent.values()]
    bbox = (min(lats) - BUF_DEG, min(lons) - BUF_DEG, max(lats) + BUF_DEG, max(lons) + BUF_DEG)
    lat0 = (bbox[0] + bbox[2]) / 2
    flood = {c['properties']['h3'] for c in cells if (c['properties'].get('flood_hist_n') or 0) > 0}   # 칸 표시용(위해 판정은 폴리곤)

    # 1) 보행망
    osm = overpass(sgg, bbox)
    G = nx.Graph()
    for el in osm['elements']:
        g = el.get('geometry') or []; ft = feature(el.get('tags') or {})
        for a, b in zip(g, g[1:]):
            pa, pb = (a['lon'], a['lat']), (b['lon'], b['lat'])
            G.add_edge(pa, pb, len=hav(pa, pb), ft=ft)
    # 가장 큰 덩어리 + 임시주거시설이 있는 큰 덩어리(섬 길)만 남김. 시설 없는 덩어리는 버려서 그 칸은 예전처럼 가장 가까운 남은 길에 붙임
    # (10-10 수정: 예전엔 가장 큰 것만 → 섬 주민이 육지 길에 붙어 수백 분. 시설 조건은 육지에서 길이 끊긴 조각을 '못 감'으로 오판하지 않게)
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    extra = [c for c in comps[1:] if len(c) >= MIN_COMP]
    if extra:
        cand = list(set().union(*extra)); ct, ck = kdtree(cand, lat0)
        hits = [ct.query((p[0] * ck, p[1] * 110540.0)) for p, _ in points('data/shelters/temp_housing.geojson', bbox)]
        served = {cand[i] for d, i in hits if d <= 300}   # 시설이 그 덩어리 길에서 300 m 안일 때만 '시설 있음'
        extra = [c for c in extra if c & served]
    G = G.subgraph(set().union(comps[0], *extra)).copy()
    nodes = list(G.nodes)
    tree, k = kdtree(nodes, lat0)
    snap = lambda p: tree.query((p[0] * k, p[1] * 110540.0))  # (거리 m, 인덱스)

    # 2) 간선 위해(물 시나리오) — 길이 실제 침수흔적 폴리곤과 겹치나(깊이 무관 / 0.5 m 이상) + 지하차도 150 m
    import geopandas as gpd
    from shapely.geometry import LineString
    fl = flood_polygons(sgg, bbox)
    elist = list(G.edges())
    eg = gpd.GeoDataFrame({'i': range(len(elist))}, geometry=[LineString([a, b]) for a, b in elist], crs=4326).to_crs(5179)
    hit = gpd.sjoin(eg, fl[['depth', 'geometry']], predicate='intersects', how='inner')
    hit_any = set(hit['i'])
    hit_deep = set(hit.loc[hit['depth'].fillna(0) >= 0.5, 'i'])
    ups = points('data/shelters/underpass.geojson', bbox)
    up_tree = kdtree([p for p, _ in ups], lat0)[0] if ups else None
    hz = hzd = 0
    for i, (a, b) in enumerate(elist):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        up = up_tree is not None and up_tree.query((mid[0] * k, mid[1] * 110540.0))[0] <= UNDERPASS_M
        G[a][b]['hz'] = i in hit_any or up; G[a][b]['hzd'] = i in hit_deep or up
        hz += G[a][b]['hz']; hzd += G[a][b]['hzd']
    safe = G.edge_subgraph([(a, b) for a, b, d in G.edges(data=True) if not d['hz']])
    wheel = G.edge_subgraph([(a, b) for a, b, d in G.edges(data=True) if not d['hz'] and d.get('ft') != 'steps'])
    safe_d = G.edge_subgraph([(a, b) for a, b, d in G.edges(data=True) if not d['hzd']])

    # 3) 도착지
    dest = {
        'flood': [p for p, _ in points('data/shelters/temp_housing.geojson', bbox)],
        'quake': [p for p, _ in points(f"data/shelters/{idx['quake'][sido]}", bbox)],
    }

    def reach(graph, pts):
        src = {nodes[snap(p)[1]] for p in pts}
        src = [s for s in src if s in graph]
        return nx.multi_source_dijkstra_path_length(graph, src, weight='len') if src else {}

    d_all = reach(G, dest['flood']); d_safe = reach(safe, dest['flood']); d_deep = reach(safe_d, dest['flood'])
    d_quake = reach(G, dest['quake']); d_wheel = reach(wheel, dest['flood'])

    # 4) 칸별 지표 — 인구는 읍면동 총인구를 칸 수로 균등 배분
    res = h3.get_resolution(cells[0]['properties']['h3'])
    bl = {}
    for el in overpass(sgg, bbox, 'bldg')['elements']:
        c0 = el.get('center')
        if c0: h = h3.latlng_to_cell(c0['lat'], c0['lon'], res); bl[h] = bl.get(h, 0) + 1
    per_emd, bl_emd = {}, {}
    for c in cells:
        e = c['properties']['emd_code']
        per_emd[e] = per_emd.get(e, 0) + 1; bl_emd[e] = bl_emd.get(e, 0) + bl.get(c['properties']['h3'], 0)
    rows = []
    for c in cells:
        p = c['properties']; h = p['h3']; sd, si = snap(cent[h]); n = nodes[si]
        e = p['emd_code']; nb = bl.get(h, 0)
        pop = (p.get('pop') or 0) * (nb / bl_emd[e] if bl_emd[e] else 1 / per_emd[e])   # 건물 수 비례(OSM 건물 없으면 균등)
        a = d_all.get(n); s = d_safe.get(n); sdp = d_deep.get(n); qk = d_quake.get(n)
        in_flood = n not in safe   # 출발 지점의 길이 모두 침수 이력(=이미 위해 안)
        rows.append({
            'h3': h, 'emd': p['emd_name'], 'pop': round(pop, 1), 'bldg': nb, 'snap_m': round(sd),
            'in_flood': int(in_flood), 'cell_flood_hist': int(h in flood),
            'walk_min': None if a is None else round((a + sd) / WALK, 1),
            'safe_min': None if s is None else round((s + sd) / WALK, 1),
            'safe_min_slow': None if s is None else round((s + sd) / SLOW, 1),
            'hz_on_shortest': None if a is None else int(s is None or s > a + 10),
            'trapped': int(a is not None and s is None and not in_flood),
            'trapped_deep': int(a is not None and sdp is None and n in safe_d),
            'hz_on_shortest_deep': None if a is None else int(sdp is None or sdp > a + 10),
            'quake_min': None if qk is None else round((qk + sd) / WALK, 1),
            'wheel_min': None if d_wheel.get(n) is None else round((d_wheel[n] + sd) / SLOW, 1),
            'line_min_civil': p.get('shelter_min_walk'),
        })
    if EXPORT_PATHS:
        export_paths(sgg, G, safe, rows, cent, snap, nodes, points('data/shelters/temp_housing.geojson', bbox), fl)
    return rows, {'nodes': G.number_of_nodes(), 'edges': G.number_of_edges(), 'hz_edges': hz, 'hz_edges_deep': hzd, 'flood_polygons': len(fl),
                  'temp_housing': len(dest['flood']), 'quake_sites': len(dest['quake']), 'underpass': len(ups)}


def summarize(rows):
    P = sum(r['pop'] for r in rows) or 1
    w = lambda f: round(100 * sum(r['pop'] for r in rows if f(r)) / P, 1)
    ok = [r for r in rows if r['safe_min'] is not None]
    def med(pairs):  # 인구 가중 중앙값 — [(값, 인구)]
        pairs = sorted(pairs); tot = sum(w for _, w in pairs); acc = 0
        for v, w in pairs:
            acc += w
            if acc >= tot / 2: return v
        return None
    return {
        'cells': len(rows), 'pop': round(P),
        'pct_in_flood_cell': w(lambda r: r['in_flood']),
        'pct_hz_on_shortest': w(lambda r: r['hz_on_shortest'] == 1 and not r['in_flood']),
        'pct_trapped': w(lambda r: r['trapped']),
        'pct_trapped_deep': w(lambda r: r['trapped_deep']),
        'pct_hz_on_shortest_deep': w(lambda r: r['hz_on_shortest_deep'] == 1 and r['trapped_deep'] == 0),
        'pct_far_30min_slow': w(lambda r: r['walk_min'] is None or (r['safe_min_slow'] is not None and r['safe_min_slow'] > 30)),   # 걸어서 닿을 길 없음(섬에 시설 없음)도 '먼 곳'
        'pct_far_60min_slow': w(lambda r: r['walk_min'] is None or (r['safe_min_slow'] is not None and r['safe_min_slow'] > 60)),
        'pct_no_walk': w(lambda r: r['walk_min'] is None),
        'pct_wheel_none_or_60': w(lambda r: not r['in_flood'] and (r.get('wheel_min') is None or r['wheel_min'] > 60)),   # 출발부터 위해 안인 칸은 따로 셈
        'pct_wheel_worse_5min': w(lambda r: r.get('wheel_min') is not None and r['safe_min_slow'] is not None and r['wheel_min'] - r['safe_min_slow'] >= 5),
        'median_safe_min': med([(r['safe_min'], r['pop']) for r in ok]),
        'median_safe_min_slow': med([(r['safe_min_slow'], r['pop']) for r in ok]),
        'median_quake_min': med([(r['quake_min'], r['pop']) for r in rows if r['quake_min'] is not None]),
        'pct_snap_over_300m': w(lambda r: r['snap_m'] > 300),
    }


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    sp = os.path.join(OUT, 'summary.json')
    summary = json.load(open(sp, encoding='utf-8')) if os.path.exists(sp) else {}
    args = sys.argv[1:] or ['11620', '52720']
    if args == ['all']:
        args = sorted(f[:-8] for f in os.listdir(os.path.join(ROOT, 'data', 'grid')) if f[:5].isdigit() and f.endswith('.geojson'))
        args = [g for g in args if not os.path.exists(os.path.join(OUT, f'{g}_cells.csv'))]
        print('todo', len(args), flush=True)
    for sgg in args:
        t = time.time()
        try:
            rows, info = run(sgg)
        except Exception as ex:  # 한 곳 실패가 전체를 멈추지 않게 — 실패 목록에 남기고 다음으로
            print(sgg, 'FAIL', repr(ex)[:200], flush=True); summary.setdefault('_fail', {})[sgg] = repr(ex)[:300]
            json.dump(summary, open(sp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); continue
        with open(os.path.join(OUT, f'{sgg}_cells.csv'), 'w', newline='', encoding='utf-8-sig') as f:
            wr = csv.DictWriter(f, fieldnames=list(rows[0])); wr.writeheader(); wr.writerows(rows)
        by_emd = {}
        for r in rows: by_emd.setdefault(r['emd'], []).append(r)
        summary[sgg] = {**info, **summarize(rows), 'sec': round(time.time() - t, 1),
                        'by_emd': {e: summarize(rs) for e, rs in sorted(by_emd.items())}}
        summary.get('_fail', {}).pop(sgg, None)
        print(sgg, json.dumps({k: v for k, v in summary[sgg].items() if k != 'by_emd'}, ensure_ascii=False), flush=True)
        json.dump(summary, open(sp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        if len(args) > 2: time.sleep(4)   # Overpass 공용 서버 예의
