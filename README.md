# Cocos Studio → Creator 3.8 独立导入器 0.4.2

直接读取 .ccs / .csd / 图片，生成 Creator 3.8 原生 Prefab 和 .meta。转换核心用 Node.js 编写；XML 解析器 @xmldom/xmldom 0.9.12 以未修改的源码附带在 vendor/xmldom，保留 MIT 许可证；运行时无 npm 依赖。另内置用户提供的 Cocos Studio Default 原始资源。

**无需 Creator 2.x、plugin-import-2x 或 StudioComponent 兼容脚本。** 不读取安装目录中的旧转换器，不启动 2.x 编辑器；转换过程不联网。只有手动检查或安装更新时访问 GitHub。0.1.0 的桥接版本 ZIP 保留在 dist 中供回退；当前发布包只包含独立转换器。

## 两种运行方式

**保留 Node.js 直接运行能力。** 同一发布包既能装进 Creator，也能解压后作为命令行工具运行。

| 方式 | 入口 | 所需环境 |
| --- | --- | --- |
| Creator 扩展 | 文件菜单 → 导入 Cocos Studio 工程 | Creator 3.8.2–3.8.x；已实际验证 3.8.8 |
| 独立命令行 | node cli.js | Node.js ≥18；已实际验证 24.16.0；转换时无需 Creator |
| Node 脚本调用 | require('./lib/direct').convert | 同上，无 Editor 全局依赖 |

扩展中的 main.js 是 Creator 入口，不能用来代替 CLI。输出的新工程清单目前固定标记为 Creator 3.8.8。

## 文档导航

- [扩展开发说明](docs/EXTENSION.md)：目录结构、清单字段、面板、消息接口、进程边界与生命周期。
- [Node.js 与 CLI 说明](docs/CLI.md)：全部命令、选择规则、退出码、报告字段、直接调用示例。
- [GitHub 发布与编辑器内更新](docs/PUBLISHING.md)：Release、版本标签、自动打包、更新与回退。
- [开发与发布](docs/DEVELOPMENT.md)：验证命令、打包、升级与排错。
- [版本记录](CHANGELOG.md) · [第三方源码与资源](THIRD_PARTY_NOTICES.md)。

## 作为 Creator 3.8 扩展使用

1. 在扩展管理器中选择「项目」，导入 dist/cocos-studio-importer-0.4.2.zip。ZIP 根目录直接包含 package.json。
2. 如果已经安装旧版本，替换同名扩展并重新加载，然后确认已启用。
3. 在「文件 → 导入 Cocos Studio 工程」打开面板。
4. 选择 .ccs，扫描并勾选需要的 CSD，点击「导入所选界面」。
5. 填写导入目录（相对于 assets，默认 studio，可填 UI/Studio），点击导入。资源生成在指定目录；可使用已有目录。打开报告目录查看本次报告，Prefab 位于 prefabs 子目录。

完全相同的资源复用已有文件和 UUID；同名但内容不同的资源使用后缀另存，保留旧文件与 .meta。业务脚本及事件绑定需在 Creator 中接入。

## 编辑器内更新

