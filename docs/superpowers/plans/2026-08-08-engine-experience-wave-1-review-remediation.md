# Engine Experience Optimization Wave 1 Review Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This project must be handled serially by one execution AI; do not dispatch subagents or parallel workers. Steps use checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** 修复 Wave 1 独立复审确认的四个阻断项，使回退边界、系统快照原子恢复、`@surdet/host` 架构边界和 Vite 场景热更新同时符合已批准计划，并提交一份可复验的修正报告。

**Architecture:** 公共 `@surdet/host` 只保留 adapter 注册、system 路由、pause/resume/fail、reset/dispose 和 save hooks 聚合；具体日历、战斗、商店、好感与成就行为继续由游戏侧 adapter 注入。回退在任何有外部或游戏规则副作用的 system 交互处建立硬边界；快照恢复使用与各系统 `restore()` 同源的无副作用深层校验；开发热更新必须经过 Vite 可静态识别的 HMR 接受链并由真实开发服务器测试证明不会整页刷新。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、PixiJS、Howler、Vite 6、Electron 43、GitHub Actions、PowerShell。

## 批复结论

当前交付暂不批准 commit 或 push，退回定向补正，不要求推倒重做。现有类型检查、754 项测试、正式游戏 lint/simulate、starter shell E2E、P1/P2 门禁和发行包结构校验均通过；Profile、加载队列、Loading Layer、转场、环境音、快捷键、Backlog 搜索和统计等非阻断成果应予保留。

本轮只修复以下四项：

1. 回退不能跨越 system 交互边界；
2. 系统快照必须在任何系统发生变更前完成配置相关的深层校验；
3. `@surdet/host` 不得拥有游戏规则、默认单位和具体游戏文案；
4. `.gal` 热更新必须建立 Vite 可识别的 HMR 接受关系并通过真实开发服务器测试。

## Global Constraints

- 仓库：`E:\surdet`；基线提交：`3ecd43a0ad5829b0253141e9a5bd42db061ff1e4`；分支：`main`；基线远端：`surdet/main`。
- 只允许一个执行 AI 串行工作，不得派生 subagent，不得并行修改入口、renderer 或 host。
- 未获项目所有者新的明确授权前，不得执行 `git commit`、`git push`、`git reset`、`git clean`、`git checkout --` 或批量格式化。
- 保留 `USER.md`、`SESSION-HANDOFF.md` 以及所有现有用户修改，不读取或操作用户真实存档目录。
- 不重复 Wave 1 已通过能力，不扩展 Wave 2，不新增立绘差分、Idle 动画、LSP、纹理图集、确定性重放、Plugin API v2 等范围外功能。
- 不把 `zero-after-midnight`、`prologue`、正式标题、默认兵种、正式素材名或具体游戏文案硬编码进通用引擎包。
- 所有临时项目和 Electron 验收必须使用仓库内经绝对路径确认的临时目录或系统临时目录；删除前必须再次验证目标绝对路径。
- 所有新增测试先证明当前实现失败，再做最小修复；不得通过放宽阈值、删除断言或跳过测试制造 PASS。
- 每完成一个任务立即更新本文件相应复选框；未完成项不得在修正报告中宣称完成。
- 修正完成后仍保持工作树未提交、未推送，交由总经理复审。

---

## 复审证据摘要

### 阻断 A：回退可跨越 system 交互

原计划要求集成测试证明 `rollback cannot cross a system interaction boundary`，见原计划 Task 7 Step 6。当前三个入口只在新游戏、标题、读档或存档不兼容时清空缓冲，没有在 system 交互处建立边界：

- `examples/starter/src/main.ts`：`connectSystemRouter` 约第 427 行；
- `examples/zero-after-midnight/src/main.ts`：`connectSystemRouter` 约第 420 行；
- `packages/cli/templates/game/src/main.ts`：`connectSystemRouter` 约第 190 行。

现有 `packages/renderer/test/rollback-buffer.test.ts` 只验证缓冲容器，不验证宿主副作用边界。正式 EXE 的 `prologue:8 -> prologue:7` 只证明普通文本回退，不覆盖战斗、商店或日历。

### 阻断 B：系统快照预校验过浅

starter 与正式游戏共用的 `validateSnapshot` 只判断“非数组对象”，但 `CombatSolver.restore()` 还会检查阵营是否属于当前配置、HP 是否在 `0..maxHp`。结构合法但配置不兼容的 combat 快照可在 calendar 已恢复后才抛错，形成部分恢复。

