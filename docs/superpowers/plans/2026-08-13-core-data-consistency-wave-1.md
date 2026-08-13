# Core Data Consistency Wave 1 — Atomic Growth and Validated Save Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Preserve the shared worktree and all pre-existing untracked files.

**Goal:** 修复两个已经由源码确认的 Core 数据一致性缺陷：多级成长失败时不得留下部分属性写入；通用 SaveManager.save() 不得将结构非法快照交给任意存储后端。

**Architecture:** 两个改动采用统一的 prepare → validate → one commit 模式。GrowthSystem.gainExp() 先在局部变量中算出升级结果，再通过现有 VariableStore.setMany() 原子提交全部属性变化，最后才写入等级与经验；SaveManager.save() 先构建最终带槽位元信息的候选快照并按 current schema 完整校验，只有通过后才调用存储后端。没有新状态机、迁移层、兼容分支或运行时 fallback。

**Tech Stack:** TypeScript 5.7、Vitest 3、Node.js 20+、现有 @surdet/core、现有 VariableStore/assertValidSnapshot/SaveStorage 公共接口；不新增依赖。

## Global Constraints

- 开工第一步重新读取 E:\surdet\AGENTS.md、E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md 和本任务书，记录真实 git rev-parse HEAD、git status --short、git rev-list --left-right --count HEAD...surdet/main。
- 本轮属于长期台账的阶段 1：Core 数据一致性。只处理明确的原子提交和写前校验；不启动 Shell 失败数据可靠性、.bak 恢复、音频、美术、编辑器、性能、M9、发行或文档大整理。
- 当前工作树中已有 BGM Wave 1 本地提交和未跟踪路线台账；它们均不属于本轮。不得 reset、rebase、amend、删除、移动、暂存或夹带提交。
- 不得修改、暂存、提交、删除或移动：AGENTS.md、SESSION-HANDOFF.md、USER.md、docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md、docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md、docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md。
- 不得修改 packages/core/src/runtime/interpreter.ts、packages/core/src/save/migrate.ts、packages/core/src/state/variable-store.ts、SaveStorage 接口、存档 schema、任何 examples、Shell、Host、Renderer、Editor、剧情、素材或配置。必须复用现有 VariableStore.get()、VariableStore.setMany() 和 assertValidSnapshot()。
- 不新增 npm 依赖、migration、compatibility fallback、补偿存储、备用存档、全局锁、异步队列、配置层或第二套状态容器。
- GrowthSystem.gainExp() 的成功语义必须保持：经验曲线、封顶、属性 clamp、GrowthResult 和 @exp 事件均不变；本轮只保证失败不产生部分变更。
- SaveManager.save() 必须继续由自身生成最终 meta.id、createdAt、updatedAt 和 schemaVersion；校验对象必须是最终盖章候选快照，不是调用方的原始对象。
- 本轮为 C 级公共 Core 改动：必须取得两个缺陷的真实红灯，运行 Core 聚焦测试、Core 全量测试、Core typecheck/build 与一条正式 Zero save/load 模拟路径；不需要 Electron 矩阵、性能资格化、发行打包或 npm run verify:all。
- 已知 npm run verify:all 会被与本轮无关的 Editor CRLF/LF 逐字节往返断言阻断。除非总经理另行授权修 Editor，本轮不得修改 Editor 或 Starter 剧本来刷绿，也不得把未运行的 verify:all 写成通过。
- 每个修改 Core 源码或测试的 Task 完成后创建普通本地提交；Task 0/Task 3 是只读验证，不创建空提交；Task 4 只提交本报告和本任务书。最后停在 WAITING_FOR_REVIEW。未经总经理授权，不得 push、force push、部署、打包、发行、rebase、reset、amend、squash、cherry-pick 或 git clean。

---

## Locked File Map

