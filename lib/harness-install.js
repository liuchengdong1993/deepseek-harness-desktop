'use strict';

const fs = require('fs');
const path = require('path');

const harness = require('./harness');
const { readBundleManifest, verifyBundleManifest } = require('./harness-bundle');
const run = require('./run');

function bundleMarker(archive, appVersion, isPackaged, archiveSha256) {
  const stat = fs.statSync(archive);
  // A desktop candidate can change the bundled Harness without changing the
  // Electron version. Its manifest fingerprint must therefore participate in
  // the installed-runtime marker, or a promoted candidate would reuse stale
  // extracted code from the previous application.
  const revision = isPackaged && typeof archiveSha256 === 'string'
    ? archiveSha256
    : isPackaged ? appVersion : `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  return `${appVersion}:${revision}`;
}

function installedBundleMatches(installed, marker) {
  try {
    return Boolean(harness.cliBin(installed))
      && fs.readFileSync(path.join(installed, '.desktop-bundle-version'), 'utf8').trim() === marker;
  } catch {
    return false;
  }
}

function replaceInstalledHarness(installed, staged, log = () => {}) {
  const previous = `${installed}.previous-${process.pid}`;
  fs.rmSync(previous, { recursive: true, force: true });
  if (fs.existsSync(installed)) fs.renameSync(installed, previous);
  try {
    fs.renameSync(staged, installed);
  } catch (error) {
    if (!fs.existsSync(installed) && fs.existsSync(previous)) fs.renameSync(previous, installed);
    throw error;
  }
  try {
    fs.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    log(`旧版 Harness 清理失败，将在后续启动时重试：${error.message}`);
  }
}

async function extractArchive(archive, staged) {
  return run.execFilePromise('/usr/bin/tar', ['-xf', archive, '-C', staged]);
}

async function resolveBundledHarness(options) {
  const {
    devPath,
    installedPath,
    archivePath,
    appVersion,
    isPackaged,
    manifestPath,
    log = () => {},
    extract = extractArchive,
  } = options;
  if (harness.cliBin(devPath)) return devPath;
  if (!fs.existsSync(archivePath)) return harness.cliBin(installedPath) ? installedPath : null;

  const manifest = manifestPath ? readBundleManifest(manifestPath) : undefined;
  const marker = bundleMarker(archivePath, appVersion, isPackaged, manifest?.archive.sha256);
  if (installedBundleMatches(installedPath, marker)) return installedPath;

  if (manifestPath) verifyBundleManifest({ archive: archivePath, manifestFile: manifestPath });

  log('正在安装内置 Harness...');
  const staged = `${installedPath}.installing-${process.pid}`;
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged, { recursive: true });
  const result = await extract(archivePath, staged);
  if (result.code !== 0) {
    fs.rmSync(staged, { recursive: true, force: true });
    log(`Harness 安装失败：${result.stderr || result.stdout}`);
    return harness.cliBin(installedPath) ? installedPath : null;
  }
  if (!harness.cliBin(staged)) {
    fs.rmSync(staged, { recursive: true, force: true });
    log('Harness 安装失败：归档中缺少 CLI 构建产物。');
    return harness.cliBin(installedPath) ? installedPath : null;
  }

  try {
    fs.writeFileSync(path.join(staged, '.desktop-bundle-version'), `${marker}\n`, 'utf8');
    replaceInstalledHarness(installedPath, staged, log);
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    log(`Harness 安装切换失败：${error.message}`);
    return harness.cliBin(installedPath) ? installedPath : null;
  }
  log('Harness 安装完成。');
  return installedPath;
}

module.exports = {
  bundleMarker,
  installedBundleMatches,
  replaceInstalledHarness,
  resolveBundledHarness,
};
