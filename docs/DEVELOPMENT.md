# 开发、验证与发布

## 开发环境

这是直接执行的 JavaScript 项目。没有 TypeScript、tsconfig、编译产物或 watch 构建步骤，也没有需要下载的 npm 依赖。因此不需要照搬官方 TypeScript 模板的 npm install / npm run build 步骤。Creator 集成结构见 [EXTENSION.md](EXTENSION.md)，命令行和转换 API 见 [CLI.md](CLI.md)。

在独立测试项目的 `extensions/cocos-studio-importer` 下放置源码，启用后从文件菜单打开面板。转换过程中不要重载扩展；任务结束后再修改、重载并验证。源 Studio 工程保持只读。

## 本地检查

在工具根目录运行：

```powershell
npm run check
npm test
```

`check` 实际执行 `node cli.js --help`；`test` 执行 direct、updater、reuse 三组回归测试。二者不启动 Creator。若受限执行环境不允许测试器创建子进程，已安装的 Node 24 可使用：

```powershell
node --test --test-isolation=none test/direct.test.js test/updater.test.js test/reuse.test.js
```

回归测试覆盖坐标换算、缺失资源、目录越界、循环嵌套、图集矩形、对象/UUID 引用、原生控件引用、默认资源与依赖、图片命名和同名冲突、指定目录、连续导入、UUID 保留和修改内容保护。它们不替代 Creator 的渲染与交互验收。

修改控件序列化或资源 .meta 后，应在独立 Creator 3.8.8 工程中检查：资源库导入、Prefab 加载和实例化、缺失脚本/图片、实际交互。修改 ZIP 分发方式时，应通过扩展管理器安装测试，不能只用复制目录代替。

历史验证记录在开发工作区的 `reports/`：0.2.1 默认图片加载验证、0.2.2 实际 ZIP 安装验证、0.2.3 图片命名转换报告、0.2.4 文档与 CLI 验证。0.2.5 增加 Label 描边与阴影回归测试，并在 Creator 3.8.8 中加载合成样本及 ActivateDialog，核对反序列化后的效果属性和弃用警告。这是加载及属性验证，不等同于所有功能的视觉验收。

## 分发目录与 ZIP

0.3.0 起推荐执行 `npm run release`，一次生成安装 ZIP、`SHA256SUMS.txt` 与发布说明；GitHub Actions 在推送版本标签后执行同一流程。详见 [GitHub 发布与编辑器内更新](PUBLISHING.md)。下面的 `node cli.js package` 仍保留，只生成目录。

1. 更新 `package.json`、`package-lock.json` 的版本，并同步 README、开发文档和 CHANGELOG。
2. 执行测试与 CLI 示例。
3. 运行 `npm run package`（等价于 `node cli.js package`）。脚本读取当前版本，生成新的 `dist/cocos-studio-importer-<version>`。目标目录已存在时拒绝覆盖；不要将用户工作文件存入 dist。
4. 从分发目录的内容生成 ZIP，确保 package.json 在 ZIP 根目录。

```powershell
npm run package
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Compress-Archive -Path "dist/cocos-studio-importer-$version/*" -DestinationPath "dist/cocos-studio-importer-$version.zip"
```

发布包包含 `main.js/panel.js/cli.js/lib/vendor/resources/test/docs/scripts`、清单、README、CHANGELOG 和第三方说明。排除 `node_modules/.work/reports/dist`。源码仓库额外包含 .github 工作流与 Git 配置；保留 XML 解析器许可证和默认资源清单。不要通过 npm 安装覆盖 vendor 文件。

这个 ZIP 同时是 Creator 扩展安装包和独立 Node 工具分发包。Creator 根据清单安装到 `extensions/cocos-studio-importer`；CLI 用户可直接在解压目录运行命令。Node 调用不使用 Creator 的 main 入口。

## 排错

| 现象 | 检查与处理 |
| --- | --- |
| 扩展不显示或无菜单 | 检查安装目录层级、根 package.json、是否启用、Creator 版本范围及控制台错误 |
| 安装出现 EPERM | 使用 0.2.2 及以后无 node_modules 的包；仍失败可关闭目标工程后按 README 手动解压安装。不能仅凭 EPERM 断言一定是依赖或杀毒软件原因 |
| Cannot find vendor/... | 分发不完整或目录层级错误；重新完整解压，核对 vendor/xmldom/lib 与许可证 |
| 已有任务正在执行 | 等待任务结束；关闭面板不会取消 Worker |
| 缺少资源、未生成输出 | 使用 plan 查 missing 和 from；同时检查内置 Default 文件是否齐全 |
| 输出目录必须不存在 | CLI convert 或 Node project:true 创建新工程仍要求新目录；assets 模式可使用已有目录并复用相同资源，不覆盖不同内容 |
| 有图片但位置/行为不同 | 检查 warnings；ListView 排列、动画、特殊控件和部分适配规则未完整转换 |
| LabelOutline.color / LabelShadow 弃用警告 | 更新到 0.2.5 或以后版本并重新导入 CSD，使用新 prefab。旧 prefab 不会随扩展升级自动迁移；已有手工修改应先备份并对照合并 |
| CLI 中 Editor is not defined | 不应直接运行 main.js/panel.js；改用 cli.js 或 lib/direct.js |
| 无法把 CLI stdout 当一个 JSON 解析 | convert/assets 含进度输出；读取 reportPath 对应文件，或直接调用 Node API |

反馈问题时提供工具版本、Creator/Node 版本、调用方式、最小 CSD 与相关资源、缺失项或报告。原业务资源不随测试报告自动上传。
