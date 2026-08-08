# Engine Experience Optimization Wave 1 Final Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This project must be handled serially by one execution AI; do not dispatch subagents or parallel workers. Steps use checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** 修复第二轮独立复审确认的完整读档事务缺陷，补齐 rollback generation 竞态回归测试，并按总经理批准的安全边界例外纠正宿主行数及整改报告证据，使 Wave 1 达到最终验收条件。

**Architecture:** `Interpreter.loadSnapshot()` 在任何变量、追踪器、系统或演出状态写入前，先执行所有配置相关的无副作用预校验；`VariableStore.restore()` 先构造完整更新集再一次提交，避免变量内部部分恢复。rollback generation 的现有实现保持不动，只增加直接覆盖排队 microtask 失效的测试；公共 host 与真实 Vite HMR 已通过复审，禁止再次重构。宿主入口采用总经理批准的 `2417` 行安全边界例外，不再为 40 行指标移动规则或压缩代码。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、PixiJS、Howler、Vite 6、Electron 43、GitHub Actions、PowerShell。

## Global Constraints

- 仓库：`E:\surdet`；基线 HEAD：`3ecd43a0ad5829b0253141e9a5bd42db061ff1e4`；分支：`main`；远端：`surdet/main`。
- 当前工作树包含既有 Wave 1 与整改修改；必须原地串行补正，不创建分支、不切换工作树。
- 只允许一个执行 AI；不得派生 subagent，不得并行运行会同时写 build/dist 的命令。
- 总经理终验前不得执行 `git commit`、`git push`、`git reset`、`git clean`、`git checkout --`、批量格式化或清理工作树。
- 保留 `USER.md`、`SESSION-HANDOFF.md` 以及全部既有用户修改；不得读取、修改或删除用户真实存档目录。
- 不修改已通过的 `@surdet/host` 规则边界、项目侧 system adapters 或 Vite HMR 架构，除非本计划的测试暴露与本轮缺陷直接相关的回归。
- 不新增 Wave 2 功能；不重做 Profile、加载层、转场、环境音、快捷键、Backlog 搜索、统计或打包策略。
- 不通过压缩格式、合并多语句到一行、删除有价值注释、移动游戏规则或修改行数统计口径追逐 `combined <= 2377`。
- 总经理已批准宿主入口安全边界例外：按 `Get-Content(...).Count` 统计，starter `1179`、formal `1238`、combined `2417`、相对基线 `2727` 减少 `310` 行；该例外仅豁免 40 行差额，不豁免架构边界或报告真实性。
- 所有新增行为测试必须先在当前实现上得到与缺陷一致的 FAIL，再实施最小修复；不得删除断言、放宽标准或仅用 mock 绕开完整链路。
- 每完成一步立即更新本文件复选框；未满足的 Final Acceptance Criteria 不得提前勾选。

---

## 第二轮复审结论

### 已通过，禁止重复施工

- `packages/host/src/system-router.ts` 已只保留通用 system bus 路由；公共 host 中不存在 Calendar/Combat/Shop 规则、默认 `sword/goblin` 或产品文案。
- 具体 system adapters 已位于 starter/formal 项目侧；现阶段不要求去重两个相同 adapter 文件。
- `createDefaultHost()` 已覆盖 `enter/complete/fail/reset/dispose` system boundary。
- `createRollbackRuntime()` 已用 `captureGeneration` 阻止旧 microtask 在 clear 后写回；实现方向正确。
- 真实 Vite `.gal` HMR 集成测试已独立通过，确实启动 Vite + Chromium、修改临时 `.gal`、验证无整页刷新和无效剧本保留旧场景。
- 上一轮基线的 typecheck、761 tests、formal verify、P1/P2、shell E2E、artifact verifier 和 diff check 均已独立通过；本计划 Task 5 将在此基础上重跑并记录最终数字。

### 本计划只处理三个剩余问题

1. `Interpreter.loadSnapshot()` 当前先恢复 variables/readSet/gallery/growth，最后才触发 system validator；system 验证失败会留下变量污染。独立复现：加载前 `trust=5`，失败后变为 `trust=999`。
2. rollback generation 没有自动化测试直接覆盖 `captureText(); clear(); await microtask` 竞态；HMR 测试不能作为 rollback 证据。
3. 整改报告用非空行口径写成 `1148/1207/2355/-372`，与任务书规定的 `Get-Content.Count` 不一致；必须改成真实数字和已批准例外。