- Modify: packages/core/src/systems/growth.ts — 将多级升级的属性写回改为先准备、后经现有 setMany() 原子提交。
- Modify: packages/core/test/growth.test.ts — 添加配置错误时 Growth/VariableStore 均不变的红绿回归。
- Modify: packages/core/src/save/save-manager.ts — 在调用存储后端前，对已盖章候选快照执行 current schema 完整校验。
- Modify: packages/core/test/save.test.ts — 添加非法写入不调用后端、不覆盖旧档的红绿回归。
- Create: docs/ENGINE-CORE-DATA-CONSISTENCY-WAVE-1-DELIVERY-REPORT-2026-08-13.md — 最终交付报告。
- Modify: docs/superpowers/plans/2026-08-13-core-data-consistency-wave-1.md — 逐 Task 记录真实命令、红灯、绿灯、提交与停止状态。

## Required Invariants

| Boundary | Success | Failure |
| --- | --- | --- |
| GrowthSystem.gainExp() | 合法经验可连升，所有属性按等级数叠加，仍由 VariableStore 施加 clamp。 | 任意 statGrowth 目标未声明、非 number、readonly，或增量/最终值非有限时，变量、等级、经验全部保持调用前值。 |
| VariableStore.setMany() | 继续作为唯一的属性批提交机制。 | 不修改 VariableStore，也不在 Growth 中手写第二套回滚。 |
| SaveManager.save() | 对最终 current-schema 候选快照做完整校验，再向后端写入深拷贝。 | 候选快照非法时，SaveStorage.write() 不被调用，旧槽位不被覆盖。 |
| SaveManager.load()/Interpreter.loadSnapshot() | 既有读取、迁移、二阶段校验、Presentation/System validate 语义不变。 | 不扩张为读档 fallback、自动恢复或 schema 升级。 |

### Task 0: Establish truthful baseline and scope lock

**Files:**
- Read: E:\surdet\AGENTS.md
- Read: docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md
- Read: packages/core/src/systems/growth.ts
- Read: packages/core/src/state/variable-store.ts
- Read: packages/core/src/save/save-manager.ts
- Read: packages/core/test/growth.test.ts
- Read: packages/core/test/save.test.ts
- Modify: this plan only

**Consumes:** Existing source. At plan creation, gainExp() calls store.modify() inside its per-level loop before committing its own levels/experience; SaveManager.save() stamps and clones but does not call assertValidSnapshot().

**Produces:** Factual baseline, no production or test change.

- [ ] **Step 1: Read rules and record actual Git state.**

Run:

~~~powershell
Get-Content -LiteralPath 'E:\surdet\AGENTS.md' -Raw
Get-Content -LiteralPath 'E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md' -Raw
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git ls-files '*.log'
~~~

Expected: Record the exact outputs in the plan. Never try to clean the worktree. If unrelated tracked changes exist, stop and report exact paths.

- [ ] **Step 2: Confirm reuse of the existing atomic batch API.**

Run:

~~~powershell
rg -n "gainExp|statGrowth|setMany|#levels|#experience" packages/core/src/systems/growth.ts packages/core/src/state/variable-store.ts
rg -n "async save|assertValidSnapshot|deepClone|interface SaveStorage" packages/core/src/save/save-manager.ts
rg -n "gainExp|SaveManager|MemoryStorage|assertValidSnapshot" packages/core/test/growth.test.ts packages/core/test/save.test.ts
~~~

Expected: Confirm setMany() already validates a whole batch before commit. Do not create a new VariableStore API.

- [ ] **Step 3: Run unchanged focused baseline.**

Run:

~~~powershell
npm run test -w @surdet/core -- test/growth.test.ts test/save.test.ts
~~~

Expected: PASS before new regressions are added. Record actual file/test totals; passing baseline means coverage is incomplete, not that the confirmed gaps do not exist.

- [ ] **Step 4: Record precise pre-fix facts.**

Add this under an Execution Ledger heading in this plan:

~~~text
GROWTH_PARTIAL_WRITE_CONFIRMED: gainExp() writes individual statGrowth entries through modify() inside the level loop; a later invalid target can throw after an earlier target changed.
SAVE_WRITE_VALIDATION_GAP_CONFIRMED: SaveManager.save() reaches SaveStorage.write() without assertValidSnapshot() on the final stamped candidate.
~~~

- [ ] **Step 5: Do not commit Task 0.**

Task 0 is read-only. Proceed directly to Task 1; no code commit is permitted before the first red test exists.

