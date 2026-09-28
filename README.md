# 符文密室 · Rune Vault

3D 多人演绎推理解谜游戏。玩家在环形密室中收集私有线索、协作破译符文序列，而其中潜伏着一名知道全部答案的**干扰者**——这是一场信息不对称的推理博弈。

技术栈：`Three.js`（3D 渲染） + `WebSocket`（Node.js 权威服务端） + 原生 ES Modules（零构建工具）。

## 玩法

- 房主创建房间拿到 4 位房间码，朋友输入房间码加入（2–6 人）。
- 每局 90 秒，6 根符文柱围绕竞技场，答案是 3 枚符文的**有序序列**。
- **解谜者**：每人只能拿到 2–3 条私有线索（第几位是某符文 / 包含某符文 / 某符文排在另一符文之前……）。单个人的线索**不足以**推出答案，必须在聊天里交换线索拼出全貌。
- **干扰者**（3 人以上时出现 1 名）：开局就知道完整答案，任务是带节奏、误导、拖到超时得分。
- 走到符文柱前按 `E` 刻印，凑满 3 枚后到中央祭坛按 `E` 验证。答案错误会**公开播报**并冷却 5 秒——错误的尝试本身就是给全场的线索。
- 破解 +3 分，另一名解谜者 +1 分；超时则干扰者 +3 分。先到 6 分者赢得整场比赛，局末公开所有人身份。

## 快速开始

```bash
npm install
npm start          # 默认 http://localhost:3000
```

浏览器打开 `http://localhost:3000`，创建房间后把 `http://<你的局域网IP>:3000` 发给朋友即可联机。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | HTTP + WebSocket 端口 |
| `ROUND_MS` | 90000 | 单局时长（毫秒） |
| `ROUND_END_PAUSE_MS` | 7000 | 局末展示，随后自动开下一局 |
| `TARGET_SCORE` | 6 | 先到该分数赢得比赛 |

### 部署

服务端同时提供静态页面与 `/ws`，任何能跑 Node 的主机（VPS / Render / Railway）`npm start` 即可。HTTPS 环境自动使用 `wss`。

若把静态页面单独托管（如 GitHub Pages），在 `index.html` 中加一行指定联机服务器：

```html
<script>window.__WS_URL__ = "wss://your-server.example.com/ws";</script>
```

## 测试

```bash
npm test
```

包含四个套件（自动拉起临时服务器，不需要手动开端口）：

- `check-dom.mjs` — HUD 元素与脚本引用一致性静态校验
- `test-hints.mjs` — 线索生成 3000 轮模糊测试（不变量：合并线索唯一、必等于真答案、每人至少一条）
- `test-e2e.mjs` — 3 个 ws 客户端全流程：大厅 / 身份隐私 / 位置校验 / 答错冷却 / 答对计分 / 聊天 / 自动下一局 / 断线
- `test-timeout.mjs` — 超时判负与比赛结束（短回合配置服务器）

## 架构

```
server/
  index.js     HTTP 静态服务 + WebSocket 接入 + 10Hz 快照循环
  game.js      房间/回合状态机、线索生成、服务器权威校验
client/
  index.html   大厅 / HUD / 局末界面
  js/
    shared.js  服务端与客户端共享的常量与坐标计算
    world.js   Three.js 场景：竞技场、符文柱、祭坛、其他玩家
    controls.js 第一人称控制 + 碰撞 + 视线交互判定
    main.js    网络消息处理、状态机、HUD 渲染
  vendor/      three.module.min.js（随仓库分发，无 CDN 依赖）
scripts/       测试套件
```

**权威模型**：服务端持有回合状态、答案、分数与玩家位置，客户端只上报意图（刻印/验证/坐标）。刻印与验证都带服务器侧位置校验（必须真的走到柱子/祭坛旁），线索在服务端生成，解谜者拿不到答案，他人身份对解谜者保密。

**同步模型**：位置 10Hz 快照广播，客户端对远端玩家做插值平滑；本机走预测移动。

消息协议（JSON over WebSocket）：

| 方向 | 消息 |
| --- | --- |
| C→S | `create` `join` `start` `rune` `submit` `pos` `chat` |
| S→C | `joined` `lobby` `roundStart` `snapshot` `mybuf` `feed` `chat` `toast` `roundEnd` `matchEnd` `error` |

## License

MIT
