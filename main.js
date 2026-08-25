'use strict';

const {
  app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme,
  Notification, globalShortcut, shell, dialog,
} = require('electron');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('./lib/config');
const harness = require('./lib/harness');
const backend = require('./lib/backend');
const { resolveBundledHarness } = require('./lib/harness-install');
const { HarnessService } = require('./lib/harness-service');
const { createMainWindow } = require('./lib/main-window');
const { installApplicationMenu, createTray } = require('./lib/app-menu');
const { setupAutoUpdate } = require('./lib/auto-update');
const { defaultCandidateRoot, readCandidate } = require('./lib/development-candidate');
const { readBundleManifest } = require('./lib/harness-bundle');
const {
  electronUserDataDirectory, optionEnabled, resolvePnpmBin, runtimeValue,
} = require('./lib/launch-options');
const {
  takePromotionRequest, takePromotionResult, writePromotionResult,
} = require('./lib/promotion-control');
const { handleBackendRequest } = require('./lib/backend-control');
const { userFacingErrorDetail } = require('./lib/user-facing-errors');

const SMOKE = optionEnabled('dsh-desktop-smoke') || process.env.DSH_DESKTOP_SMOKE === '1';
const APP_NAME = 'DeepSeek Harness';
const PROJECT_URL = 'https://github.com/deepseek-ai/deepseek-harness';

app.commandLine.appendSwitch('lang', 'zh-CN');
const isolatedUserDataDirectory = electronUserDataDirectory();
if (isolatedUserDataDirectory) app.setPath('userData', isolatedUserDataDirectory);

let cfg;
let harnessPath;
let service;
let mainWindow;
let tray;
let healthTimer;
let promotionTimer;
let backendTimer;
let cleanupUpdater = () => {};
let opening;
let quitting = false;
let promotionPending = false;

function log(line) {
  console.log('[dsh-desktop]', line);
}

function bundled(relativePath) {
  const unpacked = path.join(__dirname, '..', 'app.asar.unpacked', relativePath);
  return fs.existsSync(unpacked) ? unpacked : path.join(__dirname, relativePath);
}

function harnessInstallDir() {
  return runtimeValue('dsh-desktop-harness-dir', 'DSH_DESKTOP_HARNESS_DIR') || path.join(os.homedir(), '.dsh-desktop', 'harness');
}

function dshHome() {
  return runtimeValue('dsh-desktop-dsh-home', 'DSH_DESKTOP_DSH_HOME') || path.join(os.homedir(), '.dsh');
}

function candidateRoot() {
  return runtimeValue('dsh-desktop-candidate-root', 'DSH_DESKTOP_CANDIDATE_ROOT') || defaultCandidateRoot();
}

function desktopControlDirectory() {
  return runtimeValue('dsh-desktop-control-dir', 'DSH_DESKTOP_CONTROL_DIR') || path.join(path.dirname(config.CONFIG_FILE), 'desktop-control');
}

function runningApplicationBundle() {
  if (!app.isPackaged) return null;
  const suffix = path.join('Contents', 'MacOS', APP_NAME);
  const executable = path.resolve(process.execPath);
  if (!executable.endsWith(suffix)) return null;
  return executable.slice(0, -suffix.length - 1);
}

function resolveNode() {
  const candidates = [
    bundled(path.join('runtime', 'node')),
    process.env.DSH_NODE_BIN,
    path.join(os.homedir(), '.local', 'bin', 'node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const detected = String(execFileSync('zsh', ['-lc', 'command -v node'], { encoding: 'utf8' })).trim();
    if (detected) return detected.split('\n')[0];
  } catch { /* use PATH fallback */ }
  return 'node';
}

function webUrl() {
  return `http://127.0.0.1:${cfg.webPort}`;
}

function isHarnessUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && Number(url.port || 80) === cfg.webPort;
  } catch {
    return false;
  }
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch { /* notification availability must not affect the app */ }
}

