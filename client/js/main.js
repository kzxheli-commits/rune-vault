// 客户端主控：网络、状态机、HUD
import { RUNES, PLAYER_COLORS, SEQ_LEN } from './shared.js';
import { World } from './world.js';
import { Controls } from './controls.js';

const $ = (id) => document.getElementById(id);

const ui = {
  lobby: $('screen-lobby'), joinBox: $('lobby-join'), roomBox: $('lobby-room'),
  inpName: $('inp-name'), inpCode: $('inp-code'),
  btnCreate: $('btn-create'), btnJoin: $('btn-join'), btnStart: $('btn-start'),
  lobbyCode: $('lobby-code'), lobbyPlayers: $('lobby-players'),
  lobbyTip: $('lobby-tip'), lobbyError: $('lobby-error'),
  hud: $('hud'), timer: $('timer'), timerFill: $('timer-fill'), timerText: $('timer-text'),
  roundInfo: $('round-info'), roleTitle: $('role-title'), hints: $('hints'),
  scoreboard: $('scoreboard'), feed: $('feed'), prompt: $('prompt'),
  bufSlots: [...document.querySelectorAll('.buf-slot')], btnSubmit: $('btn-submit'),
  lockBadge: $('lock-badge'),
  chatLog: $('chat-log'), chatInput: $('chat-input'),
  overlay: $('overlay'), oTitle: $('overlay-title'), oSub: $('overlay-sub'),
  oAnswer: $('overlay-answer'), oScores: $('overlay-scores'), oNext: $('overlay-next'),
  btnRematch: $('btn-rematch'),
  toast: $('toast'),
};

const world = new World($('game-canvas'));
const controls = new Controls(world.camera, $('game-canvas'), onInteract);

// ===== 状态 =====
let ws = null;
let myId = null;
let roomCode = '';
let roster = [];          // [{id,name,host,score,role?}]
let phase = 'menu';       // menu | lobby | playing | roundEnd | matchEnd
let deadline = 0;
let roundNo = 0;
let myRole = 'solver';
let myHints = [];
let myAnswer = null;
let myBuf = [];
let lockUntil = 0;
let nextTimer = null;
let toastTimer = null;
let roundMs = 90000;

function colorOf(id) {
  const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  return PLAYER_COLORS[n % PLAYER_COLORS.length];
}

function toast(text) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 1800);
}

function addFeed(kind, text) {
  const el = document.createElement('div');
  el.className = `f-item ${kind}`;
  el.textContent = text;
  ui.feed.appendChild(el);
  while (ui.feed.children.length > 5) ui.feed.firstChild.remove();
  setTimeout(() => { if (el.parentNode) el.remove(); }, 9000);
}

