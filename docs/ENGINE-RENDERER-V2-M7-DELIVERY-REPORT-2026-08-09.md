
# Surdet Renderer v2 M7 交付报告

日期：2026-08-09
项目：E:/surdet
里程碑：M7 — Task 17–18：Freeze and extract WorldLayer
当前状态：WAITING_FOR_REVIEW

## 1. 交付结论

M7 已按照 E:/surdet/docs/superpowers/plans/2026-08-09-renderer-v2-layers-m3-m7.md 中的 Task 17–18 执行完成，施工范围止于 WorldLayer 提取、Renderer v2 World/Presentation 接线、事务性表现快照恢复、兼容委托和对应验证。

本轮交付内容：

- 冻结完整 World/presentation legacy/v2 合同，并先运行红测；
- 将背景、立绘复合显示、说话人聚焦、镜头、转场、闪白、擦除、调色、粒子、时间轴帧投影、画质、偏好、后处理和表现快照实现提取到独立 WorldLayer；
- 让 RendererFacade 在注入 World port 时直接协调 World 命令、查询和表现事务；
- 让 PixiStage 的旧 World API 保持可用，并改为单次兼容委托；
- 让 createRendererRuntime、AdvRenderer 和帧请求组合根接入真实 WorldLayer；
- 实现 validate-before-commit 的表现快照恢复，非法快照不会部分改变可见 World 状态；
- 保留 reset、clear、dispose、迟到准备令牌失效和共享 RenderLifecycle / RenderAssetRegistry 语义；
- 新增真实 WorldLayer 资源循环，两批各 50 次，证明两批稳定点相等且 World owner 不累积显示对象、监听器或补间；
- 完成 Renderer 专项、Renderer 全量、类型检查、构建、边界检查、根级 verify:all、Starter HMR/回滚、真实 Electron E2E 和《零点之后》正式验收；
- 完成两轮五样本真实 Electron Renderer 性能基线，并保留原始样本、统计口径和历史参照比较。

本轮没有开始 M8，没有进行正式消费者 cutover，没有扩大一版兼容层，没有修改 DSL、存档格式、游戏规则、键位、视觉文案或编辑器行为；没有 push、force push 或清理工作树。

报告提交后立即停止在 WAITING_FOR_REVIEW，等待总经理独立复审及“批准进入 M8”的明确指令。

## 2. 基线、提交和 Git 状态

### 2.1 M7 起始基线

- M6 独立复审批准的起始 HEAD：

~~~text
32375052f7b4bf68d2d97308a2bbca893916d5f9
~~~

- 分支：main。
- M7 起始时除两个明确排除的用户文件外，工作树没有本轮目标之外的改动：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
~~~

- 起始时 git rev-list --left-right --count HEAD...surdet/main：48 0。

### 2.2 M7 提交

Task 17 合同冻结测试提交：

~~~text
2857a7d test(renderer): freeze world presentation contract
~~~

Task 18 源码/回归测试提交：

~~~text
4a3df92ffc8272e2eeb2ea274a72a770a85e31bb
refactor(renderer): extract world layer
~~~

M7 最终报告提交完成后，最终 HEAD 将是本报告提交产生的新 SHA；本报告中的源码最终 SHA 明确指向上述 4a3df92ffc8272e2eeb2ea274a72a770a85e31bb，报告提交 SHA 会在最终交付回报中单独列出。

### 2.3 相对 M7 起始基线的实际文件

以下是从 32375052f7b4bf68d2d97308a2bbca893916d5f9 到 M7 源码提交的完整文件集合：

~~~text
M packages/renderer/src/adv-renderer.ts
M packages/renderer/src/api/renderer-commands.ts
M packages/renderer/src/index.ts
A packages/renderer/src/layers/world/world-layer.ts
M packages/renderer/src/pixi-stage.ts
M packages/renderer/src/runtime/create-renderer-runtime.ts
M packages/renderer/src/runtime/renderer-facade.ts
A packages/renderer/test/layers/world-layer.test.ts
A packages/renderer/test/legacy/legacy-world-contract.test.ts
~~~

