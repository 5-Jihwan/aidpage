"""규칙 기반 시군구 타입(v1.4)의 민감도·안정성 분석 — SSCI 원고(docs/21 B안·A안 부록)용.

build_types.py의 데이터 적재·classify()를 그대로 실행(exec)해 규칙 논리를 복제하지 않는다. 산출 파일은 건드리지 않는다.
분석:
  1 임계 사양: 전국 p70 / p75(기준) / p80 — 주 타입·근거·특징의 소속 변동률
  2 부트스트랩 안정성(B=200): 재표집으로 임계를 다시 구해 분류 → 타입별 Jaccard(재표집 안 비교, Hennig 2007) — k-means k=5(docs/11 §3-1)와 같은 척도
  3 변수 제외: 지정 지구·경사·산사태 이력·침수 이력 각각 제외 시 주 타입 변동률
  4 단위 변경: 통합시(구가 있는 일반시 11곳)를 시 단위로 합산한 229 단위 사양과의 일치율
  5 근접/희미 경계: 40% / 50%(기준) / 60%
  6 지수 대조: SoVI식 가중합 z-지수(위해·취약)의 순위가 재표집에서 얼마나 흔들리는가(상위 25% 소속 Jaccard, Spearman)
출력: docs/lib/typology_sensitivity_20260909.json + stdout 표
"""
from __future__ import annotations

import io
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731

# ── build_types.py의 앞부분(적재 + 함수)만 실행해 동일 규칙을 확보 ──
src = io.open(P("scripts", "build_types.py"), encoding="utf-8").read()
prefix = src.split("# ───────── 시군구 ─────────")[0]
ns: dict = {"__file__": P("scripts", "build_types.py"), "__name__": "build_types_prefix"}
exec(compile(prefix, "build_types_prefix", "exec"), ns)
rows, rz, vuln, social, idx = ns["rows"], ns["rz"], ns["vuln"], ns["social"], ns["idx"]
classify, pct = ns["classify"], ns["pct"]
METRICS = ["flood_r", "ls_r", "slope", "e65", "ealone", "single", "dens", "rzf", "rzo", "rzc", "rzs", "rzd", "foreign_r", "disabled_r", "basic_r", "traffic_r", "fire_r"]
for r in rows:
    z = rz.get(r["code"], {}); fl = int(z.get("flood", 0)); area = max(float(r["area"]), 1.0)
    r["rzf"] = fl / area * 100; r["rzo"] = (int(z.get("n", 0)) - fl) / area * 100
    zt = z.get("t", {}); r["rzc"] = int(zt.get("002", 0)) / area * 100; r["rzs"] = int(zt.get("006", 0)) / area * 100; r["rzd"] = int(zt.get("007", 0)) / area * 100
    vv = vuln.get(r["code"], {})
    for k in ("foreign_r", "disabled_r", "basic_r"): r[k] = vv.get(k)
    ss = social.get(r["code"], {})
    for k in ("traffic_r", "fire_r"): r[k] = ss.get(k)
N = len(rows)
CODES = [r["code"] for r in rows]
MV = {r["code"]: {v: (None if r[v] is None else float(r[v])) for v in METRICS} for r in rows}


def thresholds(sample_rows, q=75, q80=80):
    """표본(rows 부분집합)에서 임계·sd 산출 — build_types.py와 동일 절차(q만 매개변수화)."""
    M = {v: [float(r[v]) for r in sample_rows if r[v] is not None] for v in METRICS}
    TH = {v: pct(M[v], q) for v in METRICS}
    TH["slope80"] = pct(M["slope"], q80); TH["single80"] = pct(M["single"], q80)
    SD = {v: (float(np.std(M[v])) if M[v] else 0.0) for v in METRICS}
    for k in ("rzc", "rzs", "rzd"):
        posv = [x for x in M[k] if x > 0]
        TH[k + "_pos"] = pct(posv, q) if posv else 0.0; SD[k + "_pos"] = float(np.std(posv)) if posv else 0.0
    for k in list(TH):
        if TH[k] is None: TH[k] = 0.0
    # 사회 위해(교통) 임계 = 같은 행정유형 안의 p75·sd — build_types는 sgg_social.json의 고정값을 읽지만 여기서는 표본에서 다시 구해 classify()의 전역(SOC_TH)에 주입
    soc_th = {"traffic_r": {}, "fire_r": {}}
    for kind in ("시", "군", "구"):
        v = [float(r["traffic_r"]) for r in sample_rows if r["kind"] == kind and r["traffic_r"] is not None]
        if v: soc_th["traffic_r"][kind] = {"p75": pct(v, q), "sd": float(np.std(v))}
    ns["SOC_TH"] = soc_th
    return TH, SD


