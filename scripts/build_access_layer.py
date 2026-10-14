"""도감 '대피 접근' 층(docs/55 A4) — docs/access/<sgg>_cells.csv → data/ref/sgg_access.json

칸 결과를 시군구(256 표시 단위)로, 구를 둔 일반시 13곳은 칸을 합쳐 시 전체(230·227 보고 단위)로 다시 집계한다.
산식은 access_batch.summarize 그대로(인구 가중). 227 = 230 − 세종·제주 행정시라 따로 값을 만들 필요 없음.
출력: { meta, sgg: {code: M}, city: {M+code: M + name, members} }
  M = { hz: 지름길이 0.5 m+ 침수 기록을 지나는 주민 %, hz_all: 모든 기록 기준 %, far60/far30: 느린 걸음 60·30분 초과 %, med: 느린 걸음 중앙값(분), pop, snap: 길에서 300 m+ %(≥5면 카드에 한계 문구) }
"""
from __future__ import annotations

import csv
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from access_batch import OUT, ROOT, summarize  # noqa: E402

DST = os.path.join(ROOT, 'data', 'ref', 'sgg_access.json')


def num(v):
    if v == '' or v is None: return None
    f = float(v)
    return int(f) if f.is_integer() and '.' not in v else f


def load(code):
    with open(os.path.join(OUT, f'{code}_cells.csv'), encoding='utf-8-sig') as f:
        return [{k: (v if k in ('h3', 'emd') else num(v)) for k, v in r.items()} for r in csv.DictReader(f)]


def slim(rows):
    s = summarize(rows)
    # 10-14: hz_all을 hz(깊은 기록)와 같은 제외 규칙(갇힌 주민만 제외)으로 다시 셈. summarize의 pct_hz_on_shortest는
    #  '이미 기록 구역 안에 사는 주민'을 빼서 넓은 기준이 좁은 기준보다 작게 나오는 역전이 58곳 있었음(서초 31.3 vs 23.7).
    P = sum(r['pop'] or 0 for r in rows) or 1
    hz_all = round(100 * sum(r['pop'] or 0 for r in rows if r['hz_on_shortest'] == 1 and not r['trapped']) / P, 1)
    return {'hz': s['pct_hz_on_shortest_deep'], 'hz_all': hz_all, 'far60': s['pct_far_60min_slow'],
            'far30': s['pct_far_30min_slow'], 'med': s['median_safe_min_slow'], 'pop': s['pop'],
            'snap': s['pct_snap_over_300m']}   # 길에서 300 m+ 떨어진 주민 % — 섬·지도 길 결측 표시용


def main() -> int:
    total = sorted(f[:-8] for f in os.listdir(os.path.join(ROOT, 'data', 'grid')) if f[:5].isdigit() and f.endswith('.geojson'))
    done = [c for c in total if os.path.exists(os.path.join(OUT, f'{c}_cells.csv'))]
    cells = {c: load(c) for c in done}
    u230 = json.load(open(os.path.join(ROOT, 'data', 'ref', 'sgg_type_specs.json'), encoding='utf-8'))['specs']['u230']
    groups: dict = {}
    for c, a in u230.items():
        if a.get('m'): groups.setdefault(a['m'], {'name': a['mn'], 'members': []})['members'].append(c)
    city = {}
    for m, g in groups.items():
        if all(c in cells for c in g['members']):   # 구가 하나라도 빠지면 시 전체 값을 만들지 않음(부분 합 금지)
            city[m] = {**slim([r for c in g['members'] for r in cells[c]]), 'name': g['name'], 'members': sorted(g['members'])}
    meta = {'built': date.today().isoformat(), 'n_done': len(done), 'n_total': len(total), 'source': 'docs/53 · scripts/access_batch.py',
            'dest': '이재민 임시주거시설', 'walk_slow_m_per_min': 48, 'hz_depth_m': 0.5}
    out = {'meta': meta, 'sgg': {c: slim(cells[c]) for c in done}, 'city': city}
    with open(DST, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {DST}: sgg {len(done)}/{len(total)} · city {len(city)}/{len(groups)} · {os.path.getsize(DST) // 1024}KB')
    # 자체 점검: 배치 summary.json과 시군구 값이 같아야 함(같은 산식)
    sm = json.load(open(os.path.join(OUT, 'summary.json'), encoding='utf-8'))
    bad = [c for c in done if c in sm and (sm[c]['pct_hz_on_shortest_deep'], sm[c]['pct_far_60min_slow']) != (out['sgg'][c]['hz'], out['sgg'][c]['far60'])]
    assert not bad, f'summary mismatch: {bad[:5]}'
    return 0


if __name__ == '__main__':
    sys.exit(main())
