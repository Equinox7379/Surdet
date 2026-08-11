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

- [ ] **Step 1: 核对 HEAD、远端和工作树**

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

- [ ] **Step 2: 记录工具链与基线门禁**

Run:

```powershell
node --version
npm --version
npm run verify:all
git diff --check
git ls-files '*.log'
```

Expected: Node ≥20，`verify:all` exit 0，diff-check 通过，tracked log 为空。

- [ ] **Step 3: 建立红灯证据格式**

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

- [ ] **Step 4: 不提交纯基线操作**

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

- [ ] **Step 1: 先建立 Wave 4 E2E runner 骨架**

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

- [ ] **Step 2: 写 E2E 契约测试**

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

- [ ] **Step 3: 写 Gallery 单元和 Host 集成红灯**

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

- [ ] **Step 4: 复现 Case A 红灯**

Case A：标题可见 → 真实鼠标点击“鉴赏” → 点击“音乐” → 断言 tab=music → 点击“文本” → tab=text → 点击 CG → tab=cg → 关闭 → 回到纯标题。

Run:

```powershell
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A
```

Expected before fix: 非零退出，失败点与标题来源标签无反应一致。保存 artifact 路径和 SHA。

- [ ] **Step 5: 最小修复 Gallery 命中生命周期**

只根据红灯定位修改 `gallery-layer.ts`。必须保持：

- header/hitArea 在内容 rebuild 后仍挂载且可交互；
- `#clearContent()` 只释放内容 listeners，不移除 header 子节点 listeners；
- Gallery `#bringToFront()` 后隐藏 Menu/Title 不能成为命中目标；
- `pointerdown` 只切一次 tab并请求一帧；
- close 回调只执行一次。

不得针对 `source==='title'` 复制一套 Gallery UI。

- [ ] **Step 6: 运行绿灯**

```powershell
npm run test -w @surdet/renderer -- --run test/layers/gallery-layer.test.ts
npm run test -w @surdet/host -- --run test/renderer-player-shell-slots.test.ts
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case A
```

Expected: 全部 PASS；Case A 六类 unexpected 错误为空。

- [ ] **Step 7: 提交 Task 1**

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

- [ ] **Step 1: 写红灯**

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

- [ ] **Step 2: 删除整体 wake/fade 状态机**

从 `DialogueLayer` 移除仅服务整体淡入淡出的：

```ts
#commandRailWakeRemain
#commandRailIdleAlpha
#commandRailPointerWake
#wakeCommandRail()
```

以及对应 update/needsUpdate/tween lifecycle 逻辑。命令栏容器 root alpha 固定为 `1`；背景 Graphics 已自带 `0.82` alpha，保持其视觉强度。

`setCommandRailItems()` 允许 rebuild，但不得唤醒整条 rail。hover 继续只修改当前 row 的 label 与 underline。

- [ ] **Step 3: 运行绿灯与回归**

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/integration/resource-cycles.test.ts test/theme.test.ts
npm run typecheck -w @surdet/renderer
```

Expected: PASS；稳定 rail 不制造帧循环或资源活动项。

- [ ] **Step 4: 提交 Task 2**

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

- [ ] **Step 1: 写布局红灯**

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

- [ ] **Step 2: 实现明确布局常量和 mask**

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

- [ ] **Step 3: 运行绿灯和 Case C**

在 Wave 4 runner 实现 Case C：构造足量 Backlog，真实滚轮/PageDown，截图前后读取布局投影，断言 header 固定、正文裁剪、点击关闭不推进剧情。

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts test/backlog-search-controller.test.ts
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case C
```

- [ ] **Step 4: 提交 Task 3**

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

- [ ] **Step 2: 创建 Host 权威实现**

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

- [ ] **Step 3: 建立一版兼容入口**

`examples/shared/rollback-runtime.ts` 不再拥有算法，只 re-export Host API：

```ts
export { createRollbackRuntime } from '@surdet/host';
export type { RollbackRendererPort, RollbackRuntime, RollbackRuntimeOptions } from '@surdet/host';
```

Starter 和 Zero 直接从 `@surdet/host` import。两者 `onSystemBoundary` 改为调用 `rollbackRuntime.clearForBoundary()`，而新游戏、正式读档、save mismatch 等明确边界仍可调用 `clear()`。

- [ ] **Step 4: 运行连续回退绿灯**

```powershell
npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts
npm run test -w surdet-starter -- --run test/rollback-runtime.test.ts
npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts
```

Expected: 连续五次、边界清理、失败回滚、恢复期间不清历史全部通过。

- [ ] **Step 5: 实现并运行 Case D**

Case D 真实推进至少 8 条文本，记录每条位置/文本，真实连续点击右下角“回退”四次；每次断言恰好前一状态，中间不得推进。

```powershell
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case D
```

- [ ] **Step 6: 提交 Task 4**

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

- [ ] **Step 1: 写 Core 预验证红灯**

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

- [ ] **Step 2: 在 Core 实现无副作用 Presentation 预验证**

在完整 snapshot 迁移和 current schema 校验之后、所有 runtime 写入之前执行：

```ts
const presentationPayload = snap.presentation?.payload ?? null;
this.#presentationHooks?.validate?.(presentationPayload);
```

原有 `SystemHooks.validate` 与 Presentation validate 都必须先完成，之后才允许 restore Core/System/Presentation。

- [ ] **Step 3: 写 Host connection 红灯**

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

- [ ] **Step 4: 实现 Host connection**

连接逻辑只使用公共 API：

