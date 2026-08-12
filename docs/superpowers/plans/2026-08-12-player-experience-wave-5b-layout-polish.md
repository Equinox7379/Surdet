# Surdet Player Experience Wave 5B — Dialogue Layout Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在回退黑屏 Wave 5A 独立通过后，完成三项明确的 Renderer 视觉收口：把选择枝整体放到逻辑画布中央；让等待推进的小光点与右下角命令栏保持安全间距；把 Backlog 的“文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）”标题改成清晰的白色。

**Architecture:** 三项改动都落在公共 `DialogueLayer` 的布局与主题投影，不在《零点之后》里复制一套坐标或 CSS 补丁。选择枝采用真实卡片高度计算组中心；命令栏布局计算自己的安全锚点，小光点在命令栏可见时移动到命令栏左侧安全区，命令栏隐藏时保持原有等待位置；Backlog 标题沿用现有 RendererTheme 的 `colors.text`，不增加新的配置 token。测试直接检查真实 Pixi display 的位置、尺寸、可见性和主题 token，并用一次正式 Zero Electron 截图确认最终画面。

**Tech Stack:** TypeScript 5.7、Vitest 3、PixiJS、Electron 43、Playwright、Node.js 20+、npm workspaces。

## Global Constraints

- 本计划只能在 Wave 5A 黑屏任务获得总经理批准后开始；Wave 5A 未通过或仍有未解释黑屏时，停止，不进入本计划。
- 本轮只处理选择枝、继续指示器和 Backlog 标题颜色；不处理回退、性能、M9、资产、音频、剧情、DSL、存档格式、文档治理、发行或 EXE 打包。
- 公共能力优先修改 `packages/renderer/src/layers/dialogue/dialogue-layer.ts`；不得在 `examples/zero-after-midnight` 写游戏专属偏移量、覆盖层或重绘补丁。
- 选择枝中心以逻辑画布 `1280×720` 的几何中心为准，不以窗口装饰、实际 OS 窗口大小或当前显示器缩放为准。
- 继续指示器不得与命令栏背景、任何命令栏 slot 或其点击区域相交；命令栏隐藏时仍必须可见且位于原有等待安全区。
- Backlog 标题使用现有主题 `colors.text`（白色），不能用新的硬编码颜色，也不能把正文滚动层移回标题之上。
- 不添加永久 ticker、定时器、兼容层、migration、fallback 或无当前调用方的配置层；先看现有 `DialogueLayer.layout()`、`#rebuildCommandRail()` 和 `showBacklog()`。
- 每项先写聚焦红灯或精确回归断言，再修改最小代码；不得用截图“看起来差不多”替代几何和主题断言。
- 不触碰受保护未跟踪文件：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`。
- 不得 push、force push、rebase、reset、amend、squash、cherry-pick 或历史改写；完成后停在 `WAITING_FOR_REVIEW`。
- 不创建或跟踪 `.log`；截图放系统临时目录，报告重新读取文件字节数和 SHA-256。

---

## Task 0: 基线和视觉契约

**Files:**

- Modify: `docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md`
- Read: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Read: `packages/renderer/test/layers/dialogue-layer.test.ts`

- [ ] **Step 1: 核对 Wave 5A 已批准和当前工作树**

Run:

```powershell
git rev-parse HEAD
git status --short
git diff --check
```

Expected: 记录真实 HEAD；Wave 5A 已有总经理批准；不覆盖执行 AI 的未提交变更和五个受保护文件。

- [ ] **Step 2: 记录现状几何**

在计划台账中写入当前实现事实，作为修改前对照：

- `DialogueLayer.layout()` 当前以 `this.#h * 0.60` 作为选择枝组中心；
- `#continueIndicator` 初始位于 `x = this.#w - 68`，更新时 `y = this.#h - 46 + pulse`；
- `#rebuildCommandRail()` 的命令栏位于画布右下角，`top = this.#h - railH - 10`；
- Backlog 标题当前使用 `theme.colors.textOnAccent`，目标是 `theme.colors.text`。

### Wave 5B Execution Ledger

