# -*- coding: utf-8 -*-
"""사이트가 사용자에게 내보내는 외부 링크 점검 — 한국 IP인 이 PC에서 실행한다.

    python scripts/check_links.py            # 전체 점검 → docs/link_check/links_YYYYMMDD.json + 요약 출력
    python scripts/check_links.py --list     # URL 목록만(요청 없음)

HTTP 상태만 보면 안 된다: 정부 사이트는 없는 글에도 200을 주고 "페이지를 찾을 수 없습니다"를 띄우거나
(soft 404) 첫 화면으로 돌려보낸다. 그래서 ①상태 ②본문의 오류 문구 ③첫 화면으로 튕김 ④제목을 함께 본다.
API 엔드포인트·타일·글꼴처럼 사람이 누르지 않는 주소는 뺀다.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import glob
import io
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = (['index.html', 'atlas.html', 'dex.html', 'sim.html', 'worker/src/kakao.js']
         + sorted(glob.glob(os.path.join(ROOT, 'js', '*.js')))
         + sorted(glob.glob(os.path.join(ROOT, 'rules', '*.json')))
         + [os.path.join(ROOT, 'data', 'ref', f) for f in ('tips.json', 'psych_centers.json', 'welfare.json', 'welfare_en.json')])
URL_RX = re.compile(r'https?://[^\s"\'<>`\\)\]}]+')
# 사람이 누르는 링크가 아닌 것(호출용·자원용)
SKIP_HOST = re.compile(r'(apis\.data\.go\.kr|api\.odcloud\.kr|apihub\.kma\.go\.kr|tiles?\.|openfreemap|fonts\.g|gstatic|'
                       r'workers\.dev|amazonaws\.com|w3\.org|schema\.org|unpkg\.com|jsdelivr|cdnjs|localhost|127\.0\.0\.1|'
                       r'api\.github\.com|raw\.githubusercontent|open\.law\.go\.kr/LSO|law\.go\.kr/DRF|dapi\.kakao|apis-navi)')
SOFT404 = re.compile(r'(페이지를\s*찾을\s*수\s*없|존재하지\s*않는\s*(페이지|게시|자료)|요청하신\s*페이지|삭제되었거나|잘못된\s*(접근|경로)|'
                     r'서비스\s*(종료|중단)|not\s*found|404\s*error|error\s*404|page\s*not\s*found|해당\s*(게시물|자료)[이가]?\s*없)', re.I)
SOFT404_KO = re.compile(r'(요청하신\s*페이지[가는]?\s*(없|찾을)|페이지를\s*찾을\s*수\s*없|존재하지\s*않는\s*페이지|경로가\s*잘못되었거나|삭제되었거나\s*이동)')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE   # 정부 사이트의 중간 인증서 누락이 흔하다 — 여기서는 '열리는가'만 본다


def collect() -> dict[str, list[str]]:
    by: dict[str, set[str]] = {}
    for f in FILES:
        p = f if os.path.isabs(f) else os.path.join(ROOT, f)
        if not os.path.exists(p):
            continue
        s = io.open(p, encoding='utf-8').read()
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        for u in URL_RX.findall(s):
            u = u.rstrip('.,;:').replace('&amp;', '&')
            if '${' in u or SKIP_HOST.search(u):
                continue
            by.setdefault(u, set()).add(rel)
    return {u: sorted(v) for u, v in sorted(by.items())}


def check(u: str) -> dict:
    out = {'url': u, 'status': None, 'final': None, 'title': '', 'verdict': '', 'note': ''}
    try:
        q = urllib.parse.urlsplit(u)
        safe = urllib.parse.urlunsplit((q.scheme, q.netloc.encode('idna').decode(), urllib.parse.quote(q.path, safe='/%:@'),
                                        urllib.parse.quote(q.query, safe='=&%:/+,@'), ''))
        req = urllib.request.Request(safe, headers={'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8', 'Accept': 'text/html,*/*'})
        with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
            out['status'] = r.status
            out['final'] = r.geturl()
            raw = r.read(800_000)   # 행안부는 오류 문구가 120KB 뒤에 온다
        enc = 'utf-8'
        m = re.search(rb'charset=["\']?([\w-]+)', raw[:3000], re.I)
        if m:
            enc = m.group(1).decode('ascii', 'ignore') or 'utf-8'
        try:
            body = raw.decode(enc, 'replace')
        except LookupError:
            body = raw.decode('utf-8', 'replace')
        t = re.search(r'<title[^>]*>(.*?)</title>', body, re.I | re.S)
        out['title'] = re.sub(r'\s+', ' ', t.group(1)).strip()[:80] if t else ''
        fin = urllib.parse.urlsplit(out['final'])
        bounced = (q.path.rstrip('/') not in ('', '/index.do', '/main.do') and fin.path.rstrip('/') in ('', '/index.do', '/main.do', '/main', '/index.html')
                   and not fin.query and (q.path != fin.path))
        text = re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', body, flags=re.S | re.I)
        text = re.sub(r'\s+', ' ', text)
        # 정부 누리집은 긴 메뉴 뒤에 오류 문구가 온다(행안부: 6,700자 뒤) → 한국어 문구는 본문 전체에서, 영어는 앞쪽에서만
        hit = SOFT404.search(out['title']) or SOFT404_KO.search(text) or SOFT404.search(text[:3000])
        if hit:
            out['verdict'], out['note'] = 'SOFT404', hit.group(0)[:40]
        elif bounced:
            out['verdict'], out['note'] = 'BOUNCED', '첫 화면으로 돌려보냄'
        elif q.netloc.endswith('law.go.kr') and re.search(r'<iframe[^>]+src="([^"]+)"', body):
            # 법령 한글주소는 겉이 틀뿐이다 → 안쪽 프레임을 받아 '제N조'가 실제로 있는지 본다
            src = urllib.parse.urljoin('https://www.law.go.kr/', re.search(r'<iframe[^>]+src="([^"]+)"', body).group(1).replace('&amp;', '&'))
            with urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': UA}), timeout=25, context=CTX) as r2:
                inner = re.sub(r'<script.*?</script>|<[^>]+>', ' ', r2.read(3_000_000).decode('utf-8', 'replace'), flags=re.S)
            art = re.search(r'/(제\d+조(?:의\d+)?)$', urllib.parse.unquote(u))
            if re.search(r'일치하는\s*법령이\s*없|존재하지\s*않', inner[:4000]):
                out['verdict'], out['note'] = 'SOFT404', '법령을 찾지 못함'
            elif art and art.group(1) + '(' not in inner:
                out['verdict'], out['note'] = 'SOFT404', art.group(1) + ' 조문이 안쪽 프레임에 없음'
            else:
                out['verdict'], out['note'] = 'OK', '법령 프레임에서 확인'
        elif q.netloc.endswith('law.go.kr') and urllib.parse.unquote(q.path).startswith(('/법령/', '/행정규칙/', '/자치법규/')):
            out['verdict'], out['note'] = 'SOFT404', '법령 한글주소가 해석되지 않음(프레임 없음)'
        elif len(text.strip()) < 80 and 'html' in body[:500].lower():
            out['verdict'], out['note'] = 'EMPTY', '본문 거의 없음(스크립트 렌더 가능성 — 손으로 확인)'
        else:
            out['verdict'] = 'OK'
    except urllib.error.HTTPError as e:
        out['status'], out['verdict'], out['note'] = e.code, ('DEAD' if e.code in (404, 410) else 'HTTP' + str(e.code)), str(e.reason)[:60]
    except Exception as e:  # noqa: BLE001 — DNS·TLS·timeout 모두 한 칸에
        out['verdict'], out['note'] = 'FAIL', f'{type(e).__name__}: {str(e)[:70]}'
    return out


def main() -> None:
    urls = collect()
    if '--core' in sys.argv:      # 복지서비스 목록(API가 준 링크 600여 개)을 빼고 우리가 직접 적은 링크만
        urls = {u: w for u, w in urls.items() if any('welfare' not in x for x in w)}
    if '--welfare' in sys.argv:   # 반대로 복지 목록만, 복지로(스크립트 렌더라 본문 판정 불가)는 제외
        urls = {u: w for u, w in urls.items() if all('welfare' in x for x in w) and 'bokjiro.go.kr' not in u}
    if '--list' in sys.argv:
        for u, fs in urls.items():
            print(u, '←', ', '.join(fs))
        print(len(urls), '개')
        return
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(check, urls))
    for r in res:
        r['where'] = urls[r['url']]
    day = dt.date.today().strftime('%Y%m%d')
    outdir = os.path.join(ROOT, 'docs', 'link_check')
    os.makedirs(outdir, exist_ok=True)
    tag = 'core' if '--core' in sys.argv else 'welfare' if '--welfare' in sys.argv else 'all'
    json.dump(res, io.open(os.path.join(outdir, f'links_{day}_{tag}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    cnt: dict[str, int] = {}
    for r in res:
        cnt[r['verdict']] = cnt.get(r['verdict'], 0) + 1
    print('점검', len(res), '개 ·', ' · '.join(f'{k} {v}' for k, v in sorted(cnt.items())))
    for r in sorted(res, key=lambda x: (x['verdict'] == 'OK', x['verdict'], x['url'])):
        if r['verdict'] != 'OK':
            print(f"[{r['verdict']}] {r['status'] or '-'} {r['url']}\n      {r['note']} | {r['title']} | → {r['final'] or ''}\n      ← {', '.join(r['where'])}")


if __name__ == '__main__':
    main()
