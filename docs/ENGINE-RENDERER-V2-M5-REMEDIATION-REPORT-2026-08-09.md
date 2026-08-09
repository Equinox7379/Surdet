# Surdet Renderer v2 M5 独立复审整改报告

日期：2026-08-09
项目：`E:/surdet`
里程碑：M5 — GalleryLayer 关闭链路整改
当前状态：`WAITING_FOR_REVIEW`

## 1. 结论

M5 独立复审发现的唯一阻断问题已经在严格限定范围内修复，并完成了真实按钮交互回归、Renderer 全量门禁、根级 `verify:all` 和正式游戏验收。

本次问题不是 GalleryLayer 的本地清理错误，而是关闭回调离开 Layer 后没有经过正确的兼容接线：

~~~text
原本要求：GalleryLayer 本地 hide
             ↓
         恢复 command rail
             ↓
         宿主 onClose
~~~

修复后保持以下职责边界：

- GalleryLayer 只负责自己的显示对象、监听器、本地状态和关闭回调派发；
- v2 注入路径由 RendererFacade 包装 `onClose`，负责恢复 command rail、同步 Gallery 查询，再调用宿主回调；
- legacy PixiStage 路径由 PixiStage 包装 `onClose`，负责恢复 command rail，再调用宿主回调；
- legacy Facade fallback 只清除自己的 overlay 缓存并调用宿主回调，不重复恢复 command rail；
- 显式 `commands.gallery.hideGallery()` 的既有语义保持不变：隐藏 Gallery、恢复 command rail、同步查询，不调用宿主 `onClose`。

本轮未开始 M6、M7 或 M8；未修改 DSL、存档格式、游戏规则、键位、视觉文案、编辑器行为或正式游戏消费者接线；未 push、未 force push；未修改、暂存、提交或删除 `USER.md`、`SESSION-HANDOFF.md`。

## 2. 独立复审阻断问题

### 2.1 v2 注入路径

`RendererFacade.commands.gallery.showGallery()` 原先把宿主 `onClose` 原样传给 GalleryLayer。用户点击 Gallery 内部的“`✕ 关闭`”后，GalleryLayer 会完成本地 `hideGallery()`，但 Facade 没有机会恢复 Dialogue command rail，也没有显式同步自己的 overlay 状态。

### 2.2 legacy PixiStage 路径

`PixiStage.showGallery()` 原先也把宿主 `onClose` 原样传给 GalleryLayer。旧 API 的关闭组合语义要求 PixiStage 在 Gallery 本地隐藏后恢复 command rail；直接点击内部按钮时，这一层包装缺失。

### 2.3 legacy Facade fallback

没有注入 `GalleryProjectionPort` 时，RendererFacade 会维护 `#galleryOverlay` 兼容查询缓存。内部按钮关闭 Gallery 后，旧 Stage 会隐藏真实 Gallery，但原实现没有通知 Facade 清除缓存，因此：

~~~text
stage.galleryLayer.gallery()       = { type: "none" }
facade.queries.overlay.gallery()   = { type: "gallery", ... }
~~~

如果让 fallback Facade 也恢复 command rail，则会与 PixiStage 的兼容包装重复恢复。因此本次修复明确拆开两个动作：Stage 恢复操作带，Facade 只清缓存。

## 3. 测试先行与修复前失败证据

### 3.1 先增加真实交互回归测试

生产代码修改前，先在以下文件增加测试：

~~~text
packages/renderer/test/layers/gallery-layer.test.ts
packages/renderer/test/legacy/legacy-gallery-contract.test.ts
~~~

测试没有手工取出包装函数调用，而是：

- v2 路径使用真实 GalleryLayer、真实 `✕ 关闭` PText，并通过 `pointerdown` 触发；
- PixiStage legacy 路径使用真实 PixiStage、真实 GalleryLayer，并捕获其真实显示树中的关闭按钮进行点击；
- legacy Facade fallback 使用真实 PixiStage 作为 Stage 端口，并通过真实关闭按钮验证 Facade 查询缓存；
- 宿主回调异常路径通过真实按钮事件传播，不绕过 Layer。

### 3.2 修复前运行结果

在未修改生产代码的原始实现上运行：

~~~text
npm test -w @surdet/renderer -- test/layers/gallery-layer.test.ts test/legacy/legacy-gallery-contract.test.ts
~~~

结果：2 个文件、12 个测试，其中 6 个失败、6 个通过。

失败事实：

