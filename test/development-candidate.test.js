'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeBundleManifest } = require('../lib/harness-bundle');
const {
  CandidateError, prepareCandidate, requestPromotion, startPreview,
} = require('../lib/development-candidate');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-candidate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'dsh-desktop', main: 'main.js' }));
  fs.writeFileSync(path.join(source, 'main.js'), 'main');
  fs.writeFileSync(path.join(source, 'runtime', 'node'), 'source-runtime');
  fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(source, 'node_modules', 'ignored'), 'ignored');
  const archive = path.join(root, 'harness.tar');
  const runtime = path.join(root, 'node');
  const pnpm = path.join(root, 'pnpm');
  fs.writeFileSync(archive, 'harness');
  const patches = path.join(source, 'patches');
  fs.mkdirSync(patches, { recursive: true });
  fs.writeFileSync(path.join(patches, 'desktop.patch'), 'patch');
  const manifest = path.join(root, 'harness.bundle.json');
  writeBundleManifest({
    archive,
    output: manifest,
    harnessRevision: '47f943859bef60e4160492346772ded9b24f765a',
    patchDirectory: patches,
  });
  fs.writeFileSync(runtime, 'runtime');
  fs.mkdirSync(path.join(pnpm, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pnpm, 'bin', 'pnpm.cjs'), 'pnpm-runtime');
  return { root, source, archive, manifest, runtime, pnpm };
}

test('候选构建只在隔离副本中运行并记录已验证安装包', async (t) => {
  const paths = fixture(t);
  const commands = [];
  const run = async (file, args, { cwd }) => {
    commands.push({ file, args, cwd });
    if (args.join(' ') === 'run dist') {
      const dist = path.join(cwd, 'dist');
      const app = path.join(dist, 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS');
      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(path.join(app, 'DeepSeek Harness'), 'candidate');
      fs.writeFileSync(path.join(dist, 'DeepSeek-Harness-0.1.5-arm64.dmg'), 'dmg');
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = await prepareCandidate({
    source: paths.source,
    harnessArchive: paths.archive,
    harnessManifest: paths.manifest,
    nodeRuntime: paths.runtime,
    pnpmRuntime: paths.pnpm,
    root: path.join(paths.root, 'candidates'),
    id: 'candidate-a',
    now: 0,
    run,
  });

  assert.equal(result.status, 'verified');
  assert.equal(fs.readFileSync(path.join(result.directory, 'harness.tar'), 'utf8'), 'harness');
  assert.equal(fs.existsSync(path.join(result.directory, 'harness.bundle.json')), true);
  assert.equal(fs.existsSync(path.join(result.directory, 'node_modules')), false);
  assert.equal(fs.readFileSync(path.join(paths.source, 'runtime', 'node'), 'utf8'), 'source-runtime');
  assert.equal(fs.readFileSync(path.join(result.directory, 'runtime', 'pnpm', 'bin', 'pnpm.cjs'), 'utf8'), 'pnpm-runtime');
  assert.deepEqual(commands.map(({ file, args }) => [file, args]), [
    ['npm', ['ci']],
    ['npm', ['run', 'verify']],
    ['npm', ['run', 'dist']],
    ['/usr/bin/hdiutil', ['verify', path.join(paths.root, 'candidates', 'candidate-a.staging', 'dist', 'DeepSeek-Harness-0.1.5-arm64.dmg')]],
  ]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory, 'candidate.json'), 'utf8')).status, 'verified');
});

test('候选构建拒绝非桌面源码且不会创建隔离目录', async (t) => {
  const paths = fixture(t);
  fs.writeFileSync(path.join(paths.source, 'package.json'), JSON.stringify({ name: 'other', main: 'index.js' }));
  await assert.rejects(
    prepareCandidate({
      source: paths.source,
      harnessArchive: paths.archive,
      harnessManifest: paths.manifest,
      nodeRuntime: paths.runtime,
      pnpmRuntime: paths.pnpm,
      root: path.join(paths.root, 'candidates'),
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    }),
    CandidateError,
  );
  assert.equal(fs.existsSync(path.join(paths.root, 'candidates')), false);
});

