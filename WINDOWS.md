# CloudBerth for Windows

当前目录单独维护 Windows x64 测试版本，分支为 windows；应用名称仍为 CloudBerth。
Mac 稳定版源码保留在 macos 分支。两个开发目录分别维护依赖、配置和构建产物。

## 默认快捷键

- 全屏：Alt + Shift + F
- 返回游戏库：Alt + Shift + H
- 退出：Alt + Q

三项都支持双击录入和恢复默认，保存后同步页脚。Windows 不依赖 Command 键。

## 在 Windows 编译

需要 Node.js 22.12+、npm 和 Windows x64。

```sh
npm ci
npm run check
npm run test:launcher
npm run test:close
npm run test:runtime
npm run test:win
npm run dist:win -- --config.directories.output=dist/windows
node tools/verify-windows.js
```

产物位于 dist/windows，为便携 EXE；不包含个人游戏库、配置或会话。未配置代码签名。

也可以在 GitHub Actions 手动运行 Windows x64 build，选择 windows 分支。工作流先验证未压缩应用和迁移，再生成便携包，最后上传 EXE 与 SHA256SUMS-windows.txt。

目前属于测试构建，自动化窗口和按键检查不代表已经完成真实云游戏串流、GPU、手柄和各游戏平台登录兼容性验证。
