# Surdet Player Experience Hotfix Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复《零点之后》中由玩家实际复现的十项交互、资源释放、界面层级和对话稳定性缺陷，并以真实 Electron 玩家路径证明“菜单操作不推进剧情、存读档/回标题不再触发资源释放错误、标题鉴赏可正常使用、对话框稳定、界面隐藏可恢复”。

**Architecture:** 以一个可测试的玩家 UI 会话状态作为唯一交互判定来源，替代 `main.ts` 中彼此独立且容易失同步的布尔守卫；以显式“本次指针是否被 UI 消费”的输入门禁阻止画布推进穿透；Renderer 继续负责显示资源的唯一所有权、幂等释放和固定合成层级。先通过真实失败路径定位 `renderer resource release failed` 的具体 owner/kind/key/cause，再修释放根因，严禁吞错或把异常改成日志。

**Tech Stack:** TypeScript 5.7、PixiJS、Vitest、Node test runner、Electron 43、Playwright、Vite、Surdet Renderer/Core/Host/Shell monorepo。

## Global Constraints

- 本计划是 Player Experience Hotfix Wave 2 的唯一施工入口；不进入 M9，不做性能优化，不重新采样 Renderer V4 Q1–Q5，不修改任何性能 artifact、统计规则或门限。
- 本轮由一个执行 AI 串行完成；使用 `superpowers:executing-plans`（若环境提供）按 Task 0→8 执行，不创建或委派子代理，不并行修改相同工作树。
- 起始基线必须是 `4a162b9446bb10be3f720b98531d532db568dd6e`，且 `HEAD...surdet/main` 为 `0 0`。若事实不一致，先停止并报告，不得擅自 reset、rebase 或覆盖他人工作。
- 本轮只修本文 UX-01～UX-10 以及完成这些修复所必需的公共根因；不得顺手重构剧情、DSL、编辑器、音频、美术、性能测量、存档格式或发行流程。
- 不修改、暂存、提交、删除或移动以下四个受保护未跟踪文件：
  - `SESSION-HANDOFF.md`
  - `USER.md`
  - `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
  - `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`
- 不删除用户存档。自动化必须为每次 Electron 启动创建独立临时 `userData`，并只清理本轮自己创建且路径已精确核验的临时目录。
- 不使用 `git reset --hard`、`git checkout --`、force push、历史改写或“先改门禁再让测试通过”的做法。
- 本轮允许本地分阶段提交，但在独立复审前不得 push、不得重新打包正式发行版、不得执行 electron-builder 发行。
- 所有修复必须测试先行：先让对应新测试因目标缺陷失败，保存失败命令和关键输出，再修改生产代码，最后让同一测试转绿。
- 不得用下列伪修复：捕获并忽略 `renderer resource release failed`；只把 error 降级为 warning；对菜单加延时；把点击禁用一段固定毫秒数；重复调用 hide/show“碰运气”；隐藏错误弹窗；删除失败 E2E；用截图肉眼判断代替状态断言。
- 不暴露真实 Pixi Layer、Container、Sprite、Texture 或其他可变对象到 `window.__surdetDebug`。自动化只能使用语义动作、只读深克隆/冻结快照和真实鼠标键盘输入。
- 上下文压缩或会话恢复后，先重新读取本计划、`git status --short`、`git log --oneline --decorate -12` 和本计划的进度表，核对下一阶段后再继续。
- 每个阶段结束时更新“持久化进度台账”，记录测试、提交哈希、仍存问题和下一入口；聊天总结不能代替仓库内台账。
- 任一 UX 验收未通过，最终状态不得写 APPROVED，不得 push；必须原样保留失败证据并停在 `WAITING_FOR_REVIEW`。

---

## 1. 冻结的问题清单与验收口径

### UX-01：标题页鉴赏的音乐/文本页卡死

- 复现：启动到标题 → 鉴赏 → 音乐，或标题 → 鉴赏 → 文本。
- 现象：界面不再响应点击，只能从外部强制关闭。
- 对照：标题 → 鉴赏 → CG 正常；游戏内菜单 → 鉴赏 → 音乐/文本也正常。
- 验收：标题入口下 CG/音乐/文本均可进入、切换、返回；连续完成 5 轮，窗口保持响应，无 page error、console error、未处理拒绝或资源释放错误。

### UX-02：推进时对话框闪烁

- 复现：正常连续推进多句对话，尤其观察换行开始、打字机开始和说话人变化时。
- 验收：一段连续对话期间，面板不因中间态空字符串而短暂隐藏；允许文本内容更新、说话人牌变化和显式场景命令隐藏对话框，但禁止单帧空白闪烁。
- 自动化口径：在连续至少 10 句的推进中逐帧读取语义投影；从一行 `begin` 到下一行稳定显示期间，`dialogue.panelVisible` 不出现非设计性的 `true → false → true`。

### UX-03：读档页点击空槽报资源释放错误

- 验收：空槽必须是 disabled/no-op。鼠标点击、键盘确认或手柄确认均不得调用 load、不得关闭页面、不得推进剧情、不得改变当前存档状态、不得抛错。

### UX-04：读档后返回标题必现资源释放错误

- 验收：有效读档完成后，菜单 → 返回标题可正常回到标题；标题按钮可继续使用，命令栏不残留，资源快照收敛，无 `renderer resource release failed`。

### UX-05：点击菜单/记录时底层对话继续推进

- 验收：系统菜单、记录、存档、读档、设置、鉴赏、回退、界面按钮及其页面内部的所有点击，都必须消费当前 UI 手势；只有玩家在无阻塞覆盖层的正常游戏面点击，或主动使用自动/快进功能时，才可推进剧情。

### UX-06：对话文字压在记录等菜单页面之上

- 验收：固定合成顺序为 `World < Dialogue(panel/text/rail) < Backlog/System Menu/SaveLoad/Settings/Gallery < Loading/Fatal`。打开任一覆盖页后，对话面板、说话人、正文、继续标记和命令栏均不得绘制在其上方。

### UX-07：回退偶发被忽略并变成推进

- 验收：回退可用时一次点击只执行一次回退，当前位置必须向前一条历史状态移动；不可回退时一次点击为明确 no-op；两种情况下都不得随后推进一次。

### UX-08：隐藏界面后无法左键恢复，且仍会推进

- 复现：点击“界面”或按 H 隐藏 UI，再单击鼠标左键。
- 验收：H 与“界面”按钮语义完全一致；隐藏状态下第一次左键只恢复 UI，不推进、不选择、不自动播放；恢复后下一次正常游戏面左键才可推进。

### UX-09：同会话 Save→Load 或 Load→Save 报资源释放错误

- 验收：在同一 Electron 会话内完成 `save → load → save → load`，再完成 `load → save → load → save`，各循环至少 3 轮；均无错误、槽位内容正确、剧情位置正确、命令栏存在。

### UX-10：出错后仍可推进但右下命令栏消失，回标题再次报错

- 验收：修复后不得进入“剧情可推进但 command rail 永久消失”的半损坏状态；所有页面退出、读档、回标题和失败恢复后，命令栏可见性必须符合当前 UI 会话状态。任何命令失败必须保持操作前一致状态，不能只恢复一半。

### 已确认正常、必须防回归的三条对照路径

- 标题 → 鉴赏 → CG → 返回。
- 新游戏 → 未读档直接返回标题。
- 全新启动 → 直接读取有效存档，命令栏正常。

---

## 2. 已确认的代码事实（执行 AI 不得忽略）

- `examples/zero-after-midnight/src/main.ts` 当前在整个 canvas 上监听 `pointerdown`，只检查 `onTitleScreen`，没有统一检查 system menu、save/load、gallery、settings、backlog 和 interface hidden；这是 UX-03、UX-05、UX-07、UX-08 的共同高概率根因。
- `examples/zero-after-midnight/src/main.ts` 以 `systemMenuOpen`、`saveLoadOpen`、`onTitleScreen`、`galleryOpen`、`settingsOpen` 等独立布尔量维护页面状态；异步存读档和回调退出时容易出现半切换状态。
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts` 的 `bringTextDisplaysToFront()` 会把正文对象重新放到共享 UI root 的末尾；这会破坏菜单/记录覆盖层应高于正文的合成约束，是 UX-06 的明确风险点。
- `packages/renderer/src/layers/gallery/gallery-layer.ts` 在 tab 重建时释放 listener、销毁子树并重建；标题入口保留标题层作为背景，游戏入口则没有该状态差异。UX-01 必须用两种入口的对照测试定位，不得假定只是“音乐数据太多”。
- `packages/renderer/src/layers/menu/menu-layer.ts` 已把空读档槽标记为不可选择，但空白区域点击仍会到达底层 canvas；因此既要保留 Renderer 层 disabled 规则，也要在 Host 层做防御式 no-op 和输入消费。
- `packages/renderer/src/lifecycle/render-lifecycle.ts` 抛出的精确顶层信息为 `Renderer resource release failed`，说明至少一个已注册 disposer 在 `release` 中抛错；当前顶层错误没有直接显示失败条目的 owner/kind/key。修复必须先获取内层 cause 和资源身份。
- `packages/renderer/src/runtime/renderer-facade.ts` 在多个 overlay 关闭包装器中自动恢复 command rail；标题上下文与游戏上下文的返回目标不同，不能再由 Renderer 猜测“关闭覆盖层后一定恢复游戏命令栏”。
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts` 已复用文本对象，不应回退为每句销毁/重建 Text；UX-02 应区分“开始新行”和“显式隐藏对话框”，消除空文本中间态。

---

## 3. 冻结设计

### 3.1 玩家 UI 会话状态

在 `examples/zero-after-midnight/src/player-ui-session.ts` 新建纯 TypeScript 状态机，至少包含：

```ts
export type PlayerBase = 'title' | 'game';
export type PlayerOverlay =
  | 'none'
  | 'system-menu'
  | 'save-load'
  | 'settings'
  | 'gallery'
  | 'backlog';

