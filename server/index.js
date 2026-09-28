// 入口：HTTP 静态资源 + WebSocket 对局服务
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hub } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(CLIENT_DIR, rel);
  // 路径穿越防护
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const hub = new Hub({
  roundMs: Number(process.env.ROUND_MS) || undefined,
  roundEndPauseMs: Number(process.env.ROUND_END_PAUSE_MS) || undefined,
  targetScore: Number(process.env.TARGET_SCORE) || undefined,
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try { hub.handle(ws, raw.toString()); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => hub.disconnect(ws));
  ws.on('error', () => hub.disconnect(ws));
});

// 状态快照 10Hz，局末/超时检测 5Hz
setInterval(() => hub.snapshotAll(Date.now()), 100);
setInterval(() => hub.tick(Date.now()), 200);

server.listen(PORT, () => {
  console.log(`Rune Vault server http://localhost:${PORT}  (ws /ws)`);
});