---

### Task 0: Freeze the Final-Remediation Baseline

**Files:**
- Read: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-REMEDIATION-REPORT-2026-08-08.md`
- Read: `docs/superpowers/plans/2026-08-08-engine-experience-wave-1-review-remediation.md`
- Read: `docs/superpowers/plans/2026-08-08-engine-experience-wave-1-final-remediation.md`
- Preserve: `USER.md`
- Preserve: `SESSION-HANDOFF.md`

**Interfaces:**
- Consumes: 当前未提交工作树。
- Produces: 最终补正前的可复验 Git、行数和缺陷基线，不产生源码改动。

- [x] **Step 1: 记录 Git 基线**

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
- branch 为 `main`；
- 与 `surdet/main` 分歧为 `0 0`；
- 工作树未提交、未推送；
- `USER.md` 与 `SESSION-HANDOFF.md` 仍存在。

- [x] **Step 2: 用批准口径记录入口行数**

Run:

```powershell
$starterLines = (Get-Content examples/starter/src/main.ts).Count
$formalLines = (Get-Content examples/zero-after-midnight/src/main.ts).Count
$combinedLines = $starterLines + $formalLines
"starter=$starterLines formal=$formalLines combined=$combinedLines reduction=$((1328 + 1399) - $combinedLines)"
```

Expected:

```text
starter=1179 formal=1238 combined=2417 reduction=310
```

若因本计划的必要代码改动导致入口行数变化，报告最终磁盘数字；不得再切换为非空行、有效代码行或其他统计口径。

- [x] **Step 3: 保存完整读档污染的失败证据**

使用当前落盘构建运行一个只读复现，或先写 Task 1 的完整链路测试。缺陷证据必须包含：

```text
before trust=5
incoming trust=999
loadSnapshot throws system validation error
after trust=999
```

Expected: 当前实现 FAIL，证明 system validation 发生在 VariableStore 恢复之后。

---

### Task 1: Prevalidate the Entire Load Before Any Runtime Mutation

**Files:**
- Modify: `packages/core/src/runtime/interpreter.ts`
- Modify: `packages/host/src/save-hooks.ts`
- Modify only if type export requires it: `packages/host/src/index.ts`
- Test: `packages/host/test/system-router.test.ts`
- Test: `packages/core/test/interpreter-save.test.ts`

**Interfaces:**
- Consumes: `SystemHooks`、`SystemSnapshots`、`HostStateAdapter.validate(value)`、`createSystemHooks()`。
- Produces: `SystemHooks.validate?(snap: SystemSnapshots): void`；`Interpreter.loadSnapshot()` 在任何 runtime mutation 前调用它。

- [x] **Step 1: 写完整 Interpreter 链路失败测试**

在 `packages/host/test/system-router.test.ts` 新增测试，必须使用真实：

- `VariableStore`；
- `EventBus`；
- `SceneRegistry`；
- `Interpreter`；
- `CalendarRunner`；
- `CombatSolver`；
- `createSystemHooks()`。

测试结构：

```ts
it('leaves variables and every runtime state unchanged when system prevalidation fails', () => {
  const store = new VariableStore([
    { name: 'trust', type: 'number', initial: 0 },
  ]);

  // 创建 registry/interpreter，并注入 calendar + combat 的 createSystemHooks。
  // 启动一个可存档场景，把 trust 设为 5，保存 before 快照和所有状态。

  const incoming = {
    ...validSnapshot,
    variables: { ...validSnapshot.variables, trust: 999 },
    systems: {
      ...validSnapshot.systems,
      calendar: { turn: 2, ap: 1, visited: [] },
      combat: {
        ...validSnapshot.systems!.combat!,
        units: validSnapshot.systems!.combat!.units.map((unit) => ({
          ...unit,
          team: 'ghost',
        })),
      },
    },
  };

  expect(() => interpreter.loadSnapshot(incoming)).toThrow(/非法阵营|team/);
  expect(store.snapshot()).toEqual(before.variables);
  expect(calendar.snapshot()).toEqual(before.calendar);
  expect(combat.snapshot()).toEqual(before.combat);
  expect(interpreter.readTracker.snapshot()).toEqual(before.readSet);
  expect(interpreter.gallery.snapshot()).toEqual(before.gallery);
  expect(interpreter.status).toBe(before.status);
  expect(interpreter.saveSnapshot()?.position).toEqual(before.position);
});
```

如果测试使用 growth、clearTracker 或 presentation hooks，还应断言它们保持原值；不得只断言 `trust`。

- [x] **Step 2: 运行新测试并确认红灯命中真实缺陷**

Run:

```powershell
npm test -w @surdet/host -- system-router.test.ts
```

Expected: 新测试 FAIL，且至少显示 `trust` 已从 5 变成 999，或其他 runtime state 在 system validator 抛错前被修改。若失败原因是导入、fixture 或类型错误，先修正测试，直到它准确复现事务顺序问题。

- [x] **Step 3: 扩展 SystemHooks 预校验契约**

在 `packages/core/src/runtime/interpreter.ts` 将接口扩展为：

```ts
export interface SystemHooks {
  /** 存档时收集系统状态（必须 JSON 安全） */
  snapshot?: () => SystemSnapshots;
  /** 无副作用地验证所有参与系统；任何 runtime 状态写入前调用 */
  validate?: (snap: SystemSnapshots) => void;
  /** 校验通过后提交系统状态 */
  restore?: (snap: SystemSnapshots) => void;
}
```

保持新增字段可选，确保没有 system hooks 或只有旧式 hooks 的调用方仍可类型兼容。

- [x] **Step 4: 让 createSystemHooks 暴露独立 validate**

在 `packages/host/src/save-hooks.ts` 抽取同一验证函数，避免 validate/restore 规则漂移：

```ts
const validate = (source: SystemSnapshots): void => {
  const participating = adapters.filter((adapter) => source[adapter.id] !== undefined);
  let validationError: unknown = null;
  for (const adapter of participating) {
    try {
      adapter.validate(source[adapter.id]);
    } catch (error) {
      validationError ??= error;
    }
  }
  if (validationError !== null) throw validationError;
};

