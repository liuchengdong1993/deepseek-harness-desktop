'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_VERSION = 1;

class BundleError extends Error {
  constructor(message, details = '') {
    super(message);
    this.name = 'BundleError';
    this.details = details;
  }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function patchFiles(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.patch'))
    .sort()
    .map((name) => path.join(directory, name));
}

function patchChecksums(directory) {
  if (!directory || !fs.existsSync(directory)) throw new BundleError('桌面补丁目录不存在。', String(directory || ''));
  return Object.fromEntries(patchFiles(directory).map((file) => [path.basename(file), sha256File(file)]));
}

function createBundleManifest({ archive, harnessRevision, patchDirectory }) {
  if (!harnessRevision || !/^[0-9a-f]{40}$/i.test(harnessRevision)) {
    throw new BundleError('Harness 修订版本无效。', String(harnessRevision || ''));
  }
  const archivePath = path.resolve(archive);
  if (!fs.existsSync(archivePath)) throw new BundleError('Harness 归档不存在。', archivePath);
  const stat = fs.statSync(archivePath);
  return {
    schemaVersion: MANIFEST_VERSION,
    harnessRevision: harnessRevision.toLowerCase(),
    archive: { bytes: stat.size, sha256: sha256File(archivePath) },
    patches: patchChecksums(patchDirectory),
  };
}

function writeBundleManifest(options) {
  const manifest = createBundleManifest(options);
  const output = path.resolve(options.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  return manifest;
}

function readBundleManifest(file) {
  const manifestPath = path.resolve(file || '');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new BundleError('Harness 归档清单无法读取。', error.message);
  }
  if (manifest.schemaVersion !== MANIFEST_VERSION) {
    throw new BundleError('Harness 归档清单版本不受支持。', String(manifest.schemaVersion));
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.harnessRevision || '')) {
    throw new BundleError('Harness 归档清单缺少有效修订版本。', manifestPath);
  }
  if (!manifest.archive || !/^[0-9a-f]{64}$/i.test(manifest.archive.sha256)) {
    throw new BundleError('Harness 归档清单缺少有效校验值。', manifestPath);
  }
  if (!manifest.patches || typeof manifest.patches !== 'object' || Array.isArray(manifest.patches)) {
    throw new BundleError('Harness 归档清单缺少补丁指纹。', manifestPath);
  }
  return manifest;
}

function verifyBundleManifest({ archive, manifestFile, patchDirectory }) {
  const archivePath = path.resolve(archive);
  const manifest = readBundleManifest(manifestFile);
  if (!fs.existsSync(archivePath)) throw new BundleError('Harness 归档不存在。', archivePath);
  const actual = sha256File(archivePath);
  if (actual !== manifest.archive.sha256.toLowerCase()) {
    throw new BundleError('Harness 归档与清单校验值不一致，拒绝继续。', `${archivePath}\n${actual}`);
  }
  if (Number(manifest.archive.bytes) !== fs.statSync(archivePath).size) {
    throw new BundleError('Harness 归档大小与清单不一致，拒绝继续。', archivePath);
  }
  if (patchDirectory) {
    const expected = manifest.patches;
    const actualPatches = patchChecksums(patchDirectory);
    if (JSON.stringify(expected) !== JSON.stringify(actualPatches)) {
      throw new BundleError('Harness 归档对应的桌面补丁与所选源码不一致，需先重建归档。',
        JSON.stringify({ expected, actual: actualPatches }, null, 2));
    }
  }
  return manifest;
}

module.exports = {
  BundleError,
  MANIFEST_VERSION,
  createBundleManifest,
  patchChecksums,
  readBundleManifest,
  sha256File,
  verifyBundleManifest,
  writeBundleManifest,
};
