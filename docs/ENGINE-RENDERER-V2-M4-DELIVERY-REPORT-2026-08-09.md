# Surdet Renderer v2 M4 交付报告

日期：2026-08-09
项目：E:/surdet
里程碑：M4 — Task 14: Freeze and extract MenuLayer
当前状态：WAITING_FOR_REVIEW

## 1. 结论

M4 已严格按 docs/superpowers/plans/2026-08-09-renderer-v2-layers-m3-m7.md 的 Task 14 完成。标题画面、结局卡、系统菜单、设置面板、存档/读档面板的显示状态、绘制对象、菜单动画、回调和缩略图池已经从 PixiStage 的实现主体迁移到独立的 MenuLayer。正式 v2 runtime 通过公开 MenuProjectionPort 注入 RendererFacade；旧 PixiStage 方法保留为兼容委托，没有保留第二份菜单渲染实现。

本轮没有修改 DSL、存档格式、游戏规则、键位、视觉文案、编辑器行为或正式游戏消费者接线；没有开始 M5，也没有进行 M6/M7/M8 工作、消费者 cutover 或远端推送。USER.md 与 SESSION-HANDOFF.md 仍为未跟踪文件，未暂存、未提交、未删除。

本报告提交后停止，等待独立复审及“批准进入 M5”。

## 2. 基线与严格范围

### 2.1 M4 开工基线

- M3 最终复审批准基线：0c1f66595ca55998ef1dee40a2bd45db0e965514。
- 分支：main。
- M4 开工前工作树除本轮目标文件外仅有未跟踪的 USER.md、SESSION-HANDOFF.md。
- M4 开工前未 push；本轮全程未 push、未 force push。
- 合同冻结提交：

~~~text
3f9ff65195f6cac8a96612ef976e0a1fddca8371
test(renderer): freeze menu projection contract
~~~

- M4 源码与测试提交：

~~~text
81bd3034b04c883a4e84f41d3205e8c881d39d98
refactor(renderer): extract menu layer
~~~

### 2.2 本轮实际施工

- 先冻结并表征 Menu legacy/v2 合同，再运行 pre-extraction 测试。
- 创建 MenuLayer 与直接投影测试。
- 将菜单显示职责、字段、回调、动画和缩略图池移入 MenuLayer。
- 以 MenuProjectionPort 接入 Facade 和 runtime composition root。
- 将 PixiStage 菜单公开方法改为兼容委托，并删除旧菜单私有字段与渲染主体。
- 使用共享 RenderLifecycle 与 RenderAssetRegistry，菜单资源统一归属 owner menu。
- 执行两批各 50 次 MenuLayer 资源循环，并比较稳定快照。
- 执行 M4 聚焦门禁、Renderer 全量测试、typecheck、build、边界检查和根级 verify:all。

### 2.3 明确未开始或未改变

以下内容没有在 M4 中施工：

- M5 GalleryLayer；
- M6 SystemPanelLayer；
- M7 WorldLayer；
- M8 消费者迁移、legacy 收口、最终 cutover 和发行总验收；
- 正式游戏、starter、编辑器或 CLI 的 v2 consumer cutover；
- DSL、存档格式、游戏规则、键位、视觉文案和编辑器行为；
- 与 MenuLayer 迁移无直接关系的重构或玩家功能；
- 远端 push、force push、工作树清理；
- USER.md、SESSION-HANDOFF.md 的任何修改、暂存或提交。

## 3. 合同冻结与实现交付

### 3.1 Pre-extraction 合同结果

在生产迁移前先加入：

- packages/renderer/test/layers/menu-layer.test.ts
- packages/renderer/test/legacy/legacy-menu-contract.test.ts

然后按任务书运行：

~~~powershell
npm test -w @surdet/renderer -- menu-layer.test.ts legacy-menu-contract.test.ts ui-views.test.ts pixi-stage.test.ts
~~~

结果为 4 个文件、32/32 通过：

- menu-layer.test.ts：2/2；
- legacy-menu-contract.test.ts：2/2；
- ui-views.test.ts：6/6；
- pixi-stage.test.ts：22/22。

该阶段的目的为锁定迁移前行为和旧 API 兼容边界；没有用“实现后必然通过”的测试冒充 RED 证据，也没有修改旧合同来迁就新实现。

### 3.2 MenuLayer 所有权

新增文件：

- packages/renderer/src/layers/menu/menu-layer.ts

MenuLayer 实现公开的 MenuProjectionPort，即 MenuCommands 加上无副作用的 menu() 查询。它只接收已经准备好的视图模型和回调，不直接访问宿主存储、Profile、SettingsStore、Interpreter 或 Core 状态。

迁移的字段族与 Task 14 完全对应：

