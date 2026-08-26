'use strict';

const fs = require('fs');
const path = require('path');

// macOS may relaunch a bundled .app through LaunchServices with a sanitized
// environment. Runtime controls therefore travel as explicit CLI arguments.

function optionValue(name, args = process.argv) {
  const flag = `--${name}`;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === flag) return args[index + 1] || '';
    if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
  }
  return '';
}

function optionEnabled(name, args = process.argv) {
  const value = optionValue(name, args);
  return value === '1' || value === 'true' || value === 'yes';
}

function runtimeValue(name, environmentName, environment = process.env, args = process.argv) {
  return optionValue(name, args) || environment[environmentName] || '';
}

function electronUserDataDirectory(environment = process.env, args = process.argv) {
  const configDirectory = runtimeValue('dsh-desktop-config-dir', 'DSH_DESKTOP_CONFIG_DIR', environment, args);
  return configDirectory ? path.resolve(configDirectory, 'electron') : '';
}

function resolvePnpmBin(bundledPnpm, environment = process.env, exists = fs.existsSync) {
  const candidates = [bundledPnpm, environment.DSH_PNPM_BIN]
    .filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
  return candidates.find((candidate) => exists(candidate)) || '';
}

module.exports = {
  electronUserDataDirectory, optionEnabled, optionValue, resolvePnpmBin, runtimeValue,
};
