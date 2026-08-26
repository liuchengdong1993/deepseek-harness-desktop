'use strict';

// Build a desktop candidate away from the running app. This module intentionally
// stops before replacement: a verified candidate is an auditable input to the
// later preview and user-confirmed promotion transaction.

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const backend = require('./backend');
const { verifyBundleManifest } = require('./harness-bundle');

const PRODUCT_NAME = 'DeepSeek Harness';
const SOURCE_EXCLUDES = new Set(['.git', 'dist', 'harness.tar', 'node_modules']);
const PREVIEW_READY_TIMEOUT_MS = 10 * 60 * 1000;

class CandidateError extends Error {
  constructor(message, details = '') {
    super(message);
    this.name = 'CandidateError';
    this.details = details;
  }
}

function defaultCandidateRoot() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'DeepSeek Harness', 'candidates');
}

function candidateId(now = Date.now(), random = crypto.randomBytes(4).toString('hex')) {
  return `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${random}`;
}

function isDesktopSource(source) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    return manifest.name === 'dsh-desktop' && manifest.main === 'main.js';
  } catch {
    return false;
  }
}

function requireFile(value, label) {
  if (!value || !fs.existsSync(value)) throw new CandidateError(`${label}不存在。`, String(value || ''));
  return path.resolve(value);
}

function requireDirectory(value, label) {
  const directory = requireFile(value, label);
  if (!fs.statSync(directory).isDirectory()) throw new CandidateError(`${label}不是目录。`, directory);
  return directory;
}

function copySource(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => !SOURCE_EXCLUDES.has(path.basename(entry)),
  });
}

function findSingleDmg(distDir) {
  const candidates = fs.readdirSync(distDir)
    .filter((name) => /^DeepSeek-Harness-.+-arm64\.dmg$/.test(name))
    .map((name) => path.join(distDir, name));
  if (candidates.length !== 1) {
    throw new CandidateError('候选构建未生成唯一的 arm64 DMG。', candidates.join('\n'));
  }
  return candidates[0];
}

function findApp(distDir) {
  const appPath = path.join(distDir, 'mac-arm64', `${PRODUCT_NAME}.app`);
  if (!fs.existsSync(path.join(appPath, 'Contents', 'MacOS'))) {
    throw new CandidateError('候选构建未生成可运行的应用程序。', appPath);
  }
  return appPath;
}

function candidateDirectory(root, id) {
  if (!/^[A-Za-z0-9-]+$/.test(id || '')) throw new CandidateError('候选编号无效。', String(id || ''));
  return path.join(path.resolve(root || defaultCandidateRoot()), id);
}

function containedPath(root, relative, label) {
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new CandidateError(`${label}不在候选目录中。`, relative);
  }
  return resolved;
}

function readCandidate(options) {
  const directory = candidateDirectory(options.root, options.id);
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.join(directory, 'candidate.json'), 'utf8'));
  } catch (error) {
    throw new CandidateError('候选记录无法读取。', error.message);
  }
  if (record.id !== options.id || (record.status !== 'verified' && record.status !== 'previewed')) {
    throw new CandidateError('候选版本尚未通过隔离验证。', directory);
  }
  const appPath = containedPath(directory, record.appPath, '候选应用程序');
  const dmgPath = containedPath(directory, record.dmgPath, '候选安装包');
  if (!fs.existsSync(path.join(appPath, 'Contents', 'MacOS')) || !fs.existsSync(dmgPath)) {
    throw new CandidateError('候选产物已丢失或不完整。', directory);
  }
  return { ...record, directory, appPath, dmgPath };
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForFile(file, timeoutMs = PREVIEW_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (fs.existsSync(file)) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new CandidateError('候选预览未能在限定时间内就绪。', file));
      setTimeout(check, 200);
    };
    check();
  });
}

function processRunning(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPreviewReady(file, port, pid) {
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CandidateError('候选预览就绪信号无法读取。', error.message);
  }
  if (ready?.port !== port || ready?.pid !== pid || typeof ready.readyAt !== 'string') {
    throw new CandidateError('候选预览就绪信号无效。', file);
  }
  return ready;
}

