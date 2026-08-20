# Reliability R3 — Windows Non-Tearing Rename Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 若当前环境没有这些 sub-skill，则严格按本文 Task 0 → Task 6 串行执行，不得省略停止门或扩大范围。

**Goal:** 删除 `NodeProjectStorage` 在 Windows rename 失败后对现有目标执行的非原子 `copyFile` 覆盖兜底，改为同目录 rename-only、有限重试、失败保持旧目标与 staged 内容并 fail-loud 的可验证替换合同。

**Architecture:** `@surdet/authoring` 的事务、journal、commit point 与恢复语义保持不变；R3 只修复 CLI 的 Node 文件系统适配层。新增一个职责单一的内部 rename helper，正常路径只调用同目录 `fs.rename(staged, target)`；Windows 上仅对明确的暂时性锁错误做固定预算重试，预算耗尽后抛出原始文件系统错误，禁止退化为 byte-copy、先删目标、target→backup→staged 的多步替换或无限重试。永久测试同时覆盖纯函数式故障注入和真实 Windows 锁文件路径。

**Tech Stack:** TypeScript 5.7、Node.js >=20、`node:fs/promises`、`node:timers/promises`、Vitest 3、Windows 11 / NTFS、PowerShell、Git。

## Global Constraints

- 唯一 finding 为 `N7-WINDOWS-REPLACEMENT`；R4～R6 与 Wave 4 implementation 不得启动。
- 当前远端锚点在任务书创建时为 `0c8358acfd7131709c97fd53014f2ffe30a78065`；执行时必须重新读取真实 HEAD、远端和 ahead/behind，不得照抄该值。
- 生产修改严格限定在 `packages/cli/src/authoring/node-file-replacement.ts` 与 `packages/cli/src/authoring/node-project-storage.ts`。
- 永久测试严格限定在 `packages/cli/test/node-file-replacement.test.ts` 与 `packages/cli/test/node-project-storage.test.ts`。
- 当轮文档严格限定为本任务书和 `docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md`。
- 不修改 `@surdet/authoring` 的 `ProjectWriteStorage` 接口、`commitChange()`、journal schema、ChangeRecord schema 或 CLI 公共 JSON envelope。
- 不修改 Core、Renderer、Host、Shell、Editor、Starter、Zero、存档格式、长期路线台账或受保护文件。
- 不新增 npm 依赖，不修改任何 `package.json` 或 lockfile，不引入 native addon、FFI、C#、PowerShell 子进程或 Windows-only executable。
- 不使用 `copyFile`、`cp`、流式写入或 `writeFile(target, ...)` 作为现有目标的 replacement fallback。
- 不先删除目标，不使用 `target → backup → staged → target` 两阶段交换；该方案会制造 target 暂时不存在和额外 crash-recovery 状态，超出 R3。
- 不用增加 copy 重试次数掩盖问题；本轮重试对象只能是同一个 `rename(staged, target)` 操作。
- 不承诺 Node 或 Windows 官方文档没有承诺的“断电持久化”或“跨进程严格线性化”；本轮只证明 Surdet 不再主动进行可能撕裂目标内容的 byte-copy fallback。
- 不运行概率性 kill、大文件循环、断电模拟、真实项目破坏或高次数压力实验。
- 所有动态 fixture、JSON reporter 输出与日志必须位于本轮新建的系统临时目录；不得写入仓库。
- 原始 Fresh Gate 证据、R1/R2 artifact、失败 artifact 和既有未跟踪治理文件均不得删除、覆盖、暂存或提交。
- 质量优先；在质量不受影响时，验证成本最小化。只允许一次正式 RED、一次相应 GREEN、聚焦测试、CLI 全套、CLI typecheck/build，以及所有聚焦门通过后的唯一一次 `verify:all`。
- 不 push；完成普通本地提交后停止在 `WAITING_FOR_INDEPENDENT_FINAL_REVIEW`。

---

## 一、阶段归属与为什么现在做

Pre-Wave 4 Reliability Fresh Gate 已确认：

```text
findingId = N7-WINDOWS-REPLACEMENT
platform = win32
current fallback = rename(staged,target) -> EPERM/EEXIST -> copyFile(staged,target) -> rm(staged)
official copyFile contract = overwrite by default; atomicity not guaranteed
classification = N7_SOURCE_CONTRACT_CONFIRMED
```

R1 已修复模拟控制流身份；R2 已修复 replacement 后的 commit point 与 cleanup 合同并完成 push。Agent Port 未来会把外部电脑端 Agent 的类型化操作落盘到真实项目，因此 Node storage 不能在 Windows 锁冲突时退化为可能暴露部分新内容的覆盖式 copy。

本机在 2026-08-21 的隔离探针还确认了两个关键事实：

```text
platform = win32
node = v24.15.0
unlocked rename(staged, existingTarget) = success
locked target + rename(staged, target) = EPERM
locked target + current NodeProjectStorage fallback = resolves and overwrites target through copyFile
```

因此正常 Windows 更新不依赖 copy fallback；R3 的最小长期方案是保留 rename，针对真实锁冲突做有限 retry，仍失败时保留旧目标并 fail-loud。

## 二、官方原语与设计裁决

执行 AI 必须读取并在交付报告中链接以下官方文档：

- Node `fsPromises.copyFile()`：<https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode>
- Node `fsPromises.rename()`：<https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath>
- Microsoft `ReplaceFileW()`：<https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew>

仅允许作出以下陈述：

1. Node 明确说明 `copyFile` 默认覆盖现有目标，且不保证 copy 操作原子性。
2. Node 的 public JS API 提供 `rename`，但本任务书不把官方未明确承诺的断电/跨进程属性扩大成 Surdet 保证。
3. Windows 原生 `ReplaceFileW` 是专门的 replace API，但 Node public API 没有直接暴露它；R3 不因此引入 native bridge。
4. 本机真实探针表明同目录 unlocked rename 可直接覆盖现有目标，锁定目标时得到 `EPERM` 且 rename 本身未改变旧目标或 staged 文件。

### 设计选择

采用：

```text
same-directory staged file
  -> rename(staged, target)
  -> on win32 + EPERM/EACCES/EBUSY only:
       bounded delays [10, 20, 40, 80, 160, 320, 640] ms
       retry the same rename
  -> success: target is the staged file; commitChange performs SHA-256 readback
  -> budget exhausted/non-transient error:
       throw
       do not copy
       do not delete target
       do not delete staged inside replacement helper
```

不采用：

- `copyFile` fallback：官方无原子保证，正是 finding。
- `target → backup → staged → target`：制造 target-missing 窗口与额外恢复状态。
- `write-file-atomic` / `atomically`：当前事务已经拥有 staged 文件、journal、SHA-256 与 recovery；再次引入一套 temp writer 会复制职责，且不能改变 Node rename 的平台原语边界。
- native `ReplaceFileW` bridge：增加 native 构建、分发、签名与平台维护面，不符合当前最小需求。
- 无限或分钟级 retry：会让外部 Agent 无法快速获得结构化失败，不符合 fail-loud。

