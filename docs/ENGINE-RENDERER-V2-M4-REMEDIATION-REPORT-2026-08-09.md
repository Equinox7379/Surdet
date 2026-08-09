# Surdet Renderer v2 M4 阻断缺陷整改报告

日期：2026-08-09
项目：E:/surdet
里程碑：M4 — MenuLayer 整改（仍停留在 M4）
状态：WAITING_FOR_REVIEW

## 1. 结论

本次工作严格限定为 M4 独立复审指出的菜单兼容与查询语义阻断项，没有启动 M5，没有扩大到 Gallery、SystemPanel、World 或其他 Layer，也没有修改 DSL、存档格式、游戏规则、编辑器行为、正式游戏接线、视觉文案和玩家功能。

整改完成并通过全部要求的测试、边界检查、根级门禁和正式游戏验收：

- M4 精确聚焦命令：6 个测试文件、56/56 通过；
- Renderer 全量：38 个测试文件、267/267 通过；
- Renderer typecheck：通过；
- Renderer build：通过；
- Renderer boundary：3/3 通过；
- npm run verify:all：通过；
- 《零点之后》：23/23 选择分支、3 个结局、44 项资产、运行时错误 0；
- 两批各 50 次 MenuLayer 资源循环：稳定快照完全相等；
- git diff --check：通过；
- 未 push、未 force push；
- USER.md 与 SESSION-HANDOFF.md 始终未跟踪、未暂存、未提交、未删除。

完成本报告提交后继续停止，等待独立复审；不自行批准进入 M5。

## 2. 基线、提交与范围

### 2.1 整改前基线

- 整改前 HEAD：

  e93dca7293aa4778ff4894122ee408c78813712b

- 整改前提交：docs(renderer): deliver M4 menu layer report；
- 整改前 git rev-list --left-right --count HEAD...surdet/main：37 0；
- 分支：main；
- 整改前工作树只有两个未跟踪排除文件：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
~~~

### 2.2 本轮新提交

源码与测试提交已创建：

~~~text
ca462f2668b0348f7f8bc33cf47ab911bee95979
fix(renderer): preserve menu coordination semantics
~~~

本报告将作为第二个独立文档提交，提交完成后的完整 SHA 由最终 Git 复核和交付回报记录。报告提交不能在自身内容中预先引用自身 SHA；除此之外，本报告记录的源码提交 SHA、父提交、测试和状态均为完整值。

预期的提交关系为：

~~~text
e93dca7...  →  ca462f2...  →  本报告提交
~~~

创建两个新提交时不 amend、不 rebase、不 squash 既有提交。

### 2.3 实际修改文件

本轮源码/测试提交精确包含以下 5 个文件：

~~~text
packages/renderer/src/layers/menu/menu-layer.ts
packages/renderer/src/pixi-stage.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/layers/menu-layer.test.ts
packages/renderer/test/legacy/legacy-menu-contract.test.ts
~~~

本轮没有修改 examples/zero-after-midnight/src/main.ts，没有修改任何 API 类型文件，也没有加入临时脚本、截图、日志、构建产物或缓存。文档提交只新增本报告：

~~~text
docs/ENGINE-RENDERER-V2-M4-REMEDIATION-REPORT-2026-08-09.md
~~~

USER.md、SESSION-HANDOFF.md 明确排除，不属于本次提交范围。

## 3. RED 证据与阻断根因

整改遵循“先测试、后生产代码”的顺序。生产代码修改之前，新增的真实接线回归测试实际失败：

~~~text
Test Files  2 failed (2)
Tests       5 failed | 10 passed (15)
~~~

失败事实如下：

1. 标题启用项点击后，测试期望标题仍为 { type: "title" }，实际为 { type: "none" }。根因是 M4 MenuLayer 回调中先执行了 hideTitle(false)。
2. 正式 v2 接线中，标题作为底图保留时，系统菜单/设置/存读档关闭后查询实际返回 none，没有回到仍可见的标题层。根因是 menu() 只返回最后一次写入的单一 overlay 变量，没有扫描真实可见容器和 z-order。
3. 真实 MenuLayer + RendererFacade 设置关闭链路中，宿主回调被调用，但 restoreCommandRail 调用次数为 0，且不存在“Layer 先关闭、Facade 再恢复、最后调用宿主回调”的可观测顺序。
4. 真实 MenuLayer + RendererFacade 存读档有效槽位选择链路中，宿主选择回调被调用，但 command rail 恢复次数为 0。
5. legacy Stage 传给 MenuLayer 的设置/存读档回调与宿主原始回调是同一函数，证明没有兼容包装层。

