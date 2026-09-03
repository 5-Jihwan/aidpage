"""탐색용: 시군구 255개 — 재난(위해)·구조·취약 렌즈 변수 분포와 k-means 시험 (결정용 아님)."""
import json, os, sys, math
import numpy as np
from shapely.geometry import shape
from shapely.ops import unary_union
sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"C:\Users\ojh12\Documents\GitHub\safepic"
OUT = r"C:\Users\ojh12\AppData\Local\Temp\claude\C--Users-ojh12\969d0a2b-2c58-43fe-a342-834defb0cfdc\scratchpad\sgg_typology_explore.csv"

idx = {s["code"]: s for s in json.load(open(f"{ROOT}/data/admin/sgg_index.json", encoding="utf-8"))}
demo = json.load(open(f"{ROOT}/data/ref/sgg_demo.json", encoding="utf-8"))["sgg"]
rz = json.load(open(f"{ROOT}/data/ref/riskzone_by_sgg.json", encoding="utf-8"))["by_sgg"]
geo = json.load(open(f"{ROOT}/data/admin/kr_sgg.geojson", encoding="utf-8"))
polys = {f["properties"]["code"]: shape(f["geometry"]) for f in geo["features"]}
# 해안 판정: 전국 합집합의 외곽선과 닿는 시군구 (DMZ 접경도 함께 잡히는 한계 → 위도 37.9 이상 접경은 'border'로 분리)
nation = unary_union(list(polys.values()))
outer = nation.boundary
def km2(g):
    lat = g.centroid.y
    return g.area * 111.32 * 111.32 * math.cos(math.radians(lat))
# 대피소 수(민방위) by sgg
shel = {}
for fn in os.listdir(f"{ROOT}/data/shelters/civil_defense"):
    for f in json.load(open(f"{ROOT}/data/shelters/civil_defense/{fn}", encoding="utf-8"))["features"]:
        s = str(f["properties"].get("sgg") or "")
        shel[s] = shel.get(s, 0) + 1
rows = []
for code, d in demo.items():
    g = polys.get(code)
    if g is None:
        continue
    gp = f"{ROOT}/data/grid/{code}.geojson"
    if not os.path.exists(gp):
        continue
    feats = json.load(open(gp, encoding="utf-8"))["features"]
    n = len(feats)
    fl = sum(1 for x in feats if (x["properties"].get("flood_hist_n") or 0) > 0)
    ls = sum(1 for x in feats if (x["properties"].get("landslide_hist_n") or 0) > 0)
    slope = np.mean([x["properties"].get("slope_mean") or 0 for x in feats])
    area = km2(g)
    touch = g.boundary.intersection(outer).length * 111  # km 근사
    coastal = touch > 5 and g.centroid.y < 37.9
    border = touch > 5 and g.centroid.y >= 37.9
    name = idx.get(code, {}).get("name", code)
    kind = "구" if name.endswith("구") else "군" if name.endswith("군") else "시"
    r = rz.get(code, {})
    rows.append(dict(code=code, name=name, kind=kind, sido=idx.get(code, {}).get("sido_name", ""),
        pop=d["pop"], area=round(area, 1), dens=round(d["pop"] / max(area, 1), 1), e65=d["e65"], ealone=d["ealone"], single=d["single"],
        flood_r=round(fl / n, 4), ls_r=round(ls / n, 4), slope=round(float(slope), 2), coastal=int(coastal), border=int(border),
        rz_n=r.get("n", 0), rz_per100=round(r.get("n", 0) / max(area, 1) * 100, 2), shel=shel.get(code, 0), shel_per10k=round(shel.get(code, 0) / max(d["pop"], 1) * 1e4, 2)))
print(f"rows {len(rows)}")
import csv
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

def q(v): v = np.array(v, float); return [round(float(np.percentile(v, p)), 3) for p in (10, 25, 50, 75, 90)]
print("kind:", {k: sum(1 for r in rows if r["kind"] == k) for k in ("시", "군", "구")}, "coastal", sum(r["coastal"] for r in rows), "border", sum(r["border"] for r in rows))
for k in ("dens", "e65", "ealone", "flood_r", "ls_r", "slope", "rz_per100", "shel_per10k"):
    print(f"{k:11s} p10/25/50/75/90 = {q([r[k] for r in rows])}")
print("flood_r==0:", sum(1 for r in rows if r["flood_r"] == 0), " ls_r==0:", sum(1 for r in rows if r["ls_r"] == 0), " rz_n==0:", sum(1 for r in rows if r["rz_n"] == 0))

# ---- k-means (numpy) on hazard+structure+vulnerability, log/zscore ----
def kmeans(X, k, seed):
    rng = np.random.default_rng(seed); C = X[rng.choice(len(X), k, replace=False)]
    for _ in range(100):
        lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), 1)
        C2 = np.array([X[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        if np.allclose(C, C2): break
        C = C2
    inertia = sum(((X[lab == j] - C[j]) ** 2).sum() for j in range(k))
    return lab, C, inertia
V = ["dens", "e65", "ealone", "flood_r", "ls_r", "slope", "coastal", "rz_per100"]
M = np.array([[r[v] for v in V] for r in rows], float)
M[:, 0] = np.log10(M[:, 0] + 1); M[:, 3] = np.log10(M[:, 3] * 100 + 1); M[:, 4] = np.log10(M[:, 4] * 100 + 1); M[:, 7] = np.log10(M[:, 7] + 1)
Z = (M - M.mean(0)) / (M.std(0) + 1e-9)
for k in (4, 5, 6):
    best = min((kmeans(Z, k, s) for s in range(25)), key=lambda t: t[2])
    lab, C, inertia = best
    # 안정성: 다른 시드 해와 일치도(헝가리안 없이 최빈 매핑 근사)
    agree = []
    for s in range(25, 35):
        l2, _, _ = kmeans(Z, k, s)
        m = {}
        for j in range(k):
            sel = l2 == j
            if sel.any(): m[j] = np.bincount(lab[sel], minlength=k).argmax()
        agree.append(np.mean([m.get(x, -1) == y for x, y in zip(l2, lab)]))
    print(f"\n=== k={k} inertia={inertia:.1f} stability(mean agreement vs 10 seeds)={np.mean(agree):.2f}")
    for j in range(k):
        sel = lab == j; rs = [r for r, s_ in zip(rows, sel) if s_]
        med = {v: round(float(np.median([r[v] for r in rs])), 3) for v in ("dens", "e65", "ealone", "flood_r", "ls_r", "slope", "rz_per100")}
        kinds = {kk: sum(1 for r in rs if r["kind"] == kk) for kk in ("시", "군", "구")}
        coast = sum(r["coastal"] for r in rs)
        names = ", ".join(r["name"] for r in sorted(rs, key=lambda r: -r["pop"])[:4]) + (" …" if len(rs) > 4 else "")
        print(f"  C{j} n={sel.sum():3d} {kinds} coastal={coast} med={med}\n      e.g. {names}")
