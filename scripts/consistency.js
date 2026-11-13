#!/usr/bin/env node
// 四份脚本的常量表必须逐字一致；manifest 的 host 必须覆盖 MIDDLE_HOSTS。
// 在合并成单一 core 之前，这个脚本就是防漂移的闸门。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  'extension/inject.js',
  'extension/content.js',
  'extension/background.js',
  'userscript/tencent-bypass.user.js',
];
const ARRAYS = ['MIDDLE_HOSTS', 'FUNCTION_HOSTS', 'PARAM_NAMES'];

function readArray(src, name) {
  const start = src.indexOf(`var ${name} = [`);
  if (start === -1) return null;
  // 顶层声明的收尾是 "\n];"，IIFE 内是 "\n  ];"
  const m = src.slice(start).match(/\n\s*\];/);
  if (!m) return null;
  const end = start + m.index + m[0].length;
  return src.slice(start, end)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line !== '')
    .join('\n');
}

let failed = 0;
const seen = {};

for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const name of ARRAYS) {
    const body = readArray(src, name);
    if (!body) {
      failed++;
      console.error(`FAIL ${f}: 找不到 ${name}`);
      continue;
    }
    if (!seen[name]) seen[name] = { body, file: f };
    else if (seen[name].body !== body) {
      failed++;
      console.error(`FAIL ${name} 在 ${seen[name].file} 与 ${f} 之间不一致`);
    }
  }
}

// manifest 的 host_permissions 必须覆盖每个中间页域名
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const hosts = new Set();
for (const p of manifest.host_permissions || []) {
  const h = p.replace(/^\*:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '');
  hosts.add(h);
}
const middle = readArray(fs.readFileSync(path.join(root, 'extension/inject.js'), 'utf8'), 'MIDDLE_HOSTS') || '';
let checked = 0;
for (const m of middle.matchAll(/\/(.*?)\/i/g)) {
  const domain = m[1]
    .replace(/^\(\^\|\\\.\)/, '')
    .replace(/\\\./g, '.')
    .replace(/\$$/, '');
  if (!domain) continue;
  checked++;
  if (!hosts.has(domain)) {
    failed++;
    console.error(`FAIL MIDDLE_HOSTS 域名 ${domain} 没有对应的 host_permissions / matches`);
  }
}

if (failed) {
  console.error(`\n${failed} consistency problem(s)`);
  process.exit(1);
}
console.log(`consistency: 4 files in sync, manifest covers ${checked} middle host(s)`);
