#!/usr/bin/env node
'use strict';

const path = require('path');
const { BundleError, writeBundleManifest } = require('../lib/harness-bundle');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function main() {
  const archive = option('--archive', 'harness.tar');
  const output = option('--output', 'harness.bundle.json');
  const revision = option('--revision', process.env.HARNESS_REV);
  if (!revision) throw new BundleError('生成 Harness 归档清单需要 --revision <40位修订版本>。');
  const manifest = writeBundleManifest({
    archive,
    output,
    harnessRevision: revision,
    patchDirectory: path.resolve('patches'),
  });
  console.log(`已生成 Harness 归档清单：${path.resolve(output)}`);
  console.log(JSON.stringify(manifest, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  if (error instanceof BundleError && error.details) console.error(error.details);
  process.exitCode = 1;
}