### Task 1: Make multi-level Growth commits atomic

**Files:**
- Modify: packages/core/test/growth.test.ts
- Modify: packages/core/src/systems/growth.ts

**Consumes:** VariableStore.has(name), VariableStore.get(name), VariableStore.setMany(updates). The existing setMany() already validates declarations, readonly access, value type, finite number and clamp before it writes.

**Produces:** gainExp() either commits all stat changes, level and experience together, or leaves all three unchanged on bad growth configuration.

- [ ] **Step 1: Add failing regression tests.**

Add this block after the existing GrowthSystem describe block in packages/core/test/growth.test.ts:

~~~ts
describe('GrowthSystem gainExp 原子提交', () => {
  function expectNoStateMutation(
    store: VariableStore,
    growth: GrowthSystem,
    action: () => void,
  ): void {
    const beforeVariables = store.snapshot();
    const beforeGrowth = growth.snapshot();
    expect(action).toThrow();
    expect(store.snapshot()).toEqual(beforeVariables);
    expect(growth.snapshot()).toEqual(beforeGrowth);
  }

  it('未声明的后续 statGrowth 目标不会留下前一个属性的部分写入', () => {
    const store = new VariableStore(decls);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.missing': 3 },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('非 number 的后续 statGrowth 目标不会留下前一个属性的部分写入', () => {
    const store = new VariableStore([
      ...decls,
      { name: 'lynn.flag', type: 'boolean', initial: false },
    ]);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.flag': 1 },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('readonly 的后续 statGrowth 目标不会留下前一个属性的部分写入', () => {
    const store = new VariableStore([
      ...decls,
      { name: 'lynn.locked', type: 'number', initial: 4, readonly: true },
    ]);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.locked': 1 },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('非有限的后续 statGrowth 增量不会留下前一个属性的部分写入', () => {
    const store = new VariableStore(decls);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: {
            'lynn.atk': 2,
            'lynn.hp': Number.POSITIVE_INFINITY as unknown as number,
          },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('合法连升仍按原有 clamp 规则一次性提交全部属性、等级和经验', () => {
    const store = new VariableStore([
      { name: 'lynn.atk', type: 'number', initial: 5, max: 7 },
      { name: 'lynn.hp', type: 'number', initial: 20 },
    ]);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.hp': 10 },
        }],
      },
      store,
    );

    expect(growth.gainExp('lynn', 30)).toMatchObject({
      levelBefore: 1,
      levelAfter: 3,
      levelsGained: 2,
      passedLevels: [2, 3],
    });
    expect(store.snapshot()).toEqual({ 'lynn.atk': 7, 'lynn.hp': 40 });
    expect(growth.snapshot()).toEqual({ levels: { lynn: 3 }, experience: { lynn: 5 } });
  });
});
~~~

- [ ] **Step 2: Obtain the true Growth red state.**

Run:

~~~powershell
npm run test -w @surdet/core -- test/growth.test.ts
~~~

Expected before production change: the first four new tests fail at the VariableStore snapshot assertion because current code updates lynn.atk before finding the later bad configuration. The valid clamped test passes. Record actual output.

- [ ] **Step 3: Replace in-loop mutation with a prepared batch.**

In packages/core/src/systems/growth.ts, keep the current curve/max-level while loop but remove the inner for-loop that calls this.#store.modify(). After the loop, use this complete commit section:

~~~ts
    const updates = this.#prepareStatGrowthUpdates(profile, passed.length);
    this.#store.setMany(updates);
    this.#levels.set(characterId, level);
    this.#experience.set(characterId, xp);
    return {
      characterId,
      gained: amount,
      levelBefore: this.levelOf(characterId) - passed.length,
      levelAfter: level,
      levelsGained: passed.length,
      passedLevels: passed,
    };
~~~

Add this private method immediately before #profile():

