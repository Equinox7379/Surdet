# Surdet Renderer v2 架构升级设计书

> 日期：2026-08-09  
> 状态：设计已由项目负责人授权，总经理完成技术决策；等待成文复核  
> 基线提交：`cab200b5aaed49b053b18ff05907aac4d02fb731`  
> 适用范围：`@surdet/renderer`、编辑器预览、starter、正式样例、CLI 游戏模板及相关门禁  
> 实施模式：单一执行 AI，按里程碑串行实施；禁止并行大改  
> 核心策略：Facade + 组合式 Layers，吸收显式 Commands / Queries 思想；旧接口保留一个版本兼容窗口

## 1. 执行摘要

Wave 1 已完成宿主公共层、Profile 存储、rollback、HMR、资源生命周期局部治理、能力矩阵和整改门禁。当前主要结构性风险已经转移到 Renderer：`PixiStage` 仍同时承担世界画面、对话、菜单、鉴赏、系统面板、资源注册和生命周期等职责；`AdvRenderer` 同时承担 Core 事件投影、ADV 控制状态、输入动作和表现快照。

Renderer v2 不做一次性重写，也不维持两套实现。新架构建立一个稳定的 `RendererFacade`，向调用者提供分域 Commands 和只读 Queries；内部由唯一的 Composition Root 装配六个职责单一的 Layer。现有 `PixiStage` 与 `AdvRenderer` 在一个版本内保留，但只作为旧 API 到新实现的薄适配器。

本轮允许同步升级公开接口，但只修复迁移所必需的阻断缺陷。战斗阵型、插件生态、新转场、新演出、新存档格式、DSL 扩展等玩家可见功能不在范围内。

最终成功不是“文件变短”，而是以下事实同时成立：

1. 仓库内所有正式消费者使用 Renderer v2；
2. 旧接口仍通过同一份实现保持一个版本兼容；
3. 六个 Layer 具有明确所有权、独立测试和资源释放证明；
4. 新旧接口契约一致，现有画面与交互无未批准变化；
5. 性能没有越过相对基线门槛；
6. 编辑器、starter、正式样例、HMR 和 Windows EXE 均通过真实验收；
7. 能力矩阵中的测试与文档证据路径真实存在；
8. CI 不重复执行同一套昂贵门禁。

## 2. 当前状态与已确认问题

### 2.1 Git 与质量基线

设计基线为 `cab200b`，该提交已与 `surdet/main` 同步。基线全量测试为 766 项，通过类型检查、正式样例模拟、能力矩阵、仓库卫生、P1/P2 和 Windows 发行产物验收。

本轮不得降低上述门禁强度。新增测试应使测试总量上升；不得通过删除断言、跳过测试、扩大容差或修改基线语义来制造通过结果。

### 2.2 Renderer 规模与职责

基线规模：

| 文件 | 行数 | 主要问题 |
| --- | ---: | --- |
| `packages/renderer/src/pixi-stage.ts` | 3525 | 同时实现世界、对话、菜单、鉴赏、战斗/地图/商店、资源注册与销毁 |
| `packages/renderer/src/adv-renderer.ts` | 861 | 同时负责 Core 事件投影、ADV 状态、输入动作、Backlog、表现快照 |
| `packages/core/src/runtime/interpreter.ts` | 1001 | 本轮只作为调用契约，不做无关重构 |
| `examples/starter/src/main.ts` | 1179 | 直接调用大量 Stage/Renderer 细节 |
| `examples/zero-after-midnight/src/main.ts` | 1238 | 与 starter 存在相似的直接接线 |

行数只用于观察，不作为压缩 KPI。验收关注职责、依赖方向、资源所有权和可测试性，禁止为了行数移动规则、压缩排版或创建无意义转发文件。

### 2.3 文档证据门禁缺口

`docs/capabilities.json` 当前存在 5 条指向不存在文件的测试证据：

- `backlog` → `packages/renderer/test/backlog.test.ts`；
- `battle-move` → `packages/renderer/test/battle-view.test.ts`；
- `gallery-cg` → `packages/core/test/gallery.test.ts`；
- `gallery-text` → `packages/core/test/gallery.test.ts`；
- `save-hooks` → `packages/shell/test/e2e.spec.ts`。

