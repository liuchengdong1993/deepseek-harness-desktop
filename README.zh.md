# DeepSeek Harness

[English](README.md) | 中文

一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的原生 **macOS 桌面应用**。它**开箱即用**——harness 源码和 Node.js 运行时都已内置，无需再装任何东西。

[![Latest release](https://img.shields.io/github/v/release/liuchengdong1993/deepseek-harness-desktop?label=release)](https://github.com/liuchengdong1993/deepseek-harness-desktop/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 功能

- **官方 GUI**：桌面窗口运行与 DeepSeek Harness Web 完全相同的界面、交互和设置功能。
- **默认简体中文**：Chromium 以 `zh-CN` 启动，后续语言选择仍由官方 GUI 管理。
- **自包含运行时**：内置已构建 Harness、依赖、Node 22 与 pnpm 11.7.0，无需另装 Git、pnpm、Node 或 Harness。
- **原生生命周期**：随应用启动、监测、恢复并停止本地 Harness 服务。
- **共享 Harness 数据**：默认使用 `~/.dsh`，与 `dsh web` 共用提供方、会话、模型和偏好。
- **桌面集成**：黑色 DeepSeek 图标、中文 macOS 菜单、托盘入口、全局唤起快捷键和应用自动更新。

## 安装

1. 从 [Releases](https://github.com/liuchengdong1993/deepseek-harness-desktop/releases/latest) 下载最新的 `DeepSeek-Harness-<version>-arm64.dmg`。
2. 打开 `.dmg`，把 **DeepSeek Harness** 拖进**应用程序**。
3. 首次启动请**右键 → 打开**（该版本未签名，见[签名与公证](#签名与公证)）。
4. 在**设置**里填入你的 DeepSeek API Key。

**要求：** Apple 芯片 Mac（任意 M 系列芯片——M1/M2/M3/M4/M5 及更新）+ 一个 DeepSeek API key。

## 使用

| 位置 | 能做什么 |
| --- | --- |
| **主窗口** | DeepSeek Harness 网页界面（等同 `npx @deepseek-ai/dsh web`） |
| **设置** | 语言、外观、权限、模型、插件和 Agent 预设 |
| **帮助菜单** | 重启本地 Harness 服务或查看运行信息 |
| **菜单栏** | 重新打开窗口、刷新 GUI、重启 Harness 或退出 |

## 开发

```sh
npm install        # 安装 Electron + electron-builder
npm start          # 开发模式运行（若存在 harness/ 和 runtime/ 则直接使用）
npm run smoke      # 无界面自测
npm run icon       # 重新生成黑色 DeepSeek 图标（scripts/gen-icon.js → icon.icns）
npm run dist       # 构建 .dmg
```

### 受控自开发

在 Harness 网页界面中选择本仓库作为工作区后，Code Agent 会发现 `.agents/skills/deepseek-harness-desktop-development`，并可完成代码修改、测试、隔离构建与候选预览。桌面应用自身不会被静默修改：只有候选构建和预览均通过、推广请求再次确认候选进程及 Harness 服务仍可用、用户明确确认、并在原生确认窗口再次确认后，才会替换当前 `.app`；新版本未能通过 Harness 服务就绪确认时会自动恢复上一版。

可供 Agent 调用的受控命令如下：

```bash
node scripts/desktop-development.js prepare --source .
node scripts/desktop-development.js preview --candidate <候选编号>
node scripts/desktop-development.js promote --candidate <候选编号>
node scripts/desktop-development.js rollback --candidate <候选编号>
```

Electron 主进程只负责桌面生命周期，应用主界面直接加载官方 Harness GUI：

```
dsh-desktop/
├── main.js               Electron 应用编排与系统生命周期
├── lib/                  安装、服务、窗口、菜单、更新等独立模块
├── test/                 桌面基础设施的无界面自动化测试
├── patches/              发布 CI 应用的已审查 Harness 产品补丁
├── scripts/              黑色 DeepSeek 图标生成
├── assets/               应用与托盘图标
├── build/                entitlements 与签名文档
├── .github/workflows/    CI（release.yml）
├── harness.tar           内置的 DeepSeek Harness（CI 重新生成，已 gitignore）
├── harness.bundle.json   归档修订、SHA-256 与桌面补丁指纹（CI 重新生成，已 gitignore）
└── runtime/              内置 Node 22 与 pnpm 11.7.0（CI 重新生成，已 gitignore）
```

### "开箱即用"打包是怎么实现的

三个体积很大的产物**不进 git**（太大），在构建时重新生成：

- **`harness.tar`**：已构建的 DeepSeek Harness checkout（源码 + `node_modules`，约 1.6 GB）。应用会原子安装到 `~/.dsh-desktop/harness`，并在桌面版本变化时刷新。
- **`harness.bundle.json`**：与归档配套的完整性清单。候选构建会校验归档、Harness 修订和所选源码补丁；清单缺失或不一致时拒绝构建，避免把旧 Harness 混入新候选。
- **`runtime/node`** —— 一个 Node 22（arm64）二进制。Electron 33 内置的 Node 20 对 harness 太旧，所以应用自带 Node 22 并直接启动它。
- **`runtime/pnpm`**：完整的 `pnpm@11.7.0` 包。Harness 通过它完成 GUI 发起的插件安装、更新与卸载，不依赖系统 pnpm。

## Release 与 CI

推送 `v*` tag 会触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)：克隆 Harness、应用已审查的桌面补丁、重建 `harness.tar`、下载 Node 22、内置 pnpm 11.7.0、打包 `.dmg`，并上传到 GitHub Release。

如果配置了 Apple 签名 secrets，构建会自动**签名 + 公证**；否则自动回退为未签名构建。

## 签名与公证

本版本默认**未签名**，所以首次启动会被 Gatekeeper 拦截（右键 → 打开，或 `xattr -cr "/Applications/DeepSeek Harness.app"`）。

要发布签名 + 公证的版本，请看 **[`SIGNING.md`](SIGNING.md)** —— 里面写了 Apple 开发者证书的申请、要建的 5 个 GitHub secrets，以及 CI 如何自动切换成签名构建。

## 许可证

[MIT](LICENSE)