return {
  snapshot: /* 保持现有实现 */,
  validate,
  restore: (source) => {
    validate(source); // 保留直接调用 restore 时的防御性保证
    for (const adapter of participatingAdapters(source)) {
      adapter.restore(source[adapter.id]);
    }
  },
};
```

可以用聚焦 helper 消除重复过滤，但不得改变未知/缺省 system 字段的既有兼容行为。

- [x] **Step 5: 在 loadSnapshot 的任何写入前调用 system validate**

在 schema 版本检查和迁移完成后、`this.#store.restore(...)` 之前加入：

```ts
if (snap.systems) {
  this.#systemHooks.validate?.(snap.systems);
}
```

正确顺序必须是：

1. `assertValidSnapshot()`；
2. schema 版本检查；
3. schema migration；
4. system hooks 无副作用 `validate()`；
5. VariableStore/readTracker/gallery/clearTracker/growth 提交；
6. system hooks `restore()`；
7. position/status/presentation 恢复和 `stateReset`。

system validator 抛错时，第 5 步及之后不得执行。

- [x] **Step 6: 运行定向测试确认绿灯**

Run:

```powershell
npm test -w @surdet/host -- system-router.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts audit-fixes.test.ts
npm run typecheck
```

Expected: 全部 PASS；完整链路测试证明配置相关 system 校验失败后 variables、systems、tracker 和 interpreter position/status 均保持加载前值。

---

### Task 2: Make VariableStore Restore Internally Atomic

**Files:**
- Modify: `packages/core/src/state/variable-store.ts`
- Test: `packages/core/test/variable-store.test.ts`

**Interfaces:**
- Consumes: `VarDeclaration`、`VarValue`、现有 `assertType()`、`coerce()`、`cloneValue()`。
- Produces: `VariableStore.restore(data, opts)` 保持原签名，但任何变量失败时零变量提交。

- [x] **Step 1: 写变量内部部分恢复失败测试**

在 `packages/core/test/variable-store.test.ts` 增加：

```ts
it('restore validates every declared value before committing any update', () => {
  const store = new VariableStore([
    { name: 'trust', type: 'number', initial: 1 },
    { name: 'flag', type: 'boolean', initial: false },
  ]);

  expect(() => store.restore({
    trust: 999,
    flag: 'not-a-boolean' as never,
  })).toThrow(/flag|boolean|类型/);

  expect(store.getNumber('trust')).toBe(1);
  expect(store.getBoolean('flag')).toBe(false);
});
```

- [x] **Step 2: 运行测试确认当前逐项写入会失败**

Run:

```powershell
npm test -w @surdet/core -- variable-store.test.ts
```

Expected: 新测试 FAIL，当前实现通常会留下 `trust=999`。

