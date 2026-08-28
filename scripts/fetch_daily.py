"""AidPage daily reference fetcher — 국가법령정보 본문 수집 + 개정 감지 (설계 docs/02 §4).

- LAW_OC(open.law.go.kr 인증키)가 없으면 어떤 파일도 건드리지 않고 종료한다.
- rules/*.json 의 `law` 필드({mst, name, art, annex})를 모아 법령별로 1회 호출,
  참조된 조문·별표 텍스트만 추출해 data/ref/law/<mst>.json 에 저장한다.
- 시행일자가 저장본과 달라지면 data/ref/law/changes.json 에 기록하고
  GitHub Actions `::warning` 을 낸다 (사이트 개정 배지·금액 재확인용).

⚠ 법령 API JSON 스키마는 승인 후 첫 실행에서 검증 필요 — 파서는 방어적으로 작성.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request

try:  # Windows 콘솔(cp949)에서도 한글·대시 로그가 죽지 않게
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "ref", "law")
RULES_DIR = os.path.join(ROOT, "rules")
OC = os.environ.get("LAW_OC", "").strip()
API = "https://www.law.go.kr/DRF/lawService.do"


def log(msg: str) -> None:
    print(f"[fetch_daily] {msg}", flush=True)


def get_json(params: dict) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params, encoding='utf-8')}"
    req = urllib.request.Request(url, headers={"User-Agent": "safepic-daily (github.com/5-Jihwan/aidpage)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        # 인증 실패·미승인 시 HTML이 온다
        raise RuntimeError(f"non-JSON response ({body[:120]!r})")


def strip_tags(s) -> str:
    return re.sub(r"<[^>]+>", "", str(s or "")).strip()


# 법령명 영어 참고 번역 (EN 모드 표시용; 비공식)
NAME_EN = {
    "자연재난 구호 및 복구 비용 부담기준 등에 관한 규정": "Regulations on Cost-Bearing Standards for Natural Disaster Relief and Recovery",
    "재난 및 안전관리 기본법": "Framework Act on the Management of Disasters and Safety",
    "재해구호법": "Disaster Relief Act",
    "긴급복지지원법": "Emergency Aid and Support Act",
    "에너지법": "Energy Act",
    "노인복지법": "Welfare of Senior Citizens Act",
    "국민건강보험법": "National Health Insurance Act",
    "국민연금법": "National Pension Act",
    "전기통신사업법": "Telecommunications Business Act",
    "도시가스사업법": "Urban Gas Business Act",
    "집단에너지사업법": "Integrated Energy Supply Act",
    "지방세특례제한법": "Restriction of Special Local Taxation Act",
    "국세기본법": "Framework Act on National Taxes",
    "초·중등교육법 시행령": "Enforcement Decree of the Elementary and Secondary Education Act",
    "방송법 시행령": "Enforcement Decree of the Broadcasting Act",
    "중소기업진흥에 관한 법률": "Small and Medium Enterprises Promotion Act",
    "소상공인 보호 및 지원에 관한 법률": "Act on the Protection of and Support for Micro Enterprises",
    "병역법": "Military Service Act",
    "농어업재해대책법": "Agricultural and Fishery Disaster Countermeasures Act",
    "풍수해·지진재해보험법": "Storm, Flood and Earthquake Insurance Act",
    "의연금품 관리·운영 규정": "Relief Fund Management and Operation Regulation",
}


def collect_refs() -> dict[str, dict]:
    """rules/*.json → {mst: {name, arts:set, annexes:set}}"""
    refs: dict[str, dict] = {}
    for fn in sorted(os.listdir(RULES_DIR)):
        if not fn.endswith(".json") or fn in ("en.json", "changelog.json"):
            continue
        try:
            doc = json.load(open(os.path.join(RULES_DIR, fn), encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"skip {fn}: {e}")
            continue
        for r in doc.get("rules") or []:
            law = r.get("law")
            if not law or not law.get("mst"):
                continue
            e = refs.setdefault(str(law["mst"]), {"name": law.get("name"), "arts": set(), "annexes": set(), "kind": law.get("kind") or "law"})
            if law.get("art"):
                e["arts"].add(law["art"])
            if law.get("annex"):
                e["annexes"].add(law["annex"])
    return refs


def _as_list(v):
    return v if isinstance(v, list) else [v] if v else []


def parse_law(data: dict, want: dict) -> dict:
    """법령 본문 응답 → {name, effective, arts:{제N조: text}, annexes:{별표N: text}}"""
    law = data.get("법령") or data.get("Law") or {}
    basic = law.get("기본정보") or {}
    out = {
        "name": strip_tags(basic.get("법령명_한글") or basic.get("법령명한글") or want.get("name") or ""),
        "effective": str(basic.get("시행일자") or ""),
        "arts": {},
        "annexes": {},
    }
    if re.fullmatch(r"\d{8}", out["effective"]):
        out["effective"] = f"{out['effective'][:4]}-{out['effective'][4:6]}-{out['effective'][6:]}"
    # 조문
    units = _as_list((law.get("조문") or {}).get("조문단위"))
    for u in units:
        if not isinstance(u, dict):
            continue
        no = str(u.get("조문번호") or "").strip()
        if not no:
            continue
        branch = str(u.get("조문가지번호") or "").strip().lstrip("0")
        key = f"제{no}조의{branch}" if branch else f"제{no}조"
        if key not in want["arts"]:
            continue
        parts = [strip_tags(u.get("조문내용"))]
        for h in _as_list(u.get("항")):
            if isinstance(h, dict):
                parts.append(strip_tags(h.get("항내용")))
                for ho in _as_list(h.get("호")):
                    if isinstance(ho, dict):
                        parts.append(strip_tags(ho.get("호내용")))
        out["arts"][key] = "\n".join(p for p in parts if p)
    # 별표 (본문 응답에 별표단위가 없으면 파일 링크만 남긴다)
    annex_units = _as_list((law.get("별표") or {}).get("별표단위"))

    def _flat(v):
        if isinstance(v, (list, tuple)):
            return '\n'.join(t for t in (_flat(x) for x in v) if t)
        return strip_tags(v)

    for a in annex_units:
        if not isinstance(a, dict):
            continue
        if str(a.get("별표구분") or "별표").strip() != "별표":
            continue  # 서식·별지는 제외 (별표 번호와 충돌)
        no = str(a.get("별표번호") or "").strip().lstrip("0")
        branch = str(a.get("별표가지번호") or "").strip().lstrip("0")
        key = f"별표{no}의{branch}" if branch else f"별표{no}"
        if key not in want["annexes"]:
            continue
        txt = _flat(a.get("별표내용")) or strip_tags(a.get("별표제목"))
        link = a.get("별표서식파일링크")
        if link:
            txt = (txt + f"\n(서식 파일: https://www.law.go.kr{link})").strip()
        out["annexes"][key] = txt
    return out


def parse_admrul(data: dict, want: dict) -> dict:
    """행정규칙 본문 응답(조문내용=문자열 리스트) → parse_law와 동일한 출력 형태."""
    root = data.get("AdmRulService") or data
    info = root.get("행정규칙기본정보") or {}
    out = {
        "name": strip_tags(info.get("행정규칙명") or want.get("name") or ""),
        "effective": str(info.get("시행일자") or info.get("발령일자") or ""),
        "arts": {},
        "annexes": {},
    }
    if re.fullmatch(r"[0-9]{8}", out["effective"]):
        out["effective"] = f"{out['effective'][:4]}-{out['effective'][4:6]}-{out['effective'][6:]}"
    for item in _as_list(root.get("조문내용")):
        txt = strip_tags(item)
        m = re.match(r"(제[0-9]+조(?:의[0-9]+)?)", txt)
        if m and m.group(1) in want["arts"]:
            out["arts"][m.group(1)] = txt
    return out


def main() -> int:
    if not OC:
        log("LAW_OC not set — skipping (no files touched)")
        return 0
    refs = collect_refs()
    log(f"law refs in rules: {len(refs)} laws")
    if not refs:
        return 0
    os.makedirs(OUT_DIR, exist_ok=True)
    changes_path = os.path.join(OUT_DIR, "changes.json")
    try:
        changes = json.load(open(changes_path, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        changes = {"items": []}
    ok = fail = 0
    for mst, want in refs.items():
        prev = None
        path = os.path.join(OUT_DIR, f"{mst}.json")
        try:
            prev = json.load(open(path, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
        try:
            if want.get("kind") == "admrul":
                data = get_json({"OC": OC, "target": "admrul", "LM": want["name"], "type": "JSON"})
                doc = parse_admrul(data, want)
            else:
                data = get_json({"OC": OC, "target": "law", "MST": mst, "type": "JSON"})
                doc = parse_law(data, want)
        except Exception as e:  # noqa: BLE001
            log(f"mst={mst} FAIL: {e}")
            fail += 1
            continue
        from datetime import datetime, timezone, timedelta

        doc["updated"] = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
        _nk = str(doc.get("name") or "").replace("ㆍ", "·")
        if NAME_EN.get(_nk):
            doc["name_en"] = NAME_EN[_nk]
        # 개정 감지
        if prev and prev.get("effective") and doc.get("effective") and prev["effective"] != doc["effective"]:
            msg = f"{doc['name']} 시행일 변경 {prev['effective']} → {doc['effective']} — 금액·기준 재확인 필요"
            log(f"::warning::{msg}")
            changes["items"] = ([{"mst": mst, "name": doc["name"], "from": prev["effective"],
                                  "to": doc["effective"], "found": doc["updated"]}]
                                + [c for c in changes.get("items", []) if c.get("mst") != mst])[:50]
        json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        got = f"arts {len(doc['arts'])}/{len(want['arts'])}, annexes {len(doc['annexes'])}/{len(want['annexes'])}"
        log(f"mst={mst} ok ({got})")
        if len(doc["arts"]) < len(want["arts"]):
            log(f"::warning::mst={mst} missing arts: {sorted(set(want['arts']) - set(doc['arts']))} — 스키마 확인 필요")
        ok += 1
    json.dump(changes, open(changes_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"done ok={ok} fail={fail}")
    return 0 if ok or not refs else 1


if __name__ == "__main__":
    sys.exit(main())
