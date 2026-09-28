// 线索生成不变量的快速模糊测试（不依赖服务器）
import { RUNES, SEQ_LEN } from '../client/js/shared.js';

// 从 server/game.js 复制的生成逻辑改为本地断言
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

const rndInt = (n) => Math.floor(Math.random() * n);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// 与 server/game.js genHints 完全一致（保持同步！）
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
  const i0 = rndInt(SEQ_LEN);
  const seed = { t: 'pos', i: i0, r: answer[i0] };
  cands = cands.filter((c) => testHint(seed, c));
  push(seed);

  let guard = 0;
  while (cands.length > 1 && guard++ < 80) {
    const options = [];
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
    options.sort((x, y) => Math.abs(x.n - cands.length / 2) - Math.abs(y.n - cands.length / 2));
    const pick = options[rndInt(Math.min(3, options.length))];
    if (!push(pick.h)) break;
    cands = cands.filter((c) => testHint(pick.h, c));
  }
  if (cands.length > 1) {
    for (let i = 0; i < SEQ_LEN && cands.length > 1; i++) {
      if (!cands.every((c) => c[i] === answer[i])) {
        push({ t: 'pos', i, r: answer[i] });
        cands = cands.filter((c) => testHint({ t: 'pos', i, r: answer[i] }, c));
      }
    }
  }
  for (let i = 0; i < perPlayer.length; i++) {
    if (perPlayer[i].length === 0) {
      const h = { t: 'pos', i: i % SEQ_LEN, r: answer[i % SEQ_LEN] };
      if (!used.has(JSON.stringify(h))) perPlayer[i].push(h);
      else perPlayer[i].push({ t: 'has', r: answer[i % SEQ_LEN] });
    }
  }
  return perPlayer;
}

function solve(hints) {
  return allCandidates().filter((c) => hints.every((h) => testHint(h, c)));
}

let bad = 0, notUnique = 0;
for (let t = 0; t < 3000; t++) {
  const answer = shuffle([0, 1, 2, 3, 4, 5]).slice(0, SEQ_LEN);
  const per = genHints(answer, 2);
  const merged = solve([...per[0], ...per[1]]);
  if (merged.length !== 1) notUnique++;
  else if (merged[0].some((v, i) => v !== answer[i])) {
    bad++;
    if (bad <= 3) {
      console.log('BAD', JSON.stringify({ answer, hints: per, merged: merged[0] }));
    }
  }
  if (per.some((p) => p.length === 0)) { bad++; console.log('EMPTY HINTS', JSON.stringify({ answer, per })); }
}
console.log(`3000 轮：解不唯一 ${notUnique} 次，解 != 答案 ${bad} 次`);