export type PlayerOperation =
  | 'idle'
  | 'saving'
  | 'loading'
  | 'returning-title';

export interface PlayerUiSessionSnapshot {
  readonly base: PlayerBase;
  readonly overlay: PlayerOverlay;
  readonly operation: PlayerOperation;
  readonly interfaceHidden: boolean;
  readonly videoActive: boolean;
}
```

要求：

- `base` 决定覆盖页关闭后回标题还是回游戏；不得再通过多个回调临时猜测。
- `overlay` 同时只能有一个阻塞覆盖页；打开新覆盖页必须通过显式 transition。
- `operation` 使异步 save/load/return-title 期间的输入与重复命令确定地被阻止；成功或失败后都必须回到 `idle`。
- `interfaceHidden` 只允许在 `base='game' && overlay='none'` 时为真。
- `canAdvance`、`canRollback`、`shouldRestoreInterfaceOnPointer`、`shouldShowCommandRail` 必须是纯查询，从同一快照推导，并要求 `operation='idle'`。
- 非法 transition 在开发/测试中抛稳定错误，不能静默产生不可能组合。
- `main.ts` 原有相关布尔量必须删除或改为该状态机的只读派生值；不得保留两套真相。

### 3.2 指针消费协议

在同一模块或 `examples/zero-after-midnight/src/player-input-gate.ts` 实现单事件循环的显式消费门禁：

- 每次 canvas 主按钮 pointerdown 只在当前同步事件的所有 Pixi UI 回调完成后决定是否推进。
- command rail、菜单项、槽位、tab、返回按钮、backlog 关闭、rollback、interface 等 UI 回调必须调用 `consumeCurrentPointer()`。
- 若当前 UI 会话存在 overlay，结果固定为 ignore；若 interface hidden，结果固定为 restore-interface；只有 game/none/visible 才可 advance。
- 消费标记必须在本次判断后清除，不能泄漏到下一次真实游戏面点击。
- 不以 `setTimeout(100)`、时间戳阈值或防抖代替事件消费。
- 键盘和手柄不使用 pointer 标记，但必须复用相同的 `canAdvance/canRollback` 查询。

### 3.3 覆盖层与命令栏返回协议

- 覆盖页关闭结果由 Host 的 `base` 决定：title 返回标题，game 返回游戏并按状态恢复 command rail。
- Renderer hide/close 命令不得无条件恢复 command rail。若为保持一版兼容窗口而保留旧行为，新增显式选项时默认值保持旧 API，仓库内 Starter 和《零点之后》必须同步传入明确策略，并增加弃用说明与契约测试。
- 禁止用“关闭后立即再 hide 一次 command rail”掩盖错误状态；应当只有一个明确拥有恢复决策的调用方。

### 3.4 Renderer 资源所有权

- 每个 Pixi display/listener/texture/tween 只能有一个最终释放所有者。
- 手工销毁前必须从 lifecycle `forget` 对应条目，或完全交由 lifecycle 释放；不得同一资源两种方式都销毁。
- `release`、`releaseOwner`、overlay hide、session reset 和 runtime dispose 的重复调用必须幂等。
- 生命周期诊断允许在 `RendererError.cause` 中增加不可变元数据（owner/kind/key/command/原始 cause），但不得改变稳定错误码 `COMMAND_COMMIT_FAILED`，不得把可变资源引用带出边界。
- 修复必须针对真实失败 disposer；不得简单令所有 destroy 调用 `try/catch {}`。

### 3.5 固定合成层级

- Dialogue 的 panel、speaker、text、ruby、indicator 和 command rail 必须放在 Dialogue 自有容器中；“把文字提到最前”只能在 Dialogue 容器内部排序。
- Menu/Gallery/Settings/SaveLoad/Backlog 的全屏覆盖容器固定在 Dialogue 容器之上，并具备全屏输入阻挡面。
- 通过 Renderer 语义投影或只读诊断输出层级类别，不暴露 Container 引用。

### 3.6 对话行生命周期

- 增加“开始一行/更新文本/显式清空或隐藏”的明确语义；新行开始时面板保持可见，即使打字机首帧文本暂为空。
- reset session、进入标题或脚本显式 hide 才允许隐藏面板。
- 保持 Text/Ruby 对象池，不因本修复恢复每字或每句对象重建。

---

## Task 0: 冻结基线并建立持久化台账

**Files:**

- Modify: `docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md`

- [ ] 运行只读基线核对：

```powershell
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
git status --short
git log --oneline --decorate -12
```

Expected:

- HEAD 为 `4a162b9446bb10be3f720b98531d532db568dd6e`。
- ahead/behind 为 `0 0`。
- status 只有四个受保护未跟踪文件和本计划文件。

- [ ] 运行整改前门禁，记录真实结果，不因耗时跳过：

```powershell
npm run verify:all
git diff --check
```

- [ ] 将本计划的起始事实、命令结果和时间写入文末进度台账。
- [ ] 仅提交本计划：

```powershell
git add -- docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git diff --cached --name-only
git commit -m "docs(engine): freeze player experience hotfix wave 2"
```

- [ ] 提交后确认四个受保护文件仍未跟踪且未进入 index。

---

## Task 1: 先建立真实失败证据与可定位的生命周期错误

**Files:**

- Create: `packages/shell/e2e/player-experience-wave-2.e2e.mjs`
- Modify: `packages/shell/package.json`
- Modify: `packages/shell/src/main.ts`（仅增加双重守卫的 E2E 游戏目录注入点）
- Modify: `packages/shell/test/main-entry-policy.test.mjs`（若不存在则创建同名纯策略测试）
- Modify: `packages/renderer/src/lifecycle/render-lifecycle.ts`
- Modify: `packages/renderer/test/lifecycle/render-lifecycle.test.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`（只允许增加语义只读调试字段，不修生产行为）

- [ ] 为 `RenderLifecycle` 写失败测试：一个 disposer 抛错时，顶层仍为 `RendererError`、code 为 `COMMAND_COMMIT_FAILED`、command 为 `release`，cause 中可审计地包含失败 entry 的 owner/kind/key 和原始错误；多个 disposer 失败时全部保留。
- [ ] 先运行并保存红灯：

```powershell
npm run test -w @surdet/renderer -- --run test/lifecycle/render-lifecycle.test.ts
```

- [ ] 实现不可变失败记录；不得暴露 disposer 函数或资源对象；保持 entries 先从索引移除再调用 disposer 的既有可重入语义。
- [ ] 重跑专项测试并转绿。
- [ ] 新增 `e2e:player-experience` 脚本。E2E 必须先按依赖顺序构建 Core/Renderer/Host/Shell/《零点之后》，再让 Electron Shell 加载《零点之后》的 `dist`，不得误测默认 Starter。
- [ ] 若 Shell 开发模式没有选择游戏目录的入口，在 `packages/shell/src/main.ts` 增加测试专用注入：只有 `SURDET_E2E=1` 且显式 `SURDET_E2E_GAME_DIR=<绝对路径>` 同时存在时才覆盖 development `gameRoot/entry`；路径必须规范化、存在、包含 `index.html`，release/packaged 模式必须忽略并拒绝该覆盖。将目录解析抽成纯函数并做 Shell 单元测试，禁止形成普通用户可用的任意文件加载后门。
- [ ] E2E 必须通过 `--user-data-dir=<本轮新建的精确临时目录>` 使用独立 userData，并在窗口内确认 `app.getPath('userData')` 或测试语义回执确实指向该目录；监听 `pageerror`、console error、unhandled rejection、窗口关闭和 5 秒无响应 watchdog。
- [ ] E2E 第一版只复现并记录，不改业务代码。至少覆盖：
  1. title → gallery → music → text → close；
  2. new game → save → load → save；
  3. load → system menu → title；
  4. load 页面点击 empty slot；
  5. backlog/rollback/interface 点击时的解释器 position before/after。
- [ ] `__surdetDebug` 只新增以下语义只读数据：UI session snapshot、解释器 scene/index/status、commandRailVisible、dialogue panel/text visibility、active overlay、Renderer resource snapshot、最后一次 RendererError 的序列化元数据。所有对象每次读取均为新克隆并递归冻结。
- [ ] 用真实鼠标/键盘触发目标交互；允许调试 API 负责跳到稳定测试前置状态，但禁止直接调用待测的 close/load/gallery tab 函数来冒充玩家点击。
- [ ] 在当前基线上运行 E2E，必须至少捕获一个与玩家报告一致的红灯。如果任何路径无法自动定位控件，先增加语义可访问矩形/测试 ID 查询，不得用任意固定坐标蒙混。
- [ ] 把失败矩阵、精确 lifecycle owner/kind/key/cause、入口上下文（title/game）写入计划台账。
- [ ] 提交：

```powershell
git add -- packages/shell/e2e/player-experience-wave-2.e2e.mjs packages/shell/package.json packages/shell/src/main.ts packages/shell/test/main-entry-policy.test.mjs packages/renderer/src/lifecycle/render-lifecycle.ts packages/renderer/test/lifecycle/render-lifecycle.test.ts examples/zero-after-midnight/src/main.ts docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git diff --cached --name-only
git commit -m "test(engine): reproduce player experience wave 2 failures"
```

Stop condition: 若真实 `renderer resource release failed` 仍无法复现，保留其余红灯并将资源问题标为 `REPRODUCTION_BLOCKED`；不得凭猜测修改生命周期生产代码。

---

## Task 2: 用单一 UI 会话状态替换分散布尔守卫

**Files:**

- Create: `examples/zero-after-midnight/src/player-ui-session.ts`
- Create: `examples/zero-after-midnight/test/player-ui-session.test.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `examples/zero-after-midnight/package.json`