### 阻断 C：公共 host 越过规则边界且行数指标失败

原计划要求 `@surdet/host` 只负责路由和生命周期。当前 `packages/host/src/system-router.ts` 直接推进日历、执行商店购买、驱动战斗 AI，并包含默认阵容 `allies: ['sword'], enemies: ['goblin']` 和具体 UI 文案。

宿主入口基线合计为 `1328 + 1399 = 2727` 行，目标至少减少 350 行；当前 starter 约 1389 行、正式游戏约 1449 行，合计约 2838 行，实际增加约 111 行。若安全抽取后仍达不到目标，必须披露真实数字和原因，不得把规则继续搬进 host 追逐指标。

### 阻断 D：Vite HMR 接受关系未被静态识别

三个入口使用：

```ts
import.meta.hot.accept(Object.keys(sceneFiles), () => undefined);
```

当前 Vite 6 的 HMR 分析只识别字符串字面量或字符串字面量数组。真实 Vite transform 会保留上述动态调用，现有纯函数测试没有证明 `.gal` 更新不会触发整页刷新。

---

### Task 0: Freeze the Remediation Baseline

**Files:**
- Read: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-DELIVERY-REPORT-2026-08-08.md`
- Read: `docs/superpowers/plans/2026-08-08-engine-experience-optimization-wave-1.md`
- Read: `docs/superpowers/plans/2026-08-08-engine-experience-wave-1-review-remediation.md`
- Preserve: `USER.md`
- Preserve: `SESSION-HANDOFF.md`

**Interfaces:**
- Consumes: 当前未提交 Wave 1 工作树。
- Produces: 可与修复后状态比较的精确基线记录，不产生源码改动。

- [x] **Step 1: 记录 Git 身份与工作树**

Run:

```powershell
git rev-parse HEAD
git branch --show-current
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --stat
git diff --numstat
git ls-files --others --exclude-standard
```

Expected:

- HEAD 为 `3ecd43a0ad5829b0253141e9a5bd42db061ff1e4`；
- 分支为 `main`；
- 与 `surdet/main` 分歧为 `0 0`；
- `USER.md`、`SESSION-HANDOFF.md` 仍存在；
- 没有执行清理、暂存、提交或推送。

- [x] **Step 2: 记录四项缺口的源码证据**

Run:

```powershell
rg -n "connectSystemRouter|clearRollback|validateSnapshot|import.meta.hot.accept" examples/starter/src/main.ts examples/zero-after-midnight/src/main.ts packages/cli/templates/game/src/main.ts
rg -n "sword|goblin|advanceTurn|suggestAction|shop.buy" packages/host/src/system-router.ts
```

Expected: 能定位复审报告中的现有问题；此步骤不得改文件。

---

### Task 1: Enforce a Hard Rollback Boundary Around System Interactions

**Files:**
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Test: 优先在 `packages/host/test/` 新增宿主接线级测试；若入口难以直接测试，可创建一个只负责回退边界协调的聚焦模块及对应测试，但不得把游戏规则移入 renderer。
- Test: `packages/renderer/test/rollback-buffer.test.ts` 仅在补充缓冲自身契约时修改。

**Interfaces:**
- Consumes: `RollbackBuffer.clear()`、`EventBus<CoreEventMap>`、`connectSystemRouter()`。
- Produces: 一个在 system 交互开始、成功结束和失败恢复路径上行为明确的回退边界；普通 ADV 文本回退仍可使用。

- [x] **Step 1: 写一个当前必然失败的 system 边界集成测试**

测试场景必须包含以下行为，而不是只测 `RollbackBuffer`：

```ts
it('cannot roll back across a completed system interaction', async () => {
  // 1. 建立 system 前文本检查点；
  // 2. 路由一个会产生可观察副作用的测试 adapter；
  // 3. adapter 完成并恢复到普通 ADV 状态；
  // 4. 触发 rollback；
  // 5. 断言不能返回 system 交互前的检查点，副作用也没有重复执行。
});
```

同时增加失败路径：

```ts
it('closes the rollback boundary when a system adapter fails', async () => {
  // adapter 抛错后，解释器不得冻结，也不得保留可跨越该交互的旧检查点。
});
```

- [x] **Step 2: 运行定向测试并确认失败原因正确**

Run（按实际测试文件名替换 `<boundary-test>`）：

```powershell
npm test -w @surdet/host -- <boundary-test>
```

Expected: FAIL，原因应是当前 system 路由没有清空或封闭 rollback 历史；不得以导入错误或类型错误代替行为失败。

- [x] **Step 3: 实现最小边界协调**

要求：

- system 交互一旦开始，交互前的回退帧不得在其完成后继续可用；
- adapter 成功、失败、reset 和 dispose 路径行为一致；
- 不得在普通文本推进时每次清空；
- 不得破坏 `rollbackRestoring` 对 autosave 和 achievement 的抑制；
- starter、正式游戏、CLI 模板共享同一策略，避免三份不同语义；
- 边界协调只处理生命周期，不处理战斗、商店或日历规则。

推荐接口形状可采用回调而不是让 host 依赖 renderer：

```ts
export interface DefaultHostOptions {
  // 现有字段保持兼容
  onSystemBoundary?: (phase: 'enter' | 'complete' | 'fail' | 'reset') => void;
}
```

如果存在更小且更符合现有类型结构的方案，可以采用，但测试必须证明四条路径。

- [x] **Step 4: 验证回退行为**

Run:

```powershell
npm test -w @surdet/host
npm test -w @surdet/renderer -- rollback-buffer.test.ts adv-renderer.test.ts
npm run typecheck
```

Expected: 全部 PASS；普通文本连续检查点仍按 LIFO 回退，system 交互后不能跨界。

---

### Task 2: Make System Snapshot Restore Actually Atomic

**Files:**
- Modify: `packages/core/src/calendar/calendar.ts`
- Modify: `packages/core/src/combat/combat.ts`
- Modify: `packages/core/src/systems/affection.ts`
- Modify: `packages/core/src/systems/achievement.ts`
- Modify: `packages/core/src/systems/event-scheduler.ts`
- Modify only if required: `packages/host/src/save-hooks.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Test: `packages/core/test/interpreter-save.test.ts`
- Test: `packages/host/test/system-router.test.ts`