~~~ts
  #prepareStatGrowthUpdates(
    profile: GrowthProfile,
    levelsGained: number,
  ): Array<{ name: string; value: number }> {
    if (levelsGained === 0) return [];

    const updates: Array<{ name: string; value: number }> = [];
    for (const [varName, delta] of Object.entries(profile.statGrowth ?? {})) {
      if (!Number.isFinite(delta)) {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 增量必须是有限 number",
        );
      }
      if (!this.#store.has(varName)) {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 未声明或非 number（growth.json 配置缺陷）",
        );
      }
      const current = this.#store.get(varName);
      if (typeof current !== 'number') {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 未声明或非 number（growth.json 配置缺陷）",
        );
      }
      const next = current + delta * levelsGained;
      if (!Number.isFinite(next)) {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 最终值必须是有限 number",
        );
      }
      updates.push({ name: varName, value: next });
    }
    return updates;
  }
~~~

The preparation method must not write a VariableStore value, #levels or #experience. setMany() must run before internal map writes; do not catch or hide its errors.

- [ ] **Step 4: Verify and commit Task 1.**

Run:

~~~powershell
npm run test -w @surdet/core -- test/growth.test.ts
npm run typecheck -w @surdet/core
git diff --check
git add packages/core/src/systems/growth.ts packages/core/test/growth.test.ts
git commit -m "fix(core): make growth grants atomic"
git show --stat --oneline HEAD
~~~

Expected: all Growth tests pass. Record real SHA. Before staging, ensure only the two Task 1 source/test files are added; do not stage audio assets, the route ledger, generated dist or protected files.

### Task 2: Validate final save candidates before storage write

**Files:**
- Modify: packages/core/test/save.test.ts
- Modify: packages/core/src/save/save-manager.ts

**Consumes:** SaveManager.save(slot, snapshot), SaveStorage.write(slot, data), MemoryStorage, deepClone(), assertValidSnapshot(candidate, 'current').

**Produces:** Invalid runtime snapshots reject before storage; a valid previous slot remains unchanged.

- [ ] **Step 1: Add a recording storage helper and three boundary regressions.**

Add this helper after makeSnap() in packages/core/test/save.test.ts:

~~~ts
class RecordingStorage implements SaveStorage {
  readonly writes: Array<{ slot: string; data: SaveSnapshot }> = [];
  #data = new Map<string, SaveSnapshot>();

  async read(slot: string): Promise<SaveSnapshot | null> {
    return this.#data.get(slot) ?? null;
  }

  async write(slot: string, data: SaveSnapshot): Promise<void> {
    this.writes.push({ slot, data });
    this.#data.set(slot, data);
  }

  async delete(slot: string): Promise<void> {
    this.#data.delete(slot);
  }

  async list(): Promise<string[]> {
    return [...this.#data.keys()];
  }
}
~~~

Add this block after the existing SaveManager describe block:

~~~ts
describe('SaveManager 写入前校验', () => {
  it('非 JSON 安全变量在触及存储后端前被拒绝', async () => {
    const storage = new RecordingStorage();
    const manager = new SaveManager(storage);
    const invalid = makeSnap({
      variables: { x: undefined } as unknown as SaveSnapshot['variables'],
    });

    await expect(manager.save('slot', invalid)).rejects.toThrow(/variables.*JSON 安全/);
    expect(storage.writes).toEqual([]);
  });

  it('非法 gallery 结构不会覆盖既有有效槽位', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save('slot', makeSnap({ variables: { x: 1 } }));
    const before = await manager.load('slot');
    const invalid = makeSnap({
      variables: { x: 99 },
      gallery: { cgs: [], music: [123] } as unknown as SaveSnapshot['gallery'],
    });

    await expect(manager.save('slot', invalid)).rejects.toThrow(/gallery\.cgs.*gallery\.music/);
    expect(await manager.load('slot')).toEqual(before);
  });

  it('有效快照先盖章为 current schema 后才写入', async () => {
    const storage = new RecordingStorage();
    const manager = new SaveManager(storage);
    const input = makeSnap({
      meta: { id: 'wrong', createdAt: 0, updatedAt: 0, schemaVersion: 1 },
    });

    await manager.save('real-slot', input);
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]).toMatchObject({
      slot: 'real-slot',
      data: { meta: { id: 'real-slot', schemaVersion: 3 } },
    });
  });
});
~~~

- [ ] **Step 2: Obtain the true Save red state.**