| Stage | Status | Evidence / notes | Commit | Next entry |
|---|---|---|---|---|
| Task 0 — baseline and scope | completed | Baseline HEAD `41c34547a6f213003d4f4a40259f31db5febf746`; `HEAD...surdet/main=0 0`; `git diff --check` passed; tracked `*.log` empty; worktree contains only the six existing untracked files, including this authorized plan. Read-only source review confirms choice anchor `this.#h * 0.60`, continue indicator x `this.#w - 68` with pulse y `this.#h - 46`, command rail top `this.#h - railH - 10`, and backlog header token `textOnAccent`. | pending Task 1 commit | Add red/green evidence after each scoped task. |
| Task 1 — choice group centering | completed | Red: the new real `DialogueLayer` geometry test failed with a 70 logical-pixel center error against `y=360`. Green: the same test passed for 1/2/3 choices, including bounds within `1280×720`, horizontal center, 12px gaps, pointer selection index, zero ticker/listener resources, and one choice fade tween. Full focused file then reported `6 passed / 2 expected remaining failures` for the untouched Task 2/3 contracts. | to be created now | Begin Task 2 only after this commit. |
| Task 2 — continue indicator deconfliction | completed | Red: the real Pixi indicator/rail bounds overlapped. Green: the indicator uses a private rail rectangle, sits at least 9 logical pixels from the visible rail edge, returns to `(w-68,h-46)` when hidden, hides when no safe left space exists, keeps x fixed during pulse, and repeated rebuild/hide/restore leaves lifecycle counts and child count stable. | combined with Task 3 code commit | Begin Task 3 after this code commit. |
| Task 3 — Backlog header theme token | completed | Red: the real header fill was `theme.colors.textOnAccent` (`461847`) instead of `theme.colors.text` (`15922943`). Green: the header uses the `text` binding, follows a changed theme token, remains at `y=30`, keeps the mask and viewport, and stays fixed while entries scroll. | combined with Task 2 code commit | Run Task 4 scoped validation and prepare delivery report. |

---

## Task 1: 选择枝整体垂直居中

**Files:**

- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/test/layers/dialogue-layer.test.ts`

**Interfaces:**

- Consumes: `showChoices()`、`#drawChoiceCard()`、`layout()` 和现有选择交互事件。
- Produces: 选择卡片的真实 Pixi holder 位置；不改变选项顺序、点击回调、键盘选择、淡入或高亮语义。

- [ ] **Step 1: 先写红灯测试**

在 `dialogue-layer.test.ts` 创建 1、2、3 个不同长度选项，调用 `layer.showChoices()` 和 `layer.layout()`，从真实 `choice-layer` 子节点读取每张卡片的 local bounds/position。先断言现有布局不满足新契约：

- 选择组的几何中心不是 `height / 2`（当前基线应在约 `height * 0.60`）；
- 至少一张卡片在组中心上下不对称。

不要为制造失败而改测试数据；保留该红灯输出到计划台账。

- [ ] **Step 2: 实施最小布局算法**

在 `DialogueLayer.layout()` 中保留现有水平居中和卡片宽度逻辑，改为按真实卡片高度和固定间距计算：

```ts
const gap = 12;
const heights = this.#choiceViews.map((view) => view.label.height + 16);
const totalHeight = heights.reduce((sum, height) => sum + height, 0)
  + Math.max(0, heights.length - 1) * gap;
let cursorY = (this.#h - totalHeight) / 2;
for (const [index, view] of this.#choiceViews.entries()) {
  const height = heights[index]!;
  const width = view.label.width + 60;
  view.holder.position.set((this.#w - width) / 2, cursorY);
  cursorY += height + gap;
}
```

要求：

- 空选项数组不产生负坐标或 NaN；
- 选项文字变化后再次调用 `layout()` 仍居中；
- 不改变 `pointerdown`、`pointerover`、`setChoiceHighlight`、淡入生命周期；
- 不添加新的全局布局状态。

- [ ] **Step 3: 重跑同一测试并补相邻回归**

Run:

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts
```

新增绿灯断言至少包括：

- 单项、双项、三项不同高度的选择组中心误差不超过 1 logical pixel；
- 每张卡片水平中心为 `width / 2`；
- 卡片间距为 12 logical pixels；
- 所有 holder 均在画布范围内；
- 选项顺序和点击回调仍保持原值。

---

## Task 2: 继续指示器与命令栏避让

**Files:**

- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/test/layers/dialogue-layer.test.ts`

**Interfaces:**

- Consumes: `setAwaiting()`、`updateContinuePulse()`、`showCommandRail()`、`setCommandRailItems()`、`hideCommandRail()` 和 `restoreCommandRail()`。
- Produces: 命令栏可见时小光点位于命令栏左侧的安全锚点；命令栏隐藏时小光点回到原有底部等待位置。

- [ ] **Step 1: 先写几何红灯**

在测试中打开真实命令栏并让 DialogueLayer 进入 awaiting 状态，读取 `dialogueRoot` 中的真实 `continue-indicator` Graphics 和 `command-rail` 容器 bounds。先断言当前二者相交，保留红灯。

若当前 Pixi 测试环境无法提供可靠 bounds，则用真实的逻辑矩形计算断言：命令栏 `startX/top/railW/railH` 与指示器圆形半径 9 的包围盒相交；同时保留一条 Electron 截图/几何证据说明真实玩家路径。

- [ ] **Step 2: 用命令栏布局计算安全锚点**

在 `DialogueLayer` 内抽出最小的私有几何计算（只服务当前两个调用方，不创建新的公共配置层）：