### 长期不变量

```text
R3-I1  NodeProjectStorage replacement 不对现有 target 执行 byte-copy overwrite。
R3-I2  unlocked 正常路径只需要一次 rename，不产生 delay。
R3-I3  win32 暂时性锁错误只重试同一个 rename，且总等待预算固定为 1270 ms。
R3-I4  非 win32、EEXIST、ENOENT、EIO 等非白名单错误不重试，立即抛出。
R3-I5  retry 预算耗尽时 replacement helper 不删除 target 或 staged。
R3-I6  locked-target 真实 Windows 路径失败后 target 仍为完整旧内容，staged 仍为完整新内容。
R3-I7  锁释放后使用同一 staged identity 重试可成功，target 为完整新内容，staged 被 rename 消耗。
R3-I8  commitChange 的最终 SHA-256 readback、journal 与 R2 commit point 顺序保持原样。
R3-I9  R3 不宣称解决进程崩溃残留扫描、跨进程并发写、目录 fsync 或 repository post-commit 持久化失败。
```

---

## 三、文件结构与职责

### 新增 `packages/cli/src/authoring/node-file-replacement.ts`

唯一职责：执行 rename-only replacement 与 Windows 有界 retry。

不得读取项目、计算 SHA、处理 journal、删除 staged、删除 target、创建 backup 或解析相对路径。

### 修改 `packages/cli/src/authoring/node-project-storage.ts`

继续负责：

- project root / parent / symlink 边界；
- staged identity 校验；
- 调用 rename helper；
- 其他现有 Node storage 能力。

删除 `replaceFromStage()` 中的 `copyFile` fallback，不改变公开方法签名。

### 新增 `packages/cli/test/node-file-replacement.test.ts`

使用注入式 rename/delay 验证：

- 首次成功；
- win32 短暂失败后成功；
- retry 耗尽；
- 非 Windows 不重试；
- 非白名单错误不重试；
- `EEXIST` 不重试。

### 修改 `packages/cli/test/node-project-storage.test.ts`

新增真实 Windows 锁文件回归：

- 锁定现有 target；
- 当前实现 RED：错误地 resolve 并通过 copy 覆盖；
- 修复后 GREEN：reject，target OLD，staged NEW；
- 释放锁后同一 staged identity rename 成功。

### 新增交付报告

`docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md`

只记录本轮真实证据；不得把 retry-only 方案描述为 Windows native atomic replacement 或 crash durability。

---

## 四、验证预算与 artifact 规则

### 本轮 artifact 根目录

Task 0 创建一次：

```powershell
$r3Root = Join-Path ([System.IO.Path]::GetTempPath()) ("surdet-r3-windows-replacement-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $r3Root | Out-Null
$r3Root
```

后续所有命令复用同一绝对路径。不得使用仓库内 `tmp`、`artifacts`、截图或 `.log`。

### 允许的动态运行

```text
正式 RED：1 次
对应 GREEN：1 次
helper + storage 聚焦：1 次
CLI 全套：1 次
CLI typecheck：1 次
CLI build：1 次
verify:all：聚焦全部通过后最多 1 次
```

若命令因测试自身语法、路径或 reporter 参数失败，只允许修正设施一次并明确标记 `HARNESS_CORRECTION`；不得把 harness failure 写成业务 RED/GREEN。

### 禁止运行

```text
Electron matrix
FORMAL / DIAGNOSTIC authoring aggregate
性能资格化
pack / deploy / release
大文件循环或 kill 测试
真实 Starter/Zero 项目写入
```

---

## Task 0：权威文件、真实基线与平台预检

**Files:**

- Read: `AGENTS.md`
- Read: `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`
- Read: `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`
- Read: `docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md`
- Read: `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md`
- Read: `docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md`
- Read: `docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md`
- Read: `docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md`
- Read: `packages/cli/src/authoring/node-project-storage.ts`
- Read: `packages/cli/test/node-project-storage.test.ts`
- Read: `packages/authoring/src/change-session.ts:209-321`

**Interfaces:**

- Consumes: pushed R1/R2 baseline、Fresh Gate N7 source contract、当前 Node/Windows 环境。
- Produces: `R3_INITIAL_HEAD`、远端关系、工作树所有权、平台身份、artifact root 与停止条件。

- [ ] **Step 1：按固定顺序完整读取权威文件**

不得只读标题、摘要或交接消息。记录实际读取路径和当前权威性；旧报告中的 `NOT_PUSHED` 是历史状态，不得覆盖当前 Git 实测。