真实 PixiStage 的 fallback speaker-focus 回归测试在 RED 阶段已通过：当前 HEAD 已包含 M3 的早返回修复，无 DialogueProjectionPort 时不会再从 Facade 额外协调一次 World focus。本轮保留该测试作为 M4 回归护栏，没有对已经正确的 fallback 分支做无关改写。

## 4. 生产修复

### 4.1 MenuLayer 只负责本层状态，协调交给 Facade/legacy wrapper

MenuLayer 的 system/settings/save-load pointerdown 仍然只执行自己的本地关闭、监听器释放和对象清理，然后调用传入的回调；它没有导入其他 Layer，也没有重新引入 World 专用回调。

在跨层边界增加了两套兼容包装：

- v2：RendererFacade.#wrapMenuRailRestore()；
- legacy：PixiStage.#restoreMenuRail()。

两套包装都遵守相同顺序：

~~~text
MenuLayer 本地 hide/cleanup
        ↓
Facade 或 PixiStage 恢复 command rail 一次
        ↓
调用宿主 onClose/onSelect；异常原样传播
~~~

因此：

- 设置背景、设置关闭按钮：恢复一次，再调用 onClose 一次；
- 存档/读档背景、关闭按钮：恢复一次，再调用 onClose 一次；
- 存档/读档有效槽位：恢复一次，再调用 onSelect 一次；
- 读档模式空槽位没有 listener，不关闭、不恢复、不调用宿主回调；
- 宿主回调抛错时，Layer 已经清理，Facade/legacy 恢复已发生，异常继续向上抛出；
- explicit hideSettings()、hideSaveLoad() 的既有语义不变，不借助回调包装器伪造显式隐藏。

legacy 兼容路径通过 PixiStage.restoreCommandRail() 桥接到 DialogueLayer，避免在 MenuLayer 内部直接依赖 DialogueLayer；旧 Stage 的公开构造方式和公开菜单 API 未改变。

### 4.2 标题点击恢复 M3 合同

M3 基线 0c1f66595ca55998ef1dee40a2bd45db0e965514 的旧实现是：启用标题项 pointerdown 只调用 this.#titleHandler?.(item.id)，标题保持可见；进入正文或显式离开标题时再由宿主调用 hideTitle()。

本轮恢复同一语义：

- enabled 项只调用 onSelect(item.id)；
- enabled 项不会自动隐藏标题；
- disabled 项不调用回调，也不隐藏标题；
- callback 抛错时标题仍可见，查询仍为 title；
- showTitle() 重复调用会清理上一轮显示对象/监听器并替换 handler，不保留旧 handler；
- 只有 explicit hideTitle() 才关闭标题。

这与正式游戏 main.ts 的接线一致：标题进入设置/存读档时保留封面作为覆盖页面底图；开始新游戏或读档成功后由宿主显式隐藏标题。

### 4.3 OverlayQueries.menu() 改为真实 frontmost 查询

删除了 MenuLayer 中代表“最后一次 show 调用”的 #overlay 状态。现在 menu() 从 MenuLayer 自己的五个根容器中，按 uiLayer.children 的真实 z-order 从前向后扫描，只返回当前可见的最前菜单：

~~~text
title
ending
system-menu
settings
save-load(save/load)
none
~~~

save/load 模式只保留与 save/load 容器当前可见性绑定的 #saveLoadMode；不是用一个全局“最后一次显示”结果覆盖实际 z-order。每次查询都返回新对象，查询本身不创建 Pixi 对象、不注册资源、不请求帧、不修改可见状态。

已覆盖的真实状态转移：

~~~text
showTitle                         → title
title + showSystemMenu            → system-menu
hideSystemMenu                    → title
title + showSettings              → settings
hideSettings                      → title
title + showSaveLoad(save)        → save-load/save
hideSaveLoad                      → title
title + showSaveLoad(load)        → save-load/load
hideSaveLoad                      → title
showEnding                        → ending
ending + showSystemMenu           → system-menu
hideSystemMenu                    → ending
reset/dispose                     → none
~~~

没有通过隐藏所有菜单来制造互斥，也没有扩大 MenuOverlayState 去包含 Gallery 或 SystemPanel；后续里程碑仍可分别增加自己的查询字段。

## 5. 测试覆盖与结果

### 5.1 M4 精确聚焦命令

执行的命令为：

~~~powershell
npm test -w @surdet/renderer -- test/layers/menu-layer.test.ts test/legacy/legacy-menu-contract.test.ts test/pixi-stage.test.ts test/ui-views.test.ts test/integration/resource-cycles.test.ts test/integration/renderer-runtime.test.ts
~~~

结果：

~~~text
Test Files  6 passed (6)
Tests       56 passed (56)
~~~

其中：

- menu-layer.test.ts：15/15；
- legacy-menu-contract.test.ts：3/3；
- pixi-stage.test.ts：22/22；
- ui-views.test.ts：6/6；
- resource-cycles.test.ts：4/4；
- renderer-runtime.test.ts：6/6。

