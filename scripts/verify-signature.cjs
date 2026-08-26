'use strict';
// 构建产物签名验收：dist/mac 下每个 .app 必须有 _CodeSignature 且 codesign -v 通过。
// 背景：v0.1.6 产物缺签名目录，macOS 直接 SIGKILL，应用秒退且零日志。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distMac = path.join(__dirname, '..', 'dist', 'mac');
const distArm = path.join(__dirname, '..', 'dist', 'mac-arm64');
const roots = [distMac, distArm].filter((d) => fs.existsSync(d));

if (roots.length === 0) {
  console.error('verify-signature: 未找到 dist/mac* 构建产物目录');
  process.exit(1);
}

let failed = false;
for (const root of roots) {
  for (const entry of fs.readdirSync(root)) {
    if (!entry.endsWith('.app')) continue;
    const appPath = path.join(root, entry);
    const sig = path.join(appPath, 'Contents', '_CodeSignature');
    try {
      execFileSync('codesign', ['-v', appPath], { stdio: 'pipe' });
      console.log(`OK   ${appPath}`);
    } catch (e) {
      console.error(`FAIL ${appPath} — ${e.status ? `codesign exit ${e.status}` : e.message}`);
      failed = true;
      continue;
    }
    if (!fs.existsSync(sig)) {
      console.error(`FAIL ${appPath} — _CodeSignature 目录缺失`);
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