- [ ] **Step 2：读取真实 Git 基线**

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
git log --oneline -8
```

预期执行起点：`main`、tracked worktree clean、staging empty。既有未跟踪 `AGENTS.md`、handoff、长期台账、受保护文件、`.dsh`、`.learnings` 必须登记为既有状态并保持不动。

若出现未知 tracked 修改或暂存内容，立即停止：

```text
R3_BLOCKED_BY_PREEXISTING_TRACKED_CHANGES
```

- [ ] **Step 3：确认真实平台和 Node**

```powershell
node -p "JSON.stringify({platform:process.platform,node:process.version,arch:process.arch})"
```

本任务的真实锁路径要求 `platform=win32`。若不是 Windows，不得伪造或只靠 mock 宣称 R3 完成，停止为：

```text
R3_BLOCKED_NON_WINDOWS_FOR_REAL_LOCK_CONTRACT
```

- [ ] **Step 4：创建唯一 artifact root**

执行本节“本轮 artifact 根目录”命令并记录绝对路径。创建后枚举目录，确认初始为空。

- [ ] **Step 5：记录官方合同与当前源码身份**

```powershell
Get-Item -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts' | Select-Object FullName,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts'
Select-String -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts' -Pattern 'fs.rename','fs.copyFile','EEXIST','EPERM' -Context 2,2
```

Ledger 必须写：

```text
R3_TASK_0 = COMPLETED
N7_SOURCE_CONTRACT = CONFIRMED_FROM_FRESH_GATE_AND_CURRENT_SOURCE
R3_IMPLEMENTATION = NOT_STARTED
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
```

---

## Task 1：建立真实 Windows locked-target 永久 RED

**Files:**

- Modify: `packages/cli/test/node-project-storage.test.ts`
- Artifact: `$r3Root\r3-locked-target-red.json`
- Artifact: `$r3Root\r3-locked-target-red-summary.txt`

**Interfaces:**

- Consumes: 现有 `NodeProjectStorage.stageText()` / `replaceFromStage()`。
- Produces: 一个会在当前 copy fallback 上失败、在 rename-only fail-loud 合同上通过的真实 Windows 回归。

- [ ] **Step 1：在现有 test 文件末尾新增永久测试**

在现有 `describe('NodeProjectStorage safe parent creation', ...)` 内增加：

```ts
  it.runIf(process.platform === 'win32')(
    'keeps complete old and staged bytes when a locked target blocks replacement',
    { timeout: 10_000 },
    async () => {
      const root = createProjectRoot('surdet-node-storage-locked-replace-');
      const target = path.join(root, 'game.config.json');
      const oldText = fs.readFileSync(target, 'utf8');
      const newText = '{"entryScene":"locked_probe","variables":{}}';
      let locked: fs.promises.FileHandle | undefined;

      try {
        const storage = await NodeProjectStorage.open(root);
        const staged = await storage.stageText('game.config.json', newText, 'chg_locked_replace');
        locked = await fs.promises.open(target, 'r+');

        await expect(storage.replaceFromStage('game.config.json', staged.stagedIdentity))
          .rejects.toMatchObject({ code: 'EPERM' });

        expect(fs.readFileSync(target, 'utf8')).toBe(oldText);
        expect(fs.readFileSync(staged.stagedIdentity, 'utf8')).toBe(newText);

        await locked.close();
        locked = undefined;

        await storage.replaceFromStage('game.config.json', staged.stagedIdentity);
        expect(fs.readFileSync(target, 'utf8')).toBe(newText);
        expect(fs.existsSync(staged.stagedIdentity)).toBe(false);
      } finally {
        await locked?.close().catch(() => undefined);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
```

- [ ] **Step 2：确认 RED 前生产文件未变化**

```powershell
git diff --quiet -- packages/cli/src/authoring/node-project-storage.ts
$LASTEXITCODE
```

Expected：`0`。

- [ ] **Step 3：只运行一次正式 RED**

```powershell
npm run test -w @surdet/cli -- node-project-storage.test.ts -t "keeps complete old and staged bytes when a locked target blocks replacement" --reporter=json --outputFile="$r3Root\r3-locked-target-red.json"
$redExit = $LASTEXITCODE
"exit=$redExit" | Set-Content -LiteralPath "$r3Root\r3-locked-target-red-summary.txt" -Encoding utf8
$redExit
```

Expected：exit `1`。第一个业务失败必须证明当前实现 resolve 或 target 已变为新内容；不能是 import、语法、fixture、timeout 或 reporter failure。

有效 RED 分类：

```text
R3_RED = LOCKED_TARGET_COPY_FALLBACK_REPRODUCED
expected = reject + target OLD + staged NEW
actual = resolved and/or target NEW through copy fallback
```

若 locked rename 在当前平台没有产生 `EPERM`，保留 artifact 并停止，不得改成 mock 冒充真实路径：

```text
R3_REAL_LOCK_RED_NOT_REPRODUCED
```

- [ ] **Step 4：回读 RED artifact**

```powershell
Get-Item -LiteralPath "$r3Root\r3-locked-target-red.json","$r3Root\r3-locked-target-red-summary.txt" | Select-Object FullName,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath "$r3Root\r3-locked-target-red.json","$r3Root\r3-locked-target-red-summary.txt"
```

在 Ledger 记录第一个失败断言、exit、bytes、SHA-256。不得重跑或覆盖。

---

## Task 2：新增 rename-only helper 与确定性合同测试

**Files:**

- Create: `packages/cli/src/authoring/node-file-replacement.ts`
- Create: `packages/cli/test/node-file-replacement.test.ts`

**Interfaces:**

- Consumes: absolute same-directory `staged` / `target` paths already validated by `NodeProjectStorage`。
- Produces: `replaceFileByRename(staged, target, runtime?) => Promise<void>`。

- [ ] **Step 1：先创建 helper 合同测试**

创建 `packages/cli/test/node-file-replacement.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  WINDOWS_RENAME_RETRY_DELAYS_MS,
  replaceFileByRename,
  type RenameReplacementRuntime,
} from '../src/authoring/node-file-replacement.js';

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function runtime(
  rename: RenameReplacementRuntime['rename'],
  options: {
    platform?: NodeJS.Platform;
    retryDelaysMs?: readonly number[];
  } = {},
): { value: RenameReplacementRuntime; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    value: {
      platform: options.platform ?? 'win32',
      rename,
      retryDelaysMs: options.retryDelaysMs ?? WINDOWS_RENAME_RETRY_DELAYS_MS,
      delay: async (milliseconds) => { delays.push(milliseconds); },
    },
  };
}

describe('rename-only file replacement', () => {
  it('uses one rename and no delay on the normal path', async () => {
    const calls: string[] = [];
    const injected = runtime(async (staged, target) => { calls.push(`${staged}->${target}`); });

    await replaceFileByRename('staged.tmp', 'target.gal', injected.value);

    expect(calls).toEqual(['staged.tmp->target.gal']);
    expect(injected.delays).toEqual([]);
  });

  it('retries transient Windows rename errors with the fixed bounded schedule', async () => {
    let attempts = 0;
    const injected = runtime(async () => {
      attempts += 1;
      if (attempts <= 2) throw errno('EPERM');
    });

    await replaceFileByRename('staged.tmp', 'target.gal', injected.value);

    expect(attempts).toBe(3);
    expect(injected.delays).toEqual([10, 20]);
  });

  it('throws after the Windows retry budget without adding another mutation path', async () => {
    const failure = errno('EPERM');
    let attempts = 0;
    const injected = runtime(async () => { attempts += 1; throw failure; }, { retryDelaysMs: [1, 2] });

    await expect(replaceFileByRename('staged.tmp', 'target.gal', injected.value)).rejects.toBe(failure);

    expect(attempts).toBe(3);
    expect(injected.delays).toEqual([1, 2]);
  });

  it.each(['EIO', 'ENOENT', 'EEXIST'])(
    'does not retry non-transient %s errors',
    async (code) => {
      let attempts = 0;
      const failure = errno(code);
      const injected = runtime(async () => { attempts += 1; throw failure; });

      await expect(replaceFileByRename('staged.tmp', 'target.gal', injected.value)).rejects.toBe(failure);
      expect(attempts).toBe(1);
      expect(injected.delays).toEqual([]);
    },
  );

  it('does not retry EPERM outside Windows', async () => {
    let attempts = 0;
    const failure = errno('EPERM');
    const injected = runtime(async () => { attempts += 1; throw failure; }, { platform: 'linux' });

    await expect(replaceFileByRename('staged.tmp', 'target.gal', injected.value)).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(injected.delays).toEqual([]);
  });
});
```

该测试通过注入接口证明 helper 只有 rename/delay 两种能力；不要向 runtime 增加 `copyFile`、`rm` 或 target write。

- [ ] **Step 2：实现最小 helper**

创建 `packages/cli/src/authoring/node-file-replacement.ts`：

```ts
import * as fs from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

export const WINDOWS_RENAME_RETRY_DELAYS_MS = Object.freeze([
  10,
  20,
  40,
  80,
  160,
  320,
  640,
] as const);

export interface RenameReplacementRuntime {
  readonly platform: NodeJS.Platform;
  readonly rename: (staged: string, target: string) => Promise<void>;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly retryDelaysMs: readonly number[];
}

const defaultRuntime: RenameReplacementRuntime = {
  platform: process.platform,
  rename: (staged, target) => fs.rename(staged, target),
  delay: async (milliseconds) => { await wait(milliseconds); },
  retryDelaysMs: WINDOWS_RENAME_RETRY_DELAYS_MS,
};

function isTransientWindowsRenameError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM';
}

