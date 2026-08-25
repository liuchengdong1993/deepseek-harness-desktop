---
name: deepseek-harness-desktop-development
description: 在已选中的 DeepSeek Harness Desktop 源码工作区内，安全完成修改、隔离构建、预览、确认替换和回滚。
---

# DeepSeek Harness Desktop 自开发

当用户要求开发、修复或更新当前桌面应用时，先阅读本工作区的 `AGENTS.md`（如存在）和 `git status --short`，保留所有非本次任务的改动。所有面向用户的说明、命令输出摘要和界面文案使用简体中文。

## 日常项目开发

1. 在用户已选择的工作区内读取源码、修改代码、运行针对性测试。
2. 对本次修改至少运行 `npm test` 与 `npm run verify`；若涉及安装包，再运行 `npm run dist`。
3. 不把“代码已经修改”表述为“桌面版本已经更新”。当前运行的应用与源码工作区是两个不同对象。

## 更新桌面应用自身

仅当工作区确实是本桌面应用源码，并且用户明确要求更新正在运行的桌面应用时，按以下顺序执行：

1. 隔离构建：`node scripts/desktop-development.js prepare --source .`
2. 记下命令输出的候选编号；构建失败时只报告失败，不操作当前应用。
3. 独立预览：`node scripts/desktop-development.js preview --candidate <候选编号>`。
4. 完成预览验证后，向用户说明候选编号、验证结果和将替换的版本；候选进程与 Harness 服务必须仍可用，等待用户明确确认“替换”或同义表述。
5. 只有收到明确确认后，执行 `node scripts/desktop-development.js promote --candidate <候选编号>`。该命令只提交请求，桌面应用会再显示原生确认窗口；未在该窗口确认时，绝不宣称已替换。
6. 新版本启动并通过 Harness 服务就绪确认后才算替换成功。若超时、异常退出或服务失联，守护进程会自动恢复上一版。

禁止直接移动、删除或覆盖 `.app`、`dist/`、候选目录或已安装应用；必须使用上述受控命令。禁止跳过隔离构建、预览或用户确认。

## 回滚

若用户明确要求恢复上一版，使用与该版本关联的候选编号执行：

`node scripts/desktop-development.js rollback --candidate <候选编号>`

该命令同样只提交请求，必须在桌面原生确认窗口中确认。回滚版本启动后立即退出时，守护进程会恢复回滚前版本。

## 交付说明

报告应区分：源码测试结果、候选预览结果、用户是否确认、实际替换/回滚结果。不要编造安装、启动或预览已经完成的证据。
