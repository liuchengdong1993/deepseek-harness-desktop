# dsh-desktop

DeepSeek Harness 的 macOS 桌面版（Electron）打包工程。从 v0.1.6 官方产物反解重建，
修复了官方 dmg 缺失 `_CodeSignature` 导致应用秒退的问题。

## 目录结构

```
main.js / lib/    桌面端主进程源码（asar 内提取）
assets/           托盘图标
scripts/afterpack.cjs  构建后签名钩子：xattr 清理 → 恢复 exec 位 → ad-hoc codesign → 校验
runtime/          [不入库] 内嵌 Node/pnpm 运行时（>100MB）
harness.tar       [不入库] Harness 本体归档（~1.5GB）
```

## 构建

```sh
npm install          # Electron 33.4.11 走 npmmirror 镜像；下载失败见 SKILL 备注
npm run dist:mac     # 产物 dist/mac-arm64/DeepSeek Harness.app 与 dist/*.dmg
```

## 大文件恢复方式

`harness.tar`、`harness.bundle.json`、`runtime/` 不在仓库内，从任一已安装的
DeepSeek Harness.app 中复制：

```sh
cp '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar.unpacked/harness.tar' .
cp '/Applications/DeepSeek Harness.app/Contents/Resources/harness.bundle.json' .
npx @electron/asar extract '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar' /tmp/asar
cp -R /tmp/asar/runtime .
chmod -R u+x runtime/
```

## 安装与验收

```sh
pkill -9 -f 'MacOS/DeepSeek Harness'
rm -rf '/Applications/DeepSeek Harness.app'
cp -R dist/mac-arm64/'DeepSeek Harness.app' /Applications/
codesign -v '/Applications/DeepSeek Harness.app'   # 应无输出
open '/Applications/DeepSeek Harness.app'
curl http://127.0.0.1:3080                          # 就绪后应返回 200
```
