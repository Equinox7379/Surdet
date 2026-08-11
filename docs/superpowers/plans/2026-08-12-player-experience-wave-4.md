# Surdet Player Experience Wave 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复用户在真实《零点之后》Electron 实机中确认的六项体验缺陷，并把修复落实到 Renderer、Host、Core 与项目模板公共契约，而不是只给单个游戏打补丁。

**Architecture:** Renderer 负责 Gallery 命中、稳定命令栏和裁剪 Backlog；Host 负责连续回退、Presentation 组合接线与进入标题会话；Core 为 Presentation restore 增加无副作用预验证入口。Starter、《零点之后》和 CLI 模板只采用公共接口。所有生产修改先由基线红灯证明，再用单元、集成和真实 Electron 鼠标矩阵验收。

**Tech Stack:** TypeScript 5.7、Vitest 3、PixiJS、Electron 43、Playwright、Node.js 20+、npm workspaces。

## Global Constraints

- 权威设计：`docs/superpowers/specs/2026-08-12-player-experience-wave-4-design.md`。
- 开工基线必须包含设计提交 `502a4d55caefe1c6df2919733035221271783652` 和本计划提交；不得 reset、rebase、amend 或丢弃这两个文档提交。
- 本 Wave 只处理 G1–G6；D7 的 F11 全屏已通过，不修改 1280×720 contain、不得横向拉伸、cover 裁切或劫持最大化按钮。
- 通用行为优先落在 `packages/renderer`、`packages/host`、必要的 `packages/core`；游戏侧只做公共 API 接线和内容回调。
- 不进入 M9、性能、资产、头像、gallery 内容本地化、音频、文档治理、正式发行或 EXE 打包。
- 不修改性能 artifact、比较器、样本或门限。
- 禁止 force push、force-with-lease、rebase、reset、amend、squash、cherry-pick 和历史改写。
- 完成后不得 push；必须停在 `WAITING_FOR_REVIEW`。
- 不触碰四个受保护未跟踪文件：`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`。
- 不删除用户存档、Profile、设置、历史报告或非本轮 worktree。
- 每个任务先红后绿；无法复现红灯时停止该任务并保存证据，不得猜修。
- 不把 debug command 当真实玩家点击；debug query 只可用于断言真实输入后的状态。
- 每完成一个任务，更新本文对应 checkbox、实际命令、结果和提交 SHA；文档事实必须来自真实终端。

---

## Task 0: 基线、保护边界与红灯台账

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-player-experience-wave-4.md`
- Create at final task only: `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-4-DELIVERY-REPORT-2026-08-12.md`

**Interfaces:**
- Consumes: Git HEAD、`surdet/main`、现有 Wave 2/3 E2E 脚本与四个受保护文件。
- Produces: 冻结的开工基线、测试命令和红灯证据台账。

- [x] **Step 1: 核对 HEAD、远端和工作树**

Run:

```powershell
git rev-parse HEAD
git log -3 --oneline
git rev-list --left-right --count HEAD...surdet/main
git status --short
git worktree list --porcelain
```

Expected:

- HEAD 包含设计与计划两个本地文档提交；
- 相对远端只领先文档提交，不落后；
- 工作树只包含四个受保护未跟踪文件；
- 不存在其他执行 AI worktree。

若不符合，停止并报告，不执行 pull/reset/clean。

- [x] **Step 2: 记录工具链与基线门禁**

Run:

```powershell
node --version
npm --version
npm run verify:all
git diff --check
git ls-files '*.log'
```

Expected: Node ≥20，`verify:all` exit 0，diff-check 通过，tracked log 为空。

- [x] **Step 3: 建立红灯证据格式**

在本文 Task 1–7 的执行记录中，每项必须写：

```text
RED_COMMAND=<真实命令>
RED_EXIT=<非零退出码或失败测试数>
RED_FAILURE=<与用户现象一致的断言>
GREEN_COMMAND=<真实命令>
GREEN_RESULT=<测试数与退出码>
COMMIT=<普通提交 SHA>
```

不得创建或跟踪 `.log`；大型 Electron artifact 写入自动生成的临时目录，并在最终报告记录绝对路径、字节数和 SHA-256。

- [x] **Step 4: 不提交纯基线操作**

Task 0 不产生源码提交。只在本文中勾选并记录事实，随最终计划台账提交。

---

## Task 1: 标题来源 Gallery 真实鼠标标签切换

**Files:**
- Modify: `packages/renderer/src/layers/gallery/gallery-layer.ts`
- Modify: `packages/renderer/test/layers/gallery-layer.test.ts`
- Modify: `packages/host/test/renderer-player-shell-slots.test.ts`
- Create: `packages/shell/e2e/player-experience-wave-4.e2e.mjs`
- Create: `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts`
- Modify: `packages/shell/package.json`

**Interfaces:**
- Consumes: `GalleryLayer.showGallery()`、`createRendererPlayerShellSlots()`、`PlayerShellOpenRequest { slot:'gallery', source:'title'|'game' }`。
- Produces: 标题和游戏来源一致的 CG/music/text/close 真实点击契约；Wave 4 E2E runner 的 `--smoke`、`--case` 与 artifact schema。

- [x] **Step 1: 先建立 Wave 4 E2E runner 骨架**

新脚本必须复用 Wave 2/3 的正式 Zero dist、独立 Electron、独立 `userData`、错误收集和安全清理模式。支持：

```text
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --smoke
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A
node packages/shell/e2e/player-experience-wave-4.e2e.mjs
```

Artifact 顶层至少为：

```ts
interface Wave4Artifact {
  schemaVersion: 1;
  status: 'PASSED' | 'FAILED';
  head: string;
  sourceRoot: string;
  distRoot: string;
  cases: readonly {
    id: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J';
    ok: boolean;
    events: {
      pageErrors: readonly string[];
      consoleErrors: readonly string[];
      requestFailures: readonly string[];
      unhandledRejections: readonly string[];
      rendererErrors: readonly unknown[];
      releaseFailures: readonly unknown[];
    };
    assertions: Readonly<Record<string, unknown>>;
  }[];
}
```

每个 case 创建独立 Electron 和独立临时 `userData`。脚本退出前写 JSON，即使 case 失败也保存已收集证据。

在 `packages/shell/package.json` 添加：

```json
"e2e:player-experience:wave4": "node e2e/player-experience-wave-4.e2e.mjs"
```

- [x] **Step 2: 写 E2E 契约测试**

`player-experience-wave-4-e2e-contract.test.ts` 静态读取脚本并断言：

- 明确构建 `zero-after-midnight`；
- 明确使用 `examples/zero-after-midnight/dist`；
- 不包含 `examples/starter/dist` 作为游戏入口；
- 支持 `--smoke`、`--case`；
- 每 case 独立 `userData`；
- 收集六类错误数组；
- A/B 使用 Playwright `page.mouse.click()` 或 locator click，而不是调用 `titleSelect()`、Gallery commands。

Run:

```powershell
npm run test -w @surdet/shell -- --run player-experience-wave-4-e2e-contract.test.ts
```

Expected: PASS（这是 harness 契约，不是产品绿灯）。

- [x] **Step 3: 写 Gallery 单元和 Host 集成红灯**

覆盖：

```ts
it.each(['title', 'game'] as const)('keeps gallery tabs clickable from %s source after rebuild', (source) => {
  // 打开 Gallery，真实派发 music/text/cg pointerdown；
  // 每次断言 overlay.tab；关闭后断言回到 source。
});
```

必须至少包含一次内容 rebuild 后再次点击 header。锁定条目不能影响 tab 点击。

Run:

```powershell
npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts
npm run test -w @surdet/host -- --run test/renderer-player-shell-slots.test.ts
```

记录真实红灯；若单元测试已绿，仍继续 Step 4 的真实 Electron 红灯，不能宣称问题不存在。

- [x] **Step 4: 复现 Case A 红灯**

Case A：标题可见 → 真实鼠标点击“鉴赏” → 点击“音乐” → 断言 tab=music → 点击“文本” → tab=text → 点击 CG → tab=cg → 关闭 → 回到纯标题。

Run:

```powershell
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A
```

Expected before fix: 非零退出，失败点与标题来源标签无反应一致。保存 artifact 路径和 SHA。

- [x] **Step 5: 最小修复 Gallery 命中生命周期**

只根据红灯定位修改 `gallery-layer.ts`。必须保持：

- header/hitArea 在内容 rebuild 后仍挂载且可交互；
- `#clearContent()` 只释放内容 listeners，不移除 header 子节点 listeners；
- Gallery `#bringToFront()` 后隐藏 Menu/Title 不能成为命中目标；
- `pointerdown` 只切一次 tab并请求一帧；
- close 回调只执行一次。

不得针对 `source==='title'` 复制一套 Gallery UI。

- [x] **Step 6: 运行绿灯**

```powershell
npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts
npm run test -w @surdet/host -- --run test/renderer-player-shell-slots.test.ts
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A
```

Expected: 全部 PASS；Case A 六类 unexpected 错误为空。

- [x] **Step 7: 提交 Task 1**

```powershell
git add packages/renderer/src/layers/gallery/gallery-layer.ts packages/renderer/test/layers/gallery-layer.test.ts packages/host/test/renderer-player-shell-slots.test.ts packages/shell/e2e/player-experience-wave-4.e2e.mjs packages/shell/test/player-experience-wave-4-e2e-contract.test.ts packages/shell/package.json
git diff --cached --check
git commit -m "fix(player): restore title gallery tab input"
```