现有 `docs:capabilities:check` 只验证 Markdown 是否由 JSON 正确生成，没有验证证据路径是否存在。因此“文档事实门禁通过”目前不能证明证据真实。Wave 2 必须先修复此缺口，并增加回归测试。

### 2.4 CI 重复执行

CI 已分别执行 typecheck、全量测试、正式样例和 P1/P2；`verify:p1p2` 内部又重复运行多个相同门禁。Wave 2 应把门禁拆为可组合的原子命令，由本地总门禁和 CI 编排各调用一次，保持覆盖但减少重复耗时。

## 3. 目标、非目标与硬约束

### 3.1 目标

1. 建立 Renderer v2 的稳定公开接口；
2. 将改变状态的操作与只读查询明确分离；
3. 将 Pixi 实现拆为 World、Dialogue、Menu、Gallery、SystemPanel、Lifecycle 六个边界；
4. 建立统一资源登记、取消和幂等销毁机制；
5. 让 Core 事件投影与 Pixi 细节解耦；
6. 为旧 API 提供一个版本的可验证兼容窗口；
7. 建立资源、性能、视觉、证据和依赖方向门禁；
8. 同步迁移仓库内全部消费者。

### 3.2 非目标

以下内容不得在本轮实现：

- 战斗阵型、二维站位或新战斗阶段；
- 新 DSL 指令或 DSL 语义变化；
- 存档结构、版本号或迁移规则变化；
- 第三方 Renderer 插件生态；
- 新粒子、转场、后处理或角色差分功能；
- Backlog 跨存档持久化；
- 编辑器视觉改版；
- 更换 PixiJS、Howler 或 Electron；
- 因文件较大而重写 Core、Host、Shell；
- 与迁移无关的体验修复和代码美化。

### 3.3 硬约束

1. 单一执行 AI 串行工作；一个里程碑完成并验收后才能进入下一个；
2. 每个里程碑独立提交，不产生一个覆盖全轮的巨型提交；
3. 任何行为变化必须先证明是迁移阻断缺陷，增加失败测试，并在报告中单列；
4. Layer 不得直接依赖其他 Layer；跨层协调只经过 Facade 或 Presentation Controller；
5. Query 不得改变状态；
6. 旧 API 适配器不得包含第二份渲染逻辑；
7. 不读取、迁移或删除用户真实存档；
8. 不 force push；不提交 `USER.md`、`SESSION-HANDOFF.md`、日志、截图、缓存和临时脚本；
9. 不以删除测试、放宽断言、提高性能阈值或屏蔽错误作为修复；
10. Windows EXE 验收必须使用隔离的临时 `--user-data-dir`。

## 4. 总体架构

```text
新消费者                                      旧消费者（兼容一版）
游戏 / 编辑器 / CLI 模板                     AdvStage / PixiStage / AdvRenderer
        │                                                │
        ▼                                                ▼
┌────────────────────────────┐             ┌─────────────────────────┐
│ RendererFacade v2          │◀────────────│ LegacyStageAdapter      │
│ ├─ commands（改变状态）     │             │ LegacyAdvRendererAdapter│
│ └─ queries（只读查询）       │             └─────────────────────────┘
└─────────────┬──────────────┘
              ▼
┌────────────────────────────┐
│ RendererCompositionRoot    │  唯一装配、启动和整体销毁入口
└─────────────┬──────────────┘
              ▼
┌──────────┬───────────┬──────────┬───────────┬──────────────┬──────────────┐
│WorldLayer│Dialogue   │MenuLayer │Gallery    │SystemPanel   │RenderLifecycle│
│          │Layer      │          │Layer      │Layer         │              │
└──────────┴───────────┴──────────┴───────────┴──────────────┴──────────────┘
              │
              ▼
 Pixi Application / FrameScheduler / ResourceRegistry / InputRouter / Audio ports
```

### 4.1 依赖规则

- Composition Root 可以依赖所有 Layer 和共享服务；Layer 不得依赖 Composition Root；
- Facade 依赖 Layer 的公开端口，不依赖 Layer 内部类；
- Layer 不得导入其他 Layer；
- Layer 可以依赖小型、无状态或明确所有权的共享服务；
- Presentation Controller 可以调用 Facade Commands 和 Queries，不得操作 Pixi 对象；
- Legacy Adapter 只能调用 v2 API；v2 API 不得反向依赖 Legacy Adapter；
- 测试 fake 应实现最小端口，不复制生产业务逻辑。

