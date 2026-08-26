'use strict';

// Dialog copy must not surface OS, Chromium, or package-manager diagnostics.
// Those diagnostics remain available through the desktop process log.
const ERROR_DETAILS = Object.freeze({
  harnessRestart: '请稍后重试；如问题持续，请从“帮助”菜单重启 Harness 服务。',
  harnessStart: '请检查本机 Harness 安装和端口占用情况后重试。',
  pageLoad: '请从“帮助”菜单重启 Harness 服务后重试。',
  promotion: '请查看本次候选构建和预览结果后重试。',
  appStart: '请重新启动应用；如问题持续，请检查本机 Harness 安装。',
});

function userFacingErrorDetail(kind) {
  return ERROR_DETAILS[kind] || ERROR_DETAILS.appStart;
}

module.exports = { ERROR_DETAILS, userFacingErrorDetail };
