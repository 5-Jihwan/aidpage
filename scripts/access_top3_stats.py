"""data/access/<sgg>.json(문장 카드 v2용 top3) → 시군구별 인구 가중 지표. docs/57 B2 + docs/56 N4 결정 ②③ 근거.

  b2_all3_deep : 가까운 임시주거시설 3곳 모두, 가장 짧은 길에 깊은 침수 기록(비트 1)이 있는 주민 %  (= 대안 없음)
  n1_deep      : 가장 가까운 1곳 길에 깊은 침수 기록 %   (기존 층 hz와 같은 정의, 대조용)
  ls_b         : 가장 가까운 1곳 길에 산사태 기록 칸(16) 또는 지정 급경사지 150 m(32)  — 결정 ③ B안
  ls_a         : B안 + 칸 평균 경사 15°+(8)                                            — A안
  ts_n, ts_med : 지진해일 대피장소가 있는 시군구 여부와 가장 가까운 1곳 거리 중앙값(m)  — 결정 ②
인구 = docs/access/<sgg>_cells.csv 의 pop(칸 배분 인구). 출력 .work_access/top3_stats.csv + 요약 출력.
"""
from __future__ import annotations

import csv
import json
import os
import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEEP = 1 | 2   # 깊은 침수 기록 + 지하차도 150 m — access_batch의 hzd와 같은 정의(Atlas hz와 맞춤, 10-14 정정)


def pop_of(code):
    p = os.path.join(ROOT, "docs", "access", f"{code}_cells.csv")
    if not os.path.exists(p): return None
    with open(p, encoding="utf-8-sig") as f:
        return {r["h3"]: float(r["pop"] or 0) for r in csv.DictReader(f)}


def main() -> int:
    idx = {s["code"]: s["name"] for s in json.load(open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))}
    out = []
    for fn in sorted(os.listdir(os.path.join(ROOT, "data", "access"))):
        code = fn[:-5]; d = json.load(open(os.path.join(ROOT, "data", "access", fn), encoding="utf-8")); pw = pop_of(code)
        if pw is None: continue
        tot = sum(pw.get(h, 0) for h in d["c"]) or 1
        acc = dict(b2=0.0, n1=0.0, lsb=0.0, lsa=0.0)
        for h, row in d["c"].items():
            w = pw.get(h, 0); legs = [r for r in row if isinstance(r, list)]
            if not legs or not w: continue
            f0 = legs[0][2]
            acc["n1"] += w * bool(f0 & DEEP)
            acc["b2"] += w * (len(legs) >= 1 and all(l[2] & DEEP for l in legs))
            acc["lsb"] += w * bool(f0 & (16 | 32)); acc["lsa"] += w * bool(f0 & (8 | 16 | 32))
        ts = [v[1] for v in (d.get("t") or {}).values()]
        out.append(dict(code=code, name=idx.get(code, ""), pop=round(tot), b2_all3_deep=round(acc["b2"] / tot * 100, 2), n1_deep=round(acc["n1"] / tot * 100, 2),
                        ls_b=round(acc["lsb"] / tot * 100, 2), ls_a=round(acc["lsa"] / tot * 100, 2), ts_n=len(d.get("ts") or []), ts_med=(round(st.median(ts)) if ts else "")))
    fp = os.path.join(ROOT, ".work_access", "top3_stats.csv")
    with open(fp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
    P = sum(r["pop"] for r in out)
    nat = lambda k: round(sum(r[k] * r["pop"] for r in out) / P, 2)  # noqa: E731
    print(f"시군구 {len(out)}곳 · 인구 {P:,.0f}")
    print(f"전국(인구 가중) 1곳 길 깊은 침수 {nat('n1_deep')}% · 3곳 모두 {nat('b2_all3_deep')}% · 산사태/급경사지(B안) {nat('ls_b')}% · +칸경사(A안) {nat('ls_a')}%")
    for k, lab in (("b2_all3_deep", "B2 3곳 모두 깊은 침수"), ("ls_b", "B안"), ("ls_a", "A안")):
        top = sorted(out, key=lambda r: -r[k])[:6]; nz = sum(1 for r in out if r[k] > 0)
        print(f"  {lab}: 0보다 큰 곳 {nz}곳 · 중앙값 {st.median(r[k] for r in out):.2f}% · 상위 " + ", ".join(f"{r['name']} {r[k]}" for r in top))
    co = [r for r in out if r["ts_n"]]
    print(f"  지진해일 대피장소 있는 시군구 {len(co)}곳 · 가장 가까운 곳 거리 중앙값(시군구별 중앙값의 중앙값) {st.median(r['ts_med'] for r in co) if co else '—'} m")
    for c in ("11620", "52720", "52180"):
        r = next((x for x in out if x["code"] == c), None)
        if r: print(f"  사례 {r['name']}: 1곳 {r['n1_deep']}% · 3곳 {r['b2_all3_deep']}% · B안 {r['ls_b']}% · A안 {r['ls_a']}%")
    print("→", fp)
    if "--write" in sys.argv:   # docs/57 B2: Atlas 대피 접근 칸 보조 줄 'alt'(가까운 3곳 모두 깊은 침수 기록 %) — 256곳 다 끝난 뒤에만 쓴다
        ap = os.path.join(ROOT, "data", "ref", "sgg_access.json"); A = json.load(open(ap, encoding="utf-8")); by = {r["code"]: r for r in out}
        miss = [c for c in A["sgg"] if c not in by]
        if miss: print(f"  --write 보류: top3 없는 곳 {len(miss)}곳 {miss[:6]}"); return 1
        for c, v in A["sgg"].items(): v["alt"] = by[c]["b2_all3_deep"]
        for m, v in A["city"].items():
            ps = [by[x] for x in v["members"]]; pp = sum(r["pop"] for r in ps) or 1
            v["alt"] = round(sum(r["b2_all3_deep"] * r["pop"] for r in ps) / pp, 2)
        A["meta"]["alt"] = "가까운 임시주거시설 3곳 모두, 가장 짧은 길에 깊은 침수 기록(0.5 m+)이 있는 주민 % (scripts/access_top3_stats.py)"
        json.dump(A, open(ap, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":")); print("  sgg_access.json에 alt 기록")
    return 0


if __name__ == "__main__":
    sys.exit(main())