### 4.2 共享资源服务

背景、立绘、头像、字体角色和注册素材源不归任何单一 Layer 独占，因此由 Composition Root 创建唯一的 `RenderAssetRegistry`。它只负责资源注册、解析、引用替换、异步 generation 和释放，不创建可见界面。WorldLayer 只读解析背景/立绘，Dialogue/Menu/Gallery/SystemPanel 只读解析头像和字体；任何 Layer 都不得另建第二份纹理或字体注册缓存。

`RenderAssetRegistry` 的所有可释放对象登记到 `RenderLifecycle` 的 `runtime` owner。替换同 key 资源时先准备新资源，成功后原子替换并释放旧资源；失败时保留旧资源。`resetSession({ clearAssets: false })` 不清空注册资源，`clearAssets: true` 和 Runtime dispose 才执行对应释放。

应增加静态依赖检查，禁止 `layers/*` 之间的横向导入，并禁止新消费者直接访问 `stage.app`、Layer 内部 Container 或 Pixi 私有对象。

## 5. Renderer v2 公开接口

以下接口表达设计契约；实施计划可以调整文件拆分与局部命名，但不得改变职责和依赖方向。

```ts
export interface RendererRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;
  readonly controller: PresentationController;

  resize(): void;
  resetSession(options?: ResetSessionOptions): void;
  dispose(): void;
}

export interface RendererCommands {
  readonly assets: AssetCommands;
  readonly world: WorldCommands;
  readonly dialogue: DialogueCommands;
  readonly menu: MenuCommands;
  readonly gallery: GalleryCommands;
  readonly system: SystemPanelCommands;
  readonly loading: LoadingCommands;
  readonly preferences: PreferenceCommands;
  readonly presentation: PresentationCommands;
}

export interface RendererQueries {
  readonly world: WorldQueries;
  readonly dialogue: DialogueQueries;
  readonly overlay: OverlayQueries;
  readonly preferences: PreferenceQueries;
  readonly presentation: PresentationQueries;
  readonly diagnostics: RendererDiagnosticQueries;
}

export interface RendererRuntimeOptions {
  canvas?: HTMLCanvasElement;
  audio?: AudioHandle;
  preferences?: Partial<PresentationPreferences>;
  quality?: RenderQuality;
  onError?: (error: RendererError) => void;
  onAdvance?: () => void;
  onSelect?: (index: number) => void;
  onWaitEnd?: () => void;
  typewriter?: Typewriter;
  backlog?: Backlog;
  pluginHost?: RendererPluginHost;
  onBacklogClose?: () => void;
  performanceMonitor?: RenderPerformanceMonitor;
}

export async function createRendererRuntime(
  options?: RendererRuntimeOptions,
): Promise<RendererRuntime>;
```

### 5.1 为什么返回 Runtime 而不是暴露 PixiStage

基线消费者直接访问 `stage.app!.canvas`、手工创建 `FrameScheduler`、直接绑定画布事件并调用大量 Stage 方法。这使 Pixi Application、ticker 和输入监听器的所有权分散。

v2 由 Composition Root 创建 Application、Layers、Controller 和 Scheduler，并只暴露稳定的 `canvas`、Commands、Queries 与生命周期方法。消费者不再依赖 Pixi 内部结构；编辑器和游戏仍可把 `runtime.canvas` 插入各自 DOM。

### 5.2 Commands 规则

- Command 表示有意改变显示状态；
- 同步 Command 在输入无效时抛出带错误码的 `RendererCommandError`；
- 涉及资源、视频、字体或可取消转场的 Command 返回 `Promise`；
- Command 必须先校验、准备，再一次提交可见状态；
- 被新命令取代或因销毁取消属于正常结果，不得作为崩溃报告；
- Command 不返回内部 Pixi 对象。

### 5.3 Queries 规则

- Query 必须无副作用；
- Query 不得创建 Container、Texture、Text、监听器或缓存项；
- 数组、对象和快照返回只读副本；
- 诊断 Query 只供工具和测试使用，剧情逻辑不得依赖资源计数；
- Query 在 Runtime 已销毁后返回明确的 disposed 状态，或抛出统一的 `RENDERER_DISPOSED` 错误，不允许随机空指针。