**Interfaces:**
- Consumes: `HostStateAdapter.validate(value)` 与各系统现有 `restore(snapshot)`。
- Produces: 各系统无副作用的快照验证入口，或等价的共享 validator；所有 adapter 在任何 restore 发生前完成真实前置条件验证。

- [x] **Step 1: 写部分恢复复现测试**

测试必须构造：

- 有效但与当前状态不同的 calendar 快照；
- 字段类型合法、但 `team` 不属于当前 `CombatConfig.teams` 的 combat 快照；
- adapter 顺序为 calendar 在前、combat 在后。

核心断言：

```ts
expect(() => hooks.restore?.(incoming as never)).toThrow(/非法阵营|team/);
expect(calendar.snapshot()).toEqual(calendarBefore);
expect(combat.snapshot()).toEqual(combatBefore);
```

- [x] **Step 2: 运行测试确认当前实现发生部分恢复或验证过晚**

Run:

```powershell
npm test -w @surdet/host -- system-router.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts
```

Expected: 新增测试 FAIL，且失败能证明 calendar 在 combat 抛错前已被修改，或浅层 validator 未拒绝配置不兼容快照。

- [x] **Step 3: 为各系统提供与 restore 同源的无副作用验证**

推荐契约：

```ts
class CombatSolver {
  validateSnapshot(snap: unknown): asserts snap is CombatSnapshot;
  restore(snap: CombatSnapshot): void {
    this.validateSnapshot(snap);
    // 校验完成后才提交新状态
  }
}
```

Calendar、Affection、Achievement、EventScheduler 采用相同原则：

- validator 不修改字段、Set、Map 或 VariableStore；
- `restore()` 复用 validator，避免两套规则漂移；
- 检查不仅是对象形状，还包括 restore 真正依赖的数组、有限数值、范围、配置成员关系和兼容默认值；
- 旧存档允许缺省的字段继续兼容，不得误伤既有迁移路径。

- [x] **Step 4: 在两个游戏入口接入具体 validator**

删除或停止使用统一的浅层 `validateSnapshot`，为每个 adapter 接入对应系统的无副作用验证：

```ts
{
  id: 'combat',
  snapshot: () => combat.snapshot(),
  validate: (value) => combat.validateSnapshot(value),
  restore: (value) => combat.restore(value),
}
```

其他系统使用同样的具体契约，不得通过 `as never` 掩盖未验证数据。

- [x] **Step 5: 验证原子恢复与旧档兼容**

Run:

```powershell
npm test -w @surdet/core -- interpreter-save.test.ts audit-fixes.test.ts
npm test -w @surdet/host -- system-router.test.ts
npm run typecheck
```

Expected: 全部 PASS；任一 adapter 验证失败时，所有系统均保持加载前状态。