function writePreviewReady() {
  const file = runtimeValue('dsh-desktop-preview-ready-file', 'DSH_DESKTOP_PREVIEW_READY_FILE');
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ port: cfg.webPort, pid: process.pid, readyAt: new Date().toISOString() })}\n`, 'utf8');
  } catch (error) {
    log(`无法写入候选预览就绪信号：${error.message}`);
  }
}

function writePromotionReady() {
  const file = runtimeValue('dsh-desktop-promotion-ready-file', 'DSH_DESKTOP_PROMOTION_READY_FILE');
  const requestId = runtimeValue('dsh-desktop-promotion-request-id', 'DSH_DESKTOP_PROMOTION_REQUEST_ID');
  if (!file || !requestId) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify({ requestId, port: cfg.webPort, pid: process.pid, readyAt: new Date().toISOString() })}\n`, {
      encoding: 'utf8', mode: 0o600,
    });
  } catch (error) {
    log(`无法写入版本替换就绪信号：${error.message}`);
  }
}

function writeSmokeResult(state) {
  const file = runtimeValue('dsh-desktop-smoke-result-file', 'DSH_DESKTOP_SMOKE_RESULT_FILE');
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    log(`无法写入冒烟测试结果：${error.message}`);
  }
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (service && !quitting) ensureApplicationOpen().catch((error) => log(error.message));
}

function openWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = createMainWindow({
    BrowserWindow, nativeTheme, shell, dialog,
    appName: APP_NAME,
    url: webUrl(),
    isInternalUrl: isHarnessUrl,
    isQuitting: () => quitting,
    log,
    onClosed: () => { mainWindow = null; },
  });
  return mainWindow;
}

async function restartHarness() {
  try {
    const ready = await service.restart();
    if (!ready) throw new Error('Harness 服务未能重新启动。');
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(webUrl());
  } catch (error) {
    log(error.message);
    if (!quitting) dialog.showErrorBox(APP_NAME, `重启失败：${userFacingErrorDetail('harnessRestart')}`);
  }
}

