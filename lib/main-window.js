'use strict';

const { userFacingErrorDetail } = require('./user-facing-errors');

function openExternal(shell, value, log) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      log(`已阻止不受支持的外部链接：${url.protocol}`);
      return;
    }
    shell.openExternal(value).catch((error) => log(`无法打开外部链接：${error.message}`));
  } catch {
    log('已阻止无效的外部链接。');
  }
}

function createMainWindow(options) {
  const {
    BrowserWindow, nativeTheme, shell, dialog, appName, url,
    isInternalUrl, isQuitting, log, onClosed,
  } = options;
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 920,
    minHeight: 620,
    title: appName,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isInternalUrl(target)) {
      window.loadURL(target).catch((error) => log(`页面跳转失败：${error.message}`));
    } else {
      openExternal(shell, target, log);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (isInternalUrl(target)) return;
    event.preventDefault();
    openExternal(shell, target, log);
  });

  let retries = 0;
  window.webContents.on('did-fail-load', (_event, errorCode, description, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || isQuitting()) return;
    retries += 1;
    log(`页面加载失败：${description}，第 ${retries} 次重试。`);
    if (retries > 5) {
      window.show();
      dialog.showErrorBox(appName, `页面加载失败：${userFacingErrorDetail('pageLoad')}`);
      return;
    }
    const timer = setTimeout(() => {
      if (!window.isDestroyed()) window.loadURL(url).catch(() => {});
    }, retries * 1000);
    timer.unref?.();
  });
  window.webContents.on('did-finish-load', () => {
    retries = 0;
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`渲染进程退出：${details.reason}`);
    if (details.reason === 'clean-exit' || isQuitting()) return;
    const timer = setTimeout(() => {
      if (!window.isDestroyed()) window.reload();
    }, 500);
    timer.unref?.();
  });
  window.on('closed', onClosed);
  window.loadURL(url).catch((error) => log(`页面加载失败：${error.message}`));
  return window;
}

module.exports = { createMainWindow, openExternal };