def run(sample_rows=None, q=75, q80=80, drop=(), lean_cut=0.5, metrics_override=None):
    """전체 255곳을 분류. sample_rows: 임계를 구할 표본(None=전체). drop: 무력화할 변수(값을 0으로). lean_cut: 근접/희미 경계."""
    sample_rows = sample_rows or rows
    TH, SD = thresholds(sample_rows, q, q80)
    out = {}
    for r in rows:
        m = dict(MV[r["code"]]) if metrics_override is None else dict(metrics_override[r["code"]])
        for d in drop: m[d] = 0.0 if m.get(d) is not None else None
        t = classify(m, TH, SD, r["kind"], int(r["coastal"]))
        if t.get("lean"):
            t["lean"]["deg"] = "근접" if t["lean"]["r"] >= lean_cut else "희미"
        out[r["code"]] = t
    return out, TH


def key_primary(t):  # 성립 위해만 — 근접·희미는 '미성립'
    return "미성립" if t.get("lean") else t["primary"]


def key_primary_basis(t):
    return f"{t['primary']}({t.get('basis') or ('접촉' if t['primary'] == '바다' else '지정')})" if not t.get("lean") else f"{t['primary']}({t['lean']['deg']})"


def change_rate(a, b, keyf):
    return sum(1 for c in CODES if keyf(a[c]) != keyf(b[c])) / N


def traits_jacc(a, b):
    vals = []
    for c in CODES:
        sa, sb = set(a[c]["traits"]), set(b[c]["traits"])
        vals.append(1.0 if not (sa | sb) else len(sa & sb) / len(sa | sb))
    return float(np.mean(vals))


def jaccard(a: set, b: set) -> float:
    return len(a & b) / max(1, len(a | b))


base, TH0 = run()
report = {"n": N, "baseline": {"primary": dict(Counter(key_primary(t) for t in base.values())), "social": dict(Counter(t["social"] or "—" for t in base.values())),
                               "traits": dict(Counter(x for t in base.values() for x in t["traits"]))}}
print(f"n={N}  기준(v1.4-pos) 주 타입:", report["baseline"]["primary"])

# ── 1. 임계 사양 ──
print("\n[1] 임계 사양 민감도 (기준 p75/p80 대비 소속 변동률)")
print(f"{'사양':16s} {'주타입':>7s} {'주+근거':>8s} {'사회':>6s} {'특징Jacc':>8s}  주 타입 분포")
sens = {}
for name, q, q80 in [("p70/p75", 70, 75), ("p75/p80(기준)", 75, 80), ("p80/p85", 80, 85), ("p75/p75(경사·홀로 p75)", 75, 75)]:
    o, _ = run(q=q, q80=q80)
    row = dict(primary=change_rate(base, o, key_primary), primary_basis=change_rate(base, o, key_primary_basis), social=change_rate(base, o, lambda t: t["social"] or "—"), traits_j=traits_jacc(base, o), dist=dict(Counter(key_primary(t) for t in o.values())))
    sens[name] = row
    print(f"{name:16s} {row['primary']:7.2f} {row['primary_basis']:8.2f} {row['social']:6.2f} {row['traits_j']:8.2f}  {row['dist']}")
report["threshold_spec"] = sens

