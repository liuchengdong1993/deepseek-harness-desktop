'use strict';
// electron-builder afterPack 钩子：对每个 .app 做 ad-hoc 深度签名。
// 根因背景：v0.1.6 官方产物缺 _CodeSignature，导致 macOS 直接 SIGKILL、
// 应用「点了没反应」且零日志。此钩子保证任何产物都带有效签名目录。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findApps(dir, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (entry.endsWith('.app') && fs.statSync(p).isDirectory()) {
      acc.push(p);
    } else if (fs.statSync(p).isDirectory()) {
      findApps(p, acc);
    }
  }
  return acc;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // asar 解包/拷贝可能丢失可执行位（v0.1.6 曾因此 EACCES 启动失败），这里兜底恢复
  const resDir = path.join(context.appOutDir, 'Contents', 'Resources');
  const unpackedRuntime = path.join(resDir, 'app.asar.unpacked', 'runtime');
  if (fs.existsSync(unpackedRuntime)) {
    const restoreBits = (p) => {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        for (const e of fs.readdirSync(p)) restoreBits(path.join(p, e));
      } else if (!st.isSymbolicLink()) {
        fs.chmodSync(p, st.mode | 0o111);
      }
    };
    console.log('[afterPack] restore exec bits under app.asar.unpacked/runtime');
    restoreBits(unpackedRuntime);
  }
  const outDir = context.appOutDir;
  const apps = findApps(outDir);
  for (const appPath of apps) {
    // 清除 resource fork / FinderInfo 等扩展属性，否则 codesign 报 detritus 错误
    try { execFileSync('xattr', ['-cr', appPath], { timeout: 300000 }); } catch { /* 属性不存在时可忽略 */ }
    console.log(`[afterPack] ad-hoc codesign: ${appPath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
      timeout: 600000,
    });
    // 验证签名，失败则让构建直接报错，防止坏包流出
    execFileSync('codesign', ['-v', appPath], { stdio: 'inherit' });
    const sig = path.join(appPath, 'Contents', '_CodeSignature');
    if (!fs.existsSync(sig)) {
      throw new Error(`[afterPack] _CodeSignature 缺失：${appPath}`);
    }
  }
};
