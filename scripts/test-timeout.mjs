// 超时与比赛结束路径测试（配合短 ROUND_MS 的服务器实例）
// 用法：ROUND_MS=5000 ROUND_END_PAUSE_MS=2000 TARGET_SCORE=3 node server/index.js &
//       node scripts/test-timeout.mjs [wsUrl]
import WebSocket from 'ws';

const BASE = process.argv[2] || 'ws://127.0.0.1:3001/ws';
let failures = 0;
const check = (c, l) => { if (c) console.log(`  PASS  ${l}`); else { failures++; console.log(`  FAIL  ${l}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name; this.msgs = []; this.waiters = [];
    this.ws = new WebSocket(BASE);
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.pred(m)) { this.waiters.splice(i, 1); clearTimeout(w.timer); w.res(m); }
      }
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 10000, label = 'msg') {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { pred, res };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        rej(new Error(`${this.name} 超时等待 ${label}`));
      }, ms);
      this.waiters.push(w);
    });
  }
  clear() { this.msgs.length = 0; }
}

async function main() {
  console.log('== 超时与 matchEnd ==');
  const cs = [new Client('a'), new Client('b'), new Client('c')];
  await Promise.all(cs.map((c) => c.ready));
  cs[0].send({ t: 'create', name: '甲' });
  const j = await cs[0].wait((m) => m.t === 'joined');
  cs[1].send({ t: 'join', name: '乙', code: j.code });
  await cs[1].wait((m) => m.t === 'joined');
  cs[2].send({ t: 'join', name: '丙', code: j.code });
  await cs[2].wait((m) => m.t === 'joined');
  await cs[0].wait((m) => m.t === 'lobby' && m.players.length === 3);

  cs.forEach((c) => c.clear());
  cs[0].send({ t: 'start' });
  const rounds = await Promise.all(cs.map((c) => c.wait((m) => m.t === 'roundStart', 5000, 'roundStart')));
  check(rounds.every((r) => r.deadline - Date.now() > 3000), '回合时长来自服务端配置');

  // 不做任何操作，等待超时
  const ends = await Promise.all(cs.map((c) => c.wait((m) => m.t === 'roundEnd', 12000, 'roundEnd')));
  check(ends.every((e) => e.reason === 'timeout'), `超时判负 (${ends[0].reason})`);
  const sab = ends[0].scores.find((s) => s.role === 'saboteur');
  check(sab.score === 3, `超时干扰者 +3 分 (${sab.score})`);
  check(ends[0].nextInMs === 0 || ends[0].nextInMs > 0, `nextInMs=${ends[0].nextInMs}`);

  // 目标分 3 → 直接 matchEnd
  const match = await cs[0].wait((m) => m.t === 'matchEnd', 6000, 'matchEnd');
  check(match.winnerId === sab.id, '干扰者赢得整场比赛');
  check(match.scores.every((s) => s.role), 'matchEnd 携带身份');

  console.log(failures === 0 ? '\nTIMEOUT TESTS PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('测试异常:', e.message); process.exit(1); });