覆盖内容包括：

- 标题 enabled/disabled、callback error、重复 showTitle、explicit hide；
- 真实 MenuLayer + RendererFacade 的 settings background/close 顺序、恢复次数、异常传播和 query 状态；
- 真实 MenuLayer + RendererFacade 的 save/load 空槽位、有效槽位、save 槽位、close、异常路径和恢复次数；
- system menu select/close 异常时的本层清理；
- real PixiStage + RendererFacade fallback setActiveSpeaker('lynn') 和 null 各只触发一次 setPortraitFocus；
- legacy Stage 的 settings/save-load 回调包装与幂等清理；
- frontmost query 的标题底图、system/settings/save-load/ending 转移；
- query 返回副本且修改副本不污染运行时；
- save/load 缩略图池在 session 隐藏时保留 LRU、在 reset/dispose 时释放。

### 5.2 Renderer 全量、类型与构建

~~~powershell
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
~~~

结果：

~~~text
Renderer Test Files  38 passed (38)
Renderer Tests       267 passed (267)
Renderer typecheck   passed
Renderer build       passed
~~~

### 5.3 两批各 50 次 MenuLayer 资源循环

现有 MenuLayer 资源循环测试连续运行两批、每批 50 次，使用共享 RenderLifecycle 和 RenderAssetRegistry。每轮执行 title、ending、system menu、settings、save/load、动画推进、reset 和 dispose，并检查 root 不残留子节点；两批快照用结构化相等比较。

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

activeAsyncTasks: 1 是共享资产注册表的既有 runtime 级登记，在两批之间没有增长；菜单 owner 的 listener、tween、pool、display 均回到稳定点。缩略图专门测试还证明 reset 后 pooledObjects 为空。reset/dispose 重复调用保持幂等。

### 5.4 Layer 边界

~~~powershell
npm run verify:renderer-boundaries
~~~

结果：3/3 通过。MenuLayer 没有导入 DialogueLayer、GalleryLayer、SystemPanelLayer 或 WorldLayer；本轮没有引入任何跨 Layer import。

## 6. 根级门禁与正式游戏

执行：

~~~powershell
npm run verify:all
git diff --check
~~~

npm run verify:all 完整通过，实际完成了工具测试、Renderer boundary、能力矩阵、文档检查、仓库卫生、全 workspace typecheck、全 workspace test、starter 验收、正式项目验收和三个 workspace 构建。

工具/能力/卫生摘要：

- verify:tools：6/6 通过；
- verify:renderer-boundaries：3/3 通过；
- verify:hygiene --tracked：473 个已跟踪路径通过；
- 全 workspace typecheck：通过；
- 全 workspace test：通过；
- git diff --check：通过。

正式游戏 zero-after-midnight 摘要：

- lint：11 个场景，0 错误，0 警告；
- simulate：24 条探索路径；
- choice 分支覆盖：23/23；
- 结局：testimony_end、meeting_end、silence_end，共 3 个；
- 存档往返冒烟：39 次 save/load；
- 资产：44 项，检查通过；
- 运行时错误：0；
- formal build：通过。

构建日志中的既有 chunk-size warning 仍存在，但不是本次 M4 整改引入的错误，也没有被吞掉或通过提高阈值处理；它不影响本轮命令的成功判定，留在既有性能/发行优化范围内。

## 7. 最终 Git 状态与提交边界

源码提交完成后复核：

~~~text
HEAD: ca462f2668b0348f7f8bc33cf47ab911bee95979
git rev-list --left-right --count HEAD...surdet/main: 38 0
~~~

源码提交后工作树只有：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
~~~

报告提交完成后应保持同样的工作树状态；最终 HEAD...surdet/main 应为 39 0，因为本轮严格创建两个本地提交且远端不变。最终复核将在交付回报中再次给出实际值。

相对整改前 e93dca7 的源码差异统计为：

~~~text
5 files changed, 335 insertions(+), 27 deletions(-)
~~~

这 5 个文件就是本轮允许施工的源码与测试文件；第二个提交只增加本报告文档。

## 8. 明确停止条件

- M4 整改已完成；
- M5 未开始；
- 未实施 RendererFacade 之外的后续 Layer 抽取；
- 未进行消费者 cutover；
- 未修改 DSL、存档格式、游戏规则、编辑器行为、正式游戏代码或资产；
- 未 push、未 force push；
- 未清理工作树；
- 未提交或删除 USER.md、SESSION-HANDOFF.md；
- 未发现本次 M4 整改新增的剩余功能风险；既有 chunk-size warning 明确留在本轮范围之外。

请进行独立复审。复审通过前保持 WAITING_FOR_REVIEW，不进入 M5。
