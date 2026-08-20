# Pre-Wave 4 Reliability Fresh Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改生产代码、不启动 Wave 4 的前提下，为六项会影响 Agent Port 可信度的可靠性候选建立新鲜、可重复、可独立复审的红灯或平台合同证据，并据此决定后续是否逐项开具修复任务书。

**Architecture:** 本轮是诊断 Gate，不是修复 Wave。SIM-STATE-1、TX-COMMIT-POSTREPLACE、A7、M1、N4 使用现有 Vitest 与公共 API，在临时诊断测试中断言长期正确合同并取得预期红灯；N7 使用当前 Windows replacement 源码、实际平台身份与 Node 官方 `copyFile` 非原子性合同形成确定性证据，不使用概率性 kill/copy 压力实验。所有诊断 fixture、测试输出和 artifact 位于系统临时目录；临时测试在取证后机械删除，不进入提交。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、现有 `@surdet/core` / `@surdet/authoring` / `@surdet/cli` / `surdet-editor`、Windows 11 / NTFS、本机 `pwsh` 7.6.4、Git。

## Global Constraints

- 本轮只做 Fresh Gate 与事实报告；不得修改任何生产源码，不得实施任何候选修复。
- Wave 4 Agent Port 的设计规格与总任务书继续保留，但 implementation 保持暂停；不得安装 MCP 依赖、创建 Port 源码或运行 Wave 4 FORMAL。
- 六项范围固定为：`SIM-STATE-1`、`TX-COMMIT-POSTREPLACE`、`N7-WINDOWS-REPLACEMENT`、`A7-INVALID-CONFIG`、`M1-GENERIC-START-REENTRANCY`、`N4-SCHEDULED-WHEN-LINT`。
- `M2-TINT-RESTORE` 与 `N9-EDITOR-CLI-W007` 已确认源码风险，但不属于本前置阻断 Gate；只登记为后置 backlog，不在本轮创建测试或修改 Renderer/Editor 可达性实现。
- 每个动态 Gate 默认只有一次正式取证运行；若第一次不是业务断言失败，而是测试自身语法、导入或 fixture 无效，只允许修正测试设施一次并再运行一次。第二次仍属 harness failure，停止该 Gate，不猜改生产代码。
- 红灯是本轮成功证据，不得因命令 exit `1` 自动修复或循环重跑；必须保留原始 JSON 输出，记录第一个失败断言。
- 临时诊断测试只能使用本任务书规定的 `__fresh-gate-*.test.ts` 路径；每项证据回读后必须用 `apply_patch` 删除本轮新建的临时文件。
- 不得用 `git checkout`、`git reset`、`git clean`、stash 或删除既有用户文件恢复工作树；只删除本轮由执行 AI 明确新建的临时测试。
- 不得修改 Core、Authoring、CLI、Editor、Renderer、Host、Shell、Starter、Zero 的生产源码、配置、资产或现有正式测试。
- 不得运行 `verify:all`、Electron、浏览器、性能矩阵、pack、部署、发行、音频或 Wave 4 聚合。
- 原始 Starter 不参与本轮；不得复制或修改 `examples/starter`。
- 每项 artifact 必须位于新的系统临时目录，使用 `--reporter=json --outputFile=<unique path>`，不得覆盖或筛选失败证据。
- 报告中的 HEAD、路径、字节数、SHA-256 与测试结果必须从磁盘重新读取。
- 执行 AI 只更新本任务书 Execution Ledger 和本轮交付报告；长期路线台账由总经理维护，执行 AI 不得修改、暂存或提交。
- 本轮最终普通本地提交只能包含本任务书和交付报告；临时红灯测试、artifact、日志、长期台账和受保护文件不得进入提交。
- 未经项目所有者明确授权不得 push、force push、rebase、reset、amend、squash、部署、打包或发行。
- 任务书头部的 sub-skill 提示不构成创建子 AI 或并发施工授权；本轮默认由一个执行 AI 串行完成。

---

## 一、权威输入与施工状态

执行 AI 必须按顺序完整读取：

