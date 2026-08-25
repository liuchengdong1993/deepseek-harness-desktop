'use strict';

const path = require('path');

function installApplicationMenu(options) {
  const {
    Menu, app, shell, dialog, appName, projectUrl,
    webUrl, dataDir, restartHarness,
  } = options;
  const item = (label, role) => ({ label, role });
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: appName,
      submenu: [
        item(`关于 ${appName}`, 'about'),
        { type: 'separator' },
        item(`隐藏 ${appName}`, 'hide'),
        item('隐藏其他', 'hideOthers'),
        item('全部显示', 'unhide'),
        { type: 'separator' },
        item(`退出 ${appName}`, 'quit'),
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '打开 Harness 项目主页', click: () => shell.openExternal(projectUrl) },
        { type: 'separator' },
        process.platform === 'darwin' ? item('关闭窗口', 'close') : item('退出', 'quit'),
      ],
    },
    {
      label: '编辑',
      submenu: [
        item('撤销', 'undo'), item('重做', 'redo'), { type: 'separator' },
        item('剪切', 'cut'), item('复制', 'copy'), item('粘贴', 'paste'), item('全选', 'selectAll'),
      ],
    },
    {
      label: '视图',
      submenu: [
        item('重新加载', 'reload'), item('强制重新加载', 'forceReload'),
        { type: 'separator' },
        item('实际大小', 'resetZoom'), item('放大', 'zoomIn'), item('缩小', 'zoomOut'),
        { type: 'separator' }, item('进入全屏', 'togglefullscreen'),
      ],
    },
    {
      label: '窗口',
      submenu: [item('最小化', 'minimize'), item('缩放', 'zoom'), item('置于前台', 'front')],
    },
    {
      label: '帮助',
      submenu: [
        { label: '重启 Harness 服务', click: restartHarness },
        {
          label: `关于 ${appName}`,
          click: () => dialog.showMessageBox({
            type: 'info',
            title: `关于 ${appName}`,
            message: appName,
            detail: `版本 ${app.getVersion()}\n服务地址：${webUrl}\n数据目录：${dataDir}`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(options) {
  const {
    Menu, Tray, nativeImage, iconPath, appName, showWindow,
    reloadWindow, restartHarness, quit, log,
  } = options;
  try {
    const trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      log('未找到菜单栏图标，已跳过菜单栏入口。');
      return null;
    }
    const extension = path.extname(iconPath);
    const retinaPath = `${iconPath.slice(0, -extension.length)}@2x${extension}`;
    const retinaIcon = nativeImage.createFromPath(retinaPath);
    if (!retinaIcon.isEmpty()) {
      trayIcon.addRepresentation({
        scaleFactor: 2,
        width: 18,
        height: 18,
        buffer: retinaIcon.toPNG(),
      });
    }
    trayIcon.setTemplateImage(true);
    const tray = new Tray(trayIcon);
    tray.setToolTip(appName);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `打开 ${appName}`, click: showWindow },
      { label: '重新加载', click: reloadWindow },
      { label: '重启 Harness 服务', click: restartHarness },
      { type: 'separator' },
      { label: '退出', click: quit },
    ]));
    tray.on('click', showWindow);
    return tray;
  } catch (error) {
    log(`菜单栏入口创建失败：${error.message}`);
    return null;
  }
}

module.exports = { installApplicationMenu, createTray };