export async function replaceFileByRename(
  staged: string,
  target: string,
  runtime: RenameReplacementRuntime = defaultRuntime,
): Promise<void> {
  let retryIndex = 0;
  for (;;) {
    try {
      await runtime.rename(staged, target);
      return;
    } catch (error) {
      const delayMs = runtime.retryDelaysMs[retryIndex];
      if (runtime.platform !== 'win32' || !isTransientWindowsRenameError(error) || delayMs === undefined) {
        throw error;
      }
      retryIndex += 1;
      await runtime.delay(delayMs);
    }
  }
}
```

不得导出 `defaultRuntime` 或 `isTransientWindowsRenameError`；它们不是调用方合同。

- [ ] **Step 3：运行 helper 聚焦测试作为内部 GREEN 候选**

```powershell
npm run test -w @surdet/cli -- node-file-replacement.test.ts --reporter=verbose
```

Expected：全部通过。此命令不是 Task 1 的真实 Windows GREEN，不能替代 Task 3。

---

## Task 3：接入 NodeProjectStorage 并取得真实 Windows GREEN

**Files:**

- Modify: `packages/cli/src/authoring/node-project-storage.ts:1-3,216-227`
- Test: `packages/cli/test/node-project-storage.test.ts`
- Artifact: `$r3Root\r3-locked-target-green.json`
- Artifact: `$r3Root\r3-locked-target-green-summary.txt`

**Interfaces:**

- Consumes: `replaceFileByRename(staged, target)`。
- Produces: 保持现有 `ProjectWriteStorage.replaceFromStage(path, stagedIdentity): Promise<void>` 签名。

- [ ] **Step 1：导入 helper**

在 `node-project-storage.ts` Node imports 后增加：

```ts
import { replaceFileByRename } from './node-file-replacement.js';
```

- [ ] **Step 2：替换危险 fallback**

把现有 `replaceFromStage()` 精确改为：

```ts
  async replaceFromStage(relativePath: string, stagedIdentity: string): Promise<void> {
    const target = await this.assertSafeTarget(relativePath, true);
    const staged = await this.assertSafeStage(stagedIdentity);
    await replaceFileByRename(staged, target);
  }
```

修改后 `node-project-storage.ts` 不得再出现：

```text
fs.copyFile(staged, target)
EEXIST fallback
EPERM copy fallback
```

其他 `fs.copyFile` 使用不属于本轮，不要顺手修改。

- [ ] **Step 3：运行一次对应真实 Windows GREEN**

```powershell
npm run test -w @surdet/cli -- node-project-storage.test.ts -t "keeps complete old and staged bytes when a locked target blocks replacement" --reporter=json --outputFile="$r3Root\r3-locked-target-green.json"
$greenExit = $LASTEXITCODE
"exit=$greenExit" | Set-Content -LiteralPath "$r3Root\r3-locked-target-green-summary.txt" -Encoding utf8
$greenExit
```

Expected：exit `0`，`1 passed`，其他测试可显示 pending/skipped。

GREEN 必须同时证明：

```text
locked call rejected with EPERM
target bytes remained exact OLD
staged bytes remained exact NEW
unlock + same staged identity succeeded
target bytes became exact NEW
staged path disappeared after successful rename
```

- [ ] **Step 4：回读 GREEN artifact 且保留 RED**

```powershell
Get-Item -LiteralPath "$r3Root\r3-locked-target-red.json","$r3Root\r3-locked-target-green.json","$r3Root\r3-locked-target-green-summary.txt" | Select-Object FullName,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath "$r3Root\r3-locked-target-red.json","$r3Root\r3-locked-target-green.json","$r3Root\r3-locked-target-green-summary.txt"
```

若 GREEN 失败，不得循环重跑。记录第一个失败节点，停止在：

```text
R3_IMPLEMENTED_BUT_REAL_WINDOWS_GREEN_FAILED
WAITING_FOR_MANAGER_REVIEW
```

---

## Task 4：聚焦验证、CLI 门禁与唯一 verify:all

**Files:**

- Verify only: R3 白名单文件
- Artifacts: `$r3Root\r3-focused.txt`、`r3-cli-full.txt`、`r3-cli-typecheck.txt`、`r3-cli-build.txt`、`r3-verify-all.txt`

**Interfaces:**

- Consumes: Task 3 已通过的真实 Windows GREEN。
- Produces: 与 C 级文件数据风险匹配、但不扩张到 Electron/性能的验证证据。

- [ ] **Step 1：静态范围预检**

```powershell
git diff --name-status
git diff --check
Select-String -LiteralPath 'packages/cli/src/authoring/node-project-storage.ts' -Pattern 'copyFile\(staged, target\)','replaceFileByRename' -AllMatches
```

Expected：危险 pattern `copyFile(staged,target)` 为 0；helper import/call 存在。

- [ ] **Step 2：运行 R3 两个文件聚焦测试**

```powershell
npm run test -w @surdet/cli -- node-file-replacement.test.ts node-project-storage.test.ts --reporter=verbose 2>&1 | Tee-Object -FilePath "$r3Root\r3-focused.txt"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected：全部测试通过；Windows locked-target 测试不是 skipped。

- [ ] **Step 3：运行 CLI 全套**

```powershell
npm run test -w @surdet/cli 2>&1 | Tee-Object -FilePath "$r3Root\r3-cli-full.txt"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected：exit `0`。

- [ ] **Step 4：运行 CLI typecheck**

```powershell
npm run typecheck -w @surdet/cli 2>&1 | Tee-Object -FilePath "$r3Root\r3-cli-typecheck.txt"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected：exit `0`。

- [ ] **Step 5：运行 CLI build**