- [x] **Step 3: 改为 prepare-then-commit**

保持不存在变量忽略、readonly 默认跳过、`allowReadonly: true` 允许恢复、范围 clamp 和防御性克隆的既有语义。先构造临时更新数组：

```ts
restore(data: Record<string, VarValue>, opts?: { allowReadonly?: boolean }): void {
  const updates: Array<{ key: string; value: VarValue }> = [];
  for (const [key, value] of Object.entries(data)) {
    const decl = this.#decls.get(key);
    if (!decl) continue;
    if (decl.readonly && opts?.allowReadonly !== true) continue;
    assertType(value, decl, 'snapshot');
    updates.push({ key, value: cloneValue(coerce(decl, value)) });
  }
  for (const { key, value } of updates) {
    this.#values.set(key, value);
  }
}
```

如果 `coerce()` 已保证返回全新 JSON 安全值，仍应遵循现有代码的克隆约定，不能引入引用泄漏。

- [x] **Step 4: 验证 VariableStore 全套行为**

Run:

```powershell
npm test -w @surdet/core -- variable-store.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts save.test.ts
npm run typecheck
```

Expected: 全部 PASS；新增原子测试通过，旧 readonly/clamp/递归值克隆测试无回归。

---

### Task 3: Add a Direct Rollback Generation Race Test

**Files:**
- Create: `examples/starter/test/rollback-runtime.test.ts`
- Read only unless test exposes a defect: `examples/shared/rollback-runtime.ts`
- Modify only if a real failure requires it: `examples/shared/rollback-runtime.ts`

**Interfaces:**
- Consumes: `createRollbackRuntime()`、`RollbackRuntime.captureText()`、`clear()`、`canRollback()`。
- Produces: 自动化证明 boundary clear 会作废已排队的旧 generation 检查点，并允许新 generation 正常捕获。

- [x] **Step 1: 建立最小真实 runtime fixture**

测试应创建可控制的 fake interpreter/renderer/stage/audio；fake 只实现 `createRollbackRuntime()` 实际调用的字段，不重新实现 rollback 逻辑：

```ts
const snapshot = {
  meta: { id: 'test', createdAt: 1, updatedAt: 1 },
  variables: {},
  position: { sceneId: 's1', pc: 1, sceneHash: 'hash-1' },
  kind: 'manual',
  status: 'awaiting-advance',
  readSet: [],
  gallery: { cgs: [], music: [] },
} as SaveSnapshot;

const interpreter = {
  status: 'awaiting-advance',
  saveSnapshot: vi.fn(() => structuredClone(snapshot)),
  loadSnapshot: vi.fn(),
} as unknown as Interpreter;
```

renderer 必须提供 `status`、`backlogOpen`、`snapshotPresentation()`、`resetSession()`；stage/audio 提供对应可选快照恢复方法。

- [x] **Step 2: 测试旧 microtask 在 clear 后失效**

```ts
it('invalidates a queued text checkpoint when a system boundary clears rollback', async () => {
  const runtime = createTestRuntime();
  runtime.captureText();
  runtime.clear();

  await Promise.resolve();

  expect(runtime.canRollback()).toBe(false);
});
```

该测试直接覆盖 `captureGeneration`；不得使用 Vite HMR 测试或只对裸 `RollbackBuffer.clear()` 断言。

- [x] **Step 3: 测试新 generation 仍可捕获**

```ts
it('captures new checkpoints after the boundary generation advances', async () => {
  const fixture = createTestRuntime();
  fixture.runtime.captureText();
  fixture.runtime.clear();
  await Promise.resolve();

  fixture.setPosition(2);
  fixture.runtime.captureText();
  await Promise.resolve();

  expect(fixture.runtime.canRollback()).toBe(true);
});
```

如果 `perform()` 的“跳过当前栈顶”语义要求两个检查点才能真正回退，`canRollback()` 只要求缓冲非空；测试应分别陈述捕获可用性与实际 perform 行为，不能混淆。

- [x] **Step 4: 运行 rollback 定向测试**

Run:

```powershell
npm test -w surdet-starter -- rollback-runtime.test.ts
npm test -w @surdet/host -- create-host.test.ts
npm test -w @surdet/renderer -- rollback-buffer.test.ts
```

Expected: 全部 PASS；新增测试直接覆盖 generation 竞态，host boundary phases 与裸缓冲行为继续通过。

---

