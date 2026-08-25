'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  electronUserDataDirectory, optionEnabled, optionValue, resolvePnpmBin, runtimeValue,
} = require('../lib/launch-options');

test('运行参数支持等号与分离值写法', () => {
  assert.equal(optionValue('dsh-desktop-web-port', ['node', '--dsh-desktop-web-port=3184']), '3184');
  assert.equal(optionValue('dsh-desktop-web-port', ['node', '--dsh-desktop-web-port', '3185']), '3185');
  assert.equal(optionEnabled('dsh-desktop-preview', ['node', '--dsh-desktop-preview=1']), true);
});

test('命令行值优先于环境变量', () => {
  assert.equal(runtimeValue('dsh-desktop-dsh-home', 'DSH_DESKTOP_DSH_HOME', { DSH_DESKTOP_DSH_HOME: '/env' }, ['node', '--dsh-desktop-dsh-home=/arg']), '/arg');
});

test('指定配置目录时 Electron 使用隔离用户数据目录', () => {
  assert.equal(
    electronUserDataDirectory({}, ['electron', 'main.js', '--dsh-desktop-config-dir=/private/tmp/candidate/config']),
    '/private/tmp/candidate/config/electron',
  );
  assert.equal(electronUserDataDirectory({}, ['electron', 'main.js']), '');
});

test('优先使用安装包内完整的 pnpm，再使用开发环境显式指定的 pnpm', () => {
  const exists = (file) => file === '/app/runtime/pnpm/bin/pnpm.cjs' || file === '/custom/pnpm/bin/pnpm.cjs';
  assert.equal(
    resolvePnpmBin('/app/runtime/pnpm/bin/pnpm.cjs', { DSH_PNPM_BIN: '/custom/pnpm/bin/pnpm.cjs' }, exists),
    '/app/runtime/pnpm/bin/pnpm.cjs',
  );
  assert.equal(
    resolvePnpmBin('/missing/pnpm.cjs', { DSH_PNPM_BIN: '/custom/pnpm/bin/pnpm.cjs' }, exists),
    '/custom/pnpm/bin/pnpm.cjs',
  );
  assert.equal(resolvePnpmBin('/missing/pnpm.cjs', {}, exists), '');
});