```powershell
npm run build -w @surdet/cli 2>&1 | Tee-Object -FilePath "$r3Root\r3-cli-build.txt"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Expected：exit `0`。

- [ ] **Step 6：只运行一次 verify:all**

只有 Steps 1～5 全绿后才运行：

```powershell
npm run verify:all 2>&1 | Tee-Object -FilePath "$r3Root\r3-verify-all.txt"
$verifyExit = $LASTEXITCODE
$verifyExit
```

Expected：exit `0`。

若 `verify:all` 第一次失败：

- 不重跑；
- 记录最后通过节点和第一个失败节点；
- 区分与 R3 直接相关、历史无关、环境问题；
- 不自动修改范围外文件；
- 停止等待总经理裁决。

- [ ] **Step 7：回读全部 artifact 身份**

```powershell
Get-ChildItem -LiteralPath $r3Root -File | Sort-Object Name | Select-Object FullName,Length,LastWriteTime
Get-ChildItem -LiteralPath $r3Root -File | Sort-Object Name | Get-FileHash -Algorithm SHA256 | Select-Object Path,Hash
```

必须逐项记录磁盘实际 bytes/SHA-256；不得填写预估值。

---

## Task 5：交付报告、Execution Ledger 与自检

**Files:**

- Modify: `docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md`
- Create: `docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md`

**Interfaces:**

- Consumes: RED/GREEN、聚焦门禁、Git diff、官方合同与 artifact 磁盘身份。
- Produces: 可独立复审且不夸大平台保证的 R3 交付报告。

- [ ] **Step 1：追加 Execution Ledger**

Ledger 至少逐项记录：

```text
时间与时区
R3_INITIAL_HEAD
REMOTE_MAIN_AT_START
AHEAD_BEHIND_AT_START
既有未跟踪路径分类
本轮实际修改文件
正式 RED 命令、exit、第一失败断言、artifact bytes/SHA
正式 GREEN 命令、exit、断言、artifact bytes/SHA
聚焦/CLI/typecheck/build/verify:all 命令与结果
官方 Node/Microsoft 合同链接
当前已验证不变量
明确未验证边界
生产提交前 diff 范围
PUSH = NOT_PERFORMED
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
```

- [ ] **Step 2：生成交付报告**

报告首行必须依据事实二选一。

全部通过：

```text
RELIABILITY_R3_WINDOWS_NON_TEARING_REPLACEMENT_VERIFIED — LOCKED_TARGET_RED_REPRODUCED; RENAME_ONLY_GREEN_PASSED; WINDOWS_REAL_PATH_PASSED; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
```

存在失败：

```text
RELIABILITY_R3_WINDOWS_NON_TEARING_REPLACEMENT_INCOMPLETE — <FIRST_FAILED_GATE>; WAITING_FOR_MANAGER_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
```

报告正文必须区分：

### 已验证事实

- 当前旧实现可在 locked-target rename 得到 EPERM 后通过 copy fallback 覆盖目标；
- 新实现不再调用该 copy fallback；
- retry 预算、错误白名单与真实 Windows 失败/解锁后成功结果；
- commitChange 最终 SHA readback 与 R2 生产文件未改。

### 合理工程结论

- 删除 byte-copy fallback 消除了 Surdet 主动造成 partial-copy target 的路径；
- bounded retry 提高短暂 Windows 锁冲突下的成功率，同时保持 fail-loud。

### 尚未验证或不声明

- 不声明断电后目录项一定持久化；
- 不声明跨进程并发写线性化；
- 不声明 Node rename 等价于 `ReplaceFileW` 的全部属性；
- 不声明清理跨进程遗留 stage/backup；本实现不创建 backup；
- 不声明 repository post-commit failure 已解决。

- [ ] **Step 3：检查报告没有夸大词**

```powershell
Select-String -LiteralPath 'docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md' -Pattern '断电安全','绝对原子','ReplaceFileW 已实现','跨进程安全','全部可靠性问题已解决'
```

Expected：无把这些词作为已验证结论的命中。允许在“未验证/未声明”段落中出现，但上下文必须清楚。

- [ ] **Step 4：报告生成后做磁盘回读**

```powershell
$report = 'docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md'
$item = Get-Item -LiteralPath $report
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $report).Hash
"$report`t$($item.Length)`t$hash"
```

把报告身份写入任务书 Ledger 后，不再修改交付报告。若必须修正报告，则重新计算身份，并把旧身份明确标为历史快照。

- [ ] **Step 5：白名单和占位符自检**

```powershell
git diff --name-status
git diff --check
git diff --cached --check
rg -n 'TBD|TODO|待补|稍后填写|PLACEHOLDER' docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md
```

任务书步骤中的“未勾选 checkbox”不是占位符；正文不得遗留未决字段。

---

## Task 6：精确提交、最终回读与停止

**Files:**

- Code evidence commit: R3 生产/测试文件 + 当前任务书
- Docs closure commit: 当前任务书 + R3 交付报告

**Interfaces:**

- Consumes: Task 5 全部身份与验证证据。
- Produces: 两笔普通本地提交和最终独立复审包。

- [ ] **Step 1：提交前确认范围**

允许进入代码证据提交的路径仅为：

```text
packages/cli/src/authoring/node-file-replacement.ts
packages/cli/src/authoring/node-project-storage.ts
packages/cli/test/node-file-replacement.test.ts
packages/cli/test/node-project-storage.test.ts
docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md
```

执行：

```powershell
git status --short
git diff --name-status
git diff --check
```

出现任何其他 tracked 文件立即停止。

- [ ] **Step 2：精确暂存并创建代码证据提交**

```powershell
git add -- 'packages/cli/src/authoring/node-file-replacement.ts'
git add -- 'packages/cli/src/authoring/node-project-storage.ts'
git add -- 'packages/cli/test/node-file-replacement.test.ts'
git add -- 'packages/cli/test/node-project-storage.test.ts'
git add -- 'docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md'
git diff --cached --name-status
git diff --cached --check
git commit -m "fix(cli): remove tearing Windows replacement fallback"
```

禁止 `git add -A`、amend、rebase、squash 或 force 操作。

- [ ] **Step 3：立即读取代码证据 HEAD**

```powershell
git log --oneline -1
git rev-parse HEAD
git show --name-status --format=fuller HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
```

把真实值记录为：

```text
R3_CODE_EVIDENCE_HEAD = <disk-read HEAD>
```

- [ ] **Step 4：用真实代码提交身份完成文档闭合**

只修改当前任务书与交付报告，记录代码提交范围、HEAD、远端关系、验证结果和停止状态。

然后精确暂存：

```powershell
git add -- 'docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md'
git add -- 'docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md'
git diff --cached --name-status
git diff --cached --check
git commit -m "docs(cli): report R3 Windows replacement contract"
```

- [ ] **Step 5：最终磁盘和 Git 回读**

```powershell
git log --oneline -2
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git show --name-status --format=fuller HEAD
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'

Get-Item -LiteralPath `
  'docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md', `
  'docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md' |
  Select-Object FullName,Length,LastWriteTime

Get-FileHash -Algorithm SHA256 -LiteralPath `
  'docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md', `
  'docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md'
```

tracked worktree 必须 clean，staging 必须 empty。原有未跟踪治理/受保护文件继续保留原样。

- [ ] **Step 6：输出独立复审包并停止**

最终回复必须包含：

```text
R3_EXECUTION_RESULT = PASS | NEEDS_REVIEW
R3_LOCKED_TARGET_RED = REPRODUCED
R3_RENAME_ONLY_GREEN = PASS
R3_REAL_WINDOWS_PATH = PASS
R3_FOCUSED_TESTS = <actual>
CLI_FULL_TESTS = <actual>
CLI_TYPECHECK = PASS
CLI_BUILD = PASS
VERIFY_ALL = PASS | <first failure>
R3_CODE_EVIDENCE_HEAD = <sha>
R3_DOCUMENT_CLOSURE_HEAD = <sha>
REMOTE_MAIN = <sha>
AHEAD_BEHIND = <actual>
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
PUSH = NOT_PERFORMED
R3_CLOSED = NO
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

并列出每个 artifact 的绝对路径、bytes、SHA-256。不得使用工具 UI 回执代替磁盘回读。

---

## 五、独立终审合同

终审者只需审查 R3，不重开 R1/R2，也不提前审 R4：

