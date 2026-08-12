# Surdet Player Experience Wave 5A — Rollback Black-Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 调查玩家在《零点之后》真实 Electron 路径中报告的“连续点击回退后画面逐渐变暗、最终黑屏；切换场景后才恢复”现象；对有直接红灯证据的公共 history/事务边界做最小修正，并用预先声明的、多进程、多轮真实鼠标回退证据区分“协议下未复现”和“玩家根因已确认”。

**Architecture:** 先在 Host 回退事务、Renderer PresentationController、WorldLayer/WorldEffectsController 之间建立可观测的状态不变量，再用最小红灯定位真正的失效点。修复必须落在 `packages/host` / `packages/renderer` 的公共回退与表现恢复路径；《零点之后》只允许继续使用现有公共接口和 E2E 入口，不允许在游戏侧加“黑屏后强制重绘”或其他补丁。回退成功后，Renderer 的世界表现必须与被恢复检查点的表现快照一致，旧的淡出、调色、转场、擦除、粒子和时间轴回调不得在恢复完成后再次写入旧状态。

**Tech Stack:** TypeScript 5.7、Vitest 3、PixiJS、Electron 43、Playwright、Node.js 20+、npm workspaces。

## Global Constraints

- 开工基线必须先记录当前 `HEAD`；本计划生成时基线为 `2edc65d55cae85bd7fd296501c5e2d896d36be9d`。若实际开工 HEAD 不同，以真实命令输出为准，不得 reset、rebase 或覆盖用户变化。
- 用户实机反馈本身就是合法缺陷证据。自动化初次未复现时，不得据此宣布“没有问题”；必须先检查是否只断言了内部位置、是否没有读取可见表现、是否没有使用真实鼠标/键盘，或是否遗漏了时序窗口。
- 本轮只处理回退黑屏与其直接的公共恢复契约；不处理性能测量、性能优化、M9、资产、音频、剧情、DSL、存档格式、文档治理、发行或 EXE 打包。
- 修复优先落在 `packages/host`、`packages/renderer`；除非公共接口确实缺少接线，禁止修改 `examples/zero-after-midnight` 的游戏逻辑来掩盖引擎缺陷。
- 不保留无必要的兼容层、migration、fallback 或预防性配置。先复现并定位，再做满足当前需求的最小实现；不要顺手重构附近代码。
- 每个生产修复都必须先有合法红灯或用户反馈对应的可追踪失败证据。不得为了制造红灯而写与真实行为无关的断言；不得通过增加重试、删除异常样本、放宽阈值或挑选绿色轮次来“修复”报告。
- 回退事务必须是单一拥有者：恢复尚未完成时，新的回退输入只能被安全消费为 no-op，不得再次修改解释器、历史栈、表现层或音频。
- 恢复成功后的不变量：背景、立绘、相机、`fadeAlpha`、调色叠加、转场/擦除/闪光/缩放/粒子、时间轴和对话位置都与目标检查点一致；若目标快照明确包含非零效果，则保留该效果，否则不得残留旧效果。
- 恢复失败后的不变量：解释器、表现快照、音频快照和回退历史保持可重试；错误原样传播/记录；不得留下黑屏或半恢复状态。
- 受保护未跟踪文件不得触碰：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`。不得为了清理工作树而删除或移动它们。
- 不得 push、force push、rebase、reset、amend、squash、cherry-pick 或任何历史改写。完成后停在 `WAITING_FOR_REVIEW`，等待总经理批准后才允许推送。
- 不创建或跟踪 `.log`。大型 Electron 截图和 JSON 证据写入系统临时目录；报告中重新读取字节数和 SHA-256。

---

## Task 0: 冻结基线、边界与玩家红灯台账

**Files:**

- Modify: `docs/superpowers/plans/2026-08-12-player-experience-wave-5a-rollback-black-screen.md`
- Create at final task: `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-5A-ROLLBACK-BLACK-SCREEN-DELIVERY-REPORT-2026-08-12.md`

**Interfaces:**

- Consumes: 当前 Git HEAD、远端关系、Wave 4 的正式 Zero Electron 入口与用户实机反馈。
- Produces: 不可变开工基线、受保护文件清单、工具链版本、红灯/绿灯证据索引。

- [ ] **Step 1: 只读核对工作树和远端**

Run:

```powershell
git rev-parse HEAD
git log -5 --oneline
git rev-list --left-right --count HEAD...surdet/main
git status --short
git worktree list --porcelain
```

Expected:

- 记录真实 HEAD、远端差异和全部未跟踪文件；
- 保留上述五个受保护文件，不执行 clean、reset、checkout 或删除；
- 若发现执行 AI 尚有未提交源码变更，先记录路径并停在报告，不覆盖它。

- [ ] **Step 2: 记录工具链和基线门禁**

Run:

```powershell
node --version
npm --version
npm run verify:all
git diff --check
git ls-files '*.log'
```

Expected: 基线 `verify:all` 退出码 0，diff-check 通过，tracked log 为空。若基线门禁失败，先报告，不把基线失败归因于本轮。

- [ ] **Step 3: 把玩家反馈写入红灯台账**

在本计划中记录以下事实，不把它降级为“可能的视觉问题”：

```text
PLAYER_RED_PATH=正式《零点之后》→开始新游戏→推进到可回退文本→连续点击 rail:rollback
PLAYER_RED_SYMPTOM=画面逐次变暗，可能直接黑屏；菜单仍可点击；切换场景后恢复
PLAYER_RED_TIMING=发生次数不稳定，约 7–10 次，也可能一次回退后保持；不能用 1–2 次未复现作为通过
```

---

## Task 1: 建立真实玩家路径的黑屏诊断探针（先不改生产代码）

**Files:**

- Create: `packages/shell/e2e/player-experience-wave-5a-rollback-black-screen.e2e.mjs`
- Create: `packages/shell/test/player-experience-wave-5a-e2e-contract.test.ts`
- Modify: `packages/shell/package.json`

**Interfaces:**

- Consumes: `packages/shell/e2e/player-experience-wave-4.e2e.mjs` 的正式 Zero 构建、独立 Electron、独立 `userData`、语义只读 debug surface 和真实 `page.mouse` 输入模式。
- Produces: 可重复运行的回退黑屏 artifact；只读证据，不把 debug command 当玩家输入。

- [ ] **Step 1: 先写 runner 契约测试**

`player-experience-wave-5a-e2e-contract.test.ts` 必须静态断言 runner：

- 明确构建并加载 `E:\\surdet\\examples\\zero-after-midnight\\dist`；不得以 `examples/starter/dist` 作为正式游戏入口；
- 每个 session 创建独立 Electron 进程和独立临时 `userData`；
- 回退通过 `page.mouse.click()` 点击真实 `rail:rollback` 目标，或使用真实键盘绑定；不得调用 `performRollback()`、debug action 或直接改变解释器位置；
- 每次回退前等待语义稳定：`status === 'awaiting-advance'`、`activeOverlay === null`、`uiSession.operation === 'idle'`、`rendererStatus !== 'typing'`；不得用固定 sleep 代替状态同步；
- artifact 即使 case 失败也保留 `events`、`assertions`、`screenshots`、`lastSnapshot`、`error` 和 `errorStack`；
- 收集 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures`；
- 记录实际运行时 `git rev-parse HEAD`，不得写死旧提交号；
- 支持以下命令：

