'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  REQUEST_FILE, RESULT_FILE, handleBackendRequest, takeBackendRequest,
  validateRequest, writeBackendResult,
} = require('../lib/backend-control');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-backend-control-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRequest(dir, request) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, REQUEST_FILE), JSON.stringify(request, null, 2));
}

function readResult(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, RESULT_FILE), 'utf8'));
}

function validRequest(overrides = {}) {
  return {
    id: 'req-001',
    action: 'backend-status',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

test('validateRequest 拒绝格式无效、编号非法、动作白名单外、过期请求', () => {
  assert.throws(() => validateRequest(null), /格式无效/);
  assert.throws(() => validateRequest({}), /编号无效/);
  assert.throws(() => validateRequest(validRequest({ id: 'bad id!' })), /编号无效/);
  assert.throws(() => validateRequest(validRequest({ action: 'promote' })), /操作无效/);
  assert.throws(
    () => validateRequest(validRequest({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
    /已过期/,
  );
  assert.equal(validateRequest(validRequest()).id, 'req-001');
});

test('takeBackendRequest 无请求返回 null，读取后删除请求文件', (t) => {
  const dir = fixture(t);
  assert.equal(takeBackendRequest(dir), null);
  writeRequest(dir, validRequest());
  const taken = takeBackendRequest(dir);
  assert.equal(taken.id, 'req-001');
  assert.equal(fs.existsSync(path.join(dir, REQUEST_FILE)), false);
});

test('takeBackendRequest 损坏请求删除文件并抛错', (t) => {
  const dir = fixture(t);
  // 直接写损坏 JSON（不走 writeRequest，因为其 JSON.stringify 会把输入
  // 变成合法 JSON 字符串，无法触发解析失败路径）。
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, REQUEST_FILE), '{not json');
  assert.throws(() => takeBackendRequest(dir), /无法读取/);
  assert.equal(fs.existsSync(path.join(dir, REQUEST_FILE)), false);
});

test('handleBackendRequest 执行 restart-backend 并回执快照', async (t) => {
  const dir = fixture(t);
  writeRequest(dir, validRequest({ action: 'restart-backend' }));
  const calls = [];
  const result = await handleBackendRequest(dir, {
    restart: async () => {
      calls.push('restart');
      return { owned: true, pid: 1234, startedAt: 42, port: 3080 };
    },
    status: () => ({ owned: true, pid: 1234, startedAt: 42, port: 3080 }),
  });
  assert.deepEqual(calls, ['restart']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'restart-backend');
  const written = readResult(dir);
  assert.equal(written.id, 'req-001');
  assert.equal(written.pid, 1234);
  assert.ok(written.completedAt);
});

test('handleBackendRequest 重启失败回执 ok:false + error', async (t) => {
  const dir = fixture(t);
  writeRequest(dir, validRequest({ action: 'restart-backend' }));
  const result = await handleBackendRequest(dir, {
    restart: async () => { throw new Error('Harness 服务未能重新启动。'); },
    status: () => ({ owned: false, pid: null, startedAt: null, port: 3080 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /未能重新启动/);
  assert.equal(readResult(dir).ok, false);
});

test('handleBackendRequest 执行 backend-status 且不触发 restart', async (t) => {
  const dir = fixture(t);
  writeRequest(dir, validRequest({ action: 'backend-status' }));
  let restarted = false;
  const result = await handleBackendRequest(dir, {
    restart: async () => { restarted = true; return {}; },
    status: () => ({ owned: true, pid: 99, startedAt: 7, port: 3080 }),
  });
  assert.equal(restarted, false);
  assert.equal(result.pid, 99);
  assert.equal(result.startedAt, 7);
});

test('handleBackendRequest 无请求返回 null 且不写回执', async (t) => {
  const dir = fixture(t);
  const result = await handleBackendRequest(dir, {
    restart: async () => ({}),
    status: () => ({}),
  });
  assert.equal(result, null);
  assert.equal(fs.existsSync(path.join(dir, RESULT_FILE)), false);
});

test('writeBackendResult 原子写入并附加 completedAt', (t) => {
  const dir = fixture(t);
  writeBackendResult(dir, { id: 'x', ok: true });
  const result = readResult(dir);
  assert.equal(result.id, 'x');
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(Date.parse(result.completedAt)));
});