---

## Task 2: 命令栏整体视觉稳定

**Files:**
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Create: `packages/renderer/test/layers/dialogue-layer.test.ts`
- Modify: `packages/renderer/test/integration/resource-cycles.test.ts`

**Interfaces:**
- Consumes: `DialogueLayer.setCommandRailItems()`、hover pointer events、`needsUpdate()`。
- Produces: 固定 root alpha；仅按钮局部 hover；不再登记 `dialogue/tween/command-rail`。

- [x] **Step 1: 写红灯**

新测试至少断言：

```ts
expect(snapshot.commandRailAlpha).toBe(1);
layer.update(5000);
expect(snapshotAfterWait.commandRailAlpha).toBe(1);
expect(needsUpdateAfterSettled).toBe(false);
```

连续 20 次 `setCommandRailItems()` 后 root alpha 不变；pointerover 只改变目标按钮 label/underline；pointerout 恢复 active/disabled 样式。资源台账中不得存在活动 `dialogue/tween/command-rail`。

如现有 debug snapshot 不含 alpha，可在 `DialogueLayerDebugSnapshot` 增加只读数字字段；不得暴露真实 Pixi 对象。

Run:

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/integration/resource-cycles.test.ts
```

Expected before fix: alpha 衰减或 tween 活动断言失败。

- [x] **Step 2: 删除整体 wake/fade 状态机**

从 `DialogueLayer` 移除仅服务整体淡入淡出的：

```ts
#commandRailWakeRemain
#commandRailIdleAlpha
#commandRailPointerWake
#wakeCommandRail()
```

以及对应 update/needsUpdate/tween lifecycle 逻辑。命令栏容器 root alpha 固定为 `1`；背景 Graphics 已自带 `0.82` alpha，保持其视觉强度。

`setCommandRailItems()` 允许 rebuild，但不得唤醒整条 rail。hover 继续只修改当前 row 的 label 与 underline。

- [x] **Step 3: 运行绿灯与回归**

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/integration/resource-cycles.test.ts test/theme.test.ts
npm run typecheck -w @surdet/renderer
```

Expected: PASS；稳定 rail 不制造帧循环或资源活动项。

- [x] **Step 4: 提交 Task 2**

```powershell
git add packages/renderer/src/layers/dialogue/dialogue-layer.ts packages/renderer/test/layers/dialogue-layer.test.ts packages/renderer/test/integration/resource-cycles.test.ts
git diff --cached --check
git commit -m "fix(renderer): stabilize command rail visuals"
```

---

## Task 3: Backlog 固定 header 与正文裁剪

**Files:**
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/test/layers/dialogue-layer.test.ts`
- Modify: `packages/renderer/test/backlog-search-controller.test.ts`

**Interfaces:**
- Consumes: `showBacklog(entries,onReplayVoice,query)`、`scrollBacklog(delta)`。
- Produces: 固定 header、可选搜索状态、masked entries viewport、clamped scroll。

- [x] **Step 1: 写布局红灯**

加入短列表、120 条长列表、中文/emoji、多行、query 为空和非空场景。测试用只读布局快照断言：

```ts
interface BacklogLayoutSnapshot {
  headerY: number;
  viewportTop: number;
  viewportBottom: number;
  scroll: number;
  contentHeight: number;
  hasMask: boolean;
  searchVisible: boolean;
  idleSearchHintVisible: boolean;
}
```

要求 `idleSearchHintVisible=false`、`hasMask=true`、`viewportTop > headerY`，滚动前后 headerY 不变，正文可见 bounds 不越过 viewport。

Run:

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/backlog-search-controller.test.ts
```

Expected before fix: 常驻 Ctrl+F、无 mask、正文越过 header 断言失败。

- [x] **Step 2: 实现明确布局常量和 mask**

在 `DialogueLayer` 内使用明确布局：

```ts
const BACKLOG_HEADER_Y = 30;
const BACKLOG_SEARCH_Y = 58;
const BACKLOG_VIEWPORT_TOP_IDLE = 76;
const BACKLOG_VIEWPORT_TOP_SEARCH = 92;
const BACKLOG_VIEWPORT_BOTTOM_INSET = 36;
```

query 为空时不创建“Ctrl+F 搜索”节点；query 非空时只显示 `搜索：${query}`。创建独立 entries container 和 Graphics mask：

```ts
const viewportTop = query.trim() ? BACKLOG_VIEWPORT_TOP_SEARCH : BACKLOG_VIEWPORT_TOP_IDLE;
const viewportHeight = this.#h - viewportTop - BACKLOG_VIEWPORT_BOTTOM_INSET;
const mask = new Graphics().rect(0, viewportTop, this.#w, viewportHeight).fill(0xffffff);
entriesLayer.mask = mask;
layer.addChild(entriesLayer, mask);
```

正文节点 y 从 `viewportTop` 起算；`maxScroll = max(0, contentHeight - viewportHeight)`。关闭/重建时同时销毁 mask，不能泄漏 Graphics。

- [x] **Step 3: 运行绿灯和 Case C**

在 Wave 4 runner 实现 Case C：构造足量 Backlog，真实滚轮/PageDown，截图前后读取布局投影，断言 header 固定、正文裁剪、点击关闭不推进剧情。

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/backlog-search-controller.test.ts
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case C
```

- [x] **Step 4: 提交 Task 3**

```powershell
git add packages/renderer/src/layers/dialogue/dialogue-layer.ts packages/renderer/test/layers/dialogue-layer.test.ts packages/renderer/test/backlog-search-controller.test.ts packages/shell/e2e/player-experience-wave-4.e2e.mjs
git diff --cached --check
git commit -m "fix(renderer): clip backlog beneath fixed header"
```

---

## Task 4: 连续回退迁入 Host 公共层

**Files:**
- Create: `packages/host/src/rollback-runtime.ts`
- Create: `packages/host/test/rollback-runtime.test.ts`
- Modify: `packages/host/src/index.ts`
- Modify: `examples/shared/rollback-runtime.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `examples/starter/test/rollback-runtime.test.ts`
- Modify: `examples/zero-after-midnight/test/player-ui-integration.test.ts`

**Interfaces:**
- Consumes: Core `Interpreter`、Renderer presentation/audio public ports、Host system boundary callback。
- Produces: `createRollbackRuntime()` 公共 Host API；`clearForBoundary()` 在 rollback restore 期间不清历史；旧示例入口一版兼容。

- [ ] **Step 1: 写能复现真实根因的红灯**

红灯必须模拟真实链：

```text
perform rollback
→ interpreter.loadSnapshot
→ stateReset
→ host.reset
→ onSystemBoundary
→ clear rollback history
```

测试推进 10 帧后连续 `perform()` 五次，预期 key 依次回到 9、8、7、6、5；基线应在第一次后因 history 被清空而失败。

Run:

```powershell
npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts
```

- [x] **Step 2: 创建 Host 权威实现**

导出接口保持现有能力并增加边界专用命令：

```ts
export interface RollbackRuntime {
  clear(): void;
  clearForBoundary(): void;
  canRollback(): boolean;
  perform(): boolean;
  captureText(): void;
  isRestoring(): boolean;
}
```

语义：

```ts
const clearForBoundary = (): void => {
  if (restoring) return;
  clear();
};
```

`perform()` 的 `restoring=true` 必须覆盖 `resetSession()`、`loadSnapshot()`、Presentation restore 和 audio restore 全过程，finally 才恢复 false。异常时把目标 frame 放回并保留 cause。

现有去重算法继续跳过与 current key 相同的顶部帧，但不能多跳一个不同帧。恢复完成后，只要 buffer 仍有更早帧，`canRollback()` 立即为 true。

- [x] **Step 3: 建立一版兼容入口**

`examples/shared/rollback-runtime.ts` 不再拥有算法，只 re-export Host API：

```ts
export { createRollbackRuntime } from '@surdet/host';
export type { RollbackRendererPort, RollbackRuntime, RollbackRuntimeOptions } from '@surdet/host';
```

Starter 和 Zero 直接从 `@surdet/host` import。两者 `onSystemBoundary` 改为调用 `rollbackRuntime.clearForBoundary()`，而新游戏、正式读档、save mismatch 等明确边界仍可调用 `clear()`。

- [x] **Step 4: 运行连续回退绿灯**

```powershell
npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts
npm run test -w surdet-starter -- --run test/rollback-runtime.test.ts
npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts
```

Expected: 连续五次、边界清理、失败回滚、恢复期间不清历史全部通过。

- [x] **Step 5: 实现并运行 Case D**

Case D 真实推进至少 8 条文本，记录每条位置/文本，真实连续点击右下角“回退”四次；每次断言恰好前一状态，中间不得推进。

```powershell
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case D
```

- [x] **Step 6: 提交 Task 4**

```powershell
git add packages/host/src/rollback-runtime.ts packages/host/test/rollback-runtime.test.ts packages/host/src/index.ts examples/shared/rollback-runtime.ts examples/starter/src/main.ts examples/zero-after-midnight/src/main.ts examples/starter/test/rollback-runtime.test.ts examples/zero-after-midnight/test/player-ui-integration.test.ts packages/shell/e2e/player-experience-wave-4.e2e.mjs
git diff --cached --check
git commit -m "fix(host): preserve history across consecutive rollback"
```

