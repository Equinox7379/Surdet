# Surdet 架构

## 模块和依赖

- `core`：不依赖 DOM、Node 或第三方运行库，提供 DSL 编译、解释器、变量、存档数据、模拟和系统规则。
- `authoring`：依赖 Core，提供项目快照、对象索引、逐项创作、差异、校验、候选封装、比较和组合合同。
- `renderer`：消费 Core 事件，通过 `createRendererRuntime` 的命令、查询与输入接口驱动 Pixi 舞台和表现状态。生产消费方不应直接构造旧 `AdvRenderer`/`PixiStage`；旧导出用于既有测试与兼容调用。
- `host`：连接 Core 与 Renderer，协调宿主系统、玩家输入、菜单、回退与 `PlayerUiSession`。
- `cli`：Node 适配、项目文件与租约、恢复、HTTP/MCP 入口，以及 new/lint/simulate/build/pack 命令。共享创作语义仍在 Authoring。
- `editor`：浏览器工作台，使用共享创作合同、Renderer 预览和正常绑定项目的 HTTP 服务。内存草稿与已保存项目、隔离变更、候选结果分别标识。
- `shell`：Electron 窗口、preload、受限 IPC、桌面存档与打包；不负责重新解释剧情。

依赖箭头表示“消费方依赖提供方”，例如 `authoring → core`、`renderer → core`、`host → core/renderer`，不是一条 `core → renderer → shell → cli` 的依赖链。

## 游戏运行与创作

`.gal → compileScene → SceneRegistry → Interpreter → EventBus → RendererRuntime` 是剧情到画面的主要路径。宿主将玩家的推进和选择送回解释器；Renderer 表现反馈与 Core 显式路径运行轨迹是不同证据。

现代 Starter 和新项目从 `examples/shared/player/player.ts` 装配 Player、Host、输入和菜单。`examples/starter/src/main.ts` 读取项目内容并调用共享入口，不再承担整套播放器实现。《零点之后》仍保留自己的历史入口，其行为应单独验证，不能由 Starter 通过推定。

外部 Agent 经公开能力创建隔离变更。素材导入、对象修改、保存决定、准备结果、批准、明确写回分别遵循已有授权与回执；预览和读取观察不会自动批准或写回。候选需要操作发生时的依赖与重放事实；普通 direct 变更不等于一定可组合的候选。能力发现以共享 Authoring 注册表和启动的 MCP 为准。

## 系统接线

Core 提供 Calendar、Combat、Affection、Shop、Growth、Achievement、EventScheduler 和 NewGamePlus 等规则模块。规则模块存在不等于任意项目配置或指令参数都已由 Player 接通。

共享 Player 读取可选配置并安装对应宿主系统；日历选点与据点指令、成长和 CG 解锁沿各自已有路径执行。Calendar 配置中的 `turnStartEventId`/`turnEndEventId` 当前没有接到通用事件分发，不应宣称已完成这条接线。战斗入口目前使用共享 Player 中的既有演示编排，不提供任意 encounter ID 的通用加载器。

## 素材与存档

素材通过 Runtime 的资源接口注册，缺失 key 可呈现程序化占位图。占位图不是正式项目图片的替代，也不是素材已成功导入的证据。

`SaveSnapshot` 包含变量、运行位置、已读与解锁状态，以及注册的系统、成长和表现快照。系统实例由宿主持有，经 `SystemHooks.snapshot/validate/restore` 接入。内建校验在主要状态替换前运行；任意第三方恢复回调抛错的完整事务回滚不属于当前保证。

桌面存档经 `window.surdetSave` 的异步 `invoke` IPC 进入 `FileSaveStore`，文件位于 `userData/saves`，物理槽位文件名按实现编码，不能直接拼接用户槽位 ID。写入采用暂存、替换和失败补偿；本地失败测试不等于断电原子性证明。浏览器使用 localStorage，写入失败必须报告，不能当成成功。

存档对象（包括会一同序列化的扩展字段）不得有循环引用，嵌套最多256层；变量数组不能有空洞。非法输入在写盘前拒绝，原槽位保留。读档从预检到状态提交期间禁止重入推进、跳转或再次读档；`stateReset` 等通知只用于宿主清理。提交结束后重新播放正文时，正常文本事件内推进仍然可用。

`@autosave`/`@savepoint` 由解释器发出完整快照，宿主负责写入。`loadSnapshot` 必须在解释器事件回调之外执行；读档后重新发出 text/choice 等事件。`sceneEnd` 回调允许 `start()`，通过迭代续跑避免递归。

## 命令与证据

```text
surdet new mygame
surdet lint mygame
surdet simulate mygame
npm run dev -w surdet-mygame
surdet build mygame
surdet pack mygame
```

`surdet pack` 必须明确指定游戏目录。已有项目的 workspace 名称读取自己的 `package.json`，例如《零点之后》是 `zero-after-midnight`，不按目录机械添加前缀。

`capability-matrix.md` 是历史玩家运行能力与证据路径索引，不覆盖完整 Authoring/Editor 能力。路径存在检查和源码文本契约测试只证明静态约束；真实浏览器、真实文件保存、Electron 和正式游戏验证分别记录。当前状态与授权由原长期台账维护，九月托管 CI 暂停。
