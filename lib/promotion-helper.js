#!/usr/bin/env node
'use strict';

// This file runs outside Electron after the user has accepted the native
// confirmation dialog. It is intentionally standalone so the old application
// can exit before its bundle is changed.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PRODUCT_NAME = 'DeepSeek Harness';

class PromotionError extends Error {
  constructor(message, details = '') {
    super(message);
    this.name = 'PromotionError';
    this.details = details;
  }
}

function appExecutable(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', PRODUCT_NAME);
}

function assertApplication(appPath, label) {
  const resolved = path.resolve(appPath || '');
  if (!resolved.endsWith('.app') || !fs.existsSync(appExecutable(resolved))) {
    throw new PromotionError(`${label}不是可运行的 DeepSeek Harness 应用程序。`, resolved);
  }
  return resolved;
}

function assertSibling(target, sibling, label) {
  if (path.dirname(target) !== path.dirname(sibling)) {
    throw new PromotionError(`${label}必须与正在运行的应用程序位于同一目录。`, sibling);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForParentExit(parentPid, timeoutMs = 30000, operations = {}) {
  if (!Number.isInteger(parentPid) || parentPid < 2) return;
  const isRunning = operations.isRunning || ((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  });
  const sleep = operations.sleep || wait;
  const started = Date.now();
  while (isRunning(parentPid)) {
    if (Date.now() - started >= timeoutMs) {
      throw new PromotionError('原桌面应用未能在限定时间内退出。');
    }
    await sleep(200);
  }
}

async function waitForConfirmation(file, requestId, timeoutMs = 45000, operations = {}) {
  const sleep = operations.sleep || wait;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const confirmation = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (confirmation.requestId === requestId) return confirmation;
    } catch { /* candidate is not ready yet */ }
    await sleep(200);
  }
  throw new PromotionError('新版本未能在限定时间内通过服务就绪确认。');
}

async function waitForChildAlive(pid, timeoutMs = 5000, operations = {}) {
  if (!Number.isInteger(pid) || pid < 2) throw new PromotionError('桌面应用未返回有效进程编号。');
  const isRunning = operations.isRunning || ((processId) => {
    try {
      process.kill(processId, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  });
  const sleep = operations.sleep || wait;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isRunning(pid)) return;
    await sleep(100);
  }
  throw new PromotionError('回滚版本启动后提前退出。');
}

function writeResult(file, value) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ ...value, completedAt: new Date().toISOString() }, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function launchApplication(executable, args, environment, operations = {}) {
  const launch = operations.launch || spawn;
  const child = launch(executable, args, { detached: true, stdio: 'ignore', env: environment });
  if (!child || !Number.isInteger(child.pid)) throw new PromotionError('无法启动桌面应用程序。', executable);
  child.unref?.();
  return child;
}