Run:

~~~powershell
npm run test -w @surdet/core -- test/save.test.ts
~~~

Expected before production change: first test fails because RecordingStorage receives invalid data; second fails because invalid save overwrites slot; third passes because stamping already exists. Record all real outcomes.

- [ ] **Step 3: Implement a single pre-write validation.**

Replace the full existing save() body in packages/core/src/save/save-manager.ts with:

~~~ts
  async save(slot: string, snapshot: SaveSnapshot): Promise<void> {
    const now = Date.now();
    const stamped: SaveSnapshot = {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        id: slot,
        updatedAt: now,
        createdAt: snapshot.meta.createdAt || now,
        schemaVersion: SAVE_SCHEMA_VERSION,
      },
    };
    assertValidSnapshot(stamped, 'current');
    await this.#storage.write(slot, deepClone(stamped));
  }
~~~

Do not add a try/catch. Invalid input must reject unchanged and must prevent the backend call. Do not validate the raw snapshot before stamping because final slot metadata/schema are authoritative.

- [ ] **Step 4: Verify and commit Task 2.**

Run:

~~~powershell
npm run test -w @surdet/core -- test/save.test.ts
npm run typecheck -w @surdet/core
git diff --check
git add packages/core/src/save/save-manager.ts packages/core/test/save.test.ts
git commit -m "fix(core): reject invalid snapshots before save writes"
git show --stat --oneline HEAD
~~~

Expected: every Save test passes. Record real SHA. Stage exactly the two Task 2 files.

### Task 3: Run proportional Core and formal-game integration gates

**Files:**
- Read: packages/core/test/growth.test.ts
- Read: packages/core/test/save.test.ts
- Read: packages/core/test/interpreter-save.test.ts
- Read: examples/zero-after-midnight/package.json
- Modify: this plan only

**Consumes:** Task 1 and Task 2 commits.

**Produces:** Fresh evidence for Core suite, Core build boundary and formal Zero save/load simulation. No source modification.

- [ ] **Step 1: Run complete Core tests.**

Run:

~~~powershell
npm run test -w @surdet/core
~~~

Expected: all Core test files pass. Any Core failure is a stop condition; do not widen scope or change unrelated tests to hide it.

- [ ] **Step 2: Typecheck and build Core.**

Run:

~~~powershell
npm run typecheck -w @surdet/core
npm run build -w @surdet/core
~~~

Expected: both exit 0. dist is a build artifact and must not be staged.

- [ ] **Step 3: Run one formal game consumer path.**

Run:

~~~powershell
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
~~~

Expected: record actual choice, ending, save/load smoke and runtime-error output. The usual target is 23/23 choices, 3 endings, 39 save/load smoke and 0 runtime errors, but report actual output only.

- [ ] **Step 4: Run scoped hygiene checks.**

Run:

~~~powershell
git diff --check
git ls-files '*.log'
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
~~~

Expected: diff check exits 0 and tracked logs are empty. Preserve untracked protected files and the project roadmap. Do not run verify:all as a required pass/fail gate for this Core-only wave.

### Task 4: Report, local documentation commit and stop

**Files:**
- Create: docs/ENGINE-CORE-DATA-CONSISTENCY-WAVE-1-DELIVERY-REPORT-2026-08-13.md
- Modify: docs/superpowers/plans/2026-08-13-core-data-consistency-wave-1.md

**Consumes:** Actual Task 0–3 output, red/green evidence and real commits.

**Produces:** Factual report and ledger. No push, deployment, Electron run, release or next-wave work.

- [ ] **Step 1: Create the report with exact sections.**

The report must contain:

~~~markdown
# Surdet Core 数据一致性 Wave 1 交付报告

## 1. 范围与结论
说明本轮只处理 Growth 多级升级原子性和 SaveManager 写前校验；列出未修改的 Interpreter、迁移、VariableStore、SaveStorage、Shell、Renderer、Host、Editor、剧情、资产、音频、性能和 schema。

## 2. Growth 原子提交
写明先计算等级/经验、再准备属性更新、调用既有 setMany、最后写 Growth maps 的顺序；列出未声明、非 number、readonly、非有限增量四个失败用例和三类状态保持不变的证据；说明正常连升与 clamp 不变。

