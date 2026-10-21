# GitHub 发布与编辑器内更新

仓库：[youngl0/cocosStudio-importer](https://github.com/youngl0/cocosStudio-importer)。安装包仍使用扩展标识 `cocos-studio-importer`，不要把安装目录改成 GitHub 仓库名。

## 用户更新

1. 首次从 [Releases](https://github.com/youngl0/cocosStudio-importer/releases) 下载 `cocos-studio-importer-版本.zip`，在 Creator 扩展管理器安装并启用。不要下载 GitHub 自动生成的 Source code ZIP 来代替安装包。
2. 在「文件 → 导入 Cocos Studio 工程」面板底部点击「检查更新」。面板显示当前版本、新版本和 Release 说明。
3. 点击「下载并安装更新」。导入任务运行时不能安装更新。更新器下载 ZIP 和 `SHA256SUMS.txt`，核对 SHA-256、包名、版本、包结构及当前 Creator 版本范围，再安装。
4. 安装完成后，在「扩展 → 扩展管理器」重新加载此扩展，或重新打开工程。等待重新加载期间会暂停新的导入操作。

旧扩展保存在项目或全局扩展目录上一级的 `.cocos-studio-importer-backups/旧版本-唯一标识` 中；不会混入 extensions 扫描目录。替换失败时会尝试恢复旧版，极端情况下无法恢复会显示备份的准确位置。手动回退时先关闭对应编辑器，把当前扩展目录移到其他位置，再将备份放回原安装目录。

更新支持正常安装的项目和全局扩展。开发源码目录、符号链接安装会拒绝覆盖。全局扩展更新前，应关闭其他使用同一扩展的编辑器工程。GitHub 检查为手动触发，不在启动时联网，不自动安装。网络失败或尚无 Release 时会显示原因并保留当前版本。

当前使用 GitHub 公共 REST API，仅支持公开仓库的稳定版；不读取或保存 GitHub Token，不安装预发布版本，也不降级。离线转换和 Node.js CLI 不受影响。校验文件用于检测下载损坏；更新的信任来源仍然是这个 GitHub 仓库及其发布权限。

## 发布新版本

仓库根目录应直接包含本项目的 package.json、main.js 和 .github，不应再套 `cocos-studio-importer/` 一层。本地 `.work`、`reports`、`node_modules`、`dist`、旧 `bridge-2x` 已加入 .gitignore。

1. 同步修改 `package.json` 与 `package-lock.json` 两处版本；更新 README、扩展说明和 CHANGELOG。
2. 执行 `npm test`、`npm run check-release`；需要本地安装包时执行 `npm run release`。
3. 提交代码到 main，推送与清单一致的版本标签，例如：

```bash
git add .
git commit -m "feat: release 0.3.1"
git push origin main
git tag v0.3.1
git push origin v0.3.1
```

`release.yml` 在 GitHub Actions 的干净环境中执行测试、核对 tag 与 package.json 一致、校验全部默认资源，生成安装包，再通过 GitHub CLI 创建 Release 并附加 ZIP 与 `SHA256SUMS.txt`。工作流使用仓库自动提供的 `GITHUB_TOKEN`，release job 具有 `contents: write`；不需要把个人 Token 放进源码。

`ci.yml` 在 Windows 和 Linux 上测试、打包。所有构建无需 npm install，运行时和构建工具均使用随仓库附带的模块或 Node 标准库。首次发布后可在仓库 Actions 页面检查执行结果；若组织策略禁止 Actions 写入，需要管理员允许此工作流创建 Release。

手动发布时，也必须上传 `npm run release` 生成的这两个文件，名称保持不变：

```text
dist/cocos-studio-importer-0.3.0.zip
dist/SHA256SUMS.txt
```

只推送 tag、只修改源码，或只上传 Source code ZIP，都不会形成可安装的更新。安装包中的版本必须与 Release tag 对应。

## 本地发布工具

`node cli.js package` 保留原有行为，只生成分发目录。`npm run release` 在此基础上生成标准 ZIP、校验文件与 `RELEASE_NOTES.md`；目录存在时拒绝覆盖。再次构建同版本时使用干净检出目录，避免误覆盖已有发布材料。

更新器使用 Node.js 标准库 HTTPS 和内置 ZIP 处理器，不依赖原导入扩展、npm 包安装、系统解压命令或 Git。解压前拒绝目录穿越、路径冲突、符号链接、加密条目、CRC 错误和超出体积限制的文件。

## 资源及授权说明

本仓库保留 xmldom 的 MIT 许可证及来源记录。Cocos Studio 默认资源沿用原有权利归属，详见 THIRD_PARTY_NOTICES.md；仓库发布不会为这批资源授予新的开源许可证。

接口参考：[GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)、[Creator 安装与重载扩展](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/install.html)。