packages/renderer/src/api/renderer-queries.ts 没有被修改：现有公开查询合同已经能够承载 World 查询，本轮不需要为了迁移而扩大查询文件的差异。

报告提交前再次核对：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
~~~

上述第三个文档在 M7 收尾复核时作为未跟踪文件出现；本轮没有创建、修改、暂存、提交、删除或推送它。USER.md、SESSION-HANDOFF.md 同样没有被修改、暂存、提交、删除或推送。M7 全程没有 push；报告提交后仍不得 push。

## 3. 测试先行与红测证据

### 3.1 合同冻结红测

先新增：

~~~text
packages/renderer/test/layers/world-layer.test.ts
packages/renderer/test/legacy/legacy-world-contract.test.ts
~~~

在 WorldLayer 生产模块和 Stage 兼容端口尚不存在时执行 M7 聚焦命令，按预期失败：

- WorldLayer 模块无法加载；
- 真实 PixiStage 尚没有 worldLayer 端口；
- 旧 World API 的单次委托断言无法成立；
- 原有 34 个 World 相关测试继续通过，证明红测来自待迁移合同而不是测试环境整体损坏。

确认红测后才创建 2857a7d 测试冻结提交，然后开始生产实现。

### 3.2 迁移后追加回归红测

最终复核时发现一个兼容语义风险：旧 Stage 的 clearPresentation / restorePresentation 不会改写对话层当前说话人的投影；如果新 WorldLayer 清理时把自己的 active speaker 无条件置空，清理后重新投影立绘会从 [1, 0.46] 退化为 [1, 1]。

先增加回归测试并执行：

~~~text
expected [1, 0.46]
received [1, 1]
5 passed, 1 failed
~~~

随后仅在 WorldLayer 中保留当前 World focus 穿过可见状态清理/表现恢复，并为已销毁层的 setPortraitFocus、setFade 增加幂等保护。修复后的同一测试为 6/6 通过。该修复已包含在 4a3df92ffc8272e2eeb2ea274a72a770a85e31bb。

## 4. WorldLayer 合同和实现

### 4.1 所有权和职责

新增：

~~~text
E:/surdet/packages/renderer/src/layers/world/world-layer.ts
~~~

WorldLayer 实现 WorldProjectionPort，只接收 Renderer 级别的 World 命令、查询、资源端口和帧请求回调。它不导入 Core、Interpreter、VariableStore、Combat、Calendar、Shop、Host 或其他 Renderer Layer。npm run verify:renderer-boundaries 和 Layer 源码依赖测试均通过。

从 PixiStage 移入 WorldLayer 的字段族包括：

~~~text
background layer / portrait layer / screen layer
background sprite / background key / background transition
portrait sprites / portrait views / portrait replacement tweens
active speaker focus
fade / flash / wipe / tint overlays
world effects controller
zoom / camera pan / transient effects
particle preset / particles
portrait movement tweens
timeline move/value/pan/tint start maps
quality / presentation preferences / post-process / color matrix
~~~

WorldLayer 负责背景、立绘、聚焦、镜头、转场、闪白、擦除、调色、粒子、时间轴帧投影、画质/偏好/后处理、缩略图查询和表现 snapshot/restore/clear。背景/立绘纹理仍由共享 RenderAssetRegistry 管理，WorldLayer 不重复持有资源缓存。所有 World 显示根和表现效果登记为 owner=world；销毁时释放 world owner，且不销毁宿主注入的共享纹理。

### 4.2 World v2 接线

packages/renderer/src/api/renderer-commands.ts 新增 WorldProjectionPort，在既有 WorldCommands 之上公开 needsUpdate、帧请求/更新、画质、表现偏好、后处理、缩略图、表现 snapshot/restore/clear 和 reset。