---

### Task 3: Restore the Bounded `@surdet/host` Architecture

**Files:**
- Modify: `packages/host/src/system-router.ts`
- Modify: `packages/host/src/create-host.ts` only if lifecycle callbacks require it
- Modify: `packages/host/src/types.ts`
- Modify: `packages/host/src/index.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Test: `packages/host/test/create-host.test.ts`
- Test: `packages/host/test/system-router.test.ts`
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Consumes: `HostSystemAdapter<TPayload>`、`HostSystemContext`、`createDefaultHost()`、`createSystemHooks()`。
- Produces: 只负责路由和生命周期的公共 host；游戏规则由游戏侧 adapter/callback 注入。

- [x] **Step 1: 写公共 host 不拥有游戏规则的契约测试**

测试应使用假的通用 adapter，并证明 host 只做：

```ts
const adapter: HostSystemAdapter = {
  id: 'battle',
  open: async (payload, context) => {
    observedPayload = payload;
    context.resume();
  },
};
```

必须保留现有契约：

- optional adapters；
- duplicate ID rejection；
- unknown system returns false；
- pause before open；
- exactly-once resume；
- async failure recovery；
- reset closes active adapter；
- dispose idempotent。

- [x] **Step 2: 从公共 host 删除具体规则和默认内容**

`packages/host/src/system-router.ts` 不得继续直接：

- 调用 `CalendarRunner.advanceTurn()`、`enter()` 或 `execBaseCommand()`；
- 调用 `CombatSolver.start()`、`act()`、`suggestAction()`、`moveUnit()` 或 `pass()`；
- 调用 `ShopSystem.buy()`；
- 决定 `gold`、`bag` 等游戏变量名；
- 硬编码 `sword`、`goblin` 或其他单位；
- 持有“战斗开始”“欢迎光临”等产品文案；
- 决定某个 affection、achievement 或 scheduler 事件的游戏含义。

公共层可保留或缩减为类似：

```ts
export function connectSystemRouter(
  bus: EventBus<CoreEventMap>,
  host: { routeSystem(id: string, payload: unknown): Promise<boolean> },
  onError?: (error: unknown) => void,
): () => void;
```

- [x] **Step 3: 在项目侧实现具体 adapters**

starter 和正式游戏各自提供自己的日历、战斗、商店、好感、成就 adapter。允许抽取不含游戏默认值的项目级辅助模块，但不得把两份游戏规则重新合并进 `@surdet/host`。

CLI 模板应展示最小、可理解的 adapter 示例，不应自带正式游戏规则或单位配置。

- [x] **Step 4: 逐入口验证行为等价**

按以下顺序串行执行，不得同时迁移：

1. CLI 模板；
2. starter；
3. `zero-after-midnight`。

每迁移一个入口立即执行对应验证：

```powershell
npm run typecheck
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
```

Expected: 正式模拟仍为 24 paths、23/23 choices、39 次 save/load、3 endings、0 runtime errors。

- [x] **Step 5: 精确计算宿主入口行数**

Run:

```powershell
$starterLines = (Get-Content examples/starter/src/main.ts).Count
$formalLines = (Get-Content examples/zero-after-midnight/src/main.ts).Count
$combinedLines = $starterLines + $formalLines
"starter=$starterLines formal=$formalLines combined=$combinedLines reduction=$((1328 + 1399) - $combinedLines)"
```

Acceptance:

- 首选：合计相对 2727 行至少减少 350 行，即 `combined <= 2377`；
- 不得通过 minify、合并多语句到一行、删除有价值注释或把规则塞进 host 达标；
- 若安全边界下确实无法达到，停止继续追逐数字，在修正报告中列出真实数字、剩余重复模块和不继续抽取的理由，申请总经理例外；
- 未获例外前不得宣称 Task 3 完成。

- [x] **Step 6: 验证公共包不含游戏硬编码**

Run:

```powershell
rg -n "zero-after-midnight|prologue|sword|goblin|欢迎光临|战斗开始|suggestAction|advanceTurn|shop\.buy" packages/host
```

Expected: 公共 host 源码中没有项目 ID、默认单位、产品文案或直接游戏规则调用；测试 fixture 中若使用通用占位文本，必须与正式内容无关。

---

### Task 4: Implement Real Vite `.gal` Hot Reload

**Files:**
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify only if useful: `packages/renderer/src/scene-hot-reload.ts`
- Test: `packages/renderer/test/scene-hot-reload.test.ts`
- Create: 一个真实 Vite HMR 集成测试文件，放在最接近 Vite 游戏宿主的 workspace 测试目录
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Consumes: `SceneRegistry.replace()`、`decideSceneHotReload()`、Vite `import.meta.hot`。
- Produces: Vite 可静态识别的 `.gal` HMR 边界；更新成功时原子替换，编译失败时保留旧场景，不重建长期资源。

- [x] **Step 1: 写真实开发服务器 HMR 失败测试**

测试必须使用临时游戏副本并执行完整链路：

1. 启动 Vite 开发服务器；
2. 使用 Playwright 打开临时项目；
3. 等待 `__surdetDebug` 就绪；
4. 记录页面会话标识、当前 scene/PC、PixiStage、AudioManager、FrameScheduler 和 active Blob URL 计数；
5. 修改临时副本中的活动 `.gal`；
6. 等待 HMR 消息与场景 hash 更新；
7. 断言页面没有 reload，长期实例身份不变，PC 被 clamp 到合法边界；
8. 再写入语法错误，断言旧 scene/hash/PC 保留且出现可诊断错误；
9. 还原或删除临时副本。

测试探针必须是只读身份/计数，不得参与生产逻辑。

- [x] **Step 2: 运行集成测试并证明动态 accept 接线失败**

Run（按实际 workspace 和文件名替换）：

```powershell
npm test -w surdet-starter -- vite-scene-hmr.test.ts
```

Expected: 当前实现 FAIL，表现为整页 reload、scene hash 未热替换或长期实例身份改变；失败不能只是测试启动配置错误。

- [x] **Step 3: 改成 Vite 可静态分析的接受关系**

禁止继续使用：

```ts
import.meta.hot.accept(Object.keys(sceneFiles), () => undefined);
```

实现必须满足：

- `hot.accept()` 的依赖为 Vite 可静态分析形式，或由一个明确自接受模块承载；
- 更新来源与 `import.meta.glob('../content/scenario/**/*.gal', { query: '?raw', import: 'default' })` 保持一致；
- 编译 replacement 后先检查 diagnostics，存在 error 时不调用 registry.replace；
- active scene 匹配时才通过正常 `loadSnapshot()` 恢复位置；
- 不匹配时只替换 registry，不跳转场景；
- 不创建 Node/Electron 文件监听器；
- 生产构建中没有运行时 watcher。

- [x] **Step 4: 验证 HMR 和生产构建**

Run:

```powershell
npm test -w @surdet/renderer -- scene-hot-reload.test.ts
npm test -w surdet-starter -- vite-scene-hmr.test.ts
npm run build -w surdet-starter
npm run build -w zero-after-midnight
npm run typecheck
```

Expected: 全部 PASS；真实开发 HMR 不整页刷新，生产构建无 Node 文件监听依赖。

---

### Task 5: Full Regression and Reproducible Acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-engine-experience-optimization-wave-1.md`
- Modify: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-DELIVERY-REPORT-2026-08-08.md`
- Create: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-REMEDIATION-REPORT-2026-08-08.md`
- Modify only if required by facts: `docs/AI-GUIDE.md`
- Modify only if required by facts: capability matrix source/generated documents