### Task 4: Correct the Plan, Report, Metrics and Evidence Attribution

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-engine-experience-wave-1-review-remediation.md`
- Modify: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-REMEDIATION-REPORT-2026-08-08.md`
- Modify: `docs/superpowers/plans/2026-08-08-engine-experience-wave-1-final-remediation.md`
- Modify only if its wording remains false: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-DELIVERY-REPORT-2026-08-08.md`

**Interfaces:**
- Consumes: Tasks 1–3 的最终代码、测试名称和磁盘统计。
- Produces: 与最终落盘状态一致的复选框、修正报告和安全边界例外记录。

- [x] **Step 1: 纠正宿主入口行数**

报告必须使用以下命令的最终输出：

```powershell
$starterLines = (Get-Content examples/starter/src/main.ts).Count
$formalLines = (Get-Content examples/zero-after-midnight/src/main.ts).Count
$combinedLines = $starterLines + $formalLines
"starter=$starterLines formal=$formalLines combined=$combinedLines reduction=$((1328 + 1399) - $combinedLines)"
```

若入口未因必要修复变化，报告应写：

```text
starter 1179、formal 1238、combined 2417；相对基线 2727 减少 310 行。
原报告 1148/1207/2355 使用了排除空行的口径，不能与任务书的 Get-Content.Count 基线比较，现已纠正。
总经理批准 40 行安全边界例外；不再通过压缩或移动游戏规则追逐 combined <= 2377。
```

- [x] **Step 2: 正确记录例外状态**

在前一份整改计划的 Final Acceptance Criteria 中，将宿主行数项改成已获批准的事实表述，例如：

将原复选项勾选为完成，并把正文改为：两个宿主入口按 `Get-Content.Count` 为 combined 2417；总经理已批准相对 2377 上限的 40 行安全边界例外，公共 host 继续保持无游戏规则。

不得继续声称原始数值指标已直接达到。

- [x] **Step 3: 纠正原子恢复表述**

只有 Task 1 和 Task 2 新测试通过后，报告才可写：

```text
SystemHooks 在 Interpreter 任何 runtime mutation 前完成配置相关预校验；VariableStore 自身也先全量校验、后统一提交。system 或变量验证失败时，variables、readSet、gallery、growth、systems、position 和 status 均保持加载前值。
```

报告必须列出完整 Interpreter 链路测试和 VariableStore 原子测试的准确文件名、测试名。

- [x] **Step 4: 删除错误的 rollback 证据归因**

删除或改写把 `examples/starter/test/vite-scene-hmr.test.ts` 列为 rollback boundary 证据的文字。正确证据应分别是：

- `packages/host/test/create-host.test.ts`：system boundary phases；
- `examples/starter/test/rollback-runtime.test.ts`：generation/microtask 竞态；
- shell 或隔离 EXE probe：端到端补充证据；
- `examples/starter/test/vite-scene-hmr.test.ts`：只用于 Vite HMR，不用于 rollback。

- [x] **Step 5: 更新复选框**

只有磁盘事实和新鲜验证满足时才勾选：

- system prevalidation before variables；
- VariableStore restore atomicity；
- rollback generation direct regression；
- 40 行安全边界例外；
- 报告与源码一致；
- 未 commit、未 push。

---

### Task 5: Final Regression and Handoff

**Files:**
- Modify only if验证结果需要事实纠正: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-REMEDIATION-REPORT-2026-08-08.md`
- Do not modify runtime after final verification starts unless a gate fails; any fix requires restarting the full gate sequence.

**Interfaces:**
- Consumes: Tasks 1–4 的最终落盘文件。
- Produces: 可供总经理最后一次独立终验的未提交工作树与事实报告。

- [x] **Step 1: 运行三个新增定向门禁**

Run:

```powershell
npm test -w @surdet/host -- system-router.test.ts
npm test -w @surdet/core -- variable-store.test.ts interpreter-save.test.ts audit-fixes.test.ts
npm test -w surdet-starter -- rollback-runtime.test.ts vite-scene-hmr.test.ts
```

Expected:

- system 校验失败完整链路零状态污染；
- VariableStore 后续变量失败时前序变量不提交；
- rollback queued microtask 被 boundary clear 作废；
- 新 generation 可继续捕获；
- 真实 Vite HMR 继续通过。

