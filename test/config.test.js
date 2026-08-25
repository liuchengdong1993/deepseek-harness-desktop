'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const config = require('../lib/config');

test('normalize 只接受合法端口和字符串路径', () => {
  assert.deepEqual(config.normalize({ harnessPath: '/tmp/harness', webPort: 4100 }, {}), {
    harnessPath: '/tmp/harness',
    webPort: 4100,
  });
  assert.deepEqual(config.normalize({ harnessPath: 42, webPort: '3080x' }, {}), config.DEFAULTS);
  assert.equal(config.normalize({ webPort: 4100 }, { DSH_DESKTOP_WEB_PORT: '5200' }).webPort, 5200);
});

test('parsePort 拒绝越界值、浮点和混合字符串', () => {
  for (const value of [0, 65536, -1, 3.14, '3080x', '', null]) {
    assert.equal(config.parsePort(value), null);
  }
  assert.equal(config.parsePort(' 3080 '), 3080);
});

test('命令行端口参数优先于已净化的应用环境变量', () => {
  assert.equal(config.normalize({}, { DSH_DESKTOP_WEB_PORT: '3081' }, ['node', 'app', '--dsh-desktop-web-port=3199']).webPort, 3199);
});
