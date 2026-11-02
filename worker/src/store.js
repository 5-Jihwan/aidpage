/* Store — 익명 집계 카운터 + 주민 제보를 한 Durable Object(SQLite)에 둔다 (10-15, docs/64 #2·#17).
   왜: KV는 쓰기 한도(무료 1,000/일)가 계정 전체 공유라 집계 요청만으로 제보·푸시·캐시가 멈출 수 있었고(#2),
       제보·신고는 KV 읽기→수정→쓰기라 동시 요청이 서로 덮었다(#17). DO는 요청을 한 줄로 처리하고 SQLite 쓰기 한도가 훨씬 크다.
   과거 KV 값은 그대로 두고 index.js가 조회 때 KV + DO를 더한다(이력 보존). 인스턴스는 'global' 하나. */
import { DurableObject } from 'cloudflare:workers';

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cnt (k TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rep (id TEXT PRIMARY KEY, sgg TEXT NOT NULL, t INTEGER NOT NULL, flags INTEGER NOT NULL DEFAULT 0, ip TEXT, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rep_sgg_t ON rep (sgg, t);
      CREATE TABLE IF NOT EXISTS seen (k TEXT PRIMARY KEY, t INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS repdel (id TEXT PRIMARY KEY, h TEXT NOT NULL, t INTEGER NOT NULL);`);
  }
  inc(keys) {
    for (const k of keys) this.sql.exec('INSERT INTO cnt (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1', k);
    return true;
  }
  get(keys) {
    const out = {};
    for (const k of keys) { const r = this.sql.exec('SELECT n FROM cnt WHERE k = ?', k).toArray()[0]; if (r) out[k] = r.n; }
    return out;
  }
  scan(p) {   // 접두어로 시작하는 카운터 전부 {키: 값}
    const out = {};
    for (const r of this.sql.exec('SELECT k, n FROM cnt WHERE k LIKE ?', p + '%')) out[r.k] = r.n;
    return out;
  }

  /* 제보 추가 — 상한 확인과 저장을 한 번에(원자적). lim = { ttl, perIpDay, perSggDay } (초·건) */
  async addReport(sgg, item, ipHash, lim, delHash) {
    const now = Date.now(), day = Math.floor(now / 86400000);
    this.sql.exec('DELETE FROM rep WHERE t < ?', now - lim.ttl * 1000);
    this.sql.exec('DELETE FROM seen WHERE t < ?', now - lim.ttl * 1000);
    const ipKey = `repip:${ipHash}:${day}`;
    const nIp = (this.sql.exec('SELECT n FROM cnt WHERE k = ?', ipKey).toArray()[0] || { n: 0 }).n;
    if (nIp >= lim.perIpDay) return { status: 'rate_limited' };
    const nSgg = this.sql.exec('SELECT COUNT(*) AS c FROM rep WHERE sgg = ? AND t > ?', sgg, now - 86400000).toArray()[0].c;
    if (nSgg >= lim.perSggDay) return { status: 'rate_limited' };
    this.sql.exec('INSERT INTO rep (id, sgg, t, flags, ip, body) VALUES (?, ?, ?, 0, ?, ?)', item.id, sgg, item.t, ipHash, JSON.stringify(item));
    this.sql.exec('INSERT INTO cnt (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1', ipKey);
    this.sql.exec("DELETE FROM cnt WHERE k LIKE 'repip:%' AND k NOT LIKE ?", `%:${day}`);
    this.sql.exec('INSERT OR REPLACE INTO repdel (id, h, t) VALUES (?, ?, ?)', item.id, delHash, now);
    await this.ctx.storage.put('repTtlMs', lim.ttl * 1000);
    if (await this.ctx.storage.getAlarm() == null) await this.ctx.storage.setAlarm(now + lim.ttl * 1000 + 60000);
    return { status: 'ok' };
  }
  /* 작성자 삭제 — 제보할 때 브라우저에 준 토큰의 해시가 맞아야 지운다 */
  deleteReport(sgg, id, delHash) {
    const r = this.sql.exec('SELECT h FROM repdel WHERE id = ?', id).toArray()[0];
    if (!r || r.h !== delHash) return { status: 'error:403' };
    this.sql.exec('DELETE FROM rep WHERE id = ? AND sgg = ?', id, sgg);
    this.sql.exec('DELETE FROM repdel WHERE id = ?', id);
    this.sql.exec('DELETE FROM seen WHERE k LIKE ?', `flag:${id}:%`);
    return { status: 'ok' };
  }
  /* 7일 삭제를 다음 제보에 맡기지 않는다 — 새 제보가 없으면 해시 IP가 든 행이 남던 문제. 남은 행이 있으면 가장 오래된 행 기준으로 다시 예약 */
  async alarm() {
    const ttl = (await this.ctx.storage.get('repTtlMs')) || 7 * 86400000, now = Date.now(), cut = now - ttl;
    for (const q of ['rep', 'seen', 'repdel']) this.sql.exec(`DELETE FROM ${q} WHERE t < ?`, cut);
    this.sql.exec("DELETE FROM cnt WHERE k LIKE 'repip:%' AND CAST(substr(k, -5) AS INTEGER) < ?", Math.floor(now / 86400000));
    const old = this.sql.exec('SELECT MIN(t) AS t FROM rep').toArray()[0];
    if (old && old.t) await this.ctx.storage.setAlarm(old.t + ttl + 60000);
  }
  flagReport(sgg, id, ipHash, hideAt) {
    const fk = `flag:${id}:${ipHash}`;
    if (this.sql.exec('SELECT 1 FROM seen WHERE k = ?', fk).toArray().length) return { status: 'ok', dup: true };
    const r = this.sql.exec('SELECT flags FROM rep WHERE id = ? AND sgg = ?', id, sgg).toArray()[0];
    if (!r) return { status: 'error:404' };
    this.sql.exec('UPDATE rep SET flags = flags + 1 WHERE id = ?', id);
    this.sql.exec('INSERT INTO seen (k, t) VALUES (?, ?)', fk, Date.now());
    return { status: 'ok', flags: r.flags + 1, hidden: r.flags + 1 >= hideAt };
  }
  listReports(sgg, ttl, hideAt) {
    if (!this._armed) { this._armed = true; this.ctx.storage.getAlarm().then(a => a == null && this.ctx.storage.setAlarm(Date.now() + 60000)); }   // 예약 없던 옛 행도 지우게
    const cut = Date.now() - ttl * 1000;
    return this.sql.exec('SELECT body, flags FROM rep WHERE sgg = ? AND t > ? AND flags < ? ORDER BY t DESC LIMIT 200', sgg, cut, hideAt)
      .toArray().map(r => ({ ...JSON.parse(r.body), flags: r.flags }));
  }
}
