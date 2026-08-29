"""SD(재난안전데이터공유플랫폼) 전용 로컬 수집기 — 홈 PC 작업 스케줄러용.

플랫폼이 등록 IP에서만 호출을 허용하므로(GitHub Actions 불가), 이 스크립트가
집 PC에서 SD 섹션(특보·예비특보·재난문자·산사태)만 갱신한다.
비-SD 섹션(날씨·지진·태풍·응급실 등)은 건드리지 않는다 — Actions(live.yml)가 계속 담당.

키: repo 루트 .keys.env.parsed (NAME=값, gitignore됨) 를 환경변수로 주입.
사용: python scripts/fetch_sd_live.py [--push]
  --push  변경 시 git stash→pull --rebase→commit→push (live-bot과 같은 방식)
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import urllib.request
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

# pythonw(창 없는 실행)에서는 stdout/stderr가 없다 → 로그 파일로 대체
if sys.stderr is None or sys.stdout is None:
    _lf = io.open(os.path.join(ROOT, ".sd_collector.log"), "a", encoding="utf-8")
    sys.stdout = sys.stderr = _lf


def flog(msg):
    """실행 로그 — 콘솔(cmd 리다이렉트가 받음) 우선, 파일은 열리면 보조로.
    cmd `>>`가 파일을 점유 중이면 파일 쓰기는 조용히 건너뛴다."""
    from datetime import datetime
    line = f"{datetime.now().isoformat(timespec='seconds')} {msg}"
    try:
        print(line, flush=True)
    except Exception:  # noqa: BLE001
        pass
    try:
        with io.open(os.path.join(ROOT, ".sd_collector2.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass

# 키 주입 (fetch_live import 전에)
_kp = os.path.join(ROOT, ".keys.env.parsed")
if os.path.exists(_kp):
    for ln in io.open(_kp, encoding="utf-8").read().splitlines():
        if "=" in ln:
            k, v = ln.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from fetch_live import (ALERTS_PATH, SD_KEY, now_kst, log,  # noqa: E402
                        fetch_warnings_sd, fetch_prewarn_sd, fetch_landslide_sd, fetch_messages)


# ── 웹 푸시 트리거 ─────────────────────────────────────────────
# 직전 수집분과 비교해 "새로 나타난" 특보·재난문자만 골라 Worker에 발송을 요청한다.
# 서버 push엔 페이로드가 없고(SW가 alerts.json을 다시 읽음), 여기선 대상 지역 코드만 보낸다.
PUSH_STATE = os.path.join(ROOT, ".push_state.json")
PUSH_URL = "https://safepic-api.safepic.workers.dev/push/send"


def _warn_key(w):
    return f"{w.get('type')}|{w.get('level')}|{','.join(sorted(map(str, w.get('area_codes') or [])))}"


def push_notify(out):
    auth = os.environ.get("PUSH_AUTH", "").strip()
    if not auth:
        return
    try:
        st = json.load(io.open(PUSH_STATE, encoding="utf-8"))
    except Exception:  # noqa: BLE001 — 첫 실행: 현재 상태만 기록하고 발송하지 않는다(재알림 방지)
        st = None

    warns = (out.get("warnings") or {}).get("items") or []
    msgs = (out.get("messages") or {}).get("items") or []
    cur = {"warn_keys": sorted({_warn_key(w) for w in warns}),
           "msg_ids": sorted({str(m.get("id")) for m in msgs if m.get("id")})[-500:]}

    if st is not None:
        seen_w, seen_m = set(st.get("warn_keys") or []), set(st.get("msg_ids") or [])
        sggs, sidos, allmsg = set(), set(), False
        for w in warns:
            if _warn_key(w) in seen_w:
                continue
            for c in (w.get("area_codes") or []):
                c = str(c)
                if len(c) >= 5:
                    sggs.add(c[:5])
                elif len(c) >= 2:
                    sidos.add(c[:2])
        new_msgs = [m for m in msgs if str(m.get("id")) not in seen_m]
        if new_msgs:
            try:
                idx = json.load(io.open(os.path.join(ROOT, "data", "admin", "sgg_index.json"),
                                        encoding="utf-8"))
            except Exception:  # noqa: BLE001
                idx = []
            for m in new_msgs:
                rg = str(m.get("region") or "")
                if "전국" in rg:
                    allmsg = True
                    continue
                hit = False
                for rec in idx:
                    if rec.get("sido_name") and rec["sido_name"] in rg and rec.get("name") and rec["name"] in rg:
                        sggs.add(str(rec["code"])); hit = True
                if not hit:  # 시군구 매칭 실패 → 시도 단위로 넓혀 발송
                    for rec in idx:
                        if rec.get("sido_name") and rec["sido_name"] in rg:
                            sidos.add(str(rec["code"])[:2])
        if allmsg or sggs or sidos:
            body = json.dumps({"all": allmsg, "sggs": sorted(sggs), "sidos": sorted(sidos)}).encode()
            req = urllib.request.Request(PUSH_URL, data=body, method="POST",
                                         headers={"Content-Type": "application/json",
                                                  "X-Push-Auth": auth,
                                                  # Cloudflare가 Python-urllib UA를 봇 차단(1010)함
                                                  "User-Agent": "aidpage-collector"})
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    log(f"push_notify: {r.read().decode()[:120]}")
            except Exception as e:  # noqa: BLE001 — 발송 실패는 수집을 막지 않는다
                log(f"push_notify failed: {e}")

    json.dump(cur, io.open(PUSH_STATE, "w", encoding="utf-8"))


def main() -> int:
    try:
        prev = json.load(io.open(ALERTS_PATH, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        prev = {}
    sgg = json.load(io.open(os.path.join(ROOT, "data", "admin", "sgg_index.json"), encoding="utf-8"))

    def safe(fn, *a):
        try:
            return fn(*a)
        except Exception as e:  # noqa: BLE001
            log(f"{fn.__name__} failed: {e}")
            return dict(prev.get("_", {}) or {}, status="error:local")

    changed = {}
    if SD_KEY.get("warn"):
        changed["warnings"] = safe(fetch_warnings_sd, sgg, prev.get("warnings"))
    if SD_KEY.get("prewarn"):
        changed["prewarn"] = safe(fetch_prewarn_sd, prev.get("prewarn"))
    if SD_KEY.get("ls_fcst") or SD_KEY.get("ls_pred"):
        changed["landslide"] = safe(fetch_landslide_sd, prev.get("landslide"))
    if os.environ.get("SAFETYDATA_KEY"):
        changed["messages"] = safe(fetch_messages, prev.get("messages"))

    ok = {k: v.get("status") for k, v in changed.items()}
    log(f"sd sections: {ok}")
    flog(f"sections: {ok}")
    if not changed:
        log("no SD keys — nothing to do")
        return 0
    # 실패(error:*)만 있고 기존이 ok였던 섹션은 덮지 않는다 (신선한 데이터 보호)
    out = dict(prev)
    wrote = []
    for k, v in changed.items():
        st = str(v.get("status") or "")
        if st.startswith("error") and str((prev.get(k) or {}).get("status")) == "ok":
            continue
        out[k] = v
        wrote.append(k)
    if not wrote:
        log("all sections failed and prev is fresher — no write")
        return 0
    out["updated"] = now_kst().isoformat(timespec="seconds")
    json.dump(out, io.open(ALERTS_PATH, "w", encoding="utf-8"), ensure_ascii=False,
              separators=(",", ":"))
    log(f"wrote {ALERTS_PATH} sections={wrote}")
    push_notify(out)

    if "--push" in sys.argv:
        # ⚠ pythonw(창 없음)라도 자식 git.exe가 콘솔을 새로 열어 30분마다 창이 깜빡임
        #   → CREATE_NO_WINDOW로 억제
        NOWIN = 0x08000000 if os.name == "nt" else 0

        def git(*a):
            return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True,
                                  creationflags=NOWIN)
        # ⚠ pull --rebase 가 충돌하면 git 은 detached HEAD 로 멈춘다. 예전 구현은
        #   반환값을 보지 않고 그 위에 계속 커밋해 브랜치가 갈라지고 push 가 영구 실패했다
        #   (2026-08-29 복구). 매 실행마다 정상 상태를 먼저 보장한다.
        gd = os.path.join(ROOT, ".git")
        if any(os.path.exists(os.path.join(gd, d)) for d in ("rebase-merge", "rebase-apply")):
            git("rebase", "--abort")
            log("aborted stale rebase")
        if not git("symbolic-ref", "--quiet", "--short", "HEAD").stdout.strip():
            git("checkout", "-q", "main")
            log("detached HEAD -> main")

        if "data/live/alerts.json" not in git("status", "--porcelain").stdout:
            log("no git change")
            return 0
        # 커밋을 먼저 한다 — stash/pop 실패로 변경분이 유실되던 경로를 없앱다.
        git("add", "data/live/alerts.json")
        c = git("commit", "-q", "-m", f"live(sd-local) {now_kst().strftime('%Y-%m-%dT%H:%M')}")
        if c.returncode != 0:
            msg = f"commit failed: {c.stderr[:200]}"
            log(msg); flog(msg)
            return 0
        # 자동 생성 파일이므로 충돌 시 로컬(최신 수집분)을 채택한다.
        # 리베이스에서 우리 커밋은 'theirs' 쪽이다.
        pl = git("pull", "--rebase", "-X", "theirs", "-q")
        if pl.returncode != 0:
            git("rebase", "--abort")
            msg = f"pull failed, retry next cycle: {pl.stderr[:200]}"
            log(msg); flog(msg)
            return 0
        r = git("push", "-q")
        msg = "pushed" if r.returncode == 0 else f"push failed: {r.stderr[:200]}"
        log(msg); flog(msg)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        flog(f"FATAL: {type(e).__name__}: {e}")
        raise
