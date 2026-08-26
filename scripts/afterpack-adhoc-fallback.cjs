'use strict';
// electron-builder afterPack 兜底钩子：
// 若产物缺少有效签名（如 CI 证书环节失效、本地无 Developer ID 构建），
// 自动做 ad-hoc 深签，防止出现缺 _CodeSignature 的坏包——
// 那类包会被 macOS 直接 SIGKILL，表现为应用秒退且零日志。
// 已有有效签名（真证书/公证链路）时不动，保持 hardened runtime 完整性。
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

function hasValidSignature(appPath) {
  try {
    execFileSync('codesign', ['-v', appPath], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const apps = findApps(context.appOutDir);
  for (const appPath of apps) {
    // 清理 resource fork / FinderInfo 等扩展属性，否则 codesign 报 detritus 错误
    try { execFileSync('xattr', ['-cr', appPath], { timeout: 300000 }); } catch { /* 无扩展属性时忽略 */ }
    if (hasValidSignature(appPath)) {
      console.log(`[afterPack] signature valid, skip: ${appPath}`);
      continue;
    }
    console.log(`[afterPack] no valid signature, ad-hoc signing: ${appPath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
      timeout: 600000,
    });
    execFileSync('codesign', ['-v', appPath], { stdio: 'inherit' });
    const sig = path.join(appPath, 'Contents', '_CodeSignature');
    if (!fs.existsSync(sig)) {
      throw new Error(`[afterPack] _CodeSignature still missing: ${appPath}`);
    }
  }
};