### 5.4 分域接口与旧方法归属

| v2 域 | 负责能力 | 基线旧方法或状态示例 |
| --- | --- | --- |
| `assets` | 背景、立绘、头像、字体资源注册与释放 | `registerBackground`、`registerPortrait`、`registerAvatar`、`registerFontRole`、`resetFonts`、`releaseRegisteredAssetSources` |
| `world` | 背景、立绘、摄像机、淡入淡出、转场、粒子、调色、时间轴 | `setBackground`、`setPortrait`、`removePortrait`、`shake`、`transition`、`flash`、`zoom`、`wipe`、`movePortrait`、`setTint`、`startParticles`、`applyTimelineFrame` |
| `dialogue` | ADV 文本、选择、等待、Backlog、NVL、Banner、命令栏、界面隐藏 | `showText`、`showChoices`、`setAwaiting`、`showBacklog`、`setNvlMode`、`showBanner`、`showCommandRail`、`hideInterface` |
| `menu` | 标题、结局、系统菜单、设置、存读档 | `showTitle`、`showEnding`、`showSystemMenu`、`showSettings`、`showSaveLoad` 及对应 hide |
| `gallery` | CG、音乐、文本回想 | `showGallery`、`hideGallery` |
| `system` | 战斗、地图、商店、据点指令、视频覆盖层 | `showBattle`、`showMap`、`showShop`、`showBaseCommands`、`showVideo` 及对应 hide |
| `loading` | 启动与场景加载进度 | `showLoading`、`hideLoading` |
| `preferences` | 画质、表现偏好、后处理 | `setQuality`、`setPresentationPreferences`、`setPostProcess` |
| `commands.presentation` | 完整表现状态的校验、恢复和清除 | `restorePresentation`、`clearPresentation`；由 Facade 协调 Controller 时间轴与 World 状态 |
| `queries.presentation` | 可序列化完整表现快照 | `snapshotPresentation`；由 Facade 收集 Controller 时间轴与 World 状态 |
| `queries.diagnostics` | 性能与资源快照 | `getPerformanceSnapshot`、`needsUpdate`、活动资源计数 |
| `controller` | Core 事件投影、打字、推进、选择、自动、快进、Backlog 控制 | 当前 `AdvRenderer` 的 `subscribe`、`advance`、`select`、`toggleAuto`、`toggleSkip`、`choiceUp/Down/Confirm`、表现快照协调 |

`captureThumbnail` 作为只读但有计算成本的 Query；不得改变画面。`commands.presentation.validate/restore/clear` 与 `queries.presentation.snapshot` 构成完整事务边界，不把 Controller 时间轴恢复错误地归入 WorldLayer。

### 5.5 Presentation Controller

新的 `PresentationController` 取代 `AdvRenderer` 的生产职责：

```ts
export interface PresentationController extends FrameLoopTarget {
  readonly status: RenderStatus;
  readonly autoPlay: boolean;
  readonly skipMode: boolean;
  readonly skipAll: boolean;
  readonly backlogOpen: boolean;
  readonly interfaceHidden: boolean;

  connect(bus: EventBus<CoreEventMap>): Unsubscribe;
  reset(options?: ResetSessionOptions): void;
  advance(): boolean;
  select(index: number): boolean;
  dispatchInput(action: RendererInputAction): boolean;
  setTextSpeed(charsPerSecond: number): void;
  setAutoWait(baseDelayMs: number, perCharMs: number): void;
  dispose(): void;
}
```

键盘、鼠标、游戏手柄先映射为 `RendererInputAction`，再交给 Controller。消费者不应分别维护三份关于 choice、Backlog、skip 的条件判断。

## 6. 六个内部边界

### 6.1 WorldLayer

负责：背景、立绘、角色聚焦、摄像机、fade、shake、flash、zoom、wipe、可注册转场、mov、tint、particle、时间轴世界帧、世界表现快照。

不负责：对话文本、菜单、战斗面板、输入键位、音频策略。

WorldLayer 拥有世界 Container 和世界效果 Controller；其销毁必须停止全部补间、粒子和时间轴回调。

