"""행정구역 이름 영문(로마자) 일괄 생성 — 국어의 로마자 표기법(2000) 기반.

- 비음화·유음화·연음 등 표준 발음 규칙을 적용해 지명을 로마자로 변환한다
  (신림→Sillim, 종로→Jongno, 왕십리→Wangsimni — pip의 korean-romanizer는
  이 규칙이 없어 부적합했음).
- 접미: 시→-si, 군→-gun, 구→-gu, 동→-dong, 읍→-eup, 면→-myeon, 리→-ri, 가→-ga.
  복합 시군구(고양시덕양구)는 "Goyang-si Deogyang-gu"로 분리.
- 대상: data/admin/{sgg_index,emd_index}.json 에 name_en(+sido_name_en·sgg_name_en),
  kr_{sido,sgg,emd}.geojson properties에 name_en. 제자리(in-place) 갱신.
- 멱등: 다시 실행해도 같은 결과.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN = os.path.join(ROOT, "data", "admin")

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ",
        "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"]
JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ",
        "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]
R_CHO = {"ㄱ": "g", "ㄲ": "kk", "ㄴ": "n", "ㄷ": "d", "ㄸ": "tt", "ㄹ": "r", "ㅁ": "m",
         "ㅂ": "b", "ㅃ": "pp", "ㅅ": "s", "ㅆ": "ss", "ㅇ": "", "ㅈ": "j", "ㅉ": "jj",
         "ㅊ": "ch", "ㅋ": "k", "ㅌ": "t", "ㅍ": "p", "ㅎ": "h"}
R_JUNG = {"ㅏ": "a", "ㅐ": "ae", "ㅑ": "ya", "ㅒ": "yae", "ㅓ": "eo", "ㅔ": "e",
          "ㅕ": "yeo", "ㅖ": "ye", "ㅗ": "o", "ㅘ": "wa", "ㅙ": "wae", "ㅚ": "oe",
          "ㅛ": "yo", "ㅜ": "u", "ㅝ": "wo", "ㅞ": "we", "ㅟ": "wi", "ㅠ": "yu",
          "ㅡ": "eu", "ㅢ": "ui", "ㅣ": "i"}
R_JONG = {"": "", "ㄱ": "k", "ㄴ": "n", "ㄷ": "t", "ㄹ": "l", "ㅁ": "m", "ㅂ": "p", "ㅇ": "ng"}
# 받침 대표음 (음절 끝소리 규칙)
REP = {"ㄲ": "ㄱ", "ㄳ": "ㄱ", "ㄺ": "ㄱ", "ㅋ": "ㄱ", "ㄵ": "ㄴ", "ㄶ": "ㄴ",
       "ㅅ": "ㄷ", "ㅆ": "ㄷ", "ㅈ": "ㄷ", "ㅊ": "ㄷ", "ㅌ": "ㄷ", "ㅎ": "ㄷ",
       "ㄼ": "ㄹ", "ㄽ": "ㄹ", "ㄾ": "ㄹ", "ㅀ": "ㄹ", "ㄻ": "ㅁ", "ㄿ": "ㅂ", "ㅍ": "ㅂ", "ㅄ": "ㅂ"}
# 연음 시 겹받침 분리 (남는 받침, 넘어가는 초성)
SPLIT = {"ㄳ": ("ㄱ", "ㅅ"), "ㄵ": ("ㄴ", "ㅈ"), "ㄶ": ("ㄴ", ""), "ㄺ": ("ㄹ", "ㄱ"),
         "ㄻ": ("ㄹ", "ㅁ"), "ㄼ": ("ㄹ", "ㅂ"), "ㄽ": ("ㄹ", "ㅅ"), "ㄾ": ("ㄹ", "ㅌ"),
         "ㄿ": ("ㄹ", "ㅍ"), "ㅀ": ("ㄹ", "")}


def decompose(ch):
    o = ord(ch) - 0xAC00
    if not 0 <= o < 11172:
        return None
    return [CHO[o // 588], JUNG[o % 588 // 28], JONG[o % 28]]


def romanize(word: str) -> str:
    """한글 부분을 로마자로. 숫자·'·' 등 비한글은 그대로 통과."""
    syls = [decompose(c) or c for c in word]
    # 음운 변동 (경계별, 왼쪽→오른쪽)
    for i, s in enumerate(syls):
        if isinstance(s, str):
            continue
        nxt = syls[i + 1] if i + 1 < len(syls) and not isinstance(syls[i + 1], str) else None
        cho_n = nxt[0] if nxt else None
        jong = s[2]
        if not jong:
            continue
        if cho_n == "ㅇ":  # 연음
            if jong in SPLIT:
                s[2], nxt[0] = SPLIT[jong]
                if nxt[0] == "":
                    nxt[0] = "ㅇ"
            elif jong == "ㅇ":
                pass
            elif jong == "ㅎ":  # ㅎ 탈락
                s[2] = ""
            else:
                nxt[0], s[2] = jong, ""
            continue
        jr = REP.get(jong, jong)
        if cho_n == "ㄹ":
            if jr == "ㄱ":
                s[2], nxt[0] = "ㅇ", "ㄴ"
            elif jr == "ㅂ":
                s[2], nxt[0] = "ㅁ", "ㄴ"
            elif jr == "ㄷ":
                s[2], nxt[0] = "ㄴ", "ㄴ"
            elif jr in ("ㅁ", "ㅇ"):
                s[2], nxt[0] = jr, "ㄴ"
            elif jr == "ㄴ":
                s[2] = "ㄹ"  # ㄴ+ㄹ → ㄹㄹ
            else:
                s[2] = jr
        elif cho_n in ("ㄴ", "ㅁ"):
            if jr == "ㄱ":
                s[2] = "ㅇ"
            elif jr == "ㄷ":
                s[2] = "ㄴ"
            elif jr == "ㅂ":
                s[2] = "ㅁ"
            elif jr == "ㄹ" and cho_n == "ㄴ":
                s[2], nxt[0] = "ㄹ", "ㄹ"  # ㄹ+ㄴ → ㄹㄹ
            else:
                s[2] = jr
        else:
            s[2] = jr
    if syls and not isinstance(syls[-1], str):
        syls[-1][2] = REP.get(syls[-1][2], syls[-1][2])
    out, prev_jong = [], ""
    for s in syls:
        if isinstance(s, str):
            out.append(s)
            prev_jong = ""
            continue
        cho = "l" if s[0] == "ㄹ" and prev_jong == "ㄹ" else R_CHO[s[0]]
        out.append(cho + R_JUNG[s[1]] + R_JONG[s[2]])
        prev_jong = s[2]
    r = "".join(out)
    return r[:1].upper() + r[1:]


SIDO_EN = {
    "서울특별시": "Seoul", "부산광역시": "Busan", "대구광역시": "Daegu", "인천광역시": "Incheon",
    "광주광역시": "Gwangju", "대전광역시": "Daejeon", "울산광역시": "Ulsan",
    "세종특별자치시": "Sejong", "경기도": "Gyeonggi-do", "강원특별자치도": "Gangwon-do",
    "충청북도": "Chungcheongbuk-do", "충청남도": "Chungcheongnam-do",
    "전북특별자치도": "Jeonbuk-do", "전라남도": "Jeollanam-do",
    "전남광주통합특별시": "Jeonnam-Gwangju",  # 2026 통합 시도 (admdongkor 2026-07)
    "경상북도": "Gyeongsangbuk-do", "경상남도": "Gyeongsangnam-do", "제주특별자치도": "Jeju-do",
}


def sgg_en(name: str) -> str:
    if name in SIDO_EN:  # 세종특별자치시가 시군구 층에도 옴
        return SIDO_EN[name]
    if name.endswith("구") and "시" in name[:-1]:  # 고양시덕양구 → Goyang-si Deogyang-gu
        i = name.index("시")
        return f"{romanize(name[:i])}-si {romanize(name[i + 1:-1])}-gu"
    tail = {"구": "gu", "군": "gun", "시": "si"}.get(name[-1])
    return f"{romanize(name[:-1])}-{tail}" if tail else romanize(name)


EMD_RE = re.compile(r"^(.+?)(제?\d[\d·.]*)?(가동|동|읍|면|리|가)$")
EMD_TAIL = {"동": "dong", "읍": "eup", "면": "myeon", "리": "ri", "가": "ga", "가동": "ga-dong"}


def emd_en(name: str) -> str:
    m = EMD_RE.match(name)
    if not m:
        return romanize(name)
    stem, num, tail = m.group(1), m.group(2) or "", m.group(3)
    num = num.replace("제", "")
    r = romanize(stem)
    return f"{r} {num}-{EMD_TAIL[tail]}" if num else f"{r}-{EMD_TAIL[tail]}"


def selftest():
    cases = {"신림": "Sillim", "종로": "Jongno", "왕십리": "Wangsimni", "독립": "Dongnip",
             "선릉": "Seolleung", "청량리": "Cheongnyangni", "관악": "Gwanak",
             "여의도": "Yeouido", "을지로": "Euljiro", "압구정": "Apgujeong",
             "낙성대": "Nakseongdae", "잠실": "Jamsil", "독도": "Dokdo", "덕양": "Deogyang"}
    bad = {k: (romanize(k), v) for k, v in cases.items() if romanize(k) != v}
    if bad:
        raise SystemExit(f"romanizer selftest FAILED: {bad}")
    assert emd_en("신림동") == "Sillim-dong"
    assert emd_en("진안읍") == "Jinan-eup"
    assert emd_en("창신1동") == "Changsin 1-dong"
    assert emd_en("종로1·2·3·4가동") == "Jongno 1·2·3·4-ga-dong"
    assert sgg_en("관악구") == "Gwanak-gu"
    assert sgg_en("고양시덕양구") == "Goyang-si Deogyang-gu"
    print("[build_admin_en] selftest ok")


def load(p):
    return json.load(io.open(p, encoding="utf-8"))


def save(p, obj):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    selftest()
    sido_geo = load(os.path.join(ADMIN, "kr_sido.geojson"))
    for f in sido_geo["features"]:
        nm = f["properties"]["name"]
        f["properties"]["name_en"] = SIDO_EN.get(nm) or romanize(nm)
        if nm not in SIDO_EN:
            print(f"[build_admin_en] WARN unknown sido {nm!r} -> {f['properties']['name_en']}")
    save(os.path.join(ADMIN, "kr_sido.geojson"), sido_geo)
    sido_by_code = {f["properties"]["code"]: f["properties"]["name_en"] for f in sido_geo["features"]}
    sido_by_name = {f["properties"]["name"]: f["properties"]["name_en"] for f in sido_geo["features"]}

    sgg_idx = load(os.path.join(ADMIN, "sgg_index.json"))
    for s in sgg_idx:
        s["name_en"] = sgg_en(s["name"])
        s["sido_name_en"] = sido_by_name.get(s["sido_name"]) or sido_by_code.get(str(s["sido"])) or romanize(s["sido_name"])
    save(os.path.join(ADMIN, "sgg_index.json"), sgg_idx)
    sgg_by_code = {str(s["code"]): s["name_en"] for s in sgg_idx}
    sgg_by_name = {s["name"]: s["name_en"] for s in sgg_idx}

    emd_idx = load(os.path.join(ADMIN, "emd_index.json"))
    for e in emd_idx:
        e["name_en"] = emd_en(e["name"])
        e["sgg_name_en"] = sgg_by_code.get(str(e["sgg"])) or sgg_by_name.get(e["sgg_name"]) or sgg_en(e["sgg_name"])
        e["sido_name_en"] = sido_by_name.get(e["sido_name"]) or sido_by_code.get(str(e["sido"])) or romanize(e["sido_name"])
    save(os.path.join(ADMIN, "emd_index.json"), emd_idx)

    for fn, en_of in (("kr_sgg.geojson", lambda nm: sgg_by_name.get(nm) or sgg_en(nm)),
                      ("kr_emd.geojson", lambda nm: emd_en(nm))):
        geo = load(os.path.join(ADMIN, fn))
        for f in geo["features"]:
            f["properties"]["name_en"] = en_of(f["properties"]["name"])
        save(os.path.join(ADMIN, fn), geo)
    print(f"[build_admin_en] done: sido {len(sido_geo['features'])}, sgg {len(sgg_idx)}, emd {len(emd_idx)}")


if __name__ == "__main__":
    sys.exit(main())
