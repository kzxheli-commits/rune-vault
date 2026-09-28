// 端到端测试：3 个 ws 客户端跑完整对局流程
// 用法：node scripts/test-e2e.mjs
import WebSocket from 'ws';
import { pillarPos, RUNES, SEQ_LEN } from '../client/js/shared.js';

const BASE = process.argv[2] || 'ws://127.0.0.1:3000/ws';
let failures = 0;

function check(cond, label) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(BASE);
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.pred(m)) {
          this.waiters.splice(i, 1);
          clearTimeout(w.timer);
          w.res(m);
        }
      }
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 5000, label = 'message') {
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
  close() { this.ws.close(); }
}

// 用线索暴力求解（同时验证线索唯一性）
function solveFromHints(hints) {
  const all = [];
  for (let a = 0; a < RUNES.length; a++)
    for (let b = 0; b < RUNES.length; b++)
      for (let c = 0; c < RUNES.length; c++)
        if (a !== b && b !== c && a !== c) all.push([a, b, c]);
  const test = (h, cand) => {
    if (h.t === 'pos') return cand[h.i] === h.r;
    if (h.t === 'has') return cand.includes(h.r);
    if (h.t === 'no') return !cand.includes(h.r);
    if (h.t === 'before') return cand.indexOf(h.a) < cand.indexOf(h.b);
    return false;
  };
  return all.filter((c) => hints.every((h) => test(h, c)));
}