### 必须 PASS

1. 当前 copy fallback 在真实 Windows locked-target 路径形成过有效 RED。
2. helper 没有 copy/delete/backup 能力，正常路径仅一次 rename。
3. retry 只在 win32 + `EACCES|EBUSY|EPERM` 生效。
4. retry schedule 精确为 `[10,20,40,80,160,320,640]`，没有无限等待。
5. retry 耗尽抛出原错误，NodeProjectStorage 没有吞错。
6. locked-target GREEN 同时证明 target OLD、staged NEW；解锁后同一 staged identity 成功。
7. `node-project-storage.ts` 不再包含 `fs.copyFile(staged, target)`。
8. `ProjectWriteStorage`、`commitChange`、journal 与 R2 文件未被修改。
9. 聚焦、CLI 全套、typecheck/build 与唯一 verify:all 结果真实。
10. 提交和 artifact 身份从磁盘回读，失败证据仍保留，未 push。

### 不得因以下内容拒绝 R3

- 没有实现 native `ReplaceFileW`；
- 没有做概率性 crash/kill；
- 没有解决跨进程并发、垃圾扫描或 repository post-commit persistence；
- 没有进入 R4/Wave 4；
- 没有增加外部依赖。

除非发现新的真实生产可靠性缺陷，否则建议终审输出：

```text
INDEPENDENT_FINAL_REVIEW = PASS
R3 = CLOSED_LOCALLY
READY_FOR_OWNER_PUSH_DECISION
```

---

## 六、Execution Ledger

### 2026-08-21 总经理创建任务书

```text
R2_PUSH = COMPLETED
LOCAL_HEAD_AT_TASKBOOK_CREATION = 0c8358acfd7131709c97fd53014f2ffe30a78065
REMOTE_MAIN_AT_TASKBOOK_CREATION = 0c8358acfd7131709c97fd53014f2ffe30a78065
AHEAD_BEHIND_AT_TASKBOOK_CREATION = 0/0
R3_DIRECTION = RENAME_ONLY_BOUNDED_WINDOWS_RETRY
R3_REAL_UNLOCKED_RENAME_PROBE = PASSED
R3_REAL_LOCKED_RENAME_PROBE = EPERM_WITH_OLD_AND_STAGED_BYTES_PRESERVED
R3_CURRENT_STORAGE_LOCK_PROBE = COPY_FALLBACK_OVERWROTE_TARGET
NEW_DEPENDENCY = NO
R3_IMPLEMENTATION = AUTHORIZED_BY_TASKBOOK_ONLY
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH_AFTER_R3 = NOT_AUTHORIZED
```

执行 AI 从 Task 0 开始追加记录；不得改写本条创建事实。

### 2026-08-21 00:27:28 +08:00 Task 0 执行基线

```text
R3_TASK_0 = COMPLETED
EXECUTION_AUTHORIZATION = OWNER_APPROVED_R3_BY_CURRENT_REQUEST
BRANCH = main
R3_INITIAL_HEAD = 0c8358acfd7131709c97fd53014f2ffe30a78065
R3_INITIAL_PARENT = 7300659ed25c52818b4a0dd47e977a8028d892ea
REMOTE_MAIN_AT_START = 0c8358acfd7131709c97fd53014f2ffe30a78065
RAW_REV_LIST_SURDET_MAIN_THREE_DOTS_HEAD_AT_START = 0 0
AHEAD_BEHIND_AT_START = 0/0
TRACKED_WORKTREE_AT_START = CLEAN
STAGING_AREA_AT_START = EMPTY
TRACKED_LOGS_AT_START = NONE
PLATFORM = win32
NODE = v24.15.0
ARCH = x64
R3_ROOT = <local-path>
R3_ROOT_INITIAL_ENTRY_COUNT = 0
N7_SOURCE_CONTRACT = CONFIRMED_FROM_FRESH_GATE_AND_CURRENT_SOURCE
R3_IMPLEMENTATION = NOT_STARTED
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_AUTHORIZED
```

Task 0 按任务书顺序完整读取了 `AGENTS.md`、Fresh Gate 任务书/报告、R1 任务书/报告、R2 任务书/报告、R3 任务书、当前 `node-project-storage.ts`、当前 `node-project-storage.test.ts` 以及 `change-session.ts:209-321`。旧报告中的历史远端/未 push 状态未覆盖本次 Git 实测；本次执行起点为 `main`、tracked clean、staging empty、远端同 HEAD。