function stopProcess(pid, operations = {}) {
  const kill = operations.kill || process.kill;
  try { kill(pid, 'SIGTERM'); } catch { /* process already stopped */ }
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Promote a previewed candidate. The previous .app remains beside the live
 * application as a one-click rollback target until a later promotion replaces it.
 */
async function promoteInstalledApp(options, operations = {}) {
  const targetApp = assertApplication(options.targetApp, '当前');
  const candidateApp = assertApplication(options.candidateApp, '候选');
  const requestId = options.requestId;
  if (!/^[A-Za-z0-9-]+$/.test(requestId || '')) throw new PromotionError('替换请求编号无效。');
  const nextApp = path.join(path.dirname(targetApp), `.${path.basename(targetApp, '.app')}.candidate-${requestId}.app`);
  const rollbackApp = path.join(path.dirname(targetApp), `.${path.basename(targetApp, '.app')}.rollback.app`);
  assertSibling(targetApp, nextApp, '候选暂存目录');
  assertSibling(targetApp, rollbackApp, '回滚目录');
  if (fs.existsSync(nextApp)) throw new PromotionError('已有同编号的候选暂存目录。', nextApp);

  let oldMoved = false;
  let candidateInstalled = false;
  let newChild;
  try {
    // Validate a complete copy before the installed application is touched.
    fs.cpSync(candidateApp, nextApp, { recursive: true, preserveTimestamps: true, errorOnExist: true });
    assertApplication(nextApp, '候选暂存');
    await waitForParentExit(options.parentPid, options.parentExitTimeoutMs, operations);
    fs.rmSync(options.confirmationFile, { force: true });
    removeDirectory(rollbackApp);
    fs.renameSync(targetApp, rollbackApp);
    oldMoved = true;
    fs.renameSync(nextApp, targetApp);
    candidateInstalled = true;
    newChild = launchApplication(appExecutable(targetApp), [
      `--dsh-desktop-promotion-ready-file=${options.confirmationFile}`,
      `--dsh-desktop-promotion-request-id=${requestId}`,
    ], {
      ...process.env,
      DSH_DESKTOP_PROMOTION_READY_FILE: options.confirmationFile,
      DSH_DESKTOP_PROMOTION_REQUEST_ID: requestId,
    }, operations);
    await waitForConfirmation(options.confirmationFile, requestId, options.confirmationTimeoutMs, operations);
    const result = { status: 'promoted', requestId, targetApp, rollbackApp };
    writeResult(options.resultFile, result);
    return result;
  } catch (error) {
    try {
      if (newChild?.pid) {
        stopProcess(newChild.pid, operations);
      }
      if (candidateInstalled && fs.existsSync(targetApp)) removeDirectory(targetApp);
      if (oldMoved && fs.existsSync(rollbackApp)) fs.renameSync(rollbackApp, targetApp);
      if (oldMoved && fs.existsSync(appExecutable(targetApp))) {
        launchApplication(appExecutable(targetApp), [], { ...process.env }, operations);
      }
      if (fs.existsSync(nextApp)) removeDirectory(nextApp);
    } catch (rollbackError) {
      const failed = new PromotionError('新版本启动失败，且旧版本自动恢复失败。', rollbackError.message);
      writeResult(options.resultFile, { status: 'failed', requestId, error: failed.message, details: failed.details });
      throw failed;
    }
    const result = {
      status: oldMoved ? 'rolled_back' : 'failed',
      requestId,
      targetApp,
      error: error.message,
      details: error.details || '',
    };
    writeResult(options.resultFile, result);
    return result;
  }
}

/** Restore the one retained previous application after a separate native confirmation. */
async function rollbackInstalledApp(options, operations = {}) {
  const targetApp = assertApplication(options.targetApp, '当前');
  const rollbackApp = assertApplication(options.rollbackApp, '回滚');
  const requestId = options.requestId;
  if (!/^[A-Za-z0-9-]+$/.test(requestId || '')) throw new PromotionError('回滚请求编号无效。');
  assertSibling(targetApp, rollbackApp, '回滚目录');
  const retainedCurrent = path.join(path.dirname(targetApp), `.${path.basename(targetApp, '.app')}.reverted-${requestId}.app`);
  if (fs.existsSync(retainedCurrent)) throw new PromotionError('已有同编号的回滚暂存目录。', retainedCurrent);
  let currentMoved = false;
  let rollbackInstalled = false;
  let oldChild;
  try {
    await waitForParentExit(options.parentPid, options.parentExitTimeoutMs, operations);
    fs.renameSync(targetApp, retainedCurrent);
    currentMoved = true;
    fs.renameSync(rollbackApp, targetApp);
    rollbackInstalled = true;
    oldChild = launchApplication(appExecutable(targetApp), [], { ...process.env }, operations);
    await waitForChildAlive(oldChild.pid, options.startupTimeoutMs, operations);
    removeDirectory(retainedCurrent);
    const result = { status: 'rolled_back_manually', requestId, targetApp };
    writeResult(options.resultFile, result);
    return result;
  } catch (error) {
    try {
      if (oldChild?.pid) {
        stopProcess(oldChild.pid, operations);
      }
      if (rollbackInstalled && fs.existsSync(targetApp)) fs.renameSync(targetApp, rollbackApp);
      if (currentMoved && fs.existsSync(retainedCurrent)) fs.renameSync(retainedCurrent, targetApp);
      if (currentMoved && fs.existsSync(appExecutable(targetApp))) {
        launchApplication(appExecutable(targetApp), [], { ...process.env }, operations);
      }
    } catch (restoreError) {
      const failed = new PromotionError('回滚失败，且无法恢复替换前版本。', restoreError.message);
      writeResult(options.resultFile, { status: 'failed', requestId, error: failed.message, details: failed.details });
      throw failed;
    }
    const result = { status: 'rollback_failed', requestId, targetApp, error: error.message, details: error.details || '' };
    writeResult(options.resultFile, result);
    return result;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const options = {
    targetApp: argument('--target'),
    requestId: argument('--request'),
    parentPid: Number(argument('--parent-pid')),
    resultFile: argument('--result-file'),
  };
  const action = argument('--action') || 'promote';
  const result = action === 'rollback'
    ? await rollbackInstalledApp({ ...options, rollbackApp: argument('--rollback-app') })
    : await promoteInstalledApp({ ...options, candidateApp: argument('--candidate'), confirmationFile: argument('--confirmation-file') });
  console.log(JSON.stringify(result));
  if (result.status !== 'promoted' && result.status !== 'rolled_back_manually') process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    if (error.details) console.error(error.details);
    process.exitCode = 1;
  });
}

module.exports = {
  PromotionError,
  appExecutable,
  promoteInstalledApp,
  rollbackInstalledApp,
  waitForChildAlive,
  waitForConfirmation,
  waitForParentExit,
};