function addChat(from, text, sys = false) {
  const el = document.createElement('div');
  el.className = 'c-item' + (sys ? ' sys' : '');
  if (sys) el.textContent = text;
  else {
    const w = document.createElement('span');
    w.className = 'who';
    w.textContent = from + '：';
    el.append(w, document.createTextNode(text));
  }
  ui.chatLog.appendChild(el);
  while (ui.chatLog.children.length > 40) ui.chatLog.firstChild.remove();
  ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ===== 大厅 =====
function renderLobby() {
  ui.lobbyCode.textContent = roomCode;
  ui.lobbyPlayers.innerHTML = '';
  for (const p of roster) {
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.textContent = p.name;
    li.appendChild(nm);
    if (p.host) {
      const h = document.createElement('span');
      h.className = 'host';
      h.textContent = '房主';
      li.appendChild(h);
    }
    ui.lobbyPlayers.appendChild(li);
  }
  const isHost = roster.find((p) => p.id === myId)?.host;
  ui.btnStart.hidden = !isHost;
  ui.btnStart.disabled = roster.length < 2;
  ui.lobbyTip.textContent = roster.length < 2
    ? '等待玩家加入…（至少 2 人）'
    : isHost ? '玩家到齐，点击开始' : '等待房主开始';
}

// ===== HUD =====
function renderBuf() {
  ui.bufSlots.forEach((slot, i) => {
    const rune = RUNES[myBuf[i]];
    if (rune) {
      slot.textContent = rune.glyph;
      slot.style.color = rune.color;
      slot.style.borderColor = rune.color;
      slot.style.boxShadow = `0 0 14px ${rune.color}66`;
      slot.classList.add('filled');
    } else {
      slot.textContent = '';
      slot.style.borderColor = '';
      slot.style.boxShadow = '';
      slot.classList.remove('filled');
    }
  });
}

function renderRoleCard() {
  ui.hints.innerHTML = '';
  if (myRole === 'saboteur') {
    ui.roleTitle.textContent = '干扰者';
    ui.roleTitle.className = 'saboteur';
    const li = document.createElement('li');
    li.className = 'secret';
    li.textContent = '你已知晓答案：' + myAnswer.map((i) => RUNES[i].glyph).join(' ');
    ui.hints.appendChild(li);
    const li2 = document.createElement('li');
    li2.textContent = '误导解谜者，拖到超时即可得分';
    li2.style.borderLeftColor = 'var(--pink)';
    li2.style.background = 'rgba(244,114,182,0.06)';
    ui.hints.appendChild(li2);
  } else {
    ui.roleTitle.textContent = '解谜者';
    ui.roleTitle.className = 'solver';
    for (const h of myHints) {
      const li = document.createElement('li');
      li.textContent = hintText(h);
      ui.hints.appendChild(li);
    }
  }
}

function hintText(h) {
  if (h.t === 'pos') return `第 ${h.i + 1} 位是 ${RUNES[h.r].glyph}`;
  if (h.t === 'has') return `序列包含 ${RUNES[h.r].glyph}`;
  if (h.t === 'no') return `序列不含 ${RUNES[h.r].glyph}`;
  if (h.t === 'before') return `${RUNES[h.a].glyph} 排在 ${RUNES[h.b].glyph} 之前`;
  return '';
}

function renderScoreboard(scores = roster) {
  ui.scoreboard.innerHTML = '';
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const row = document.createElement('div');
    row.className = 'sb-row';
    const nm = document.createElement('span');
    nm.className = 'nm';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorOf(p.id);
    nm.append(dot, document.createTextNode(p.name + (p.id === myId ? '（你）' : '')));
    const sc = document.createElement('span');
    sc.className = 'sc';
    sc.textContent = p.score;
    row.append(nm, sc);
    ui.scoreboard.appendChild(row);
  }
}

// ===== 局末 =====
function showRoundEnd(msg) {
  phase = 'roundEnd';
  controls.setEnabled(false);
  if (document.pointerLockElement) document.exitPointerLock();
  ui.prompt.hidden = true;
  ui.lockBadge.hidden = true;
  clearInterval(nextTimer);

  const solved = msg.reason === 'solve';
  const winner = msg.winnerId ? roster.find((p) => p.id === msg.winnerId) : null;
  ui.oTitle.textContent = solved ? '破解成功' : (msg.reason === 'timeout' ? '超时——干扰者得逞' : '解谜者退出，本局终止');
  ui.oTitle.className = solved ? 'win' : 'lose';
  const iAmSolver = myRole === 'solver';
  if (solved) {
    ui.oSub.textContent = `${winner ? winner.name : ''} 提交了正确序列 · 你本局身份：${iAmSolver ? '解谜者' : '干扰者'}`;
  } else {
    ui.oSub.textContent = `本局答案揭晓 · 你本局身份：${iAmSolver ? '解谜者' : '干扰者'}`;
  }

  ui.oAnswer.innerHTML = '';
  for (const idx of msg.answer) {
    const d = document.createElement('div');
    d.className = 'a-rune';
    d.textContent = RUNES[idx].glyph;
    d.style.color = RUNES[idx].color;
    ui.oAnswer.appendChild(d);
  }

  roster = msg.scores;
  renderScoreboard(msg.scores);
  ui.oScores.innerHTML = '';
  for (const p of [...msg.scores].sort((a, b) => b.score - a.score)) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = p.name;
    if (p.role) {
      const tag = document.createElement('span');
      tag.className = 'role-tag';
      tag.textContent = p.role === 'saboteur' ? '干扰者' : '解谜者';
      left.appendChild(tag);
    }
    const right = document.createElement('span');
    right.textContent = `${p.score} 分`;
    li.append(left, right);
    ui.oScores.appendChild(li);
  }

  ui.btnRematch.hidden = true;
  ui.oNext.hidden = false;
  if (msg.nextInMs > 0) {
    let left = Math.ceil(msg.nextInMs / 1000);
    ui.oNext.textContent = `${left} 秒后进入下一局…`;
    nextTimer = setInterval(() => {
      left--;
      ui.oNext.textContent = left > 0 ? `${left} 秒后进入下一局…` : '即将开始…';
      if (left <= 0) clearInterval(nextTimer);
    }, 1000);
  } else {
    ui.oNext.textContent = '本场目标分数已达成';
  }
  ui.overlay.hidden = false;
}