本轮开始时既有未跟踪路径原样登记：`.dsh/`、`.learnings/`、`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两个受保护 art brief、五个 handoff、`docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`，以及本 R3 任务书本身。除本任务书外，本轮不整理、暂存、删除或提交这些路径。

权威读取身份（从磁盘回读）：

| 文件 | lines | bytes | SHA-256 |
|---|---:|---:|---|
| `AGENTS.md` | 120 | 7808 | `4184285B9BD47B6AD61C34A181CA99BFEEDD7257896815461BE4B46E8137AEEB` |
| `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md` | 1268 | 54483 | `045E73D27D862CCF16607EFD64A09E0B485409D59829EA8A25D1EFD6ABD9D107` |
| `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md` | 218 | 10705 | `3EF6A354F14BDCC5FD7887D3EAEEC6513D2B9199EFF35920B30646056AA27C89` |
| `docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md` | 1166 | 48931 | `255EAC30C2FF0F73689EFC22898BE6A1D58B15CC3C70D324FE2CF23227051196` |
| `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md` | 209 | 10674 | `8E2EE2248B3CA2533CE855108F8343DDF56310A07872379C0D4F938EB5B6D785` |
| `docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md` | 1185 | 50396 | `A2CD3E767ED32DAB191D99C250996B6713276CEDEFF594547E7F729747E262EB` |
| `docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md` | 270 | 12656 | `2E645A352F939FE5A35E6A568DFBF148F160350995018B7126028FC05ADFBD0E` |
| `docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md` | 1035 | 37882 | `CC4ECA722A58A04AA41040FFA5BC2A2ABF07E658C59BB4DFC934DA249B4D9712` |
| `packages/cli/src/authoring/node-project-storage.ts` | 344 | 13865 | `615814F547A28DC478F628C31B27FA1B714589B58E4FCAEE01AD924FE90C7CF8` |
| `packages/cli/test/node-project-storage.test.ts` | 226 | 9928 | `BD48F6DF261AF222C36322631D7B79241B3C4B0007888F23C7C7319C74F7CC96` |
| `packages/authoring/src/change-session.ts` | 325 | 12272 | `E8C6870C5713D93F223E0E0646B3DB2C4267213307EAA1F632E46E409451FB2E` |

当前源码证据：`node-project-storage.ts:220` 调用 `fs.rename(staged, target)`；`node-project-storage.ts:223` 对 `EEXIST`/`EPERM` 进入 fallback；`node-project-storage.ts:224` 调用 `fs.copyFile(staged, target)`，随后删除 staged。Task 0 结束时 `git diff --quiet -- packages/cli/src/authoring/node-project-storage.ts` 等价生产范围检查为无修改；正式 RED 尚未运行，R3 实现尚未开始。

### 2026-08-21 00:28:56 +08:00 Task 1 真实 Windows 永久 RED

```text
R3_TASK_1 = COMPLETED
R3_RED = LOCKED_TARGET_COPY_FALLBACK_REPRODUCED
R3_REAL_LOCK_RED_NOT_REPRODUCED = NO
RED_RUN_COUNT = 1
RED_EXIT = 1
RED_TEST_FILE = packages/cli/test/node-project-storage.test.ts
RED_FIRST_BUSINESS_FAILURE = promise resolved "undefined" instead of rejecting
RED_EXPECTED = replaceFromStage rejects with EPERM; target remains OLD; staged remains NEW
RED_ACTUAL = replaceFromStage resolved through the current copy fallback
RED_ASSERTIONS = 0 passed / 1 failed / 5 skipped
PRODUCTION_DIFF_BEFORE_RED_EXIT = 0
HARNESS_FAILURE = NO
RED_RERUN = NO
```

正式命令：

```text
npm run test -w @surdet/cli -- node-project-storage.test.ts -t "keeps complete old and staged bytes when a locked target blocks replacement" --reporter=json --outputFile=<local-path>
```

RED artifact（从磁盘回读，未覆盖）：

| artifact | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 3140 | `E8DBCFE4B11BBE8B034165F2DE18E6E6F420944EF064188C4F15B9C1C8322E09` |
| `<local-path>` | 8 | `5DAE72A737750057776CC6551D222D7A5B70E71940B313CD2FC9A1ACA1F4A9F4` |

该 RED 来自真实 Windows 锁文件路径；旧实现的 `fs.rename()` 失败后通过 `fs.copyFile(staged, target)` 使调用 resolve，正好违反本轮 expected reject + OLD/NEW 保留合同。Task 1 没有修改生产代码，也没有删除或覆盖失败证据。

### 2026-08-21 00:30:15 +08:00 Task 2 rename-only helper 合同

```text
R3_TASK_2 = COMPLETED
HELPER_PRODUCTION_FILE = packages/cli/src/authoring/node-file-replacement.ts
HELPER_TEST_FILE = packages/cli/test/node-file-replacement.test.ts
HELPER_FOCUSED_COMMAND = npm run test -w @surdet/cli -- node-file-replacement.test.ts --reporter=verbose
HELPER_FOCUSED_EXIT = 0
HELPER_FOCUSED_RESULT = 1 file passed / 7 tests passed
R3_IMPLEMENTATION = HELPER_READY_STORAGE_INTEGRATION_PENDING
```

helper 合同已固定：正常路径一次 `rename` 且无 delay；Windows 仅对 `EACCES`/`EBUSY`/`EPERM` 按 `[10,20,40,80,160,320,640]` ms 有界重试；预算耗尽抛出原错误；非 Windows、`EIO`、`ENOENT`、`EEXIST` 不重试。测试 runtime 只有 `rename`、`delay`、`platform` 和 retry schedule，没有 copy、rm、backup 或 target write 能力。Task 2 尚未接入 `NodeProjectStorage`，未运行真实 GREEN。

### 2026-08-21 00:31:15 +08:00 Task 3 真实 Windows GREEN

```text
R3_TASK_3 = COMPLETED
R3_RENAME_ONLY_GREEN = PASS
R3_REAL_WINDOWS_PATH = PASS
GREEN_RUN_COUNT = 1
GREEN_EXIT = 0
GREEN_ASSERTIONS = 1 passed / 0 failed / 5 skipped
GREEN_LOCKED_CALL = rejected with EPERM
GREEN_LOCKED_TARGET_BYTES = exact OLD
GREEN_LOCKED_STAGED_BYTES = exact NEW
GREEN_UNLOCKED_SAME_STAGED_IDENTITY = succeeded
GREEN_POST_UNLOCK_TARGET_BYTES = exact NEW
GREEN_POST_UNLOCK_STAGED_PATH = disappeared
RED_ARTIFACT_PRESERVED = YES
```

Task 3 静态范围门：`node-project-storage.ts` 中 `copyFile(staged, target)` 匹配数为 `0`，`replaceFileByRename` 匹配数为 `2`，`git diff --check` exit `0`。`replaceFromStage()` 只校验 target/staged 后调用 rename-only helper；没有删除 target、copy fallback 或吞掉错误。

GREEN 命令：

```text
npm run test -w @surdet/cli -- node-project-storage.test.ts -t "keeps complete old and staged bytes when a locked target blocks replacement" --reporter=json --outputFile=<local-path>
```

GREEN artifact（从磁盘回读，RED 保留）：

| artifact | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 3140 | `E8DBCFE4B11BBE8B034165F2DE18E6E6F420944EF064188C4F15B9C1C8322E09` |
| `<local-path>` | 8 | `5DAE72A737750057776CC6551D222D7A5B70E71940B313CD2FC9A1ACA1F4A9F4` |
| `<local-path>` | 2592 | `10F1BA1DAB417FAFE788B3F585083C450B4E525878A9CE08F8B35F13E11FBD3E` |
| `<local-path>` | 8 | `2095D5302E465922147E220C0389F7A923EA0C1509A23097F04B3C220798AEF8` |

### 2026-08-21 00:35:30 +08:00 Task 4 验证门禁

```text
R3_TASK_4 = COMPLETED
R3_STATIC_SCOPE_GATE = PASS
R3_FOCUSED_TESTS = PASS; 2 files / 13 tests
CLI_FULL_TESTS = PASS; 15 files / 137 tests
CLI_TYPECHECK = PASS; exit 0
CLI_BUILD = PASS; exit 0
VERIFY_ALL_RUN_COUNT = 1
VERIFY_ALL = PASS; exit 0; final verify:diff-check PASS
FORBIDDEN_DIRECT_COMMANDS = NOT_RUN
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
```

`verify:all` 节点计数：tools 10/10、renderer boundaries 3/3、renderer legacy 4/4、hygiene 733 paths、Authoring 20/123、CLI 15/137、Core 24/318、Editor 26/172、Host 11/87、Renderer 49/406、Shell 22/195、Starter 4/7、Zero 4/29；starter lint 0 errors/4 warnings；formal zero lint 0 errors/128 warnings；Starter/Zero simulate、Editor/Starter/formal build 和最终 diff-check 均通过。Starter simulate、Electron、性能、pack、deploy、release 未作为独立命令运行；Starter simulate 仅出现在本次任务书允许的唯一 `verify:all` 内置节点中。

Task 4 artifact（均从唯一 R3 根目录回读）：

| artifact | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 61 | `898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E` |
| `<local-path>` | 5118 | `B6359E5A5CD79959B85FB7C62573A3C8FA0483E4FB79D4BFE381B67F205209B1` |
| `<local-path>` | 68 | `AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917` |
| `<local-path>` | 2242 | `E7E76057FBB7AA20F7C8B196C4E06A41FCF2CAFE00199F925BD3D94BA9B5DE72` |
| `<local-path>` | 8 | `2095D5302E465922147E220C0389F7A923EA0C1509A23097F04B3C220798AEF8` |
| `<local-path>` | 2592 | `10F1BA1DAB417FAFE788B3F585083C450B4E525878A9CE08F8B35F13E11FBD3E` |
| `<local-path>` | 8 | `5DAE72A737750057776CC6551D222D7A5B70E71940B313CD2FC9A1ACA1F4A9F4` |
| `<local-path>` | 3140 | `E8DBCFE4B11BBE8B034165F2DE18E6E6F420944EF064188C4F15B9C1C8322E09` |
| `<local-path>` | 56624 | `E3E0F0AEEA8D39E2E6EE7AA1DEE5C2303F2D0FD8027CB59528F10B8F3593040D` |
```