- [ ] 先为状态机写表驱动红灯测试，覆盖：title/game；打开与关闭六类 overlay；title gallery 返回 title；game gallery 返回 game；interface hidden；video active；非法叠层；session reset；读档成功/失败回滚。
- [ ] 测试每种状态的 `canAdvance`、`canRollback`、`shouldRestoreInterfaceOnPointer` 和 `shouldShowCommandRail`。
- [ ] 运行红灯：

```powershell
npx vitest run examples/zero-after-midnight/test/player-ui-session.test.ts
```

- [ ] 实现纯状态机；快照必须只读，transition 不执行 Renderer 副作用。
- [ ] 将 `main.ts` 中 `systemMenuOpen`、`saveLoadOpen`、`onTitleScreen`、`galleryOpen`、`settingsOpen` 及 backlog/interface 相关判断迁移到统一状态；保留 Renderer 实际投影作为一致性断言，不能成为第二套可写状态。
- [ ] 所有异步存读档使用事务式 transition：操作前快照 → 进入 busy/overlay 状态 → 成功提交目标状态，失败恢复操作前状态并重新投影 UI。
- [ ] 更新 package test 脚本，使根级 workspace test 会运行新单元测试且仍运行既有 simulation verification。
- [ ] 重跑单元测试、zero typecheck 和既有 simulation：

```powershell
npx vitest run examples/zero-after-midnight/test/player-ui-session.test.ts
npm run typecheck -w zero-after-midnight
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
```

- [ ] 提交：

```powershell
git add -- examples/zero-after-midnight/src/player-ui-session.ts examples/zero-after-midnight/test/player-ui-session.test.ts examples/zero-after-midnight/src/main.ts examples/zero-after-midnight/package.json docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git commit -m "refactor(zero-after-midnight): centralize player ui session state"
```

---

## Task 3: 修复所有 UI 点击穿透、回退和界面隐藏语义

**Files:**

- Create: `examples/zero-after-midnight/src/player-input-gate.ts`
- Create: `examples/zero-after-midnight/test/player-input-gate.test.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/test/legacy/dialogue-layer.test.ts`
- Modify: `packages/shell/e2e/player-experience-wave-2.e2e.mjs`

- [ ] 先写纯输入门禁红灯测试：普通游戏面点击 advance；overlay 点击 ignore；被 UI consume 的同一 pointer 不 advance；下一 pointer 恢复正常；hidden 第一次点击 restore-only；rollback success/no-op 均 consume；右键、非主按钮不 advance。
- [ ] 先为 Dialogue command rail/backlog 的 pointer handler 写红灯，要求每个交互明确标记 UI consumed；全屏 backlog 背景关闭事件也必须消费。
- [ ] 移除“canvas pointerdown 立即 dispatch advance”的行为，按冻结消费协议在当前事件循环结束时做一次语义决策。
- [ ] 所有 command rail 入口统一包装消费，不允许遗漏记录、回退、界面、设置、存档、读档、鉴赏、标题、自动、快进。自动/快进按钮只切换功能，不额外推进一次。
- [ ] 键盘和手柄复用 UI session 查询。H 与界面按钮调用同一命令；hidden 状态左键只 restore；Esc/右键关闭 overlay 后不顺带推进。
- [ ] E2E 增加位置断言：
  - 打开记录前后的 scene/index 相同；
  - 点击记录页面和关闭记录后的 scene/index 相同；
  - rollback 后 index 只后退，不随后前进；
  - hidden 左键恢复前后 index 相同；
  - 下一次正常游戏面点击 index 才前进。
- [ ] 运行：

```powershell
npx vitest run examples/zero-after-midnight/test/player-input-gate.test.ts packages/renderer/test/legacy/dialogue-layer.test.ts
npm run typecheck -w zero-after-midnight
npm run test -w @surdet/renderer -- --run test/legacy/dialogue-layer.test.ts
npm run e2e:player-experience -w @surdet/shell
```

- [ ] 提交：

```powershell
git add -- examples/zero-after-midnight/src/player-input-gate.ts examples/zero-after-midnight/test/player-input-gate.test.ts examples/zero-after-midnight/src/main.ts packages/renderer/src/layers/dialogue/dialogue-layer.ts packages/renderer/test/legacy/dialogue-layer.test.ts packages/shell/e2e/player-experience-wave-2.e2e.mjs docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git commit -m "fix(engine): consume player ui input before dialogue advance"
```

---

## Task 4: 修复覆盖层合成顺序与标题鉴赏上下文

**Files:**

- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/layers/gallery/gallery-layer.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/api/renderer-commands.ts`（仅当显式关闭策略需要公共类型）
- Modify: `packages/renderer/test/legacy/dialogue-layer.test.ts`
- Modify: `packages/renderer/test/layers/gallery-layer.test.ts`
- Modify: `packages/renderer/test/api/renderer-contract.test.ts`（仅当契约变化）
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `examples/starter/src/main.ts`（仅当公共 API 签名变化，必须同步升级）
- Modify: `packages/shell/e2e/player-experience-wave-2.e2e.mjs`

- [ ] 先写 z-order 红灯：连续 showText 后打开 backlog/system/save-load/gallery，dialogue text 仍必须位于 overlay 语义层级之下；再次更新 text 不得把它提到 overlay 之上。
- [ ] 将 Dialogue 所有显示对象归入自有容器；修改 `bringTextDisplaysToFront()`，只允许在 Dialogue 容器内部排序，不操作共享 root 的全局末尾。
- [ ] 为 overlay 增加完整视口的输入阻挡面；透明度可为 0，但必须命中并消费输入。
- [ ] 先写 title/gallery 对照红灯：相同 music/text tab rebuild 分别从 title 和 game 进入，二者都可切换与关闭，关闭后的 base/command rail 状态不同且正确。
- [ ] 修复标题页保留背景与保留交互层混为一体的问题：允许标题视觉背景继续显示，但 title button container 在二级页面打开时必须不可交互/不可作为活动 overlay。
- [ ] 明确 overlay close 的 return target。若 Renderer API 新增 `restoreCommandRail` 或 return policy：
  - 保持旧调用一版兼容默认；
  - `examples/starter/src/main.ts` 与《零点之后》同步显式传值；
  - 增加 API 契约测试与弃用注释；
  - 不在本轮删除旧签名。
- [ ] E2E 真鼠标执行 title → gallery → CG/music/text → close 共 5 轮，并执行 game → gallery → music/text → close 共 3 轮；每步检查窗口响应、active overlay、base、command rail 与错误数组。
- [ ] 运行：

```powershell
npm run test -w @surdet/renderer -- --run test/legacy/dialogue-layer.test.ts test/layers/gallery-layer.test.ts test/api/renderer-contract.test.ts
npm run typecheck -w @surdet/renderer
npm run typecheck -w zero-after-midnight
npm run build -w zero-after-midnight
npm run e2e:player-experience -w @surdet/shell
```

- [ ] 提交：

```powershell
git add -- packages/renderer/src/layers/dialogue/dialogue-layer.ts packages/renderer/src/layers/gallery/gallery-layer.ts packages/renderer/src/runtime/renderer-facade.ts packages/renderer/test/legacy/dialogue-layer.test.ts packages/renderer/test/layers/gallery-layer.test.ts examples/zero-after-midnight/src/main.ts packages/shell/e2e/player-experience-wave-2.e2e.mjs docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git add -- packages/renderer/src/api/renderer-commands.ts packages/renderer/test/api/renderer-contract.test.ts examples/starter/src/main.ts
git commit -m "fix(renderer): preserve overlay input and composition order"
```

注：第二条 `git add` 只添加实际发生且属于公共契约同步升级的文件；不存在修改时不得制造空改动。

---

## Task 5: 修复空槽、存读档交替和返回标题的资源释放根因

**Files:**

- Modify: `packages/renderer/src/lifecycle/render-lifecycle.ts`（仅保留 Task 1 诊断和必要幂等语义）
- Modify: `packages/renderer/src/layers/menu/menu-layer.ts`
- Modify: `packages/renderer/src/layers/gallery/gallery-layer.ts`（仅当真实 failure 指向 gallery）
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`（仅当真实 failure 指向 dialogue）
- Modify: `packages/renderer/test/lifecycle/render-lifecycle.test.ts`
- Modify: `packages/renderer/test/legacy/menu-layer.test.ts`
- Modify: `packages/renderer/test/integration/resource-cycles.test.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/shell/e2e/player-experience-wave-2.e2e.mjs`

- [ ] 根据 Task 1 的 owner/kind/key/cause 写最小 Renderer 红灯。测试必须执行同样的 register/show/hide/reset/release 顺序，不得只 mock 一个随意 throw 的 disposer来代替业务复现。
- [ ] 为 empty load slot 增加三层断言：MenuLayer 不注册 selectable handler；Host 收到陈旧/伪造 empty slot id 也 no-op；实际点击被输入门禁消费。
- [ ] 修复真实资源所有权：
  - 若 child 由 lifecycle 注册，清容器前 release 或 forget 对应 entry；
  - 若 container 统一拥有 children，则 children 不再单独注册最终销毁；
  - listener 先解除一次；thumbnail texture cache 只由 cache owner 销毁；
  - resetSession、hide overlay、return title、dispose 重复序列不抛错。