## 3. SaveManager 写前校验
写明最终盖章候选在 current schema 校验后才触及 SaveStorage.write；列出 invalid JSON 的 write=0、非法 gallery 不覆盖旧槽、合法快照仍以真实 slot/current schema 写入的证据。

## 4. 验证结果
逐行列出聚焦 Growth、聚焦 Save、Core 全量、Core typecheck、Core build、Zero simulate、diff check、tracked logs 的实际命令与退出码。明确说明 verify:all 未作为本轮门禁运行及已知无关 Editor EOL 原因。

## 5. Git 与停止点
写入真实开始/结束 HEAD、本轮提交 SHA、HEAD...surdet/main、status、报告字节数和 SHA-256；明确未 push、未部署、未打包、未发行、未进入 Shell 可靠性或备份恢复阶段。

## 6. 后续边界
下一候选主题是长期台账阶段 2：Shell 失败数据可靠性；.bak 显式恢复是阶段 3 的独立议题。本报告不授权开始任何下一阶段。
~~~

- [ ] **Step 2: Append an Execution Ledger to this plan.**

Add these headings and actual results:

~~~markdown
## Execution Ledger

### Task 0 — baseline
### Task 1 — Growth atomicity
### Task 2 — Save write validation
### Task 3 — proportional gates
### Task 4 — documentation closure
~~~

Each entry must state command, exit result, test total if applicable, changed file paths, real commit SHA where one exists and work explicitly not performed. Do not claim Electron or manual player testing.

- [ ] **Step 3: Re-read document facts before staging.**

Run:

~~~powershell
$report = 'E:\surdet\docs\ENGINE-CORE-DATA-CONSISTENCY-WAVE-1-DELIVERY-REPORT-2026-08-13.md'
$plan = 'E:\surdet\docs\superpowers\plans\2026-08-13-core-data-consistency-wave-1.md'
Get-Item -LiteralPath $report, $plan | Select-Object FullName, Length
Get-FileHash -LiteralPath $report, $plan -Algorithm SHA256
git diff --check
git status --short
~~~

Expected: Both documents exist. Copy exact byte counts/hashes into report. If unrelated tracked files appear, stop and report them.

- [ ] **Step 4: Commit only the report and this Task plan.**

Run:

~~~powershell
git add docs/ENGINE-CORE-DATA-CONSISTENCY-WAVE-1-DELIVERY-REPORT-2026-08-13.md docs/superpowers/plans/2026-08-13-core-data-consistency-wave-1.md
git commit -m "docs(core): record data consistency wave 1"
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git ls-files '*.log'
~~~

Expected: Normal local documentation commit only. Do not stage the project roadmap, BGM reports/assets, generated dist, protected files or any other plan.

- [ ] **Step 5: Stop at this exact status.**

~~~text
CORE_DATA_CONSISTENCY_WAVE_1_IMPLEMENTED
GROWTH_ATOMICITY_VERIFIED
SAVE_WRITE_VALIDATION_VERIFIED
ZERO_SAVE_LOAD_CONSUMER_PATH_VERIFIED
SHELL_DATA_RELIABILITY_NOT_STARTED
BACKUP_RECOVERY_NOT_STARTED
AUDIO_PRODUCTION_DEFERRED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_INDEPENDENT_REVIEW
~~~

Do not push, deploy, package, launch Electron, enter the next task or call the complete foundation program finished.

## Completion Review Checklist

- [ ] Task 0 records real Git facts and preserves unrelated files.
- [ ] Task 1 first demonstrates partial Growth mutation, then all four invalid cases leave VariableStore and Growth snapshots unchanged.
- [ ] Task 1 preserves valid multi-level behavior, clamp and GrowthResult.
- [ ] Task 2 first demonstrates invalid data reaches storage, then rejects it before SaveStorage.write and preserves an existing slot.
- [ ] Task 2 validates the final stamped candidate, not raw caller input.
- [ ] No new migration, fallback, rollback container, storage interface method, runtime state machine or dependency exists.
- [ ] Fresh Core focused/full tests, Core typecheck/build and Zero simulation have actual recorded results.
- [ ] No Editor EOL, audio, performance, Shell reliability, backup recovery, push, deployment, release or M9 work occurred.
- [ ] Final report/plan metadata is reread from disk and only authorized documents are staged.

