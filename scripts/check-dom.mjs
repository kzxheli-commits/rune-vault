// 静态校验：main.js 引用的 DOM id/class 必须在 index.html 中存在
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'client/js/main.js'), 'utf8');

let failures = 0;
const need = new Set();

// $('id') 形式
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) need.add(m[1]);
// getElementById 字面量
for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) need.add(m[1]);

for (const id of need) {
  if (new RegExp(`id="${id}"`).test(html)) console.log(`  PASS  #${id}`);
  else { failures++; console.log(`  FAIL  #${id} 不在 index.html`); }
}

// querySelector 类选择器
const cls = [...js.matchAll(/querySelectorAll\('\.([\w-]+)'\)/g)].map((m) => m[1]);
for (const c of cls) {
  if (new RegExp(`class="[^"]*\\b${c}\\b"`).test(html)) console.log(`  PASS  .${c}`);
  else { failures++; console.log(`  FAIL  .${c} 不在 index.html`); }
}

// index.html 中每个 script/link 资源存在
for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
  const p = path.join(root, 'client', m[1]);
  if (fs.existsSync(p)) console.log(`  PASS  资源 ${m[1]}`);
  else { failures++; console.log(`  FAIL  资源缺失 ${m[1]}`); }
}

console.log(failures === 0 ? '\nDOM CHECK PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
