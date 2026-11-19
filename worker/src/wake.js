/* 실시간 수집 깨우기 — GitHub 예약 실행(live.yml cron)이 하루 3~5회만 돌아(11-19 실행 기록) 워커 예약이 대신 깨운다.
   10분마다 불리고, 평시엔 정시·30분 슬롯에만, 경보 중(data/live/.hot 있음)에는 매번 workflow_dispatch를 보낸다.
   env.GH_DISPATCH_TOKEN(aidpage 저장소 Actions 쓰기 권한만 가진 fine-grained 토큰)이 없으면 아무것도 하지 않는다. */
const REPO = '5-Jihwan/aidpage';
const GH = 'https://api.github.com/repos/' + REPO;

export async function wakeLive(env, now = new Date(), fetchFn = fetch) {
  const token = env.GH_DISPATCH_TOKEN;
  if (!token) return 'no_token';
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'aidpage-worker', 'X-GitHub-Api-Version': '2022-11-28' };
  if (now.getUTCMinutes() % 30 >= 10) {   // 슬롯 밖: 경보 중일 때만 깨운다(live.yml의 Gate와 같은 규칙)
    const hot = await fetchFn(GH + '/contents/data/live/.hot?ref=main', { headers });
    if (hot.status !== 200) return 'off_slot';
  }
  const r = await fetchFn(GH + '/actions/workflows/live.yml/dispatches', { method: 'POST', headers, body: JSON.stringify({ ref: 'main' }) });
  return r.status === 204 ? 'dispatched' : 'error:' + r.status;
}
