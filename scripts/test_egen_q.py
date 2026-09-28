# -*- coding: utf-8 -*-
"""E-Gen STAGE2 조회어 규칙 자체 점검 — 실행: python scripts/test_egen_q.py

2026-09-28: 일반구(수원시장안구 등) 이름을 그대로 STAGE2에 넣어 39곳이 전부 빈 응답이었다.
모시 이름으로 묻고 소속 구에 결과를 공유하도록 고쳤고, 이 파일이 그 규칙을 지킨다.
네트워크를 쓰지 않는다(sgg_index.json만 읽는다).
"""
import json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATA_GO_KR_KEY", "")  # import 시 키 없어도 되게
from fetch_live import egen_stage2  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX = json.load(open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))

groups = {}
for s in IDX:
    groups.setdefault((s["sido_name"], egen_stage2(s)), []).append(s["code"])

ilban = [s for s in IDX if re.search(r"시.+구$", s["name"])]
covered = sum(len(v) for v in groups.values())

# 1) 모든 시군구가 정확히 한 번씩 조회에 포함된다
assert covered == len(IDX), "조회 대상 %d != 시군구 %d" % (covered, len(IDX))

# 2) 일반구는 자기 이름이 아니라 모시 이름으로 묻는다
for s in ilban:
    q = egen_stage2(s)
    assert q.endswith("시") and q != s["name"], "일반구 조회어 오류: %s → %r" % (s["name"], q)
    assert s["name"].startswith(q), "모시 불일치: %s → %r" % (s["name"], q)

# 3) 일반구 39곳이 모시 13개 질의로 묶인다
ilban_q = {(s["sido_name"], egen_stage2(s)) for s in ilban}
assert len(ilban) == 39 and len(ilban_q) == 13, (len(ilban), len(ilban_q))

# 4) 세종은 STAGE2를 비운다
sejong = [s for s in IDX if s["sido"] == "36"]
assert sejong and all(egen_stage2(s) == "" for s in sejong)

# 5) 자치구·시·군은 이름 그대로 (일반구가 아닌데 바뀌면 안 된다)
for s in IDX:
    if s["sido"] != "36" and not re.search(r"시.+구$", s["name"]):
        assert egen_stage2(s) == s["name"], s["name"]

# 6) 호출 수가 E-Gen 일 한도(1,000, 하루 3회 수집) 안에 든다
assert len(groups) * 3 <= 1000, "일 호출 %d건" % (len(groups) * 3)

print("OK - 시군구 %d곳 → 질의 %d건(일반구 %d곳이 모시 %d개로 묶임), 하루 %d건"
      % (len(IDX), len(groups), len(ilban), len(ilban_q), len(groups) * 3))
