'use strict';

// Child-process helpers shared by git / backend / plugin managers.

const { execFile } = require('child_process');

// Run to completion, capturing stdout/stderr. Resolves { code, stdout, stderr }.
function execFilePromise(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
      timeout: opts.timeout || 0,
    }, (error, stdout, stderr) => {
      resolve({
        code: error ? (error.code == null ? 1 : (error.killed ? 124 : 1)) : 0,
        signal: error && error.signal ? error.signal : null,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

module.exports = { execFilePromise };
