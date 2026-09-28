// 房间与对局逻辑（权威服务端）
import {
  RUNES, ARENA_RADIUS, SEQ_LEN, ROUND_MS, WRONG_LOCK_MS,
  ROUND_END_PAUSE_MS, TARGET_SCORE, pillarPos,
} from '../client/js/shared.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 6;
const CHAT_MAX_LEN = 200;

const rndInt = (n) => Math.floor(Math.random() * n);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function genRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_CODE_CHARS[rndInt(ROOM_CODE_CHARS.length)];
  return s;
}

function allCandidates() {
  const out = [];
  for (let a = 0; a < RUNES.length; a++)
    for (let b = 0; b < RUNES.length; b++)
      for (let c = 0; c < RUNES.length; c++)
        if (a !== b && b !== c && a !== c) out.push([a, b, c]);
  return out;
}

function testHint(h, cand) {
  if (h.t === 'pos') return cand[h.i] === h.r;
  if (h.t === 'has') return cand.includes(h.r);
  if (h.t === 'no') return !cand.includes(h.r);
  if (h.t === 'before') return cand.indexOf(h.a) < cand.indexOf(h.b);
  return false;
}

// 生成能唯一确定答案、且分布到各解谜者手中的线索
function genHints(answer, solverCount) {
  let cands = allCandidates();
  const perPlayer = Array.from({ length: solverCount }, () => []);
  const used = new Set();
  let cursor = 0;
  const push = (h) => {
    const key = JSON.stringify(h);
    if (used.has(key)) return false;
    used.add(key);
    perPlayer[cursor % solverCount].push(h);
    cursor++;
    return true;
  };

  // 先放一条精确线索，快速剪枝
  const i0 = rndInt(SEQ_LEN);
  const seed = { t: 'pos', i: i0, r: answer[i0] };
  cands = cands.filter((c) => testHint(seed, c));
  push(seed);

  let guard = 0;
  while (cands.length > 1 && guard++ < 80) {
    const options = [];
    // 关键：候选线索必须同时与真答案一致，否则会把答案排除掉
    const consider = (h) => {
      if (!testHint(h, answer)) return;
      const n = cands.filter((c) => testHint(h, c)).length;
      if (n > 0 && n < cands.length) options.push({ h, n });
    };
    for (let i = 0; i < SEQ_LEN; i++) {
      for (let r = 0; r < RUNES.length; r++) consider({ t: 'pos', i, r });
    }
    for (let r = 0; r < RUNES.length; r++) {
      consider({ t: 'has', r });
      consider({ t: 'no', r });
    }
    for (let a = 0; a < RUNES.length; a++) {
      for (let b = 0; b < RUNES.length; b++) {
        if (a === b) continue;
        consider({ t: 'before', a, b });
      }
    }
    if (!options.length) break;
    // 选最接近折半的线索（信息量最大）
    options.sort((x, y) => Math.abs(x.n - cands.length / 2) - Math.abs(y.n - cands.length / 2));
    const pick = options[rndInt(Math.min(3, options.length))];
    if (!push(pick.h)) break;
    cands = cands.filter((c) => testHint(pick.h, c));
  }

  // 兜底：直接补精确线索
  if (cands.length > 1) {
    for (let i = 0; i < SEQ_LEN && cands.length > 1; i++) {
      if (!cands.every((c) => c[i] === answer[i])) {
        push({ t: 'pos', i, r: answer[i] });
        cands = cands.filter((c) => testHint({ t: 'pos', i, r: answer[i] }, c));
      }
    }
  }

  // 每人至少一条线索（保证没有人两手空空）
  for (let i = 0; i < perPlayer.length; i++) {
    if (perPlayer[i].length === 0) {
      const h = { t: 'pos', i: i % SEQ_LEN, r: answer[i % SEQ_LEN] };
      if (!used.has(JSON.stringify(h))) perPlayer[i].push(h);
      else perPlayer[i].push({ t: 'has', r: answer[i % SEQ_LEN] });
    }
  }
  return perPlayer;
}

class Player {
  constructor(id, name, ws) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.score = 0;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.buffer = [];       // 已刻印的符文 id
    this.lockUntil = 0;     // 禁刻截止
    this.role = 'solver';   // solver | saboteur
    this.hints = [];
    this.lastChatAt = 0;
  }
  send(msg) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}