- [ ] 不得把 RenderLifecycle 改为“所有 disposer 异常都忽略”。测试必须继续证明真正的 disposer failure 会抛错并携带完整元数据。
- [ ] 存读档 Host 流程使用 `try/commit/catch/restore/finally`：只有成功后才关闭 overlay 和切换 base；失败时恢复 UI session、overlay 和 command rail，并保留错误供诊断。
- [ ] 对有效 load 前后明确一次性清理顺序：暂停输入 → validate/load snapshot → reset/restore presentation → 恢复 UI；不得在同一对象上交叉执行两套 hide/dispose。
- [ ] 加入资源循环测试：至少 25 轮 show/hide system/save-load/gallery/backlog，10 轮 save/load 状态切换，重复 return title/new/load；每轮后 lifecycle snapshot 回到固定基线，无 listener/display/tween 单调增长。
- [ ] E2E 必须覆盖：
  - empty slot 连点 5 次仍在 load 页且 position 不变；
  - `save → load → save → load` ×3；
  - `load → save → load → save` ×3；
  - load 后 return title ×3；
  - 每一步 command rail、overlay/base 和 error arrays 正确。
- [ ] 运行：

```powershell
npm run test -w @surdet/renderer -- --run test/lifecycle/render-lifecycle.test.ts test/legacy/menu-layer.test.ts test/integration/resource-cycles.test.ts
npm run test -w @surdet/shell
npm run typecheck -w @surdet/renderer
npm run typecheck -w zero-after-midnight
npm run e2e:player-experience -w @surdet/shell
```

- [ ] 提交仅真实修改文件：

```powershell
git add -- packages/renderer/src/lifecycle/render-lifecycle.ts packages/renderer/src/layers/menu/menu-layer.ts packages/renderer/test/lifecycle/render-lifecycle.test.ts packages/renderer/test/legacy/menu-layer.test.ts packages/renderer/test/integration/resource-cycles.test.ts examples/zero-after-midnight/src/main.ts packages/shell/e2e/player-experience-wave-2.e2e.mjs docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git add -- packages/renderer/src/layers/gallery/gallery-layer.ts packages/renderer/src/layers/dialogue/dialogue-layer.ts
git commit -m "fix(renderer): make player resource transitions idempotent"
```

---

## Task 6: 消除对话框换行闪烁

**Files:**

- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/runtime/presentation-controller.ts`
- Modify: `packages/renderer/src/runtime/presentation-ports.ts`（若需要新增内部端口语义）
- Modify: `packages/renderer/test/legacy/dialogue-layer.test.ts`
- Modify: `packages/renderer/test/legacy/presentation-controller.test.ts`
- Modify: `packages/shell/e2e/player-experience-wave-2.e2e.mjs`

- [ ] 写红灯覆盖：begin line 时文本为空但 panel 保持 visible；typewriter update 不改变 panel；speaker null 的旁白也保持 panel；显式 clear/reset/title 才隐藏；连续 10 行无 `true-false-true`。
- [ ] 将“开始新行”和“显式清空/隐藏”拆成不同内部命令。保持现有公开命令兼容窗口；PresentationController 切换到明确语义。
- [ ] 禁止通过设置最小 alpha、延时隐藏、塞零宽字符或保留上一句幽灵文本来骗过可见性检查。
- [ ] 保留文字/Ruby 对象池与现有 Unicode 换行修复；新增测试包含中文、扩展汉字、emoji、带/不带 speaker 的连续对话。
- [ ] E2E 以 `requestAnimationFrame` 采样语义投影，不读取私有对象；推进至少 10 行，保存 panel visibility 时间线并断言无非法闪烁。
- [ ] 运行：

```powershell
npm run test -w @surdet/renderer -- --run test/legacy/dialogue-layer.test.ts test/legacy/presentation-controller.test.ts
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
npm run e2e:player-experience -w @surdet/shell
```

- [ ] 提交：

```powershell
git add -- packages/renderer/src/layers/dialogue/dialogue-layer.ts packages/renderer/src/runtime/presentation-controller.ts packages/renderer/test/legacy/dialogue-layer.test.ts packages/renderer/test/legacy/presentation-controller.test.ts packages/shell/e2e/player-experience-wave-2.e2e.mjs docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git add -- packages/renderer/src/runtime/presentation-ports.ts
git commit -m "fix(renderer): keep dialogue presentation stable between lines"
```

---

## Task 7: 固化真实玩家验收矩阵与防回归门禁

**Files:**

- Modify: `packages/shell/e2e/player-experience-wave-2.e2e.mjs`
- Modify: `packages/shell/package.json`
- Modify: `scripts/verify-all.mjs`（仅加入快速、确定性的单元/契约测试；不得把长 Electron E2E 塞入每次快速门禁）
- Modify: `scripts/test/verify-all.test.mjs`（仅当 verify 接线变化）

- [ ] 将 E2E 固定成以下顺序，每个顶层 case 使用独立 userData；case 内要求同会话的路径不得拆启动：

| Case | 玩家路径 | 关键断言 |
| --- | --- | --- |
| A | title → gallery → CG/music/text → close ×5 | 响应、回 title、rail hidden、errors 0 |
| B | new → system menu/backlog/settings/gallery | 所有 UI click 不推进，text 在 overlay 下 |
| C | rollback 可用/不可用各 5 次 | 只回退或 no-op，绝不推进 |
| D | H 与“界面”各隐藏 3 次，左键恢复 | 第一次恢复不推进，第二次才推进 |
| E | load empty slot 连点 5 次 | no-op、overlay 保持、errors 0 |
| F | save/load 交替两种顺序各 3 轮 | snapshot/slot/rail 正确，errors 0 |
| G | load → title ×3 → new/load | title 可操作、无半损坏状态 |
| H | 三条已知正常对照路径 | 不发生回归 |
| I | 连续 10 句逐帧采样 | panel 无非法闪烁 |

- [ ] 每个 case 都收集：pageerror、console error、request failure、unhandled rejection、RendererError metadata、resource snapshot before/after、解释器 position、UI session snapshot。
- [ ] 不把警告一概当失败；但 `renderer resource release failed`、`COMMAND_COMMIT_FAILED`、未处理异常、窗口失去响应必须失败。
- [ ] E2E 输出固定机器可读 JSON 到本轮临时目录，并在最终报告中记录 SHA-256；临时证据不得误提交为正式基线，除非任务书明确列出 docs 路径（本轮没有）。
- [ ] 运行完整 Wave 2 E2E 两次，使用两个全新 userData；两次均通过才可进入 Task 8。不得重跑到绿后只报告绿色轮次；若第一次失败，保留失败 JSON，修复后从头再跑并同时报告前后结果。
- [ ] 提交：

```powershell
git add -- packages/shell/e2e/player-experience-wave-2.e2e.mjs packages/shell/package.json scripts/verify-all.mjs scripts/test/verify-all.test.mjs docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git commit -m "test(shell): gate player experience hotfix wave 2"
```

注：`scripts/verify-all.mjs` 与其测试仅在确有接线修改时加入；长 E2E 保持显式独立门禁。

---

## Task 8: 全量回归、交付报告与停止点

**Files:**

- Create: `docs/ENGINE-PLAYER-EXPERIENCE-HOTFIX-WAVE-2-DELIVERY-REPORT-2026-08-11.md`
- Modify: `docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md`

- [ ] 按依赖顺序运行，禁止并行 build 读取正在写入的 dist：

```powershell
npm run test -w @surdet/core
npm run test -w @surdet/renderer
npm run test -w @surdet/host
npm run test -w @surdet/shell
npm run test -w zero-after-midnight
npm run typecheck -w @surdet/core
npm run typecheck -w @surdet/renderer
npm run typecheck -w @surdet/host
npm run typecheck -w @surdet/shell
npm run typecheck -w zero-after-midnight
npm run build -w @surdet/core
npm run build -w @surdet/renderer
npm run build -w @surdet/host
npm run build -w @surdet/shell
npm run build -w zero-after-midnight
npm run verify:renderer-boundaries
npm run verify:renderer-legacy
npm run verify:tools
npm run verify:hygiene
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run e2e -w @surdet/shell
npm run e2e:renderer-v2 -w @surdet/shell
npm run e2e:player-experience -w @surdet/shell
npm run verify:all
git diff --check
```

- [ ] 正式游戏验收数字不得退化：11 个场景、23/23 choice 分支、3 个结局、44 项资产、运行时错误 0。
- [ ] 报告必须逐条列 UX-01～UX-10：原始复现、红灯证据、根因、修改文件、专项测试、E2E 结果、是否通过。不得用“全部修复”一句代替。
- [ ] 报告必须单列：
  - `renderer resource release failed` 的真实 owner/kind/key/cause；
  - 为什么只在特定 title/game 或同会话顺序出现；
  - 修复后的资源所有权和幂等顺序；
  - 输入消费协议；
  - UI 状态机；
  - 对话层级和闪烁语义；
  - 两次完整 E2E 的原始 JSON 路径、SHA-256 和结果；
  - 所有提交哈希；
  - 性能状态仍为 `PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`，且本轮未处理性能。
- [ ] 检查提交范围：

```powershell
git diff --stat 4a162b9446bb10be3f720b98531d532db568dd6e...HEAD
git diff --name-status 4a162b9446bb10be3f720b98531d532db568dd6e...HEAD
git status --short
git ls-files '*.log'
```

- [ ] 只提交报告与最终台账：

```powershell
git add -- docs/ENGINE-PLAYER-EXPERIENCE-HOTFIX-WAVE-2-DELIVERY-REPORT-2026-08-11.md docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
git diff --cached --name-only
git commit -m "docs(engine): report player experience hotfix wave 2"
```

- [ ] 提交报告后再运行一次：

```powershell
npm run verify:all
git diff --check
git status --short
git rev-list --left-right --count HEAD...surdet/main
```

- [ ] 停止，不 push。向总经理报告最终 HEAD、相对远端领先数、完整门禁、十项验收、四个受保护文件状态，并明确等待独立复审。

成功状态必须写为：

```text
PLAYER_EXPERIENCE_HOTFIX_WAVE_2_IMPLEMENTED
STABILITY_WAVE_1_RETAINED
PERFORMANCE_WORK_DEFERRED
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED_RETAINED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

