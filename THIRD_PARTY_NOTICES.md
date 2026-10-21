# 第三方源码与资源

## @xmldom/xmldom

- 版本：0.9.12。
- 上游：https://github.com/xmldom/xmldom
- 位置：vendor/xmldom/lib，保留未经修改的运行时源码。
- 许可证：MIT，完整文本在 [vendor/xmldom/LICENSE](vendor/xmldom/LICENSE)，来源记录在 vendor/xmldom/NOTICE.txt。

本项目通过相对路径直接加载该源码，不依赖 npm 安装或 Creator 自带 XML 模块。

## Cocos Studio 默认资源

49 个文件由用户提供，来源目录为 `C:\Cocos Studio\EditorDefaultRes\Default`，副本位于 resources/Default。逐文件 SHA-256、原文件名和大小见 [resources/default-resources.json](resources/default-resources.json)。

这批资源不属于 xmldom 的 MIT 授权范围；本工具未为它们另行授予许可证，也不改变其原有权利归属。

## Cocos Creator

Creator 编辑器、引擎和官方迁移扩展不包含在本发布包中。Creator API 与资源格式用于扩展集成和输出兼容；本项目不是官方迁移扩展。
