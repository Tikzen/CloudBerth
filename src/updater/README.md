# CloudBerth 软件内更新与 Release 发布规范

本目录维护检查更新、应用内下载、安装准备和重启替换。修改更新代码或发布新版本时，以本文为发行格式契约。

## 代码入口

- `index.js`：从 GitHub Releases 查询、筛选系统与架构、记录跳过版本、下载进度与 SHA-256 校验。
- `install.js`：准备安装文件，退出后替换程序；替换失败时尝试恢复原程序。
- `../launcher/update-ui.js`：顶部更新按钮、说明弹窗、进度条及重启操作。

固定发布源：`https://github.com/Tikzen/CloudBerth/releases`。客户端访问公开的 Releases API，不需要也不得内置 GitHub Token。

## 1. 版本号与标签

应用的 `package.json`、`package-lock.json` 根版本与根包版本必须一致。Mac 包内的 `CFBundleShortVersionString` 也必须与 Release 的三段数字版本一致。

推荐同一轮更新使用共同的数字版本，例如 `1.4.0`，分别创建：

| 平台 | 标签示例 | 标题示例 | Release 状态 |
| --- | --- | --- | --- |
| Mac | `v1.4.0` | `CloudBerth 1.4.0 — macOS` | 正式版，可设为 Latest |
| Windows | `v1.4.0-windows-test` | `CloudBerth 1.4.0 — Windows 测试版` | Pre-release |

后续 Windows 转为稳定版时可用 `v1.5.0-windows`，取消 Pre-release。Mac 也可以用 `v1.5.0-macos`，但不能标记为 Pre-release。

客户端按 **主版本、次版本、修订号** 的数字顺序比较，允许标签带渠道后缀。后缀不参与版本高低比较：`1.4.0-windows-test` 与 `1.4.0` 是同一数值版本。修复后重发必须增加数字版本，不能只改标题、后缀或替换同版本附件。

## 2. 必需附件

### macOS / Apple Silicon

```text
CloudBerth-1.4.0-mac-arm64.zip    # 软件内更新必需
CloudBerth-1.4.0-mac-arm64.dmg    # 供首次安装使用，推荐
SHA256SUMS.txt                   # 软件内更新必需
```

ZIP 解压后的顶层必须为 `CloudBerth.app/`（允许 ZIP 工具生成 `__MACOSX/` 元数据目录）。应用必须满足：

- `CFBundleIdentifier` 为 `com.cloudberth.app`。
- `CFBundleShortVersionString` 为 Release 的数字版本，例如 `1.4.0`。
- 通过 `codesign --verify --deep --strict`；当前项目为临时签名。
- 不包含个人配置、网站会话、Token 或开发测试资源。

若将来提供经过验证的 Intel Mac 发行包，文件名为 `CloudBerth-<版本>-mac-x64.zip`，并把相应校验值加入同一 `SHA256SUMS.txt`。客户端不会为不匹配的架构选择其他包。

**只有 DMG、缺少 ZIP，或者 Mac Release 标为 Pre-release，都不会向 Mac 客户端推送。**

### Windows x64

```text
CloudBerth-1.4.0-x64.exe
SHA256SUMS-windows.txt
```

EXE 必须是当前 electron-builder 生成的 **portable 便携包**；更新目标是最外层便携 EXE，不是解压后的内部应用。必须从便携包启动，构建器提供 `PORTABLE_EXECUTABLE_FILE` 来定位待替换文件。

Windows 客户端允许接收 Pre-release，但只选择对应架构的 EXE 与 Windows 校验文件。Mac 的 Latest 不会被当作 Windows 更新。

## 3. SHA-256 文件格式

使用 UTF-8 文本，一行一个文件，64 位十六进制 SHA-256、两个空格、完整文件名：

```text
<64位SHA256>  CloudBerth-1.4.0-mac-arm64.zip
<64位SHA256>  CloudBerth-1.4.0-mac-arm64.dmg
```

Windows 文件示例：

```text
<64位SHA256>  CloudBerth-1.4.0-x64.exe
```

以上为格式示例；尖括号内容必须替换为构建产物的真实哈希。Mac 可用 `shasum -a 256` 生成，Windows 构建脚本 `node tools/verify-windows.js` 会生成校验文件。不得手写猜测哈希，文件名大小写必须与附件完全一致。

## 4. Release 说明模板

```markdown
一个专为网页云游戏打造的沉浸式体验空间。

## 本次更新
- 新增……
- 修复……

## 下载与更新
- macOS：下载对应架构 DMG 或 ZIP；已有 1.4.0 及以上版本可在软件内检查更新。
- Windows：下载 x64 便携 EXE，双击运行；已有 1.4.0 及以上版本可在软件内检查更新。
- 附件中的 SHA256SUMS 文件提供完整性校验。

## 兼容性与发行状态
- 写明实际支持的系统、架构，以及稳定版或测试版。
- 写明签名状态、已验证范围和已知问题。
```

每个平台只保留与本次 Release 相关的说明。说明以普通文本在软件中显示；Markdown 源文本可以显示，HTML 不会执行。

## 5. 发布顺序

1. 更新版本号、CHANGELOG 和平台说明。
2. 运行 `npm run check`、`npm run test:updates`、`npm run test:updates-ui` 及相关平台回归测试。
3. 在对应系统构建。Mac 生成 ZIP/DMG；Windows 通过 Windows 构建工作流生成 portable EXE。
4. 校验安装包、包内版本、平台架构及源文件，然后生成 SHA-256 文件。
5. 先创建 **Draft Release**，上传完整安装包和校验文件。
6. 核对标签数字版本、平台状态、附件命名和实际哈希。
7. 完整核对后再公开 Release。Mac 可更新 Latest；Windows 测试版必须保留 Pre-release。
8. 用较低版本客户端验证：对应系统发现更新、显示说明、下载进度、校验、重启安装与数据保留。

推送 Git commit、创建 Git tag、上传 GitHub Actions Artifact 都不会单独触发客户端更新，必须公开符合上述格式的 GitHub Release。每次查询最多读取最近 100 个 Release；不要用大量无关 Release 挤出有效的平台版本。

## 6. 客户端行为与数据

- 正式版启动约 15 秒后检查，之后每 6 小时检查；开发运行不自动检查或替换程序。
- 顶部按钮和 Mac 应用菜单可以手动检查。
- 游戏运行、启动器不在前台或其他弹窗打开时，推迟自动弹窗。
- “跳过此版本”记录标签；手动检查仍能再次查看，新数字版本仍会提示。
- “立即更新”直接下载；支持取消，下载完成后验证 SHA-256，再准备安装。
- “重启并更新”前必须结束所有游戏；下载期间可以关闭更新窗口。
- Mac 从 DMG 运行或程序目录不可写时，更新不会替换原应用。Windows 便携 EXE 目录也必须可写。
- 不提升管理员权限，不修改游戏库与会话目录。
- 运行状态保存在用户数据目录下 `updates/`，包括跳过记录、下载缓存及安装结果。替换时保留同目录旧程序备份，新版本实际启动后才清理备份。
- 1.3.x 没有更新检查功能，必须先手动升级到 1.4.0。

## 7. 验证边界

自动化测试包含版本／平台筛选、损坏包拒绝、取消下载、跳过记录、进度界面、重启触发及隔离目录中的替换回退。发布记录必须区分这些检查与真实旧版本到新版本的完整升级实测，不能把模拟检查写成实机升级完成。
