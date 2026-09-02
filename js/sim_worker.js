/* AidPage Simulator — 격자 경로 탐색 워커 (1단계: 도로가 아닌 H3 격자 위의 방향 시뮬레이션)
   메인 스레드를 막지 않도록 계산 전부를 여기서 한다. 최대 격자는 3,736셀(홍천군)이라
   Dijkstra 2회(짧은 길·위험 피하는 길)에 수십 ms면 끝나지만, 폰에서 지도 렌더와 겹치면 체감이 커서 분리.
   입력 {cells:[{h3,c:[lon,lat],ring:[[lon,lat]...],p:{flood_hist_n,flood_depth_max_m,slope_mean,landslide_hist_n,emd_name}}],
         from:[lon,lat], to:[lon,lat], hazards:[{lon,lat,kind}], scn:{rain:bool,lslide:bool}}
   출력 {ok, d0, start, end, short:{...}, safe:{...}} — 각 경로 = {idx:[셀번호], coords:[[lon,lat]], len_m, walk_min, sum:{...}}
   원칙: 안전 판정이 아니라 "지나는 알려진 위험"만 센다. 데이터가 없는 셀은 위험 0이 아니라 '모름'으로 sum.unknown에 집계. */
const R = 6371000;
function dist(a, b) {
  const dLat = (b[1] - a[1]) * Math.PI / 180, dLon = (b[0] - a[0]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function pip(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
/* 최소 힙 (Dijkstra용) */
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

self.onmessage = e => {
  try { postMessage(run(e.data)); } catch (err) { postMessage({ ok: false, error: String((err && err.message) || err) }); }
};

function run({ cells, from, to, hazards, scn }) {
  const n = cells.length; if (!n) return { ok: false, error: 'nocells' };
  const lat0 = cells[0].c[1], mLat = 111320, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  /* 공간 해시(약 1.1km 버킷) — 이웃 탐색을 O(n²)에서 벗어나게 */
  const B = 0.01, bucket = new Map();
  const bk = (lon, lat) => Math.floor(lon / B) + ':' + Math.floor(lat / B);
  cells.forEach((c, i) => { const k = bk(c.c[0], c.c[1]); const b = bucket.get(k); if (b) b.push(i); else bucket.set(k, [i]); });
  const nearPt = (lon, lat, r, skip = -1) => {
    const dl = r / mLat, dn = r / mLon, out = [];
    for (let x = Math.floor((lon - dn) / B); x <= Math.floor((lon + dn) / B); x++)
      for (let y = Math.floor((lat - dl) / B); y <= Math.floor((lat + dl) / B); y++) {
        const b = bucket.get(x + ':' + y); if (!b) continue;
        for (const j of b) { if (j === skip) continue; const d = dist([lon, lat], cells[j].c); if (d <= r) out.push([j, d]); }
      }
    return out;
  };
  /* 이웃 간격 d0 = 표본 셀의 최근접 중심 거리 중앙값 (res9 ≈ 300m, res8 ≈ 800m). 정육각형 이웃은 d0×1.35 안에 전부 들어온다. */
  const samp = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 200))) { const nb = nearPt(cells[i].c[0], cells[i].c[1], 1500, i); if (nb.length) samp.push(Math.min(...nb.map(x => x[1]))); }
  samp.sort((a, b) => a - b);
  const d0 = samp.length ? samp[samp.length >> 1] : 400;
  const adj = cells.map((c, i) => nearPt(c.c[0], c.c[1], d0 * 1.35, i));

  /* 출발·도착 셀: 폴리곤 안 → 없으면 d0×1.5 안의 최근접 중심 */
  const locate = pt => {
    const cand = nearPt(pt[0], pt[1], d0 * 1.5);
    for (const [j] of cand) if (pip(pt[0], pt[1], cells[j].ring)) return j;
    cand.sort((a, b) => a[1] - b[1]);
    return cand.length ? cand[0][0] : -1;
  };
  const s = locate(from), t = locate(to);
  if (s < 0 || t < 0) return { ok: false, error: 'outside', which: s < 0 ? 'from' : 'to' };

  /* 셀별 위험 지점 근접(150m) — 지하차도·급경사지·산불이력 */
  const hzAt = cells.map(() => []);
  for (const h of hazards || []) for (const [j] of nearPt(h.lon, h.lat, 150)) hzAt[j].push(h.kind);
  /* 위험 점수 — 상황(scn)에 따라 가중. 데이터 없음(null)은 0으로 두되 unknown으로 따로 센다. */
  const W = { flood: scn && scn.rain ? 2.5 : 1.0, slope: scn && scn.lslide ? 2.0 : 0.6, under: scn && scn.rain ? 2.0 : 0.8 };
  const risk = cells.map((c, i) => {
    const p = c.p || {};
    const fh = p.flood_hist_n > 0 ? 1 + Math.min(+p.flood_depth_max_m || 0, 2) : 0;
    const sl = p.slope_mean >= 25 ? 1 : p.slope_mean >= 15 ? 0.5 : 0;
    const ls = p.landslide_hist_n > 0 ? 1 : 0;
    let hz = 0; for (const k of hzAt[i]) hz += k === 'underpass' ? W.under : k === 'steep' ? 1 : k === 'wildfire_hist' ? 0.3 : 0.5;
    let r = W.flood * fh + W.slope * (sl + ls) + hz;
    if (scn && scn.rain && (+p.flood_depth_max_m || 0) >= 0.5) r += 3;   // 호우 중 침수심 0.5m+ 이력 셀은 강하게 회피
    return r;
  });

  const dijkstra = useRisk => {
    const D = new Float64Array(n).fill(Infinity), P = new Int32Array(n).fill(-1), done = new Uint8Array(n), H = new Heap();
    D[s] = 0; H.push(0, s);
    while (H.size) {
      const [d, u] = H.pop(); if (done[u]) continue; done[u] = 1; if (u === t) break;
      for (const [v, w] of adj[u]) {
        const nd = d + w * (useRisk ? 1 + risk[v] : 1);
        if (nd < D[v]) { D[v] = nd; P[v] = u; H.push(nd, v); }
      }
    }
    if (!isFinite(D[t])) return null;
    const idx = []; for (let v = t; v !== -1; v = P[v]) idx.push(v); idx.reverse();
    return idx;
  };
  const describe = idx => {
    const coords = [from, ...idx.map(i => cells[i].c), to];
    let len = 0; for (let i = 1; i < coords.length; i++) len += dist(coords[i - 1], coords[i]);
    if (idx.length === 1) len = dist(from, to);
    const sum = { cells: idx.length, flood: 0, depth: 0, steep: 0, lslide: 0, unknown: 0, hz: {}, risk: 0 };
    const seenHz = new Set();
    for (const i of idx) {
      const p = cells[i].p || {};
      if (p.flood_hist_n > 0) { sum.flood++; sum.depth = Math.max(sum.depth, +p.flood_depth_max_m || 0); }
      if (p.slope_mean >= 15) sum.steep++;
      if (p.landslide_hist_n > 0) sum.lslide++;
      if (p.flood_hist_n == null && p.slope_mean == null) sum.unknown++;
      for (const k of hzAt[i]) { const key = k + '@' + i; if (!seenHz.has(key)) { seenHz.add(key); sum.hz[k] = (sum.hz[k] || 0) + 1; } }
      sum.risk += risk[i];
    }
    sum.risk = Math.round(sum.risk * 10) / 10;
    return { idx, coords, len_m: Math.round(len), walk_min: Math.max(1, Math.round(len / 67)), sum };
  };
  const shortIdx = dijkstra(false); if (!shortIdx) return { ok: false, error: 'noroute' };
  const safeIdx = dijkstra(true) || shortIdx;
  return { ok: true, d0: Math.round(d0), start: s, end: t, short: describe(shortIdx), safe: describe(safeIdx),
           same: shortIdx.length === safeIdx.length && shortIdx.every((v, i) => v === safeIdx[i]) };
}
