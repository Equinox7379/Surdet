# Surdet Renderer v2 M5 交付报告

日期：2026-08-09
项目：E:/surdet
里程碑：M5 — Task 15: Freeze and extract GalleryLayer
当前状态：WAITING_FOR_REVIEW

## 1. 结论

M5 已严格按照 docs/superpowers/plans/2026-08-09-renderer-v2-layers-m3-m7.md 的 Task 15 完成。CG、音乐、文本回想三个 Gallery 视图的显示对象、局部状态、监听器、Viewer 状态和回调已经从 PixiStage 的实现主体迁移到独立的 GalleryLayer。

正式 v2 Runtime 通过公开 GalleryProjectionPort 注入 RendererFacade。Facade 负责 Gallery 与 Menu、Dialogue 之间的跨层显示/隐藏协调；旧 PixiStage.showGallery() / hideGallery() 保留为兼容包装器，并只委托给 GalleryLayer，没有保留第二份 Gallery 绘制实现。

本轮没有修改 DSL、存档格式、游戏规则、键位、视觉文案、编辑器行为或正式游戏消费者接线；没有开始 M6 SystemPanelLayer、M7 WorldLayer 或 M8 cutover；没有 push、force push 或清理工作树。USER.md 与 SESSION-HANDOFF.md 始终未修改、未暂存、未提交、未删除。

本报告提交后停止在 WAITING_FOR_REVIEW，等待独立复审及“批准进入 M6”。

## 2. 基线、提交与严格范围

### 2.1 M5 开工基线

- M4 已批准 HEAD：74d2a94f41dcb36bf976fd61aa34d1df91e8bdbc。
- 分支：main。
- M5 开工时 git rev-list --left-right --count HEAD...surdet/main：39 0。
- M5 开工时工作树除本轮目标外仅有未跟踪的：

~~~
?? SESSION-HANDOFF.md
?? USER.md
~~~

- M5 全程未 push、未 force push。

### 2.2 M5 前置 M4 非阻断护栏

在启动 Gallery 生产迁移前，先只新增并验证三条 M4 测试护栏，没有改动 M4 产品实现：

- 设置面板真实 × 关闭：确认 MenuLayer 本地清理、command rail 恢复一次、宿主 onClose 调用一次，底层标题仍可见；
- 存档/读档真实 × 关闭：确认关闭、恢复和宿主 onClose 各执行一次；
- 存档/读档 onClose 抛错：确认先完成 Layer 清理和 command rail 恢复，再传播原始异常，且底层标题和监听器状态不退化。

前置护栏提交：

~~~
0fcc29db8dae91be5bbd594498e6c5e075a5b6b7
test(renderer): add menu close guardrails
~~~

验证命令及结果：

~~~
npm test -w @surdet/renderer -- test/layers/menu-layer.test.ts test/legacy/legacy-menu-contract.test.ts
~~~

结果：2 个文件、21/21 通过（MenuLayer 18/18，legacy menu 3/3）。该提交只包含：

~~~
packages/renderer/test/layers/menu-layer.test.ts
~~~

### 2.3 M5 源码与测试提交

~~~
f83f2f1b99ce5cbae158e81852f5e66c34b669b5
refactor(renderer): extract gallery layer
~~~

提交父节点为前置护栏提交 0fcc29db8dae91be5bbd594498e6c5e075a5b6b7。M5 源码/测试提交精确包含以下 12 个路径：

~~~
packages/renderer/src/adv-renderer.ts
packages/renderer/src/api/renderer-commands.ts
packages/renderer/src/api/renderer-queries.ts
packages/renderer/src/index.ts
packages/renderer/src/layers/gallery/gallery-layer.ts
packages/renderer/src/pixi-stage.ts
packages/renderer/src/runtime/create-renderer-runtime.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/api/query-purity.test.ts
packages/renderer/test/api/renderer-contract.test.ts
packages/renderer/test/layers/gallery-layer.test.ts
packages/renderer/test/legacy/legacy-gallery-contract.test.ts
~~~

### 2.4 明确未开始或未改变

以下内容不属于本次施工：

- M6 SystemPanelLayer；
- M7 WorldLayer；
- M8 正式消费者迁移、legacy 收口、最终 cutover；
- DSL、存档格式、游戏规则、键位、视觉文案和编辑器行为；
- Core Gallery 解锁规则、存档读写和文本回想场景跳转逻辑；
- 与 Gallery 迁移无直接关系的重构或玩家功能；
- USER.md、SESSION-HANDOFF.md 的任何修改、暂存或提交；
- 远端 push、force push、工作树清理。

## 3. 合同冻结与实现交付

### 3.1 GalleryLayer 的所有权

