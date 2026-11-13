#!/usr/bin/env node
// 语法检查 + 两套用例；任何一步非零即退出非零，供 CI 直接调用
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = [
  'extension/inject.js',
  'extension/content.js',
  'extension/background.js',
  'extension/manifest.json',
  'userscript/tencent-bypass.user.js',
];

let failed = 0;

function run(label, file, args) {
  try {
    execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    console.log(`ok   ${label}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

// 1. 语法 / JSON
for (const t of targets) {
  if (t.endsWith('.json')) {
    try {
      JSON.parse(fs.readFileSync(path.join(root, t), 'utf8'));
      console.log(`ok   json ${t}`);
    } catch (e) {
      failed++;
      console.error(`FAIL json ${t}: ${e.message}`);
    }
  } else {
    run(`syntax ${t}`, t, ['--check', path.join(root, t)]);
  }
}

// 2. 四份脚本常量表一致 + manifest 覆盖
run('scripts/consistency.js', 'consistency', [path.join(root, 'scripts', 'consistency.js')]);

// 3. 版本号三处同步
const version = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const usVersion = (fs.readFileSync(path.join(root, 'userscript/tencent-bypass.user.js'), 'utf8')
  .match(/\/\/\s*@version\s+(\S+)/) || [])[1];
const noteVersion = (fs.readFileSync(path.join(root, 'docs/INSTALL-zh.md'), 'utf8')
  .match(/v(\d+\.\d+\.\d+)/) || [])[1];
const versions = { manifest: version, package: pkgVersion, userscript: usVersion, installNote: noteVersion };
const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  failed++;
  console.error(`FAIL 版本号不一致: ${JSON.stringify(versions)}`);
} else {
  console.log(`ok   version ${version} (manifest/package/userscript/docs)`);
}

// 4. 不提交真实会话票据
const tokenPattern = /(bancode|bankey|midpagecode)=[0-9a-f]{16,}/i;
const repoFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|json|md|txt|yml)$/i.test(e.name)) repoFiles.push(p);
  }
})(root);
for (const f of repoFiles) {
  if (tokenPattern.test(fs.readFileSync(f, 'utf8'))) {
    failed++;
    console.error(`FAIL ${path.relative(root, f)} 里含有真实会话票据（bancode/bankey/midpagecode）`);
  }
}
console.log(`ok   no session tokens in ${repoFiles.length} tracked text files`);

// 5. 行为用例
run('test/test-bypass.js', 'test-bypass', [path.join(root, 'test', 'test-bypass.js')]);
run('test/test-extended.js', 'test-extended', [path.join(root, 'test', 'test-extended.js')]);

if (failed) {
  console.error(`\n${failed} step(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
