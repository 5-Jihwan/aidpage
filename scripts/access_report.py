"""access_batch.py 결과(docs/access/<sgg>_cells.csv) → 우회 비용·동네별 표 + 지도 PNG. 사용: python scripts/access_report.py 11620 52720"""
import csv, json, os, sys
import h3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'access')
plt.rcParams['font.family'] = ['Malgun Gothic', 'sans-serif']
COL = {'start': '#7a1f1f', 'trapped': '#d62728', 'detour': '#f2a541', 'clear': '#9ecae1', 'none': '#dddddd'}
LBL = {'start': '출발부터 침수 이력 길', 'trapped': '갇힘(피해 갈 길 없음)', 'detour': '최단 길이 침수 이력을 지남(우회 가능)', 'clear': '최단 길에 위해 없음', 'none': '도달 불가(보행망 없음)'}


def wmed(pairs):
    pairs = sorted(pairs); tot = sum(w for _, w in pairs); acc = 0
    for v, w in pairs:
        acc += w
        if acc >= tot / 2: return v
    return None


def cat(r):
    if r['walk_min'] == '': return 'none'
    if r['in_flood'] == '1': return 'start'
    if r['trapped'] == '1': return 'trapped'
    if r['hz_on_shortest'] == '1': return 'detour'
    return 'clear'


def main(sggs):
    names = {'11620': '서울 관악구', '52720': '전북 진안군'}
    fig, axes = plt.subplots(1, len(sggs), figsize=(8 * len(sggs), 8))
    axes = axes if len(sggs) > 1 else [axes]
    report = {}
    for ax, sgg in zip(axes, sggs):
        rows = list(csv.DictReader(open(os.path.join(OUT, f'{sgg}_cells.csv'), encoding='utf-8-sig')))
        for r in rows:
            c = cat(r)
            ring = [(lo, la) for la, lo in h3.cell_to_boundary(r['h3'])]
            ax.add_patch(Polygon(ring, closed=True, facecolor=COL[c], edgecolor='white', linewidth=0.2))
        ax.autoscale_view(); ax.set_aspect(1.2); ax.axis('off'); ax.set_title(names.get(sgg, sgg), fontsize=15)
        det = sorted((float(r['safe_min']) - float(r['walk_min']), float(r['pop'])) for r in rows if cat(r) == 'detour' and r['safe_min'])
        def wq(q):
            tot = sum(w for _, w in det); acc = 0
            for v, w in det:
                acc += w
                if acc >= tot * q: return round(v, 1)
        P = sum(float(r['pop']) for r in rows)
        by = {}
        for r in rows:
            e = by.setdefault(r['emd'], {'pop': 0, 'detour': 0, 'trapped': 0, 'start': 0, 'safe': []})
            p = float(r['pop']); e['pop'] += p; c = cat(r)
            if c in ('detour', 'trapped', 'start'): e[c] += p
            if r['safe_min']: e['safe'].append((float(r['safe_min']), p))
        emd = sorted(({'emd': k, 'pop': round(v['pop']),
                       'pct_detour': round(100 * v['detour'] / v['pop'], 1) if v['pop'] else 0,
                       'pct_trapped': round(100 * v['trapped'] / v['pop'], 1) if v['pop'] else 0,
                       'pct_start': round(100 * v['start'] / v['pop'], 1) if v['pop'] else 0,
                       'median_safe_min': wmed(v['safe'])}
                      for k, v in by.items()), key=lambda x: -(x['pct_detour'] + x['pct_trapped'] + x['pct_start']))
        report[sgg] = {
            'pop_share': {c: round(100 * sum(float(r['pop']) for r in rows if cat(r) == c) / P, 1) for c in COL},
            'detour_extra_min_median': wq(0.5) if det else None,
            'detour_extra_min_p90': wq(0.9) if det else None,
            'emd_top': emd[:6], 'emd_n': len(emd),
        }
    handles = [plt.Rectangle((0, 0), 1, 1, color=COL[c]) for c in COL]
    fig.legend(handles, [LBL[c] for c in COL], loc='lower center', ncol=3, fontsize=11, frameon=False)
    fig.suptitle('물 재난 시 이재민 임시주거시설까지 걸어서 — 침수 이력 길을 피할 수 있나 (격자 칸 · 인구는 OSM 건물 수 비례 배분)', fontsize=13)
    fig.savefig(os.path.join(OUT, 'map_flood_access.png'), dpi=130, bbox_inches='tight')
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:] or ['11620', '52720'])