若任一项失败，则使用：

```text
PLAYER_EXPERIENCE_HOTFIX_WAVE_2_INCOMPLETE
RELEASE_BLOCKED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

---

## 4. 禁止性验收清单

- [ ] 没有通过 catch/ignore 隐藏 lifecycle 错误。
- [ ] 没有把所有 canvas click 一律禁用，正常游戏面仍可推进。
- [ ] 没有依赖固定延时、防抖或偶然事件顺序。
- [ ] 没有让 empty load slot 调用 load。
- [ ] 没有在 overlay 关闭时无条件恢复 command rail。
- [ ] 没有把 title 与 game 的 overlay return context 混为一谈。
- [ ] 没有把 dialogue text 再次提升到共享 root 最上层。
- [ ] 没有通过透明度技巧或零宽字符伪装“无闪烁”。
- [ ] 没有暴露可变 Renderer/Pixi 对象给调试 API。
- [ ] 没有修改性能 artifact、门限、M9、剧情内容、美术或音频。
- [ ] 没有触碰四个受保护文件。
- [ ] 没有 push、force push、发行或重新打包正式 EXE。

---

## 5. 执行 AI 的故障处理规则

- 若测试命令因路径或现有脚本名变化失败，先用 `rg --files` 和 `package.json` 查明当前事实，在台账记录差异后采用等价的最小命令；不得跳过测试。
- 若真实错误与本文高概率根因不同，以 Task 1 捕获的 owner/kind/key/cause 为准；可以修改“直接导致该真实根因”的文件，但先在台账写明证据和边界。
- 若公共 Renderer API 必须变化，使用一版兼容窗口、同步升级仓库内调用方并加契约测试；不得同时移除旧入口。
- 若修复一个路径导致三条已知正常对照路径回归，立即停止该方向并恢复到最近一次本地提交重新设计；禁止把回归加入“已知限制”。
- 若 E2E 因控件不可定位失败，应补充语义可访问性/只读矩形查询；不得把固定屏幕坐标硬编码为唯一定位方式。
- 若上下文即将压缩，先提交当前已完成的原子阶段并更新台账；未转绿的生产改动不得提交为“完成”，但红灯测试提交可以保留。

---

## 6. 持久化进度台账

> 执行 AI 从 Task 0 开始逐项更新。不得预先勾选，不得删除失败历史。

- [x] Task 0：基线、整改前门禁、计划提交。提交：`fe43fc7453b3bc1566dca21a116591d54353af74`（`docs(engine): freeze player experience hotfix wave 2`）。
- [x] Task 1：真实失败 E2E、lifecycle 可定位错误。提交：`b342b06a62f7b02b09eb3f3e52d95ca864de3e69`（`test(engine): reproduce player experience wave 2 failures`）。
- [x] Task 2：单一 UI 会话状态。提交：`f5e3c9231f6a7965254d886828d420be5cd8163c`（`refactor(zero-after-midnight): centralize player ui session state`）。
- [x] Task 3：指针消费、回退、界面隐藏。提交：`a4f67b36cb3071f8d98a92de24a6b8c874afde04`（`fix(engine): consume player ui input before dialogue advance`）。Task 4 仍需处理独立 E2E 红灯。
- [x] Task 4：合成层级与 title gallery 上下文。实现提交：`5e52d44da7f3d8409a8ed187f235a0c3ee9af73d`（`fix(renderer): preserve overlay input and composition order`）；台账提交：`53a15f213bac21bd4f308974237d5193435e4f1a`。
- [x] Task 5：empty slot、save/load/title 生命周期根因。实现提交：`93d0a1d13faddb22f038c9d85eece27915742f64`（`fix(renderer): make player resource transitions idempotent`）；台账提交：`8eacc4208a5db8015c531a096ee2138c2f43fae4`。
- [x] Task 6：对话框稳定性。提交：`77b3bc5f22e62d5ec05808e7d7dac45d49caf607`（`fix(renderer): keep dialogue presentation stable between lines`）；本记录台账提交待完成。
- [x] Task 7：完整玩家 E2E 矩阵。提交：`22ae65837b030282f939123a0fb7f5ca7224944c`（`test(shell): gate player experience hotfix wave 2`）；本记录台账提交待完成。
- [ ] Task 8：全量门禁、报告、最终停止。提交：`PENDING`。

当前事实（任务书生成时）：

```text
HEAD = 4a162b9446bb10be3f720b98531d532db568dd6e
HEAD...surdet/main = 0 0
Wave 1 = APPROVED / PUSHED
Performance = DEFERRED / MEASUREMENT_NOT_QUALIFIED
M9 = NOT_STARTED
Wave 2 = PLAN_ONLY
```

### 6.1 Task 0 实际执行记录（2026-08-11）

执行时间：`2026-08-11T12:01:36.2640571+08:00`（Asia/Shanghai）。

起始核对：

```text
HEAD = 4a162b9446bb10be3f720b98531d532db568dd6e
HEAD...surdet/main = 0 0
git status --short =
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
?? docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md
```

整改前门禁：

- `npm run verify:all`：退出码 `0`。
- `verify:tools`：`10/10` 通过。
- Renderer boundary：`3/3` 通过。
- Renderer legacy：`4/4` 通过。
- 文档能力检查：通过。
- Hygiene：`575` 个受跟踪路径通过。
- 根级类型检查与构建链：通过。
- 工作区测试：CLI `86`、Core `304`、Editor `142`、Host `18`、Renderer `334`、Shell `117` 全部通过。
- 《零点之后》lint：`11` 个场景、`0 errors`、`0 warnings`。
- 《零点之后》simulate：`23/23` choice 分支、`0` 运行时错误、`3` 个结局、`39` 次存读档 smoke 通过。
- 《零点之后》资产检查：`44` 项通过。
- `git diff --check`：通过。

失败证据：整改前基线门禁未发现失败；后续任务仍必须按测试先行保留每次红灯原始证据。

范围核对：四个受保护未跟踪文件未修改、未暂存；本计划文件是唯一允许进入 Task 0 提交的新增文件。性能测量、性能 artifact、门限、M9、发行物和玩家内容均未触碰。

下一入口：Task 1。Task 1 开始前必须以本台账和 Task 0 提交后的新 HEAD 为准，先建立真实 Electron 失败证据，再进行任何生产修复。

### 6.2 Task 1 实际执行记录（2026-08-11）

执行时间：`2026-08-11T12:29:13.5192702+08:00`（Asia/Shanghai）。当前仍处于 Task 1，尚未开始 Task 2。

测试先行与生命周期诊断：

- 先运行 `npm run test -w @surdet/renderer -- --run test/lifecycle/render-lifecycle.test.ts`，原始红灯为 `6 tests / 4 passed / 2 failed`；在生产实现尚未增加失败记录时，`AggregateError.errors` 只有原始 `Error`，缺少 `owner/kind/key`。
- 红灯覆盖了两种要求：单条 `release` 的 `command='release'`，以及 `releaseOwner` 的多个 disposer 失败全部保留。
- 修复 `RenderLifecycle` 后，同一命令转绿：`6 tests / 6 passed`。失败记录为递归边界内的不可变普通对象，保留原始 `cause`，不暴露 disposer 或资源对象；entries 仍先移除再调用 disposer。
- Shell 注入策略测试：`5 tests / 5 passed`。
- Renderer、Shell、zero-after-midnight typecheck：均退出码 `0`。
- `node --check packages/shell/e2e/player-experience-wave-2.e2e.mjs`：通过；`git diff --check`：通过。

真实 Electron 红灯证据（两次均显式加载正式游戏 `E:\\surdet\\examples\\zero-after-midnight\\dist`，不是 Starter）：

- `<local-path>`，SHA-256 `4D401FBD52BDC5DC5EBE715F06400C284765A538F1E2C84023156E65C3E0E9F4`。UX-01 在 title→gallery→music 后切换 text 超时；UX-03 空槽点击错误关闭读档页，并捕获真实 `RendererError`：`code=COMMAND_COMMIT_FAILED`、`command=release`，失败条目 `owner=menu`、`kind=pool`、`key=thumbnail:<data-url>`，原始 cause 为 `TypeError: Cannot read properties of undefined (reading 'destroy')`；页面错误栈来自 `RenderLifecycle.release`。UX-09 和 UX-04 在该轮分别通过；其余位置探针因前置红灯保留失败，不隐藏。
- `<local-path>`，SHA-256 `A8B0124C776D89E011A4E9060624DDAFA951A32A40ED509CD78A42377B9B7662`。正式游戏与独立 userData 再次确认；UX-01、UX-03 仍红，后续链式 case 因前置状态污染而失败，但该轮没有新的资源错误证据。该失败文件保留，不能用来覆盖第一轮真实资源证据。
- 两次 Electron 启动均使用本轮新建的精确临时 `userData`，监听了 page error、console error、request failure、窗口关闭和 watchdog；脚本使用 `shell:false`，未引入 DEP0190。

Task 1 范围：仅加入失败可定位诊断、正式游戏 E2E 的显式入口策略和语义只读调试投影；尚未修改任何剧情、DSL、存档、玩家规则、性能数据、门限、美术、音频或发行流程。四个受保护未跟踪文件未触碰。

Task 1 实现提交：`b342b06a62f7b02b09eb3f3e52d95ca864de3e69`（`test(engine): reproduce player experience wave 2 failures`）。

下一入口：提交本次台账 SHA 后开始 Task 2 的状态机红灯测试。Task 1 的失败矩阵必须继续保留，不能声明 UX 修复完成。

### 6.3 Task 2 实际执行记录（2026-08-11）

执行时间：`2026-08-11T12:43:27.8511165+08:00`（Asia/Shanghai）。

测试先行与实现：

- 首次运行 `npx vitest run examples/zero-after-midnight/test/player-ui-session.test.ts` 时，因 `src/player-ui-session.ts` 尚不存在而红灯（模块解析失败，未执行任何测试）。
- 创建表驱动测试后，`PlayerUiSession` 实现覆盖 title/game、五类实际阻塞 overlay（加 `none` 共六种状态）、title/game gallery 返回上下文、overlay 互斥、interface hidden、video active、非法 transition、reset、保存/读档成功提交和失败快照回滚。
- 纯查询 `canAdvance`、`canRollback`、`shouldRestoreInterfaceOnPointer`、`shouldShowCommandRail` 只读取同一只读快照；状态机 transition 不调用 Renderer 或执行副作用；快照递归需求在本结构中由冻结扁平普通对象满足。
- 补充的 busy-load 视频完成测试先红：`set-video-active requires operation=idle, got loading`。修复为允许运行时视频完成/状态重置在 busy operation 中更新 `videoActive`，其他玩家 transition 仍拒绝 busy 状态；同一测试转绿。
- 最终状态机测试：`14/14` 通过。

主入口迁移：

- `examples/zero-after-midnight/src/main.ts` 删除 `systemMenuOpen`、`saveLoadOpen`、`onTitleScreen`、`galleryOpen`、`settingsOpen` 和独立 `videoActive` 可写真相；标题/游戏 base、互斥 overlay、busy save/load、界面隐藏和 video 均从 `PlayerUiSession` 派生。
- Save/load 与 quick save/load 使用 begin/complete/fail operation：成功提交目标状态，失败恢复操作前快照；backlog、settings、gallery 和 system menu 入口改用同一 overlay 状态。
- `examples/zero-after-midnight/package.json` 的 workspace test 现在运行既有 simulation verification 与 `test/player-ui-session.test.ts`。

Task 2 门禁：

- `npm run test -w zero-after-midnight`：通过；资产 `44`、11 场景、3 结局验证通过，PlayerUiSession `14/14`。
- `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`：`23/23` choice 分支、`0` 运行时错误、`3` 个结局、`39` 次存读档 smoke。
- `npm run typecheck -w zero-after-midnight`：退出码 `0`。
- `npm run build -w zero-after-midnight`：退出码 `0`；仅保留既有 Vite 大 chunk advisory，不改门禁。
- `git diff --check`：通过。

范围与遗留：四个受保护未跟踪文件未触碰；没有修改 DSL、存档格式、剧情、性能数据/门限、M9 或发行物。Task 1 的两份失败 JSON 仍保留在系统临时目录，Task 1 的 UX 红灯尚未声明修复完成；Task 3 仍需处理 pointer consumption、rollback 和 interface hidden 的实际输入语义。

Task 2 实现提交：`f5e3c9231f6a7965254d886828d420be5cd8163c`（`refactor(zero-after-midnight): centralize player ui session state`）。

下一入口：提交本次台账 SHA 后开始 Task 3 的输入门禁红灯测试。

### 6.4 Task 3 实际执行记录（2026-08-11）

本阶段执行时间：`2026-08-11T12:57:08+08:00` 至 `2026-08-11T12:58:01+08:00`（Asia/Shanghai）。本记录只覆盖 Task 3；真实玩家 E2E 中尚未关闭的 UX-01、UX-03 及其链式失败继续保留，不能提前标记为修复完成。

测试先行与生产实现：

- 首次运行 `npx vitest run examples/zero-after-midnight/test/player-input-gate.test.ts packages/renderer/test/legacy/dialogue-layer.test.ts` 时，输入门禁测试因 `src/player-input-gate.ts` 尚不存在而红灯；同一轮新增的 Dialogue consumed 回归也先以 `consumed=0` 对 `expected=1` 红灯。
- 新增 `PlayerInputGate` 后，同一输入门禁测试转绿：`7/7`。覆盖正常游戏面主键推进、覆盖层忽略、UI 当前事件消费且不污染下一次指针、隐藏界面首次点击只恢复、rollback success/no-op 消费、右键及非主键忽略；实现没有定时器或延迟。
- Dialogue legacy 回归转绿：`11/11`；新增命令栏和全屏 backlog pointer handler 的同步消费断言，两个 handler 均在宿主回调前标记当前事件。
- 《零点之后》工作区测试转绿：资产 `44`、`11` 个场景、`3` 个结局验证通过；`PlayerUiSession` `14/14`、`PlayerInputGate` `7/7`，合计 `21/21`。
- `npm run typecheck -w zero-after-midnight`：退出码 `0`；Renderer typecheck、Shell typecheck 和 Renderer build 已在本阶段生产接线完成后通过；`git diff --check`：通过（仅有 Git 的 LF→CRLF 提示，无 whitespace error）。

正式游戏真实 Electron 证据（本阶段最终运行，显式加载 `E:\\surdet\\examples\\zero-after-midnight\\dist`，不是 Starter，使用独立临时 `userData`）：

- 原始矩阵：`<local-path>`。
- SHA-256：`660776E6411A5A1D6CCBEF1DDB5D88AD81787E78034E86AAB187742BFD2564CD`。
- UX-01 `title → gallery → music → text → close ×5`：仍失败，music overlay 到 text 的切换等待超时；快照保留 `base=title`、`activeOverlay=gallery:music`。
- UX-03 `load → empty slot`：仍失败，空槽错误关闭读档页，并再次保留真实 `RendererError`：`code=COMMAND_COMMIT_FAILED`、`command=release`、`owner=menu`、`kind=pool`、`key=thumbnail:<data-url>`、原始 cause `TypeError: Cannot read properties of undefined (reading 'destroy')`。
- UX-09 `new game → save → load → save`：该轮通过；UX-04 以及前置红灯后的 UX-05/07/08 链式位置检查结果原样保留，未用后续污染状态冒充通过。
- 页面错误数组和 `releaseFailureEvidence` 均保留；没有捕获后忽略、降级为 warning 或通过延时伪装成功。Task 1 的其他三份失败矩阵仍保留在临时目录，未被覆盖。

本阶段接线范围：

- `PlayerInputGate` 统一 canvas pointerdown 的语义决策；`DialogueLayer`、`RendererStageHost` 和 runtime wiring 增加同步 `onPointerConsumed` 端口；标题、存读档、系统菜单、设置、鉴赏、command rail、backlog close 等宿主回调在同一事件中显式消费。
- 当前只增加 Renderer 公开运行时接线所需的 typed callback，没有改 DSL、存档格式、剧情、游戏规则、性能数据/门限、M9、发行物、美术或音频。
- 四个受保护未跟踪文件未修改、未暂存；没有 push、force push、发行或重新打包正式 EXE。

本阶段实现提交：`a4f67b36cb3071f8d98a92de24a6b8c874afde04`（`fix(engine): consume player ui input before dialogue advance`）。下一入口：提交本次台账 SHA 后仅进入 Task 4，先为 overlay z-order 与 title/game gallery return context 建立红灯测试。不得把本阶段仍失败的 UX 项标为已知限制后跳过。

### 6.5 Task 4 实际执行记录（2026-08-11）

执行时间：`2026-08-11T13:42:49+08:00` 至 `2026-08-11T13:50:02+08:00`（Asia/Shanghai）。本阶段只处理覆盖层合成顺序、Gallery 输入边界和 title/game Gallery 返回上下文；Task 1 暴露的资源释放错误仍未宣称修复，Task 5 尚未开始。

测试先行与生产实现：

- Dialogue z-order 回归先红：在生产代码仍把文本节点追加到共享 UI root 时，新增“打开 overlay 后再次更新文本仍低于 overlay”的测试失败（overlay sibling index 低于 text）。随后将 Dialogue 的 panel、speaker、text、ruby、indicator、command rail 等显示对象归入 Dialogue 自有 `#dialogueRoot`，`bringTextDisplaysToFront()` 只在该容器内部排序；同一组回归转绿。
- Gallery tab 生命周期回归先红：新增“hide 后再次 show 保持 tab 控件实例”的测试在原实现中失败（hide 的 `#clearLayer()` 销毁 header/tab）。生产修复改为 show/hide 只清理内容与 listener，保留稳定的全屏 blocker/header/tab；只有 dispose 的完整清理路径销毁整棵 Gallery 树。同一测试转绿。
- Gallery 输入回归覆盖完整视口 blocker、显式 tab `hitArea` 和内容重建稳定性；最终 `packages/renderer/test/layers/gallery-layer.test.ts` 为 `12/12`，`packages/renderer/test/legacy/dialogue-layer.test.ts` 为 `12/12`，`packages/renderer/test/api/renderer-contract.test.ts` 为 `3/3`，聚焦合计 `27/27`。
- 标题进入二级页时，Host 现在明确收起标题交互菜单但保留/重建正确的返回上下文；没有修改公共 Renderer API，也没有修改 Starter、DSL、存档、剧情、游戏规则或玩家内容。