async function main() {
  console.log('== 连接与大厅 ==');
  const clients = [new Client('c1'), new Client('c2'), new Client('c3')];
  const [c1, c2, c3] = clients;
  await Promise.all(clients.map((c) => c.ready));
  check(true, '三个客户端均连接');

  c1.send({ t: 'create', name: 'Alice' });
  const joined = await c1.wait((m) => m.t === 'joined', 4000, 'joined');
  check(/^[A-Z2-9]{4}$/.test(joined.code), `房间码格式 ${joined.code}`);
  const code = joined.code;

  c2.send({ t: 'join', name: 'Bob', code });
  await c2.wait((m) => m.t === 'joined');
  c3.send({ t: 'join', name: 'Carol', code });
  await c3.wait((m) => m.t === 'joined');
  const lobby = await c1.wait((m) => m.t === 'lobby' && m.players.length === 3, 4000, '3人lobby');
  check(lobby.players.length === 3, '三名玩家入厅');

  const c4 = new Client('c4');
  await c4.ready;
  c4.send({ t: 'join', name: 'X', code: 'ZZZZ' });
  const err = await c4.wait((m) => m.t === 'error');
  check(/不存在/.test(err.text), '错误房间码被拒绝');
  c4.close();

  console.log('== 开局与身份 ==');
  clients.forEach((c) => c.clear());
  c1.send({ t: 'start' });
  const rounds = await Promise.all(
    clients.map((c, i) => c.wait((m) => m.t === 'roundStart', 5000, `roundStart ${i}`))
  );
  check(rounds.every((r) => r.round === 1), '三端同时进入第 1 局');
  const roles = rounds.map((r) => r.role);
  check(roles.filter((r) => r === 'saboteur').length === 1, '3 人局产生 1 名干扰者');
  check(roles.filter((r) => r === 'solver').length === 2, '2 名解谜者');

  const solvers = rounds.filter((r) => r.role === 'solver');
  check(solvers.every((r) => r.answer === null), '解谜者收不到答案');
  check(solvers.every((r) => r.players.every((p) => p.role === 'hidden' || p.id === r.you)),
    '他人身份对解谜者保密');
  const sabRound = rounds.find((r) => r.role === 'saboteur');
  check(Array.isArray(sabRound.answer) && sabRound.answer.length === SEQ_LEN, '干扰者收到完整答案');

  console.log('== 线索可解性 ==');
  check(solvers.every((r) => r.hints.length >= 1), '每名解谜者至少拿到 1 条线索');
  const solvedSets = solvers.map((r) => solveFromHints(r.hints));
  check(solvedSets.every((s) => s.length >= 1),
    `每人线索均不矛盾（${solvedSets.map((s) => s.length).join(' / ')} 解，需交流互补）`);
  const merged = solveFromHints([...solvers[0].hints, ...solvers[1].hints]);
  check(merged.length === 1, `合并线索唯一（${merged.length} 解）`);
  check(merged.length === 1 && merged[0].every((v, i) => v === sabRound.answer[i]),
    '线索推出的答案 == 干扰者答案');

  // 找到一个解谜者客户端（rounds 与 clients 索引对应）
  const solverIdx = rounds.findIndex((r) => r.role === 'solver');
  const pc = clients[solverIdx];
  const answer = sabRound.answer;

  console.log('== 位置校验 ==');
  // 取该柱的对径点（半径 9），确保远离目标符文柱
  const far = pillarPos(answer[0]);
  const fl = Math.hypot(far.x, far.z);
  pc.send({ t: 'pos', x: (-far.x / fl) * 9, z: (-far.z / fl) * 9, yaw: 0 });
  pc.send({ t: 'rune', idx: answer[0] });
  const denied = await pc.wait((m) => m.t === 'toast' && /太远/.test(m.text), 4000, '远程拒绝');
  check(true, `远程刻印被拒绝：${denied.text}`);

  console.log('== 错误答案路径 ==');
  const wrongSeq = answer.map((v) => (v + 1) % RUNES.length);
  for (const idx of wrongSeq) {
    const p = pillarPos(idx);
    pc.send({ t: 'pos', x: p.x, z: p.z, yaw: 0 });
    pc.send({ t: 'rune', idx });
    await pc.wait((m) => m.t === 'mybuf' && m.buf.includes(idx), 4000, `刻印 ${idx}`);
  }
  check(true, '三枚（错误）符文刻印成功');
  // 未到祭坛直接提交 → 拒绝
  pc.send({ t: 'submit' });
  const noAltar = await pc.wait((m) => m.t === 'toast' && /祭坛/.test(m.text), 4000, '祭坛校验');
  check(true, `离祭坛提交被拒绝：${noAltar.text}`);
  // 到祭坛提交错误答案
  pc.send({ t: 'pos', x: 0, z: 1.0, yaw: 0 });
  pc.send({ t: 'submit' });
  const wrongFeed = await c3.wait((m) => m.t === 'feed' && m.kind === 'wrong', 5000, '错误feed');
  check(/失败/.test(wrongFeed.text), `错误答案公开播报：${wrongFeed.text}`);
  const lockMsg = await pc.wait(
    (m) => m.t === 'mybuf' && m.lockUntil > 0 && m.buf.length === 0, 4000, '冷却'
  );
  check(lockMsg.lockUntil - Date.now() > 3000, '答错进入 5 秒冷却并清空刻印槽');

  pc.clear();
  pc.send({ t: 'rune', idx: answer[0] });
  const cool = await pc.wait((m) => m.t === 'toast' && /冷却/.test(m.text), 4000, '冷却拒绝');
  check(true, `冷却期刻印被拒：${cool.text}`);

  console.log('== 等待冷却结束 ==');
  await sleep(5300);
  pc.clear();
  clients.forEach((c) => c.clear());

  console.log('== 正确答案路径 ==');
  for (const idx of answer) {
    const p = pillarPos(idx);
    pc.send({ t: 'pos', x: p.x, z: p.z, yaw: 0 });
    pc.send({ t: 'rune', idx });
    await pc.wait((m) => m.t === 'mybuf' && m.buf.includes(idx), 4000, `刻印 ${idx}`);
  }
  check(true, '三枚正确符文刻印成功');
  pc.send({ t: 'submit' });
  const reject2 = await pc.wait((m) => m.t === 'toast' && /祭坛/.test(m.text), 4000, '祭坛2');
  check(true, `站柱上提交仍被拒绝：${reject2.text}`);
  pc.send({ t: 'pos', x: 0, z: 1.0, yaw: 0 });
  pc.send({ t: 'submit' });
  const end = await pc.wait((m) => m.t === 'roundEnd', 6000, 'roundEnd');
  check(end.reason === 'solve', `正确答案结束本局 (${end.reason})`);
  const winnerScore = end.scores.find((s) => s.id === end.winnerId);
  check(winnerScore.score === 3, `破解者 +3 分 (${winnerScore.score})`);
  const otherSolver = end.scores.find((s) => s.role === 'solver' && s.id !== end.winnerId);
  check(otherSolver.score === 1, `队友 +1 分 (${otherSolver.score})`);
  const sabScore = end.scores.find((s) => s.role === 'saboteur');
  check(sabScore.score === 0, `干扰者本局 0 分 (${sabScore.score})`);
  check(end.scores.every((s) => s.role), '局末揭示所有人身份');

  console.log('== 聊天 ==');
  c2.send({ t: 'chat', text: '第一条线索是红色的' });
  const chat = await c3.wait((m) => m.t === 'chat', 4000, 'chat');
  check(chat.from === 'Bob' && /红色/.test(chat.text), `聊天广播 ${chat.from}: ${chat.text}`);

  console.log('== 第 2 局自动开始 ==');
  const r2 = await pc.wait((m) => m.t === 'roundStart' && m.round === 2, 12000, 'roundStart 2');
  check(r2.round === 2, '局末 7 秒后自动进入第 2 局');

  console.log('== 位置快照 ==');
  pc.send({ t: 'pos', x: 2, z: 3, yaw: 1 });
  const snap = await pc.wait(
    (m) => m.t === 'snapshot' && m.players.some((p) => Math.abs(p.x - 2) < 0.01),
    4000, 'snapshot'
  );
  check(snap.players.length === 3, '快照包含 3 名玩家且位置已同步');

  console.log('== 断线处理 ==');
  c3.close();
  const lobbyAfter = await c1.wait(
    (m) => m.t === 'lobby' && m.players.length === 2, 5000, '断线后lobby'
  );
  check(lobbyAfter.players.length === 2, '玩家断线后名单更新');

  c1.close(); c2.close();
  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试异常:', e.message);
  process.exit(1);
});