function showMatchEnd(msg) {
  phase = 'matchEnd';
  clearInterval(nextTimer);
  roster = msg.scores;
  renderScoreboard(msg.scores);
  const champ = msg.scores.find((p) => p.id === msg.winnerId);
  ui.oTitle.textContent = '比赛结束';
  ui.oTitle.className = 'win';
  ui.oSub.textContent = `${champ ? champ.name : ''} 率先达到目标分数，赢得整场比赛`;
  ui.oScores.innerHTML = '';
  for (const p of [...msg.scores].sort((a, b) => b.score - a.score)) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = p.name;
    const right = document.createElement('span');
    right.textContent = `${p.score} 分`;
    li.append(left, right);
    ui.oScores.appendChild(li);
  }
  const isHost = roster.find((p) => p.id === myId)?.host;
  ui.btnRematch.hidden = false;
  ui.btnRematch.disabled = !isHost;
  ui.btnRematch.textContent = isHost ? '再来一局' : '等待房主开局…';
  ui.oNext.hidden = true;
  ui.overlay.hidden = false;
}

// ===== 回合开始 =====
function startRound(msg) {
  phase = 'playing';
  roundNo = msg.round;
  deadline = msg.deadline;
  myRole = msg.role;
  myHints = msg.hints || [];
  myAnswer = msg.answer;
  myBuf = [];
  lockUntil = 0;
  roster = msg.players;

  clearInterval(nextTimer);
  ui.overlay.hidden = true;
  ui.lobby.hidden = true;
  ui.hud.hidden = false;
  ui.feed.innerHTML = '';
  ui.roundInfo.textContent = `第 ${roundNo} 局`;
  ui.btnSubmit.hidden = false;
  renderRoleCard();
  renderBuf();
  renderScoreboard();

  // 同步其他玩家
  world.clearPlayers();
  for (const p of roster) {
    if (p.id !== myId) world.addPlayer(p.id, p.name, colorOf(p.id));
  }

  controls.setEnabled(true);
  toast('点击画面锁定视角 · WASD 移动 · E 交互');
}

// ===== 交互 =====
function onInteract() {
  if (phase !== 'playing') return;
  const hit = controls.pick();
  if (!hit) return;

  if (hit.kind === 'rune') {
    const now = Date.now();
    if (now < lockUntil) { toast(`冷却中 ${(lockUntil - now) / 1000 | 0} 秒`); return; }
    if (myBuf.includes(hit.idx)) { toast('该符文已刻印'); return; }
    if (myBuf.length >= SEQ_LEN) { toast('刻印槽已满，去中央祭坛验证'); return; }
    myBuf.push(hit.idx);
    renderBuf();
    world.pulseRune(hit.idx);
    send({ t: 'rune', idx: hit.idx });
  } else if (hit.kind === 'altar') {
    if (Date.now() < lockUntil) { toast('冷却中，稍候再验证'); return; }
    if (myBuf.length < SEQ_LEN) { toast(`需要刻满 ${SEQ_LEN} 个符文`); return; }
    send({ t: 'submit' });
  }
}

// ===== 网络 =====
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // 允许通过 window.__WS_URL__ 覆盖（静态托管到 Pages 时指定联机服务器地址）
  const target = window.__WS_URL__ || `${proto}://${location.host}/ws`;
  ws = new WebSocket(target);
  ws.onopen = () => addChat('', '已连接服务器', true);
  ws.onclose = () => {
    addChat('', '连接断开，请刷新重连', true);
    if (phase === 'playing') toast('连接断开');
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    handleMessage(m);
  };
}