RendererFacade 在存在 worldLayer 时直接调用真实 World port；查询读取真实 World 状态；Presentation snapshot/restore/clear 经过 World port；无 World port 时继续使用旧 Stage fallback。void 命令使用显式 if/else，避免 v2 调用后又执行一次 legacy fallback。Composition Root 将 WorldLayer 纳入共享生命周期和帧请求唤醒集合。AdvRenderer 保留原构造和公开 API，接入可选 World projection port；旧调用者不需要知道 WorldLayer 具体类。

### 4.3 PixiStage 兼容委托

PixiStage 仍拥有 Application、UI 组合根和旧公开 API，但 World 的实现主体已删除。背景、立绘、聚焦、表现效果、时间轴帧和表现事务的旧方法现在各自只向 WorldLayer 委托一次；updateEffects 组合 World、Menu、Dialogue 的帧推进，needsUpdate 聚合各层状态，resetSession 和 destroy 转发 World 生命周期。没有保留第二份背景/立绘/粒子/镜头/调色/时间轴实现。

### 4.4 表现快照事务

restorePresentation 先完成快照对象、版本、数组、字段类型、数值边界、背景/立绘/粒子 key 和纹理准备检查，准备完成后才清理旧可见投影并提交新快照。非法快照会抛出 PRESENTATION_SNAPSHOT_INVALID，并保持此前的背景、立绘、镜头和调色状态不变。新的背景/立绘命令会推进准备代次；reset、clear、dispose 后，迟到准备不能重新提交到已失效的 World projection。

clearPresentation 不通过广义会话 reset，不重置对话、选择、自动、快进、Backlog 或其他 Layer 状态。当前 active speaker focus 不属于表现快照字段，因此按 legacy 语义保留，确保清理后重新投影的立绘仍能正确明暗聚焦。

## 5. 资源循环和生命周期证据

packages/renderer/test/layers/world-layer.test.ts 使用真实 WorldLayer、共享 RenderLifecycle、共享 RenderAssetRegistry 和真实 Pixi display objects，执行两批独立的各 50 次循环。每次覆盖：

~~~text
mount → register/use background → register/use portrait
→ transition → particles → update → reset → dispose
~~~

每次 dispose 后 root Container 没有残留子节点。两批结束快照完全相等，并满足：

~~~text
listeners = 0
activeTweens = 0
displayObjectsByOwner.world = 0
~~~

同一测试还验证 WorldLayer 的 Layer 依赖只限于 World 自身和共享 renderer service，不存在跨 Layer import。

## 6. 测试、门禁和正式项目验收

### 6.1 M7 专项

执行：

~~~text
npm test -w @surdet/renderer -- world-layer.test.ts legacy-world-contract.test.ts pixi-stage.test.ts world-effects-controller.test.ts transition-registry.test.ts timeline-player.test.ts post-process.test.ts resource-cycles.test.ts
~~~

结果：8 个文件、46/46 通过；其中 WorldLayer 6/6、legacy World 2/2、PixiStage 22/22、WorldEffects 2/2、Transition 3/3、Timeline 6/6、PostProcess 1/1、resource-cycles 4/4。

计划点名的 presentation-snapshot.test.ts 在当前仓库不存在，没有伪造该文件或跳过事务验证；对应职责由以下现有测试覆盖：

~~~text
packages/renderer/test/integration/presentation-clear.test.ts  1/1
packages/renderer/test/runtime/presentation-controller.test.ts  6/6
~~~

补充事务测试结果：2 个文件、7/7 通过。

### 6.2 Renderer 和跨包门禁

| 检查 | 实际结果 |
| --- | --- |
| Renderer 全量测试 | 44 个文件，299/299 |
| Renderer typecheck | 通过 |
| Renderer build | 通过 |
| Renderer boundary | 3/3，边界脚本通过 |
| Starter HMR/rollback | 2 个文件，3/3 |
| 根级 npm run verify:all | 退出码 0 |
| verify:tools | 6/6 |
| workspace typecheck | 通过 |
| workspace tests | 全部通过 |
| git diff --check | 通过 |

