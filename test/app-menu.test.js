'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createTray } = require('../lib/app-menu');

test('菜单栏图标使用 18pt 基础图和 2 倍高清表示', () => {
  const representations = [];
  const paths = [];
  const baseIcon = {
    isEmpty: () => false,
    addRepresentation: (value) => representations.push(value),
    setTemplateImage: () => {},
  };
  const retinaIcon = {
    isEmpty: () => false,
    toPNG: () => Buffer.from('retina'),
  };
  const nativeImage = {
    createFromPath: (value) => {
      paths.push(value);
      return paths.length === 1 ? baseIcon : retinaIcon;
    },
  };
  class Tray {
    setToolTip() {}
    setContextMenu() {}
    on() {}
  }

  createTray({
    Menu: { buildFromTemplate: () => ({}) },
    Tray,
    nativeImage,
    iconPath: '/tmp/trayTemplate.png',
    appName: 'DeepSeek Harness',
    showWindow: () => {},
    reloadWindow: () => {},
    restartHarness: () => {},
    quit: () => {},
    log: () => {},
  });

  assert.deepEqual(paths, ['/tmp/trayTemplate.png', '/tmp/trayTemplate@2x.png']);
  assert.equal(representations.length, 1);
  assert.equal(representations[0].scaleFactor, 2);
  assert.equal(representations[0].width, 18);
  assert.equal(representations[0].height, 18);
});
