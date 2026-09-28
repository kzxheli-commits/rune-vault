// 服务端与客户端共享的常量（无 DOM 依赖）

export const RUNES = [
  { id: 0, glyph: '\u25C6', color: '#22d3ee', name: '菱' },
  { id: 1, glyph: '\u25CF', color: '#f472b6', name: '圆' },
  { id: 2, glyph: '\u25B2', color: '#facc15', name: '三角' },
  { id: 3, glyph: '\u25A0', color: '#4ade80', name: '方' },
  { id: 4, glyph: '\u271A', color: '#a78bfa', name: '十字' },
  { id: 5, glyph: '\u2726', color: '#fb923c', name: '星' },
];

export const ARENA_RADIUS = 9.0;      // 玩家活动半径
export const PILLAR_RING = 6.6;       // 符文柱环形半径
export const PILLAR_COLLIDE = 0.85;   // 符文柱碰撞半径
export const ALTAR_COLLIDE = 1.5;     // 中央祭坛碰撞半径
export const SEQ_LEN = 3;             // 答案序列长度
export const ROUND_MS = 90000;        // 单局时长
export const WRONG_LOCK_MS = 5000;    // 答错后禁刻时间
export const ROUND_END_PAUSE_MS = 7000; // 局末展示
export const TARGET_SCORE = 6;        // 先到此分数赢下比赛
export const PLAYER_COLORS = ['#38bdf8', '#fb7185', '#facc15', '#a3e635', '#c084fc', '#f97316'];

// 符文柱世界坐标
export function pillarPos(idx) {
  const a = (idx / RUNES.length) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * PILLAR_RING, z: Math.sin(a) * PILLAR_RING };
}