---

## Task 5: Presentation 存档预验证与公共连接

**Files:**
- Modify: `packages/core/src/runtime/interpreter.ts`
- Modify: `packages/core/test/interpreter-save.test.ts`
- Create: `packages/host/src/presentation-connection.ts`
- Create: `packages/host/test/presentation-connection.test.ts`
- Modify: `packages/host/src/index.ts`

**Interfaces:**
- Consumes: `Interpreter.setPresentationHooks()`、`RendererRuntime.commands.presentation.validate/restore`、`queries.presentation.snapshot()`。
- Produces: optional `PresentationSnapshotHooks.validate`；`connectInterpreterPresentation()`；断开后不调用已销毁 Runtime。

- [x] **Step 1: 写 Core 预验证红灯**

把接口扩展为：

```ts
export interface PresentationSnapshotHooks {
  snapshot: () => unknown;
  validate?: (payload: unknown) => void;
  restore: (payload: unknown) => void;
}
```

测试非法 Presentation payload 时：

- validate 在任何变量、readSet、gallery、system、position、stateReset 写入前调用；
- validate 抛错后原 Interpreter 状态与对象引用保持；
- restore 未调用；
- stateReset 未发出。

Run:

```powershell
npm run test -w @surdet/core -- --run test/interpreter-save.test.ts
```

Expected before fix: validate 不存在或状态已被修改。

- [x] **Step 2: 在 Core 实现无副作用 Presentation 预验证**

在完整 snapshot 迁移和 current schema 校验之后、所有 runtime 写入之前执行：

```ts
const presentationPayload = snap.presentation?.payload ?? null;
this.#presentationHooks?.validate?.(presentationPayload);
```

原有 `SystemHooks.validate` 与 Presentation validate 都必须先完成，之后才允许 restore Core/System/Presentation。

- [x] **Step 3: 写 Host connection 红灯**

定义公共接口：

```ts
export interface InterpreterPresentationConnection {
  disconnect(): void;
  readonly connected: boolean;
}

export function connectInterpreterPresentation(options: {
  interpreter: Interpreter;
  renderer: Pick<RendererRuntime, 'commands' | 'queries'>;
}): InterpreterPresentationConnection;
```

测试：snapshot 深克隆可存档；validate 调用 Renderer public command；restore 调用一次；disconnect 后 Interpreter hooks 置 null；重复 disconnect 幂等；disposed/失败保留 RendererError cause。

- [x] **Step 4: 实现 Host connection**

连接逻辑只使用公共 API：

```ts
options.interpreter.setPresentationHooks({
  snapshot: () => options.renderer.queries.presentation.snapshot(),
  validate: (payload) => options.renderer.commands.presentation.validate(payload),
  restore: (payload) => options.renderer.commands.presentation.restore(payload),
});
```

`disconnect()` 调用 `setPresentationHooks(null)` 且幂等。不得导入 Layer、Pixi 对象或 Renderer internals。

- [x] **Step 5: 运行 Core/Host 绿灯**

```powershell
npm run test -w @surdet/core -- --run test/interpreter-save.test.ts
npm run test -w @surdet/host -- --run test/presentation-connection.test.ts
npm run typecheck -w @surdet/core
npm run typecheck -w @surdet/host
```

- [x] **Step 6: 提交 Task 5**

```powershell
git add packages/core/src/runtime/interpreter.ts packages/core/test/interpreter-save.test.ts packages/host/src/presentation-connection.ts packages/host/test/presentation-connection.test.ts packages/host/src/index.ts
git diff --cached --check
git commit -m "feat(host): connect validated presentation snapshots"
```

---

## Task 6: 标题会话公共清理边界

**Files:**
- Create: `packages/host/src/player-title-session.ts`
- Create: `packages/host/test/player-title-session.test.ts`
- Modify: `packages/host/src/index.ts`
- Modify: `packages/host/test/player-shell-controller.test.ts`

**Interfaces:**
- Consumes: `PlayerShellController.commands.reset/open`、`RendererRuntime.resetSession()`。
- Produces: `enterPlayerTitleSession()`，顺序关闭 providers、清空 game World、打开 title；失败时不伪装成功。

- [x] **Step 1: 写标题残留红灯**

定义：

```ts
export interface EnterPlayerTitleSessionOptions {
  shell: PlayerShellController;
  renderer: Pick<RendererRuntime, 'resetSession'>;
  openTitle: () => void;
}

export function enterPlayerTitleSession(options: EnterPlayerTitleSessionOptions): void;
```

测试从 game + system-menu/gallery/save-load 等状态进入标题时：

- 所有 provider close 一次；
- shell reset 到 title；
- `renderer.resetSession({ preserveWorld: false })` 恰好一次；
- `openTitle()` 最后执行；
- 重复调用幂等；
- 任一步失败保留原始 cause，不继续打开伪标题。

Run:

```powershell
npm run test -w @surdet/host -- --run test/player-title-session.test.ts test/player-shell-controller.test.ts
```

- [x] **Step 2: 实现公共进入标题顺序**

权威顺序固定为：

```ts
options.shell.commands.reset('title');
options.renderer.resetSession({ preserveWorld: false });
options.openTitle();
```

`openTitle()` 只负责投影 title slot/view，不允许再次 preserve game World。若实际 Provider 补偿要求调整顺序，必须用测试证明失败时仍一致，并同步更新本文，不得暗改语义。

- [x] **Step 3: 运行 Host 绿灯**

```powershell
npm run test -w @surdet/host -- --run test/player-title-session.test.ts test/player-shell-controller.test.ts test/player-shell-slots.test.ts
npm run typecheck -w @surdet/host
```

- [x] **Step 4: 提交 Task 6**

```powershell
git add packages/host/src/player-title-session.ts packages/host/test/player-title-session.test.ts packages/host/src/index.ts packages/host/test/player-shell-controller.test.ts
git diff --cached --check
git commit -m "feat(host): define clean title session boundary"
```

---

## Task 7: Starter、Zero、CLI 模板统一采用公共契约

**Files:**
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `examples/starter/test/player-ui-integration.test.ts`
- Modify: `examples/zero-after-midnight/test/player-ui-integration.test.ts`
- Modify: `packages/cli/test/new.test.ts`
- Modify: `docs/capability-matrix.md` only through generator if required
- Modify: `docs/capabilities.json` only through generator if required

**Interfaces:**
- Consumes: `connectInterpreterPresentation()`、`enterPlayerTitleSession()`、Host `createRollbackRuntime()`。
- Produces: 三个组合根同源接线；Zero 存读档 World 恢复；标题不残留。

- [x] **Step 1: 写防漏接线红灯**

Starter/Zero 集成测试与 CLI `new.test.ts` 必须断言：

- 组合根调用 `connectInterpreterPresentation`；
- dispose/HMR 时 disconnect；
- 调用 `enterPlayerTitleSession`，不再出现 `resetSession({ preserveWorld: true })`；
- rollback 从 `@surdet/host` import 并使用 `clearForBoundary()`；
- CLI 新建项目 typecheck/build；
- 正式示例中不得手写三份 Presentation hook 对象。

Run:

```powershell
npm run test -w surdet-starter -- --run test/player-ui-integration.test.ts
npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts
npm run test -w @surdet/cli -- --run test/new.test.ts
```

Expected before adoption: Zero/模板或 preserveWorld 断言失败。

- [x] **Step 2: 接入 Presentation connection 生命周期**

每个组合根在 Interpreter 与 Renderer Runtime 创建后：

```ts
const presentationConnection = connectInterpreterPresentation({ interpreter: interp, renderer: runtime });
```

dispose/HMR teardown 必须先 `presentationConnection.disconnect()`，再 dispose runtime。删除 Starter 的手写 `setPresentationHooks` 和 Zero 的缺失状态。

- [x] **Step 3: 接入公共标题边界**

把 `showTitleScreen()` 中分散的 shell reset/world preserve 逻辑替换为 `enterPlayerTitleSession()`。游戏仍提供 `titleView()` 和 title 背景，但不得保留上一局 World。

从标题关闭设置/鉴赏/读档仍回到 title；从游戏关闭则回到 game。不得破坏已有 Player Shell source 栈。

- [x] **Step 4: 写 Zero 存读档集成测试**

使用真实 Runtime public queries 构造：背景 A + 立绘 P + 当前文本 → save → 切换/清空 → load。断言：

```text
backgroundKey = A
portrait keys/position restored
dialogue text restored
command rail visible
overlay = none
lastRendererError = null
```

非法 Presentation payload 在状态改变前失败，读档页面/Player UI 可重试。

- [x] **Step 5: 实现 Case E/F/G/H/B**

- B：游戏内 Gallery 三标签及关闭。
- E：存档后立即读档，背景和立绘保持。
- F：读档→存档→再读档，仍保持。
- G：新游戏→返回标题，无旧 World。
- H：标题读档→返回标题，无旧 World、无 release failure。

Run individually:

```powershell
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case B
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case E
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case F
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case G
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case H
```

六类 unexpected 错误必须为空；不能因 World 恢复失败等到下一场景再判绿。

- [x] **Step 6: 实现 Case I/J 与旧体验回归**