- 命令栏可见时：继续指示器中心放在 `startX - 18`、`top + railH / 2`；`x` 至少为 18，保证圆形半径 9 不越界；
- 命令栏隐藏时：中心回到 `this.#w - 68`、`this.#h - 46`；
- 当命令栏宽度占满画布、左侧没有足够安全区时，指示器改为隐藏，不能与命令栏重叠；
- `updateContinuePulse()` 只能改变 `y` 的小幅脉动和 alpha，不能改变避让后的 `x`；
- `showCommandRail()`、`setCommandRailItems()`、`hideCommandRail()`、`restoreCommandRail()`、`setAwaiting()` 和 `layout()` 都必须重新应用该锚点。

- [ ] **Step 3: 重跑测试并覆盖命令栏生命周期**

Run:

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts
```

新增绿灯断言至少包括：

- 命令栏可见 + awaiting：指示器与命令栏包围盒不相交，且最小间隔不小于 9 logical pixels；
- 命令栏隐藏 + awaiting：指示器可见，回到原有等待区；
- 命令栏重新显示：指示器再次避让，不累积额外 children、listener 或 lifecycle owner；
- 多种命令栏 item 数量下仍不相交；
- `updateContinuePulse()` 多次运行后 x 不漂移，y 只在预期脉动范围内变化。

---

## Task 3: Backlog 标题改为白色且保持滚动层级

**Files:**

- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/test/layers/dialogue-layer.test.ts`

**Interfaces:**

- Consumes: `showBacklog()`、现有 `RendererTheme` 和 Backlog mask/scroll 布局。
- Produces: 固定标题使用 `colors.text`，正文仍在 viewport mask 下滚动，标题位置和层级不变。

- [ ] **Step 1: 先写红灯测试**

在 Backlog 测试中取真实标题 `PText`：

- 断言其文本为 `文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）`；
- 断言当前 fill 不是 `theme.colors.text`；
- 断言标题 local y 为 `BACKLOG_HEADER_Y`；
- 断言 entries layer 仍有 mask 且 viewportTop 不变。

- [ ] **Step 2: 实施最小主题修复**

把标题的 style 和 theme projection 从：

```ts
fill: this.#theme.colors.textOnAccent
bindThemeTextProjection(title, { fill: 'textOnAccent' })
```

改为：

```ts
fill: this.#theme.colors.text
bindThemeTextProjection(title, { fill: 'text' })
```

不改标题文案、字号、坐标、Backlog root 顺序、mask、滚轮、PageUp/PageDown 或点击关闭逻辑。

- [ ] **Step 3: 重跑测试**

Run:

```powershell
npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts
```

Expected：标题 fill 为白色主题 token；`backlogAboveDialogueText === true`；正文滚动后标题 y 不变、正文不穿透 viewport 顶部。

---

## Task 4: 正式 Zero Electron 视觉确认和门禁

**Files:**

- Create: `packages/shell/e2e/player-experience-wave-5b-layout-polish.e2e.mjs`
- Create: `packages/shell/test/player-experience-wave-5b-e2e-contract.test.ts`
- Modify: `packages/shell/package.json`
- Modify: `packages/renderer/test/layers/dialogue-layer.test.ts`（仅同步契约时）

- [ ] **Step 1: 建立小型真实视觉 runner**

runner 复用 Wave 4 的正式 Zero dist、独立 Electron、独立 userData、错误收集、真实鼠标/键盘输入和 PNG 截图方式，只执行当前三项视觉路径：

1. 开始新游戏，推进到一个包含至少 3 个选项的选择枝，截图并保存选择卡片矩形；
2. 在 awaiting 文本状态打开命令栏并截取继续指示器与命令栏区域，保存两个逻辑矩形；
3. 打开记录，截取标题和滚动前后正文，保存标题 fill/token 的语义快照和 PNG 哈希。

runner 不得调用 `titleSelect()`、`showChoices()`、`showBacklog()` 或任何 debug command；只允许真实鼠标/键盘输入，debug surface 只能读。

- [ ] **Step 2: 建立契约测试**

静态断言 runner：

- 明确加载 `examples/zero-after-midnight/dist`，不加载 Starter；
- 每个 case 独立 Electron/userData；
- 使用真实 `page.mouse.click()` / `page.keyboard.press()`；
- 保存截图和错误数组；
- 失败时保留 `errorStack`、最后快照和已生成截图；
- 不把截图、日志或临时 artifact 写入 Git。

Run:

```powershell
npm run test -w @surdet/shell -- --run test/player-experience-wave-5b-e2e-contract.test.ts
```

- [ ] **Step 3: 运行正式视觉 runner**

Run:

```powershell
npm run e2e:player-experience:wave5b -w @surdet/shell -- --smoke
npm run e2e:player-experience:wave5b -w @surdet/shell
```