**Interfaces:**
- Consumes: Tasks 1–4 的代码和测试结果。
- Produces: 一份只陈述可复验事实的修正报告，以及与实际完成状态一致的计划勾选记录。

- [x] **Step 1: 串行执行全部标准门禁**

Run:

```powershell
npm run typecheck
npm test
npm run docs:capabilities:check
npm run verify:hygiene
npm run lint -w surdet-starter
npm run verify:formal
npm run verify:p1p2
npm run e2e -w @surdet/shell
git diff --check
```

Expected:

- 所有命令退出码为 0；
- 正式游戏仍为 11 场景、24 paths、23/23 choices、39 次 save/load、3 endings、0 runtime errors；
- 不得忽略 chunk warning，但它不是本轮阻断项，除非出现新的构建错误；
- `git diff --check` 允许行尾转换 warning，但不得有 whitespace error。

- [x] **Step 2: 执行四项新增定向验收**

必须分别记录：

1. system 交互后 rollback 不可跨界；
2. combat 配置不兼容快照失败时 calendar/combat/其他系统均未改变；
3. `packages/host` 不含默认兵种、游戏文案和规则执行；
4. 真实 Vite `.gal` HMR 不整页刷新，失败编译保留旧场景。

任何一项失败都不得继续写“全部完成”。