```powershell
npm run e2e:player-experience:wave5a -w @surdet/shell -- --smoke
npm run e2e:player-experience:wave5a -w @surdet/shell
```

Run:

```powershell
npm run test -w @surdet/shell -- --run test/player-experience-wave-5a-e2e-contract.test.ts
```

Expected: 契约测试通过；这一步只证明探针没有偷换入口或证据，不等于产品已通过。

- [ ] **Step 2: 固定多轮抽样协议**

runner 不允许通过命令行降低门槛，正式协议固定为：

```text
独立 session：8
每个 session：20 次有效回退尝试
总尝试：160
session 1–4：settled 模式（每次等待两帧 + 语义稳定）
session 5–8：rapid 模式（状态稳定后尽快再次输入，不使用固定延时；记录输入间隔）
每个 session：独立 Electron + 独立临时 userData
```

每个 session 使用循环“推进 4 条文本 → 回退 4 次”补充历史，重复 5 个 cycle，确保 20 次不是在无历史 no-op 上刷数量。每次循环保留实际位置、文本、背景、立绘和回退结果。

- [ ] **Step 3: 记录恢复前后完整表现证据**

每次回退前和完成后读取只读 `window.__surdetDebug` 快照，至少保留：

```ts
{
  position,
  status,
  rendererStatus,
  uiSession,
  activeOverlay,
  presentationSnapshot: {
    stage: {
      backgroundKey,
      portraits,
      cameraScale,
      cameraPan,
      fadeAlpha,
      tint,
      particleKind,
    },
    timelines,
  },
  dialogueProjection,
  resourceSnapshot,
  resourceLedger,
  lastRendererError,
}
```

同时对完整 canvas 做截图，使用现有截图 helper 的 PNG 哈希，并在浏览器端从渲染画布采样以下诊断值：

- `meanLuma`：RGB 加权平均亮度；
- `blackPixelRatio`：RGB 三通道均小于 8 的像素比例；
- `canvasWidth`、`canvasHeight`、`pixelHash`。

像素指标只作为可见性证据，不能替代表现快照。若目标检查点有背景且 `fadeAlpha <= 0.01`、`tint.alpha <= 0.01`，而恢复后 `fadeAlpha >= 0.99` 或 `blackPixelRatio >= 0.985`，立即判定该尝试失败并保存截图；不能重新运行直到出现绿色。

- [ ] **Step 4: 执行基线探针并保存原始失败**

Run:

```powershell
npm run e2e:player-experience:wave5a -w @surdet/shell -- --smoke
npm run e2e:player-experience:wave5a -w @surdet/shell
```

