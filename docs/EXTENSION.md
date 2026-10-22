# Creator 3.8 扩展开发说明

适用版本：扩展 0.4.3，目标 Creator 3.8.2–3.8.x；实际编辑器验证版本为 Windows Creator 3.8.8。其他 3.8 补丁版本尚未逐一验证。本项目直接分发 CommonJS JavaScript，不需要 TypeScript 编译。

## 扩展定义与入口

Creator 通过 `package.json` 识别扩展的入口、面板和贡献功能。本项目按官方[扩展包定义](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/define.html)配置以下字段。

| 字段 | 本项目设置 | 用途 |
| --- | --- | --- |
| `name` | `cocos-studio-importer` | 扩展标识；安装目录使用同名 |
| `package_version` | `2` | 保持 Creator 扩展包格式设置，不随补丁版本增加 |
| `version` | `0.4.3` | 本工具发布版本 |
| `title` | `Cocos Studio 导入器` | 扩展管理器显示名称 |
| `description` / `author` | 见根目录清单 | 功能描述与作者信息 |
| `editor` | `>=3.8.2 <3.9.0` | 限定目标编辑器版本范围；不代表所有补丁版本已测试 |
| `main` | `./main.js` | 编辑器主进程入口，注册消息处理方法 |
| `panels.default.main` | `./panel.js` | 默认面板入口 |
| `contributions.menu` | 文件菜单中的导入项 | 触发 `open` 消息 |
| `contributions.messages` | `open/scan/start/status/defaults/update-status/check-update/install-update` | 消息路由到 `exports.methods` |
| `scripts` | `test/check/package/check-release/release` | 开发检查与分发目录、Release 文件生成 |
| `repository/homepage/bugs` | youngl0/cocosStudio-importer | 源码、发布和反馈地址 |
| `engines.node` | `>=18` | 独立 CLI 的最低环境声明；与 Creator 的 `editor` 字段用途不同 |

`main` 是 Creator 的入口，独立运行使用 `node cli.js`。不要通过 `node main.js` 启动界面，也不要把 `require('本扩展目录')` 当作转换 API；Node API 应明确导入 `lib/direct.js`。

## 项目目录

```text
cocos-studio-importer/
├─ package.json / package-lock.json   扩展清单、版本和脚本；无 npm 依赖
├─ main.js                          Editor 主进程：启动任务、接收进度、刷新资源库
├─ panel.js                         面板：文件选择、CSD 列表、状态轮询
├─ cli.js                           独立 Node.js 命令行入口
├─ lib/
│  ├─ updater.js                    GitHub 检查、下载校验、备份与安装
│  ├─ archive.js                    Node 标准库 ZIP 读写与路径/CRC 检查
│  ├─ output-store.js               目标目录校验、文件与 .meta 对比、复用及冲突另存
│  ├─ source.js                     CCS 扫描、路径校验、依赖预检、默认资源解析
│  ├─ direct.js                     CSD → Prefab 与转换报告
│  ├─ direct-assets.js              图片、图集、字体与 .meta
│  └─ direct-worker.js              worker_threads 的进度/结果/错误转发
├─ vendor/xmldom/                   XML 解析器源码、NOTICE 和 MIT LICENSE
├─ resources/Default/               内置 Studio 默认资源
├─ resources/default-resources.json 默认资源来源、大小、SHA-256
├─ test/direct.test.js              转换器回归测试
├─ docs/                            开发、CLI、发布说明
├─ scripts/release.js                安装包、SHA256SUMS 与发布说明生成
├─ .github/workflows/                跨平台验证及标签触发发布
├─ README.md / CHANGELOG.md / THIRD_PARTY_NOTICES.md
├─ reports/                         本地验证记录；不随安装包分发
├─ .work/                           本地测试工程；不随安装包分发
└─ dist/                            发布目录与 ZIP；不嵌套进新发布包
```

历史工作区可能留有 `node_modules`；0.2.2 起运行入口使用 `vendor`，发布流程不复制 `node_modules`。

## 安装、启用与卸载

优先安装到项目：在「扩展 → 扩展管理器」的「项目」页导入发布 ZIP，然后启用扩展。官方[安装与分享说明](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/install.html)要求 ZIP 内直接包含扩展内容，本项目 ZIP 根目录直接放置 `package.json`。

手动安装时，把 ZIP 内容放到 `<Creator工程>/extensions/cocos-studio-importer/`；不要把 `dist/cocos-studio-importer-0.4.3` 整层再套进同名文件夹。重新打开工程或在管理器中重新扫描、启用。安装后菜单位置为「文件 → 导入 Cocos Studio 工程」。