## Execution Ledger

### Task 0 — baseline

- 已完整读取 `E:\surdet\AGENTS.md`、`docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md` 和本任务书；Git 提交/暂存遵循本地 Git 工作规范。
- 真实起始 `HEAD`：`2f82ea32adfacbb2aab5cba8230f9d58113b7d2b`。
- 真实起始 `HEAD...surdet/main`：`3 0`；这三个本地提交均属于先前 BGM Wave 1，本轮未改动或暂存它们。
- 真实起始工作树只有五个受保护未跟踪文件：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`；本任务书和项目路线台账也为未跟踪文件，但均未被暂存或修改。没有 tracked 修改。
- `git diff --check`：退出码 `0`；`git ls-files '*.log'`：空。
- 只读源码核对确认 `VariableStore.setMany()` 已存在并先完整校验、再提交；`GrowthSystem.gainExp()` 当前在逐级循环中调用 `modify()`，后续配置错误可留下早先属性写入；`SaveManager.save()` 当前生成 stamped 快照后直接 `deepClone()` 并调用 `SaveStorage.write()`，没有对最终候选调用 `assertValidSnapshot(candidate, 'current')`。
- 未修改 `VariableStore`、Interpreter、迁移、SaveStorage、schema 或任何 examples/Host/Renderer/Shell/Editor 文件。
- 未修改代码前运行 `npm run test -w @surdet/core -- test/growth.test.ts test/save.test.ts`：退出码 `0`，2 个文件、`37/37` tests 通过（Growth `15`，Save `22`）。该绿灯只记录既有覆盖，不否定本任务书锁定的两个缺口。
- Task 0 的事实结论：`GROWTH_PARTIAL_WRITE_CONFIRMED`；`SAVE_WRITE_VALIDATION_GAP_CONFIRMED`。下一入口为 Task 1，必须先新增 Growth 红灯；Task 0 不创建提交。

### Task 1 — Growth atomicity

- 先新增 `GrowthSystem gainExp 原子提交` 测试并运行 `npm run test -w @surdet/core -- test/growth.test.ts`：真实红灯为 `4 failed / 16 passed`（20 tests）；未声明目标、非 number 目标、readonly 目标、非有限增量四种场景均显示 `lynn.atk` 从 `5` 变为 `7` 后才抛错，证明部分写入。
- 生产修复仅修改 `packages/core/src/systems/growth.ts`：保留原曲线、封顶、等级/经验计算；删除循环内 `modify()`，新增只读准备方法 `#prepareStatGrowthUpdates()`，先验证全部目标并计算更新值，再调用既有 `VariableStore.setMany()`，最后写入 `#levels` / `#experience`。未修改 VariableStore 或新增 API。
- 同一聚焦测试修复后转绿：`20/20` tests；合法两级连升仍返回 `levelBefore=1`、`levelAfter=3`、`levelsGained=2`、`passedLevels=[2,3]`，clamp 后属性为 `atk=7`、`hp=40`，等级/经验为 `3/5`。
- `npm run typecheck -w @surdet/core`：退出码 `0`；`git diff --check`：退出码 `0`。
- Task 1 提交：`37407241dca76454c897460781383aa07edd7d9a` — `fix(core): make growth grants atomic`。精确暂存仅包含 `packages/core/src/systems/growth.ts` 和 `packages/core/test/growth.test.ts`；未暂存 BGM、路线台账、受保护文件或其他计划。
- Task 1 明确未执行 Save、Shell、Renderer、examples、性能、发行或 push 工作。下一入口为 Task 2，先新增 Save 写前校验红灯。

### Task 2 — Save write validation

