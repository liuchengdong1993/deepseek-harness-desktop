'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { openExternal } = require('../lib/main-window');

test('外部链接只允许 HTTP 和 HTTPS 协议', async () => {
  const opened = [];
  const logs = [];
  const shell = { openExternal: async (value) => { opened.push(value); } };
  openExternal(shell, 'https://github.com/deepseek-ai/deepseek-harness', (line) => logs.push(line));
  openExternal(shell, 'file:///etc/passwd', (line) => logs.push(line));
  openExternal(shell, 'not a url', (line) => logs.push(line));
  await Promise.resolve();
  assert.deepEqual(opened, ['https://github.com/deepseek-ai/deepseek-harness']);
  assert.equal(logs.length, 2);
});