升级前等待导入任务完成，备份旧扩展到工程外，再替换或使用扩展管理器更新。导入生成的指定 assets 子目录 与扩展代码目录分开；卸载扩展不会由本工具主动删除这些输出。输出资源只使用 Creator 原生组件，不需要本导入器作为游戏运行时依赖。

## 运行边界与生命周期

```text
panel.js → Editor.Message.request → main.js → Worker(direct-worker.js)
                                               ↓
                                      source / direct / direct-assets
                                               ↓
                                  检查已有资源 → 写入 assets/<指定目录>
                                               ↓
main.js ← Worker 结果 → asset-db / refresh-asset → status → panel.js

cli.js ───────────────────────────→ 同一个转换核心（无 Editor API）
```

- `main.js` 导出 `load`、`unload`、`methods`。当前 `load/unload` 是空钩子，初始化状态来自模块加载。
- `panel.js` 导出 `template/style/$/ready/close`；`ready` 注册交互并每秒请求状态，`close` 清除轮询定时器。使用方式对应官方[面板系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/panel.html)。
- 关闭面板只停止面板轮询，不会取消后台转换。当前没有取消、断点续传或任务队列；转换期间不要禁用或重载扩展。`unload` 尚未实现工作线程终止与回收流程。
- 每个加载的扩展实例最多执行一个转换任务；重复 `start` 会报错。状态保存在内存中，重载后不会恢复。
- 更新状态由 `update-status` 独立查询；`check-update` 手动检查稳定版 Release，`install-update` 安装最近检查到的版本。更新与转换互斥；更新完成等待重新加载时拒绝新转换。下载失败可重试，开发目录拒绝覆盖安装。详见 [GitHub 发布与更新](PUBLISHING.md)。
- `scan` 在主进程同步执行；预检、复制和生成由 Worker 执行。Worker 中不调用 `Editor`；成功后由主进程刷新新目录的 asset-db。
- 核心成功与资源库刷新成功是两个阶段：如果刷新失败，磁盘上的转换报告可能已是 `complete`，而扩展 `status` 是 `failed`。保留输出并检查 Creator 控制台。

## 消息接口

调用方式是 `Editor.Message.request('cocos-studio-importer', message, ...args)`。这些是本项目实现的消息，不是 Creator 内置转换 API；路由遵循官方[自定义消息](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/contributions-messages.html)机制。

| 消息 | 参数 | 返回/行为 |
| --- | --- | --- |
| `open` | 无 | 打开默认面板，无业务返回值 |
| `defaults` | 无 | `{ project: 当前工程绝对路径, mode: 'direct', folder: 'studio' }` |
| `scan` | `.ccs` 路径字符串 | `{ ccs, resourceRoot, name, version, projects, resourceEntries }`；单个 project 为 `{ path, type, exists }` |
| `start` | `{ ccs, selection: string[], folder?: string }` | folder 为 assets 下的相对目录，默认 studio，可填 UI/Studio；非空选择列表，后台转换并复用已有相同资源 |
| `status` | 无 | 当前状态对象；按阶段带有 `message/current/total/file/reportPath/error/missing` 等可选字段 |

```javascript
// 仅在 Creator 编辑器上下文运行。先从 scan 的 projects 中取得真实路径。
const source = await Editor.Message.request('cocos-studio-importer', 'scan', ccsPath);
const selection = source.projects.filter(p => p.exists).slice(0, 1).map(p => p.path);
if (!selection.length) throw new Error('没有可导入的 CSD');
await Editor.Message.request('cocos-studio-importer', 'start', { ccs: ccsPath, selection, folder: 'UI/Studio' });
while (true) {
  const state = await Editor.Message.request('cocos-studio-importer', 'status');
  if (state.phase === 'failed') throw new Error(state.error);
  if (['complete', 'complete-with-warnings'].includes(state.phase)) {
    console.log(state.reportPath);
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

状态通常依次为 `idle → planning → indexing → converting → importing → complete/complete-with-warnings`；任一阶段可进入 `failed`。indexing 检查指定目录的内容和 .meta；复用资源不重写原文件。`reportPath` 仅在已有报告时可用。资源缺失发生在写入前，错误中携带 `missing`，不保证有报告文件。

## 增加控件转换

在 `lib/direct.js` 的 `Prefab.convert` 添加控件映射，在 `direct-assets.js` 处理新增资产类型，在 `source.js` 纳入其资源依赖。序列化字段要对照目标 Creator 引擎；不要直接增加未定义的 `cc.*` 类型。未支持的行为必须加入报告，而不是静默丢弃。

先添加最小 CSD 测试，验证坐标、节点引用和 UUID，再使用独立测试工程验证 Creator 加载与交互。开发验证和发布命令见 [DEVELOPMENT.md](DEVELOPMENT.md)。