- I：等待 5 秒、推进 20 条，command rail root alpha 固定；hover 仅单按钮。
- J：F11 进入/退出全屏，画面完整、交互目标仍命中；不改变 contain 策略。

同时回归：空槽 no-op、菜单不推进、H 恢复不推进、Backlog 在正文之上、无 `Renderer resource release failed`。

- [x] **Step 7: 运行采用层绿灯**

```powershell
npm run test -w surdet-starter
npm run test -w zero-after-midnight
npm run test -w @surdet/cli -- --run test/new.test.ts
npm run typecheck -w surdet-starter
npm run typecheck -w zero-after-midnight
npm run build -w surdet-starter
npm run build -w zero-after-midnight
```

- [x] **Step 8: 提交 Task 7**

```powershell
git add examples/starter/src/main.ts examples/zero-after-midnight/src/main.ts packages/cli/templates/game/src/main.ts examples/starter/test/player-ui-integration.test.ts examples/zero-after-midnight/test/player-ui-integration.test.ts packages/cli/test/new.test.ts docs/capability-matrix.md docs/capabilities.json packages/shell/e2e/player-experience-wave-4.e2e.mjs
git diff --cached --check
git commit -m "fix(player): unify presentation and title sessions"
```

只暂存实际改变的 capability 文件；若 generator 未改变它们，不得强行 add 或手改。

---

## Task 8: 完整 Wave 4 玩家矩阵与回归门禁

**Files:**
- Modify: `packages/shell/e2e/player-experience-wave-4.e2e.mjs`
- Modify: `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts`
- Modify: `packages/shell/package.json`

**Interfaces:**
- Consumes: Task 1–7 的 A–J cases。
- Produces: schemaVersion 1 权威 artifact、两轮独立玩家矩阵、真实 Zero 身份证据。

- [x] **Step 1: 完成 A–J 全部断言**

每 case 必须记录：游戏标题、sourceRoot、distRoot、独立 userData、真实交互步骤、语义断言、六类错误数组、资产加载完成状态。正式项目资产口径仍由 `check-assets` 的 44 项给出，Renderer URL 请求数不得冒充项目资产数。

- [x] **Step 2: 运行 smoke**

```powershell
npm run e2e:player-experience:wave4 -w @surdet/shell -- --smoke
```

Expected: 正式 Zero dist 启动、标题正确、资产完成、A 的最小路径通过。

- [x] **Step 3: 运行两轮独立正式矩阵**

```powershell
npm run e2e:player-experience:wave4 -w @surdet/shell
npm run e2e:player-experience:wave4 -w @surdet/shell
```

两轮都必须 A–J 10/10。不得覆盖第一轮 artifact；报告每轮绝对路径、字节数、SHA-256。不得挑一轮绿灯掩盖另一轮失败。

- [x] **Step 4: 运行旧 Wave 2/3 回归**

```powershell
npm run e2e:player-experience -w @surdet/shell
npm run e2e:player-shell-wave-3 -w @surdet/shell
npm run e2e -w @surdet/shell
npm run e2e:renderer-v2 -w @surdet/shell
```

Expected: 旧玩家矩阵、Shell baseline、Renderer v2 语义验收全部通过；视觉图片仍标 `CANDIDATE`，不得冒充永久金样。

- [x] **Step 5: 提交最终 E2E harness**

```powershell
git add packages/shell/e2e/player-experience-wave-4.e2e.mjs packages/shell/test/player-experience-wave-4-e2e-contract.test.ts packages/shell/package.json
git diff --cached --check
git commit -m "test(shell): gate player experience wave 4"
```

若文件在早期任务已全部提交且本任务无 diff，不创建空提交。

---

## Task 9: 全量验证、交付报告与停止点

**Files:**
- Create: `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-4-DELIVERY-REPORT-2026-08-12.md`
- Modify: `docs/superpowers/plans/2026-08-12-player-experience-wave-4.md`

**Interfaces:**
- Consumes: 全部提交、A–J 两轮 artifact、全量门禁。
- Produces: 可独立复审的报告与真实 Git 状态；`WAITING_FOR_REVIEW`。

- [x] **Step 1: 按依赖顺序运行聚焦与全量测试**

```powershell
npm run test -w @surdet/core
npm run test -w @surdet/renderer
npm run test -w @surdet/host
npm run test -w @surdet/shell
npm run test -w surdet-starter
npm run test -w zero-after-midnight
npm run test -w @surdet/cli
```

禁止并行运行依赖构建，避免读取正在写入的 dist。

- [x] **Step 2: 运行类型检查与构建**

```powershell
npm run build -w @surdet/core
npm run typecheck -w @surdet/core
npm run build -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/host
npm run typecheck -w @surdet/host
npm run build -w @surdet/shell
npm run typecheck -w @surdet/shell
npm run typecheck -w surdet-starter
npm run build -w surdet-starter
npm run typecheck -w zero-after-midnight
npm run build -w zero-after-midnight
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [x] **Step 3: 运行正式游戏门禁**

```powershell
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
node examples/zero-after-midnight/scripts/check-assets.mjs
```

Expected: 11 场景、23/23 choice、3 结局、39 次存读档 smoke、44 项资产、0 errors、0 warnings、0 runtime errors。

- [x] **Step 4: 运行仓库总门禁**

```powershell
npm run verify:renderer-boundaries
npm run verify:renderer-legacy
npm run verify:tools
npm run verify:hygiene
npm run verify:all
git diff --check
git ls-files '*.log'
```

Expected: 全部 exit 0，tracked log 为空。不得提高阈值、删测试或弱化断言。

- [x] **Step 5: 编写权威交付报告**

报告必须包含：

- 基线/最终 HEAD 和完整普通提交链；
- G1–G6 每项根因、红灯命令、失败数、修复、绿灯数；
- D7 为什么不改生产缩放；
- 公共层与游戏采用层文件清单；
- Presentation payload/读档恢复证据；
- 连续回退状态序列；
- Backlog mask 与稳定 rail 证据；
- 两轮 A–J artifact 路径、大小、SHA；
- 旧 Wave 2/3 回归；
- 所有测试/typecheck/build/verify 真实数量；
- Zero 的 11/23/3/44/0 口径；
- 工作树、远端 ahead/behind、四个受保护文件；
- 明确未 push、未发行、未进入 M9/性能/资产/音频。

不得写不存在的字段为 0；artifact schema 缺失字段写“未观测”。

- [ ] **Step 6: 更新计划台账并提交文档**

将本文 checkbox 和每项真实结果更新后：

```powershell
git add docs/ENGINE-PLAYER-EXPERIENCE-WAVE-4-DELIVERY-REPORT-2026-08-12.md docs/superpowers/plans/2026-08-12-player-experience-wave-4.md
git diff --cached --check
git commit -m "docs(engine): report player experience wave 4"
```

- [ ] **Step 7: 在最终 HEAD 再跑一次总门禁**

```powershell
npm run verify:all
git diff --check
git ls-files '*.log'
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
```

最终 `git status --short` 只能是四个受保护未跟踪文件。若报告提交改变了门禁输入，必须以这次最终运行作为权威结果。

- [ ] **Step 8: 停止，不 push**

最终状态必须写为：

```text
PLAYER_EXPERIENCE_WAVE_4_IMPLEMENTED
PUBLIC_RENDERER_HOST_CONTRACTS_IMPLEMENTED
TITLE_GALLERY_INPUT_VERIFIED
COMMAND_RAIL_STABLE
BACKLOG_VIEWPORT_CLIPPED
CONSECUTIVE_ROLLBACK_VERIFIED
PRESENTATION_SAVE_LOAD_VERIFIED
TITLE_WORLD_CLEANUP_VERIFIED
F11_FULLSCREEN_REGRESSION_PASSED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

不得继续修复审阅中发现之外的新问题；不得自行 push、发行或部署。

---

## Self-Review Checklist for the Executor

- [ ] 六项用户问题是否各有真实红灯和绿灯？
- [ ] Gallery 是否真的用标题页鼠标点击，而不是 debug command？
- [ ] 命令栏 root alpha 是否稳定且没有残留 tween？
- [ ] Backlog 是否有真实 mask，正文 bounds 是否永远在 header 下？
- [ ] 连续回退是否无需中间推进，system boundary 是否只在非 rollback restore 时清历史？
- [ ] Zero 是否与 Starter/CLI 一样使用 Host Presentation connection？
- [ ] 非法 Presentation 是否在任何状态写入前被拒绝？
- [ ] 返回标题是否使用 `preserveWorld:false` 的公共边界？
- [ ] F11 是否只做回归，未改缩放策略？
- [ ] Wave 1–3 资源释放、空槽、输入门控、H 隐藏是否保留？
- [ ] 是否没有触碰四个受保护文件？
- [ ] 是否没有 push、force、历史改写、发行、M9、性能、资产或音频工作？

---

## Execution Ledger

> 本台账是 Wave 4 的持久化执行进度。每完成一个 Task，先写入真实红灯、绿灯、提交和下一入口；上下文恢复时以本表、Git 日志和工作树为准，不凭对话记忆续做。

### Task 0 — completed

