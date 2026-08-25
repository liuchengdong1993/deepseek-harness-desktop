'use strict';

const fs = require('fs');
const path = require('path');

/**
 * GUI → 桌面层 后端控制通道：文件式请求/回执，位于 DSH_DESKTOP_CONTROL_DIR。
 * Harness 侧（插件中心的 Host 半）写入 backend-request.json；桌面主进程轮询，
 * 执行 restart-backend 或 backend-status 后写 backend-result.json。
 * 与 promotion-control 同款纪律：原子写（tmp+rename）、请求编号格式校验、
 * 动作白名单、过期拒绝、损坏请求删除并报错。
 */

const REQUEST_FILE = 'backend-request.json';
const RESULT_FILE = 'backend-result.json';
const ACTIONS = new Set(['restart-backend', 'backend-status']);

function controlFile(directory, name) {
  if (!directory) throw new Error('未配置桌面受控通道目录。');
  return path.join(path.resolve(directory), name);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function validateRequest(request, now = Date.now()) {
  if (!request || typeof request !== 'object') throw new Error('后端控制请求格式无效。');
  if (!/^[A-Za-z0-9-]+$/.test(request.id || '')) throw new Error('后端控制请求编号无效。');
  if (!ACTIONS.has(request.action)) throw new Error('后端控制操作无效。');
  const expiresAt = Date.parse(request.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt < now) throw new Error('后端控制请求已过期。');
  return request;
}

function takeBackendRequest(directory, now = Date.now()) {
  const file = controlFile(directory, REQUEST_FILE);
  if (!fs.existsSync(file)) return null;
  let request;
  try {
    request = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw new Error(`后端控制请求无法读取：${error.message}`);
  }
  fs.rmSync(file, { force: true });
  return validateRequest(request, now);
}

function writeBackendResult(directory, result) {
  atomicWriteJson(controlFile(directory, RESULT_FILE), {
    ...result,
    completedAt: new Date().toISOString(),
  });
}

/**
 * Handle one pending backend control request.
 * @param {string} directory - the desktop control directory.
 * @param {{ restart: () => Promise<object>, status: () => object }} providers
 *   `restart` must throw on failure so the GUI receives ok:false + error.
 * @returns {Promise<object|null>} the written result, or null when no request was pending.
 */
async function handleBackendRequest(directory, providers) {
  const request = takeBackendRequest(directory);
  if (!request) return null;
  let result;
  try {
    const payload = request.action === 'restart-backend'
      ? await providers.restart()
      : providers.status();
    result = { id: request.id, ok: true, action: request.action, ...payload };
  } catch (error) {
    result = {
      id: request.id, ok: false, action: request.action, error: String(error.message || error),
    };
  }
  writeBackendResult(directory, result);
  return result;
}

module.exports = {
  ACTIONS, REQUEST_FILE, RESULT_FILE, atomicWriteJson, handleBackendRequest,
  takeBackendRequest, validateRequest, writeBackendResult,
};
