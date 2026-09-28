// 一键测试：拉起两个服务器实例（默认配置 + 短回合配置），串行跑全部测试
// 用法：npm test
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const portA = 3100 + Math.floor(Math.random() * 700);
const portB = portA + 1;

function startServer(env) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[server ${env.PORT}] ${d}`));
  return new Promise((res) => {
    const timer = setTimeout(() => res(child), 4000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('Rune Vault server')) {
        clearTimeout(timer);
        res(child);
      }
    });
  });
}

function run(cmd, args) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    p.on('exit', (code) => res(code || 0));
  });
}

const servers = [];
let failures = 0;

try {
  console.log('--- 启动测试服务器 ---');
  servers.push(await startServer({ PORT: String(portA) }));
  servers.push(await startServer({
    PORT: String(portB), ROUND_MS: '5000', ROUND_END_PAUSE_MS: '2000', TARGET_SCORE: '3',
  }));

  const suites = [
    ['DOM 静态校验', ['scripts/check-dom.mjs']],
    ['线索生成模糊测试', ['scripts/test-hints.mjs']],
    ['端到端对局测试', ['scripts/test-e2e.mjs', `ws://127.0.0.1:${portA}/ws`]],
    ['超时与比赛结束测试', ['scripts/test-timeout.mjs', `ws://127.0.0.1:${portB}/ws`]],
  ];

  for (const [name, args] of suites) {
    console.log(`\n===== ${name} =====`);
    const code = await run(process.execPath, args);
    if (code !== 0) failures++;
  }
} finally {
  for (const s of servers) s.kill();
}

console.log(failures === 0 ? '\n全部测试套件通过' : `\n${failures} 个测试套件失败`);
process.exit(failures ? 1 : 0);