真实 Electron 玩家路径（每次均构建并显式加载 `E:\surdet\examples\zero-after-midnight\dist`，不是 Starter，使用独立临时 userData，真实鼠标点击）：

- 最终脚本矩阵：`<local-path>`。
- SHA-256：`948C27E5655CCB49C36D97E003412321BDB2DA7834F1E998676AB72B0D9D1551`。
- Task 4 目标路径通过：标题 `title → gallery → music → text → close` 连续 `5/5`；游戏 `game → gallery → music/text → close` 连续 `3/3`。两种入口的关闭结果分别保持 title/game base 与 command rail 语义。
- 该次完整脚本仍以非零退出结束：UX-03 空槽/读档路径和 UX-05/07/08 后续位置链路仍失败（前置失败导致后续等待超时），因此不能把矩阵标为全绿，也不能把 Task 5/6 的缺陷降级为已知限制。该次矩阵的 `releaseFailureEvidence` 为空不覆盖此前真实资源失败证据。
- Task 1 资源释放原始证据继续保留：`<local-path>`，SHA-256 `4D401FBD52BDC5DC5EBE715F06400C284765A538F1E2C84023156E65C3E0E9F4`；真实条目仍是 `owner=menu`、`kind=pool`、`key=thumbnail:<data-url>`、原始 cause `TypeError: Cannot read properties of undefined (reading 'destroy')`。