async function requireLivePreview(candidate, options) {
  const preview = candidate.preview;
  if (!preview || !Number.isInteger(preview.port) || !Number.isInteger(preview.pid)) {
    throw new CandidateError('候选版本缺少有效预览记录，请重新预览。', candidate.id);
  }
  const isProcessRunning = options.isProcessRunning || processRunning;
  if (!isProcessRunning(preview.pid)) {
    throw new CandidateError('候选预览进程已退出，请重新预览。', candidate.id);
  }
  const healthCheck = options.healthCheck || backend.healthCheck;
  if (!await healthCheck(preview.port)) {
    throw new CandidateError('候选预览中的 Harness 服务不可用，请重新预览。', `http://127.0.0.1:${preview.port}`);
  }
  return preview;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function previewEnvironment(environment = process.env) {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (name.startsWith('DSH_DESKTOP_')) delete result[name];
  }
  return { ...result, DSH_DESKTOP_PREVIEW: '1' };
}

/**
 * Ask the running desktop process to present a native confirmation dialog.
 * This deliberately cannot replace an application by itself.
 */
async function requestPromotion(options) {
  const action = options.action || 'promote';
  if (action !== 'promote' && action !== 'rollback') {
    throw new CandidateError('桌面开发操作无效。', String(action));
  }
  const candidate = readCandidate(options);
  if (action === 'promote' && candidate.status !== 'previewed') {
    throw new CandidateError('请先完成候选版本预览，再请求替换。', candidate.id);
  }
  const controlDirectory = requireFile(options.controlDirectory, '桌面受控通道目录');
  if (!fs.statSync(controlDirectory).isDirectory()) {
    throw new CandidateError('桌面受控通道目录无效。', controlDirectory);
  }
  const requestFile = path.join(controlDirectory, 'promotion-request.json');
  if (fs.existsSync(requestFile)) {
    throw new CandidateError('已有桌面版本替换请求等待确认。', requestFile);
  }
  if (action === 'promote') await requireLivePreview(candidate, options);
  const now = options.now || Date.now();
  const request = {
    id: candidateId(now, options.random),
    action,
    candidateId: candidate.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  };
  atomicWriteJson(requestFile, request);
  return { ...request, requestFile };
}

/**
 * Start a verified candidate independently of the installed application.
 * @param {object} options - candidate identity and injectable process/readiness operations.
 * @returns {Promise<object>} preview endpoint and child-process identity after readiness.
 */
async function startPreview(options) {
  const candidate = readCandidate(options);
  const getPort = options.getPort || findOpenPort;
  const launch = options.launch || spawn;
  const wait = options.waitForReady || waitForFile;
  const port = await getPort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CandidateError('候选预览端口无效。', String(port));
  const previewRoot = path.join(candidate.directory, 'preview');
  const readyFile = path.join(previewRoot, 'ready.json');
  fs.mkdirSync(previewRoot, { recursive: true });
  fs.rmSync(readyFile, { force: true });
  const executable = path.join(candidate.appPath, 'Contents', 'MacOS', PRODUCT_NAME);
  const child = launch(executable, [
    '--dsh-desktop-preview=1',
    `--dsh-desktop-preview-ready-file=${readyFile}`,
    `--dsh-desktop-web-port=${port}`,
    `--dsh-desktop-config-dir=${path.join(previewRoot, 'config')}`,
    `--dsh-desktop-dsh-home=${path.join(previewRoot, 'dsh-home')}`,
    `--dsh-desktop-harness-dir=${path.join(previewRoot, 'harness')}`,
  ], {
    cwd: candidate.appPath,
    detached: true,
    stdio: 'ignore',
    env: {
      ...previewEnvironment(options.environment),
      // Kept for non-bundled test runners. macOS production launches use the
      // explicit CLI arguments above because LaunchServices can sanitize env.
    },
  });
  if (!child || !Number.isInteger(child.pid)) throw new CandidateError('候选预览进程未能启动。');
  child.unref?.();
  try {
    await wait(readyFile, options.previewReadyTimeoutMs || PREVIEW_READY_TIMEOUT_MS);
  } catch (error) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* process already exited */ }
    throw error;
  }
  const ready = readPreviewReady(readyFile, port, child.pid);
  const record = { ...candidate, status: 'previewed', preview: { port, pid: child.pid, readyAt: ready.readyAt } };
  fs.writeFileSync(path.join(candidate.directory, 'candidate.json'), `${JSON.stringify({
    id: candidate.id,
    source: candidate.source,
    createdAt: candidate.createdAt,
    status: record.status,
    appPath: candidate.appPath.slice(candidate.directory.length + 1),
    dmgPath: candidate.dmgPath.slice(candidate.directory.length + 1),
    preview: record.preview,
  }, null, 2)}\n`, 'utf8');
  return record;
}