新增：

~~~
packages/renderer/src/layers/gallery/gallery-layer.ts
~~~

GalleryLayer 实现 GalleryProjectionPort，即 Gallery 命令加上无副作用的 gallery() 查询。它只接收已经由调用者准备好的 GalleryItemView 数组和回调，不导入 Core Gallery 状态，不持有解锁规则、存档、Interpreter、Host adapter 或场景跳转逻辑。

Task 15 规定的字段族全部由 GalleryLayer 单独拥有：

~~~
galleryLayer
galleryTab
galleryMode
galleryViews
galleryOnPlayMusic
galleryOnReplayText
galleryOnClose
galleryViewerKey
~~~

GalleryLayer 负责：

- CG、音乐、文本三个 Tab 的本地投影；
- locked/unlocked ViewModel 的显示差异；
- CG grid 与 full-screen viewer 的切换和返回；
- 已解锁音乐的 onPlayMusic(id, source) 派发；
- 已解锁文本回想的 onReplayText(item) 派发；
- Gallery 关闭和异常回调传播；
- 重复 showGallery() 时清理旧监听器、旧子节点和旧状态；
- 空列表提示、hideGallery()、reset()、dispose() 的幂等行为；
- 共享 RenderAssetRegistry 的背景纹理解析/占位纹理获取；
- owner=gallery 的 display/listener 登记与释放。

GalleryLayer 没有导入任何其他 Renderer Layer。Renderer boundary 门禁实际通过。

### 3.2 查询合同

新增安全查询类型：

~~~
export type GalleryOverlayState =
  | { type: 'none' }
  | {
      type: 'gallery';
      tab: 'cg' | 'music' | 'text';
      mode: 'grid' | 'viewer';
      viewerKey: string | null;
    };
~~~

OverlayQueries.gallery() 只返回上述值对象，绝不返回 Container、Sprite、Texture 或其他 Pixi 对象。查询不创建显示对象、不注册资源、不请求帧、不修改可见状态。API 类型测试和 query-purity 测试均已覆盖该查询。

### 3.3 RendererFacade v2 接线

RendererFacadeOptions 和 Runtime composition root 新增 galleryLayer?: GalleryProjectionPort。正式 createRendererRuntime() 现在把 stage.galleryLayer 注入 Facade。

注入 GalleryProjectionPort 时：

- commands.gallery.showGallery() 由 Facade 先关闭 Menu 的 settings/save-load、关闭 Dialogue command rail，再调用 Gallery port 一次；
- commands.gallery.hideGallery() 调用 Gallery port 一次，并恢复旧的 command rail 兼容桥；
- Menu 的结局、设置、存读档显示路径隐藏 Gallery 时只调用 Gallery port 的隐藏意图，不让 GalleryLayer 直接引用其他 Layer；
- Facade 的 OverlayQueries.gallery() 读取 GalleryLayer 的安全查询副本；
- stage.showGallery() 不会在正式 v2 路径再次执行，因此没有第二份 Gallery 绘制或重复跨层接线。

未注入 GalleryProjectionPort 时，Facade 继续调用旧 Stage showGallery() / hideGallery()，并维护 legacy 的安全 Gallery 查询状态，保持一个版本兼容窗口。

### 3.4 PixiStage legacy 兼容委托

PixiStage 保留原构造方式与旧公开 Gallery API，但现在只负责：

- 保留旧 API 的 settings/save-load/command rail 协调顺序；
- 把 Gallery 的实际显示调用委托给 GalleryLayer；
- 在 resetSession() 中转发 Gallery reset；
- 在 destroy() 中转发 Gallery dispose。

旧的 Gallery 私有字段、旧 rebuildGallery() 和旧 buildGalleryViewer() 已从 PixiStage 删除。旧实现主体没有复制到 Facade 或保留在 Stage 中。

## 4. 测试与行为覆盖

### 4.1 M5 直接合同测试

新增：

~~~
packages/renderer/test/layers/gallery-layer.test.ts
~~~

覆盖 5 个测试：

1. CG/music/text 三个 Tab、locked/unlocked 视图模型、播放与回想回调、关闭回调；
2. CG viewer 打开/返回，以及查询不暴露 Pixi 显示对象；
3. 空列表、重复 show/hide/reset、关闭回调异常传播和清理顺序；
4. RendererFacade 注入实际 GalleryLayer 时的 v2 跨层协调和 Gallery 查询；
5. 两批各 50 次 Gallery 生命周期循环。

测试使用已经准备好的 GalleryItemView，没有在 Layer 中构造 Core Gallery 状态，也没有让回调异常破坏 Layer 的本地清理边界。

### 4.2 Legacy 兼容测试

