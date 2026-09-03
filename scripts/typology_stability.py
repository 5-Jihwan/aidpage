"""시군구 유형화 1차 해(k=5)의 안정성 검증 — Hennig(2007) 군집별 부트스트랩 Jaccard + 대안 사양 재현율.

입력: docs/lib/sgg_typology_explore_20260903.csv (explore_typology.py 산출)
방법:
  - 기준 사양 V0 = [dens(log), e65, ealone, flood_r(log), ls_r(log), slope, coastal, rz_per100(log)] 표준화, k-means k=5(25회 재시작 최적).
  - 군집별 안정성: 비모수 부트스트랩 B=50. 재표집 데이터에 k-means → 원 군집 각각에 대해 가장 닮은 군집과의 Jaccard 최대값 → 평균.
    해석(Hennig): 평균 Jaccard ≥ .85 매우 안정, ≥ .75 유효, .6~.75 패턴은 있으나 소속 불확실, ≤ .5 해체. 불안정 군집은 이름 붙이지 않음.
  - 대안 사양: 변수 제외(경사/해안/위험개선지구), 로그 미적용, 시·군·구 분리 군집. 기준 해와의 소속 일치율(최빈 매핑)로 재현율.
출력: 표(stdout) + docs/lib/sgg_typology_labels_20260904.csv (코드·이름·기준 군집·안정도)
"""
from __future__ import annotations

import csv
import io
import os
import sys

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(ROOT, "docs", "lib", "sgg_typology_explore_20260903.csv")
OUT = os.path.join(ROOT, "docs", "lib", "sgg_typology_labels_20260904.csv")
rows = list(csv.DictReader(io.open(CSV, encoding="utf-8")))
N = len(rows)


def feats(spec: list[str], log: bool = True) -> np.ndarray:
    M = np.array([[float(r[v]) for v in spec] for r in rows])
    if log:
        for j, v in enumerate(spec):
            if v == "dens": M[:, j] = np.log10(M[:, j] + 1)
            if v in ("flood_r", "ls_r"): M[:, j] = np.log10(M[:, j] * 100 + 1)
            if v == "rz_per100": M[:, j] = np.log10(M[:, j] + 1)
    return (M - M.mean(0)) / (M.std(0) + 1e-9)