- v2 真实关闭（有宿主回调）：`restoreCommandRail` 实际 0 次，期望 1 次；
- v2 真实关闭（无宿主回调）：`restoreCommandRail` 实际 0 次，期望 1 次；
- v2 宿主回调抛错：Layer 已隐藏，但恢复操作带实际 0 次；
- PixiStage legacy 真实关闭：`restoreCommandRail` 实际 0 次，期望 1 次；
- PixiStage legacy 宿主回调抛错：异常传播前恢复操作带实际 0 次；
- legacy Facade fallback 真实关闭：真实 Stage 已为 `{ type: "none" }`，但 Facade 查询仍返回 Gallery 状态。

这组红测确认了复审报告中的两个可观察后果，并证明问题位于兼容接线而非 GalleryLayer 的本地关闭实现。

## 4. 最小生产修复

### 4.1 RendererFacade v2 包装

文件：`packages/renderer/src/runtime/renderer-facade.ts`

注入 `GalleryProjectionPort` 时，Facade 传入一个新的关闭包装器。GalleryLayer 的 `#closeGallery()` 先执行本地 `hideGallery()`，随后包装器按固定顺序执行：

~~~text
1. stage.restoreCommandRail()（如果旧 Stage 提供该兼容桥）
2. #syncGalleryOverlay()，使查询返回 { type: "none" }
3. 原始宿主 onClose()（如果提供）
~~~

包装器始终存在，所以没有宿主回调时点击关闭仍会恢复操作带；宿主回调抛出的原始异常不被吞掉，但异常发生前 Layer、command rail 和查询状态已经完成收口。没有在 GalleryLayer 中重新引入 World/Menu/Dialogue 专用回调。

### 4.2 PixiStage legacy 包装

文件：`packages/renderer/src/pixi-stage.ts`

`PixiStage.showGallery()` 现在用既有 `#restoreMenuRail()` 兼容包装器包住 Gallery `onClose`：

~~~text
GalleryLayer.hideGallery()
    ↓
PixiStage.restoreCommandRail()
    ↓
原始宿主 onClose()
~~~

即便宿主没有提供 `onClose`，也会传入一个空回调包装器，因此真实按钮关闭仍会恢复操作带。异常宿主回调仍按旧合同传播，不会阻止前置清理。

### 4.3 legacy Facade fallback 包装

没有 GalleryProjectionPort 时，RendererFacade 传给旧 Stage 的是另一个只做兼容缓存收口的包装器：

~~~text
PixiStage 包装器：restoreCommandRail()
    ↓
Facade fallback 包装器：#galleryOverlay = { type: "none" }
    ↓
原始宿主 onClose()
~~~

Facade fallback 不再调用 `restoreCommandRail()`，因此真实 legacy 点击路径只恢复一次操作带。显式 `commands.gallery.hideGallery()` 没有使用宿主回调，仍保持原实现的单次恢复和查询清除行为。

### 4.4 未修改 GalleryLayer

`packages/renderer/src/layers/gallery/gallery-layer.ts` 没有修改。其本地关闭边界原本就是正确的：捕获回调、清除自身显示对象与监听器、设置隐藏状态，再传播回调。本轮没有将跨层协调重新塞进 Layer。

## 5. 回归覆盖与结果

### 5.1 真实 v2 Gallery 关闭

覆盖文件：`packages/renderer/test/layers/gallery-layer.test.ts`

- 有宿主回调：Layer 关闭、恢复 command rail 恰好 1 次、宿主回调恰好 1 次、查询为 `{ type: "none"}`；
- 顺序断言：`restore-rail` 先于 `host-close`；两处都能观察到 Gallery 已经关闭；
- 无宿主回调：真实按钮点击不抛错，操作带恢复恰好 1 次，查询为 none；
- 宿主回调抛错：原始异常继续抛出，Layer 已关闭、操作带恢复恰好 1 次、查询为 none、监听器为 0；清理后可再次显示和关闭。

### 5.2 真实 PixiStage legacy 关闭

覆盖文件：`packages/renderer/test/legacy/legacy-gallery-contract.test.ts`

- 真实 Stage 的真实关闭按钮点击后，`stage.galleryLayer.gallery()` 为 `{ type: "none"}`；
- `stage.restoreCommandRail()` 恰好调用 1 次；
- 宿主 `onClose` 恰好调用 1 次；
- 宿主回调抛错时，Gallery 仍已隐藏、操作带已恢复 1 次、监听器为 0，原始错误继续传播。

### 5.3 legacy Facade fallback 关闭