新增：

~~~
packages/renderer/test/legacy/legacy-gallery-contract.test.ts
~~~

验证真实 PixiStage 的 legacy showGallery() / hideGallery() 只通过 stage.galleryLayer 委托一次，保留旧查询状态，并在 reset 后保持空状态；没有因为迁移而让旧 API 失效。

### 4.3 两批各 50 次资源循环

gallery-layer.test.ts 使用共享 RenderLifecycle 和 RenderAssetRegistry，执行两个独立批次、每批 50 次的 mount → show → hide → reset → dispose 循环。每次循环都验证 root Container 没有残留子节点。

两批稳定点完全相等，并满足 M5 要求：

~~~
listeners = 0
activeTweens = 0
displayObjectsByOwner.gallery = 0
~~~

gallery owner 的 display 根节点在 layer dispose 时释放，Gallery listener 在 hide/reset/dispose 时释放；第二批没有继续增长。共享 AssetRegistry 的 runtime 级异步登记属于 registry 自身，不计为 GalleryLayer listener/display 泄漏。

### 4.4 查询与确定性

Gallery 查询只返回安全值：

| 状态 | 查询结果 |
| --- | --- |
| 未显示或已隐藏 | { type: "none" } |
| CG 列表 | { type: "gallery", tab: "cg", mode: "grid", viewerKey: null } |
| 音乐列表 | tab: "music", mode: "grid", viewerKey: null |
| 文本列表 | tab: "text", mode: "grid", viewerKey: null |
| CG 全屏回看 | tab: "cg", mode: "viewer", viewerKey: "<asset-key>" |
| viewer 返回列表 | tab: "cg", mode: "grid", viewerKey: null |

每次调用返回独立安全值，不允许调用者反向修改 Layer 内部状态。

## 5. 门禁与正式项目验收

### 5.1 M5 聚焦门禁

执行：

~~~
npm test -w @surdet/renderer -- test/layers/gallery-layer.test.ts test/legacy/legacy-gallery-contract.test.ts test/gallery.test.ts test/integration/resource-cycles.test.ts
~~~

结果：4 个测试文件、15/15 通过：

- gallery-layer.test.ts：5/5；
- legacy-gallery-contract.test.ts：1/1；
- gallery.test.ts：5/5；
- resource-cycles.test.ts：4/4。

### 5.2 Renderer 全量门禁

执行：

~~~
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
~~~

结果：

- Renderer：40 个测试文件、276/276 通过；
- Renderer typecheck：通过；
- Renderer build：通过。

### 5.3 Layer 边界与根级门禁

执行：

~~~
npm run verify:renderer-boundaries
npm run verify:all
git diff --check
~~~

结果：

- Renderer boundary：3/3 通过；
- npm run verify:all：通过；
- 工具测试：6/6 通过；
- 文档能力矩阵检查：通过；
- 跟踪文件仓库卫生检查：474 个路径通过；
- 全 workspace typecheck：通过；
- 全 workspace 测试：通过；
- git diff --check：通过。

全量门禁输出中的 Vite 大 chunk 提示属于已有构建警告，未被本轮调宽或吞掉；命令退出成功，正式样例构建完成。

### 5.4 正式游戏验收

《零点之后》正式样例的既定验收继续通过：

- lint：11 个场景、0 个错误、0 个警告；
- 选择分支覆盖：23/23；
- 可达结局：3 个（testimony_end、meeting_end、silence_end）；
- 资产检查：44 项；
- 存档往返冒烟：39 次 save/load；
- 运行时错误：0；
- zero-after-midnight typecheck：通过；
- zero-after-midnight build：通过。

本轮未修改正式游戏 src/main.ts 或任何游戏规则/资产配置；验收证明 Gallery 迁移没有破坏正式项目的现有行为。

## 6. 最终 Git 状态

M5 源码提交完成后的当前 HEAD 为：

~~~
f83f2f1b99ce5cbae158e81852f5e66c34b669b5
~~~

提交前最后一次状态核对：

~~~
git rev-list --left-right --count HEAD...surdet/main
41 0
~~~

当前工作树只保留两个明确排除的未跟踪文件：

~~~
?? SESSION-HANDOFF.md
?? USER.md
~~~

没有暂存文件，没有未提交的 M5 源码/测试修改，没有日志、截图、缓存或生成目录进入提交。

## 7. 停止点

M5 已完成并提交本地源码/测试变更及本交付报告；当前必须保持：

- WAITING_FOR_REVIEW；
- M6 未开始；
- 不 push；
- 不 force push；
- 不提交 USER.md、SESSION-HANDOFF.md；
- 等待独立复审和下一轮授权。
