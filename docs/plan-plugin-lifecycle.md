# 方案：桌面版插件生命周期闭环

> 日期：2026-08-16 · 目标来源：`DEVELOPMENT_GOAL.zh.md`「当前基线与近期开发目标」第 1-4 条（第一优先级）。
> 目标：GUI 插件中心六操作（安装/更新/卸载/启用/停用/配置）+ 真实状态 + 一键重载后端；无系统 pnpm 的隔离环境验证成功/失败/重试三态。
> 原则（同 DEVELOPMENT_GOAL）：产品功能统一在 Harness 官方 GUI 内；Electron 层只管服务托管与生命周期；不覆盖 Agent 预设挂载与用户配置层。

## TaskStartSnapshot（2026-08-16）

| 项 | 值 |
|---|---|
| 桌面仓库 | `/Users/mac/Desktop/DeepSeek/.tmp/rev/repo`，HEAD `78e56d42`；开工时已有脏文件（release.yml/.gitignore/README×2/agent/README.md），非本任务产生 |
| harness checkout | `/Users/mac/.dsh-desktop/harness`（**非 git 仓库**，解包产物；改动前手工备份到 /tmp） |
| 运行实例 | 桌面版 03:04 启动（PID 71446），后端 03:59（PID 56057，port 3080） |
| 真实 profile | `~/.dsh/profiles/web`，bundles 17 项；`cordis.patch.yml` 有用户 insert 块 |
| 测试基线 | harness CLI `plugin-lifecycle.spec.ts` 新建前 0 条；桌面仓库 `node --test test/*.test.js` 11 个文件 |

## 问题证据（用户可见缺陷）

- 07:58–10:09 安装的 5 个插件（xiaoyao 皮肤 / dsh-mnemon / aegis / dsh-blue-whale-maid / hakurei 皮肤）在后端 03:59 启动之后装入 → 运行实例不加载，且 GUI 无任何状态提示（lsof 0 命中、Host/Client 服务目录均无对应服务）。
- GUI 无停用/卸载/重启按钮；市场 UI 只有文案「装完需重启 harness 生效」。
- 桌面层已注入 `DSH_PNPM_BIN` 但 harness CLI 不消费（grep 零命中）；裸 CLI 报 `pnpm not found on PATH`。

## 四片

### 片 1 harness CLI 补底 —— ✅ 已交付（本轮）

- `apps/cli/src/plugin.ts`：pnpm 解析链 `DSH_PNPM_BIN` → `DSH_DESKTOP_RUNTIME_PNPM/bin/pnpm.cjs` → PATH；`.cjs` 经 `process.execPath` 启动（免 shell）；ENOENT 报错提示 `DSH_PNPM_BIN`。
- `apps/cli/src/plugin-lifecycle.ts`（新）：`status [--json]` / `enable <pkg...>` / `disable <pkg...>`。追加式写入 `cordis.patch.yml`（`disabled: true|false`，后者胜出的顺序语义）；空占位 `[]` 替换；每次修改前 `.bak` 备份；幂等（no-op 提示）；绝不重写用户条目/注释。
- 验收证据：
  - `vitest run apps/cli/tests/plugin-lifecycle.spec.ts`：**11/11 绿**（pnpm 解析 5 例含优先级与 127 提示；生命周期 5 例含幂等/备份/保留用户内容/stale 警告/未初始化；effectiveDisabled 1 例）。
  - `tsc -p apps/cli/tsconfig.json --noEmit` 0 错；`tsc -b` + `tsdown` 重建后 `node apps/cli/lib/bin.js plugin --profile web status` 对真实 profile 输出 17 项 enabled/template 状态。

### 片 2 桌面层控制通道 —— 待做

- `DSH_DESKTOP_CONTROL_DIR` 新增 `restart-backend` 动作：GUI/后端写请求 JSON → 主进程轮询 → `HarnessService.restart()` → 结果回执（复用 `promotion-control.js` 的原子写/校验/过期模式）；附后端启动时间戳（供 GUI 判「已装未生效」）。
- 验收：`node --test` 请求→重启→回执；端口健康恢复；`DSH_DESKTOP_SMOKE` 回归。

### 片 3 GUI 插件中心 —— 待做（D1 决策后）

- 设置页插件中心：已装列表（来源/版本/状态：运行中·已装未生效·停用，数据源 = 片 1 status --json）+ 六操作按钮 + 装后一键重载（经片 2 通道）+ 失败/重试反馈；preset 挂载与用户层只读可见、不覆盖。
- D1（待老大定）：A. harness 新包 `packages/plugin-center`（推荐，随桌面版分发）；B. 本地 profile 插件（快但不随分发）。
- 安装入口：复用市场插件（@dsh-market）发现/安装，中心只管已装生命周期（暂定，可改为全内聚）。

### 片 4 隔离验证闭环 —— 待做

- 扩展 `DSH_DESKTOP_SMOKE`：无系统 pnpm/Node/Git 环境，六操作成功/失败/重试三态 + 重启后生效 + 证据留存（DEVELOPMENT_GOAL 验收 3/5）。

## 门禁与纪律

- 改前必须先红（RED）；每片小步提交（桌面仓库 git；harness checkout 改动前手工备份）。
- 不碰真实 `~/.dsh/profiles/web` 的写路径做实验（status 只读除外）；测试一律临时 HOME。
- 汇报按覆盖面分开：代码通过 / 运行实例验证 / 隔离环境验证；未验证 ≠ 已完成。