Expected:

- smoke 只验证入口、资产和一次回退路径；
- 正式运行执行完整 8×20 协议；
- 若任何尝试出现黑屏、表现快照不一致、释放错误、窗口异常退出或页面/控制台错误，artifact 必须为 `FAILED` 并保留所有中间证据；
- 若 160 次没有自动复现，也只能写成“本轮未自动复现，玩家实机红灯仍有效”，不得宣布修复，更不得凭猜测修改生产代码。

---

## Task 2: 为回退事务和表现恢复建立合法红灯

**Files:**

- Modify: `packages/host/test/rollback-runtime.test.ts`
- Modify: `packages/renderer/test/integration/presentation-clear.test.ts`
- Modify: `packages/renderer/test/world-effects-controller.test.ts`

**Interfaces:**

- Consumes: `createRollbackRuntime()`、`RuntimePresentationController.resetSession()` / `restorePresentation()`、WorldLayer 的表现快照和效果清理契约。
- Produces: 能区分“历史栈错误”“重入回退”“过期效果回写”“快照不一致”的聚焦红灯。

- [ ] **Step 1: 先写 Host 重入红灯**

新增测试必须模拟真实 UI 可能产生的重入：在第一次 `renderer.resetSession()` 或 `renderer.restorePresentation()` 回调中再次调用同一个 runtime 的 `perform()`。预期：外层成功，内层返回 `false`，历史只消费一帧，`onRefresh` 只为外层事务执行一次，且不产生第二次 `loadSnapshot` / `restorePresentation`。

示意契约：

```ts
let runtime: RollbackRuntime;
let nestedResult: boolean | null = null;
const renderer = fakeRenderer({
  resetSession: () => { nestedResult = runtime.perform(); },
});
runtime = createRollbackRuntime(makeOptions(renderer));

expect(runtime.perform()).toBe(true);
expect(nestedResult).toBe(false);
expect(renderer.restoreCalls).toBe(1);
```

若基线该测试已经通过，保留测试作为回归并把红灯来源记为玩家/电子探针；不得伪造失败。

- [ ] **Step 2: 写表现快照不变量红灯/回归**

使用真实 `PresentationController` 或现有测试工厂启动背景、立绘、fade/tint/transition/wipe/particle 中至少两种效果，捕获稳定快照，然后执行 reset → restore → 若干次 `update()`。断言：

- 恢复后背景和立绘存在；
- `fadeAlpha`、`tint` 等值与目标快照一致；
- 旧的效果没有在后续 `update()` 中把画面改黑；
- `timeline` 集合只包含目标快照中的时间轴；
- `resourceSnapshot` 没有随回退次数单调增长；
- 失败恢复不清除原状态，也不产生 `RendererError`。

测试必须保存失败时的快照和效果值；不能只断言“没有抛异常”。

- [ ] **Step 3: 运行聚焦红灯**

Run:

```powershell
npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts
npm run test -w @surdet/renderer -- --run test/integration/presentation-clear.test.ts test/world-effects-controller.test.ts
```

Expected: 至少有一条失败与重入/效果残留不变量相符，或明确记录“聚焦测试全部通过，自动化红灯仅来自正式玩家矩阵/手工反馈”。没有合法红灯时不得猜修生产代码。

---

## Task 3: 根据证据实施最小引擎修复

**Files (只修改被 Task 1–2 证据指向的最小子集):**

- Modify when indicated: `packages/host/src/rollback-runtime.ts`
- Modify when indicated: `packages/renderer/src/runtime/presentation-controller.ts`
- Modify when indicated: `packages/renderer/src/layers/world/world-layer.ts`
- Modify when indicated: `packages/renderer/src/world-effects-controller.ts`
- Modify: 对应 Task 2 测试文件

**Interfaces:**

- Consumes: Task 1 的原始 artifact、Task 2 的红灯和现有公开 Presentation/World port。
- Produces: 一个不可重入、可回滚、不会被旧效果回写污染的公共回退事务。

- [ ] **Step 1: 先写状态不变量，再改代码**

在计划台账中明确本次被证明的根因属于以下哪一类（只能选择有证据的一类或多类）：

```text
HOST_REENTRY              = 回退事务可重入，第二次输入修改了历史/状态
STALE_PRESENTATION_WRITE  = reset/restore 后旧 fade/tint/timeline 回调仍可写入
SNAPSHOT_CAPTURE_RACE     = 检查点在表现未稳定时捕获了中间黑屏状态
WORLD_EFFECT_RESET_GAP    = WorldLayer/WorldEffectsController 清理漏掉了实际遮罩或效果
OTHER_WITH_EVIDENCE       = 只有在报告中给出调用链、快照和测试证据时允许
```

- [ ] **Step 2: 实施最小修复**

修复必须满足：