### 6.2 DialogueLayer

负责：ADV 对话框、Ruby、选择肢、等待指示器、NVL、Backlog、Backlog 搜索视图、Banner、Command Rail、界面隐藏、说话人资料投影。

不负责：自动播放和快进策略。策略由 Presentation Controller 管理，DialogueLayer 只投影状态并派发用户选择。

`setActiveSpeaker` 是一次跨层意图：Facade 同时通知 DialogueLayer 更新说话人头像/标签，并通知 WorldLayer 更新立绘聚焦。两个 Layer 彼此不引用。

### 6.3 MenuLayer

负责：标题、结局、系统菜单、设置、存读档覆盖层及其局部交互。

不负责：实际存档 I/O、Profile I/O、设置持久化和游戏状态。调用者传入视图模型与回调；MenuLayer 只显示并派发意图。

### 6.4 GalleryLayer

负责：CG、音乐、文本回想三个视图及其选择、关闭和分页行为。

不负责：解锁规则和场景跳转。调用者提供已过滤视图模型，回想选择只派发意图。

### 6.5 SystemPanelLayer

负责：战斗、地图、商店、据点指令和阻塞视频的显示与局部交互。

不负责：战斗求解、地图规则、商店交易、日历推进或剧情恢复。所有领域规则继续位于 Core/Host adapter。

### 6.6 RenderLifecycle

负责登记并统一释放：

- ticker callback；
- tween/transition/particle handle；
- DOM/Pixi/Input listener；
- timer 和可取消异步任务；
- Blob URL 与字体加载任务；
- 对象池和临时显示对象；
- FrameScheduler；
- 开发环境 HMR 订阅。

每项登记必须包含 owner、kind 和 disposer。Layer 只能释放自己的 owner scope；Runtime dispose 释放全部 scope。释放必须幂等。

诊断快照至少包含：

```ts
interface RendererResourceSnapshot {
  disposed: boolean;
  tickerCallbacks: number;
  listeners: number;
  activeTweens: number;
  activeAsyncTasks: number;
  blobUrls: number;
  pooledObjects: Readonly<Record<string, number>>;
  displayObjectsByOwner: Readonly<Record<string, number>>;
}
```

## 7. 数据流与跨层协调

### 7.1 Core 文本事件

```text
Interpreter/EventBus
→ PresentationController
→ dialogue Command
→ DialogueLayer
→ 用户 advance/select
→ Controller callback
→ Host/Interpreter
```

Layer 不订阅 Core EventBus。只有 Controller 建立 Core 到 Renderer 的翻译关系，以防订阅分散和重复解绑。

### 7.2 菜单与系统面板

```text
Host 构造只读 ViewModel + callbacks
→ menu/system Command
→ Layer 显示
→ 用户操作派发 callback
→ Host 执行存档、交易或领域规则
→ Host 再提交新的 ViewModel
```

Layer 不持有 VariableStore、Interpreter、Combat、Calendar、Shop 或文件存储。

### 7.3 表现快照

```text
queries.presentation.snapshot()
→ Facade 向有快照职责的 Layer 收集可 JSON 序列化片段
→ 组装带内部版本的 RendererPresentationSnapshot
```

恢复时先完整校验所有片段，全部有效后再提交；任何片段非法都不得部分恢复。兼容期旧 `snapshotPresentation/restorePresentation` 通过该事务接口转发。本轮不得改变写入普通存档的外部格式；如内部需版本字段，必须保持旧快照可读并用直接回归测试证明。

## 8. 错误、取消与原子可见性

### 8.1 统一错误类型

```ts
type RendererErrorCode =
  | 'RENDERER_NOT_INITIALIZED'
  | 'RENDERER_DISPOSED'
  | 'INVALID_COMMAND_PAYLOAD'
  | 'ASSET_NOT_REGISTERED'
  | 'LAYER_INITIALIZATION_FAILED'
  | 'COMMAND_COMMIT_FAILED'
  | 'PRESENTATION_SNAPSHOT_INVALID'
  | 'LEGACY_CONTRACT_VIOLATION';

interface RendererError extends Error {
  readonly code: RendererErrorCode;
  readonly domain: string;
  readonly command?: string;
  readonly cause?: unknown;
}
```

