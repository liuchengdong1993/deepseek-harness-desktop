#!/usr/bin/env node
'use strict';

const path = require('path');
const run = require('../lib/run');
const {
  CandidateError, prepareCandidate, requestPromotion, startPreview,
} = require('../lib/development-candidate');

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function prepareOptions(source, environment) {
  return {
    source,
    harnessArchive: environment.DSH_DESKTOP_BUNDLE_ARCHIVE || path.join(source, 'harness.tar'),
    harnessManifest: environment.DSH_DESKTOP_BUNDLE_MANIFEST || path.join(source, 'harness.bundle.json'),
    nodeRuntime: environment.DSH_DESKTOP_RUNTIME_NODE || path.join(source, 'runtime', 'node'),
    pnpmRuntime: environment.DSH_DESKTOP_RUNTIME_PNPM || path.join(source, 'runtime', 'pnpm'),
    root: environment.DSH_DESKTOP_CANDIDATE_ROOT,
  };
}

async function main(environment = process.env) {
  const command = process.argv[2];
  if (command === 'preview') {
    const id = option('--candidate');
    if (!id) throw new CandidateError('预览候选版本需要 --candidate <编号>。');
    const record = await startPreview({ root: process.env.DSH_DESKTOP_CANDIDATE_ROOT, id });
    console.log(`候选预览已就绪：http://127.0.0.1:${record.preview.port}`);
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  if (command === 'promote' || command === 'rollback') {
    const id = option('--candidate');
    if (!id) throw new CandidateError(`${command === 'promote' ? '请求替换候选版本' : '请求回滚桌面版本'}需要 --candidate <编号>。`);
    const record = await requestPromotion({
      root: process.env.DSH_DESKTOP_CANDIDATE_ROOT,
      controlDirectory: process.env.DSH_DESKTOP_CONTROL_DIR,
      id,
      action: command === 'rollback' ? 'rollback' : 'promote',
    });
    console.log(command === 'promote'
      ? '已提交版本替换请求，请在桌面应用弹出的确认窗口中继续。'
      : '已提交桌面版本回滚请求，请在桌面应用弹出的确认窗口中继续。');
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  if (command !== 'prepare') {
    throw new CandidateError('用法：node scripts/desktop-development.js <prepare|preview|promote|rollback> [参数]');
  }
  const source = path.resolve(option('--source') || process.cwd());
  const record = await prepareCandidate({
    ...prepareOptions(source, environment),
    run: run.execFilePromise,
  });
  console.log('候选版本已完成隔离构建与验证。');
  console.log(JSON.stringify(record, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    if (error instanceof CandidateError && error.details) console.error(error.details);
    process.exitCode = 1;
  });
}

module.exports = { main, prepareOptions };