从 [GitHub Releases](https://github.com/youngl0/cocosStudio-importer/releases) 首次安装 0.3.0 或更新版本后，可在导入面板底部点击「检查更新」和「下载并安装更新」。旧版会自动备份，安装完成后请在扩展管理器重新加载本扩展。无需安装 Git；离线导入能力保留。详见 [发布与更新说明](docs/PUBLISHING.md)。

0.4.1 起优先读取 Release 附带的版本信息文件，避免检查更新受 GitHub 匿名 API 额度影响。如果旧版已显示「GitHub 请求受限」，请从发布页手动安装一次 0.4.1 或更新版并重新加载。

## 安装异常处理

0.2.2 调整为 vendor 源码分发，ZIP 不再包含 node_modules，也不声明 npm dependencies，避免安装时处理这类依赖目录。无需执行 npm install。

若扩展管理器仍报 EPERM，可关闭目标工程的 Creator，把 ZIP 内容解压到「工程目录/extensions/cocos-studio-importer」，确认该目录直接包含 package.json、main.js、lib、vendor、resources，然后重新打开工程。若已有同名目录，先将旧目录移到工程外留作备份，再放入新版；不要嵌套一层带版本号的目录。

## 独立命令行使用

需要 Node.js 18 或更新版本，发布包不需要 npm install。下列命令在解压后的工具目录运行。convert 创建新工程，输出目录必须不存在；assets 可以导入已有目录并复用相同资源。

```powershell
node cli.js scan "D:\StudioProject\demo.ccs"
node cli.js plan "D:\StudioProject\demo.ccs" SampleDialog.csd
node cli.js convert "D:\StudioProject\demo.ccs" "F:\StudioConverted" SampleDialog.csd
```

convert 生成可用 Creator 3.8.8 打开的新工程；转换时不用启动或安装 Creator。打开和运行输出工程需要 Creator 3.8。

只向现有 Creator 项目生成资源目录时，用 assets 命令：

```powershell
node cli.js assets "D:\StudioProject\demo.ccs" "F:\MyCreatorProject\assets\studio-import" SampleDialog.csd
```

CSD 名称可连续指定多个；省略则处理 CCS 登记的全部 CSD。嵌套引用会自动纳入。建议先转换少量界面并查看报告，再进行批量导入。

## 内置 Studio 默认资源（0.2.1 起）

工具 resources/Default 已包含从 C:\Cocos Studio\EditorDefaultRes\Default 复制的 49 个原始文件，资源清单与 SHA-256 记录在 resources/default-resources.json。使用时无需原 Cocos Studio 安装目录。

- Type="Default" 的引用从内置库读取，支持 Default/Sprite.png、反斜杠路径及 Sprite.png 短路径。
- 普通引用优先读取工程资源；只有工程中不存在的 Default/... 路径才回退到内置库。来源保持区分；只有内容和导入设置完全相同时才会复用已有资源。
- 转换前扫描默认资源依赖，按需复制到输出的 resources/studio-default/Default；不会把整个默认库放进目标工程。0.4.2 起，普通默认图片直接在此文件上生成纹理和 SpriteFrame 元数据，不再额外复制到 frames/default/images/Default。
- 自动包含 FNT 图片页、plist 纹理、TMX/TSX 图片及 ExportJson 声明的图集/图片依赖；带嵌入纹理的粒子 plist 不要求额外纹理文件。
- 默认图片进入正常 Sprite / Button / Toggle 转换，TTF/OTF 可用于 Label。不存在的默认引用会报告 CSD 来源并停止转换。
- 报告 defaultResources 字段列出复制的默认资源，images.origin 标识 default / project / generated。

## 图片命名（0.2.3）

0.4.0 起可指定目标目录并复用已有资源，规则见下节；发生复用时，保留已有文件的路径和 UUID。

普通图片保留源文件名与相对目录。例如 gImage3/global_panel5_panelbg.png 输出到 frames/project/images/gImage3/global_panel5_panelbg.png。普通默认图片统一放在 resources/studio-default/Default，纯色背景图片放在 generated/white.png；其 SpriteFrame 由同一图片的 .meta 提供。图集裁切帧仍输出到 frames/来源/atlases 下。

相同图片、相同帧和相同九宫格参数复用同一文件。首次出现的参数组合使用原名；后续不同参数组合使用「原名__8位标识.png」，例如 button__a1b2c3d4.png。遇到已有同名文件会继续区分，不覆盖。首次参数组合由所选界面的遍历顺序决定。

图集图片以帧名命名，放在 frames/来源/atlases/图集相对路径/帧名 下；实际文件仍是图集纹理副本，由 .meta 指定裁切区域。扩展名与实际纹理格式一致。不适合 Windows 文件名的图集帧字符会替换并写入报告。

新版命名仅对重新导入生效，原导入目录不改名；报告 images 记录源图片、输出路径和 UUID 的对应关系。

0.4.2 消除普通默认图片的原始副本与帧副本重复。不同裁切、九宫格参数仍需要独立变体，不保证所有同字节图片都合并。升级不会自动删除旧版已生成的副本或改变旧 Prefab 的引用；在新目录重新导入可得到精简后的结构。

## 指定目录与资源复用（0.4.0）

导入目录相对于当前工程的 assets，例如 `studio`、`UI/Login`。同一目录可以连续导入多个 CSD，不再强制生成时间戳文件夹。检查范围是所选目录及其子目录，目录外的资源不会参与复用。

- 图片先核对文件字节，再比较裁切、旋转、原尺寸、偏移、九宫格、过滤、平铺等导入设置；全部一致才复用已有文件和 SpriteFrame UUID。同图不同设置保留为独立资源。
- 字体核对文件与字体导入设置。Prefab 比较完整序列化内容和资源引用；完全一致时保留原 Prefab UUID。
- 名称不同但内容和设置相同，也可以复用。复用时保留已有资源的名字与位置，不再生成副本。
- 同名但内容不同、缺少有效 .meta 或设置不兼容时，加后缀另存；保留已有文件、修改内容及 .meta，不覆盖。
- 每次生成独立的 `studio-import-report*.json`，包含 `createdResources`、`reusedResources` 和逐项 `resources`，旧报告保留。

Creator 自动生成的 imported、缓存文件列表、图片顶点等派生信息不作为差异；手工修改的纹理或九宫格设置会作为差异保留。复用依赖目标文件及其 .meta，不能只凭同名判断。CLI 的 `assets` 命令使用同一套规则；`convert` 创建新工程时仍要求输出目录不存在。

## 当前转换范围

| Studio 内容 | Creator 输出 |
| --- | --- |
| Layer / Node / Panel / 子节点 | Node + UITransform；位置、锚点、缩放、旋转、透明度、可见性 |
| ImageView / Sprite | Sprite；PNG / JPEG；颜色、翻转、九宫格 |
| TexturePacker plist 图集 | 根据帧矩形、旋转、偏移生成图片帧；支持常见 frame / textureRect 字段格式 |
| Button | 原生 Button；正常、按下、禁用图片与文本子节点 |
| Text | Label；文本、颜色、字号、对齐、描边、阴影、TTF/OTF |
| TextField | 原生 EditBox，包含输入文本和占位文本 Label |
| CheckBox | 原生 Toggle 与勾选图片，支持程序切换状态 |
| ScrollView / ListView | 原生 ScrollView、Content、滚动方向、回弹与可选 Mask |
| LoadingBar | Filled Sprite；保留初始百分比 |
| 纯色面板背景 | 原生 Sprite；渐变暂以起始色代替并报告 |
| 位置百分比 | Widget；仍需检查目标分辨率下的效果 |
| 嵌套 CSD | 内联节点并单独输出依赖 Prefab；循环引用报错 |

为了保留同一图片在不同控件上的九宫格边距，图片会按帧和边距组合复制到 frames 目录。同一组合复用一张图片；图集每个使用帧可能复制整张纹理，优先保证独立导入正确性，体积优化留待后续。报告 images 字段记录源图片、输出路径、帧 UUID、裁切矩形和边距。

## 尚未覆盖的行为

- 时间轴动画、动画事件、骨骼动画、粒子、特殊控件（如 Slider、PageView、TextAtlas）不自动转换；保留节点并报告限制。
- ListView 保留已有子节点的设计位置，可用原生 ScrollView 滚动；动态项目创建、ItemMargin 自动排列和数据绑定需要业务代码。
- BMFont 暂回退为系统字体；字体外观和换行可能不同。
- 默认资源文件会按引用导入；这不会自动补齐 BMFont、粒子、骨骼、地图等尚未实现的组件转换。
- 不等轴倾斜、尺寸百分比、部分边缘约束、渐变背景、独立禁用勾选图需要检查或调整。
- 回调和业务脚本不会自动迁移。未覆盖的 CSD 属性不保证语义等价；本版本不是逐像素还原承诺。

转换前会解析依赖；缺少文件时停止并列出来源，避免生成缺图工程。缺失数量随源文件变化，应以当前 plan 结果为准。

## 验证与开发

已使用多个真实界面样本 在 Creator 3.8.8 中验证 Prefab 加载与实例化。验证工程没有安装旧迁移扩展。检查包括图片帧、输入框 Label、Toggle 勾选切换和 6 个 ScrollView 的 Content 引用；不等于完成所有屏幕尺寸与业务交互验收。

```powershell
npm test
node cli.js package
```

若 Node 24 在受限环境无法创建测试子进程，可运行 node --test --test-isolation=none test/direct.test.js test/updater.test.js test/reuse.test.js。

官方规范参考：[扩展包定义](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/define.html)、[面板系统](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/panel.html)、[消息定义](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/contributions-messages.html)、[安装与分享](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/install.html)。

源码入口：lib/source.js（扫描与依赖）、lib/direct.js（节点和组件转换）、lib/direct-assets.js（图片/图集/.meta）、main.js + panel.js（扩展）、cli.js（命令行）。Creator 内的批量转换在 worker_threads 运行，面板可持续显示进度。失败报告保留已生成输出，修复后用新目录重试。

### 从 0.2.4 及更早版本升级

0.2.5 起使用 Creator 3.8.2+ 的 Label 内置描边与阴影属性，不再生成已弃用的 LabelOutline / LabelShadow 组件。安装新版后，请从原 CSD 重新导入并使用新生成的 prefab；升级扩展不会自动修改已有 prefab。若旧 prefab 已手工修改，请先保留副本，再对照新 prefab 合并修改。Node.js CLI 与扩展共用转换逻辑，同样包含此修复。