Task 4 门禁：

- `npm run test -w @surdet/renderer -- --run test/legacy/dialogue-layer.test.ts test/layers/gallery-layer.test.ts test/api/renderer-contract.test.ts`：`27/27` 通过。
- `npm run typecheck -w @surdet/renderer`：退出码 `0`。
- `npm run typecheck -w zero-after-midnight`：退出码 `0`。
- `npm run build -w zero-after-midnight`：退出码 `0`；仅保留既有 Vite 大 chunk advisory。
- `git diff --check`：通过；无日志、截图、构建产物或临时文件进入提交。

范围与提交：

- Task 4 实现提交：`5e52d44da7f3d8409a8ed187f235a0c3ee9af73d`（`fix(renderer): preserve overlay input and composition order`）。本提交只包含 6 个预期文件：正式游戏 `main.ts`、Dialogue/Gallery 生产层、两份 Renderer 回归测试和 Shell 玩家 E2E 脚本。
- 当前 HEAD 在台账提交前为 `5e52d44da7f3d8409a8ed187f235a0c3ee9af73d`；相对 `surdet/main` 为 `9 0`。四个受保护未跟踪文件仍未修改、未暂存、未提交。
- 未进入 Task 5 之前不得修改菜单资源所有权；下一入口为 Task 5：先按真实 `menu/pool/thumbnail` 注册/show/hide/reset/release 顺序建立业务复现红灯，随后修复 empty slot 与 save/load/title 生命周期根因。

### 6.6 Task 5 实际执行记录（2026-08-11）

执行时间：`2026-08-11T14:00:00+08:00` 至 `2026-08-11T14:21:51+08:00`（Asia/Shanghai；精确恢复核对时间为 `2026-08-11T14:21:51.9777749+08:00`）。本阶段严格限制在 empty slot、真实菜单资源释放、save/load 事务恢复和回标题生命周期；未进入 Task 6。

测试先行与真实失败证据：

- Renderer 业务复现先红：在生产修复前，执行 `npm run test -w @surdet/renderer -- --run test/legacy/menu-layer.test.ts` 得到 `19 tests | 18 passed | 1 failed`。同一真实 data-URL thumbnail 路径按 `register/show/hide/reset/release` 顺序失败，顶层错误为 `Renderer resource release failed`，`code=COMMAND_COMMIT_FAILED`、`command=release`，失败条目为 `owner=menu`、`kind=pool`、`key=thumbnail:data:image/png;base64,task5-real-thumbnail`，原始 cause 为 `TypeError: Cannot read properties of undefined (reading 'destroy')`；根因是 Pixi v8 在无有效 DOM Image 的测试环境中把原始 data URL 当作缓存资产 ID，`Texture.from(string)` 返回未定义对象。
- Empty load slot 回归随后先红：同一测试文件扩展到 `20 tests | 19 passed | 1 failed`，空槽卡片的目标断言为 `eventMode='static'`，生产代码实际为 `undefined`。该红灯证明空槽既未形成可消费的阻挡交互，也不能单独保证宿主不会收到伪造/陈旧槽位。
- Task 1 的正式 Electron 失败证据没有被覆盖或删除：资源失败矩阵仍保留在 `<local-path>`，SHA-256 为 `4D401FBD52BDC5DC5EBE715F06400C284765A538F1E2C84023156E65C3E0E9F4`；此前各轮失败 JSON 也继续保留在临时目录。

生产修复与边界：

- `MenuLayer` 为 data URL 建立可真实销毁的 Image-backed texture；非 DOM 测试回退到共享 `Texture.WHITE`，只由 cache entry 的 disposer 负责释放。普通资源缺失也只使用共享白纹理，不注册错误的独立销毁者。缓存生命周期保持 hide 保留、reset/dispose 释放，重复 release/reset/dispose 幂等。
- 空 load slot 现在只建立静态、可命中的消费面，不注册 selectable handler；pointerdown 只消费当前事件并停止传播，不调用 onSelect。有效槽位先由 Host 完成事务，再按返回值决定是否关闭 overlay；失败或 `false` 结果保持读档页和 command rail 的正确状态。
- Save/load Host 流程改为 try/commit/catch/restore/finally：空槽/不存在槽位 no-op；保存/读取失败恢复操作前的 UI session、overlay 和 command rail，并保留序列化错误诊断；成功才提交目标状态。H 键与界面按钮共用同一 UI session 语义，隐藏界面的第一次左键只恢复界面。
- Renderer 的真实 disposer 失败仍会从 `RenderLifecycle` 抛出带 owner/kind/key/cause 元数据的 `RendererError`；本阶段没有 catch/ignore、warning 降级、延时或重复 hide/show 伪修复。

专项测试与资源循环：

- `npm run test -w @surdet/renderer -- --run test/lifecycle/render-lifecycle.test.ts test/legacy/menu-layer.test.ts test/integration/resource-cycles.test.ts`：3 个文件、`32/32` 通过（lifecycle `6/6`、menu `21/21`、resource cycles `5/5`）。
- 真实 Renderer 资源循环覆盖：25 轮 system/save-load/gallery/backlog show/hide/reset；10 轮 save/load 交替；3 轮 title/reset/load；最终 stage destroy 与 lifecycle dispose 后监听器、显示对象、补间和资源注册均收敛到基线。
- `npm run test -w @surdet/shell`：15 个文件、`122/122` 通过；`npm run typecheck -w @surdet/renderer`、`npm run build -w @surdet/renderer`、`npm run typecheck -w zero-after-midnight` 均退出码 `0`；`node --check packages/shell/e2e/player-experience-wave-2.e2e.mjs` 通过。

正式游戏真实 Electron 验收：

- 最终矩阵显式加载 `E:\surdet\examples\zero-after-midnight\dist`（不是 Starter），每次使用独立临时 userData，并使用真实鼠标点击：`<local-path>`。
- 该矩阵 SHA-256：`F607750FE44FB5A595CAE9DBF72F6E3D2EEE8E89B0E94675CF8D37560B37A41B`；`npm run e2e:player-experience -w @surdet/shell` 退出码 `0`，6 个验收 case 全部通过：标题鉴赏 5/5、正式游戏鉴赏 3/3、空槽点击 5 次保持读档页、真实 save/load 交替、load 后系统菜单回标题、backlog/rollback/hidden interface 位置语义。
- 最终 E2E 的 `pageErrors=[]`、`consoleErrors=[]`、`requestFailures=[]`、`releaseFailureEvidence=[]`；正式游戏路径已验证，不是默认 Starter。旧红灯证据仍保留，不能只报告绿色轮次。

提交、范围与下一入口：