async function openApplication() {
  while (!quitting) {
    try {
      if (await service.start()) {
        openWindow();
        return;
      }
    } catch (error) {
      log(error.message);
    }
    const result = await dialog.showMessageBox({
      type: 'error',
      title: APP_NAME,
      message: 'Harness 服务未能启动',
      detail: userFacingErrorDetail('harnessStart'),
      buttons: ['重试', '退出'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) {
      app.quit();
      return;
    }
  }
}

function ensureApplicationOpen() {
  if (opening) return opening;
  const operation = openApplication();
  const tracked = operation.finally(() => {
    if (opening === tracked) opening = null;
  });
  opening = tracked;
  return tracked;
}

function startHealthMonitor() {
  let recovering = false;
  healthTimer = setInterval(async () => {
    if (quitting || recovering || await backend.healthCheck(cfg.webPort)) return;
    recovering = true;
    log('Harness 服务已断开，正在恢复。');
    try {
      const ready = await service.start();
      if (ready && mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(webUrl());
    } catch (error) {
      log(`Harness 恢复失败：${error.message}`);
    } finally {
      recovering = false;
    }
  }, 5000);
  healthTimer.unref?.();
}

function showPromotionResult() {
  let result;
  try {
    result = takePromotionResult(desktopControlDirectory());
  } catch (error) {
    log(error.message);
    return;
  }
  if (!result || result.status === 'promoted' || result.status === 'rolled_back_manually') return;
  const message = result.status === 'rolled_back'
    ? '候选版本未通过启动确认，已自动恢复上一版本。'
    : result.status === 'rollback_failed'
      ? '桌面版本回滚未能完成，已恢复替换前版本。'
      : '桌面版本替换未能完成，当前版本未被替换。';
  dialog.showMessageBox({
    type: 'error',
    title: APP_NAME,
    message,
    detail: userFacingErrorDetail('promotion'),
    buttons: ['知道了'],
  }).catch(() => {});
}

async function processPromotionRequest() {
  if (quitting || promotionPending) return;
  let request;
  try {
    request = takePromotionRequest(desktopControlDirectory());
  } catch (error) {
    log(error.message);
    return;
  }
  if (!request) return;
  promotionPending = true;
  try {
    const targetApp = runningApplicationBundle();
    if (!targetApp) {
      writePromotionResult(desktopControlDirectory(), {
        status: 'rejected', requestId: request.id,
        error: '只能从已安装的 DeepSeek Harness 桌面应用请求版本替换。',
      });
      return;
    }
    if (request.action !== 'promote' && request.action !== 'rollback') {
      writePromotionResult(desktopControlDirectory(), {
        status: 'rejected', requestId: request.id,
        error: '当前版本暂不支持该桌面开发操作。',
      });
      return;
    }
    const candidate = readCandidate({ root: candidateRoot(), id: request.candidateId });
    if (request.action === 'promote' && candidate.status !== 'previewed') {
      writePromotionResult(desktopControlDirectory(), {
        status: 'rejected', requestId: request.id,
        error: '候选版本尚未完成独立预览，不能替换当前应用。',
      });
      return;
    }
    const rollbackApp = path.join(path.dirname(targetApp), `.${path.basename(targetApp, '.app')}.rollback.app`);
    if (request.action === 'rollback' && !fs.existsSync(rollbackApp)) {
      writePromotionResult(desktopControlDirectory(), {
        status: 'rejected', requestId: request.id,
        error: '没有可用于回滚的上一版本。',
      });
      return;
    }
    const isRollback = request.action === 'rollback';
    const answer = await dialog.showMessageBox({
      type: 'warning',
      title: isRollback ? '确认回滚桌面版本' : '确认替换桌面版本',
      message: isRollback
        ? '是否恢复 DeepSeek Harness 的上一版本？'
        : '候选版本已完成隔离构建和预览。是否替换当前 DeepSeek Harness？',
      detail: isRollback
        ? `关联候选编号：${candidate.id}\n回滚后将重新启动上一版本。`
        : `候选编号：${candidate.id}\n替换后将自动启动新版本；服务未就绪会恢复当前版本。`,
      buttons: ['取消', isRollback ? '确认回滚' : '确认替换'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) {
      writePromotionResult(desktopControlDirectory(), {
        status: 'cancelled', requestId: request.id, candidateId: candidate.id,
      });
      return;
    }
    const helper = bundled(path.join('lib', 'promotion-helper.js'));
    const confirmationFile = path.join(desktopControlDirectory(), 'promotion-ready.json');
    const resultFile = path.join(desktopControlDirectory(), 'promotion-result.json');
    const child = spawn(resolveNode(), [helper,
      '--action', request.action,
      '--target', targetApp,
      '--request', request.id,
      '--parent-pid', String(process.pid),
      '--result-file', resultFile,
      ...(isRollback
        ? ['--rollback-app', rollbackApp]
        : ['--candidate', candidate.appPath, '--confirmation-file', confirmationFile]),
    ], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    if (!child || !Number.isInteger(child.pid)) {
      throw new Error('无法启动桌面版本替换守护进程。');
    }
    child.unref?.();
    quitting = true;
    app.quit();
  } catch (error) {
    log(`处理桌面版本替换请求失败：${error.message}`);
    try {
      writePromotionResult(desktopControlDirectory(), {
        status: 'failed', requestId: request.id, error: error.message,
      });
    } catch { /* write errors must not crash the desktop app */ }
  } finally {
    promotionPending = false;
  }
}

function startPromotionMonitor() {
  const timer = setInterval(() => {
    processPromotionRequest().catch((error) => log(error.message));
  }, 750);
  timer.unref?.();
  promotionTimer = timer;
  processPromotionRequest().catch((error) => log(error.message));
}

/**
 * GUI 后端控制通道：插件中心（Harness GUI 内）写 backend-request.json，
 * 这里执行重启/状态查询并回执。restart 提供方抛错时通道回 ok:false。
 */
function backendStatusSnapshot() {
  return {
    owned: Boolean(service?.owned),
    pid: service?.process?.pid ?? null,
    startedAt: service?.startedAt ?? null,
    port: cfg.webPort,
  };
}

async function processBackendRequest() {
  if (quitting) return;
  try {
    await handleBackendRequest(desktopControlDirectory(), {
      restart: async () => {
        const ready = await service.restart();
        if (!ready) throw new Error('Harness 服务未能重新启动。');
        if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(webUrl());
        return backendStatusSnapshot();
      },
      status: backendStatusSnapshot,
    });
  } catch (error) {
    log(error.message);
  }
}

function startBackendControlMonitor() {
  const timer = setInterval(() => {
    processBackendRequest().catch((error) => log(error.message));
  }, 500);
  timer.unref?.();
  backendTimer = timer;
  processBackendRequest().catch((error) => log(error.message));
}

async function runSmoke() {
  const started = await service.start();
  const state = {
    harnessPath,
    hasCliBin: Boolean(harness.cliBin(harnessPath)),
    backend: {
      running: await backend.healthCheck(cfg.webPort),
      owned: service.owned,
      port: cfg.webPort,
    },
    locale: 'zh-CN',
  };
  await service.stop();
  writeSmokeResult(state);
  console.log(`SMOKE_STATE=${JSON.stringify(state, null, 2)}`);
  if (!started || !state.hasCliBin || !state.backend.running || !state.backend.owned) process.exitCode = 1;
  app.quit();
}

async function init() {
  cfg = config.load();
  fs.mkdirSync(desktopControlDirectory(), { recursive: true, mode: 0o700 });
  const harnessArchive = bundled('harness.tar');
  const harnessManifest = bundled('harness.bundle.json');
  if (app.isPackaged) readBundleManifest(harnessManifest);
  const developmentHarness = app.isPackaged ? null : harness.detectHarnessPath(cfg.harnessPath);
  harnessPath = developmentHarness || await resolveBundledHarness({
    devPath: path.join(__dirname, 'harness'),
    installedPath: harnessInstallDir(),
    archivePath: harnessArchive,
    manifestPath: harnessManifest,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    log,
  });
  const nodeBin = resolveNode();
  const pnpmBin = resolvePnpmBin(bundled(path.join('runtime', 'pnpm', 'bin', 'pnpm.cjs')));
  if (app.isPackaged && !pnpmBin) {
    throw new Error('安装包缺少内置 pnpm，无法提供完整的插件管理能力。');
  }
  service = new HarnessService({
    backend,
    cliBin: harness.cliBin(harnessPath),
    port: cfg.webPort,
    nodeBin,
    cwd: harnessPath,
    env: {
      DSH_HOME: dshHome(),
      // The official code-agent session invokes the candidate command inside a
      // user-selected desktop source workspace. It can build only from these
      // already-running, locally verified artifacts; it never replaces this app.
      DSH_DESKTOP_BUNDLE_ARCHIVE: harnessArchive,
      DSH_DESKTOP_BUNDLE_MANIFEST: harnessManifest,
      DSH_DESKTOP_RUNTIME_NODE: nodeBin,
      ...(pnpmBin ? {
        DSH_PNPM_BIN: pnpmBin,
        DSH_DESKTOP_RUNTIME_PNPM: path.dirname(path.dirname(pnpmBin)),
      } : {}),
      DSH_DESKTOP_CANDIDATE_ROOT: candidateRoot(),
      DSH_DESKTOP_CONTROL_DIR: desktopControlDirectory(),
      DSH_DESKTOP_CURRENT_APP: runningApplicationBundle() || '',
    },
    log,
  });

  if (SMOKE) return runSmoke();

  installApplicationMenu({
    Menu, app, shell, dialog,
    appName: APP_NAME,
    projectUrl: PROJECT_URL,
    webUrl: webUrl(),
    dataDir: dshHome(),
    restartHarness,
  });
  tray = createTray({
    Menu, Tray, nativeImage,
    iconPath: bundled(path.join('assets', 'trayTemplate.png')),
    appName: APP_NAME,
    showWindow: showMainWindow,
    reloadWindow: () => mainWindow?.webContents.reloadIgnoringCache(),
    restartHarness,
    quit: () => app.quit(),
    log,
  });
  await ensureApplicationOpen();
  writePreviewReady();
  writePromotionReady();
  startHealthMonitor();
  startPromotionMonitor();
  startBackendControlMonitor();
  showPromotionResult();
  if (!optionEnabled('dsh-desktop-preview') && process.env.DSH_DESKTOP_PREVIEW !== '1') {
    cleanupUpdater = setupAutoUpdate({ app, appName: APP_NAME, notify, log });
  }
  globalShortcut.register('CommandOrControl+Shift+Space', showMainWindow);
}

const gotLock = SMOKE || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  if (!SMOKE) app.on('second-instance', showMainWindow);
  app.whenReady().then(init).catch((error) => {
    log(error.stack || error.message);
    dialog.showErrorBox(APP_NAME, `应用启动失败：${userFacingErrorDetail('appStart')}`);
    app.quit();
  });
}

app.on('activate', showMainWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  if (healthTimer) clearInterval(healthTimer);
  if (promotionTimer) clearInterval(promotionTimer);
  if (backendTimer) clearInterval(backendTimer);
  cleanupUpdater();
  if (app.isReady()) globalShortcut.unregisterAll();
  service?.stopImmediately();
  tray?.destroy();
});