# ── 2. 부트스트랩 안정성 ──
print("\n[2] 부트스트랩 안정성 B=200 — 임계를 재표집에서 다시 구해 분류, 타입별 Jaccard(재표집 안 비교)")
B = 200; rng = np.random.default_rng(7)
TYPES_P = ["물", "산", "바다", "마름"]; TRAITS = ["노년", "홀로", "이방", "돌봄", "살림", "도심", "들"]
jac = defaultdict(list); agree_p, agree_pb, agree_t = [], [], []
orig_p = {k: {c for c in CODES if key_primary(base[c]) == k} for k in TYPES_P + ["미성립"]}
orig_t = {k: {c for c in CODES if k in base[c]["traits"]} for k in TRAITS}
orig_s = {"교통": {c for c in CODES if base[c]["social"] == "교통"}}
for b in range(B):
    sel = rng.choice(N, N, replace=True)
    srows = [rows[i] for i in sel]; in_codes = {rows[i]["code"] for i in sel}
    o, _ = run(sample_rows=srows)
    new_p = {k: {c for c in in_codes if key_primary(o[c]) == k} for k in TYPES_P + ["미성립"]}
    new_t = {k: {c for c in in_codes if k in o[c]["traits"]} for k in TRAITS}
    new_s = {"교통": {c for c in in_codes if o[c]["social"] == "교통"}}
    for k in TYPES_P + ["미성립"]:
        oi = orig_p[k] & in_codes
        if oi: jac["주:" + k].append(jaccard(oi, new_p[k]))
    for k in TRAITS:
        oi = orig_t[k] & in_codes
        if oi: jac["특징:" + k].append(jaccard(oi, new_t[k]))
    oi = orig_s["교통"] & in_codes
    if oi: jac["사회:교통"].append(jaccard(oi, new_s["교통"]))
    agree_p.append(np.mean([key_primary(o[c]) == key_primary(base[c]) for c in in_codes]))
    agree_pb.append(np.mean([key_primary_basis(o[c]) == key_primary_basis(base[c]) for c in in_codes]))
    agree_t.append(np.mean([set(o[c]["traits"]) == set(base[c]["traits"]) for c in in_codes]))
boot = {k: dict(mean=float(np.mean(v)), p05=float(np.percentile(v, 5)), n=len(orig_p.get(k.split(":")[1], orig_t.get(k.split(":")[1], orig_s.get(k.split(":")[1], set()))))) for k, v in jac.items()}
for k, v in boot.items():
    verdict = "매우안정" if v["mean"] >= .85 else "유효" if v["mean"] >= .75 else "불확실" if v["mean"] >= .6 else "해체"
    print(f"  {k:10s} n={v['n']:3d}  Jaccard={v['mean']:.2f} (5%={v['p05']:.2f})  {verdict}")
report["bootstrap"] = dict(B=B, per_type=boot, agreement=dict(primary=float(np.mean(agree_p)), primary_basis=float(np.mean(agree_pb)), traits_exact=float(np.mean(agree_t))),
                           kmeans_reference={"내륙 산간 고령(C)": .88, "해안 고령 농어촌": .75, "도심 저위험": .64, "도심 저지대 침수이력": .61, "도농복합 산지": .58})
print(f"  전체 소속 일치율: 주 타입 {np.mean(agree_p):.3f} · 주+근거 {np.mean(agree_pb):.3f} · 특징 집합 완전일치 {np.mean(agree_t):.3f}")
print("  참고 k-means k=5 Jaccard(docs/11 §3-1): .88 .75 .64 .61 .58")

# ── 3. 변수 제외 ──
print("\n[3] 변수 제외 시 주 타입 변동률 (해당 변수를 0으로 두고 임계는 기준 유지)")
excl = {}
for name, drop in [("침수 이력 제외", ("flood_r",)), ("침수위험지구 제외", ("rzf",)), ("산사태 이력 제외", ("ls_r",)), ("경사 제외", ("slope",)), ("붕괴위험지구 제외", ("rzc",)), ("지정 지구 전부 제외", ("rzf", "rzc", "rzs", "rzd")), ("취약 3종 제외", ("foreign_r", "disabled_r", "basic_r"))]:
    TH, SD = thresholds(rows)
    o = {}
    for r in rows:
        m = dict(MV[r["code"]])
        for d in drop: m[d] = 0.0 if m.get(d) is not None else None
        o[r["code"]] = classify(m, TH, SD, r["kind"], int(r["coastal"]))
    excl[name] = dict(primary=change_rate(base, o, key_primary), primary_basis=change_rate(base, o, key_primary_basis), traits_j=traits_jacc(base, o), dist=dict(Counter(key_primary(t) for t in o.values())))
    print(f"  {name:14s} 주 {excl[name]['primary']:.2f}  주+근거 {excl[name]['primary_basis']:.2f}  특징J {excl[name]['traits_j']:.2f}  {excl[name]['dist']}")
report["variable_exclusion"] = excl