- 状态：基线冻结完成；未修改源码；未创建 Task 0 源码提交。
- HEAD：`5850c816531a9a90b6bb1d18b992b4e14aec7385`。
- `HEAD...surdet/main`：`2 0`；领先内容正是设计提交 `502a4d55caefe1c6df2919733035221271783652` 与计划提交 `5850c816531a9a90b6bb1d18b992b4e14aec7385`，不得丢弃。
- 工作树：仅 `SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md` 四个受保护未跟踪文件。
- Worktree：仅主工作树 `E:/surdet`，未发现其他执行 AI worktree。
- 工具链：`node v24.15.0`；`npm 11.12.1`。
- 基线命令：`npm run verify:all` → exit `0`；`git diff --check` → exit `0`；`git ls-files '*.log'` → 空（0 个 tracked log）。
- 基线正式游戏证据（来自 `verify:all`）：11 场景；23/23 choice；39 次 save/load smoke；3 个结局；44 项资产；0 runtime errors。
- `RED_COMMAND=not applicable (Task 0 baseline only)`
- `RED_EXIT=not applicable`
- `RED_FAILURE=not applicable`
- `GREEN_COMMAND=npm run verify:all; git diff --check; git ls-files '*.log'`
- `GREEN_RESULT=verify:all exit 0; diff-check exit 0; tracked logs 0`
- `COMMIT=deferred to Task 9 documentation commit (Task 0 is explicitly non-source-commit)`
- 下一入口：Task 1 Step 1，先建立 Wave 4 E2E runner 骨架，再写契约测试，随后在当前基线取得 Gallery 红灯。

### Task 1 — blocked at baseline reproduction

- Step 1 runner 骨架与 Step 2 静态契约已完成；契约测试 `4/4` 通过。
- 先行 harness 红灯（均非 G1 产品红灯，已保留终端证据）：
  - `node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A` → exit `1`，Windows/Node 24 下 `spawnSync npm.cmd EINVAL`；改用 Node 安装内的 `npm-cli.js` 后消除。
  - 同命令再次运行 → exit `1`，runner 的多余 `window.surdetDebug.showTitleScreen()` setup 抛 `TypeError`；改为等待真实初始标题后消除。
- G1 基线红灯尝试：固定逻辑画布坐标的正式 Zero Electron Case A，真实路径 `标题 → 鉴赏 → 音乐 → 文本 → CG → 关闭`，退出 `0`；artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-0ydxLo\player-experience-wave-4-1786470788201.json`，SHA-256 `61f2460f51ea2c3d9c729cd080221bd160199974688b3144fd7ebf61af4f7978`。A 的 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为空，`unexpectedWindowClosed=false`。
- 聚焦回归：`npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts` → `13/13`，exit `0`；`npm run test -w @surdet/host -- --run test/renderer-player-shell-slots.test.ts` → `3/3`，exit `0`。
- 结论：当前基线未产生与 G1 描述一致的红灯；不能伪造失败断言，也不能在无证据时修改 `GalleryLayer`。因此 Task 1 暂停，Task 2 不得启动。
- `RED_COMMAND=node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A`（产品目标）
- `RED_EXIT=未观测到产品红灯；无合法 RED_FAILURE 可记录`
- `RED_FAILURE=未复现“标题来源音乐/文本点击无反应”`
- `GREEN_COMMAND=npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts; npm run test -w @surdet/host -- --run test/renderer-player-shell-slots.test.ts; node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A`
- `GREEN_RESULT=Renderer 13/13；Host 3/3；固定坐标正式 Zero Case A exit 0，六类错误数组全空`
- `COMMIT=未创建；Task 1 因缺少合法红灯未完成，当前仅保留诊断 runner/契约测试/脚本入口与台账改动`
- 下一入口：等待独立复核或新的可复现 G1 证据；未获授权前不得进入 Task 2。

### Task 1 — independent review remediation: visible Gallery frame red (completed)

- 独立复审指出旧 Case A 是假绿：它只验证 `activeOverlay` 从 `gallery:cg` 变为 `gallery:music`，没有验证 Pixi 画布内容已经提交到屏幕。
- 先行单元红灯：新增的 `gallery-layer.test.ts` 两项测试在当前生产代码上失败，均为 `requestFrame` spy 未被调用；tab 语义和可见内容重建断言通过。运行：
  `npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts` → exit `1`，`13 passed / 2 failed / 15 total`。
- 失败测试分别覆盖：CG→音乐→文本→CG 的真实 Pixi `pointerdown` 标签路径；CG viewer 返回 Gallery 列表的真实 pointer 路径。当前失败断言为“重建必须请求至少一帧”。
- 先行正式 Electron 红灯：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A` → exit `1`。构建五个工作区均 exit `0`，正式入口为 `E:/surdet/examples/zero-after-midnight/dist`，独立 userData 为 `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-DXVbOI\A\user-data`。
- 红灯 artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-DXVbOI\player-experience-wave-4-1786471633253.json`；SHA-256 `82D4E3F41858178A04E431504FCDB4F9542872C4569E3C6E5D256AF7F2AA78B1`。
- artifact 的真实失败断言：`activeOverlay=gallery:music`，但 `gallery-cg-before-music-2.png` 与 `gallery-music-after-click.png` 的 screenshot SHA 均为 `d9cec088a445eb4d5f93acfc28570c216360cb3cccd6b607a2bc9458503b7193`，pixel hash 均为 `61040df76d51aa92d6e97bad07332c0b949fe3c3e303afe8ac403d2d7af42a15`；失败信息为“音乐标签切换后画布未刷新”。六类错误数组和 `unexpectedWindowClosed` 均为空。
- runner 证据修正已先完成但尚未提交：artifact `head` 改为真实 `git rev-parse HEAD`；失败 case 保留 events/assertions/screenshots/error/errorStack；移除不存在的 `window.surdetDebug.showTitleScreen()`；截图明确记录 PNG SHA 与 `sha256(canvas.toDataURL(image/png))` pixel hash。
- 当前合法根因候选与源码一致：`GalleryLayer.#rebuildGallery()` 完成可见内容重建却没有统一调用 `#requestFrame()`；标题静态页 FrameScheduler 休眠时会造成语义已变而画布不变。尚未修改生产代码。
- `RED_COMMAND=npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts`
- `RED_EXIT=1 (13 passed / 2 failed / 15 total)`
- `RED_FAILURE=requestFrame 未在 tab rebuild 与 viewer return rebuild 中调用；E2E 另证实 activeOverlay 已切换但画布 pixel hash 不变`
- `GREEN_COMMAND=待最小公共 GalleryLayer 修复后运行同一 Renderer 测试、Host slots、Wave 4 Case A`
- `GREEN_RESULT=npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts → 15/15；npm run test -w @surdet/host -- --run test/renderer-player-shell-slots.test.ts → 5/5；npm run test -w @surdet/shell -- --run player-experience-wave-4-e2e-contract.test.ts → 4/4；Renderer/Shell typecheck exit 0；git diff --check exit 0；正式 Zero Case A exit 0。修复后截图 pixel hash：CG d9cec088...，音乐 46ac6cc1...，文本 0b51b019...，CG 返回 d9cec088...；六类错误数组为空。`
- `COMMIT=f42379855873cdcd4158423896f529bdd1526b0f`
- `修复=packages/renderer/src/layers/gallery/gallery-layer.ts 在 #rebuildGallery() 单一边界调用 #requestFrame()；同时保留 tab/viewer 的公共命中路径，不引入 title 特例、永久 ticker 或资源语义变化。`
- `Host 对照=renderer-player-shell-slots.test.ts 新增 title/game 两个 source 用例，均 5/5 通过；两种来源委托同一 Gallery 公共命令和关闭路径。`
- `绿灯 artifact=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-s48tL4\player-experience-wave-4-1786471805644.json；bytes=7318；SHA-256=CCAE399D2182AA9626972E9CEF4DFDF0947BC28F7711047B1BE18591798AD8F1。`
- 下一入口：先精确暂存 Task 1 文件、创建普通提交并记录真实 SHA；提交后只复核 Task 1，随后才能进入 Task 2。
- 状态：Task 1 red→green、聚焦回归、类型检查和独立普通提交均完成；Task 2 尚未开始。

### Task 2 — command rail red → green (completed)

- 新增 `packages/renderer/test/layers/dialogue-layer.test.ts` 三项先行测试，覆盖：show 后 alpha=1 且长时间 update 不改变；连续 20 次 `setCommandRailItems()` 不产生整体 rail tween；pointerover/pointerout 只改变目标 row，不唤醒整条 rail。
- 新增 `resource-cycles.test.ts` 真实 `RendererStageHost` 命令栏重复重建测试。
- `RED_COMMAND=npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/integration/resource-cycles.test.ts`
- `RED_EXIT=1`
- `RED_FAILURE=DialogueLayer 3/3 failed (commandRailAlpha undefined; expected 1; baseline also registers command-rail tween); resource-cycles 1 failed (activeTweens=1 instead of 0); original resource-cycle tests 5 passed`
- 生产代码尚未修改；Task 2 的实现入口是移除整体 wake/fade 状态字段与 update/needsUpdate 分支，保留 command rail root alpha=1、hover 局部 label/underline、单次 frame request。