```ts
options.interpreter.setPresentationHooks({
  snapshot: () => options.renderer.queries.presentation.snapshot(),
  validate: (payload) => options.renderer.commands.presentation.validate(payload),
  restore: (payload) => options.renderer.commands.presentation.restore(payload),
});
```

`disconnect()` 调用 `setPresentationHooks(null)` 且幂等。不得导入 Layer、Pixi 对象或 Renderer internals。

- [ ] **Step 5: 运行 Core/Host 绿灯**

```powershell
npm run test -w @surdet/core -- --run test/interpreter-save.test.ts
npm run test -w @surdet/host -- --run test/presentation-connection.test.ts
npm run typecheck -w @surdet/core
npm run typecheck -w @surdet/host
```

- [ ] **Step 6: 提交 Task 5**

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

- [ ] **Step 1: 写标题残留红灯**

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

- [ ] **Step 2: 实现公共进入标题顺序**

权威顺序固定为：

```ts
options.shell.commands.reset('title');
options.renderer.resetSession({ preserveWorld: false });
options.openTitle();
```

`openTitle()` 只负责投影 title slot/view，不允许再次 preserve game World。若实际 Provider 补偿要求调整顺序，必须用测试证明失败时仍一致，并同步更新本文，不得暗改语义。

- [ ] **Step 3: 运行 Host 绿灯**

```powershell
npm run test -w @surdet/host -- --run test/player-title-session.test.ts test/player-shell-controller.test.ts test/player-shell-slots.test.ts
npm run typecheck -w @surdet/host
```

- [ ] **Step 4: 提交 Task 6**

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

- [ ] **Step 1: 写防漏接线红灯**

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

- [ ] **Step 2: 接入 Presentation connection 生命周期**

每个组合根在 Interpreter 与 Renderer Runtime 创建后：

```ts
const presentationConnection = connectInterpreterPresentation({ interpreter: interp, renderer: runtime });
```

dispose/HMR teardown 必须先 `presentationConnection.disconnect()`，再 dispose runtime。删除 Starter 的手写 `setPresentationHooks` 和 Zero 的缺失状态。

- [ ] **Step 3: 接入公共标题边界**

把 `showTitleScreen()` 中分散的 shell reset/world preserve 逻辑替换为 `enterPlayerTitleSession()`。游戏仍提供 `titleView()` 和 title 背景，但不得保留上一局 World。

从标题关闭设置/鉴赏/读档仍回到 title；从游戏关闭则回到 game。不得破坏已有 Player Shell source 栈。

- [ ] **Step 4: 写 Zero 存读档集成测试**

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

- [ ] **Step 5: 实现 Case E/F/G/H/B**

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

- [ ] **Step 6: 实现 Case I/J 与旧体验回归**

- I：等待 5 秒、推进 20 条，command rail root alpha 固定；hover 仅单按钮。
- J：F11 进入/退出全屏，画面完整、交互目标仍命中；不改变 contain 策略。

同时回归：空槽 no-op、菜单不推进、H 恢复不推进、Backlog 在正文之上、无 `Renderer resource release failed`。

- [ ] **Step 7: 运行采用层绿灯**

```powershell
npm run test -w surdet-starter
npm run test -w zero-after-midnight
npm run test -w @surdet/cli -- --run test/new.test.ts
npm run typecheck -w surdet-starter
npm run typecheck -w zero-after-midnight
npm run build -w surdet-starter
npm run build -w zero-after-midnight
```

- [ ] **Step 8: 提交 Task 7**

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

- [ ] **Step 1: 完成 A–J 全部断言**

每 case 必须记录：游戏标题、sourceRoot、distRoot、独立 userData、真实交互步骤、语义断言、六类错误数组、资产加载完成状态。正式项目资产口径仍由 `check-assets` 的 44 项给出，Renderer URL 请求数不得冒充项目资产数。

- [ ] **Step 2: 运行 smoke**

```powershell
npm run e2e:player-experience:wave4 -w @surdet/shell -- --smoke
```

Expected: 正式 Zero dist 启动、标题正确、资产完成、A 的最小路径通过。

- [ ] **Step 3: 运行两轮独立正式矩阵**

```powershell
npm run e2e:player-experience:wave4 -w @surdet/shell
npm run e2e:player-experience:wave4 -w @surdet/shell
```

两轮都必须 A–J 10/10。不得覆盖第一轮 artifact；报告每轮绝对路径、字节数、SHA-256。不得挑一轮绿灯掩盖另一轮失败。

- [ ] **Step 4: 运行旧 Wave 2/3 回归**

```powershell
npm run e2e:player-experience -w @surdet/shell
npm run e2e:player-shell-wave-3 -w @surdet/shell
npm run e2e -w @surdet/shell
npm run e2e:renderer-v2 -w @surdet/shell
```

Expected: 旧玩家矩阵、Shell baseline、Renderer v2 语义验收全部通过；视觉图片仍标 `CANDIDATE`，不得冒充永久金样。

- [ ] **Step 5: 提交最终 E2E harness**

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

- [ ] **Step 1: 按依赖顺序运行聚焦与全量测试**

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

- [ ] **Step 2: 运行类型检查与构建**

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

- [ ] **Step 3: 运行正式游戏门禁**

```powershell
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
node examples/zero-after-midnight/scripts/check-assets.mjs
```

Expected: 11 场景、23/23 choice、3 结局、39 次存读档 smoke、44 项资产、0 errors、0 warnings、0 runtime errors。

- [ ] **Step 4: 运行仓库总门禁**

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

- [ ] **Step 5: 编写权威交付报告**

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
