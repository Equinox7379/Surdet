# 第三方依赖与作品素材

## MIT 授权范围

根目录 [LICENSE](LICENSE) 适用于 Surdet 自有引擎源码及技术文档。第三方代码、字体，以及示例作品的剧情、美术、音乐、音效、视频和作品标识不因位于同一仓库而自动获得 MIT 授权；其已有版权与许可声明继续有效。

MIT covers Surdet-authored engine code and technical documentation. Third-party components and game content retain their own terms; the engine license does not grant rights to the bundled stories, artwork, audio, video, fonts, or game branding.

## 依赖

依赖的准确版本以 `package-lock.json` 为准，许可正文与版权声明以各依赖实际安装/随包提供的文件为准。下表是主要依赖的定位入口，不是全量传递依赖清单，也不是最终二进制发行的许可验收。

| 组件 | 本轮核对的许可元数据 | 使用位置 |
| --- | --- | --- |
| PixiJS、Howler、fontkit | MIT | Renderer 图形、音频与字体读取 |
| `@modelcontextprotocol/core`、`server`、`client` | MIT | CLI 的 MCP 服务与测试 |
| Electron | MIT；所附 Chromium 等组件仍各有声明 | Windows 桌面壳 |
| Vite、Vitest | MIT | 构建和验证工具 |
| TypeScript | Apache-2.0 | 类型检查与编译 |

打包时仍须保留实际分发依赖要求的 LICENSE/NOTICE；不能用这张表替换原文。特别是 Electron 应用与源码仓库的分发内容不同，不能仅凭顶层 MIT 元数据宣布整包授权完毕。

## 字体

| 文件范围 | 既有许可入口 |
| --- | --- |
| Starter 的 Noto Serif SC | [OFL-NotoSerifSC.txt](examples/starter/content/assets/fonts/OFL-NotoSerifSC.txt) |
| 《零点之后》的 Noto Sans SC、Noto Serif SC | [字体说明](examples/zero-after-midnight/content/assets/fonts/FONT-LICENSES.md)及同目录两份 OFL 原文 |
| Starter 保留的 MiSans | [NOTICE](examples/starter/content/assets/fonts/NOTICE.md)与[官方协议原件](examples/starter/content/assets/fonts/MiSans-LICENSE.pdf) |

这些字体并非 Surdet 自有 MIT 代码。本轮不修改字体字节、移除许可证或扩大既有授权；正式对外分发须按各自协议核对。

## 作品与其他素材

- `examples/starter/content/`、`examples/zero-after-midnight/content/`、`games/*/content/` 中的作品正文与媒体按作品分别处理。引擎开源不等于 Owner 已决定公开全部作品剧情。
- CLI 的示例模板以及 Editor 的演示资源也须按实际来源检查；复制到另一个目录不会改变原许可。
- [Starter 素材来源说明](examples/starter/content/assets/README.md)提供已有制作线索，但来源说明、提示词或 AI 生成记录本身不等于向所有接收者授予再分发许可。
- 没有明确单独许可的作品素材，目前不应被当成可自由复用素材库。正式公开前需要 Owner 确认权利与公开范围，或从公开交付中排除/替换；本文件不删除现有作品。
- Live2D / Spine 的 SDK、模型及运行库若以后进入交付，按其届时实际版本与许可单独核对；引擎 MIT 许可不能替代第三方授权。

## 当前发布状态

2026-10-03：Owner 已选择引擎采用 MIT，但要求先完成前端优化再正式开源。当前工作只准备许可与发布范围，未公开仓库、发布 npm 包、上传安装包或授权所有素材。本文件不构成素材权属或最终发行的法律保证。