async function runStep(run, label, file, args, cwd) {
  const result = await run(file, args, { cwd });
  if (result.code !== 0) {
    throw new CandidateError(`${label}失败。`, [result.stdout, result.stderr].filter(Boolean).join('\n'));
  }
}

/**
 * Build and verify a desktop candidate in an isolated copy of its selected source.
 * @param {object} options - candidate source, bundled runtime artifacts and command runner.
 * @returns {Promise<object>} immutable record consumed by preview/promotion callers.
 */
async function prepareCandidate(options) {
  const source = requireFile(options.source, '桌面源码目录');
  if (!isDesktopSource(source)) throw new CandidateError('所选目录不是 DeepSeek Harness 桌面版源码。', source);
  const archive = requireFile(options.harnessArchive, '当前 Harness 归档');
  const harnessManifest = requireFile(options.harnessManifest, 'Harness 归档清单');
  const nodeRuntime = requireFile(options.nodeRuntime, '当前 Node 运行时');
  const pnpmRuntime = requireDirectory(options.pnpmRuntime, '当前 pnpm 运行时');
  requireFile(path.join(pnpmRuntime, 'bin', 'pnpm.cjs'), '当前 pnpm 启动脚本');
  const root = path.resolve(options.root || defaultCandidateRoot());
  const id = options.id || candidateId(options.now, options.random);
  const staging = path.join(root, `${id}.staging`);
  const finalPath = path.join(root, id);
  const run = options.run;
  if (typeof run !== 'function') throw new TypeError('prepareCandidate requires a command runner');
  if (fs.existsSync(staging) || fs.existsSync(finalPath)) throw new CandidateError('候选编号已存在，请重新创建候选。', id);

  fs.mkdirSync(root, { recursive: true });
  try {
    const bundle = verifyBundleManifest({
      archive,
      manifestFile: harnessManifest,
      patchDirectory: path.join(source, 'patches'),
    });
    copySource(source, staging);
    fs.copyFileSync(archive, path.join(staging, 'harness.tar'));
    fs.copyFileSync(harnessManifest, path.join(staging, 'harness.bundle.json'));
    const runtimeNode = path.join(staging, 'runtime', 'node');
    if (!fs.existsSync(runtimeNode)) {
      fs.mkdirSync(path.dirname(runtimeNode), { recursive: true });
      fs.copyFileSync(nodeRuntime, runtimeNode);
      fs.chmodSync(runtimeNode, 0o755);
    }
    const runtimePnpm = path.join(staging, 'runtime', 'pnpm');
    fs.rmSync(runtimePnpm, { recursive: true, force: true });
    fs.cpSync(pnpmRuntime, runtimePnpm, { recursive: true, force: true });

    await runStep(run, '安装候选依赖', 'npm', ['ci'], staging);
    await runStep(run, '运行桌面验证', 'npm', ['run', 'verify'], staging);
    await runStep(run, '构建候选安装包', 'npm', ['run', 'dist'], staging);

    const distDir = path.join(staging, 'dist');
    const dmgPath = findSingleDmg(distDir);
    await runStep(run, '校验候选安装包', '/usr/bin/hdiutil', ['verify', dmgPath], staging);
    const appPath = findApp(distDir);
    const record = {
      id,
      source,
      createdAt: new Date(options.now || Date.now()).toISOString(),
      status: 'verified',
      appPath: path.relative(staging, appPath),
      dmgPath: path.relative(staging, dmgPath),
      bundle: {
        harnessRevision: bundle.harnessRevision,
        archiveSha256: bundle.archive.sha256,
        patches: bundle.patches,
      },
    };
    fs.writeFileSync(path.join(staging, 'candidate.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.renameSync(staging, finalPath);
    return {
      ...record,
      directory: finalPath,
      appPath: path.join(finalPath, record.appPath),
      dmgPath: path.join(finalPath, record.dmgPath),
    };
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  CandidateError,
  candidateId,
  defaultCandidateRoot,
  isDesktopSource,
  prepareCandidate,
  processRunning,
  previewEnvironment,
  requireLivePreview,
  readCandidate,
  requestPromotion,
  startPreview,
};
