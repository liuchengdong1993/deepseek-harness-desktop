'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { HarnessService } = require('../lib/harness-service');

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

function options(backend) {
  return {
    backend,
    cliBin: '/harness/apps/cli/lib/bin.js',
    port: 3080,
    nodeBin: '/runtime/node',
    cwd: '/harness',
    env: { DSH_HOME: '/profile' },
  };
}

test('并发 start 只创建一个 Harness 进程', async () => {
  const child = childProcess();
  let starts = 0;
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  const backend = {
    probe: async () => ({ reachable: false, harness: false }),
    start: () => { starts += 1; return child; },
    waitForHarness: () => ready,
    stop: async () => {},
  };
  const service = new HarnessService(options(backend));
  const first = service.start();
  const second = service.start();
  assert.equal(first, second);
  markReady(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(starts, 1);
  assert.equal(service.owned, true);
  await service.stop();
  assert.equal(service.owned, false);
});

test('端口被其他 HTTP 服务占用时明确拒绝启动', async () => {
  let starts = 0;
  const service = new HarnessService(options({
    probe: async () => ({ reachable: true, harness: false }),
    start: () => { starts += 1; return childProcess(); },
  }));
  await assert.rejects(service.start(), /端口 3080 已被其他应用占用/);
  assert.equal(starts, 0);
});

test('已运行的 Harness 可直接复用且不声明进程所有权', async () => {
  const service = new HarnessService(options({
    probe: async () => ({ reachable: true, harness: true }),
  }));
  assert.equal(await service.start(), true);
  assert.equal(service.owned, false);
});

test('已拥有的进程无响应时先停止旧进程再拉起新进程', async () => {
  const oldChild = childProcess();
  const newChild = childProcess();
  const events = [];
  const backend = {
    probe: async () => ({ reachable: false, harness: false }),
    start: () => { events.push('start'); return newChild; },
    waitForHarness: async () => true,
    stop: async (child) => { events.push(child === oldChild ? 'stop-old' : 'stop-new'); },
  };
  const service = new HarnessService(options(backend));
  service.process = oldChild;
  assert.equal(await service.start(), true);
  assert.deepEqual(events, ['stop-old', 'start']);
  assert.equal(service.process, newChild);
});

test('子进程就绪前退出会返回失败并释放所有权', async () => {
  const child = childProcess();
  const service = new HarnessService(options({
    probe: async () => ({ reachable: false, harness: false }),
    start: () => child,
    waitForHarness: () => new Promise(() => {}),
    stop: async () => {},
  }));
  const starting = service.start();
  setImmediate(() => child.emit('close', 1));
  assert.equal(await starting, false);
  assert.equal(service.owned, false);
});