~~~text
titleLayer, titleHandler, endingLayer,
menuLayer, menuPanel, menuMotionRemain, menuMotionDur, menuMotionOffset,
menuHandlers, settingsLayer, settingsRows, settingsHandlers,
saveLoadLayer, saveLoadHandlers
~~~

迁移的方法为：

~~~text
showTitle / hideTitle
showEnding / hideEnding
showSystemMenu / hideSystemMenu
showSettings / hideSettings
showSaveLoad / hideSaveLoad
~~~

MenuLayer 还负责以下菜单专属资源：

- 五个菜单显示根节点和 menu owner display 登记；
- 系统菜单入场淡入、抽屉滑入和每帧更新；
- 标题选项的 enabled/disabled 投影与回调；
- 设置行左右步进、关闭回调；
- 存档/读档卡片、空槽位可选性、模式和回调；
- 缩略图 Texture LRU pool，以及 reset/dispose 时的释放；
- 菜单监听器的 owner 登记、替换和清理；
- reset、重复 hide、重复 dispose 的幂等行为。

MenuLayer 没有导入任何其他 Renderer Layer。边界检查对该约束实际通过。

### 3.3 PixiStage 兼容委托

修改文件：

- packages/renderer/src/pixi-stage.ts

PixiStage 保留原构造方式和旧公开菜单 API，但现在只负责：

- 将旧调用委托给 MenuLayer；
- 保留旧 API 的跨层隐藏顺序和 command rail 恢复语义；
- 保留旧结局卡对 fade overlay 的兼容效果；
- 在 resetSession()、updateEffects()、destroy() 中转发 MenuLayer 的 reset/update/dispose。

标题、结局、系统菜单、设置和存读档的旧私有字段、旧菜单显示根节点、旧绘制主体和旧菜单动画更新函数已从 PixiStage 删除。PixiStage 不再拥有第二份菜单渲染实现。

为保持兼容路径的 command rail 行为，Stage 增加了 Facade-only 的 restoreCommandRail() 桥接方法；它不改变 AdvStage 的玩家脚本契约，也不让 MenuLayer 直接接触 DialogueLayer。

### 3.4 Facade、Runtime 与公开契约

修改文件：

- packages/renderer/src/api/renderer-commands.ts
- packages/renderer/src/runtime/renderer-facade.ts
- packages/renderer/src/runtime/create-renderer-runtime.ts
- packages/renderer/src/index.ts

新增公开 typed port：

~~~typescript
export interface MenuProjectionPort extends MenuCommands {
  menu(): MenuOverlayState;
}
~~~

RendererFacade 的行为分成两条明确路径：

- 注入 menuLayer 时，v2 命令直接调用 MenuProjectionPort；Facade 负责菜单与对白、Gallery、fade 的跨层协调，Stage 的旧菜单方法不会再次执行；
- 未注入 menuLayer 时，继续调用旧 Stage 菜单方法，保留已有 legacy fallback 行为。

OverlayQueries.menu() 在 v2 路径读取 MenuLayer 的纯查询副本，在 legacy 路径读取 Facade 的兼容状态。查询不创建 Pixi 对象、不注册资源、不请求帧、不修改可见状态。

Runtime composition root 将 stage.menuLayer 与 stage.dialogueLayer 一起传给 Facade；MenuLayer 与 DialogueLayer、Stage、AssetRegistry 使用同一生命周期边界。Controller 没有导入 MenuLayer，也没有操作 Pixi 对象。

## 4. 测试与行为覆盖

### 4.1 MenuLayer 直接测试

最终 packages/renderer/test/layers/menu-layer.test.ts 为 8/8，通过的覆盖包括：

- 标题启用项可选、禁用项不可选；
- 结局卡显示、隐藏、重复 show/hide 和状态查询；
- 系统菜单选项回调与遮罩关闭回调；
- 设置行左右步进和关闭回调；
- 存档/读档模式切换、非空槽回调、读档空槽不可选、存档空槽可选；
- 回调抛错时先清理本层显示和监听器，再把异常传播给调用方；
- reset/dispose 后不残留菜单根节点或 owner 资源；
- MenuLayer 只接收视图模型与回调，不直接拥有存储对象。

另有一个确定性投影形状测试，分别比较 title、ending、system menu、settings、save 和 load 六种状态的重复构建结果；没有批量更新截图基线，也没有接受未解释的视觉差异。

### 4.2 Legacy 兼容测试

packages/renderer/test/legacy/legacy-menu-contract.test.ts 最终为 2/2，验证：