1. `E:\surdet\AGENTS.md`
2. `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
3. `docs/superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md`
4. `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`
5. 本任务书
6. `docs/PROJECT-LEVEL-AUTHORING-CONFIG-STAGE-6-WAVE-3-DELIVERY-REPORT-2026-08-14.md`
7. 本任务涉及的源码与现有测试：
   - `packages/authoring/src/simulation.ts`
   - `packages/authoring/src/project-snapshot.ts`
   - `packages/authoring/src/change-session.ts`
   - `packages/cli/src/lint.ts`
   - `packages/cli/src/authoring/node-project-storage.ts`
   - `packages/core/src/runtime/interpreter.ts`
   - `packages/editor/src/config-edit.ts`
   - 对应测试文件

任务书生成时的真实基线：

```text
branch = main
planningBaseHead = 6b9a931c2bf164aaa8a5b49ccdd36258db6c5ef9
surdet/main = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
ahead/behind = 2 0
tracked worktree = clean
staging area = empty
Wave 4 design/taskbook = local commits, not pushed
Wave 4 implementation = paused before start
Reliability Fresh Gate implementation = not authorized at taskbook creation
```

执行开始时必须重新读取。若 HEAD、tracked 工作树、暂存区或远端关系出现未记录变化，停止在 Task 0；不得自行整理他人的在途修改。

## 二、六项 Gate 与后续关系

| Gate | 当前源码证据 | 本轮所需新证据 | 对 Wave 4 的关系 |
|---|---|---|---|
| SIM-STATE-1 | cycle signature 只有 position + variables，SaveSnapshot 另含 callStack | 两个不同 caller 到达同一 choice，第二条真实错误路径被剪枝 | 直接影响 `project.simulate` 与 FORMAL 是否假绿 |
| TX-COMMIT-POSTREPLACE | replacement 全部完成后，removeStage / COMMITTED metadata 位于 recovery catch 外 | 故障注入得到“项目已变 + commit 抛错 + record OPEN”三联态 | 直接影响 Agent Port apply 的结果可信度 |
| N7-WINDOWS-REPLACEMENT | Windows EEXIST/EPERM fallback 覆盖式 `copyFile(staged,target)` | 当前平台/源码身份 + Node 官方不保证 copyFile 原子性 | 直接影响 Agent 自动提交时的文件完整性设计 |
| A7-INVALID-CONFIG | snapshot 把非对象顶层压成 `{}`；Editor 数组挂属性后 JSON.stringify 丢失 | Authoring 非对象配置未拒绝；Editor 变量保存纯函数未拒绝 | 影响 Agent inspect/validate 与人类编辑器一致性 |
| M1-GENERIC-START | generic instr 回调后仅检查 jumpOverride，未消费 resumeRequested | `clear` 回调 start 新场景后首条文本被跳过 | 影响 runtime 证据链的控制流正确性 |
| N4-SCHEDULED-WHEN | CLI 只扫描 `events[].when`，Runtime 对 scheduled 条件严格求值 | Runtime paired oracle 绿 + CLI 对 ghost 条件假绿 | 影响 lint/validate 的静态可信度 |

本轮不决定具体修复算法。Fresh Gate 完成后，总经理按真实结果分别裁决：

```text
REPRODUCED          -> 允许为该 Finding 单独制作修复任务书
NOT_REPRODUCED      -> 不修，保留证据并重新评估源码推断
HARNESS_INVALID     -> 不修，先复审复现方法
SOURCE_CONTRACT_CONFIRMED -> N7 进入独立存储替换设计，不做概率实验
```

## 三、文件范围

### 3.1 本轮计划创建并最终提交

| 文件 | 责任 |
|---|---|
| `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md` | 六项 Gate 的真实结果、artifact 身份、裁决矩阵与停止点 |
| 本任务书 | Execution Ledger |

### 3.2 仅在取证期间临时创建、不得提交

```text
packages/authoring/test/__fresh-gate-sim-state.test.ts
packages/authoring/test/__fresh-gate-tx-postreplace.test.ts
packages/authoring/test/__fresh-gate-a7-config-shape.test.ts
packages/core/test/__fresh-gate-m1-generic-start.test.ts
packages/cli/test/__fresh-gate-n4-scheduled-when.test.ts
packages/editor/test/__fresh-gate-a7-config-shape.test.ts
```

### 3.3 禁止修改

除本任务书和新交付报告外，所有既有 tracked 文件均禁止修改。特别禁止：

```text
packages/**/src/**
packages/**/test/*.test.ts（既有文件）
packages/shell/e2e/**
examples/**
games/**
package.json
package-lock.json
SESSION-HANDOFF.md
USER.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md
```

---

### Task 0: 权威基线、源码身份与临时证据根

**Files:**
- Read: 本任务书“一、权威输入”列出的全部文件
- Modify: 本任务书（仅 Execution Ledger；暂不暂存）
- Create outside repository: `%TEMP%\surdet-pre-wave4-reliability-<uuid>\`

**Interfaces:**
- Consumes: 项目所有者后续明确的 Fresh Gate 实施授权；本任务书完成不等于授权执行。
- Produces: `GATE_BASE_HEAD`、六类源码 SHA-256、唯一 `gateRoot` 与干净工作树基线。

- [ ] **Step 1: 读取权威文件并记录 Git 基线**

Run（必须使用 `pwsh`）：

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short --branch
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：分支为 `main`；tracked 工作树无修改、暂存区为空。现有未跟踪治理文件原样保留。若不满足，停止。

- [ ] **Step 2: 回读六项源码身份**

```powershell
$sources = @(
  'packages/authoring/src/simulation.ts',
  'packages/authoring/src/change-session.ts',
  'packages/authoring/src/project-snapshot.ts',
  'packages/core/src/runtime/interpreter.ts',
  'packages/cli/src/lint.ts',
  'packages/cli/src/authoring/node-project-storage.ts',
  'packages/editor/src/config-edit.ts'
)
$sources | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash
  "{0}`t{1}`t{2}" -f $_,$item.Length,$hash
}
```

Expected：七个文件均存在；把真实 bytes/SHA-256 写入 Ledger，后续 artifact 以此证明被测源码身份。

- [ ] **Step 3: 创建唯一临时证据目录**

```powershell
$gateRoot = Join-Path ([IO.Path]::GetTempPath()) ('surdet-pre-wave4-reliability-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gateRoot | Out-Null
$gateRoot
```

Expected：目录在系统临时目录下，不在仓库、桌面或 Starter 内。将绝对路径写入 Ledger；本轮所有 JSON reporter 输出只写这里。

- [ ] **Step 4: 记录工具链，不运行全量门禁**

```powershell
node --version
npm --version
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
```

Expected：Node 满足仓库当前要求；不安装依赖、不运行 `npm install`。

---

### Task 1: SIM-STATE-1 — callStack 必须参与模拟剪枝身份

**Files:**
- Read: `packages/authoring/src/simulation.ts:140-297`
- Read: `packages/core/src/runtime/interpreter.ts:235-307`
- Temporary Create: `packages/authoring/test/__fresh-gate-sim-state.test.ts`
- Artifact: `<gateRoot>/sim-state-1-vitest.json`

**Interfaces:**
- Consumes: `loadProjectSnapshot(storage, hasher)`、`simulateSnapshot(snapshot, options)`。
- Produces: `SIM_STATE_1 = REPRODUCED | NOT_REPRODUCED | HARNESS_INVALID`。

- [ ] **Step 1: 创建最小正确合同红灯**

使用 `apply_patch` 新建以下完整测试：

```ts
import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { simulateSnapshot } from '../src/simulation.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

function storage(): ProjectStorage {
  const files: Record<string, string> = {
    'game.config.json': JSON.stringify({ entryScene: 'entry', variables: {} }),
    'content/scenario/entry.gal': [
      '@scene entry',
      '@choice',
      '  路径 A -> @jump caller_a',
      '  路径 B -> @jump caller_b',
      '@end',
    ].join('\n'),
    'content/scenario/caller_a.gal': [
      '@scene caller_a',
      '@call shared',
      '@clear safe_end',
      '@end',
    ].join('\n'),
    'content/scenario/caller_b.gal': [
      '@scene caller_b',
      '@call shared',
      '@check false',
      '@end',
    ].join('\n'),
    'content/scenario/shared.gal': [
      '@scene shared',
      '@choice',
      '  继续 -> @goto done',
      '@label done',
      '@return',
    ].join('\n'),
  };
  return {
    rootIdentity: 'fresh-gate-sim-callstack',
    listFiles: async () => Object.keys(files),
    readText: async (path): Promise<ProjectFile> => {
      const text = files[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return { path, text, bytes: new TextEncoder().encode(text).byteLength, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in files,
  };
}

describe('SIM-STATE-1 fresh gate', () => {
  it('does not merge equal position/variables with different call stacks', async () => {
    const snapshot = await loadProjectSnapshot(storage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });
    expect(report.status).toBe('failed');
    expect(report.runtimeErrors.some((error) => error.message.includes('@check 断言失败'))).toBe(true);
  });
});
```

- [ ] **Step 2: 只运行一次正式取证**

```powershell
npm run test -w @surdet/authoring -- __fresh-gate-sim-state.test.ts --reporter=json --outputFile="$gateRoot\sim-state-1-vitest.json"
```

Expected current red：exit `1`；正确合同期望 `report.status='failed'`，实际很可能为 `passed`，且 runtimeErrors 未包含 caller B 的 `@check`。这才是 `REPRODUCED`。

若失败原因是 DSL 编译、导入或测试语法，标记 `HARNESS_INVALID`，只允许修正一次测试设施并重跑一次；不得改生产代码。

- [ ] **Step 3: 回读 artifact 并删除临时测试**

```powershell
$artifact = "$gateRoot\sim-state-1-vitest.json"
Get-Item -LiteralPath $artifact | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
```

记录首个失败断言和身份，然后使用 `apply_patch` 删除 `packages/authoring/test/__fresh-gate-sim-state.test.ts`。确认：

```powershell
Test-Path -LiteralPath 'packages/authoring/test/__fresh-gate-sim-state.test.ts'
git diff --name-only
```

Expected：临时测试不存在；无既有 tracked 文件被修改。

---

### Task 2: TX-COMMIT-POSTREPLACE — 禁止“项目已变、调用失败、事务仍 OPEN”

**Files:**
- Read: `packages/authoring/src/change-session.ts:209-313`
- Read: `packages/authoring/test/commit-recovery.test.ts`
- Temporary Create: `packages/authoring/test/__fresh-gate-tx-postreplace.test.ts`
- Artifact: `<gateRoot>/tx-postreplace-vitest.json`

**Interfaces:**
- Consumes: `beginChange`、`applySceneCreate`、`recordValidation`、`commitChange`。
- Produces: `TX_COMMIT_POSTREPLACE = REPRODUCED | NOT_REPRODUCED | HARNESS_INVALID`，不指定修复算法。

- [ ] **Step 1: 创建 removeStage 故障注入红灯**

使用 `apply_patch` 新建以下完整测试：

```ts
import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectWriteStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import {
  InMemoryChangeRepository,
  beginChange,
  commitChange,
  recordValidation,
} from '../src/change-session.js';
import { applySceneCreate } from '../src/operations.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

class CleanupFaultStorage implements ProjectWriteStorage {
  readonly rootIdentity = 'fresh-gate-tx';
  readonly staged = new Map<string, { path: string; text: string; sha256: string }>();
  constructor(readonly files: Record<string, string>) {}
  async listFiles(): Promise<string[]> { return Object.keys(this.files); }
  async readText(path: string): Promise<ProjectFile> {
    const text = this.files[path];
    if (text === undefined) throw new Error(`missing ${path}`);
    return { path, text, bytes: new TextEncoder().encode(text).byteLength, sha256: await hasher.sha256(text) };
  }
  async exists(path: string): Promise<boolean> { return path in this.files; }
  async stageText(path: string, text: string, changeId: string) {
    const stagedIdentity = `${changeId}:${path}`;
    const sha256 = await hasher.sha256(text);
    this.staged.set(stagedIdentity, { path, text, sha256 });
    return { stagedIdentity, sha256 };
  }
  async replaceFromStage(path: string, stagedIdentity: string): Promise<void> {
    const staged = this.staged.get(stagedIdentity);
    if (staged === undefined || staged.path !== path) throw new Error('missing stage');
    this.files[path] = staged.text;
  }
  async restoreText(path: string, originalText: string): Promise<void> { this.files[path] = originalText; }
  async removePath(path: string): Promise<void> { delete this.files[path]; }
  async removeStage(_stagedIdentity: string): Promise<void> { throw new Error('injected post-replacement cleanup failure'); }
}

describe('TX-COMMIT-POSTREPLACE fresh gate', () => {
  it('never returns an ambiguous changed+threw+OPEN outcome', async () => {
    const storage = new CleanupFaultStorage({
      'game.config.json': JSON.stringify({ entryScene: 'prologue', variables: {} }),
      'content/scenario/prologue.gal': '@scene prologue\n旁白：开始。\n@end\n',
    });
    const repository = new InMemoryChangeRepository();
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const change = await beginChange(snapshot, repository, storage);
    await applySceneCreate(change, { operationId: 'fresh-gate-create', sceneId: 'branch_a' });
    await recordValidation(change, { evidenceId: 'fresh-gate-valid', errors: 0 });

    let threw = false;
    try {
      await commitChange(change, storage);
    } catch {
      threw = true;
    }
    const projectChanged = 'content/scenario/branch_a.gal' in storage.files;
    expect({ threw, projectChanged, status: change.record.status }).not.toEqual({
      threw: true,
      projectChanged: true,
      status: 'OPEN',
    });
  });
});
```

- [ ] **Step 2: 只运行一次正式取证**

```powershell
npm run test -w @surdet/authoring -- __fresh-gate-tx-postreplace.test.ts --reporter=json --outputFile="$gateRoot\tx-postreplace-vitest.json"
```

Expected current red：exit `1`，实际三联态为 `{threw:true, projectChanged:true, status:'OPEN'}`。若得到此精确值，记录 `REPRODUCED`。不要在本轮决定“回滚”还是“完成提交”作为修复方向。

- [ ] **Step 3: 回读并清除临时测试**

```powershell
$artifact = "$gateRoot\tx-postreplace-vitest.json"
Get-Item -LiteralPath $artifact | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
```

记录后用 `apply_patch` 删除临时测试，确认 `git diff --name-only` 不含 Authoring 测试或源码。

---

### Task 3: N7-WINDOWS-REPLACEMENT — 平台原语合同 Gate

**Files:**
- Read: `packages/cli/src/authoring/node-project-storage.ts:193-249`
- Read: Node 官方 File System 文档 `https://nodejs.org/api/fs.html`
- Artifact: 不新建概率性测试；证据写入交付报告与 Ledger

**Interfaces:**
- Consumes: 本机 `process.platform`、当前源码字节身份、Node 官方 `fsPromises.copyFile` 合同。
- Produces: `N7_WINDOWS_REPLACEMENT = SOURCE_CONTRACT_CONFIRMED | NOT_CONFIRMED | SKIPPED_NON_WINDOWS`。

- [ ] **Step 1: 确认真实平台与 fallback 源码**

```powershell
node -p "JSON.stringify({platform:process.platform,node:process.version})"
Select-String -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts' -Pattern 'fs.rename','EEXIST','EPERM','fs.copyFile','fs.rm' -Context 2,2
Get-Item -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts' | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts'
```

Expected on project owner machine：`platform=win32`；EEXIST/EPERM 后调用覆盖式 `copyFile(staged,target)` 再删除 staged。

- [ ] **Step 2: 核对官方原语合同，不做随机 kill**

官方 Node 文档对 `fsPromises.copyFile(src,dest)` 的合同是：默认覆盖已存在目标，且不保证 copy 操作的原子性；目标打开后出错时只会尝试移除目标。报告只能做不超过这一语义的转述，并附官方链接。

裁决规则：

```text
win32 + 当前 fallback 含覆盖式 copyFile + 官方无原子保证
  => SOURCE_CONTRACT_CONFIRMED

非 win32
  => SKIPPED_NON_WINDOWS（不得外推 Windows 动态结果）

源码已不再使用该 fallback
  => NOT_CONFIRMED（重新审查新算法）
```

禁止为了“动态复现”执行大文件循环、反复 kill 子进程、断电模拟或破坏真实项目文件。

- [ ] **Step 3: 明确后续设计门，而非本轮修复**

若 `SOURCE_CONTRACT_CONFIRMED`，交付报告必须写：

```text
N7_FIX_ALGORITHM = NOT_DECIDED_IN_FRESH_GATE
REQUIRES_SEPARATE_WINDOWS_REPLACEMENT_DESIGN = TRUE
PROBABILISTIC_CRASH_TEST = NOT_RUN_BY_DESIGN
REAL_PROJECT_FILES_TOUCHED = NO
```

---

### Task 4: A7-INVALID-CONFIG — Authoring 与 Editor 必须 fail-loud

**Files:**
- Read: `packages/authoring/src/project-snapshot.ts:34-87`
- Read: `packages/authoring/src/config-operations.ts:19-35`
- Read: `packages/editor/src/config-edit.ts:120-128`
- Read: `packages/editor/src/project-io.ts:63-73`
- Temporary Create: `packages/authoring/test/__fresh-gate-a7-config-shape.test.ts`
- Temporary Create: `packages/editor/test/__fresh-gate-a7-config-shape.test.ts`
- Artifacts: `<gateRoot>/a7-authoring-vitest.json`、`<gateRoot>/a7-editor-vitest.json`

**Interfaces:**
- Consumes: `loadProjectSnapshot`、`applyVariablesToConfig`。
- Produces: `A7_AUTHORING` 与 `A7_EDITOR` 两个独立结果；只有二者都红才可写 `A7_FULL_CHAIN_REPRODUCED`。

- [ ] **Step 1: 创建 Authoring 非对象顶层红灯**

```ts
import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

describe('A7 Authoring fresh gate', () => {
  it('rejects a syntactically valid non-object game.config.json', async () => {
    const files: Record<string, string> = {
      'game.config.json': '[]',
      'content/scenario/prologue.gal': '@scene prologue\n旁白：开始。\n@end\n',
    };
    const storage: ProjectStorage = {
      rootIdentity: 'fresh-gate-a7-authoring',
      listFiles: async () => Object.keys(files),
      readText: async (path): Promise<ProjectFile> => {
        const text = files[path];
        if (text === undefined) throw new Error(`missing ${path}`);
        return { path, text, bytes: new TextEncoder().encode(text).byteLength, sha256: await hasher.sha256(text) };
      },
      exists: async (path) => path in files,
    };
    await expect(loadProjectSnapshot(storage, hasher)).rejects.toThrow(/game\.config\.json.*JSON 对象/);
  });
});
```

- [ ] **Step 2: 运行 Authoring 一次正式取证**

```powershell
npm run test -w @surdet/authoring -- __fresh-gate-a7-config-shape.test.ts --reporter=json --outputFile="$gateRoot\a7-authoring-vitest.json"
```

Expected current red：exit `1`，`loadProjectSnapshot` 实际 resolved；记录 `A7_AUTHORING=REPRODUCED`。

- [ ] **Step 3: 创建 Editor 假保存纯逻辑红灯**

```ts
import { describe, expect, it } from 'vitest';
import { applyVariablesToConfig } from '../src/config-edit.js';

describe('A7 Editor fresh gate', () => {
  it('rejects an array top-level instead of reporting a variables save', () => {
    expect(() => applyVariablesToConfig('[]', {
      route: { type: 'string', initial: '' },
    })).toThrow(/game\.config\.json.*JSON 对象/);
  });
});
```

- [ ] **Step 4: 运行 Editor 一次正式取证**

```powershell
npm run test -w surdet-editor -- __fresh-gate-a7-config-shape.test.ts --reporter=json --outputFile="$gateRoot\a7-editor-vitest.json"
```

Expected current red：exit `1`，函数实际返回数组 JSON，新增 `variables` 没有被序列化；记录 `A7_EDITOR=REPRODUCED`。

- [ ] **Step 5: 回读两个 artifact 并删除两个临时测试**

```powershell
@(
  "$gateRoot\a7-authoring-vitest.json",
  "$gateRoot\a7-editor-vitest.json"
) | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash
  "{0}`t{1}`t{2}" -f $_,$item.Length,$hash
}
```

使用 `apply_patch` 精确删除两个本轮测试。不得删除或改写 `project-io.ts`、`config-edit.ts` 或现有测试。

---

### Task 5: M1-GENERIC-START-REENTRANCY — 回调 start 不得跳过目标首指令

**Files:**
- Read: `packages/core/src/runtime/interpreter.ts:235-253`
- Read: `packages/core/src/runtime/interpreter.ts:753-790`
- Read: `packages/core/test/interpreter.test.ts:512-540`
- Temporary Create: `packages/core/test/__fresh-gate-m1-generic-start.test.ts`
- Artifact: `<gateRoot>/m1-generic-start-vitest.json`

**Interfaces:**
- Consumes: `Interpreter`、同步 `EventBus`、generic `@clear` 事件。
- Produces: `M1_GENERIC_START_REENTRANCY = REPRODUCED | NOT_REPRODUCED | HARNESS_INVALID`。

- [ ] **Step 1: 创建真实 generic callback 红灯**

```ts
import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';

describe('M1 generic start reentrancy fresh gate', () => {
  it('executes target scene instruction zero after start() in clear callback', () => {
    const store = new VariableStore([]);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interpreter = new Interpreter(store, bus, registry);
    registry.register(compileScene('@clear old_end\n@end', 'source.gal', 'source'));
    registry.register(compileScene('第一条\n第二条\n@end', 'title.gal', 'title'));
    const lines: string[] = [];
    bus.on('text', (payload) => lines.push(payload.value));
    bus.on('clear', () => interpreter.start('title'));

    interpreter.start('source');

    expect(lines).toEqual(['第一条']);
    expect(interpreter.position?.sceneId).toBe('title');
  });
});
```

- [ ] **Step 2: 只运行一次正式取证**

```powershell
npm run test -w @surdet/core -- __fresh-gate-m1-generic-start.test.ts --reporter=json --outputFile="$gateRoot\m1-generic-start-vitest.json"
```

Expected current red：exit `1`，lines 实际为 `['第二条']`；这证明加的是新场景 pc，而非旧 generic pc。若不是这一差异，不得把任意失败归为 M1。

- [ ] **Step 3: 回读并删除临时测试**

```powershell
$artifact = "$gateRoot\m1-generic-start-vitest.json"
Get-Item -LiteralPath $artifact | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
```

记录后用 `apply_patch` 删除临时测试；确认 Core 目录无 tracked diff。

---

### Task 6: N4-SCHEDULED-WHEN-LINT — Runtime 严格而 CLI 不得假绿

**Files:**
- Read: `packages/core/src/systems/event-scheduler.ts:31-50`
- Read: `packages/core/test/event-scheduler.test.ts:51-58`
- Read: `packages/cli/src/lint.ts:363-462`
- Temporary Create: `packages/cli/test/__fresh-gate-n4-scheduled-when.test.ts`
- Artifacts: `<gateRoot>/n4-runtime-oracle.json`、`<gateRoot>/n4-cli-lint.json`

**Interfaces:**
- Consumes: 现有 Runtime 严格 oracle 与 `lintProject(root)`。
- Produces: `N4_RUNTIME_STRICT` 和 `N4_CLI_LINT`；只有 paired oracle 成立才写 `N4_SEMANTIC_GAP_REPRODUCED`。

- [ ] **Step 1: 新鲜运行现有 Runtime paired oracle**

```powershell
npm run test -w @surdet/core -- event-scheduler.test.ts -t "条件求值严格策略" --reporter=json --outputFile="$gateRoot\n4-runtime-oracle.json"
```

Expected：exit `0`；未定义变量在 `EventScheduler.eligible()` 中抛错。若该既有 oracle 不绿，停止 N4，不运行 CLI 红灯，因为语义前提已变化。

- [ ] **Step 2: 创建 CLI scheduled[].when 红灯**

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintProject } from '../src/lint.js';

describe('N4 scheduled when lint fresh gate', () => {
  it('reports an undeclared variable in events.json scheduled[].when', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-n4-fresh-gate-'));
    fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
    fs.mkdirSync(path.join(root, 'content', 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({
      entryScene: 'prologue',
      variables: { turn: { type: 'number', initial: 1 } },
    }));
    fs.writeFileSync(path.join(root, 'content', 'scenario', 'prologue.gal'), '@scene prologue\n旁白：开始。\n@end\n');
    fs.writeFileSync(path.join(root, 'content', 'scenario', 'turn_event.gal'), '@scene turn_event\n旁白：事件。\n@end\n');
    fs.writeFileSync(path.join(root, 'content', 'config', 'events.json'), JSON.stringify({
      events: [],
      scheduled: [{ id: 'bad', characterId: 'system', when: 'ghost > 0', scene: 'turn_event', once: false }],
    }));

    const result = lintProject(root);
    expect(result.issues.some((issue) => issue.code === 'V002' && issue.text.includes('ghost'))).toBe(true);
  });
});
```

- [ ] **Step 3: 只运行一次 CLI 正式取证**

```powershell
npm run test -w @surdet/cli -- __fresh-gate-n4-scheduled-when.test.ts --reporter=json --outputFile="$gateRoot\n4-cli-lint.json"
```

Expected current red：exit `1`，V002 断言实际为 false；配合 Runtime oracle exit `0`，构成静态假绿的 paired evidence。

- [ ] **Step 4: 回读并删除临时测试**

```powershell
@(
  "$gateRoot\n4-runtime-oracle.json",
  "$gateRoot\n4-cli-lint.json"
) | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash
  "{0}`t{1}`t{2}" -f $_,$item.Length,$hash
}
```

使用 `apply_patch` 删除 CLI 临时测试；Runtime 既有测试从未修改。

---

### Task 7: 全部临时文件清零与证据身份汇总

**Files:**
- Verify absent: 六个 `__fresh-gate-*.test.ts`
- Read: `<gateRoot>/*.json`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: Task 1～6 原始结果。
- Produces: 不筛选的 artifact 清单、干净 tracked 工作树与六项裁决矩阵。

- [ ] **Step 1: 确认临时测试全部不存在**

```powershell
$temporaryTests = @(
  'packages/authoring/test/__fresh-gate-sim-state.test.ts',
  'packages/authoring/test/__fresh-gate-tx-postreplace.test.ts',
  'packages/authoring/test/__fresh-gate-a7-config-shape.test.ts',
  'packages/core/test/__fresh-gate-m1-generic-start.test.ts',
  'packages/cli/test/__fresh-gate-n4-scheduled-when.test.ts',
  'packages/editor/test/__fresh-gate-a7-config-shape.test.ts'
)
$temporaryTests | ForEach-Object { "$_`t$(Test-Path -LiteralPath $_)" }
```

Expected：全部 `False`。若任一仍存在，使用 `apply_patch` 仅删除该本轮文件；不得清理其他路径。

- [ ] **Step 2: 枚举全部 artifact，不删除失败证据**

```powershell
Get-ChildItem -LiteralPath $gateRoot -File | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
  "{0}`t{1}`t{2}" -f $_.FullName,$_.Length,$hash
}
```

Expected：至少包含：

```text
sim-state-1-vitest.json
tx-postreplace-vitest.json
a7-authoring-vitest.json
a7-editor-vitest.json
m1-generic-start-vitest.json
n4-runtime-oracle.json
n4-cli-lint.json
```

如果某 Gate 为 `HARNESS_INVALID`，其失败 artifact 同样保留，不能为了报告整齐而删除。

- [ ] **Step 3: 写六项裁决矩阵**

Ledger 必须逐项写：

```text
findingId
sourceFiles + bytes/SHA-256
command
exitCode
expectedContract
actualFirstFailure
artifactPath/bytes/SHA-256
classification
productionFilesChanged = false
nextAllowedAction
```

不得把 N7 写成“已动态复现文件损坏”；只能写平台合同是否确认。

- [ ] **Step 4: 核对工作树**

```powershell
git status --short --branch
git diff --name-status
git diff --cached --name-status
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：除本任务书 Ledger 和尚未创建/更新的交付报告外，无 tracked 修改；暂存区为空；无 tracked log。

---

### Task 8: 写 Fresh Gate 交付报告并明确分轮修复顺序

**Files:**
- Create: `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: Task 7 磁盘回读结果。
- Produces: 只陈述证据的诊断报告，不包含生产修复完成声明。

- [ ] **Step 1: 报告最后生成**

报告必须在所有 artifact、源码身份与 Git 状态回读后才创建，正文固定包含：

1. 第一行总裁决；
2. 基线 HEAD、surdet/main、ahead/behind；
3. 六项逐项事实；
4. 动态红灯与 N7 平台合同证据的区别；
5. 所有 artifact 路径/bytes/SHA-256；
6. 明确没有修改的生产范围；
7. M2/N9 后置状态；
8. Wave 4 仍暂停；
9. 下一轮只能由总经理逐项开修复单；
10. Git 状态、是否提交、是否 push。

- [ ] **Step 2: 使用严格措辞**

允许：

```text
SIM-STATE-1_REPRODUCED
TX-COMMIT-POSTREPLACE_REPRODUCED
A7_AUTHORING_REPRODUCED
A7_EDITOR_REPRODUCED
M1_GENERIC_START_REPRODUCED
N4_PAIRED_SEMANTIC_GAP_REPRODUCED
N7_SOURCE_CONTRACT_CONFIRMED
```

禁止：

```text
FIXED
CLOSED
FORMAL_PASSED
WINDOWS_CORRUPTION_DURING_CRASH_REPRODUCED（除非真实做过，而本任务书禁止做）
WAVE_4_STARTED
```

- [ ] **Step 3: 固定建议顺序但不授权施工**

只有相应 Gate 成立时，报告建议后续顺序：

```text
R1 SIM-STATE-1
R2 TX-COMMIT-POSTREPLACE
R3 N7-WINDOWS-REPLACEMENT（先设计，再实现）
R4 A7-INVALID-CONFIG
R5 M1-GENERIC-START-REENTRANCY
R6 N4-SCHEDULED-WHEN-LINT
```

该顺序是后续任务书队列，不是本轮施工授权。每个 R 项独立红灯、最小修复、聚焦绿灯、普通本地提交和独立复审；不得合并为一个大提交。

- [ ] **Step 4: 重新读取报告身份**

```powershell
$report = 'docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md'
Get-Item -LiteralPath $report | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath $report
Get-Content -LiteralPath $report -Raw -Encoding utf8
```

修正任何与磁盘 artifact、HEAD 或实际 exit code 不一致的陈述。

---

### Task 9: 文档闭合提交与独立复审停止点

**Files:**
- Modify: 本任务书
- Create: `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`

**Interfaces:**
- Consumes: 完整 Fresh Gate 报告。
- Produces: 一笔只含两份文档的本地提交和 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`。

- [ ] **Step 1: 精确核对允许提交范围**

```powershell
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：tracked 修改/新增只有本任务书和本轮交付报告；暂存区为空。六个临时测试均不存在。

- [ ] **Step 2: 精确暂存两份文档**

```powershell
git add -- docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md
git add -- docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md
git diff --cached --check
git diff --cached --name-status
```

Expected：只有两份文档。长期路线台账、AGENTS、受保护文件、handoff、artifact 和日志不得出现。

- [ ] **Step 3: 创建普通本地提交**

```powershell
git commit -m "docs(reliability): report pre-wave-4 fresh gates"
git log --oneline -1
git show --name-status --format=fuller HEAD
```

不得 amend、squash 或 push。

- [ ] **Step 4: 提交后最终回读**

```powershell
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short --branch
git diff --check
git diff --cached --check
git ls-files '*.log'
```

重新读取任务书和报告 bytes/SHA-256，并把文档提交后的真实 HEAD 写入 Ledger；若需要补写，只能再做一笔 docs-only closure commit，不 amend。

- [ ] **Step 5: 停止，不进入任何修复**

最终状态只能是实际结果的组合，例如：

```text
PRE_WAVE_4_RELIABILITY_FRESH_GATE_COMPLETED
FINDINGS_REPRODUCED_<N>
N7_SOURCE_CONTRACT_CONFIRMED_OR_OTHER_REAL_RESULT
PRODUCTION_FIXES_NOT_STARTED
WAVE_4_IMPLEMENTATION_PAUSED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
```

### 2026-08-20 Fresh Gate 执行取证（Owner 已授权）

本节记录本轮从 Task 0 到 Task 7 的实际执行结果。所有动态 Gate 均按任务书只正式运行一次；预期 exit `1` 的业务红灯被保留为成功取证，不曾触发生产修复或循环重跑。N7 按任务书只做 Windows 平台、源码和 Node 官方原语合同核对，不宣称动态文件损坏复现。

```text
EXECUTION_AUTHORIZATION = OWNER_APPROVED
GATE_BASE_HEAD = 23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
BRANCH = main
AHEAD_BEHIND = 3 0
GATE_ROOT = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd
NODE = v24.15.0
NPM = 11.12.1
PWSH = 7.6.5
TRACKED_WORKTREE_BEFORE_DOCS = CLEAN
STAGING_AREA_BEFORE_DOCS = EMPTY
DIFF_CHECK_BEFORE_DOCS = PASS
CACHED_DIFF_CHECK_BEFORE_DOCS = PASS
TRACKED_LOGS_BEFORE_DOCS = NONE
PRODUCTION_FILES_CHANGED = FALSE
WAVE_4_RUN = NO
VERIFY_ALL_RUN = NO
ELECTRON_RUN = NO
PERFORMANCE_PACK_DEPLOY_RELEASE_RUN = NO
PUSH = NO
```

Task 0 工作树中已存在的 untracked 内容全部保留，未被整理或暂存：`.dsh/`、`.learnings/`、`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份 art-direction 文件、四份 handoff 文件和长期路线台账 `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`。

#### 源码身份回读

以下 bytes/SHA-256 均在 Task 7 从磁盘重新读取；这些文件只读，未修改。

| Ref | 文件 | bytes | SHA-256 |
|---|---|---:|---|
| S1 | `packages/authoring/src/simulation.ts` | 11958 | `ABD8ADA43A1B5682A4B88F2F8311306AF96890911C026881858586A71611AC26` |
| S2 | `packages/authoring/src/change-session.ts` | 12068 | `EF181C68172482FA7E3A6B88D50779478C02B067C9A88DF92FCC14940FC4C0CE` |
| S3 | `packages/authoring/src/project-snapshot.ts` | 3471 | `A792131D360473BA50E3AE0F0F5E94E86A01F6908F95176B0718B2189EDFFE19` |
| S4 | `packages/authoring/src/config-operations.ts` | 15349 | `9B09AC7F50572D331670655ADF7A5BD2C87F527687E0CBD302061664F3120E70` |
| S5 | `packages/core/src/runtime/interpreter.ts` | 46567 | `EC5FDABCE9A74B5C543A55F43DA633AB58B671B373A4E3BD98CEF7377F0F9679` |
| S6 | `packages/core/src/systems/event-scheduler.ts` | 4594 | `E7B7BA35590391A68D03DB730D37269C45B3C0C1BF8070C770527502E28AA6D0` |
| S7 | `packages/core/test/event-scheduler.test.ts` | 4918 | `E59CD884EF68D2669DC75918A6192551FC0C0BC0EFABC55AD04085D9D8704EAE` |
| S8 | `packages/cli/src/lint.ts` | 24336 | `4A607AAE925F18D28DECD926743AFC3C806A494D0964DFD718ED96662EEF7C12` |
| S9 | `packages/cli/src/authoring/node-project-storage.ts` | 13865 | `615814F547A28DC478F628C31B27FA1B714589B58E4FCAEE01AD924FE90C7CF8` |
| S10 | `packages/editor/src/config-edit.ts` | 26648 | `DEEC923FF465B70944EBACE6572A1594C27C1B486DBDA47D7943913B1AC004A4` |
| S11 | `packages/editor/src/project-io.ts` | 16703 | `B091F03915722965913BFD78596F7E977E6E5D250419D19B4AD920FFC6A90AB1` |

#### Gate 结果矩阵

每项都包含 `findingId`、相关源码 Ref、正式命令、exit code、合同预期、首个失败、artifact 身份、分类、生产文件变化和下一步权限边界。

##### SIM-STATE-1

```text
findingId = SIM-STATE-1
sourceFiles = S1, S5
command = npm run test -w @surdet/authoring -- __fresh-gate-sim-state.test.ts --reporter=json --outputFile="<gateRoot>\sim-state-1-vitest.json"
exitCode = 1
expectedContract = 两个不同 caller 的完整控制流状态不能因 position/variables 相同而合并；第二条路径应暴露真实错误
actualFirstFailure = AssertionError: expected 'passed' to be 'failed'
artifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\sim-state-1-vitest.json
artifactBytes = 1283
artifactSHA256 = C46774EDE4C4B5DE46AB24D58198BAC7B8D28FF886A5C97F73E3764C21E57223
classification = SIM_STATE_1_REPRODUCED
productionFilesChanged = false
nextAllowedAction = 总经理可另行制作 SIM-STATE-1 修复任务书；本轮未授权施工
```

artifact 的实际结果是 simulation `status = passed`，与预期的 `failed` 不符，证明第二条错误路径被当前状态签名剪枝。

##### TX-COMMIT-POSTREPLACE

```text
findingId = TX-COMMIT-POSTREPLACE
sourceFiles = S2
command = npm run test -w @surdet/authoring -- __fresh-gate-tx-postreplace.test.ts --reporter=json --outputFile="<gateRoot>\tx-postreplace-vitest.json"
exitCode = 1
expectedContract = 不得出现 projectChanged=true、commit 抛错且 record.status=OPEN 的不可解释三联态
actualFirstFailure = AssertionError: expected { threw: true, …(2) } to not deeply equal { threw: true, …(2) }
observedTriple = { threw: true, projectChanged: true, status: 'OPEN' }
artifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\tx-postreplace-vitest.json
artifactBytes = 1309
artifactSHA256 = 9360BDE7095470B5ADD5C9CB998D6CA16113ABC60C542030DF00D1154E6C2623
classification = TX_COMMIT_POSTREPLACE_REPRODUCED
productionFilesChanged = false
nextAllowedAction = 总经理可另行制作 TX-COMMIT-POSTREPLACE 修复任务书；本轮不决定 commit point 或回滚方向
```

##### N7-WINDOWS-REPLACEMENT

```text
findingId = N7-WINDOWS-REPLACEMENT
sourceFiles = S9
command = node -p "JSON.stringify({platform:process.platform,node:process.version})" + Select-String fallback/source identity checks
exitCode = 0
expectedContract = win32 下 EEXIST/EPERM fallback 的覆盖式 copyFile 不提供原子替换保证
actualPlatform = {"platform":"win32","node":"v24.15.0"}
actualSource = fs.rename(staged,target)；catch EEXIST/EPERM 后 fs.copyFile(staged,target)，再 fs.rm(staged,{force:true})
artifactPath = NONE_BY_DESIGN
classification = N7_SOURCE_CONTRACT_CONFIRMED
productionFilesChanged = false
nextAllowedAction = 先由总经理授权独立 Windows replacement design；本轮不实现、不做概率性 crash/copy 实验
```

官方 Node 文档规定 `fsPromises.copyFile(src, dest)` 默认会覆盖目标，且不保证 copy 操作的原子性；本轮据此确认平台原语合同，没有声称动态文件损坏已复现：[Node.js fsPromises.copyFile documentation](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode)。

```text
N7_FIX_ALGORITHM = NOT_DECIDED_IN_FRESH_GATE
REQUIRES_SEPARATE_WINDOWS_REPLACEMENT_DESIGN = TRUE
PROBABILISTIC_CRASH_TEST = NOT_RUN_BY_DESIGN
REAL_PROJECT_FILES_TOUCHED = NO
```

##### A7-INVALID-CONFIG

```text
findingId = A7-INVALID-CONFIG
sourceFiles = S3, S4, S10, S11
authoringCommand = npm run test -w @surdet/authoring -- __fresh-gate-a7-config-shape.test.ts --reporter=json --outputFile="<gateRoot>\a7-authoring-vitest.json"
authoringExitCode = 1
authoringExpectedContract = syntactically valid但顶层非 object 的 game.config.json 必须 fail-loud
authoringActualFirstFailure = Error: promise resolved "{ …(10) }" instead of rejecting
authoringArtifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\a7-authoring-vitest.json
authoringArtifactBytes = 1811
authoringArtifactSHA256 = 6C7ACA4D7FD3ADCBA96B3F71C6D56002219A96F44939B960E3CA0748A2DE5974
authoringClassification = A7_AUTHORING_REPRODUCED
editorCommand = npm run test -w surdet-editor -- __fresh-gate-a7-config-shape.test.ts --reporter=json --outputFile="<gateRoot>\a7-editor-vitest.json"
editorExitCode = 1
editorExpectedContract = 顶层 array 等非法 config shape 必须在变量保存入口 fail-loud
editorActualFirstFailure = AssertionError: expected [Function] to throw an error
editorArtifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\a7-editor-vitest.json
editorArtifactBytes = 1848
editorArtifactSHA256 = 40A661374E12B59D660E99700E5A91DD958E829BBED7785EE3D1136CB98BFDB8
editorClassification = A7_EDITOR_REPRODUCED
classification = A7_FULL_CHAIN_REPRODUCED
productionFilesChanged = false
nextAllowedAction = 总经理可另行制作共享 Authoring/Editor 对齐的 A7 修复任务书；本轮不修改配置语义
```

##### M1-GENERIC-START-REENTRANCY

```text
findingId = M1-GENERIC-START-REENTRANCY
sourceFiles = S5
command = npm run test -w @surdet/core -- __fresh-gate-m1-generic-start.test.ts --reporter=json --outputFile="<gateRoot>\m1-generic-start-vitest.json"
exitCode = 1
expectedContract = clear 回调内 start 新场景后，目标场景首条指令必须从 instruction zero 执行
actualFirstFailure = AssertionError: expected [ '第二条' ] to deeply equal [ '第一条' ]
artifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\m1-generic-start-vitest.json
artifactBytes = 1900
artifactSHA256 = B8CAEE1652AEC096969B7FCB24BF1B9A9CFB22E3E175C4AA7353C03E94B9BDF0
classification = M1_GENERIC_START_REENTRANCY_REPRODUCED
productionFilesChanged = false
nextAllowedAction = 总经理可另行制作 generic/事件分支统一重入消费语义的 M1 修复任务书；本轮未修改 Interpreter
```

##### N4-SCHEDULED-WHEN-LINT

```text
findingId = N4-SCHEDULED-WHEN-LINT
runtimeSourceFiles = S6, S7
runtimeCommand = npm run test -w @surdet/core -- event-scheduler.test.ts -t "条件求值严格策略" --reporter=json --outputFile="<gateRoot>\n4-runtime-oracle.json"
runtimeExitCode = 0
runtimeExpectedContract = EventScheduler.eligible() 对未声明变量保持严格抛错
runtimeActual = 目标既有测试 passed；numPassedTests=1，numFailedTests=0
runtimeArtifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\n4-runtime-oracle.json
runtimeArtifactBytes = 2806
runtimeArtifactSHA256 = D117922A0625586DC51AB10F64A0B32CE886BD920D1CA3AC52A6A2D4CCD51B72
runtimeClassification = N4_RUNTIME_STRICT_PASS
cliSourceFiles = S8
cliCommand = npm run test -w @surdet/cli -- __fresh-gate-n4-scheduled-when.test.ts --reporter=json --outputFile="<gateRoot>\n4-cli-lint.json"
cliExitCode = 1
cliExpectedContract = events.json scheduled[].when 中 ghost > 0 必须产生 V002
cliActualFirstFailure = AssertionError: expected false to be true // Object.is equality
cliArtifactPath = C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\n4-cli-lint.json
cliArtifactBytes = 1865
cliArtifactSHA256 = 39BACDA17AFF30CEAB1E5710D6CA4AD3AFC24FA2BD112B6A04AD56F314600793
cliClassification = N4_CLI_LINT_REPRODUCED
classification = N4_PAIRED_SEMANTIC_GAP_REPRODUCED
productionFilesChanged = false
nextAllowedAction = 总经理可另行制作 N4 scanner 统一化修复任务书；本轮不修改 lint
```

#### 临时测试与 artifact 闭合

```text
TEMPORARY_TESTS = six taskbook paths, all Test-Path=False after evidence readback
ARTIFACTS = seven JSON files retained under GATE_ROOT
ARTIFACT_DELETION = NONE
PRODUCTION_SOURCE_DIFF = NONE
EXISTING_FORMAL_TEST_DIFF = NONE
```

本轮没有创建 M2-TINT-RESTORE 或 N9-EDITOR-CLI-W007 测试；二者只登记为后置 backlog。六个动态 Gate 中五个产生匹配合同的业务红灯，N4 为 Runtime 先绿、CLI 后红的 paired semantic gap；N7 为源码/平台原语合同确认。所有结果仍是 Fresh Gate 取证，不是修复完成或关闭声明。

```text
TASK_0 = COMPLETED
TASK_1_SIM_STATE_1 = REPRODUCED
TASK_2_TX_COMMIT_POSTREPLACE = REPRODUCED
TASK_3_N7_WINDOWS_REPLACEMENT = SOURCE_CONTRACT_CONFIRMED
TASK_4_A7_INVALID_CONFIG = FULL_CHAIN_REPRODUCED
TASK_5_M1_GENERIC_START_REENTRANCY = REPRODUCED
TASK_6_N4_SCHEDULED_WHEN_LINT = PAIRED_SEMANTIC_GAP_REPRODUCED
TASK_7 = COMPLETED
PRODUCTION_FIXES = NOT_STARTED
WAVE_4_IMPLEMENTATION = PAUSED
NEXT_STOP = TASK_8_REPORT_THEN_TASK_9_DOCS_ONLY_COMMIT
```

### 2026-08-20 Task 9 首笔文档提交后回读

```text
FIRST_DOC_COMMIT = 6c55d6c68a1235bf5d5d8f7b4cc07d2dd66e43be
FIRST_DOC_COMMIT_PARENT = 23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b
FIRST_DOC_COMMIT_MESSAGE = docs(reliability): report pre-wave-4 fresh gates
FIRST_DOC_COMMIT_FILES = docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md; docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md
POST_FIRST_COMMIT_HEAD = 6c55d6c68a1235bf5d5d8f7b4cc07d2dd66e43be
POST_FIRST_COMMIT_REMOTE_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
POST_FIRST_COMMIT_AHEAD_BEHIND = 4 0
POST_FIRST_COMMIT_TRACKED_WORKTREE = CLEAN
POST_FIRST_COMMIT_STAGING_AREA = EMPTY
POST_FIRST_COMMIT_DIFF_CHECK = PASS
POST_FIRST_COMMIT_CACHED_DIFF_CHECK = PASS
POST_FIRST_COMMIT_TRACKED_LOGS = NONE
POST_FIRST_COMMIT_TEMPORARY_TESTS = ALL ABSENT
POST_FIRST_COMMIT_TASKBOOK_BYTES = 53201
POST_FIRST_COMMIT_TASKBOOK_SHA256 = FC847BF2316BBE8CAD9D1439CF9FAE2D7AF0F646A8AB56FA99B52F6523F49BF5
POST_FIRST_COMMIT_REPORT_BYTES = 10705
POST_FIRST_COMMIT_REPORT_SHA256 = 3EF6A354F14BDCC5FD7887D3EAEEC6513D2B9199EFF35920B30646056AA27C89
CLOSURE_COMMIT = REQUIRED_FOR_POST_COMMIT_LEDGER_RECORD
PUSH = NO
NEXT_STOP = DOCS_ONLY_CLOSURE_COMMIT_THEN_WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

执行 AI 不得自行进入 R1，不得修改生产代码，不得把“红灯确认”写成“缺陷修复”。

---

## 四、独立复审清单

总经理、Architect 或小衡复审时只需核对：

1. 每个动态 finding 是否由匹配症状的正确合同断言失败，而非语法/fixture 错误；
2. SIM artifact 是否明确显示 caller B 的 runtime error 被遗漏；
3. TX artifact 是否精确出现 `changed + threw + OPEN`；
4. A7 是否同时证明 Authoring 宽容与 Editor 写入丢失；
5. M1 是否实际观察到“第二条”而不是目标首条；
6. N4 Runtime 严格 oracle 是否先绿，CLI scheduled lint 是否后红；
7. N7 是否只按官方原语合同定性，没有伪造 crash 动态证据；
8. 临时测试是否全部移除，生产源码与既有测试是否零修改；
9. artifact 是否全部保留并从磁盘回读身份；
10. 提交是否只有任务书和交付报告，且没有 push。

任一 Gate 为 `HARNESS_INVALID` 时，不得批准对应生产修复；先由总经理重新裁决复现方法。其他 Gate 的有效证据不因一项 harness 无效而全部作废。

## 五、后续修复任务书最低合同

本 Fresh Gate 通过后，每个确认 finding 的独立修复任务书至少包含：

```text
唯一 findingId
本轮 artifact 身份
长期正确不变量
允许修改的最小生产文件
把临时红灯转成正式回归测试
修改前红灯 / 修改后聚焦绿灯
受影响 workspace typecheck/build
一条与症状匹配的真实路径或故障注入
普通本地提交
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
```

特殊约束：

- SIM 修复不得简单关闭 cycle pruning 或无限增加预算；签名必须包含影响未来控制流的最小完整状态。
- TX 修复必须先确定 commit point 与 failure contract；不得把 cleanup error 静默吞掉后仍留下不可解释状态。
- N7 必须先做 Windows replacement 设计，保证旧/新内容不会出现部分覆盖；不得仅增加重试次数。
- A7 必须在共享 Authoring 语义 fail-loud，并让 Editor 复用或对齐；不得只改成功提示文案。
- M1 必须统一 generic 与其他事件分支的重入消费语义；不得为 `clear` 写一个专属特例。
- N4 必须让 `events[]` 与 `scheduled[]` 使用同一表达式提取真相；不得复制第三套 scanner。

## 六、Execution Ledger

### 2026-08-20 任务书生成基线

```text
PLANNING_BASE_HEAD = 6b9a931c2bf164aaa8a5b49ccdd36258db6c5ef9
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND = 2 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
OWNER_DECISION = CLEAN_HOUSE_BEFORE_WAVE_4
FRESH_GATE_TASKBOOK_AUTHORING = AUTHORIZED
FRESH_GATE_EXECUTION = NOT_AUTHORIZED_AT_TASKBOOK_CREATION
PRODUCTION_FIXES = NOT_AUTHORIZED
WAVE_4_IMPLEMENTATION = PAUSED BEFORE START
PUSH = NOT_AUTHORIZED
```

总经理已独立只读核对当前源码链：SIM signature 遗漏 `callStack`；generic instr 分支未消费 `resumeRequested`；CLI events scanner 遗漏 `scheduled[].when`；非对象 game config 在 Authoring/Editor 存在 fail-silent 分裂；post-replacement cleanup 位于 recovery catch 外；Windows fallback 使用官方不保证原子性的覆盖式 `copyFile`。这些事实用于制定复现方法，不等于动态缺陷已经全部证明。

当前停止状态：

```text
PRE_WAVE_4_RELIABILITY_FRESH_GATE_TASKBOOK_COMPLETED
WAITING_FOR_OWNER_EXECUTION_AUTHORIZATION
NO_PRODUCTION_CODE_CHANGED_BY_TASKBOOK_AUTHORING
WAVE_4_DESIGN_AND_MASTER_TASKBOOK_RETAINED
WAVE_4_IMPLEMENTATION_PAUSED
NOT_PUSHED
```