- 修复：`DialogueLayer` 移除 `commandRailWakeRemain`、`commandRailIdleAlpha`、`commandRailPointerWake` 及整体 update/needsUpdate wake 逻辑；`commandRail` root alpha 固定为 `1`；show/set/restore 仅安排一次普通 frame，hover 只更新目标 row；保留旧 `attachPointerTarget` 兼容入口但不再注册永久 canvas listener。
- `GREEN_COMMAND=npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/integration/resource-cycles.test.ts test/theme.test.ts; npm run typecheck -w @surdet/renderer; git diff --check`
- `GREEN_RESULT=Renderer 聚焦 3 files / 36 tests passed；typecheck exit 0；diff-check exit 0。先行红灯同一断言全部转绿，resource-cycles activeTweens=0。`
- `COMMIT=4c8967a378de35d855f9315dec962f4e05b94b5e`
- 状态：Task 2 red→green、Renderer 聚焦回归、typecheck、diff-check 和独立普通提交均完成；后续已完成 Task 3 与 Task 4。

### Task 3 — backlog layout red → green (completed)

- 新增两项 DialogueLayer 先行测试，覆盖 120 条中文/emoji/多行记录、空 query、非空 query、固定 header、滚动后 header 不位移、正文 viewport、mask 和 `Ctrl+F` idle hint。
- `RED_COMMAND=npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/backlog-search-controller.test.ts`
- `RED_EXIT=1`
- `RED_FAILURE=DialogueLayer 2/5 failed：`backlogLayout` 公开只读布局快照缺失（undefined）；当前实现还会在空 query 显示 `Ctrl+F 搜索`，entries container 没有 mask。BacklogSearchController 原有 2/2 通过，其余命令栏测试 3/3 通过。`
- 生产修复：`DialogueLayer` 使用 `BACKLOG_HEADER_Y=30`、空 query `viewportTop=76`、非空 query `viewportTop=92`、`viewportBottom=h-36`；空 query 不创建 `Ctrl+F 搜索` 节点；entries 独立容器绑定 Graphics mask；滚动复用同一 viewport 高度并 clamp；重建/关闭路径清理 mask。
- `GREEN_COMMAND=npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/backlog-search-controller.test.ts test/theme.test.ts test/integration/resource-cycles.test.ts; npm run test -w @surdet/shell -- --run player-experience-wave-4-e2e-contract.test.ts; npm run typecheck -w @surdet/renderer; node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case C; git diff --check`
- `GREEN_RESULT=Renderer 4 files / 41 tests passed；Shell Wave 4 contract 1 file / 4 tests passed；Renderer typecheck exit 0；Case C 正式 Zero dist、独立 Electron/userData、真实标题→开始→18 次 Space→Escape→文字记录→滚轮→PageDown→关闭 exit 0；diff-check exit 0。Case C artifact=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-06NAYR\player-experience-wave-4-1786472825156.json；bytes=10744；SHA-256=BC75D9284E8488B6371342484166636E008EE103F04A2DC10A830E56CFCBD0C5；artifact head=4c8967a378de35d855f9315dec962f4e05b94b5e（采集发生在提交前）。布局证据：before headerY=30, viewportTop=76, viewportBottom=684, scroll=0, contentHeight=646, hasMask=true；after 仅 scroll 变为 -38；截图 backlog-before-scroll.png SHA=eb25cd7a1c8b0c480da93e233d144f7e1489be534652904d562655deb2dfd939，backlog-after-scroll.png SHA=27c2abb6c089ffa386eed270b90219671d01c38678bf3d7983c508fb135d2e9a；关闭后位置保持 prologue:27；六类错误数组与 unexpectedWindowClosed 均为空。`
- `COMMIT=944f2a25ee34d226f5d9194f40ed61f8629b999f`
- 下一入口：Task 4 Step 1，先为 Host 连续回退建立真实根因红灯；不得提前启动 Task 5。

### Task 4 — rollback runtime red → green (completed)

- 先行红灯测试新增 `packages/host/test/rollback-runtime.test.ts`，以真实组合顺序模拟 `perform → renderer.resetSession → stateReset → host.reset → onSystemBoundary → clear`；基线运行 `npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts` → exit `1`，1 test failed，第二次 `perform()` 返回 `false`，证明旧共享实现第一次回退后清空历史。
- 生产实现迁入 `packages/host/src/rollback-runtime.ts` 并由 `packages/host/src/index.ts` 公共导出；`clearForBoundary()` 在 `restoring` 期间保持历史；`perform()` 覆盖 reset/load/Presentation/audio 全过程，失败时把目标 frame 放回并以 warning 保留原始 cause；旧 `examples/shared/rollback-runtime.ts` 仅保留兼容 re-export；Starter 与 Zero 直接从 `@surdet/host` 接线，system boundary 使用 `clearForBoundary()`。
- Host 聚焦绿灯：`npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts` → 1 file / 3 tests passed；`npm run typecheck -w @surdet/host`、`npm run build -w @surdet/host` exit 0。
- 示例回归：`npm run test -w surdet-starter -- --run test/rollback-runtime.test.ts` → 1 file / 2 tests passed；`npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts` → assets 44、11 scenes、3 endings，3 files / 23 tests passed；Starter/Zero typecheck exit 0。
- 真实 Case D：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case D` exit 0；正式 Zero dist、独立 Electron/userData；8 条文本后连续真实点击 `rail:rollback` 4 次，位置严格 `prologue:13 → 12 → 11 → 10 → 9`，无中间推进；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-vkQLZ6\player-experience-wave-4-1786473415032.json`；bytes=5486；SHA-256=`B34A018FC0BAA15772CDEEADD4B5AD93A85843FDE48DC2F584CA2DFDAFD135C4`；artifact head=`944f2a25ee34d226f5d9194f40ed61f8629b999f`；六类错误数组、releaseFailures 与 unexpectedWindowClosed 均为空。
- `GREEN_RESULT=任务 4 聚焦测试、类型检查、Host build、Starter/Zero 回归及真实 Case D 全部通过；git diff --check exit 0`
- `COMMIT=c9ef9583e164985e864baa6713a5569309399a3e`
- 下一入口：Task 5 Step 1，先为 Core Presentation 预验证建立红灯；不得提前启动 Task 6。

### Task 5 — Presentation validation/connection red → green (completed)

- Core 先行红灯：`npm run test -w @surdet/core -- --run test/interpreter-save.test.ts` → exit `1`，`17 passed / 1 failed / 18 total`；基线忽略了可选 Presentation validate，非法 payload 未被拒绝，因而无法证明在任何状态写入前失败。
- Host connection 先行红灯：`npm run test -w @surdet/host -- --run test/presentation-connection.test.ts` → exit `1`；测试首先证明公共 `presentation-connection` 模块不存在，正式连接 API 尚未建立。
- 修复：Core 在 schema/system 校验后、任何 runtime state 写入前调用可选 `PresentationSnapshotHooks.validate`；Host 新增只使用 Renderer `commands/queries` 的 `connectInterpreterPresentation()`，提供 snapshot/validate/restore 接线、幂等 disconnect 和断开后的 stale-hook guard，不吞掉 Renderer 错误。
- 绿灯：`npm run test -w @surdet/core -- --run test/interpreter-save.test.ts` → `18/18`；`npm run test -w @surdet/host -- --run test/presentation-connection.test.ts test/rollback-runtime.test.ts` → `2 files / 4 tests`；`npm run build -w @surdet/core`、Core/Host typecheck 均 exit `0`。
- 实际改动：`packages/core/src/runtime/interpreter.ts`、`packages/core/test/interpreter-save.test.ts`、`packages/host/src/presentation-connection.ts`、`packages/host/test/presentation-connection.test.ts`、`packages/host/src/index.ts`。
- `COMMIT=32275c0485a9aa9b37cf83369ec00a4a87453553`
- 下一入口：Task 6 Step 1，先为标题会话残留建立 Host 红灯；不得提前启动 Task 7。

### Task 6 — title session cleanup boundary red → green (completed)

- `RED_COMMAND=npm run test -w @surdet/host -- --run test/player-title-session.test.ts test/player-shell-controller.test.ts`
- `RED_EXIT=1`
- `RED_FAILURE=新增标题会话回归测试因公共 packages/host/src/player-title-session.ts 尚不存在而收集失败；既有 PlayerShellController 18 项通过，未修改生产代码前未宣称产品绿灯。`
- `GREEN_COMMAND=npm run test -w @surdet/host -- --run test/player-title-session.test.ts test/player-shell-controller.test.ts test/player-shell-slots.test.ts; npm run typecheck -w @surdet/host; git diff --check`
- `GREEN_RESULT=Host 3 files / 31 tests passed；Host typecheck exit 0；diff-check exit 0。覆盖 system-menu/settings、title gallery、game save-load provider close 次数，shell reset → renderer reset preserveWorld=false → openTitle 顺序，重复调用幂等，以及 shell/renderer/openTitle 失败原始错误传播。`
- 修复：新增 `packages/host/src/player-title-session.ts` 与公开导出；使用共享 Host 标题边界，成功后同一 clean title session 重复调用 no-op，失败不标记成功且不伪装打开标题；补充 PlayerShellController 集成测试。
- `COMMIT=b07dae7d17edb3e991e3a3899786df3fc2c66780`
- 下一入口：Task 7 Step 1，先为 Starter、Zero、CLI 公共契约接线建立防漏红灯；不得提前启动 Task 8。

### Task 7 — public composition-root adoption (completed)