- 旧 PixiStage 的标题、结局、系统菜单、设置和存读档 API 可重复调用、可重复隐藏，并在 reset/destroy 后保持幂等；
- 旧 Stage 的跨覆盖层协调顺序仍保持：标题会收起结局和 command rail；结局会收起 command rail、Gallery、设置和存读档；设置会收起存读档、Gallery 和 command rail；
- 直接 legacy PixiStage 路径没有因为抽取 MenuLayer 而丢失原行为。

### 4.3 资源循环

MenuLayer 测试使用同一个 RenderLifecycle 与 RenderAssetRegistry，执行两批独立的 50 次循环。每次循环创建新的 root Container 和 MenuLayer，依次投影各类菜单、推进系统菜单动画、执行 reset，然后 dispose，并验证 root 没有残留子节点。

两批稳定点完全相等：

~~~json
{
  "disposed": false,
  "tickerCallbacks": 0,
  "listeners": 0,
  "activeTweens": 0,
  "activeAsyncTasks": 1,
  "blobUrls": 0,
  "pooledObjects": {},
  "displayObjectsByOwner": {
    "menu": 0
  }
}
~~~

activeAsyncTasks: 1 是共享 RenderAssetRegistry 的 runtime 级 asset-generation 登记，不是 MenuLayer 泄漏；两批结果完全相等，且菜单 owner 的 listener、tween、pool 和 display 均回到稳定基线。循环测试随后显式 dispose 资产注册表和生命周期。

### 4.4 确定性状态比较

已对六类 MenuLayer projection 的重复构建做结构化确定性比较：

| 状态 | 重复投影结构 | 状态查询 | 结果 |
| --- | --- | --- | --- |
| title | 文本、禁用项、启用项、强调线结构一致 | { type: "title" } | 通过 |
| ending | 黑底和结局文本结构一致 | { type: "ending" } | 通过 |
| system menu | 遮罩、面板、行和入场初始状态一致 | { type: "system-menu" } | 通过 |
| settings | 面板、行、左右控制结构一致 | { type: "settings" } | 通过 |
| save | 卡片和空槽可选结构一致 | { type: "save-load", mode: "save" } | 通过 |
| load | 卡片和空槽禁用结构一致 | { type: "save-load", mode: "load" } | 通过 |

## 5. 门禁与正式项目验收

### 5.1 M4 聚焦门禁

命令：

~~~powershell
npm test -w @surdet/renderer -- menu-layer.test.ts legacy-menu-contract.test.ts ui-views.test.ts resource-cycles.test.ts
~~~

结果：4 个文件、20/20 通过。

### 5.2 Renderer 全量门禁

命令：

~~~powershell
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
~~~

结果：

- Renderer：38 个测试文件、259/259 通过；
- Renderer typecheck：通过；
- Renderer build：通过。

### 5.3 Layer 边界门禁

命令：

~~~powershell
npm run verify:renderer-boundaries
~~~

结果：3/3 边界测试通过，Renderer Layer boundary check passed. MenuLayer 没有导入 DialogueLayer、GalleryLayer、SystemPanelLayer 或 WorldLayer。

### 5.4 根级全量门禁

命令：

~~~powershell
npm run verify:all
~~~

结果：通过。该命令实际执行了工具测试、Renderer boundary、能力矩阵、仓库卫生、全 workspace typecheck、全 workspace test、starter 验收、正式项目验收、编辑器构建、starter 构建和正式项目构建。

正式项目验收结果：

- 选择分支：23/23，全覆盖；
- 结局：3 个，均可达；
- 资产：44 项，检查通过；
- 运行时错误：0；
- zero-after-midnight lint：通过；
- zero-after-midnight typecheck/build：通过。

### 5.5 提交前 Git 检查

代码提交前已执行精确暂存和：

~~~powershell
git diff --cached --check
git status --short
~~~

提交后最终复核显示，除报告文件即将加入外，工作树只剩：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
~~~

本轮没有把构建产物、截图、日志、缓存或生成目录加入提交。

## 6. 提交与停止点

### 6.1 已完成的提交

合同冻结提交：

~~~text
3f9ff65195f6cac8a96612ef976e0a1fddca8371
test(renderer): freeze menu projection contract
~~~

源码与测试提交：

~~~text
81bd3034b04c883a4e84f41d3205e8c881d39d98
refactor(renderer): extract menu layer
~~~

本报告将作为独立文档提交；报告提交完成后的最终 HEAD、ahead/behind 和工作树状态以本次交付回报为准。

### 6.2 当前停止条件

M4 已完成并停在 WAITING_FOR_REVIEW：

- M5 未开始；
- 未进行 M6/M7/M8 工作；
- 未进行消费者 cutover；
- 未 push 远端；
- 未 force push；
- 未提交 USER.md、SESSION-HANDOFF.md；
- 未删除或清理用户工作树中的排除文件。

等待独立复审及“批准进入 M5”。
