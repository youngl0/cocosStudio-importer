# 独立 Node.js 使用说明

CLI 能力完整保留，与 Creator 扩展共用 `lib/source.js`、`lib/direct.js`、`lib/direct-assets.js`。执行转换不需要安装或启动 Creator、Cocos Studio、Creator 2.x 或旧迁移扩展，也不需要网络或 npm install。查看和运行生成的 Creator 工程仍需 Creator。

## 环境与输入

- Node.js 最低声明版本为 18；本机实际验证为 Windows PowerShell + Node.js 24.16.0。其他 Node/操作系统组合没有完整验证记录。
- 保持整个解压目录，包含 `cli.js/lib/vendor/resources/package.json`；不能只复制 cli.js。
- 源工程是 `.ccs`，其同级目录下应有 `cocosstudio/`。本版没有单独传入资源根目录的选项。
- CSD 参数使用 CCS 登记的相对路径，如 `dialogs/Login.csd`，不是绝对路径；使用 `/`。可通过 `scan` 获取准确拼写。
- `convert` 输出的新工程目录必须不存在；`assets` 可以使用已有目录。输出不能与源资源目录重叠，也不能通过符号链接指向其他目录。

## 命令

以下命令在工具根目录执行；也可以使用 cli.js 的绝对路径，从任意工作目录调用。

| 命令 | 参数 | 结果 |
| --- | --- | --- |
| `--help` | 无 | 输出命令帮助；无参数调用也会显示帮助 |
| `scan` | `<project.ccs>` | 只读扫描，输出项目和 CSD 清单 JSON |
| `plan` | `<project.ccs> [CSD ...]` | 只读依赖预检；输出缺失项、类型统计、字节数和提示，省略完整 files 列表 |
| `convert` | `<project.ccs> <新工程目录> [CSD ...]` | 生成 package.json、assets/studio 和报告 |
| `assets` | `<project.ccs> <资源目录> [CSD ...]` | 支持已有目录；内容和导入设置相同的资源复用原文件与 UUID，不同则加后缀另存 |
| `package` | 无 | 生成 dist/cocos-studio-importer-当前版本；不自动压缩 ZIP |

`plan/convert/assets` 中省略全部 CSD 参数意味着选择 CCS 中的全部界面。已选择的界面还会自动包含嵌套依赖。没有 `--all`、`--output`、`--force` 等命名参数；这些字符串会被视为位置参数，不能混用。

```powershell
node cli.js --help
node cli.js scan "D:\StudioProject\demo.ccs"
node cli.js plan "D:\StudioProject\demo.ccs" SampleDialog.csd

# 生成新工程；目录名可自行调整，必须尚不存在
node cli.js convert "D:\StudioProject\demo.ccs" "F:\StudioConverted" SampleDialog.csd AnotherDialog.csd

# 向指定 assets 子目录导入；目录存在时复用完全相同的资源
node cli.js assets "D:\StudioProject\demo.ccs" "F:\MyCreatorProject\assets\studio-import" SampleDialog.csd
```

`convert` 的工程清单当前固定写入 `creator.version = 3.8.8`；没有目标版本切换选项。首次用 Creator 打开时，编辑器会导入资源并补全工程缓存。`assets` 不主动调用 asset-db，编辑器打开工程后由资源扫描处理。

## 输出和退出码

| 情况 | 退出码 | 输出 |
| --- | --- | --- |
| 正常执行 | `0` | stdout 输出结果 |
| 转换完成但有提示 | `0` | `phase = complete-with-warnings`；应检查报告 |
| plan 找到缺失引用 | `0` | 预检执行成功；结果的 `missing` 非空。自动化应显式判断 |
| 参数、XML、资源或转换错误 | `1` | stderr 输出错误；缺失资源时附带结构化报告 |

`scan/plan` 的 stdout 是一个 JSON 对象；`convert/assets` 先逐行输出进度 JSON，再输出多行结果摘要，所以不能把整个 stdout 直接当成单个 JSON 解析。转换摘要包含 `reportPath`；需要稳定结构时，读取报告或使用下面的 Node API。

首次报告位于 `<output>/studio-import-report.json`；重复导入会生成带唯一后缀的新报告，不覆盖已有报告。请始终读取返回的 reportPath。核心字段：

| 字段 | 含义 |
| --- | --- |
| `version/mode/source/selected/output` | 转换器版本、direct 模式、输入与输出 |
| `phase` | 完成、带提示完成或失败 |
| `missing` | 缺失引用及来源；缺失预检阶段尚未创建文件，见错误对象 |
| `warnings` | 控件、布局或资源限制；不是所有未支持属性的完整清单 |
| `prefabs` | `{ source, file, uuid, nodes, reused }` |
| `resources` | 每个资源的输出 file、类型、UUID 及 reused 标记 |
| `createdResources/reusedResources` | 本次新增/复用的不同资源文件数，不含报告与 .meta 文件计数 |
| `images` | 源路径、origin、输出图片、SpriteFrame UUID、裁切与边距；没有图片时可能不出现 |
| `defaultResources` | 按需复制的默认文件 |
| `spriteFrames` | 成功转换的帧数 |
| `dependencyErrors` | 序列化对象或资源 UUID 引用检查结果 |
| `error` | 转换阶段失败时的错误堆栈 |

预检缺失时不写入导入资源；开始生成后的失败会保留部分文件和失败报告。不会自动回滚或覆盖已有资源。修复源资源后，可对 assets 命令的同一目录重试并复用相同资源；convert 仍需新工程目录。

## 直接调用 Node API

```javascript
// 保存为工具根目录的 example.cjs 后运行 node example.cjs。
const { scan, plan } = require('./lib/source');
const { convert } = require('./lib/direct');

const ccs = 'D:/StudioProject/demo.ccs';
const selection = ['SampleDialog.csd'];
const preflight = plan(ccs, selection);
if (preflight.missing.length) throw new Error(JSON.stringify(preflight.missing));

try {
  const report = convert({
    ccs,
    selection,
    output: 'F:/StudioConvertedFromNode', // 尚不存在的目录
    project: true,                      // false/省略：只生成资源
  }, progress => console.log(progress));
  console.log(report.reportPath, report.prefabs.length);
} catch (error) {
  console.error(error.report || error.reportPath || error.message);
  process.exitCode = 1;
}
```

`scan/plan/convert` 均为同步函数。`convert` 在返回前完成写盘；大工程会占用当前线程。需要交互界面时可自行放进 worker_threads。`project: false`（或省略）支持已有 output，自动复用资源；指定 `reuseExisting: false` 可强制要求新目录。`project: true` 始终要求新工程目录。`namespace` 是可选的内部 UUID 命名空间，默认随机；复用时以目标目录中已有资源的 UUID 为准，新增资源会避免与目标目录已扫描 UUID 冲突。

模块错误信息通过 `error.report`（缺失预检）或 `error.reportPath`（已开始写盘后的失败）传递。无需构造或模拟 `Editor` 全局对象。