错误必须包含 domain 和 command 上下文；禁止吞错后返回成功。用户 callback 抛错应交给统一 `onError`，不得破坏 Layer 内部状态。

### 8.2 原子可见性

涉及资源或多个显示对象的命令遵循：

```text
validate → prepare → commit → release previous
                     ↘ failure: rollback prepared resources
```

准备阶段不能让半成品可见。提交失败应恢复前一个有效画面；若无法恢复，必须进入明确的安全空状态并上报，不得留下可交互的半成品。

### 8.3 取消与 generation

每个可异步更新的 owner scope 维护 generation 或 AbortSignal。新命令、reset 和 dispose 会使旧 generation 失效。旧任务完成时只能释放自身临时资源，不能提交到当前画面。

必须直接测试：

- 旧背景晚到不覆盖新背景；
- 字体加载在 reset 后完成不重新绑定；
- 转场取消后不残留 ticker；
- 视频结束回调在 hide/dispose 后不恢复旧剧情；
- HMR 旧会话回调不写入新会话；
- dispose 后 Promise resolve 不创建 Pixi 对象。

## 9. 一个版本兼容窗口

### 9.1 兼容对象

- `AdvStage` 类型继续导出并标注 `@deprecated`；
- `PixiStage` 继续导出，但内部持有或包装一个 v2 Runtime/Facade；
- `AdvRenderer` 继续导出，但内部委托给 Presentation Controller；
- 基线公开类型继续可编译，除非类型本身从未公开或属于私有实现。

### 9.2 兼容规则

1. 旧方法映射到唯一的 v2 Command/Query；
2. 不在旧类中复制 Layer 逻辑；
3. 同一契约测试同时运行于 v2 与 legacy adapter；
4. 不在正式运行时反复打印弃用警告；
5. 通过 JSDoc、迁移文档和静态审计报告弃用；
6. 仓库内部迁移完成后禁止新增 legacy 调用；
7. 兼容层删除安排在下一大版本，不在 Wave 2 提前执行。

### 9.3 迁移资料

至少交付：

- `docs/renderer-v2-migration.md`；
- 旧方法到 v2 域的完整对照表；
- starter 最小初始化示例；
- 编辑器接入示例；
- 常见错误与资源所有权说明；
- 静态扫描命令，列出仓库内剩余 legacy 使用点。

## 10. 测试与验收设计

### 10.1 Layer 单元测试

每个 Layer 直接覆盖：初始化、正常命令、非法输入、重复 show/hide、取消、reset、dispose、重复 dispose、初始化失败清理、用户 callback 抛错。

fake 只能实现端口实际使用的字段；不得重新实现 Layer 生产逻辑。

### 10.2 Commands / Queries 契约测试

必须证明：

- Query 前后资源快照和可见状态不变；
- Command 校验失败时状态不变；
- 返回对象不能反向修改内部状态；
- disposed Runtime 对所有入口行为一致；
- v2 与 legacy adapter 在同一输入下产生相同可观察状态。

### 10.3 资源循环测试

每个 Layer 至少执行 50 次 show/hide 或 mount/unmount 循环。循环后比较稳定回收点的：ticker、listeners、tweens、async tasks、Blob URL、display objects 和 pool size。

对象池允许保持设计容量，但容量必须有上限，且第二轮 50 次循环后不得继续增长。

### 10.4 视觉回归

固定覆盖：标题、ADV+Ruby、NVL、选择肢、Backlog、设置、存读档、Gallery 三个 Tab、战斗、地图、商店、据点、粒子/转场、reduced-motion。

动态时间、光标、随机粒子和会话 ID 必须冻结、设固定种子或遮罩。截图差异只能作为发现信号，最终失败必须附差异图和语义状态；禁止执行 AI 无解释地批量更新基准图。

### 10.5 集成与真实应用

- 全 workspace typecheck；
- 全量测试；
- starter lint/simulate；
- 正式样例 lint/simulate/assets；
- 真实 Vite `.gal` HMR；
- 编辑器 preview 启动与核心操作；
- 浏览器 starter 冒烟；
- Windows unpacked EXE 隔离 userData 验收；
- `app.asar` 身份与加密素材校验。

### 10.6 性能和资源门槛

