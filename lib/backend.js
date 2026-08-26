'use strict';

// DeepSeek Harness Web backend lifecycle and identity checks.

const http = require('http');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const HARNESS_TITLE = '<title>DeepSeek Harness</title>';
const MAX_PROBE_BODY = 256 * 1024;

function probe(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.get({
      host: HOST,
      port,
      path: '/',
      timeout: timeoutMs,
      headers: { accept: 'text/html' },
    }, (res) => {
      res.setEncoding('utf8');
      let body = '';
      let bytes = 0;
      const incomplete = () => finish({
        reachable: true,
        harness: false,
        statusCode: res.statusCode || null,
      });
      res.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes <= MAX_PROBE_BODY) body += chunk;
      });
      res.on('aborted', incomplete);
      res.on('error', incomplete);
      res.on('end', () => {
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        finish({
          reachable: true,
          harness: res.statusCode === 200
            && contentType.includes('text/html')
            && body.includes(HARNESS_TITLE),
          statusCode: res.statusCode || null,
        });
      });
    });
    req.on('error', () => finish({ reachable: false, harness: false, statusCode: null }));
    req.on('timeout', () => {
      req.destroy();
      finish({ reachable: false, harness: false, statusCode: null });
    });
  });
}

async function healthCheck(port, timeoutMs = 1500) {
  return (await probe(port, timeoutMs)).harness;
}

async function waitForHarness(port, timeoutMs = 30000, onTick) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck(port, 1200)) return true;
    if (onTick) onTick();
    await new Promise((r) => setTimeout(r, 800));
  }
  return healthCheck(port, 1500);
}

// Spawn `node <cliBin> web`. Returns the child process.
function start({ cliBin, port, env, nodeBin, cwd }) {
  const child = spawn(nodeBin || 'node', [cliBin, 'web', '--port', String(port)], {
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function stop(child) {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve();
    };
    let killTimer;
    try {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('close', finish);
      child.once('error', finish);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        finish();
      }, 3000);
      killTimer.unref?.();
    } catch {
      finish();
    }
  });
}

module.exports = { HOST, HARNESS_TITLE, probe, healthCheck, waitForHarness, start, stop };
