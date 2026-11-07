# Changelog

## 1.3.1 — Windows 测试构建

- 增加 Windows x64 便携 EXE 的原生构建、打包检查及隔离集成测试。
- Windows 默认组合为 Alt+Shift+F 全屏、Alt+Shift+H 返回、Alt+Q 退出，Mac 的 Command 组合保持不变。
- 根据平台显示设置说明，Windows 不再显示 Mac 菜单操作提示。
- 当前稳定发行仍为 Mac 1.3.0，Windows 构建供测试，不代表已经完成真实云游戏兼容性验证。

## 1.3.0 — 2026-11-07

- 项目更名为 CloudBerth，更新包名、应用标识、窗口/菜单/页面名称和日志文件名。
- 数据目录使用 CloudBerth；新增旧版配置、游戏库、网页存储与加密 Cookie 的迁移。
- 三个快捷键均提供恢复默认按钮，保存后同步页脚与原生菜单。
- 手工测试页面名称更新为 CloudBerth；测试资源继续排除于正式包。
- 整理独立仓库的文档、上游归属说明和 MIT 许可。
- 应用与启动器使用新版 SVG、PNG 和 ICO 品牌资源。
- README 补充功能截图、按键与全屏处理原理，注明当前仅支持 macOS。

## 既有功能

在上游 cloud-game-shell 基础上增加 macOS 支持、Electron 更新、独立游戏窗口、运行态管理、自动/自定义头像、双击原生快捷键录入和新版启动器界面。
