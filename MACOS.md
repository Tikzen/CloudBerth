# macOS 与数据迁移说明

## 当前实现

版本 1.3.0，应用名称 CloudBerth，npm 包名 `cloudberth`，应用标识 `com.cloudberth.app`。
Electron 45.2.3 / Chromium 156；构建配置的最低 macOS 版本为 13.0。

Mac 使用原生全屏，保留系统菜单和退出控件，不启用隐藏退出控件的 kiosk 锁定模式。
原生菜单提供返回游戏库、切换全屏和退出全屏；Dock 提供返回与退出全屏。
主进程 before-input-event 与 AppKit accelerator 配合处理快捷键。

## 旧版迁移

`src/identity.js` 在 ready 前设定新名称及 userData/sessionData 路径。
主应用先取得 CloudBerth 单实例锁，再进行迁移。新目录已有有效配置时不导入旧数据。

存在旧版目录且需要迁移时：

1. 创建 pending 迁移标记，启动受限的本机子进程。
2. 子进程用旧名称取得旧配置目录的单实例锁；旧应用还在运行时拒绝复制并提示先退出。
3. 将旧配置、游戏库和网页存储复制到新目录，排除锁、日志和可重建缓存；不删除或改写旧文件。
4. 将旧 Cookie 的加密数据库复制到权限为 0700 的临时目录；释放旧目录锁后只读取临时副本。
5. 子进程使用旧名称初始化 Electron 的 macOS Keychain 身份，通过 cookies API 读取 Cookie。
6. Cookie 通过父子进程 IPC 传递；新会话使用 CloudBerth 身份保存、重新加密并 flushStore。
7. 写入 complete 标记并删除临时副本；失败则保留 pending，下次启动重试。

新名称会使用新的 macOS Safe Storage Keychain 项。旧名称只在迁移子进程内短暂使用；主应用内部名称与数据目录均为 CloudBerth。
不复制或输出系统 Keychain 的密码，也不将 Cookie 明文写入文件、日志或网页。

网站自己的登录过期、设备校验和第三方 Cookie 策略不受应用控制。测试使用合成 Cookie，不接触真实账号。

## 验证

- `npm run check`：源码语法、配置、平台默认值、快捷键与打包清单。
- `npm run test:identity`：分进程创建旧版合成配置、加密 Cookie 和 localStorage；迁移后及再次启动读取验证；核对旧 Cookie 数据库和游戏库哈希未改变。
- `npm run test:shortcuts`：双击录入、取消、退出键保护、三项恢复默认、菜单/页脚同步和真实全屏进出。
- `npm run test:runtime`：独立窗口、复用、返回保留、结束运行、头像与桥接隔离。
- `npm run test:mac`：Mac 原生全屏、ESC、菜单和返回行为。

当前仅支持 macOS，发行包面向 Apple Silicon；Intel Mac 尚未做实机验证，历史 Windows 构建配置不代表当前提供 Windows 支持。
