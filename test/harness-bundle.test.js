'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BundleError, createBundleManifest, verifyBundleManifest, writeBundleManifest,
} = require('../lib/harness-bundle');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const patches = path.join(root, 'patches');
  fs.mkdirSync(patches, { recursive: true });
  fs.writeFileSync(path.join(patches, 'desktop.patch'), 'patch-v1\n');
  const archive = path.join(root, 'harness.tar');
  fs.writeFileSync(archive, 'archive-v1\n');
  const manifest = path.join(root, 'harness.bundle.json');
  writeBundleManifest({
    archive,
    output: manifest,
    harnessRevision: '47f943859bef60e4160492346772ded9b24f765a',
    patchDirectory: patches,
  });
  return { archive, manifest, patches };
}

test('归档清单记录归档和桌面补丁指纹', (t) => {
  const paths = fixture(t);
  const loaded = verifyBundleManifest({
    archive: paths.archive,
    manifestFile: paths.manifest,
    patchDirectory: paths.patches,
  });
  assert.equal(loaded.harnessRevision, '47f943859bef60e4160492346772ded9b24f765a');
  assert.equal(Object.keys(loaded.patches).length, 1);
});

test('归档被替换时拒绝继续构建', (t) => {
  const paths = fixture(t);
  fs.appendFileSync(paths.archive, 'tampered\n');
  assert.throws(
    () => verifyBundleManifest({ archive: paths.archive, manifestFile: paths.manifest, patchDirectory: paths.patches }),
    BundleError,
  );
});

test('所选源码补丁变化时拒绝复用旧归档', (t) => {
  const paths = fixture(t);
  fs.writeFileSync(path.join(paths.patches, 'desktop.patch'), 'patch-v2\n');
  assert.throws(
    () => verifyBundleManifest({ archive: paths.archive, manifestFile: paths.manifest, patchDirectory: paths.patches }),
    /补丁与所选源码不一致/,
  );
});

test('生成清单要求固定长度的 Harness 修订版本', (t) => {
  const paths = fixture(t);
  assert.throws(
    () => createBundleManifest({ archive: paths.archive, harnessRevision: 'local', patchDirectory: paths.patches }),
    /修订版本无效/,
  );
});