根级门禁本轮 workspace 测试计数：CLI 7/86、Core 23/298、Editor 18/133、Host 3/18、Renderer 44/299、Shell 6/32、Starter 3/3。门禁中出现的 surdet pack 用法提示、EventBus 测试主动制造的错误日志和 Vite 大 chunk warning 均没有导致失败；命令退出码为 0，未吞掉错误，也未提高阈值。

### 6.3 真实 Electron E2E

npm run e2e -w @surdet/shell 通过：__surdetDebug 就绪，真实 Electron 画布存在，标题入口可用，F5 快速存档和 F9 快速读档通过，读档后没有回退到 idle；steps=55、choices=41，到达正式剧情系统交互层。

### 6.4 《零点之后》正式验收

zero-after-midnight lint、simulate、assets、typecheck、build 均通过：11 个场景、0 错误/0 警告，选择分支 23/23，全覆盖；可达结局 3 个（testimony_end、meeting_end、silence_end）；save/load 往返冒烟 39 次；运行时错误 0；资产 44/44。未修改正式游戏源码、DSL、存档、资产或规则。

## 7. Renderer 性能和视觉基线

### 7.1 采样口径

执行 npm run e2e:renderer-baseline -w @surdet/shell -- --out <temporary-output>。脚本先暖机 1 次，再用独立临时 userData 启动 5 次 Electron；coldStartMs、assetReadyMs 取中位数，菜单/场景取 5 样本 p95；每轮均为资产 6/6、页面错误 0、控制台错误 0、失败请求 0。原始 JSON 留在系统临时目录，不进入仓库。

### 7.2 M7 最终源码 SHA 下的两轮结果

两轮均运行于：

~~~text
4a3df92ffc8272e2eeb2ea274a72a770a85e31bb
~~~

第一轮：

| 指标 | 原始样本（排序后） | 顶层统计 |
| --- | --- | --- |
| coldStartMs | 1099.58, 1104.76, 1175.38, 1255.51, 1295.18 | median 1175.38 ms |
| assetReadyMs | 1153.93, 1154.67, 1232.18, 1305.42, 1349.14 | median 1232.18 ms |
| menuOpenP95Ms | 原始 JSON | p95 15.20 ms |
| sceneP95Ms | 原始 JSON | p95 38.90 ms |

第二轮：

| 指标 | 原始样本（排序后） | 顶层统计 |
| --- | --- | --- |
| coldStartMs | 922.29, 953.82, 968.86, 1015.70, 1113.74 | median 968.86 ms |
| assetReadyMs | 965.07, 1001.95, 1161.41, 1371.29, 1409.46 | median 1161.41 ms |
| menuOpenP95Ms | 原始 JSON | p95 12.00 ms |
| sceneP95Ms | 原始 JSON | p95 34.30 ms |

临时原始文件：

~~~text
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v2-m7-current.json
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v2-m7-repeat.json
~~~

### 7.3 与历史参照的诚实比较

仓库现有 docs/baselines/renderer-v2-cab200b.json 的 sourceSha 是 16416535b4d55b0311ba54b93d5819f862b29170，不是本次 M7 起始的 M6 最终 SHA，因此只能作为历史参照，不能冒充 M6→M7 同源 A/B 基线。历史参照为：

~~~text
coldStartMs       median 891.82 ms
assetReadyMs      median 948.05 ms
menuOpenP95Ms     10.80 ms
sceneP95Ms        25.60 ms
~~~

第二轮 M7 相对该历史参照：

~~~text
coldStartMs       +8.64%
assetReadyMs      +22.50%
menuOpenP95Ms     +11.11%
sceneP95Ms        +34.00%
~~~

第一轮相对同一参照分别约为 +31.75%、+29.97%、+40.74%、+52.00%。两轮显示冷启动和菜单存在明显正常波动，但资源就绪和场景 p95 在两轮中仍高于历史参照。