- Task 5 实现提交：`93d0a1d13faddb22f038c9d85eece27915742f64`（`fix(renderer): make player resource transitions idempotent`）。本记录提交前 HEAD 为该 SHA，相对 `surdet/main` 为 `11 0`；提交本台账后预期为 `12 0`。
- 受保护的 `SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文档仍仅为未跟踪文件，未修改、未暂存、未提交；没有 push、force push、M9、性能测量/优化、性能 artifact/门限、发行、重打包、剧情/DSL/存档格式或美术音频变更。
- Task 5 已按本记录完成并可进入下一阶段；下一入口为 Task 6：先为“开始新对话行时文本为空但面板保持可见”及连续 10 行无非法 `true → false → true` 建立红灯，随后再修改对话生命周期。不得跳过测试先行，也不得把本阶段以外的 UX 项提前宣称完成。

### 6.7 Task 6 实际执行记录（2026-08-11）

执行时间：`2026-08-11T14:21:51+08:00` 至 `2026-08-11T14:56:37+08:00`（Asia/Shanghai）。本阶段只处理对话换行开始/显式清空的可见性语义，以及为真实玩家点击补充呈现提交屏障；未进入 Task 7。

测试先行与原始红灯：

- 在生产实现尚未增加 `beginText` / `clearText` 前，`dialogue-layer.test.ts` 新增断言因公开命令不存在而失败：`14 tests / 2 failed`，缺失 `beginText` 和 `clearText`。
- 同一生产状态下，`presentation-controller.test.ts` 的控制器接线红灯：`10 tests / 1 failed`，期望 `stage.begins=[null]`，实际为空数组；合并专项为 `24 tests / 21 passed / 3 failed`。这些红灯均保留在执行记录中，随后由同一测试转绿。
- 生产修复后，`npm run test -w @surdet/renderer -- --run test/legacy/dialogue-layer.test.ts test/legacy/presentation-controller.test.ts` 为 `2 files / 24 passed`。

生产实现：

- `DialogueLayer` 增加明确的 `beginText(speaker)` 与 `clearText()` 语义；`beginText` 在空文本阶段保持 panel 可见，`clearText` 才允许清空并隐藏；`#lineActive` 防止 `setAwaiting(false)` 在新行起始阶段制造空白帧。
- `PresentationController` 在每条文本事件开始时先发出 `beginText`，仅在 reset/session clear 时发出 `clearText`；空说话人旁白、中文、扩展汉字和 emoji 仍走同一文本对象池与 Unicode 换行路径。
- `renderer-commands.ts`、`presentation-ports.ts`、`PixiStageHost`、legacy adapter 与 `RendererFacade` 提供 additive 兼容接线；旧 `showText` 路径仍保留回退，不复制第二套剧情语义。
- E2E 语义采样通过 `requestAnimationFrame` 记录每行 12 帧的 `panelVisible/dialogText/position`。诊断发现标题/鉴赏刚完成同步投影时，单个 RAF 仍可能早于 Pixi 命中变换提交；因此玩家 E2E 的 semantic click 增加两次连续 RAF 的目标前/动作后呈现屏障。这不是固定毫秒延时、debounce、hide/show 重试或生产代码修改。

真实 Electron 证据（每次显式加载正式《零点之后》dist，独立临时 userData，真实鼠标/键盘）：

- 在新增呈现屏障前的失败矩阵：`<local-path>`，SHA-256 `CC95DC7453F8AF562047D18299DCFA19208E6A076DB13159AACFE24D05466943`。UX-02 已通过；UX-01/UX-09 等后续失败是命中树/同会话链式等待失败，快照无 page error、console error、request failure、RendererError，且失败时 `uiSession.base=title`、`activeOverlay=title`，原始 JSON 未覆盖。
- 修复后的完整 Task 6 矩阵：`<local-path>`，SHA-256 `15D62E3A19B9E907569C6F3AA19082D5D94BF882C97E04A4C627A25CEC0FACFB`，状态 `PASSED`。
- 该轮通过：UX-02 连续 10 句逐帧无非法闪烁；标题鉴赏 5/5；同会话 save→load→save→load 三轮及 load→save→load→save 三轮；游戏鉴赏 3/3；读档后系统菜单回标题；空槽点击 5 次；backlog/rollback/hidden interface 对照路径。`pageErrors=[]`、`consoleErrors=[]`、`requestFailures=[]`、`releaseFailureEvidence=[]`。

Task 6 门禁：

- Renderer focused：2 个文件、`24/24` 通过。
- `npm run typecheck -w @surdet/renderer`：退出码 `0`。
- `npm run build -w @surdet/renderer`：退出码 `0`。
- `node --check packages/shell/e2e/player-experience-wave-2.e2e.mjs`：通过。
- `npm run e2e:player-experience -w @surdet/shell`：退出码 `0`（正式游戏矩阵状态 `PASSED`）。
- `git diff --check` 与 staged diff check：通过；仅有 Git 的 LF→CRLF 提示，无 whitespace error。

范围与提交：

- Task 6 实现/测试/E2E 提交：`77b3bc5f22e62d5ec05808e7d7dac45d49caf607`（`fix(renderer): keep dialogue presentation stable between lines`）。
- 本阶段未修改 DSL、存档格式、剧情、游戏规则、性能数据/门限、M9、发行物、美术或音频；未 push、未 force push、未 rebase、未 reset。
- `SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文档仍仅为未跟踪文件，未修改、未暂存、未提交、未删除。

下一入口：先提交本记录台账，随后开始 Task 7 的完整玩家 E2E 矩阵固化；不得提前进入 Task 8 或发行。

### 6.8 Task 7 实际执行记录（2026-08-11）

执行时间：`2026-08-11T15:05:00+08:00` 至 `2026-08-11T16:32:00+08:00`（Asia/Shanghai）。本阶段只固化真实玩家 Electron 验收矩阵与测试证据，没有修改生产 Renderer、Core、Host、Starter 运行时代码，也没有改变 verify-all 快速门禁接线；未进入 Task 8。

执行协议：

- 正式游戏构建完成后，每个顶层 case A–I 都独立启动 Electron，并使用独立临时 `userData`；每次完整矩阵包含 9 个独立 userData。case 内的 save/load/title 序列保持同一 Electron 会话。
- 每轮显式使用 `E:\surdet\examples\zero-after-midnight\dist`，不是默认 Starter；动作通过真实鼠标/键盘事件，语义调试接口只读取快照，`showTitleScreen()` 仅用于 case 间返回标题的初始化，不代替被测覆盖层动作。
- 每个 case 收集 pageerror、console error、request failure、unhandled rejection、窗口意外关闭、RendererError、资源快照、解释器位置和 UI session；`renderer resource release failed`、`COMMAND_COMMIT_FAILED` 和未处理异常均为失败。

测试先行与失败证据（全部原始 JSON 保留在系统临时目录）：

- 第一版完整矩阵暴露测试夹具错误：B 使用 Space 误测鉴赏页；C/D 的浏览器谓词错误引用 Node 闭包。`...task7-mBjqsN...` SHA-256 `971DC7268D978314FA100F6579C2694B0DC3B7AD40845B73056549FC83222BE4`，状态 `FAILED`，6/9 case 通过。
- 修正 B 为真实 gallery tab click、修正 C/D 为浏览器内安全谓词后，第二轮仍暴露真实输入边界：单次 Space/画布左键可能只完成当前打字机/等待阶段而未改变位置。`...task7-PE2n82...` SHA-256 `10CDF4B38E025087FAC93CA6A6D39A823DF85F74020E361FA4BC652F57BB0E26`，状态 `FAILED`，7/9 case 通过。
- 将正常同一输入扩展为最多四次、仍要求真实位置变化后，C 的回退耗尽断言先暴露历史缓冲重复检查点：`...task7-5apRBB...` SHA-256 `32A5C77FE62D61ECFF25C11595CE8B92007C980F4F05DD82273D45858A7BFDE0`，状态 `FAILED`，8/9 case 通过。
- 增加每次回退前 `awaiting-advance` 稳定状态护栏后，单次 no-op 仍不足以证明历史已耗尽；`...task7-PMIc0K...` SHA-256 `B55B1F0755727282952F07A85999DAA99B2933AAFE66FCCB84F15E37CB39F46B`，状态 `FAILED`，8/9 case 通过；随后同一问题在 `...task7-TO0dx6...` 再现，SHA-256 `0F735BD521422F06F0D1094EECD9910A307AC0737DE7E42E19E76B7600BAE2FE`。
- 最小测试夹具修正是：只有连续两次稳定 no-op 才判定回退缓冲已耗尽，随后再额外验证 4/5 次 no-op；没有延时、debounce、hide/show 重试或生产逻辑修改。

两轮最终独立矩阵：

- 第一轮：`<local-path>`，SHA-256 `77A676492DC8299BDF0DB32BB534DF2FACBA570E258237212464581F1003808D`，schema `2`，状态 `PASSED`，A–I `9/9`。
- 第二轮：`<local-path>`，SHA-256 `262F75BB15C180C52428276A9123E6697AF05D981AD46F058D8B9F4A07FED473`，schema `2`，状态 `PASSED`，A–I `9/9`。
- 两轮均无 page error、console error、request failure、unhandled rejection、意外窗口关闭或 `releaseFailureEvidence`；正式游戏资产加载快照为 `total=48/completed=48/failed=0/done=true`。
- A–I 覆盖标题鉴赏、系统菜单/记录/设置/鉴赏、可用与已耗尽回退、H/界面隐藏恢复、空槽、两种 save/load 顺序、load/title/new、三条正常对照路径，以及连续 10 句逐帧对话采样。

Task 7 门禁与范围：

- 两轮 `npm run e2e:player-experience -w @surdet/shell` 均退出码 `0`；每轮内部顺序构建 core → renderer → host → shell → zero-after-midnight，构建成功。
- `node --check packages/shell/e2e/player-experience-wave-2.e2e.mjs`：通过；`git diff --check`：通过。
- 精确修改文件只有 `packages/shell/e2e/player-experience-wave-2.e2e.mjs`；未修改 `packages/shell/package.json`、`scripts/verify-all.mjs` 或 `scripts/test/verify-all.test.mjs`，因为既有独立 `e2e:player-experience` 脚本已满足本阶段执行路径，快速门禁未被长 Electron E2E 重复污染。
- Task 7 实现提交：`22ae65837b030282f939123a0fb7f5ca7224944c`（`test(shell): gate player experience hotfix wave 2`）。提交后 `HEAD...surdet/main = 15 0`。
- 受保护的 `SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文档仍仅为未跟踪文件，未修改、未暂存、未提交、未删除；没有 push、force push、M9、性能测量/优化、性能 artifact/门限、发行、重打包、剧情/DSL/存档格式或美术音频变更。

下一入口：提交本台账后进入 Task 8，按计划顺序执行全量回归、正式游戏门禁、两类 Electron E2E、最终交付报告；Task 8 完成前不得声明 Wave 2 完成，不得 push。
