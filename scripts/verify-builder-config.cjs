'use strict';
// electron-builder 配置门禁：把 package.json 的 build 字段交给 electron-builder
// 自己的 schema 校验器，让「配置写错层级」在本地/CI 早期就失败，而不是跑到 4 分钟
// 后的打包步骤才报 “Invalid configuration object”。
// （背景：afterPack 曾被写在 build.mac 下，合法位置是 build 根。）
const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));

async function main() {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
  if (!pkg.build || typeof pkg.build !== 'object') {
    throw new Error('package.json 缺少 build 配置');
  }
  // validateConfiguration 是异步的：必须 await，否则拒绝会变成未处理异常。
  await validateConfiguration(pkg.build, () => {});
  console.log('electron-builder 配置校验通过');
}

main().catch((error) => {
  console.error('verify-builder-config: electron-builder 配置无效');
  console.error(error.message);
  process.exitCode = 1;
});