本轮没有把这组数值伪装成“完全没有性能变化”，也没有删除字段或提高阈值。M7 要求采集并比较性能基线，但没有另行批准新的数值阈值，且当前没有与 M6 最终 SHA 同源的 M6 数值 JSON。因此本报告将此记录为“采样和错误门禁通过、存在需要后续同源基线复核的性能观察项”，不把它宣称为 10%/15% 阈值内通过，也不在 M7 范围内擅自开始性能优化或 M8 工作。

### 7.4 视觉采样

两轮基线均采集 title 和 story-entry，尺寸均为 1264×681，且无页面/控制台/请求错误。title hash 在历史参照和两轮 M7 之间保持：

~~~text
aca617dcc09733b2282be67fbe3a15c984e91cfd610358d48d6ad4d1dacc8882
~~~

story-entry hash 在独立启动间变化（第一轮 fd69b335...、第二轮 8fe7f6d8...、历史参照 b064926a...），说明该状态含有时序/动画或渲染时点差异，不能仅凭 hash 差异断言视觉回归。若独立复审要求像素级视觉 A/B，应在固定动画时点和同源 M6 构建产物下重新采集。

## 8. PixiStage 明确保留的残余职责

当前 PixiStage 保留的是组合根和兼容边界，不是第二份 World 实现：

- 持有 Pixi Application、canvas 和顶层 UI Container；
- 按固定顺序挂载 World roots、UI、LoadingLayer、Dialogue/Menu/Gallery/SystemPanel roots；
- 提供旧 AdvStage 构造方式和旧公开 World API 的单次委托；
- 管理字体角色配置、字体注册和宿主注入资源注册入口；
- 管理 LoadingLayer、全局 asset source 释放以及 resetSession / destroy 的组合生命周期；
- 保留旧对话、菜单、鉴赏和系统面板的兼容属性/回调桥；
- 保留截图提取的宿主 Application renderer 访问：WorldLayer 公开 captureThumbnail()，但通过 callback 请求 Stage 的整屏 extraction；这不是 WorldLayer 的第二份投影状态机；
- 维护旧 Stage 回调属性和部分宿主兼容 API，跨层业务协调仍由 RendererFacade/PresentationController 负责。

背景/立绘 Sprite 状态、World screen overlays、WorldEffectsController、粒子数组、镜头和时间轴 World 状态、World presentation preference/post-process 状态以及表现快照具体实现已经不再由 PixiStage 持有。

## 9. 遗留事项与明确不做项

### 9.1 本轮遗留观察

- 计划点名的 presentation-snapshot.test.ts 在仓库中不存在；现有事务测试覆盖同一合同，本轮没有创建无实际来源的占位文件。
- 性能基线已完成两轮 5 样本采集，但历史参照不是 M6 最终 SHA 的同源基线；第二轮 asset ready 和 scene p95 相对历史参照偏高，需未来获得明确授权后做同源 M6/M7 A/B 或专项性能分析。
- story-entry 动态截图 hash 不是跨启动稳定值；后续若要做像素级视觉门禁，需要固定动画时点、字体加载状态和输入时序。

### 9.2 明确未做

- 未开始 M8；
- 未迁移最终正式消费者；
- 未移除 legacy fallback 或扩大兼容窗口；
- 未修改 DSL、存档格式、游戏规则、键位、视觉文案和编辑器行为；
- 未做无关重构、玩家功能或商业能力扩展；
- 未修改、暂存、提交、删除或推送 USER.md、SESSION-HANDOFF.md；
- 未 push，未 force push，未清理工作树。

## 10. 最终停止点

报告提交完成后执行一次最终只读核对：

~~~text
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
~~~

预期最终工作树：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
~~~

预期状态：M7 完成、M8 未开始、WAITING_FOR_REVIEW、不 push。上述三个未跟踪文件均不属于 M7 提交。等待总经理独立复审及“批准进入 M8”后，才允许讨论下一里程碑。