- 先行防漏接线红灯：
  - `npm run test -w surdet-starter -- --run test/player-ui-integration.test.ts` → `1 failed / 2`，缺少 `connectInterpreterPresentation` 等公共接线；
  - `npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts` → 同类公共接线断言失败；
  - `npm run test -w @surdet/cli -- --run test/new.test.ts` → `2 failed / 4`，模板与生成入口缺少公共 Presentation connection；
  - 未在红灯前修改生产接线；以上失败记录与断言保留在终端证据中。
- 采用层修复：Starter、Zero 使用 `connectInterpreterPresentation()`，dispose/HMR 在 runtime dispose 前 disconnect；标题返回统一使用 `enterPlayerTitleSession()`，World reset 为 `preserveWorld:false`；Starter/Zero/CLI 模板的 rollback 统一使用 Host `createRollbackRuntime()` 与 `clearForBoundary()`，未复制 Host 算法、未改 DSL/存档/剧情。
- 接线后真实回归先发现一项直接阻断：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A` → exit `1`；Gallery 画面哈希已正确变化，但标题 Gallery 关闭后 Host 幂等 clean-title 判断跳过了重新打开已被隐藏的标题投影，`waitTitle` 超时。失败 artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-ljdtZZ\player-experience-wave-4-1786475442398.json`；bytes=`8389`；SHA-256=`5C310C582E1ABAFFAC98F7EA0F969C280862FD59C555FF5C8451BA33D310FF51`；六类错误数组均为空。
- 最小修复：Starter/Zero `showTitleScreen()` 继续以 Host 标题边界负责会话清理，并通过只读 `queries.overlay.menu()` 确认标题 projection；若幂等边界已跳过但标题投影实际隐藏，则调用一次公共 `commands.open({slot:'title',source:'title'})`，不接触 Layer/Renderer 内部实现。
- Task 7 真实 Electron 结果（正式 `E:\surdet\examples\zero-after-midnight\dist`、每项独立 Electron 与 userData、真实鼠标/键盘）：
  - A 标题 Gallery：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-72Z7mC\player-experience-wave-4-1786475595859.json`；bytes=`7318`；SHA-256=`1293B96A4256926D869A487BBC60FD85A53D3FB42C146296376EBC5F6A19B9B6`；CG/music/text/CG 画布哈希分别变化并恢复，关闭回到 title。
  - B 游戏 Gallery：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-FIN4NU\player-experience-wave-4-1786475089810.json`；bytes=`6292`；SHA-256=`D975512279D3F9F2AC43B34DEDF3F3332B4EA673378063DE53BE7F1B286D7B81`。
  - C Backlog：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-05gDZ7\player-experience-wave-4-1786475618859.json`；bytes=`10744`；SHA-256=`0AE79C457DC13644FE66161C17EE71A575E7F13E0D1702E77093EC31B113587C`。
  - D 连续回退：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-GCXh9G\player-experience-wave-4-1786475731365.json`；bytes=`5486`；SHA-256=`5C2AA5A4BC052C6CD3E5A583D9F88D9B02FF67F0D0B71E535D0658A52F1CDD35`；位置严格按前一状态回退。
  - E 存后读：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-tpB3zP\player-experience-wave-4-1786475112199.json`；bytes=`3318`；SHA-256=`693F92D0221689DABEA170E4A92B91ADCF6CD2926AC528B5F6D20BCBEF7A5F77`。
  - F 多轮存读：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-YSOzRP\player-experience-wave-4-1786475267438.json`；bytes=`2294`；SHA-256=`DEAB634985EE8C0763FA80EEACEF231805B2062DB6AECFC857BD2C049091FFB2`。
  - G 游戏返回标题清理：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-I2kAsN\player-experience-wave-4-1786475314967.json`；bytes=`1557`；SHA-256=`87FAB59F56271C249C95A9F8DB5C14A3DAE8D442048387D7EDF42CAB7D316B61`。
  - H 标题读档后返回清理：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-EM04PI\player-experience-wave-4-1786475351893.json`；bytes=`1792`；SHA-256=`CB1596CC542D42F8E8E80218A298521FE9F90841F0457642907C15C728E69E41`。
  - I 命令栏稳定/hover：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-C9eXLM\player-experience-wave-4-1786475392626.json`；bytes=`2950`；SHA-256=`61602F80F1077C7DC766C8E17810EA15E50C602A44C72A42B1F0C22D37539AB4`。
  - J F11 回归：PASS；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-RedWMs\player-experience-wave-4-1786475419467.json`；bytes=`1890`；SHA-256=`E37D906FC98A272EAE3620AD9CBC3D7895B35CD9A6AF3E44F264CE00D4A598FD`。
- 采用层绿灯：`npm run test -w surdet-starter` → 4 files / 7 tests；`npm run test -w zero-after-midnight` → simulation assets=44, scenes=11, endings=3, 2 files / 21 tests；`npm run test -w @surdet/cli -- --run test/new.test.ts` → 1 file / 4 tests；Starter/Zero/CLI typecheck 与 Starter/Zero/CLI build 均 exit `0`。Starter HMR 真实测试先因过时 listener 期望红灯，删除已由 Task 2 移除的 `dialogue:command-rail-pointer` 期望后保持 4 files / 7 tests 通过；未修改 HMR 替换逻辑。
- `RED_COMMAND=npm run test -w surdet-starter -- --run test/player-ui-integration.test.ts; npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts; npm run test -w @surdet/cli -- --run test/new.test.ts; node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A`（接线后回归）
- `RED_EXIT=1`（先行接线断言：Starter 1/2、Zero 同类、CLI 2/4；接线后 Case A 失败）
- `RED_FAILURE=正式 Zero 标题 Gallery 关闭后标题 projection 未重新显示，waitTitle 15s 超时；失败 case 的 events/assertions/screenshots/error/errorStack 已保留，六类错误数组为空`
- `GREEN_COMMAND=npm run test -w surdet-starter; npm run test -w zero-after-midnight; npm run test -w @surdet/cli -- --run test/new.test.ts; npm run typecheck -w surdet-starter; npm run typecheck -w zero-after-midnight; npm run typecheck -w @surdet/cli; npm run build -w surdet-starter; npm run build -w zero-after-midnight; npm run build -w @surdet/cli; node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A (and separately --case B through --case J)`
- `GREEN_RESULT=采用层全量/类型检查/构建通过；Wave 4 单项 A–J 均 PASSED；各 artifact 见上；正式游戏 case 均 pageErrors/consoleErrors/requestFailures/unhandledRejections/rendererErrors/releaseFailures 为空`
- `COMMIT=c7b934cf1c2020aee49524f2f99f1f07ad0c643c`
- 提交后 `git log -1 --format=fuller` 已读取真实 commit；当前 HEAD=`c7b934cf1c2020aee49524f2f99f1f07ad0c643c`，`HEAD...surdet/main=9 0`；计划台账仍未提交，四个保护文件保持未跟踪。
- 下一入口：Task 8 Step 1，先运行 smoke，再生成两轮完整 A–J 矩阵；不得跳过两轮或覆盖第一轮 artifact。

### Task 8 — full matrix, schema evidence and legacy regressions (completed)

