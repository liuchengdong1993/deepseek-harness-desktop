'use strict';

// Persisted app settings, stored in ~/.dsh-desktop/config.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runtimeValue } = require('./launch-options');

// Overridable via DSH_DESKTOP_CONFIG_DIR (useful for testing / portable installs).
const CONFIG_DIR = runtimeValue('dsh-desktop-config-dir', 'DSH_DESKTOP_CONFIG_DIR') || path.join(os.homedir(), '.dsh-desktop');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_WEB_PORT = 3080;

const DEFAULTS = {
  harnessPath: '', // empty => auto-detect
  webPort: DEFAULT_WEB_PORT,
};

function parsePort(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port > 0 && port < 65536 ? port : null;
}

function normalize(value, env = process.env, args = process.argv) {
  const input = value && typeof value === 'object' ? value : {};
  const envPort = parsePort(runtimeValue('dsh-desktop-web-port', 'DSH_DESKTOP_WEB_PORT', env, args));
  return {
    harnessPath: typeof input.harnessPath === 'string' ? input.harnessPath : '',
    webPort: envPort || parsePort(input.webPort) || DEFAULT_WEB_PORT,
  };
}

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return normalize(DEFAULTS);
  }
}

function save(config) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const tmp = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(normalize(config, {}), null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
    return true;
  } catch (err) {
    // Never let a config-write failure crash startup.
    console.error('[dsh-desktop] config save failed:', err.message);
    return false;
  }
}

module.exports = { load, save, normalize, parsePort, CONFIG_FILE, DEFAULTS };
