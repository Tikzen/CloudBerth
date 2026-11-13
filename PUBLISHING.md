# 维护与发布

独立仓库：[Tikzen/CloudBerth](https://github.com/Tikzen/CloudBerth)，默认分支 main。
README 和 THIRD_PARTY_NOTICES.md 保留上游来源说明。

## 提交源码

```sh
git status --short
git add .
git diff --cached --stat
git commit -m "Describe the change"
git push origin main
```

使用自己的 GitHub 提交身份，可在仓库级配置 GitHub noreply 邮箱。不要把访问 Token 写入源码或远端 URL。

.gitignore 排除 node_modules、dist、tmp、个人配置和会话文件。
源码保留 config.default.json 默认模板；README 截图由 tools/capture-readme.js 使用合成数据生成。

## 发布发行包

1. 更新 package.json、package-lock.json 的版本与 CHANGELOG.md。
2. 运行 README 中适合当前修改的检查，确认图标和界面截图同步。
3. 在目标系统构建，将 DMG/ZIP 放入 GitHub Release 附件，不提交到源码历史。
4. 为附件生成 SHA256SUMS.txt，与安装包一起上传。

macOS 当前使用临时签名，尚未配置 Developer ID 公证；正式签名凭据保存在发布环境，不进入 Git。

## 1.4.0

当前 Apple Silicon 发行附件：CloudBerth-1.4.0-mac-arm64.dmg、CloudBerth-1.4.0-mac-arm64.zip、SHA256SUMS.txt。
来源与素材说明见 THIRD_PARTY_NOTICES.md。

## 应用内更新的 Release 契约（1.4.0 起）

- Mac：发布非预发布 Release，包含 `CloudBerth-<版本>-mac-<架构>.zip`、可选 DMG 和 `SHA256SUMS.txt`。ZIP 须包含已签名（当前为临时签名）的 `CloudBerth.app`，应用标识为 `com.cloudberth.app`，包内版本与标签一致。
- Windows：包含 `CloudBerth-<版本>-x64.exe` 和 `SHA256SUMS-windows.txt`，可标记 Pre-release。
- 标签采用 `v<主>.<次>.<修订>`，允许附加 `-macos`、`-windows-test` 等渠道后缀。版本比较按前三段数字进行；同一数值版本不会相互升级。
- 校验文件使用标准 `sha256  文件名` 格式。上传完整且校验正确后再公开 Release，草稿不参与更新。
- 修改源码或创建标签本身不会触发更新，只有符合本机平台与架构的完整 Release 才会被发现。
- `npm run test:updates` 验证下载与替换回退；`npm run test:updates-ui` 验证进度条和取消交互。两者使用隔离临时目录与模拟发行包。

更新功能的完整发布格式与检查清单见 [src/updater/README.md](src/updater/README.md)。