- `perform()` 在 `restoring` 期间立即返回 `false`，不 pop/push 历史、不调用解释器和 Renderer；
- reset/restore 形成一个明确的事务边界；所有旧的异步/动画回调在边界后失效；
- `fadeOverlay.alpha`、tint overlay、wipe/flash/zoom、粒子和 transition registry 的清理/恢复路径一致；
- restore 的目标快照在清理可见状态前完成验证和资源准备；资源准备失败时保留旧投影；
- 成功后只请求必要帧，不添加永久 ticker 或全局定时器；
- 不在《零点之后》里增加“黑屏检测后重绘”“切场景强制修复”或第二套回退算法。

推荐的最小保护形态（必须按真实根因调整，不得机械照抄）：

```ts
const perform = (): boolean => {
  if (restoring || !canRollback()) return false;
  // pop → reset → load → restore → audio restore
  // finally 只释放本次事务的 owner，并调用一次 onRefresh
};
```

- [ ] **Step 3: 修复后立即重跑同一红灯**

Run 与 Task 2 完全相同的命令。Expected：原失败转绿；重入调用无副作用；恢复后多次 `update()` 和下一帧渲染仍不黑；失败路径仍能重试。

---

## Task 4: 运行正式多轮回退验收，不把一次绿色当作结论

**Files:**

- Modify: `packages/shell/e2e/player-experience-wave-5a-rollback-black-screen.e2e.mjs`（只在证据需要补充断言时）
- Modify: `packages/shell/test/player-experience-wave-5a-e2e-contract.test.ts`（同步契约）

- [ ] **Step 1: 运行完整 8×20 协议**

Run:

```powershell
npm run e2e:player-experience:wave5a -w @surdet/shell
```

Expected：160/160 回退尝试通过，且每一轮恢复后的表现快照、可见背景/立绘和 canvas 证据都满足不变量。任何一次黑屏或异常都使正式结果为 `FAILED`。

- [ ] **Step 2: 复核历史失败证据没有被覆盖**

把修复前 artifact、截图、失败栈保存在临时目录并在报告中列出绝对路径、字节数和 SHA-256。不得把同名新 artifact 覆盖旧红灯；不得把失败截图加入仓库。

- [ ] **Step 3: 运行受影响模块门禁**

Run:

```powershell
npm run test -w @surdet/host
npm run test -w @surdet/renderer
npm run test -w @surdet/shell -- --run test/player-experience-wave-5a-e2e-contract.test.ts
npm run typecheck -w @surdet/host
npm run typecheck -w @surdet/renderer
npm run typecheck -w @surdet/shell
npm run build -w @surdet/host
npm run build -w @surdet/renderer
npm run build -w @surdet/shell
```

若公共层、Shell runner 或模板接线发生实际变化，再运行：

```powershell
npm run verify:all
```

不得把性能资格化或旧版 A/B 重新纳入本轮。

---

## Task 5: 交付报告、计划收口与停止

**Files:**

- Create: `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-5A-ROLLBACK-BLACK-SCREEN-DELIVERY-REPORT-2026-08-12.md`
- Modify: `docs/superpowers/plans/2026-08-12-player-experience-wave-5a-rollback-black-screen.md`

- [ ] **Step 1: 报告必须逐项回答**

报告至少包含：

- 用户红灯路径和为什么被视为合法证据；
- 基线 HEAD、实际修改文件、已验证的公共行为调用链和未确认的玩家根因边界；
- Task 2 红灯命令、失败断言、修复命令、绿灯结果；
- 8 个独立 session、160 次回退的汇总，以及每个失败/截图/原始 JSON 的绝对路径和 SHA-256；
- 每次回退的背景、立绘、fade/tint、timeline、canvas meanLuma/blackPixelRatio 证据；
- page/console/request/unhandled/RendererError/releaseFailure 汇总；
- 受影响模块测试、typecheck、build、`verify:all` 的真实退出码；
- 未解决的证据缺口（例如本轮自动化未重现但玩家仍可偶发重现）；
- Git HEAD、`git status --short`、`HEAD...surdet/main`、是否提交/是否 push。

- [ ] **Step 2: 收口状态**

若正式 8×20 协议、聚焦测试和门禁均通过，且玩家黑屏仍未在该预定义协议下复现：

```text
DEFENSIVE_GUARDS_ADDED
CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL
FINAL_COMMIT_EVIDENCE_QUALIFIED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```

若压力协议仍出现黑屏或无法解释的表现不一致：

```text
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_REPRODUCED_OR_EVIDENCE_INCONSISTENT
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```

无论哪种状态都不得进入 Wave 5B、M9、性能或发行；先把报告交给总经理复审。

---

## Execution Ledger

> 本台账按 Task 0 → Task 5 顺序持续更新。所有路径、退出码、SHA-256 和提交哈希均以磁盘与 Git 实际读取结果为准；未完成阶段不得预填未来结果。

### Task 0 — completed (2026-08-12)