先在 `cab200b` 上建立带环境信息的基线，至少记录 5 次预热后的中位数和 p95。相对门槛：

| 指标 | 门槛 |
| --- | --- |
| 冷启动至 Runtime ready | 不恶化超过基线 10% |
| 首屏素材完成 | 不恶化超过基线 10% |
| 常用菜单打开 | p95 不恶化超过基线 15% |
| 场景切换 | p95 不恶化超过基线 15% |
| 50 次 Layer 循环 | 稳定回收后资源计数回到基线或固定池上限 |
| JS heap 趋势 | 强制回收可用环境下，多轮稳定点不得持续单向增长 |
| 页面/Promise/Electron 错误 | 0 新增 |
| bundle | 记录变化；无批准不得出现明显增长或新增超限 chunk |

性能比较必须在相同 Node、浏览器/Electron、构建模式、素材和机器条件下运行。偶发超限需要重复测量，不得直接调宽阈值。

## 11. 文档事实与 CI 治理

### 11.1 能力证据验证

扩展能力矩阵工具，使 `--check` 同时验证：

- 每个 tests/docs 路径存在；
- tests 路径位于允许的测试/示例证据范围；
- implemented 能力至少有一条测试证据；
- planned 能力不得伪装成 implemented；
- Markdown 与 JSON 一致。

先将 5 条不存在路径改为真实测试文件；若某能力没有直接测试，应新增真实测试，而不是随便指向相近文件。

### 11.2 CI 去重

将门禁拆为原子脚本，并建立一个本地总入口。CI 每个原子门禁只执行一次。`verify:p1p2` 不再在已经执行 typecheck/test/formal 的 CI 路径中重复运行同一命令。

推荐结果：

```text
verify:types
verify:unit
verify:docs
verify:hygiene
verify:examples
verify:renderer-contract
verify:renderer-resources
verify:all
```

具体命名由实施计划锁定。不得为了提速移除验证，只能消除重复和利用安全缓存。

Windows EXE 冒烟可放在 release/manual workflow 或 Windows 专用 job；不得假装 Ubuntu CI 已验证 Windows 发行版。

## 12. 九个串行里程碑

口头讨论曾用“七个里程碑”描述施工方向。成文设计改为九个，因为 Menu、Gallery、SystemPanel 和 World 必须分别验收，不能为了数字好看合并风险面。

### M0：事实门禁与基线

- 修复 5 条无效证据；
- 能力工具验证证据存在；
- 建立 CI 原子门禁和 `verify:all`；
- 采集性能、资源和视觉基线；
- 不改 Renderer 行为。

### M1：v2 API 骨架与兼容契约

- 定义 Runtime、Commands、Queries、Error、InputAction；
- 建立 Composition Root 空壳；
- 建立 Legacy Adapter 契约测试；
- 暂不搬迁大型 UI 实现。

### M2：RenderLifecycle 与输入归一化

- 统一登记 ticker、listener、tween、async、Blob、pool；
- 建立唯一 `RenderAssetRegistry`，消除跨 Layer 重复缓存；
- 输入映射为统一 action；
- 增加幂等销毁和 50 次循环测试；
- 保持画面行为不变。

### M3：DialogueLayer

- 迁移 ADV、Ruby、选择、NVL、Backlog、Banner、Command Rail；
- 迁移直接测试；
- 验证自动、快进、rollback、输入和语音重播。

### M4：MenuLayer

- 迁移标题、结局、系统菜单、设置、存读档；
- 验证 ViewModel/callback 边界；
- 不迁移存档或设置持久化规则。

### M5：GalleryLayer

- 迁移 CG、音乐、文本回想；
- 验证解锁过滤仍由 Host/Core 提供；
- 验证场景回想跳转和关闭流程。

### M6：SystemPanelLayer

- 迁移战斗、地图、商店、据点和视频；
- 保持领域求解位于 Core/Host；
- 验证 system boundary、pause/resume、存档和 rollback 限制。

### M7：WorldLayer

- 最后迁移背景、立绘、摄像机、效果、粒子、调色、时间轴；
- 验证表现快照事务、资源取消、reduced-motion 和 HMR；
- World 风险最高，因此放在前述生命周期和 Layer 模式稳定后。

### M8：消费者迁移、Facade 收口与发行验收

