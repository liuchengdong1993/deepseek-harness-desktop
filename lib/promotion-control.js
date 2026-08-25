'use strict';

const fs = require('fs');
const path = require('path');

const { CandidateError } = require('./development-candidate');

const REQUEST_FILE = 'promotion-request.json';
const RESULT_FILE = 'promotion-result.json';

function controlFile(directory, name) {
  if (!directory) throw new CandidateError('未配置桌面受控通道目录。');
  return path.join(path.resolve(directory), name);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function validateRequest(request, now = Date.now()) {
  if (!request || typeof request !== 'object') throw new CandidateError('桌面替换请求格式无效。');
  if (!/^[A-Za-z0-9-]+$/.test(request.id || '')) throw new CandidateError('桌面替换请求编号无效。');
  if (request.action !== 'promote' && request.action !== 'rollback') throw new CandidateError('桌面替换操作无效。');
  if (!/^[A-Za-z0-9-]+$/.test(request.candidateId || '')) throw new CandidateError('候选版本编号无效。');
  const expiresAt = Date.parse(request.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt < now) throw new CandidateError('桌面替换请求已过期。');
  return request;
}

function takePromotionRequest(directory, now = Date.now()) {
  const file = controlFile(directory, REQUEST_FILE);
  if (!fs.existsSync(file)) return null;
  let request;
  try {
    request = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw new CandidateError('桌面替换请求无法读取。', error.message);
  }
  fs.rmSync(file, { force: true });
  return validateRequest(request, now);
}

function writePromotionResult(directory, result) {
  const output = {
    ...result,
    completedAt: new Date().toISOString(),
  };
  atomicWriteJson(controlFile(directory, RESULT_FILE), output);
  return output;
}

function takePromotionResult(directory) {
  const file = controlFile(directory, RESULT_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.rmSync(file, { force: true });
    return result;
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw new CandidateError('桌面替换结果无法读取。', error.message);
  }
}

module.exports = {
  REQUEST_FILE,
  RESULT_FILE,
  takePromotionRequest,
  takePromotionResult,
  writePromotionResult,
};