- `HEAD`: `2edc65d55cae85bd7fd296501c5e2d896d36be9d`
- `git rev-list --left-right --count HEAD...surdet/main`: `0 0`
- `git log -5 --oneline` 首行：`2edc65d docs(engine): record wave 4 evidence remediation`
- Node/npm：`v24.15.0` / `11.12.1`
- `npm run verify:all`: exit code `0`
- `git diff --check`: exit code `0`
- `git ls-files '*.log'`: 空
- 起始工作树中保留的未跟踪文件：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术方向/交接文档，以及已授权的 Wave 5A 任务书和一个既有 Wave 5B 任务书。后两份 Wave 5B/5A 计划均未被清理或纳入本 Task 0 以外的范围；五个受保护文件全程不触碰。
- 当前玩家红灯路径已登记：正式《零点之后》开始游戏，推进到可回退文本，连续真实回退后画面逐次变暗或黑屏，菜单仍可操作，切换场景恢复；本轮必须用正式 Electron 与真实输入验证，不能以未复现替代结论。
- 下一入口：Task 1，先创建并运行正式回退诊断协议/契约测试，取得合法红灯或保留未复现证据。

### Task 1 — implemented, smoke verified (2026-08-12)

- 红灯（先测）：`npm run test -w @surdet/shell -- --run test/player-experience-wave-5a-e2e-contract.test.ts` 在 runner/命令不存在时 exit code `1`，5/5 失败；失败原因为专用命令未注册、runner 文件不存在。
- 设施实现：新增 `packages/shell/e2e/player-experience-wave-5a-rollback-black-screen.e2e.mjs`，新增 `@surdet/shell` 的 `e2e:player-experience:wave5a` 命令；只使用正式 Zero dist、独立临时 userData、真实 `page.mouse.click`/键盘输入，证据写入系统临时目录。
- 绿灯：同一契约命令 exit code `0`，5/5 通过；`node --check` exit code `0`。
- Smoke：第一次因 runner 错把不存在的 `dist/game.config.json` 当作必需文件，exit code `1`；该 harness artifact 保留，未覆盖。修正入口校验后第二次真实 smoke exit code `1` 但不是玩家失败：1 个独立 Electron session 完成 4/4 有效回退，状态为 smoke/FAILED 仅因为 smoke 未达到正式 160 次协议；正式入口 `file:///E:/surdet/examples/zero-after-midnight/dist/index.html`，资产 `48/48`，page/console/request/unhandled/renderer/release/unexpected-close 全为 `0`，所有 4 个回退后的 canvas `meanLuma` 约 `0.0844–0.0873`、`blackPixelRatio` 约 `0.1779–0.1784`，未见黑屏。
- Smoke artifact（保留）：修正入口校验后的真实 smoke artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-ZwHx7u\wave-5a-smoke.json`，bytes `208691`，SHA-256 `4a9b2577b69e68f352ea8cacadc57f51f875ef8bc6fc950d546a4737cde0f34e`；前一次入口校验失败 artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-nzxZck\wave-5a-smoke.json`，bytes `1699`，SHA-256 `450b56d943d153dc13cb60003f44f1ee04eaaad61576a510890012ba88205390`，均保留且未覆盖。
- 结论：本 Task 只证明诊断设施和一次短路径可用，不能推翻玩家红灯，也不能将 G1/黑屏改写为通过。下一入口：Task 2，先为 Host 重入和 Renderer 表现事务不变量建立/复验测试。

### Task 2 — red/green tests prepared (2026-08-12)

- Host 红灯（修复前）：`npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts` exit code `1`，4 tests 中 3 passed/1 failed；新增同步 `resetSession → runtime.perform()` 重入测试实际收到 `[false, true]`，并触发第二次 reset/host reset，违反单一恢复事务边界。
- Renderer 表现不变量：新增 `WorldLayer` 回退快照测试，覆盖 fade/tint/flash/wipe/zoom/move/shake/particle/transition 全部待处理效果；`npm run test -w @surdet/renderer -- --run test/layers/world-layer.test.ts test/legacy/presentation-controller.test.ts` exit code `0`，17/17 通过，当前 Renderer 已能在该直接测试中清理旧表现。
- 未在本 Task 修改 Host/Renderer 生产代码；红灯证据保留在测试历史与本台账，下一入口：Task 3，先以最小 `restoring` 守卫修复 Host 重入，再运行同一红灯转绿并继续基于正式 Electron 证据诊断表现回退。

### Task 3 — implemented, focused red→green (2026-08-12)