# ── 4. 단위 변경: 통합시 합산(229) ──
print("\n[4] 단위 변경 — 구가 있는 일반시를 시 단위로 합산(위해는 면적 가중, 인구 지표는 인구 가중, 밀도 재계산)")
sgg_idx = json.load(open(P("data", "admin", "sgg_index.json"), encoding="utf-8"))
name_of = {s["code"]: s for s in sgg_idx}
# 통합시의 구: 시군구 index에 name '수원시장안구'처럼 '시'+'구'가 함께 붙는 항목
groups = defaultdict(list)
for r in rows:
    nm = r["name"]
    if r["kind"] == "구" and "시" in nm and nm.endswith("구") and r["sido"] not in ("서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "전남광주통합특별시"):
        groups[nm.split("시")[0] + "시"].append(r)
merged_rows = [r for r in rows if not any(r in g for g in groups.values())]
merged_metrics = {r["code"]: dict(MV[r["code"]]) for r in merged_rows}
for city, gs in groups.items():
    area = sum(float(r["area"]) for r in gs); pop = sum(float(r["pop"]) for r in gs)
    wa = lambda k: sum(float(r[k]) * float(r["area"]) for r in gs) / area
    wp = lambda k: (sum(float(r[k]) * float(r["pop"]) for r in gs if r[k] is not None) / sum(float(r["pop"]) for r in gs if r[k] is not None)) if any(r[k] is not None for r in gs) else None
    m = dict(flood_r=wa("flood_r"), ls_r=wa("ls_r"), slope=wa("slope"), e65=wp("e65"), ealone=wp("ealone"), single=wp("single"), dens=pop / area,
             rzf=wa("rzf"), rzo=wa("rzo"), rzc=wa("rzc"), rzs=wa("rzs"), rzd=wa("rzd"), foreign_r=wp("foreign_r"), disabled_r=wp("disabled_r"), basic_r=wp("basic_r"),
             traffic_r=gs[0]["traffic_r"], fire_r=None)
    fake = dict(gs[0]); fake["code"] = "M" + gs[0]["code"]; fake["name"] = city; fake["kind"] = "시"; fake["area"] = area; fake["pop"] = pop; fake["coastal"] = max(int(r["coastal"]) for r in gs)
    for k, v in m.items(): fake[k] = v
    merged_rows.append(fake); merged_metrics[fake["code"]] = m
THm, SDm = thresholds(merged_rows)
om = {r["code"]: classify({v: (None if r[v] is None else float(r[v])) for v in METRICS}, THm, SDm, r["kind"], int(r["coastal"])) for r in merged_rows}
# 비교: 구 → 소속 시의 결과와 대조
agree = []; changed = []
for city, gs in groups.items():
    tm = om["M" + gs[0]["code"]]
    for r in gs:
        same = key_primary(base[r["code"]]) == key_primary(tm); agree.append(same)
        if not same: changed.append(f"{r['name']}:{key_primary(base[r['code']])}→{key_primary(tm)}")
non_group = [r["code"] for r in merged_rows if not r["code"].startswith("M")]
agree_ng = float(np.mean([key_primary(base[c]) == key_primary(om[c]) for c in non_group]))
print(f"  통합시 {len(groups)}곳({sum(len(g) for g in groups.values())}개 구 → 시), 단위 {len(merged_rows)}")
print(f"  구→시 주 타입 일치율 {np.mean(agree):.2f} (바뀐 구: {', '.join(changed[:12])}{' …' if len(changed) > 12 else ''})")
print(f"  나머지 {len(non_group)}곳의 주 타입 일치율(임계가 바뀐 효과만) {agree_ng:.3f}")
report["unit_merge"] = dict(n_cities=len(groups), n_units=len(merged_rows), gu_to_city_agreement=float(np.mean(agree)), others_agreement=agree_ng, changed=changed)

# ── 5. 근접/희미 경계 ──
print("\n[5] 근접/희미 경계 민감도 (미성립 48곳 안에서)")
lean_sens = {}
for cut in (0.4, 0.5, 0.6):
    o, _ = run(lean_cut=cut)
    c = Counter(f"{t['primary']}({t['lean']['deg']})" for t in o.values() if t.get("lean"))
    lean_sens[str(cut)] = dict(c); print(f"  경계 {cut:.0%}: {dict(c)}")
rs = sorted(t["lean"]["r"] for t in base.values() if t.get("lean"))
print(f"  미성립 48곳의 기준 대비 비율 분포: 최소 {rs[0]:.2f} · 중앙 {np.median(rs):.2f} · 최대 {rs[-1]:.2f} · 0.45~0.55 구간 {sum(1 for x in rs if .45 <= x <= .55)}곳")
report["lean_cut"] = dict(dist=lean_sens, near_boundary_45_55=int(sum(1 for x in rs if .45 <= x <= .55)))

# ── 6. 가중합 지수와의 대조 ──
print("\n[6] 가중합 지수(SoVI식 z-합) 대조 — 같은 변수로 만든 위해 지수·취약 지수의 상위 25% 소속이 재표집에서 얼마나 흔들리는가")
def zidx(codes_sample, keys, logk=()):
    M = {}
    for k in keys:
        v = np.array([MV[c][k] if MV[c][k] is not None else np.nan for c in CODES], float)
        if k in logk: v = np.log10(v + 1e-3)
        mu, sd = np.nanmean([v[CODES.index(c)] for c in codes_sample]), np.nanstd([v[CODES.index(c)] for c in codes_sample])
        M[k] = (v - mu) / (sd + 1e-9)
    Z = np.nansum(np.array(list(M.values())), axis=0)
    return dict(zip(CODES, Z))
HAZ = ["flood_r", "ls_r", "slope", "rzf", "rzc"]; VUL = ["e65", "ealone", "single", "foreign_r", "disabled_r", "basic_r"]
idx_res = {}
for name, keys in [("위해 지수", HAZ), ("취약 지수", VUL)]:
    z0 = zidx(CODES, keys, logk=("flood_r", "ls_r", "rzf", "rzc"))
    top0 = {c for c in CODES if z0[c] >= np.percentile(list(z0.values()), 75)}
    jj, rho = [], []
    for b in range(B):
        sel = rng.choice(N, N, replace=True); sc = [CODES[i] for i in sel]; in_codes = set(sc)
        zb = zidx(sc, keys, logk=("flood_r", "ls_r", "rzf", "rzc"))
        thr = np.percentile([zb[c] for c in sc], 75)
        topb = {c for c in in_codes if zb[c] >= thr}
        jj.append(jaccard(top0 & in_codes, topb))
        a = np.array([z0[c] for c in in_codes]); bb = np.array([zb[c] for c in in_codes])
        ra, rb = a.argsort().argsort(), bb.argsort().argsort(); rho.append(float(np.corrcoef(ra, rb)[0, 1]))
    idx_res[name] = dict(top25_jaccard=float(np.mean(jj)), spearman=float(np.mean(rho)))
    print(f"  {name}: 상위 25% 소속 Jaccard {np.mean(jj):.2f} · 순위 Spearman {np.mean(rho):.3f}")
# 규칙 기반의 대응치: '위해 성립' 집합(물·산·마름 중 하나라도)과 '특징 2개 이상' 집합의 재표집 Jaccard
jj_h, jj_v = [], []
orig_h = {c for c in CODES if not base[c].get("lean") and base[c]["primary"] != "바다"}
orig_v = {c for c in CODES if len(base[c]["traits"]) >= 2}
for b in range(B):
    sel = rng.choice(N, N, replace=True); srows = [rows[i] for i in sel]; in_codes = {rows[i]["code"] for i in sel}
    o, _ = run(sample_rows=srows)
    jj_h.append(jaccard(orig_h & in_codes, {c for c in in_codes if not o[c].get("lean") and o[c]["primary"] != "바다"}))
    jj_v.append(jaccard(orig_v & in_codes, {c for c in in_codes if len(o[c]["traits"]) >= 2}))
idx_res["규칙: 위해 성립 집합"] = dict(top25_jaccard=float(np.mean(jj_h))); idx_res["규칙: 특징 2개 이상 집합"] = dict(top25_jaccard=float(np.mean(jj_v)))
print(f"  규칙 기반 대응치 — 위해 성립 집합 Jaccard {np.mean(jj_h):.2f} · 특징 2개 이상 집합 {np.mean(jj_v):.2f}")
report["index_contrast"] = idx_res

# ── 7. 규칙 × k-means 교차(기존 라벨) ──
labels = ns["labels"]
cross = defaultdict(Counter)
for c in CODES: cross[key_primary(base[c])][labels.get(c, {}).get("cluster_tag", "?")] += 1
report["cross_kmeans"] = {k: dict(v) for k, v in cross.items()}
print("\n[7] 규칙 주 타입 × k-means k=5 군집(09-03 라벨)")
for k, v in cross.items(): print(f"  {k}: {dict(v)}")

out = P("docs", "lib", "typology_sensitivity_20260909.json")
json.dump(report, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\nwrote", out)