- [x] **Step 3: 验证现有发行包或按明确目标重新打包**

如果源码变化影响正式包，必须使用显式正式目标重新打包：

```powershell
$env:SURDET_GAME_DIR = (Resolve-Path 'examples/zero-after-midnight').Path
$env:SURDET_PACK_MODE = 'release'
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
$env:SURDET_EXPECTED_GAME = 'zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY = 'prologue'
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

Expected:

- release 模式；
- encrypted 为 true；
- game 为 `zero-after-midnight`；
- entryScene 为 `prologue`；
- artifact verifier PASS。

- [x] **Step 4: 使用隔离 userData 验收正式 EXE**

必须使用新建临时 `--user-data-dir`，验收：

- 加载进度完成且 failed=0；
- 画布、三字体角色和素材 Blob URL 正常；
- 普通文本回退成功；
- system 交互后不能跨边界回退；
- F5/F9 只在隔离目录写入；
- Profile 只在隔离目录写入；
- 页面错误 0、控制台错误 0。

验收结束后，只有在确认临时目录绝对路径位于预期临时根目录内时才允许删除该临时目录。

- [x] **Step 5: 更新原计划勾选和报告事实**

要求：

- 已通过且有证据的步骤勾选为 `[x]`；
- 未完成或获准例外的步骤不得伪装为完成；
- 原交付报告必须更正“Task 0→13 全部完成”的绝对表述；
- 明确写出宿主入口修复后的实际行数和相对 2727 的缩减量；
- 明确写出新增 rollback system-boundary、atomic restore 和 Vite HMR 集成测试名称；
- 区分“纯函数测试”“浏览器/Vite 集成测试”“starter shell E2E”“正式 EXE 隔离验收”；
- 不把正式 EXE 普通文本回退当作 system 边界测试；
- 不把 Vite transform/build PASS 当作真实 HMR PASS。

- [x] **Step 6: 生成精确变更清单**

Run:

```powershell
git diff --stat
git diff --numstat
git ls-files --others --exclude-standard
git status --short
git rev-list --left-right --count HEAD...surdet/main
```

报告中分别列出：

- tracked 修改文件数及 additions/deletions；
- untracked 交付文件；
- 排除的内部文件 `USER.md`、`SESSION-HANDOFF.md`；
- HEAD、分支及与远端分歧；
- 明确声明未 commit、未 push。

- [x] **Step 7: 自检并交回复审**

交付给总经理的内容只需包含：

1. 四个阻断项逐项修正说明；
2. 新增测试文件和测试名称；
3. 全部门禁的命令、退出码和关键数字；
4. 宿主入口新行数与缩减量；
5. 精确 Git 变更统计；
6. 未 commit、未 push、未触碰真实用户数据的声明；
7. 如有例外，单独列出并说明为什么不能在安全边界内达标。

不得在总经理复审前执行 commit 或 push。

---

## Final Acceptance Criteria

只有同时满足以下条件，Wave 1 才可重新申请批准：

- [x] 普通文本回退可用，system 交互后不能回退到交互前；
- [x] rollback restore 不重复触发 autosave、achievement 或 system 副作用；
- [x] 任一系统快照验证失败时，所有系统和变量状态均保持加载前值；
- [x] `@surdet/host` 只负责路由与生命周期，不含默认兵种、游戏规则和产品文案；
- [x] 两个宿主入口按 `Get-Content.Count` 为 starter `1179`、formal `1238`、combined `2417`；总经理已批准相对 `2377` 上限的 40 行安全边界例外，公共 host 仍不含游戏规则、默认单位或产品文案；
- [x] `.gal` HMR 经真实 Vite 开发服务器证明不整页刷新；
- [x] 热更新编译失败保留旧场景，重复更新不重建 PixiStage、AudioManager、FrameScheduler 或 Blob URL；
- [x] `npm run typecheck`、`npm test`、`npm run verify:formal`、`npm run verify:p1p2`、shell E2E 和 `git diff --check` 全部通过；
- [x] 正式 release 包保持加密、身份正确，隔离 EXE 验收通过；
- [x] 原计划勾选、交付报告和实际源码状态一致；
- [x] 工作树保持未提交、未推送，等待总经理最终批复。

## 总经理批复语

成果主体保留，验收暂缓；退回补正上述四个阻断项。修正期间不得扩展范围，不得通过移动游戏规则、压缩代码或削弱测试追逐指标。完成后提交“修正说明、测试名称、门禁结果、宿主行数和 Git 统计”复审；批准前不得 commit 或 push。