class Room {
  constructor(code, hub) {
    this.code = code;
    this.hub = hub;
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby'; // lobby | playing | roundEnd | matchEnd
    this.round = 0;
    this.secret = null;
    this.deadline = 0;
    this.endTimer = null;
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, host: p.id === this.hostId, score: p.score,
    }));
  }

  broadcast(msg) {
    for (const p of this.players.values()) p.send(msg);
  }

  join(ws, name, playerId) {
    if (this.state !== 'lobby') return { error: '对局进行中，稍后再加入' };
    if (this.players.size >= MAX_PLAYERS) return { error: '房间已满' };
    const p = new Player(playerId, name, ws);
    const a = Math.random() * Math.PI * 2;
    p.x = Math.cos(a) * 3;
    p.z = Math.sin(a) * 3;
    if (!this.hostId) this.hostId = p.id;
    this.players.set(p.id, p);
    this.broadcast({ t: 'lobby', players: this.roster(), state: this.state, code: this.code });
    return { player: p };
  }

  remove(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    if (this.players.size === 0) {
      if (this.endTimer) clearTimeout(this.endTimer);
      this.hub.rooms.delete(this.code);
      return;
    }
    if (this.hostId === playerId) this.hostId = [...this.players.keys()][0];
    this.broadcast({ t: 'lobby', players: this.roster(), state: this.state, code: this.code });
    if (this.state === 'playing') {
      const solversAlive = [...this.players.values()].some((q) => q.role === 'solver');
      if (!solversAlive) this.endRound('abort', null);
    }
  }

  startMatch() {
    if (this.state !== 'lobby' && this.state !== 'matchEnd') return { error: '当前状态无法开始' };
    if (this.players.size < 2) return { error: '至少需要 2 名玩家' };
    for (const p of this.players.values()) p.score = 0;
    this.round = 0;
    this.broadcast({ t: 'lobby', players: this.roster(), state: 'lobby', code: this.code });
    this.startRound();
  }

  startRound() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    this.round++;
    this.state = 'playing';

    const ids = shuffle([...this.players.keys()]);
    const useSaboteur = this.players.size >= 3;
    const saboteurId = useSaboteur ? ids[0] : null;
    const solverIds = ids.filter((id) => id !== saboteurId);

    this.secret = shuffle([...Array(RUNES.length).keys()])
      .slice(0, SEQ_LEN);
    const hintMap = genHints(this.secret, solverIds.length);
    solverIds.forEach((id, i) => {
      const p = this.players.get(id);
      p.role = 'solver';
      p.hints = hintMap[i];
    });
    if (saboteurId) {
      const p = this.players.get(saboteurId);
      p.role = 'saboteur';
      p.hints = [];
    }

    const now = Date.now();
    this.deadline = now + this.hub.roundMs;
    for (const p of this.players.values()) { p.buffer = []; p.lockUntil = 0; }

    for (const p of this.players.values()) {
      p.send({
        t: 'roundStart',
        round: this.round,
        deadline: this.deadline,
        role: p.role,
        hints: p.hints,
        answer: p.role === 'saboteur' ? this.secret : null,
        players: this.roster().map((r) => ({
          ...r,
          role: r.id === p.id ? p.role : 'hidden',
        })),
        you: p.id,
      });
    }
    this.broadcast({ t: 'feed', kind: 'system', text: `第 ${this.round} 局开始` });
  }

  handleRune(playerId, idx) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'playing') return;
    const reject = (text) => {
      p.send({ t: 'toast', text });
      p.send({ t: 'mybuf', buf: p.buffer, lockUntil: p.lockUntil });
    };
    if (Date.now() < p.lockUntil) {
      return reject(`冷却中，${Math.ceil((p.lockUntil - Date.now()) / 1000)} 秒后可刻印`);
    }
    if (idx < 0 || idx >= RUNES.length) return;
    // 位置校验：必须站在符文柱附近
    const pp = pillarPos(idx);
    if (Math.hypot(p.x - pp.x, p.z - pp.z) > 3.3) return reject('离符文柱太远');
    if (p.buffer.includes(idx)) return reject('该符文已刻印');
    if (p.buffer.length >= SEQ_LEN) return reject('刻印槽已满，请先验证');
    p.buffer.push(idx);
    p.send({ t: 'mybuf', buf: p.buffer, lockUntil: p.lockUntil });
  }

  handleSubmit(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'playing') return;
    const reject = (text) => {
      p.send({ t: 'toast', text });
      p.send({ t: 'mybuf', buf: p.buffer, lockUntil: p.lockUntil });
    };
    if (Date.now() < p.lockUntil) return reject('冷却中，稍候再验证');
    // 位置校验：必须站在中央祭坛附近
    if (Math.hypot(p.x, p.z) > 2.7) return reject('请走到中央祭坛再验证');
    if (p.buffer.length < SEQ_LEN) return reject(`需要刻满 ${SEQ_LEN} 个符文`);
    const correct = p.buffer.every((v, i) => v === this.secret[i]);
    const seqText = p.buffer.map((v) => RUNES[v].glyph).join(' ');
    if (correct) {
      this.broadcast({ t: 'feed', kind: 'success', text: `${p.name} 破解了符文序列！` });
      this.endRound('solve', p.id);
    } else {
      p.buffer = [];
      p.lockUntil = Date.now() + WRONG_LOCK_MS;
      p.send({ t: 'mybuf', buf: p.buffer, lockUntil: p.lockUntil });
      this.broadcast({ t: 'feed', kind: 'wrong', text: `${p.name} 验证 ${seqText} —— 失败` });
    }
  }

  endRound(reason, winnerId) {
    if (this.state !== 'playing') return;
    this.state = 'roundEnd';
    if (this.endTimer) clearTimeout(this.endTimer);

    if (reason === 'solve' && winnerId) {
      for (const p of this.players.values()) {
        if (p.id === winnerId) p.score += 3;
        else if (p.role === 'solver') p.score += 1;
      }
    } else if (reason === 'timeout') {
      for (const p of this.players.values()) {
        if (p.role === 'saboteur') p.score += 3;
      }
    }

    const scores = this.roster().map((r) => ({ ...r, role: this.players.get(r.id).role }));
    const champion = scores.find((s) => s.score >= this.hub.targetScore);
    this.broadcast({
      t: 'roundEnd',
      reason,
      answer: this.secret,
      winnerId,
      scores,
      nextInMs: champion ? 0 : this.hub.roundEndPauseMs,
    });

    if (champion) {
      this.state = 'matchEnd';
      this.broadcast({ t: 'matchEnd', winnerId: champion.id, scores });
      return;
    }    this.endTimer = setTimeout(() => this.startRound(), this.hub.roundEndPauseMs);
  }

  handleChat(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastChatAt < 300) return;
    p.lastChatAt = now;
    const clean = String(text).slice(0, CHAT_MAX_LEN).trim();
    if (!clean) return;
    this.broadcast({ t: 'chat', from: p.name, id: p.id, text: clean });
  }

  handlePos(playerId, x, z, yaw) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'playing') return;
    const r = Math.hypot(x, z);
    let nx = x, nz = z;
    if (r > ARENA_RADIUS) { nx = (x / r) * ARENA_RADIUS; nz = (z / r) * ARENA_RADIUS; }
    p.x = nx; p.z = nz;
    if (typeof yaw === 'number') p.yaw = yaw;
  }

  snapshot() {
    return [...this.players.values()].map((p) => ({ id: p.id, x: p.x, z: p.z, yaw: p.yaw }));
  }

  tick(now) {
    if (this.state === 'playing' && now >= this.deadline) {
      this.broadcast({ t: 'feed', kind: 'warn', text: '时间到——干扰者得分' });
      this.endRound('timeout', null);
    }
  }
}