Expected：

- 选择组中心在 `640,360` 附近，误差不超过 1 logical pixel；
- 继续指示器与命令栏没有相交或覆盖；
- Backlog 标题为白色，滚动后标题位置不变，正文不覆盖标题；
- page/console/request/unhandled/RendererError/releaseFailure 全为空；
- 失败时 artifact 为 `FAILED`，不得重跑直到出现绿色。

---

## Task 5: 全量相关门禁、报告和停止

**Files:**

- Create: `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-5B-LAYOUT-POLISH-DELIVERY-REPORT-2026-08-12.md`
- Modify: `docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md`

- [ ] **Step 1: 运行相关门禁**

Run:

```powershell
npm run test -w @surdet/renderer
npm run test -w @surdet/shell -- --run test/player-experience-wave-5b-e2e-contract.test.ts
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
npm run typecheck -w @surdet/shell
npm run build -w @surdet/shell
npm run lint -w zero-after-midnight
npm run typecheck -w zero-after-midnight
npm run build -w zero-after-midnight
git diff --check
git ls-files '*.log'
```

因为本轮只改公共 Renderer 和 Shell 视觉探针，除非实际接线扩展到多个 workspace，否则不要求重新做性能资格化或多轮大型矩阵。若执行 AI 修改了公共边界、Host 接线或模板入口，额外运行 `npm run verify:all`。

- [ ] **Step 2: 交付报告必须回答**

- 每项视觉反馈的原始现状、设计决策和精确改动；
- 选择组在 1/2/3 个不同高度选项下的实际几何证据；
- 命令栏可见/隐藏、不同 item 数量下的指示器矩形与间距；
- Backlog 标题主题 token、坐标、mask 和滚动前后截图哈希；
- 正式 Zero Electron 入口、进程/userData、真实输入路径和错误数组；
- 测试、typecheck、build、lint 的真实命令与退出码；
- 修改文件、提交 SHA、工作树、远端差异、是否 push；
- 未做的事情：性能、M9、发行、EXE、资产、音频、剧情、存档格式。

- [ ] **Step 3: 收口状态**

若所有视觉聚焦测试、正式 Zero 视觉 runner 和相关门禁通过：

```text
PLAYER_EXPERIENCE_WAVE_5B_LAYOUT_POLISH_COMPLETE
CHOICE_CENTERING_VERIFIED
CONTINUE_INDICATOR_DECONFLICTED
BACKLOG_TITLE_WHITE_VERIFIED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

若任一项视觉或错误证据失败：

```text
PLAYER_EXPERIENCE_WAVE_5B_LAYOUT_POLISH_NOT_CLEARED
WAITING_FOR_REVIEW
```

不得自行进入下一主题、M9、性能、发行或 push。

## Current execution scope closure

本次实际授权以 2026-08-12 用户任务书附件为准，范围收窄为公共
`DialogueLayer` 的三项布局/主题修复、其 Renderer 测试、相关 Renderer/正式
Zero 门禁、计划台账和简短交付报告。磁盘上本计划草稿中原列出的 Shell
Wave 5B runner、Shell contract、Electron 截图矩阵和 Task 5 扩展门禁不属于
本次授权，均未执行、未新增、未修改；人工视觉验收留待总经理审阅后另行部署。

### Scoped closure ledger

| Item | Status | Evidence |
|---|---|---|
| Public DialogueLayer implementation | completed | Choice centering, continue-indicator deconfliction, and Backlog header token are in commits `4ee8a5d3717cb037b7f92beb861d3fbd1d413bf8` and `7f5cf6c5e238bf91b1ef49ff6b248ccedb067b35`. |
| Renderer / Zero focused gates | completed | Dialogue focused `8/8`; Renderer `49 files / 403 passed`; Renderer and Zero typecheck/build passed; Zero lint `11 scenes, 0 errors, 0 warnings`; simulate `23/23`, 3 endings, runtime errors `0`; assets `44`; diff check passed; tracked `.log` empty. |
| Electron visual validation | intentionally not run | This run did not create a Shell runner, did not deploy, and did not run an Electron screenshot matrix. Manual visual validation is pending review. |
| Remote / release actions | not performed | No push, packaging, release, or M9/performance work. |
| Task 4 — scoped validation and delivery docs | completed | First docs commit `5a1ab9d86c151b1b22a0a779be28a15b2e8a1efc`; post-commit readback recorded `HEAD...surdet/main=3 0`, report `5746` bytes / `D541C9DB272ED22E4573E0527A231D6B751D8F0F0F719768D15B3E05C8DF5210`, plan `18271` bytes / `55206D909B2B8F9A0EEF5D0D670C740668B30314FC3CD3F2AAA1C842F39CB0CA`; final metadata-only docs closure is the only remaining local commit. |
