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

## 1.3.0

当前 Apple Silicon 发行附件：CloudBerth-1.3.0-mac-arm64.dmg、CloudBerth-1.3.0-mac-arm64.zip、SHA256SUMS.txt。
来源与素材说明见 THIRD_PARTY_NOTICES.md。