- 先新增 `RecordingStorage` 和三条写入边界回归，运行 `npm run test -w @surdet/core -- test/save.test.ts`：真实红灯为 `2 failed / 23 passed`（25 tests）。非法 JSON 变量和非法 Gallery 两项错误地 resolved，证明当前 SaveManager 会调用后端并可能覆盖旧槽位；最终盖章 current schema 测试先行通过。
- 生产修复仅修改 `packages/core/src/save/save-manager.ts`：在生成真实 slot、createdAt、updatedAt、schemaVersion 的 `stamped` 候选后，调用既有 `assertValidSnapshot(stamped, 'current')`，再对该候选做 `deepClone` 并写入；未校验原始输入，未添加 try/catch、fallback、备份、迁移或兼容层。
- 同一 Save 聚焦测试修复后转绿：`25/25` tests；非法 JSON 的 RecordingStorage `writes=[]`，非法 Gallery 不覆盖已有有效槽位，合法输入被写为真实 slot `real-slot` / schema `3`。
- `npm run typecheck -w @surdet/core`：退出码 `0`；`git diff --check`：退出码 `0`。
- Task 2 提交：`8b7350ee8a2bde843b4fd892be3fe7b6bf9d9735` — `fix(core): reject invalid snapshots before save writes`。精确暂存仅包含 `packages/core/src/save/save-manager.ts` 和 `packages/core/test/save.test.ts`；未暂存 BGM、路线台账、受保护文件或其他计划。
- Task 2 明确未执行 Shell、Renderer、Editor、examples 源码、性能、发行或 push 工作。下一入口为 Task 3：运行 Core 全量/typecheck/build 与 Zero simulate。

### Task 3 — proportional gates

- `npm run test -w @surdet/core`：退出码 `0`；23 个 test files、`313/313` tests 通过。
- `npm run typecheck -w @surdet/core`：退出码 `0`。
- `npm run build -w @surdet/core`：退出码 `0`；生成的 `dist` 未暂存。
- `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`：退出码 `0`；正式入口 `prologue`、11 scenes、23/23 choice branches、存档往返冒烟 `39` 次、3 个结局可达、runtime errors `0`。
- `git diff --check`：退出码 `0`；`git ls-files '*.log'`：空。
- Task 3 结束时 HEAD：`8b7350ee8a2bde843b4fd892be3fe7b6bf9d9735`；`HEAD...surdet/main`：`5 0`；工作树只保留五个受保护未跟踪文件、本任务书和项目路线台账，未修改/暂存后两者之外的任何文档。
- 本轮没有运行 `npm run verify:all`，因为任务书明确不要求；没有执行 Electron、部署、打包、发行、Shell/Renderer/Host、性能、音频或 M9 工作。下一入口为 Task 4 文档收口。

### Task 4 — documentation closure

- 交付报告已真实创建：`docs/ENGINE-CORE-DATA-CONSISTENCY-WAVE-1-DELIVERY-REPORT-2026-08-13.md`；首次磁盘复核为 `7692` bytes，SHA-256 `0C2C2D92B25146AE0EAFB5BF7387D8F2CBA0C545342551EAA253C711F7546537`。
- 报告已包含本轮实际红灯/绿灯、Growth/Save 两个提交 SHA、Core/Zero 验证结果、未修改范围、未执行的 verify:all/Electron/发行工作和停止状态；未将文档自身尚未产生的自引用 commit SHA 写成事实。
- 本 Task 只允许暂存并提交本报告与 `docs/superpowers/plans/2026-08-13-core-data-consistency-wave-1.md`；项目路线台账、BGM Wave 1 三个提交/文件、受保护文件、构建产物和日志均不在暂存范围。
- 文档提交前文档状态：报告 `7692` bytes / SHA-256 `0C2C2D92B25146AE0EAFB5BF7387D8F2CBA0C545342551EAA253C711F7546537`；计划在本次台账追加前为 `32334` bytes / SHA-256 `C5A55D154B0D216C43654958AC676B91E531BF71A14908291D17798B59637F81`。追加本条后将再次从磁盘读取两份最终大小和哈希。
- 文档提交完成后立即停止，不 push、不部署、不打包、不发行、不启动 Shell 可靠性或备份恢复，不进入 M9；最终 HEAD、远端关系、工作树和日志状态以提交后的只读命令为准。
