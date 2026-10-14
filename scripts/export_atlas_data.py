"""Atlas 데이터 신청 응대용(운영자 전용, docs/59) — 판본 표(CSV) + 데이터 사전(md)을 만든다.

공개 내려받기는 하지 않는다(10-14 결정: 메일 신청 → 이용 동의서 → 송부). 화면에 보이는 값만 담는다.
사용: python scripts/export_atlas_data.py [--out 폴더] [--no-access]
      --no-access : 대피 접근 열(OSM 파생, ODbL)을 뺀다 — 동의서 §원천 조건 참조
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *a: json.load(open(os.path.join(ROOT, *a), encoding="utf-8"))  # noqa: E731

COLS = [
    ("code", "시군구 코드(행정표준코드 5자리, 2026-07-01 개편 반영)"), ("name", "이름"), ("name_en", "영문 이름"), ("sido", "시도"),
    ("kind", "행정 유형·해안 여부(같은 유형 안에서 임계 비교)"), ("primary", "주 자연 위해 타입(물·산·바다·마름)"),
    ("lean", "기준 미달일 때 정도(근접·희미) — 비어 있으면 성립"), ("lean_r", "가장 가까운 위해의 기준 대비 비율"),
    ("secondary", "부 타입"), ("social", "사회 위해(교통)"), ("traits", "특징(서열 없는 묶음, | 구분)"),
    ("bold", "굵게(밀도 상위) 1/0"), ("complex", "복합(위해 2개 이상) 1/0"),
    ("flood_r", "침수 이력 격자 비율"), ("ls_r", "산사태 이력 격자 비율"), ("slope", "평균 경사(도)"), ("rzf", "침수위험지구 밀도(/100km²)"),
    ("e65", "65세 이상 비율"), ("ealone", "65세 이상 1인세대 비율"), ("single", "1인세대 비율"), ("dens", "인구밀도(/km²)"),
    ("foreign_r", "외국인 주민 비율"), ("disabled_r", "장애·아동 비율"), ("basic_r", "수급·주거취약 비율"), ("traffic_r", "교통사고 사상자(/10만)"),
    ("pop", "주민등록 인구"), ("fi3", "재정력지수 3년 평균"), ("thr_sub", "국고지원 피해 문턱(억 원)"), ("thr_decl", "특별재난지역 선포 기준(억 원)"),
    ("n_subsidy", "기록: 국고지원 횟수(재해연보 2012~2024)"), ("n_decl", "기록: 선포 횟수"), ("ordin_n", "재난 관련 조례 수"),
    ("acc_hz", "대피 접근: 가장 가까운 임시주거시설 길에 깊은 침수 기록(0.5 m+)이 있는 주민 % [OSM 파생, ODbL]"),
    ("acc_far60", "대피 접근: 느린 걸음 60분 밖 주민 % [OSM 파생, ODbL]"),
]


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=os.path.join(ROOT, ".work_export")); ap.add_argument("--no-access", action="store_true")
    a = ap.parse_args()
    ty = J("data", "ref", "sgg_types.json"); idx = {s["code"]: s for s in J("data", "admin", "sgg_index.json")}
    tr = J("data", "ref", "sgg_threshold.json")["sgg"]; od = J("data", "ref", "sgg_ordin.json")["sgg"]
    ac = J("data", "ref", "sgg_access.json")["sgg"] if os.path.exists(os.path.join(ROOT, "data", "ref", "sgg_access.json")) else {}
    cols = [c for c in COLS if not (a.no_access and c[0].startswith("acc_"))]
    ver = ty["meta"]["version"]; os.makedirs(a.out, exist_ok=True)
    rows = []
    for code in sorted(ty["sgg"]):
        s = ty["sgg"][code]; m = s.get("metrics", {}); i = idx.get(code, {}); t = tr.get(code) or {}; o = od.get(code) or {}; c = ac.get(code) or {}
        lean = s.get("lean") or {}
        v = dict(code=code, name=i.get("name", ""), name_en=i.get("name_en", ""), sido=i.get("sido_name", ""), kind=s.get("kind", ""),
                 primary=s.get("primary", ""), lean=lean.get("deg", ""), lean_r=lean.get("r", ""), secondary=s.get("secondary") or "",
                 social=s.get("social") or "", traits="|".join(s.get("traits") or []), bold=int(bool(s.get("bold"))), complex=int(bool(s.get("complex"))),
                 **{k: m.get(k, "") for k in ("flood_r", "ls_r", "slope", "rzf", "e65", "ealone", "single", "dens", "foreign_r", "disabled_r", "basic_r", "traffic_r", "pop")},
                 fi3=t.get("fi3", ""), thr_sub=(t.get("thr") or {}).get("sub", ""), thr_decl=(t.get("thr") or {}).get("decl", ""),
                 n_subsidy=len((t.get("records") or {}).get("subsidy") or []), n_decl=len((t.get("records") or {}).get("decl") or []),
                 ordin_n=o.get("n", ""), acc_hz=c.get("hz", ""), acc_far60=c.get("far60", ""))
        rows.append([("" if v[k] is None else v[k]) for k, _ in cols])
    fn = os.path.join(a.out, f"aidpage_atlas_{ver}.csv")
    with open(fn, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow([k for k, _ in cols]); w.writerows(rows)
    src = "\n".join(f"- {k}: {x}" for k, x in (ty["meta"].get("sources") or {}).items())
    dic = (f"# AidPage Atlas {ver} — 데이터 사전\n\n행 {len(rows)}개 = 시군구 표시 단위 256(기초자치단체 227 + 일반구 39·세종·제주 행정시). "
           "순위·합성 점수 없음. 빈 칸 = 자료 없음(0이 아님). 임계 = 같은 행정 유형 안 전국 상위 25%(경사·1인세대 20%). 판본 고정 값.\n\n"
           "이용 조건: 함께 받은 이용 동의서(인용·재배포 금지·순위 금지·원천 조건 승계)를 따른다.\n\n| 열 | 뜻 |\n|---|---|\n"
           + "\n".join(f"| {k} | {d} |" for k, d in cols) + f"\n\n## 원천\n{src}\n\n인용: Oh, J. (2026). AidPage Atlas ({ver}). https://github.com/5-Jihwan/aidpage\n")
    open(os.path.join(a.out, f"aidpage_atlas_{ver}_dictionary.md"), "w", encoding="utf-8").write(dic)
    print(f"wrote {fn} ({len(rows)} rows, {len(cols)} cols) + dictionary → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
