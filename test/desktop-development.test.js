'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { prepareOptions } = require('../scripts/desktop-development');

test('源码目录可独立提供受控候选构建所需运行时', () => {
  const source = path.resolve('/private/tmp/dsh-desktop-source');
  assert.deepEqual(prepareOptions(source, {}), {
    source,
    harnessArchive: path.join(source, 'harness.tar'),
    harnessManifest: path.join(source, 'harness.bundle.json'),
    nodeRuntime: path.join(source, 'runtime', 'node'),
    pnpmRuntime: path.join(source, 'runtime', 'pnpm'),
    root: undefined,
  });
});

test('运行中的桌面应用传入的受控路径优先于源码回退', () => {
  const source = path.resolve('/private/tmp/dsh-desktop-source');
  const environment = {
    DSH_DESKTOP_BUNDLE_ARCHIVE: '/run/harness.tar',
    DSH_DESKTOP_BUNDLE_MANIFEST: '/run/harness.bundle.json',
    DSH_DESKTOP_RUNTIME_NODE: '/run/node',
    DSH_DESKTOP_RUNTIME_PNPM: '/run/pnpm',
    DSH_DESKTOP_CANDIDATE_ROOT: '/run/candidates',
  };
  assert.deepEqual(prepareOptions(source, environment), {
    source,
    harnessArchive: environment.DSH_DESKTOP_BUNDLE_ARCHIVE,
    harnessManifest: environment.DSH_DESKTOP_BUNDLE_MANIFEST,
    nodeRuntime: environment.DSH_DESKTOP_RUNTIME_NODE,
    pnpmRuntime: environment.DSH_DESKTOP_RUNTIME_PNPM,
    root: environment.DSH_DESKTOP_CANDIDATE_ROOT,
  });
});
