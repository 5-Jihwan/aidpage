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

    if "--push" in sys.argv:
        def git(*a):
            return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True)
        if "data/live/alerts.json" not in git("status", "--porcelain").stdout:
            log("no git change")
            return 0
        git("stash", "--include-untracked", "--", "data/live/alerts.json")
        git("pull", "--rebase", "-q")
        git("stash", "pop")
        git("add", "data/live/alerts.json")
        git("commit", "-q", "-m", f"live(sd-local) {now_kst().strftime('%Y-%m-%dT%H:%M')}")
        r = git("push", "-q")
        if r.returncode != 0:
            git("pull", "--rebase", "-q")
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