- starter、正式样例、编辑器、CLI 模板全部使用 v2；
- `PixiStage`/`AdvRenderer` 只剩兼容委托；
- 仓库内部 legacy 扫描归零，适配器和兼容测试除外；
- 更新文档和迁移指南；
- 跑全门禁、视觉、性能、资源、HMR 和 Windows EXE；
- 提交最终交付报告。

每个 M0–M8 都必须独立提交、独立报告。任一阶段未通过，不得进入下一阶段。

## 13. 停止施工条件

出现下列任一情况，当前里程碑立即停止并报告：

1. 全量测试或既有专项测试失败；
2. v2 与 legacy 契约不一致；
3. starter、正式样例或编辑器无法启动；
4. DSL、存档、rollback、HMR 或 system boundary 行为变化；
5. 资源循环测试出现无法解释的净增长；
6. 性能超过门槛且未获批准；
7. 视觉差异无法说明；
8. 需要修改非目标范围才能继续；
9. 执行 AI 无法解释准备删除的旧逻辑；
10. 新 Layer 需要直接导入另一 Layer；
11. 为通过门禁而删除测试、放宽断言或更新全部视觉基准；
12. 发现阻断缺陷但尚未先增加失败测试。

停止不等于回滚用户已有工作。执行 AI 应保留当前改动和失败证据，说明最后一个通过的提交、失败命令、预期与实际结果，再等待决策。

## 14. 最终验收标准

Wave 2 只有在以下条件全部成立时才可批准：

- [ ] M0–M8 均有独立提交和报告；
- [ ] Commands / Queries 边界已落地，Query 无副作用测试通过；
- [ ] 六个 Layer 不横向依赖；
- [ ] 所有资源通过统一 Lifecycle 登记；
- [ ] 每个 Layer 的 50 次循环无泄漏；
- [ ] `PixiStage` 与 `AdvRenderer` 只包含兼容委托，不包含第二份实现；
- [ ] starter、正式样例、编辑器、CLI 模板均使用 v2；
- [ ] 内部 legacy 使用扫描为 0，适配器和兼容测试除外；
- [ ] 旧 API 契约测试通过；
- [ ] 表现快照保持兼容并具备全量预校验；
- [ ] 全 workspace typecheck 和全量测试通过；
- [ ] starter 与正式样例验证通过；
- [ ] HMR、rollback、save/load、Profile、system boundary 通过；
- [ ] 能力矩阵所有证据路径存在；
- [ ] CI 无重复昂贵门禁，覆盖未降低；
- [ ] 视觉基准无未批准差异；
- [ ] 性能未越过门槛；
- [ ] Windows EXE 隔离验收通过；
- [ ] `git diff --check` 与仓库卫生通过；
- [ ] 工作树只保留明确排除的内部文件；
- [ ] 普通 push 后本地与 `surdet/main` 为 `0 0`。

## 15. 设计决策摘要

| 决策 | 结论 |
| --- | --- |
| 优化方向 | 稳定性与可维护性优先 |
| 重构强度 | 治理底座 + Renderer 完整分层 |
| 公共接口 | 同步升级为 Renderer v2 |
| 兼容策略 | 旧接口保留一个版本的薄适配窗口 |
| 架构模式 | Facade + 组合式 Layers |
| Ports & Adapters 吸收点 | 显式 Commands、只读 Queries、依赖端口和可替换测试 fake |
| 插件化 | 本轮不建设事件驱动插件生态 |
| 缺陷处理 | 只修迁移阻断缺陷，必须先有失败测试 |
| 实施模式 | 单 AI、九个串行里程碑、逐阶段提交和验收 |
| 行数 | 观察指标，不作为压缩 KPI |
| 玩家功能 | 不新增 |

## 16. 后续文档

本设计经用户复核后，下一步应按 `writing-plans` 技能生成：

1. `docs/superpowers/plans/2026-08-09-renderer-v2-wave-2-implementation.md`：面向单一执行 AI 的逐任务实施计划；
2. `docs/superpowers/plans/2026-08-09-renderer-v2-wave-2-executor-directive.md`：可直接复制给执行 AI 的最高执行指令；
3. 实施结束后由执行 AI 生成交付报告，由总经理进行独立复审。