- Smoke 已通过：`npm run e2e:player-experience:wave4 -w @surdet/shell -- --smoke`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-w1DGcB\player-experience-wave-4-smoke.json`；SHA-256=`9441463462afb7f05d60a4ac7e6ca6e7619f2d94cfcf818e4ec54acb2abc26d9`。
- 第一轮完整矩阵已通过：`npm run e2e:player-experience:wave4 -w @surdet/shell`；A–J=`10/10`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-4J4Roq\player-experience-wave-4-1786476121260.json`；SHA-256=`82ac037b8dbe301cb0b6ff1874ace17e36a4b03d37efd279a1595d07ad107951`。
- 第二轮完整矩阵未通过，且没有被覆盖或删除：同一完整命令退出码=`3221226505`（Windows `0xC0000409`）；未输出 JSON artifact。失败现场根目录=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-BeQmhV`。只记录已落盘证据：A–G 各有独立 userData/session.log，H 仅创建 userData/lockfile，未生成 session.log、截图或最终 artifact；该轮在 H 启动阶段终止。该失败轮次不得按通过处理。
- 初步诊断：失败后 H 的 Electron 主/ GPU/utility 进程仍存在，而驱动 Node 进程已退出；当前尚无产品断言失败证据，暂不修改生产代码。下一入口：先运行预声明的 Case H 单例诊断，确认是否能稳定复现 runner/Electron 生命周期故障；随后才决定是否需要最小 harness 修复或重新执行第二轮完整矩阵。
- 预声明 Case H 单例诊断已完成：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case H` → exit `0`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-Yq6KkW\player-experience-wave-4-1786476847655.json`；bytes=`1792`；SHA-256=`0F7983C8C225BD5ADF09E69B597C6D9417AD9A395A3AECED099E8129C04F47C3`；artifact `head=c7b934cf1c2020aee49524f2f99f1f07ad0c643c`、正式 Zero dist；H 的标题读档→游戏→标题清理断言通过，错误数组为空。该结果说明 H 产品路径本身未重现失败；原第二轮仍作为真实进程生命周期失败保留。
- 当前未对源码或 runner 作猜测性修改；下一入口：在保留失败轮次和 H 诊断 artifact 的前提下，重新执行一次完整 A–J 作为第二轮替代采集，并在最终报告中同时列出失败轮次，不得把失败抹掉。
- 第二轮替代完整矩阵已通过：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs` → exit `0`；A–J=`10/10`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-Nf8vu5\player-experience-wave-4-1786476944166.json`；bytes=`40014`；SHA-256=`CDD6BC3BD6B927AF8BFE73BCE5964D9A653411F1D751F2C42082298427FAE392`；`head=c7b934cf1c2020aee49524f2f99f1f07ad0c643c`；正式 dist=`E:\surdet\examples\zero-after-midnight\dist`；十个 case 的六类错误数组均为空。该替代轮次不覆盖第一轮，也不覆盖原失败轮次。
- Task 8 Step 3 的审计结论：两轮完整绿色 artifact 均保留（第一轮与替代第二轮），另有一轮真实 `0xC0000409` 失败证据明确保留；不以绿色轮次掩盖失败。下一入口：Task 8 Step 4，依次执行 Wave 2、Wave 3、Shell baseline、Renderer v2 旧回归。
- Task 8 Step 1 schema 收口先行红灯：新增 `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts` 的逐 case identity/asset evidence 断言在旧 runner 上为 `4 passed / 1 failed`，缺失 `caseEvidence()`、per-case `title/sourceRoot/distRoot/assetLoading`；未先修改生产代码。修复后同一契约测试为 `1 file / 5 tests passed`。
- Schema 修复仅限 Wave 4 E2E harness：每个 case 现在记录 `title`、正式 `sourceRoot`、正式 `distRoot`、隔离 `userData`、`assetLoading`、`assetComplete`、真实 `assertions/events/screenshots` 以及失败时的 `error/errorStack`；`assetComplete` 要求 `total>0`、`completed===total`、`failed===0`、`done===true`。没有修改 Renderer、Host、Core 或游戏生产逻辑。
- 修复后的 smoke：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs --smoke` → exit `0`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-djQkAv\player-experience-wave-4-smoke.json`；bytes=`1293`；SHA-256=`EEFC3ACC5809AD9960A2B471DCAE5D16D7B0F1CCFA0491355C74A653ED3AACED`；正式标题=`零点之后 / AFTER MIDNIGHT`；资产=`48/48/0/done=true`。
- 修复后的正式完整矩阵第一轮：`node packages/shell/e2e/player-experience-wave-4.e2e.mjs` → exit `0`；A–J=`10/10`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-LxD7Q9\player-experience-wave-4-1786477593233.json`；bytes=`43584`；SHA-256=`83BBA3B8691060B8985D15244A24C40CC7A9F1BAADB5853D1E1951D2208F2C10`。
- 修复后的正式完整矩阵第二轮：同一命令 → exit `0`；A–J=`10/10`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-PHO3Gv\player-experience-wave-4-1786477855065.json`；bytes=`43584`；SHA-256=`ABE02D6C9A760E2923D0DF327EE491509A006AA6223A3F3E9DEBED506915ADB9`。
- 对两份修复后 artifact 的只读结构核对：`status=PASSED`、`cases=10`、`head=c7b934cf1c2020aee49524f2f99f1f07ad0c643c`；每个 case 标题为 `零点之后 / AFTER MIDNIGHT`，source/dist 均为正式 Zero 路径，`assetComplete=true` 且 `48/48/0/true`；六类错误数组 `pageErrors/consoleErrors/requestFailures/unhandledRejections/rendererErrors/releaseFailures` 全部为空；核对结果 `BAD=`。
- Task 8 Step 4 旧回归已在当前证据链中按顺序完成：
  - `npm run e2e:player-experience -w @surdet/shell` → exit `0`，Wave 2 A–I 全部 `9/9`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-S8Yg8g\task7-player-experience-matrix.json`；bytes=`755264`；SHA-256=`397F34B79A7FA7244D4EC3FC37627DC34E9EFCBFBA11C07D62154C7380D44DCC`。
  - `npm run e2e:player-shell-wave-3 -w @surdet/shell` → exit `0`，Wave 3 A–F 全部 `6/6`；正式标题=`《零点之后》`；artifact=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-shell-wave-3-anema3\task7-player-shell-wave-3-matrix.json`；bytes=`81843`；SHA-256=`75570ED8D0F645CA415526411D494079207A819754EA93BD08A155FB77F2F886`；6 个独立 userData/新 Electron。
  - `npm run e2e -w @surdet/shell` → exit `0`，Shell baseline `saved=true`、`loaded=true`、`steps=55`、`choices=41`、最终 `awaiting-choice/choice`、scene=`ch01_01`；该命令是 Starter baseline，不冒充正式 Zero 矩阵。
  - `npm run e2e:renderer-v2 -w @surdet/shell` → exit `0`；Renderer v2 视觉/语义候选全部通过，错误/请求/资源断言通过；视觉结果继续标记 `CANDIDATE`。本次 manifest=`E:\surdet\packages\shell\e2e\artifacts\renderer-v2-review-2026-08-11T20-01-15-686Z-42764\manifest.json`；bytes=`25099`；SHA-256=`77E2206BA56F9286D7C0FC7BA0E856716E62C391D3002A88484543B54B2F8BAE`。
- 旧完整矩阵的真实失败仍保留且不改写：第二轮早期执行 exit `3221226505`（`0xC0000409`），根目录=`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-BeQmhV`，H 启动阶段无最终 JSON；后续单例 H 诊断通过，且两份最终 schema 矩阵通过。该历史失败不被绿色轮次抹除。
- Task 8 Step 5 已精确提交且未暂存本计划：`git commit -m "test(shell): gate player experience wave 4"` → `38e8a62be9429bcdcf3255dbcb49da51a58c69ab`；`git log -1` 已读取真实提交。提交文件仅为 `packages/shell/e2e/player-experience-wave-4.e2e.mjs` 与 `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts`，`packages/shell/package.json` 无本轮未提交差异。
- Task 8 状态：Step 1–5 全部完成；Task 8 完整玩家矩阵、schema 证据和 Wave 2/3 旧回归均完成。下一入口：Task 9 Step 1，按依赖顺序运行全量测试；不得 push。

### Task 9 — full verification in progress

- Task 9 Step 1 已按依赖顺序完成，所有命令 exit `0`：
  - `npm run test -w @surdet/core` → `23 files / 305 tests passed`。
  - `npm run test -w @surdet/renderer` → `49 files / 396 tests passed`。
  - `npm run test -w @surdet/host` → `11 files / 84 tests passed`。
  - `npm run test -w @surdet/shell` → `17 files / 130 tests passed`。
  - `npm run test -w surdet-starter` → `4 files / 7 tests passed`，真实 Vite HMR 合法→非法→恢复流程通过。
  - `npm run test -w zero-after-midnight` → `verify-simulation assets=44, scenes=11, endings=3`；`2 files / 21 tests passed`。
  - `npm run test -w @surdet/cli` → `7 files / 87 tests passed`。
- 上述测试仅产生测试临时目录/ignored dist；未修改四个受保护文件，未触碰性能 artifact、门限、素材或剧情。下一入口：Task 9 Step 2，依赖顺序构建与类型检查。
- Task 9 Step 2 已按计划顺序完成且全部 exit `0`：Core build/typecheck；Renderer build/typecheck；Host build/typecheck；Shell build/typecheck（含 sandbox preload）；Starter typecheck/build；Zero typecheck/build；CLI typecheck/build。构建仅更新 ignored dist，不产生 tracked 源码差异。下一入口：Task 9 Step 3，正式 Zero lint/simulate/assets。
- Task 9 Step 3 已完成且全部 exit `0`：`npm run lint -w zero-after-midnight` → `11 个场景，0 个错误，0 个警告`；`npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` → 探索 24 条、choice `23/23`、save/load `39`、3 个结局可达、运行时错误 `0`；`node examples/zero-after-midnight/scripts/check-assets.mjs` → `assets ok: 44`。下一入口：Task 9 Step 4，仓库边界与总门禁。
- Task 9 Step 4 已完成且全部 exit `0`：`npm run verify:renderer-boundaries` → 3/3；`npm run verify:renderer-legacy` → 4/4；`npm run verify:tools` → 10/10；`npm run verify:hygiene` → tracked 616 paths；`npm run verify:all` → exit `0`，包含 docs/hygiene/types/workspace tests/formal/editor/starter/Zero/build/diff-check 等步骤；显式 `git diff --check` → exit `0`；显式 tracked log 检查 → `tracked-log-count=0`。下一入口：Task 9 Step 5，编写真实交付报告。
- Task 9 Step 5 已真实创建权威报告：`E:\surdet\docs\ENGINE-PLAYER-EXPERIENCE-WAVE-4-DELIVERY-REPORT-2026-08-12.md`；当前字节数=`18082`；SHA-256=`AD8632D8BF8F043CC1E0B09FE80EA2555C197F59C53B751B08CD2A27CDD77C52`。报告以 `38e8a62be9429bcdcf3255dbcb49da51a58c69ab` 为报告前最终代码 HEAD，明确列出 G1–G6 红绿证据、正式 Zero 身份、两份 corrected A–J artifact、历史失败轮次、全量门禁和保护边界。下一入口：Task 9 Step 6，精确提交报告与计划台账。
