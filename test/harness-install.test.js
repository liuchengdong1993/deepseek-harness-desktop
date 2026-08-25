'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeBundleManifest } = require('../lib/harness-bundle');
const { resolveBundledHarness } = require('../lib/harness-install');

function createBuiltHarness(root, marker = 'cli') {
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), `${marker}\n`);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dev: path.join(root, 'dev'),
    installed: path.join(root, 'installed'),
    archive: path.join(root, 'harness.tar'),
    manifest: path.join(root, 'harness.bundle.json'),
    patches: path.join(root, 'patches'),
  };
}

function writeManifest(paths) {
  fs.mkdirSync(paths.patches, { recursive: true });
  writeBundleManifest({
    archive: paths.archive,
    output: paths.manifest,
    harnessRevision: '47f943859bef60e4160492346772ded9b24f765a',
    patchDirectory: paths.patches,
  });
}

test('开发态优先使用已构建的本地 Harness', async (t) => {
  const paths = fixture(t);
  createBuiltHarness(paths.dev);
  assert.equal(await resolveBundledHarness({
    devPath: paths.dev,
    installedPath: paths.installed,
    archivePath: paths.archive,
    appVersion: '0.1.5',
    isPackaged: false,
  }), paths.dev);
});

test('新归档先进入暂存目录，校验后再替换旧 Harness', async (t) => {
  const paths = fixture(t);
  createBuiltHarness(paths.installed, 'old');
  fs.writeFileSync(paths.archive, 'archive-v2');
  const result = await resolveBundledHarness({
    devPath: paths.dev,
    installedPath: paths.installed,
    archivePath: paths.archive,
    appVersion: '0.1.5',
    isPackaged: true,
    extract: async (_archive, staged) => {
      createBuiltHarness(staged, 'new');
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result, paths.installed);
  assert.equal(fs.readFileSync(path.join(paths.installed, 'apps', 'cli', 'lib', 'bin.js'), 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(path.join(paths.installed, '.desktop-bundle-version'), 'utf8'), '0.1.5:0.1.5\n');
});

test('无效新归档不会破坏仍可运行的旧 Harness', async (t) => {
  const paths = fixture(t);
  createBuiltHarness(paths.installed, 'old');
  fs.writeFileSync(paths.archive, 'broken');
  const result = await resolveBundledHarness({
    devPath: paths.dev,
    installedPath: paths.installed,
    archivePath: paths.archive,
    appVersion: '0.1.5',
    isPackaged: true,
    extract: async () => ({ code: 1, stdout: '', stderr: '归档损坏' }),
  });
  assert.equal(result, paths.installed);
  assert.equal(fs.readFileSync(path.join(paths.installed, 'apps', 'cli', 'lib', 'bin.js'), 'utf8'), 'old\n');
});

test('同一桌面版本的候选会按 Harness 归档指纹替换旧运行层', async (t) => {
  const paths = fixture(t);
  fs.writeFileSync(paths.archive, 'archive-v1');
  writeManifest(paths);
  await resolveBundledHarness({
    devPath: paths.dev,
    installedPath: paths.installed,
    archivePath: paths.archive,
    manifestPath: paths.manifest,
    appVersion: '0.1.5',
    isPackaged: true,
    extract: async (_archive, staged) => {
      createBuiltHarness(staged, 'v1');
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  fs.writeFileSync(paths.archive, 'archive-v2');
  writeManifest(paths);
  await resolveBundledHarness({
    devPath: paths.dev,
    installedPath: paths.installed,
    archivePath: paths.archive,
    manifestPath: paths.manifest,
    appVersion: '0.1.5',
    isPackaged: true,
    extract: async (_archive, staged) => {
      createBuiltHarness(staged, 'v2');
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(fs.readFileSync(path.join(paths.installed, 'apps', 'cli', 'lib', 'bin.js'), 'utf8'), 'v2\n');
  const marker = fs.readFileSync(path.join(paths.installed, '.desktop-bundle-version'), 'utf8').trim();
  assert.match(marker, /^0\.1\.5:[a-f0-9]{64}$/);
});