export class Hub {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.players = new Map(); // id -> {room, player}
    this.roundMs = opts.roundMs || ROUND_MS;
    this.roundEndPauseMs = opts.roundEndPauseMs || ROUND_END_PAUSE_MS;
    this.targetScore = opts.targetScore || TARGET_SCORE;
    this.idSeq = 1;
  }

  send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

  handle(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'create' || msg.t === 'join') {
      const name = String(msg.name || '玩家').slice(0, 16).trim() || '玩家';
      let room = null;
      if (msg.t === 'create') {
        do { room = genRoomCode(); } while (this.rooms.has(room));
        this.rooms.set(room, new Room(room, this));
      } else {
        room = String(msg.code || '').toUpperCase().trim();
        if (!this.rooms.has(room)) return this.send(ws, { t: 'error', text: '房间不存在' });
      }
      const target = this.rooms.get(room);
      const id = 'p' + (this.idSeq++);
      const res = target.join(ws, name, id);
      if (res.error) return this.send(ws, { t: 'error', text: res.error });
      const entry = { room: target, player: res.player };
      ws.__entry = entry;                       // 连接级绑定，后续消息免带 id
      this.players.set(id, entry);
      this.send(ws, {
        t: 'joined', code: target.code, id, you: { name },
        players: target.roster(), state: target.state,
        config: { roundMs: this.roundMs, targetScore: this.targetScore, seqLen: SEQ_LEN },
      });
      return;
    }

    const entry = this.players.get(msg.id) || ws.__entry;
    if (!entry) return;
    const { room, player } = entry;

    switch (msg.t) {
      case 'start': {
        if (player.id !== room.hostId) return this.send(ws, { t: 'toast', text: '只有房主可以开始' });
        const r = room.startMatch();
        if (r && r.error) this.send(ws, { t: 'toast', text: r.error });
        break;
      }
      case 'rune': room.handleRune(player.id, msg.idx | 0); break;
      case 'submit': room.handleSubmit(player.id); break;
      case 'pos': room.handlePos(player.id, +msg.x || 0, +msg.z || 0, +msg.yaw || 0); break;
      case 'chat': room.handleChat(player.id, msg.text); break;
      case 'ping': this.send(ws, { t: 'pong', now: Date.now() }); break;
      default: break;
    }
  }

  disconnect(ws) {
    const entry = ws.__entry;
    if (!entry) return;
    ws.__entry = null;
    this.players.delete(entry.player.id);
    entry.room.remove(entry.player.id);
  }

  tick(now) {
    for (const room of this.rooms.values()) room.tick(now);
  }

  snapshotAll(now) {
    for (const room of this.rooms.values()) {
      if (room.state !== 'playing') continue;
      room.broadcast({ t: 'snapshot', players: room.snapshot(), deadline: room.deadline });
    }
  }
}