- [x] **Step 2: 串行运行全部标准门禁**

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
- 测试总数高于当前 761，增量至少包含完整 Interpreter 原子测试、VariableStore 原子测试和 rollback generation 测试；
- formal 仍为 11 场景、24 paths、23/23 choices、39 save/load、3 endings、0 runtime errors、44 assets；
- `git diff --check` 允许 CRLF 转换 warning，但不得有 whitespace error。

- [x] **Step 3: 验证发行产物身份**

如果 Task 1–3 的改动影响正式运行时代码，重新执行显式正式打包：

```powershell
$env:SURDET_GAME_DIR = (Resolve-Path 'examples/zero-after-midnight').Path
$env:SURDET_PACK_MODE = 'release'
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
$env:SURDET_EXPECTED_GAME = 'zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY = 'prologue'
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

Expected: `release`、`encrypted=true`、game=`zero-after-midnight`、entryScene=`prologue`，artifact verifier PASS。

- [x] **Step 4: 以隔离 userData 复验失败读档与常规路径**

使用新建临时 `--user-data-dir` 启动 unpacked EXE，至少验证：

- 启动加载、画布、字体和 Blob URL 正常；
- 普通文本回退正常；
- system boundary 后不能跨界回退；
- F5/F9 正常；
- Profile/settings/save 只写隔离目录；
- 页面错误 0、控制台错误 0。

配置不兼容快照的零污染主要由完整 Interpreter 自动化测试证明；若 EXE probe 能安全注入临时内存快照，可补充验证，但不得接触真实用户数据或正式存档。

- [x] **Step 5: 生成最终精确统计**

Run:

```powershell
git diff --stat
git diff --numstat
git ls-files --others --exclude-standard
git status --short
git rev-parse HEAD
git branch --show-current
git rev-list --left-right --count HEAD...surdet/main
```

报告分别记录：

- tracked modified 文件数、additions、deletions；
- untracked 文件数及排除 `USER.md`、`SESSION-HANDOFF.md` 后的交付数；
- starter/formal 原始物理行数；
- HEAD、branch、远端分歧；
- 未 commit、未 push 声明。

- [x] **Step 6: 交回总经理终验**

交付内容只需：

1. 完整读档预校验前移的实现说明；
2. VariableStore prepare-then-commit 说明；
3. 三条新增回归测试的文件名和精确测试名；
4. 全部门禁退出码与测试总数；
5. `1179/1238/2417/-310` 或最终磁盘行数，以及“40 行例外已获批准”；
6. 纠正 HMR/rollback 证据归因的说明；
7. Git 精确统计；
8. 未 commit、未 push、未触碰真实用户数据声明。

总经理终验前继续保持工作树未提交、未推送。

---

## Final Acceptance Criteria

- [x] `SystemHooks.validate()` 在 `Interpreter.loadSnapshot()` 的任何 runtime mutation 前执行；
- [x] 配置相关 system 校验失败时 variables、readSet、gallery、growth、systems、position 和 status 均保持加载前值；
- [x] `VariableStore.restore()` 先全量校验/coerce，后统一提交，任一变量失败时零变量改变；
- [x] rollback generation 有直接自动化测试覆盖 `captureText -> clear -> microtask`；
- [x] 新 generation 在 boundary 后仍可捕获正常文本检查点；
- [x] Vite HMR 测试只作为 HMR 证据，不再被错误引用为 rollback 证据；
- [x] 宿主入口按 `Get-Content.Count` 报告真实物理行数；
- [x] 报告明确记录总经理批准的 40 行安全边界例外，不声称直接达到 `combined <= 2377`；
- [x] 公共 `@surdet/host` 继续不含游戏规则、默认单位或产品文案；
- [x] typecheck、全量 tests、formal verify、P1/P2、shell E2E、artifact verifier 和 diff check 全部通过；
- [x] 正式包保持 release、encrypted、`zero-after-midnight/prologue` 身份；
- [x] 计划复选框、整改报告、测试数字和磁盘事实完全一致；
- [x] HEAD 仍为 `3ecd43a`，与 `surdet/main` 分歧 `0/0`，未 commit、未 push；
- [x] `USER.md`、`SESSION-HANDOFF.md` 和用户真实数据边界保持不变。

## 总经理批复语

第二轮整改主体通过，剩余范围锁定为完整读档事务、VariableStore 原子提交、rollback generation 直接测试和报告事实纠正。批准宿主入口相对原门槛 40 行的安全边界例外，禁止继续为行数指标移动规则或压缩代码。完成本计划并重跑全部门禁后，保持未提交、未推送状态交回最终验收。
