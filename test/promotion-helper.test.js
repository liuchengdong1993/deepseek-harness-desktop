'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { promoteInstalledApp, rollbackInstalledApp } = require('../lib/promotion-helper');

function application(root, name, contents) {
  const app = path.join(root, `${name}.app`);
  const executable = path.join(app, 'Contents', 'MacOS', 'DeepSeek Harness');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, contents);
  return app;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-promotion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, resultFile: path.join(root, 'result.json'), confirmationFile: path.join(root, 'ready.json') };
}

test('新版本未通过就绪确认时自动恢复旧应用', async (t) => {
  const paths = fixture(t);
  const target = application(paths.root, 'DeepSeek Harness', 'old');
  const candidate = application(paths.root, 'candidate', 'new');
  const started = [];
  const result = await promoteInstalledApp({
    targetApp: target,
    candidateApp: candidate,
    requestId: 'request-failed',
    parentPid: 0,
    confirmationFile: paths.confirmationFile,
    confirmationTimeoutMs: 0,
    resultFile: paths.resultFile,
  }, {
    launch: (file) => {
      started.push(file);
      return { pid: 4321, unref() {} };
    },
    kill: () => {},
  });

  assert.equal(result.status, 'rolled_back');
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'MacOS', 'DeepSeek Harness'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(paths.root, '.DeepSeek Harness.rollback.app')), false);
  assert.equal(started.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(paths.resultFile, 'utf8')).status, 'rolled_back');
});

test('新版本通过服务就绪确认后保留上一版本供回滚', async (t) => {
  const paths = fixture(t);
  const target = application(paths.root, 'DeepSeek Harness', 'old');
  const candidate = application(paths.root, 'candidate', 'new');
  let wroteConfirmation = false;
  const launches = [];
  const result = await promoteInstalledApp({
    targetApp: target,
    candidateApp: candidate,
    requestId: 'request-success',
    parentPid: 0,
    confirmationFile: paths.confirmationFile,
    confirmationTimeoutMs: 1000,
    resultFile: paths.resultFile,
  }, {
    launch: (_file, args) => {
      launches.push(args);
      return { pid: 4322, unref() {} };
    },
    sleep: async () => {
      if (!wroteConfirmation) {
        wroteConfirmation = true;
        fs.writeFileSync(paths.confirmationFile, JSON.stringify({ requestId: 'request-success' }));
      }
    },
  });

  const rollback = path.join(paths.root, '.DeepSeek Harness.rollback.app');
  assert.equal(result.status, 'promoted');
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'MacOS', 'DeepSeek Harness'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(rollback, 'Contents', 'MacOS', 'DeepSeek Harness'), 'utf8'), 'old');
  assert.equal(launches[0].some((argument) => argument.startsWith('--dsh-desktop-promotion-ready-file=')), true);
  assert.equal(launches[0].includes('--dsh-desktop-promotion-request-id=request-success'), true);
});

test('手动回滚恢复保留的上一版本', async (t) => {
  const paths = fixture(t);
  const target = application(paths.root, 'DeepSeek Harness', 'new');
  const rollback = application(paths.root, '.DeepSeek Harness.rollback', 'old');
  const result = await rollbackInstalledApp({
    targetApp: target,
    rollbackApp: rollback,
    requestId: 'request-rollback',
    parentPid: 0,
    startupTimeoutMs: 10,
    resultFile: paths.resultFile,
  }, {
    launch: () => ({ pid: 4323, unref() {} }),
    isRunning: () => true,
  });

  assert.equal(result.status, 'rolled_back_manually');
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'MacOS', 'DeepSeek Harness'), 'utf8'), 'old');
  assert.equal(fs.existsSync(rollback), false);
});