- 防御性不变量分类：`DEFENSIVE_REENTRY_GUARD_ADDED`。`reenterOnReset: true` mock future-invariant 测试证明：`createRollbackRuntime.perform()` 在外层恢复事务已取得 `restoring` 所有权后，若回调链同步再次进入 `perform()`，旧实现会重复消费历史并再次 reset/restore。该测试不证明真实玩家调用链会在 `resetSession` 内重入 `perform()`，也不是玩家黑屏根因复现。
- 最小生产修复：`packages/host/src/rollback-runtime.ts` 在 `canRollback()` 和 `perform()` 入口共同拒绝 `restoring` 状态；没有增加延时、debounce、永久 ticker、游戏特例或额外兼容层。
- 同一红灯转绿：`npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts` exit code `0`，4/4 通过；重入结果为 `[false]`，reset/host reset 各 1 次。
- 聚焦回归：Host rollback 4/4、Renderer WorldLayer/PresentationController 17/17、Wave 5A Shell contract 5/5，组合命令 exit code `0`。
- 受影响文件（生产/测试/诊断）：`packages/host/src/rollback-runtime.ts`、`packages/host/test/rollback-runtime.test.ts`、`packages/renderer/test/layers/world-layer.test.ts`、`packages/shell/package.json`、`packages/shell/e2e/player-experience-wave-5a-rollback-black-screen.e2e.mjs`、`packages/shell/test/player-experience-wave-5a-e2e-contract.test.ts`。下一入口：Task 4，运行不挑选轮次的正式 8×20（160 次）协议与受影响模块门禁。

### Task 4 — first formal run preserved as failure evidence (2026-08-12)

- 固定命令：`npm run e2e:player-experience:wave5a -w @surdet/shell`，exit code `1`；未降低 session/attempt/cycle 参数，也未重跑挑选绿色轮次。
- Artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-cojXwG\wave-5a-rollback-1786517221021.json`；8/8 session 均真实启动，前 4 settled、后 4 rapid；所有错误通道与 unexpected close 均为 `0`；但实际完成 `56/160` 次有效回退，8 个 session 都在 cycle 2 的第 4 次回退因没有合法历史而停止，故正式状态 `FAILED`。
- 诊断：失败栈一致指向 Wave 5A runner 的目标位置等待，不是黑屏；最后快照均为 `prologue:6`、`backgroundKey=apartment_night`、`fadeAlpha=0`、renderer `awaiting`，没有画面黑屏、资源释放失败或窗口退出。该 artifact 和所有中间截图保留，未被后续运行覆盖。
- 新红灯（cycle-boundary/history）：恢复到一个 cycle 的起点后，Host 历史栈没有保留该恢复检查点；下一轮正好推进 4 条文本时，第一次 rollback 会先消费当前重复帧，第四次因此变成无历史 no-op，违反任务书“每次 4 次有效回退”的固定协议。这是已验证的 history/no-op 边界缺陷，不是玩家黑屏根因结论。

### Task 3 follow-up — cycle-boundary red/green (2026-08-12)

- 红灯：新增 Host 连续 cycle 测试后，`npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts` exit code `1`，5 tests 中 4 passed/1 failed；第二个“4 advances → 4 valid rollbacks”周期第 4 次实际返回 `false`。
- 最小生产修复：成功恢复后将已恢复的目标帧作为当前 cycle boundary 重新放回回退缓冲；下一次 `perform()` 会先消费该当前重复帧，再消费前一历史帧。失败路径仍只放回一次目标帧，重入守卫保持不变。
- 同一测试转绿：Host rollback `5/5` exit code `0`；既有 Renderer WorldLayer/PresentationController `17/17` 仍通过。下一步重新执行同一固定正式 8×20，使用新临时目录，保留上述失败 artifact。

### Task 4 — formal protocol passed after evidence-surface correction (2026-08-12)

- 先行证据回归红灯：新增画布尺寸和 Zero `resourceLedger` 接线契约后，`npm run test -w @surdet/shell -- --run test/player-experience-wave-5a-e2e-contract.test.ts` 在生产/runner 未补齐时 exit code `1`，6 tests 中 `4 passed / 2 failed`；失败分别为 runner 未写入 `canvasWidth`/`canvasHeight`，以及正式 Zero debug 面未接出已有 `queries.diagnostics.resourceLedger()`。
- 最小证据修正后同一契约测试 exit code `0`，`6/6` 通过；`node --check packages/shell/e2e/player-experience-wave-5a-rollback-black-screen.e2e.mjs` exit code `0`。Zero 只读 debug 面新增 `resourceLedger` 查询接线，未改变游戏逻辑或回退行为；PNG 解析证据新增 `canvasWidth`/`canvasHeight`。
- 固定正式命令：`npm run e2e:player-experience:wave5a -w @surdet/shell`；本轮 exit code `0`，8 个独立 Electron session（前 4 个 `settled`、后 4 个 `rapid`）、160/160 有效回退通过。每 session 20 次、5 cycles，每 cycle 4 次真实文本推进后 4 次真实 `rail:rollback` 鼠标输入；没有 no-op 凑数或挑选轮次。
- 本轮正式 artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-EAYFom\wave-5a-rollback-1786518935217.json`，bytes `67859728`，SHA-256 `7d431465c097406c6ea7433a3cb554433604793a23344be6fa235e70248c6ae1`。artifact `status=PASSED`、`head=2edc65d55cae85bd7fd296501c5e2d896d36be9d`，每次快照要求字段均存在（包括 `resourceLedger`），640 张截图路径/字节数/SHA 全部复核一致，画布尺寸均为 `1211x681`。
- 本轮正式事件汇总：`pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`；恢复后 `maxAfterBlackPixelRatio=0.17835043670902193`、`minAfterMeanLuma=0.08445643722662997`，未出现黑屏、背景/立绘消失或表现快照不一致。
- 旧证据保留且未覆盖：首次正式失败 artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-cojXwG\wave-5a-rollback-1786517221021.json`，bytes `1151795`，SHA-256 `d092d6bee6060616ab803696ff2ab804bbe4ad71dfbc2d371a6864f0b201b50f`，实际 56/160，失败原因是固定协议暴露 Host cycle boundary 历史连续性缺口；前一轮修复后通过 artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-wHFple\wave-5a-rollback-1786518113941.json`，bytes `8132064`，SHA-256 `15f7f58fbe038a82b865ac6b135ff4491be44031788e68e7ef31ca35a2e0f17f`，本轮证据接线修正后再次按同一协议通过。
- Smoke 证据仍保留：入口校验失败 artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-nzxZck\wave-5a-smoke.json`，bytes `1699`，SHA-256 `450b56d943d153dc13cb60003f44f1ee04eaaad61576a510890012ba88205390`；修正入口校验后的真实 smoke artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-ZwHx7u\wave-5a-smoke.json`，bytes `208691`，SHA-256 `4a9b2577b69e68f352ea8cacadc57f51f875ef8bc6fc950d546a4737cde0f34e`，完成 4/4 有效回退但按协议因非正式 160 次而标记 smoke/FAILED。
- 下一入口：Task 5，运行受影响模块门禁，生成交付报告、收口台账并停止在 `WAITING_FOR_REVIEW`；不进入 Wave 5B、M9、性能或发行。

