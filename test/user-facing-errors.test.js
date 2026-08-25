'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ERROR_DETAILS, userFacingErrorDetail } = require('../lib/user-facing-errors');

test('原生错误弹窗只使用固定中文恢复指引', () => {
  assert.equal(userFacingErrorDetail('harnessRestart'), '请稍后重试；如问题持续，请从“帮助”菜单重启 Harness 服务。');
  assert.equal(userFacingErrorDetail('harnessStart'), '请检查本机 Harness 安装和端口占用情况后重试。');
  assert.equal(userFacingErrorDetail('pageLoad'), '请从“帮助”菜单重启 Harness 服务后重试。');
  assert.equal(userFacingErrorDetail('promotion'), '请查看本次候选构建和预览结果后重试。');
  assert.equal(userFacingErrorDetail('unknown'), ERROR_DETAILS.appStart);
});