function handleMessage(m) {
  switch (m.t) {
    case 'error':
      ui.lobbyError.textContent = m.text;
      ui.lobbyError.hidden = false;
      break;

    case 'joined': {
      myId = m.id;
      roomCode = m.code;
      roster = m.players;
      roundMs = (m.config && m.config.roundMs) || 90000;
      phase = 'lobby';
      ui.lobby.hidden = false;
      ui.joinBox.hidden = true;
      ui.roomBox.hidden = false;
      ui.lobbyError.hidden = true;
      renderLobby();
      addChat('', `加入房间 ${roomCode}`, true);
      break;
    }

    case 'lobby':
      roster = m.players;
      roomCode = m.code || roomCode;
      if (phase === 'lobby') renderLobby();
      else {
        // 对局中断线移除
        roster = m.players;
        for (const id of [...world.players.keys()]) {
          if (!roster.some((p) => p.id === id)) world.removePlayer(id);
        }
        renderScoreboard();
      }
      break;

    case 'roundStart':
      startRound(m);
      break;

    case 'mybuf':
      myBuf = m.buf || [];
      lockUntil = m.lockUntil || 0;
      renderBuf();
      break;

    case 'snapshot':
      world.applySnapshot(m.players || []);
      if (m.deadline) deadline = m.deadline;
      break;

    case 'feed':
      addFeed(m.kind || 'system', m.text);
      break;

    case 'chat':
      addChat(m.from, m.text);
      break;

    case 'toast':
      toast(m.text);
      break;

    case 'roundEnd':
      showRoundEnd(m);
      break;

    case 'matchEnd':
      showMatchEnd(m);
      break;

    default:
      break;
  }
}

// ===== UI 事件 =====
ui.btnCreate.addEventListener('click', () => {
  ui.lobbyError.hidden = true;
  send({ t: 'create', name: ui.inpName.value });
});
ui.btnJoin.addEventListener('click', () => {
  ui.lobbyError.hidden = true;
  send({ t: 'join', name: ui.inpName.value, code: ui.inpCode.value });
});
ui.inpCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ui.btnJoin.click();
});
ui.inpName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ui.inpCode.value) ui.btnJoin.click();
  else if (e.key === 'Enter') ui.btnCreate.click();
});
ui.btnStart.addEventListener('click', () => send({ t: 'start' }));
ui.btnRematch.addEventListener('click', () => send({ t: 'start' }));
ui.btnSubmit.addEventListener('pointerdown', (e) => e.preventDefault());
ui.btnSubmit.addEventListener('click', () => onInteract());

// 聊天
document.addEventListener('keydown', (e) => {
  if (e.target === ui.chatInput) {
    if (e.key === 'Enter') {
      const text = ui.chatInput.value.trim();
      if (text) send({ t: 'chat', text });
      ui.chatInput.value = '';
      ui.chatInput.hidden = true;
      ui.chatInput.blur();
      if (phase === 'playing') {
        try {
          const r = $('game-canvas').requestPointerLock?.();
          if (r && r.catch) r.catch(() => {});
        } catch { /* 忽略锁定失败，点击画面即可 */ }
      }
    } else if (e.key === 'Escape') {
      ui.chatInput.value = '';
      ui.chatInput.hidden = true;
      ui.chatInput.blur();
    }
    return;
  }
  if (e.key === 'Enter' && phase === 'playing') {
    e.preventDefault();
    ui.chatInput.hidden = false;
    ui.chatInput.focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }
});

controls.onLockChange = (locked) => {
  if (!locked && phase === 'playing' && ui.chatInput.hidden) {
    toast('点击画面继续（Enter 聊天）');
  }
};

// ===== 主循环 =====
let lastT = performance.now();
let lastSent = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  controls.update(dt);
  world.update(dt);

  if (phase === 'playing') {
    // 计时器
    const remain = Math.max(0, deadline - Date.now());
    ui.timerFill.style.transform = `scaleX(${Math.min(1, remain / roundMs)})`;
    ui.timerText.textContent = Math.ceil(remain / 1000);
    ui.timer.classList.toggle('danger', remain < 10000);

    // 冷却
    if (Date.now() < lockUntil) {
      ui.lockBadge.hidden = false;
      ui.lockBadge.textContent = `禁刻中 ${Math.ceil((lockUntil - Date.now()) / 1000)}s（答错惩罚）`;
    } else {
      ui.lockBadge.hidden = true;
    }

    // 交互提示
    const hit = controls.pick();
    if (hit) {
      ui.prompt.hidden = false;
      ui.prompt.textContent = hit.kind === 'rune'
        ? `按 E 刻印 ${RUNES[hit.idx].glyph}`
        : '按 E 验证序列';
    } else {
      ui.prompt.hidden = true;
    }

    // 上报位置 20Hz
    if (now - lastSent > 50) {
      lastSent = now;
      send({ t: 'pos', x: +controls.pos.x.toFixed(3), z: +controls.pos.z.toFixed(3), yaw: +controls.yaw.toFixed(3) });
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ===== 启动 =====
connect();
ui.inpName.focus();
