'use strict';

function setupAutoUpdate(options) {
  const { app, appName, notify, log } = options;
  if (!app.isPackaged) return () => {};
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (error) {
    log(`自动更新不可用：${error.message}`);
    return () => {};
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => notify(appName, `发现新版本 ${info.version}，正在下载。`));
  autoUpdater.on('update-downloaded', (info) => notify(appName, `版本 ${info.version} 已下载，退出应用后自动安装。`));
  autoUpdater.on('error', (error) => log(`自动更新失败：${error.message}`));
  const check = () => autoUpdater.checkForUpdates().catch((error) => log(`检查更新失败：${error.message}`));
  const initialTimer = setTimeout(check, 10000);
  const interval = setInterval(check, 4 * 60 * 60 * 1000);
  initialTimer.unref?.();
  interval.unref?.();
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}

module.exports = { setupAutoUpdate };