### Task 5 — historical closure record (superseded by fact/status closure) (2026-08-12)

- 实现提交已创建并读取真实值：`de235fe273df45e3d0021f3d3b32271458235542`，提交信息 `fix(host): guard rollback restore boundaries`。
- 交付报告已真实创建并提交：`E:\surdet\docs\ENGINE-PLAYER-EXPERIENCE-WAVE-5A-ROLLBACK-BLACK-SCREEN-DELIVERY-REPORT-2026-08-12.md`；最终磁盘 bytes `15264`，SHA-256 `00d2d2795cc5a494e394001a265e21f94b67161c9f3aa243c6e9a3b2799c4fc0`。
- 报告已写入：用户红灯路径、`DEFENSIVE_REENTRY_GUARD_ADDED` 与 cycle-boundary/history 行为证据、Task 2/3 红灯与绿灯、正式 8×20 证据、历史失败 artifact、截图/字段完整性审计、门禁、保护文件和停止边界；不应把它理解为玩家黑屏根因已经确认。
- 历史最终 artifact（非当前权威）：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-EAYFom\wave-5a-rollback-1786518935217.json`，bytes `67859728`，SHA-256 `7d431465c097406c6ea7433a3cb554433604793a23344be6fa235e70248c6ae1`，`PASSED`，8/8 session、160/160 attempts；其 `head=2edc65d55cae85bd7fd296501c5e2d896d36be9d`，状态为 `HISTORICAL_WORKTREE_EVIDENCE_NOT_COMMIT_BOUND`，不再作为最终提交的权威溯源证据。
- 受影响模块测试、typecheck、build 和仓库级 `npm run verify:all` 均已 exit code `0`；Renderer `49 files / 397 tests`，Host `11 files / 86 tests`，Wave 5A Shell contract `6/6`。
- 历史文档提交：`755fdea892df8b55ea14035076945cf02251eaca`，提交信息 `docs(player): deliver wave 5a rollback evidence`；其后在该历史 HEAD 上重新执行 `npm run verify:all`，exit code `0`。该历史记录不代表当前状态。
- 上一轮最终证据文档提交：`c1a6f3e1eb8b9065ed4602dc6bb423c173d48320`，提交信息 `docs(player): close wave 5a final evidence`；当前事实收口开始前真实 `HEAD=c1a6f3e1eb8b9065ed4602dc6bb423c173d48320`、`HEAD...surdet/main=4 0`、`git rev-list --count surdet/main..HEAD=4`；工作树只有六个既有未跟踪文件，未触碰。此次新文档提交后的真实 HEAD、ahead/behind 和工作树由最终只读复核记录。
- 当前停止状态（本轮修正前历史记录，已由下方事实收口覆盖）：不再使用 `PLAYER_EXPERIENCE_WAVE_5A_ROLLBACK_BLACK_SCREEN_REMEDIATED` 或 `ENGINE_LAYER_FIX_VERIFIED` 表示玩家问题已经闭合。

### Final evidence remediation — historical snapshot (superseded by fact/status closure) (2026-08-12)

- 收口前只读核对：`git rev-parse HEAD=95147d40fc71151577e7bf0528f345ab5c96491c`；`git rev-list --left-right --count HEAD...surdet/main=3 0`；工作树只有 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术方向/交接文档和既有 Wave 5B 计划这六个未跟踪文件。六个文件全程未触碰。
- 按固定正式协议重新执行一次：`npm run e2e:player-experience:wave5a -w @surdet/shell`，exit code `0`。本次从当前已提交 HEAD 重新构建并运行，使用新临时根目录和新独立 userData，没有复用旧 dist、旧 artifact 或旧截图；未调用 `performRollback()`、debug action、`titleSelect()` 或直接修改解释器位置。
- 新权威 artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-LNsj5z\wave-5a-rollback-1786521263206.json`；`bytes=67859787`；SHA-256=`259087456f6999d1405813c5ab3ec017c13ceb9b7af0347b455ae0d094b3d2e0`；`status=PASSED`；`head=95147d40fc71151577e7bf0528f345ab5c96491c`。
- 新 artifact 的独立磁盘复核：`actualSessions=8`、`actualAttempts=160`；8 个 session 各 `20/20`；前四个 `settled`、后四个 `rapid`；160 次 `validHistory=true`；每次都有 `before/after` 表现快照和 `backgroundKey`、`portraits`、`fadeAlpha`、`tint`、`timelines` 等字段。
- 截图完整性独立复核：640 条 screenshot records、640 个唯一路径；全部存在；字节数与 `canvasPngHash`/`screenshotSha256` 不匹配为 `0`。160 个 after canvas 的 `maxAfterBlackPixelRatio=0.17835043670902193`，未触发 `blackPixelRatio >= 0.985`。
- 所有事件错误数组和窗口状态独立复核为零：`pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`。
- 旧 artifact 保留为历史证据：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-EAYFom\wave-5a-rollback-1786518935217.json`；`head=2edc65d55cae85bd7fd296501c5e2d896d36be9d`；它在实现提交前生成，不再作为最终 HEAD 权威证据。
- 报告已纠正 Wave 5B 路径为 `docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md`。本次未修改该文件。
- `npm run verify:all` 未在本次证据收口重跑；仅引用此前独立 exit code `0`。本次未修改生产源码、未修改性能数据/门限、未进入 M9、未 push。
- 下一入口：创建唯一一份普通文档提交，仅包含本报告与本计划；提交后做只读 Git/报告磁盘核对，然后停止在 `WAITING_FOR_REVIEW`。

### Wave 5A fact/status closure — completed (2026-08-12)

- 本轮范围严格限制为本报告与本计划两份文档；未修改生产代码、测试逻辑、Runner、性能体系、DSL、存档、剧情、美术、音频或 Wave 5B 文件；未删除任何截图、artifact、失败 artifact 或历史证据。
- `CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`：`rollback.push(frame)` 已验证修复 cycle-boundary/history 的 no-op 缺陷；它不等于玩家黑屏根因已确认。
- `DEFENSIVE_REENTRY_GUARD_ADDED`：`restoring` 守卫保留为安全防御；`reenterOnReset: true` 仅是 future-invariant mock 测试，未证明真实玩家调用链会在 `resetSession` 内重入 `perform()`。
- `PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED`：玩家反馈的逐渐变暗/黑屏/切场景恢复根因仍未确认。
- `PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL`：新权威压力 artifact 只证明预定义 8×20 协议下未复现，不能外推为问题已闭合。
- 代码与 artifact 证据关系：`CODE_EVIDENCE_HEAD=95147d40fc71151577e7bf0528f345ab5c96491c`；`ARTIFACT_HEAD=95147d40fc71151577e7bf0528f345ab5c96491c`；两者一致，因此满足 `FINAL_COMMIT_EVIDENCE_QUALIFIED`。
- 文档提交关系：上一轮 `DOCUMENT_CLOSURE_HEAD=c1a6f3e1eb8b9065ed4602dc6bb423c173d48320`；本轮只创建一份新的普通 docs 提交，提交后的真实完整 SHA 由最终 `git rev-parse HEAD` 记录，不混同为代码或 artifact HEAD。
- 当前权威 artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-LNsj5z\wave-5a-rollback-1786521263206.json`；bytes `67859787`；SHA-256 `259087456f6999d1405813c5ab3ec017c13ceb9b7af0347b455ae0d094b3d2e0`；`status=PASSED`；8 sessions / 160 attempts；640 张截图完整性不匹配 `0`；所有错误通道 `0`。
- 本轮最终门禁：`npm run verify:all`、`git diff --check`、`git ls-files '*.log'` 的真实退出码/输出在文档提交后执行并写入最终回报；不进行性能工作、M9、发行、重新打包或 push。
- 最终状态：`DEFENSIVE_GUARDS_ADDED`、`CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`、`PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED`、`PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL`、`FINAL_COMMIT_EVIDENCE_QUALIFIED`、`NOT_PUSHED`、`WAVE_5B_NOT_STARTED`、`WAITING_FOR_INDEPENDENT_REVIEW`。