test('候选构建失败会清理暂存副本并保留源码不变', async (t) => {
  const paths = fixture(t);
  await assert.rejects(
    prepareCandidate({
      source: paths.source,
      harnessArchive: paths.archive,
      harnessManifest: paths.manifest,
      nodeRuntime: paths.runtime,
      pnpmRuntime: paths.pnpm,
      root: path.join(paths.root, 'candidates'),
      id: 'candidate-failed',
      run: async () => ({ code: 1, stdout: '', stderr: '验证失败' }),
    }),
    /安装候选依赖失败/,
  );
  assert.equal(fs.existsSync(path.join(paths.root, 'candidates', 'candidate-failed.staging')), false);
  assert.equal(fs.readFileSync(path.join(paths.source, 'main.js'), 'utf8'), 'main');
});

test('候选预览使用独立目录与端口，且必须收到候选应用就绪信号', async (t) => {
  const paths = fixture(t);
  const candidate = path.join(paths.root, 'candidates', 'candidate-preview');
  const app = path.join(candidate, 'dist', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'DeepSeek Harness'), 'candidate');
  fs.writeFileSync(path.join(candidate, 'dist', 'DeepSeek-Harness-0.1.5-arm64.dmg'), 'dmg');
  fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify({
    id: 'candidate-preview', source: paths.source, createdAt: '2026-08-15T00:00:00.000Z', status: 'verified',
    appPath: 'dist/mac-arm64/DeepSeek Harness.app', dmgPath: 'dist/DeepSeek-Harness-0.1.5-arm64.dmg',
  }));
  let launch;
  let readyTimeout;
  const result = await startPreview({
    root: path.join(paths.root, 'candidates'),
    id: 'candidate-preview',
    getPort: async () => 43123,
    launch: (file, args, options) => {
      launch = { file, args, options };
      return { pid: 12345, unref: () => {} };
    },
    waitForReady: async (file, timeoutMs) => {
      readyTimeout = timeoutMs;
      fs.writeFileSync(file, JSON.stringify({ port: 43123, pid: 12345, readyAt: '2026-08-15T00:00:00.000Z' }));
    },
  });

  assert.equal(result.status, 'previewed');
  assert.deepEqual(result.preview, { port: 43123, pid: 12345, readyAt: '2026-08-15T00:00:00.000Z' });
  assert.equal(launch.args.includes('--dsh-desktop-preview=1'), true);
  assert.equal(launch.args.includes('--dsh-desktop-web-port=43123'), true);
  assert.equal(launch.args.some((arg) => /--dsh-desktop-dsh-home=.*candidate-preview\/preview\/dsh-home$/.test(arg)), true);
  assert.equal(readyTimeout, 10 * 60 * 1000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(candidate, 'candidate.json'), 'utf8')).status, 'previewed');
});

test('候选预览不会继承可改变桌面启动模式的父进程变量', async (t) => {
  const paths = fixture(t);
  const candidate = path.join(paths.root, 'candidates', 'candidate-clean-environment');
  const app = path.join(candidate, 'dist', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'DeepSeek Harness'), 'candidate');
  fs.writeFileSync(path.join(candidate, 'dist', 'DeepSeek-Harness-0.1.5-arm64.dmg'), 'dmg');
  fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify({
    id: 'candidate-clean-environment', source: paths.source, createdAt: '2026-08-15T00:00:00.000Z', status: 'verified',
    appPath: 'dist/mac-arm64/DeepSeek Harness.app', dmgPath: 'dist/DeepSeek-Harness-0.1.5-arm64.dmg',
  }));
  let environment;
  await startPreview({
    root: path.join(paths.root, 'candidates'),
    id: 'candidate-clean-environment',
    environment: {
      PATH: '/usr/bin',
      DSH_DESKTOP_SMOKE: '1',
      DSH_DESKTOP_SMOKE_RESULT_FILE: '/tmp/incorrect.json',
      DSH_DESKTOP_WEB_PORT: '3195',
    },
    getPort: async () => 43124,
    launch: (_file, _args, options) => {
      environment = options.env;
      return { pid: 12346, unref: () => {} };
    },
    waitForReady: async (file) => fs.writeFileSync(file, JSON.stringify({ port: 43124, pid: 12346, readyAt: '2026-08-15T00:00:00.000Z' })),
  });

  assert.deepEqual(environment, { PATH: '/usr/bin', DSH_DESKTOP_PREVIEW: '1' });
});

test('候选预览拒绝越出候选目录的记录路径', async (t) => {
  const paths = fixture(t);
  const candidate = path.join(paths.root, 'candidates', 'candidate-invalid');
  fs.mkdirSync(candidate, { recursive: true });
  fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify({
    id: 'candidate-invalid', status: 'verified', appPath: '../other.app', dmgPath: '../other.dmg',
  }));
  await assert.rejects(
    startPreview({ root: path.join(paths.root, 'candidates'), id: 'candidate-invalid' }),
    /候选应用程序不在候选目录中/,
  );
});