- 使用真实 PixiStage，不注入 `galleryLayer`；
- 关闭按钮点击后 `stage.galleryLayer.gallery()` 和 `facade.queries.overlay.gallery()` 都为 `{ type: "none"}`；
- Stage 恢复操作带恰好 1 次；
- 宿主回调恰好 1 次；
- Facade 没有重复恢复 command rail。

### 5.4 资源循环与完整 Renderer 结果

Gallery 两批各 50 次资源循环继续通过，两批快照完全相等，稳定点为：

~~~text
listeners = 0
activeTweens = 0
displayObjectsByOwner.gallery = 0
~~~

本次整改后 Renderer 全量测试为 40 个文件、282/282 通过。新增 6 条复审回归路径后，测试总数相较 M5 初始报告中的 276/276 增加到 282/282；没有删除或跳过既有测试。

## 6. 门禁与正式游戏验收

### 6.1 M5 聚焦门禁

执行：

~~~text
npm test -w @surdet/renderer -- test/layers/gallery-layer.test.ts test/legacy/legacy-gallery-contract.test.ts test/gallery.test.ts test/integration/resource-cycles.test.ts
~~~

结果：4 个文件、21/21 通过：

- `gallery-layer.test.ts`：8/8；
- `legacy-gallery-contract.test.ts`：4/4；
- `gallery.test.ts`：5/5；
- `resource-cycles.test.ts`：4/4。

### 6.2 Renderer 门禁

~~~text
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
npm run verify:renderer-boundaries
git diff --check
~~~

结果：

- Renderer 全量：40 个文件、282/282；
- Renderer typecheck：通过；
- Renderer build：通过；
- Renderer boundary：3/3 通过；
- `git diff --check`：通过；
- 两批 Gallery 50 次资源循环：通过，快照相等且稳定点为 0/0/0。

### 6.3 根级门禁

~~~text
npm run verify:all
~~~

结果：通过。内含项目既有门禁结果：

- 工具测试：6/6；
- Renderer boundary：3/3；
- 文档能力矩阵：通过；
- 跟踪文件仓库卫生检查：478 个路径通过；
- 全 workspace typecheck：通过；
- 全 workspace 测试：通过；
- 正式项目 lint、simulate、资产检查和构建：通过。

Vite 构建输出中的大 chunk 提示仍是既有非阻断警告，本轮没有调高阈值、删除字段或吞掉错误。

### 6.4 《零点之后》正式验收

根级 `verify:all` 内的正式游戏验证继续通过：

- lint：11 个场景、0 个错误、0 个警告；
- choice 分支覆盖：23/23；
- 可达结局：3 个（`testimony_end`、`meeting_end`、`silence_end`）；
- 存档往返冒烟：39 次 save/load；
- 资产检查：44 项；
- 运行时错误：0；
- `zero-after-midnight` typecheck：通过；
- `zero-after-midnight` build：通过。

本轮没有修改正式游戏代码、资产清单或规则配置。

## 7. 提交、状态与范围审计

### 7.1 整改提交

~~~text
4e7013abef665d71441fafe18bdcf2986c58bb56
fix(renderer): restore gallery close coordination
~~~

该源码/测试提交精确包含 4 个路径：

~~~text
packages/renderer/src/pixi-stage.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/layers/gallery-layer.test.ts
packages/renderer/test/legacy/legacy-gallery-contract.test.ts
~~~

没有暂存或提交任何用户文件、日志、截图、缓存或生成目录。

### 7.2 整改提交后的 Git 复核

源码/测试提交完成后复核结果：

~~~text
HEAD: 4e7013abef665d71441fafe18bdcf2986c58bb56
git rev-list --left-right --count HEAD...surdet/main: 43 0
git status --short:
?? SESSION-HANDOFF.md
?? USER.md
~~~

`USER.md` 和 `SESSION-HANDOFF.md` 是既有用户未跟踪文件，本轮未读取后写回、未改动、未暂存、未提交、未删除。当前没有其他工作树修改。

本整改提交没有 push；远端状态保持未推送。

## 8. 停止点

本次 M5 阻断整改已经完成，但不代表 M6 获得授权。当前严格停止在：

- `WAITING_FOR_REVIEW`；
- M6 未开始；
- 不 push；
- 不 force push；
- 不提交 `USER.md`、`SESSION-HANDOFF.md`；
- 等待独立复审及后续明确授权。

报告文件：`E:/surdet/docs/ENGINE-RENDERER-V2-M5-REMEDIATION-REPORT-2026-08-09.md`