Task 4 没有触碰 R4～R6、Wave 4、长期路线台账或受保护文件；进入 Task 5 前生产/测试修改仍严格限于 R3 白名单。

### 2026-08-21 00:38:54 +08:00 Task 5 报告与 Ledger 自检

```text
R3_TASK_5 = COMPLETED
R3_REPORT = docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md
R3_REPORT_FIRST_LINE = RELIABILITY_R3_WINDOWS_NON_TEARING_REPLACEMENT_VERIFIED — LOCKED_TARGET_RED_REPRODUCED; RENAME_ONLY_GREEN_PASSED; WINDOWS_REAL_PATH_PASSED; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
R3_REPORT_BYTES_AT_TASK_5 = 10845
R3_REPORT_SHA256_AT_TASK_5 = CD37338D8DC675E9996B35A02BAAA8515E1460F7B3D99246F51B36C8F82E4BDF
R3_REPORT_IDENTITY_READBACK = PASS
R3_REPORT_OVERCLAIM_MATCH_COUNT = 0
R3_REPORT_PLACEHOLDER_MATCH_COUNT = 0
R3_CODE_EVIDENCE_HEAD_AT_TASK_5 = NOT_CREATED_YET
PRODUCTION_COMMIT_PRECHECK_SCOPE = R3 whitelist only
PUSH = NOT_AUTHORIZED
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
```

报告记录了当前旧实现 RED、新实现 GREEN、helper retry 合同、CLI 验证、唯一 `verify:all`、所有 artifact 身份、官方合同链接和未声明边界。报告没有把 Node rename 描述为 `ReplaceFileW`、断电安全、绝对原子或跨进程安全。Taskbook 自身的自检命令字符串在 placeholder 搜索中产生唯一自引用命中（本任务书第 837 行），报告正文没有 placeholder 命中。

官方合同已读取并在报告中链接：

```text
https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode
https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath
https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew
```

Task 5 结束时，代码证据提交尚未创建；下一步 Task 6 只允许按 R3 白名单精确暂存并创建代码证据提交，然后立即读取真实 HEAD，再完成 docs-only closure。

### 2026-08-21 00:39:26 +08:00 Task 6 代码提交前检查

```text
R3_TASK_6_PRECOMMIT = READY
CODE_EVIDENCE_FILES = exactly:
  packages/cli/src/authoring/node-file-replacement.ts
  packages/cli/src/authoring/node-project-storage.ts
  packages/cli/test/node-file-replacement.test.ts
  packages/cli/test/node-project-storage.test.ts
  docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md
CODE_EVIDENCE_COMMIT_MESSAGE = fix(cli): remove tearing Windows replacement fallback
DOCS_REPORT_NOT_IN_CODE_COMMIT = YES
AMEND_REBASE_SQUASH = NOT_USED
PUSH = NOT_AUTHORIZED
```

Task 6 Step 2 将只暂存上述五个路径；R3 交付报告保持未暂存，待真实代码证据 HEAD 回读后与任务书一起进行 docs-only closure。

### 2026-08-21 00:41:53 +08:00 Task 6 代码证据提交回读与文档收口准备

```text
R3_TASK_6_CODE_EVIDENCE = COMPLETED
R3_CODE_EVIDENCE_HEAD = 4d3e42468846c15310c244fb7f2660d77f68ca98
R3_CODE_EVIDENCE_PARENT = 0c8358acfd7131709c97fd53014f2ffe30a78065
R3_CODE_EVIDENCE_COMMIT_MESSAGE = fix(cli): remove tearing Windows replacement fallback
R3_CODE_EVIDENCE_SCOPE = EXACT_R3_CODE_WHITELIST_PLUS_TASKBOOK
R3_CODE_EVIDENCE_FILES = exactly:
  packages/cli/src/authoring/node-file-replacement.ts
  packages/cli/src/authoring/node-project-storage.ts
  packages/cli/test/node-file-replacement.test.ts
  packages/cli/test/node-project-storage.test.ts
  docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md
R3_REPORT_IN_CODE_COMMIT = NO
REMOTE_MAIN_AFTER_CODE_EVIDENCE = 0c8358acfd7131709c97fd53014f2ffe30a78065
AHEAD_BEHIND_AFTER_CODE_EVIDENCE = 1/0
R3_IMPLEMENTATION = PASS
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
```

代码证据提交后只修改本任务书与 R3 交付报告以记录真实身份；没有重跑任何测试、typecheck、build 或 `verify:all`。下一步将从磁盘回读报告最终 bytes/SHA-256，再精确暂存这两个文档创建 docs-only closure 提交。

### 2026-08-21 00:41:53 +08:00 Task 6 报告最终身份回读

```text
R3_REPORT_IDENTITY_AT_TASK_5 = HISTORICAL_PRE_CODE_CLOSURE
R3_REPORT_BYTES_AT_TASK_5 = 10845
R3_REPORT_SHA256_AT_TASK_5 = CD37338D8DC675E9996B35A02BAAA8515E1460F7B3D99246F51B36C8F82E4BDF
R3_FINAL_REPORT_PATH = E:\surdet\docs\RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md
R3_FINAL_REPORT_BYTES = 11979
R3_FINAL_REPORT_SHA256 = CE2D4E4BB41C8C9CE8CBE4D4F9012668737FB9A266362A51063CA70F8FA089E3
R3_REPORT_FINAL_IDENTITY_READBACK = PASS
R3_REPORT_MODIFIED_AFTER_FINAL_IDENTITY_READBACK = NO
R3_PRODUCTION_FILES_MODIFIED_AFTER_CODE_COMMIT = NO
R3_TEST_FILES_MODIFIED_AFTER_CODE_COMMIT = NO
TESTS_RERUN_AFTER_CODE_COMMIT = NO
REMOTE_MAIN_BEFORE_DOCS_CLOSURE = 0c8358acfd7131709c97fd53014f2ffe30a78065
AHEAD_BEHIND_BEFORE_DOCS_CLOSURE = 1/0
R3_DOCS_CLOSURE_COMMIT = PENDING
PUSH = NOT_PERFORMED
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

最终报告身份已经从磁盘回读；之后不再修改 R3 交付报告。Task 6 的剩余动作仅是精确暂存本任务书与该报告，创建普通 docs-only closure 提交，并回读提交后的真实 Git 状态。
