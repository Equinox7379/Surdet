# Surdet Player Shell Foundation Wave 3：清洁室设计记录

日期：2026-08-11  
范围：`PLAYER_SHELL_FOUNDATION_WAVE_3` Task 0  
状态：已冻结，供本轮实现与复核使用

## 记录目的

本记录用于证明 Wave 3 的 Player Shell 设计是在 Surdet 自己的代码、现有
`PlayerUiSession` / `PlayerInputGate`、Renderer v2 commands/queries 和 Pixi
运行时约束之上独立定义的。外部产品或商业引擎只允许提供抽象层面的产品观察，
不作为 Surdet 的实现、数据或视觉规范来源。

## 允许借鉴的抽象思想

本轮仅允许参考以下与具体实现无关的抽象思想：

- 玩家界面可以由宿主控制器统一编排，而不是由每个游戏入口复制一套状态机；
- 界面来源和返回目标需要显式表达；
- 固定的系统界面能力可以通过稳定的槽位契约提供默认实现和覆盖点；
- 主题令牌应集中定义、不可变，并由渲染层投影到各 Layer；
- 状态查询应返回安全的普通数据，而不是暴露渲染对象或可写内部引用。

这些只是设计问题域的抽象描述，不构成代码、字段、默认值、文案、素材或视觉
参数的来源。

## Surdet 独立决策

Wave 3 的公共行为由 Surdet 独立定义为：

1. `@surdet/host` 持有不可变的 overlay 返回栈，并由 `PlayerShellController`
   组合现有 `PlayerUiSession` 与 `PlayerInputGate`；
2. 系统界面槽位固定为 `title`、`system-menu`、`save-load`、`settings`、
   `gallery`、`backlog` 六项，槽位 ID、来源和请求类型由任务书冻结；
3. Provider 只通过显式的槽位接口接线，默认 Provider 与项目覆盖均由注册表管理；
4. 跨层协调只经 Renderer v2 commands/queries，不让游戏项目创建第二套
   `PlayerShellController`，也不让生产代码依赖 `AdvRenderer`、`PixiStage` 或
   具体 Layer；
5. `RendererTheme` 的字段、校验、递归冻结和 `setTheme` / `theme` API 由
   Surdet 任务书独立规定；默认值只从当前 Surdet 视觉实现机械整理，不采用外部
   产品的色值、字号、间距或文案；
6. 玩家运行时继续使用 Pixi-only 投影，Electron 继续保持
   `contextIsolation: true`、`sandbox: true`、preload 白名单和现有
   AES-256-GCM 资源路径。

## 明确禁止复制的对象

本轮不复制或改写任何外部产品或竞品的以下内容：

- 源代码、类、函数、控制器、组件、状态机或实现顺序；
- JSON、Schema、字段组合、序列化结构、默认值或错误码；
- 色值、字号、间距、圆角、透明度、字体、布局和其他视觉参数；
- 文案、标签、按钮名称、交互提示、流程设计或玩家可见语义；
- 角色、背景、图标、纹理、音频、素材和素材处理结果；
- source map、构建产物、打包结构或动态脚本；
- 任何默认 UI 设计、主题组合或竞品专属行为。

## 本轮安全边界

- 不引入 React、Vue、新 DOM 游戏 UI 或新的 npm 依赖；
- 不开放任意第三方动态 JavaScript；
- 不关闭 Electron 安全选项，不绕过 Renderer v2；
- 不修改 `SaveSnapshot`、`SAVE_SCHEMA_VERSION`、存档目录、文件名或存档内容；
- “系统界面槽位”是内存中的 Player Shell 能力，不是磁盘存档槽位；
- 不处理性能、Q1–Q5、性能门限、正式 A/B、M9、发行、EXE 打包或后续 Wave；
- 不修改《零点之后》的剧情、美术、音频内容。

## 基线核验

Task 0 开工前的只读核验结果：

| 项目 | 结果 |
| --- | --- |
| `git rev-parse HEAD` | `9bbec32946e169a5d081b29863edddaad64959fe` |
| `git rev-list --left-right --count HEAD...surdet/main` | `0 0` |
| 任务书字节数 | `25173` |
| 任务书 SHA-256 | `639A934053C9879DFABAA287B71E3CC3010B2F5E3249004CC02EC923C5DA2D65` |
| `git diff --check` | 通过 |
| `git ls-files '*.log'` | 空 |
| 开工时额外允许的未跟踪文件 | 任务书本身 |

受保护的四个未跟踪文件在本轮未修改、未暂存、未删除、未移动。

## 变更审计规则

后续每个 Task 都必须先建立与目标缺陷一致的失败测试，再实施最小生产改动，
以同一测试转绿；完成后更新任务书 Execution Ledger、创建普通提交并读取真实
提交记录。任何失败样本都保留，不通过重跑挑选绿色结果，也不以游戏项目中的
特定实现替代引擎公共能力证明。