test('替换请求只能由存活且健康的已预览候选写入桌面受控通道', async (t) => {
  const paths = fixture(t);
  const candidate = path.join(paths.root, 'candidates', 'candidate-promote');
  const app = path.join(candidate, 'dist', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS');
  const controls = path.join(paths.root, 'controls');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(controls, { recursive: true });
  fs.writeFileSync(path.join(app, 'DeepSeek Harness'), 'candidate');
  fs.writeFileSync(path.join(candidate, 'dist', 'DeepSeek-Harness-0.1.5-arm64.dmg'), 'dmg');
  fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify({
    id: 'candidate-promote', source: paths.source, createdAt: '2026-08-15T00:00:00.000Z', status: 'previewed',
    appPath: 'dist/mac-arm64/DeepSeek Harness.app', dmgPath: 'dist/DeepSeek-Harness-0.1.5-arm64.dmg',
    preview: { port: 43125, pid: 12347, readyAt: '2026-08-15T00:00:00.000Z' },
  }));

  const request = await requestPromotion({
    root: path.join(paths.root, 'candidates'), controlDirectory: controls, id: 'candidate-promote', now: 0, random: 'request',
    isProcessRunning: () => true, healthCheck: async () => true,
  });

  assert.equal(request.action, 'promote');
  assert.equal(JSON.parse(fs.readFileSync(path.join(controls, 'promotion-request.json'), 'utf8')).candidateId, 'candidate-promote');
  await assert.rejects(requestPromotion({
    root: path.join(paths.root, 'candidates'), controlDirectory: controls, id: 'candidate-promote', now: 1, random: 'next',
  }), /已有桌面版本替换请求/);
});

test('替换请求拒绝已经退出的候选预览', async (t) => {
  const paths = fixture(t);
  const candidate = path.join(paths.root, 'candidates', 'candidate-stale-preview');
  const app = path.join(candidate, 'dist', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS');
  const controls = path.join(paths.root, 'controls');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(controls, { recursive: true });
  fs.writeFileSync(path.join(app, 'DeepSeek Harness'), 'candidate');
  fs.writeFileSync(path.join(candidate, 'dist', 'DeepSeek-Harness-0.1.5-arm64.dmg'), 'dmg');
  fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify({
    id: 'candidate-stale-preview', source: paths.source, createdAt: '2026-08-15T00:00:00.000Z', status: 'previewed',
    appPath: 'dist/mac-arm64/DeepSeek Harness.app', dmgPath: 'dist/DeepSeek-Harness-0.1.5-arm64.dmg',
    preview: { port: 43126, pid: 12348, readyAt: '2026-08-15T00:00:00.000Z' },
  }));

  await assert.rejects(requestPromotion({
    root: path.join(paths.root, 'candidates'), controlDirectory: controls, id: 'candidate-stale-preview',
    isProcessRunning: () => false,
  }), /候选预览进程已退出/);
  assert.equal(fs.existsSync(path.join(controls, 'promotion-request.json')), false);
});

test('替换请求拒绝 Harness 服务已失联的候选预览', async (t) => {
  const paths = fixture(t);
  const candidate = path.join(paths.root, 'candidates', 'candidate-unhealthy-preview');
  const app = path.join(candidate, 'dist', 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS');
  const controls = path.join(paths.root, 'controls');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(controls, { recursive: true });
  fs.writeFileSync(path.join(app, 'DeepSeek Harness'), 'candidate');
  fs.writeFileSync(path.join(candidate, 'dist', 'DeepSeek-Harness-0.1.5-arm64.dmg'), 'dmg');
  fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify({
    id: 'candidate-unhealthy-preview', source: paths.source, createdAt: '2026-08-15T00:00:00.000Z', status: 'previewed',
    appPath: 'dist/mac-arm64/DeepSeek Harness.app', dmgPath: 'dist/DeepSeek-Harness-0.1.5-arm64.dmg',
    preview: { port: 43127, pid: 12349, readyAt: '2026-08-15T00:00:00.000Z' },
  }));

  await assert.rejects(requestPromotion({
    root: path.join(paths.root, 'candidates'), controlDirectory: controls, id: 'candidate-unhealthy-preview',
    isProcessRunning: () => true, healthCheck: async () => false,
  }), /Harness 服务不可用/);
  assert.equal(fs.existsSync(path.join(controls, 'promotion-request.json')), false);
});