def kmeans(X: np.ndarray, k: int, seed: int):
    rng = np.random.default_rng(seed); C = X[rng.choice(len(X), k, replace=False)]
    for _ in range(100):
        lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), 1)
        C2 = np.array([X[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        if np.allclose(C, C2): break
        C = C2
    return lab, C, sum(((X[lab == j] - C[j]) ** 2).sum() for j in range(k))


def best_kmeans(X, k, restarts=25):
    return min((kmeans(X, k, s) for s in range(restarts)), key=lambda t: t[2])


def assign(X, C):
    return np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), 1)


def jaccard(a: set, b: set) -> float:
    return len(a & b) / max(1, len(a | b))


V0 = ["dens", "e65", "ealone", "flood_r", "ls_r", "slope", "coastal", "rz_per100"]
K = 5
X0 = feats(V0)
lab0, C0, _ = best_kmeans(X0, K)
# 군집 이름(09-03 임시): 중앙값 특성으로 자동 부여
def describe(lab, X=None):
    out = {}
    for j in range(K):
        sel = lab == j; rs = [r for r, s in zip(rows, sel) if s]
        med = lambda v: float(np.median([float(r[v]) for r in rs]))
        kinds = {kk: sum(1 for r in rs if r["kind"] == kk) for kk in ("시", "군", "구")}
        coast = sum(int(r["coastal"]) for r in rs) / max(1, len(rs))
        tag = []
        tag.append("해안" if coast > .8 else ("내륙" if coast < .15 else "혼합"))
        tag.append("고밀" if med("dens") > 3000 else ("중밀" if med("dens") > 300 else "저밀"))
        tag.append("고령" if med("e65") > .33 else ("중령" if med("e65") > .22 else "젊음"))
        tag.append("침수이력↑" if med("flood_r") > .08 else "")
        tag.append("산지" if med("slope") > 15 else "")
        out[j] = dict(n=int(sel.sum()), kinds=kinds, tag="·".join(t for t in tag if t), names=", ".join(r["name"] for r in sorted(rs, key=lambda r: -float(r["pop"]))[:3]))
    return out
D0 = describe(lab0)

# ---- 군집별 부트스트랩 Jaccard ----
B = 50
rng = np.random.default_rng(7)
jac = {j: [] for j in range(K)}
orig_sets = {j: set(np.where(lab0 == j)[0]) for j in range(K)}
for b in range(B):
    idx = rng.choice(N, N, replace=True)
    Xb = X0[idx]
    labb, Cb, _ = best_kmeans(Xb, K, restarts=10)
    # Hennig: 비교는 재표집 안에서 — 원 군집을 표본 위치로 제한한 집합 vs 표본 위에서 새로 얻은 군집(위치 집합).
    # (원 전체 집합과 비교하면 재표집에서 빠진 ~37% 때문에 Jaccard 상한이 .63으로 눌리는 편향 — 09-04 수정)
    orig_in = {j: set(np.where(lab0[idx] == j)[0].tolist()) for j in range(K)}
    sets_b = {j: set(np.where(labb == j)[0].tolist()) for j in range(K)}
    for j in range(K):
        jac[j].append(max(jaccard(orig_in[j], sb) for sb in sets_b.values()) if orig_in[j] else 0.0)
print(f"n={N} k={K} B={B}  기준 사양 {V0}")
print(f"{'군집':4s} {'n':>4s} {'Jaccard':>8s} {'판정':8s} 특성 / 예시")
stab = {}
for j in range(K):
    m = float(np.mean(jac[j])); stab[j] = m
    verdict = "매우안정" if m >= .85 else "유효" if m >= .75 else "불확실" if m >= .6 else "해체"
    print(f"C{j:<3d} {D0[j]['n']:4d} {m:8.2f} {verdict:8s} {D0[j]['tag']} {D0[j]['kinds']} / {D0[j]['names']}")

# ---- 대안 사양 재현율 ----
def agreement(lab_a, lab_b):
    m = {}
    for j in set(lab_b):
        sel = lab_b == j
        m[j] = np.bincount(lab_a[sel], minlength=K).argmax()
    return float(np.mean([m[x] == y for x, y in zip(lab_b, lab_a)]))
specs = {
    "V0 로그 미적용": (V0, False, None),
    "경사 제외": ([v for v in V0 if v != "slope"], True, None),
    "해안 제외": ([v for v in V0 if v != "coastal"], True, None),
    "위험개선지구 제외": ([v for v in V0 if v != "rz_per100"], True, None),
    "위해만(침수·산사태·경사·해안·개선지구)": (["flood_r", "ls_r", "slope", "coastal", "rz_per100"], True, None),
    "취약·구조만(밀도·65+·65+1인)": (["dens", "e65", "ealone"], True, None),
}
print("\n대안 사양 → 기준 해와 소속 일치율(최빈 매핑)")
for name, (spec, log, _) in specs.items():
    X = feats(spec, log); lab, _, _ = best_kmeans(X, K)
    print(f"  {name:36s} {agreement(lab0, lab):.2f}")
# 시·군·구 분리: 각 부분집합에서 k=3
print("\n시/군/구 분리 군집(k=3) — 부분집합 안에서의 구조")
for kind in ("시", "군", "구"):
    sel = np.array([r["kind"] == kind for r in rows])
    X = X0[sel]; lab, C, _ = best_kmeans(X, 3)
    sub = [r for r, s in zip(rows, sel) if s]
    for j in range(3):
        rs = [r for r, l in zip(sub, lab) if l == j]
        med = lambda v: float(np.median([float(r[v]) for r in rs]))
        print(f"  {kind} C{j} n={len(rs):3d} dens={med('dens'):7.0f} e65={med('e65'):.2f} flood={med('flood_r'):.3f} slope={med('slope'):4.1f} coast={np.mean([int(r['coastal']) for r in rs]):.2f}  e.g. {', '.join(r['name'] for r in rs[:3])}")

# ---- 산출 ----
with io.open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["code", "name", "kind", "sido", "cluster", "cluster_tag", "cluster_jaccard"])
    for r, l in zip(rows, lab0):
        w.writerow([r["code"], r["name"], r["kind"], r["sido"], f"C{l}", D0[l]["tag"], f"{stab[l]:.2f}"])
print(f"\nwrote {OUT}")
