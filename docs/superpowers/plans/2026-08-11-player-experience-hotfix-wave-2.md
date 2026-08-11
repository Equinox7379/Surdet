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
- [ ] Task 1：真实失败 E2E、lifecycle 可定位错误。提交：`IMPLEMENTATION_COMMIT_PENDING`。
- [ ] Task 2：单一 UI 会话状态。提交：`PENDING`。
- [ ] Task 3：指针消费、回退、界面隐藏。提交：`PENDING`。
- [ ] Task 4：合成层级与 title gallery 上下文。提交：`PENDING`。
- [ ] Task 5：empty slot、save/load/title 生命周期根因。提交：`PENDING`。
- [ ] Task 6：对话框稳定性。提交：`PENDING`。
- [ ] Task 7：完整玩家 E2E 矩阵。提交：`PENDING`。
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

- `C:\\Users\\Equinox\\AppData\\Local\\Temp\\surdet-player-experience-wave-2-task1-r9XqQn\\task1-failure-matrix.json`，SHA-256 `4D401FBD52BDC5DC5EBE715F06400C284765A538F1E2C84023156E65C3E0E9F4`。UX-01 在 title→gallery→music 后切换 text 超时；UX-03 空槽点击错误关闭读档页，并捕获真实 `RendererError`：`code=COMMAND_COMMIT_FAILED`、`command=release`，失败条目 `owner=menu`、`kind=pool`、`key=thumbnail:<data-url>`，原始 cause 为 `TypeError: Cannot read properties of undefined (reading 'destroy')`；页面错误栈来自 `RenderLifecycle.release`。UX-09 和 UX-04 在该轮分别通过；其余位置探针因前置红灯保留失败，不隐藏。
- `C:\\Users\\Equinox\\AppData\\Local\\Temp\\surdet-player-experience-wave-2-task1-QGP8WB\\task1-failure-matrix.json`，SHA-256 `A8B0124C776D89E011A4E9060624DDAFA951A32A40ED509CD78A42377B9B7662`。正式游戏与独立 userData 再次确认；UX-01、UX-03 仍红，后续链式 case 因前置状态污染而失败，但该轮没有新的资源错误证据。该失败文件保留，不能用来覆盖第一轮真实资源证据。
- 两次 Electron 启动均使用本轮新建的精确临时 `userData`，监听了 page error、console error、request failure、窗口关闭和 watchdog；脚本使用 `shell:false`，未引入 DEP0190。

Task 1 范围：仅加入失败可定位诊断、正式游戏 E2E 的显式入口策略和语义只读调试投影；尚未修改任何剧情、DSL、存档、玩家规则、性能数据、门限、美术、音频或发行流程。四个受保护未跟踪文件未触碰。

下一入口：完成 Task 1 聚焦提交并在随后台账提交中记录真实 SHA，然后开始 Task 2 的状态机红灯测试。Task 1 的失败矩阵必须继续保留，不能声明 UX 修复完成。
