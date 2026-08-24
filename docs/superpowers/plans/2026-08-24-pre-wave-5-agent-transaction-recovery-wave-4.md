# Pre-Wave 5 Agent Transaction Recovery Wave 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 若当前环境没有这些 sub-skill，则严格按 Task 0 → Task 11 串行执行；不得省略 RED、停止门、文件白名单或独立复审。

**Goal:** 为 Surdet 建立桌面本地多 Agent 事务管理器，使同机多个 CLI/MCP 进程能够安全共享 change 与项目根，在成功结果不静默丢失的前提下完成跨进程互斥、记录 CAS、commit 串行化和进程重启后的显式恢复。

**Architecture:** `@surdet/authoring` 是记录版本、CAS、journal 与恢复状态机的唯一业务真相；`@surdet/cli` 用 Node 标准库实现 Change Store V2、change/project lease、非撕裂 JSON record 和进程探测；Agent Port/MCP 只机械投影 `change.recovery.inspect/execute` 与会话恢复状态。普通 stage mutation 只持有 change lease，不同 change 可并行；项目快照、commit 和 recovery 使用同一 project lease；commit/recovery 固定按 `change lease → project lease` 取锁。

**Tech Stack:** TypeScript 5.7、Node.js >=20、ESM、`node:fs/promises`、`node:crypto`、`node:child_process`、Vitest 3、Windows 11/NTFS、`@surdet/authoring`、`@surdet/cli`、MCP SDK 2.0.0、Git。

## Global Constraints

- 权威设计规格：`docs/superpowers/specs/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4-design.md`；实现不得改变其 3A 边界。
- Surdet 是面向外部电脑端 Agent 的 AI 友好型 Galgame 引擎；引擎不内嵌模型，MCP 只是共享 authoring 合同的薄适配。
- 本轮只处理同一台电脑、本地文件系统、多个 Node/MCP/CLI 进程；不承诺多机、网络共享盘、分布式共识或硬件断电后的绝对持久化。
- 完整锁/CAS 施工以 Task 1 的真实双进程 RED 为硬前提；若 RED 没有重现成功结果丢失/last-write-wins，则停止在 `RED_NOT_REPRODUCED`，不得理论性施工。
- 不新增 npm dependency，不修改 `package.json`、`package-lock.json` 或 MCP SDK 版本。
- 不引入 native addon、数据库、PowerShell 子进程、Windows service、后台 daemon、CRDT、OT、自动合并或 last-write-wins fallback。
- 新 change 使用 Change Store V2；历史 V1 change 不迁移、不删除、不自动猜测，resume 时 fail-loud 为 `CHANGE_STORE_FORMAT_UNSUPPORTED`。
- 新 V2 change 不再生成 `transaction.json` 或 `working-files.json`；历史文件原样保留。
- 所有固定名称 JSON record 使用同目录临时文件、`FileHandle.sync()`、回读 SHA-256 和现有 rename-only helper；不直接覆盖目标，不复制第二套 Windows replacement。
- change lease 保护同一 change；project lease 保护一致项目快照、commit 与 recovery。commit/recovery 固定按 `change → project` 取锁，禁止反序。
- 不自动恢复、不自动抢异机锁、不自动 commit/apply；`change.recovery.execute` 仅 apply policy 可用，并要求 fresh recoveryToken 与 operationId。
- 不修改 `packages/core/**`、`packages/renderer/**`、`packages/host/**`、`packages/shell/**`、`packages/editor/**` 生产代码、`examples/starter/**`、`examples/zero-after-midnight/**`、`games/**`、存档格式、性能门限、pack/release/deploy。
- 不修改长期路线台账、受保护文件、既有 handoff、`.learnings/`、`.dsh/` 或历史 CLI artifact。
- 动态 fixture、child 日志、RED/GREEN/DIAGNOSTIC/FORMAL artifact 全部写入本轮新建的系统临时目录；不得放入 `packages/cli/e2e/artifacts/`，不得被 Vitest 收集。
- 失败 artifact 不删除、不覆盖、不筛选；报告必须区分业务失败、harness 失败、方法失败与环境失败。
- 质量优先；质量不受影响时节省额度。禁止一修一 FORMAL、概率性无限压力、无界 sleep 或重复全量门禁。
- DIAGNOSTIC 最多 3 次；第 3 次仍失败立即停止。runner 冻结并提交后，FORMAL 只运行 1 次；失败即停，不重跑。
- `verify:all` 正式运行 1 次。仅当其首个失败点由本轮白名单改动直接引起、已有匹配聚焦红灯、修复后聚焦绿灯时，预授权最多 1 次 recovery `verify:all`；其他失败立即停审。
- 不运行 Electron、性能资格化、pack、部署、发行或项目所有者视觉验收；本轮无视觉/声音/手感变化。
- 每一项代码 Task 建立独立本地提交；不得 amend、rebase、squash、reset 或改写历史。
- 未经项目所有者另行明确授权不得 push；本地闭合后停止在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，不得进入 Wave 5。

---

## 给新执行 AI 的最小介绍

Surdet 的核心目标是让外部电脑端 Agent 安全、低上下文地制作 Galgame，而不是在引擎内部安装一个模型。Agent、Editor 和人类共同使用普通 Surdet 项目、同一 `@surdet/authoring` 语义、同一校验/模拟/runtime 证据与同一 commit 合同。

你本轮不是重新设计整个 authoring 系统。现有 `ChangeRecord`、operationId、workingRevision、commit journal、Windows rename-only replacement、Agent Port policy 与 MCP envelope 都要保留并演进。你的工作是补齐同机多进程边界：记录不撕裂、锁内刷新、CAS、项目串行 commit、崩溃后显式恢复和机器可读错误。

不要因为计划很长而扩大范围，也不要为了省事把锁或恢复算法写进 MCP adapter。任何无法由 original/target SHA-256 唯一裁决的状态都必须 fail-loud。

---

## 文件责任图

### 新建文件

- `packages/authoring/src/transaction-recovery.ts`：协议无关的 recovery inspect/execute 纯状态机与类型保护。
- `packages/authoring/test/transaction-recovery.test.ts`：共享恢复矩阵与零副作用合同。
- `packages/cli/src/authoring/node-json-record.ts`：非撕裂 JSON record create/replace/readback。
- `packages/cli/test/node-json-record.test.ts`：写入断点、旧/新完整性、SHA 和临时文件清理。
- `packages/cli/src/authoring/node-local-lease.ts`：change/project lease、heartbeat、ownerToken、stale quarantine。
- `packages/cli/test/node-local-lease.test.ts`：活锁、死锁、异机、损坏 lease、owner-safe release。
- `packages/cli/test/fixtures/transaction-worker.mjs`：真实独立 child process worker，不参与 Vitest 收集。
- `packages/cli/test/multi-process-change-concurrency.test.ts`：真实双进程 RED/GREEN 与 service-level 保留合同。
- `packages/cli/test/agent-transaction-recovery.test.ts`：Node store、journal、STALE resume 和 recovery 纵向集成。
- `packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs`：preflight/diagnostic/formal 唯一聚合 runner。
- `docs/PRE-WAVE-5-AGENT-TRANSACTION-RECOVERY-WAVE-4-DELIVERY-REPORT-2026-08-24.md`：最终交付报告，Task 11 才创建。

### 修改文件

- `packages/authoring/src/contracts.ts`：Change Store V2、recordVersion、CAS、journal/recovery 公共类型。
- `packages/authoring/src/change-session.ts`：所有 record 写入递增 recordVersion 并携带 CAS；commit 使用 Journal V2。
- `packages/authoring/src/capability-contract.ts`：`after-refresh` retry disposition 与需要的 side-effect 描述。
- `packages/authoring/src/capability-registry.ts`：`change.recovery.inspect/execute` 两项定义与严格 schema。
- `packages/authoring/src/error-catalog.ts`：锁、CAS、store/journal/recovery 稳定错误。
- `packages/authoring/src/index.ts`：导出 transaction recovery。
- `packages/authoring/test/change-session.test.ts`：recordVersion/CAS 与 operationId 合同。
- `packages/authoring/test/commit-recovery.test.ts`：Journal V2、commit point 与 record CAS。
- `packages/authoring/test/capability-registry.test.ts`：22 项能力与恢复 schema。
- `packages/authoring/test/error-catalog.test.ts`：新错误完整性。
- `packages/cli/src/authoring/node-change-store.ts`：V2 manifest/record/head/journal、leased handle 与项目定向打开。
- `packages/cli/src/authoring/authoring-service.ts`：change/project lease 接线与 recovery service。
- `packages/cli/src/authoring/authoring-dispatcher.ts`：两项 recovery dispatcher。
- `packages/cli/src/agent-port/session.ts`：STALE resume、availability、describe、invocation failure truthfulness。
- `packages/cli/src/agent-port/server.ts`：session schema 的 record/journal/lease/recovery 字段。
- `packages/cli/src/agent-port/delivery-capsule.ts`：短 change lease 下读取闭合快照；附带 recovery 摘要。
- `packages/cli/test/agent-port-session.test.ts`：STALE/terminal state 与 recovery availability。
- `packages/cli/test/agent-port-tools.test.ts`：MCP schema、文本/structured envelope 与 policy。
- `packages/cli/test/agent-port-output-contract.test.ts`：真实 dispatcher output conformance。
- `packages/cli/test/change-isolation.test.ts`：V2 路径和 V1 fail-loud，删除旧“唯一 V1 继续兼容”断言。
- `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`：每个 Task 只追加一笔紧凑 Execution Ledger。

---

### Task 0: 权威文件、真实基线与隔离证据根

**Files:**
- Read: `AGENTS.md`
- Read: `docs/superpowers/specs/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4-design.md`
- Read: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`
- Read: `docs/superpowers/plans/2026-08-24-pre-wave-5-evidence-trustworthiness-wave-3.md`
- Read: `docs/EVIDENCE-TRUSTWORTHINESS-WAVE-3-DELIVERY-REPORT-2026-08-24.md`
- Read: `packages/authoring/src/contracts.ts`
- Read: `packages/authoring/src/change-session.ts`
- Read: `packages/cli/src/authoring/node-change-store.ts`
- Read: `packages/cli/src/authoring/node-project-storage.ts`
- Read: `packages/cli/src/authoring/node-file-replacement.ts`
- Read: `packages/cli/src/authoring/authoring-service.ts`
- Read: `packages/cli/src/agent-port/session.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: 已批准设计规格、当前 Git 与源码事实。
- Produces: `WAVE4_ROOT`、初始 HEAD/remote/worktree、受保护路径清单、旧实现静态身份和 RED 前置条件。

- [ ] **Step 1: 按固定顺序完整读取权威文件**

不得只读标题、handoff 摘要或聊天报告。读取完成后，在 Ledger 记录每个文件的路径、bytes、SHA-256；不要复制正文。

- [ ] **Step 2: 核对 Git 与工作树**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
git log --oneline -12
```

Expected:

- branch=`main`；
- tracked 工作树 clean，staging empty；
- 只存在已知未跟踪治理/受保护路径与历史 CLI artifacts；
- 若存在未知 tracked 修改、暂存内容、behind>0 或合并/rebase 状态，停止为 `BASELINE_MISMATCH`；
- 不 reset、checkout、clean、stash 或删除任何文件。

- [ ] **Step 3: 创建唯一系统临时证据根**

Run:

```powershell
$wave4Root = Join-Path ([System.IO.Path]::GetTempPath()) ("surdet-agent-transaction-wave4-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $wave4Root | Out-Null
Resolve-Path -LiteralPath $wave4Root
Get-ChildItem -Force -LiteralPath $wave4Root
```

Expected: 目录位于系统 Temp、初始为空、绝不位于 `E:\surdet`。将绝对路径记为 `WAVE4_ROOT`，后续所有日志/artifact 复用该根，不新建第二个正式根。

- [ ] **Step 4: 静态确认旧缺口且不改代码**

Run:

```powershell
rg -n "writeFile\(file|transaction\.json|working-files\.json|async write\(record|readLatestJournal|openOwnedChange|manualRecoveryRequired|invocationTail" packages/authoring/src packages/cli/src
```

Expected: 能定位直接 JSON overwrite、无 CAS 的 `write(record)`、V1 双写、Node-only `readLatestJournal`、非 OPEN resume 阻断和 session 内串行化。若源码已与规格根因不符，停止为 `SOURCE_BASELINE_DRIFT`。

- [ ] **Step 5: 构建 RED 所需的当前 dist**

Run:

```powershell
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
```

Expected: 两条 exit 0。仅刷新 ignored dist；不把 build 当成 Wave 4 通过。

- [ ] **Step 6: 追加 Task 0 Ledger**

Ledger 最多 30 行，必须包含：时间、HEAD/remote/ahead-behind、tracked/staging、WAVE4_ROOT、源码缺口、实际命令与结果、下一停止点。不得修改长期路线台账。

---

### Task 1: 建立真实双进程 last-write-wins RED

**Files:**
- Create: `packages/cli/test/fixtures/transaction-worker.mjs`
- Create: `packages/cli/test/multi-process-change-concurrency.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: 当前 V1 `NodeChangeStore.openByChangeId()` 与 `runOperation()`。
- Produces: 确定性 barrier worker、旧实现业务 RED、失败 artifact；它是 Task 2～4 的施工授权门。

- [ ] **Step 1: 写 child worker**

worker 必须接收以下 JSON 参数：

```js
{
  cliDist,
  authoringDist,
  changeId,
  operationId,
  relativePath,
  marker,
  readyFile,
  releaseFile,
  resultFile
}
```

核心逻辑必须先打开同一旧 record，再发 ready，等待统一 barrier，最后以不同 operationId 写不同 working file：

```js
const opened = await NodeChangeStore.openByChangeId(args.changeId);
if (opened === null) throw new Error(`missing change ${args.changeId}`);
const change = openChange(opened.record, opened.store);
await fs.writeFile(args.readyFile, `${opened.record.workingRevision}\n`, { flag: 'wx' });
while (!(await exists(args.releaseFile))) await delay(10);
try {
  const result = await runOperation(change, { operationId: args.operationId }, (record) => ({
    result: { marker: args.marker },
    workingFiles: { ...record.workingFiles, [args.relativePath]: args.marker },
  }));
  await fs.writeFile(args.resultFile, JSON.stringify({ ok: true, result }), { flag: 'wx' });
} catch (error) {
  await fs.writeFile(args.resultFile, JSON.stringify({
    ok: false,
    code: error?.code ?? error?.name ?? 'UNKNOWN',
    message: String(error?.message ?? error),
  }), { flag: 'wx' });
}
```

worker 不得 import test runner，不得写项目文件，不得使用同一个 AgentPortSession。

- [ ] **Step 2: 写 RED 测试**

测试必须：

1. 在 Temp 创建最小项目与独立 `SURDET_AGENT_DATA_DIR`；
2. 用真实 `AuthoringService.begin()` 创建一个 OPEN change；
3. 启动两个独立 child；
4. 等待两个 readyFile 都存在，再创建 releaseFile；
5. 等待两个 child exit 0；
6. 旧实现中两个 result 都报告 ok，但最终 record 只保留一个 operation/file；
7. 测试断言必须要求两者都保留，因此 RED。

关键断言：

```ts
expect(results.filter((item) => item.ok)).toHaveLength(2);
const final = await NodeChangeStore.openByChangeId(changeId);
expect(Object.keys(final!.record.operations)).toEqual(expect.arrayContaining(['op-a', 'op-b']));
expect(final!.record.workingFiles['content/scenario/worker-a.gal']).toBe('A');
expect(final!.record.workingFiles['content/scenario/worker-b.gal']).toBe('B');
expect(final!.record.workingRevision).toBe(2);
```

- [ ] **Step 3: 运行且仅运行一次正式 RED**

Run:

```powershell
npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts -t "reproduces cross-process last-write-wins" --reporter=json --outputFile="$wave4Root\task1-red.json"
```

Expected: exit 1，业务断言失败；两个 child 都成功，而 final record 缺一个 marker/operation 或 workingRevision 不是 2。若测试未运行、child 未同步、dist/import 失败，分类为 `HARNESS_INVALID`，只允许修 harness 后重做一次 RED；若旧实现业务断言通过，则停止 `RED_NOT_REPRODUCED`。

- [ ] **Step 4: 回读 RED artifact**

记录路径、bytes、SHA-256、首个业务失败、child exit、两个 result、最终 record 身份。保留 artifact，不复制到仓库。

- [ ] **Step 5: 提交 RED harness**

Run:

```powershell
git add -- packages/cli/test/fixtures/transaction-worker.mjs packages/cli/test/multi-process-change-concurrency.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git diff --cached --name-status
git commit -m "test(cli): reproduce cross-process change overwrite"
```

Expected: 仅以上三项；测试提交允许保持业务 RED，但报告必须明确这是有意红灯，不得运行 `verify:all`。

---

### Task 2: Change Store V2、非撕裂 JSON 与记录 CAS

**Files:**
- Create: `packages/cli/src/authoring/node-json-record.ts`
- Create: `packages/cli/test/node-json-record.test.ts`
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/src/change-session.ts`
- Modify: `packages/authoring/test/change-session.test.ts`
- Modify: `packages/cli/src/authoring/node-change-store.ts`
- Modify: `packages/cli/test/change-isolation.test.ts`
- Modify: `packages/cli/test/multi-process-change-concurrency.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: Task 1 RED、现有 `replaceFileByRename()`。
- Produces: `formatVersion: 2`、`recordVersion`、`ChangeWritePrecondition`、V2 manifest/records/head、低层 CAS conflict、`writeJsonRecord()`。

- [ ] **Step 1: 写共享合同红灯**

在 `change-session.test.ts` 增加：

```ts
it('increments recordVersion for content and evidence writes while workingRevision only tracks content', async () => {
  const repo = new InMemoryChangeRepository();
  const change = await beginChange(snapshot, repo);
  expect(change.record).toMatchObject({ formatVersion: 2, recordVersion: 0, workingRevision: 0 });
  await runOperation(change, { operationId: 'op-v2' }, (record) => ({ result: true, workingFiles: record.workingFiles }));
  expect(change.record).toMatchObject({ recordVersion: 1, workingRevision: 1 });
  await recordValidation(change, { evidenceId: 'validation-v2', errors: 0 });
  expect(change.record).toMatchObject({ recordVersion: 2, workingRevision: 1 });
});
```

再增加 stale precondition 测试：第二个基于旧 recordVersion 的 write 抛 `CHANGE_RECORD_CONFLICT`，repo 中版本和内容不变。

- [ ] **Step 2: 定义 V2 与 CAS 类型**

在 `contracts.ts` 精确新增：

```ts
export interface ChangeWritePrecondition {
  expectedRecordVersion: number;
  expectedStatus?: ChangeStatus;
}

export interface ChangeRecord {
  formatVersion: 2;
  recordVersion: number;
  changeId: string;
  projectRootIdentity: string;
  baseRevision: string;
  workingRevision: number;
  status: ChangeStatus;
  baseFiles: Record<string, { sha256: string }>;
  baseContents: Record<string, string>;
  workingFiles: Record<string, string>;
  operations: Record<string, { requestHash: string; result: unknown }>;
  latestValidation?: { workingRevision: number; evidenceId: string; errors: number };
  intent?: ChangeIntentMetadata;
  latestSimulation?: {
    workingRevision: number;
    evidenceId: string;
    status: 'passed' | 'failed' | 'incomplete';
  };
  runtimeTraces?: Array<{
    traceId: string;
    workingRevision: number;
    status: 'passed';
  }>;
  latestDiff?: { workingRevision: number; evidenceId: string };
}

export interface ChangeRepository {
  create(record: ChangeRecord): Promise<void>;
  read(changeId: string): Promise<ChangeRecord | null>;
  write(record: ChangeRecord, precondition: ChangeWritePrecondition): Promise<void>;
  writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void>;
  readEvidence(changeId: string, evidenceId: string): Promise<unknown | null>;
  writeJournal(changeId: string, value: CommitJournal): Promise<void>;
  readLatestJournal(changeId: string): Promise<CommitJournal | null>;
}
```

`beginChange()` 设置 `formatVersion: 2, recordVersion: 0`。所有共享 record mutation 先复制当前 record，设置 `next.recordVersion = current.recordVersion + 1`，再调用：

```ts
await change.repository.write(next, {
  expectedRecordVersion: change.record.recordVersion,
  expectedStatus: change.record.status,
});
```

InMemory repo 必须真实检查 precondition，不得为了旧测试忽略。

- [ ] **Step 3: 写 node-json-record 红灯**

测试注入 `beforeReplace` 失败，断言旧目标完整、新临时文件可清理、没有半截 JSON；成功路径断言 LF、bytes 与 SHA-256。

公共内部接口固定为：

```ts
export interface JsonRecordIdentity {
  path: string;
  bytes: number;
  sha256: string;
}

export async function createJsonRecord(file: string, value: unknown): Promise<JsonRecordIdentity>;
export async function replaceJsonRecord(file: string, value: unknown): Promise<JsonRecordIdentity>;
export async function readJsonRecord<T>(file: string): Promise<{ value: T; identity: JsonRecordIdentity } | null>;
```

实现必须使用同目录随机临时文件、`wx`、`FileHandle.sync()`、回读 SHA、`replaceFileByRename()`；JSON parse 错误转换为 `CHANGE_STORE_CORRUPT`，details 含路径与实际 SHA，不回显文件正文。

- [ ] **Step 4: 把 NodeChangeStore 改为 V2 单一真相**

创建布局：

```text
manifest.json
record-head.json
records/0000000000.json
journals/
evidence/
traces/
invocations/
capsules/
```

`manifest.json` 固定：

```ts
{
  formatVersion: 2,
  changeId,
  projectRootIdentity,
  createdAt
}
```

`record-head.json` 固定：

```ts
{
  formatVersion: 2,
  recordVersion,
  recordSha256
}
```

读取流程必须验证 manifest、head、文件名版本、record.formatVersion、record.recordVersion、record SHA、changeId 和 project identity。不得扫描最大 record 自动晋升 head。

V2 `write()` 先读 head/record、检查 precondition，再 exclusive create `records/<next>.json`，最后 replace head。若 crash 留下未被 head 引用的孤儿 record，普通读取忽略它。

- [ ] **Step 5: 删除新 change 的 V1 双写并调整 legacy 测试**

删除生产代码对新 change 写 `transaction.json`/`working-files.json` 的路径。`change-isolation.test.ts` 改为读取 V2 head/record；原“唯一 legacy ID 继续正常打开”合同改为：

```ts
expect(result.status).toBe(1);
expect(body(result).error.code).toBe('CHANGE_STORE_FORMAT_UNSUPPORTED');
expect(fs.readFileSync(legacyTransaction)).toEqual(beforeBytes);
```

不得自动迁移或删除 V1。

- [ ] **Step 6: 运行聚焦 GREEN**

Run:

```powershell
npm run test -w @surdet/authoring -- change-session.test.ts
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- node-json-record.test.ts change-isolation.test.ts multi-process-change-concurrency.test.ts
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
```

Expected:

- 共享 recordVersion/CAS 绿；
- Node JSON 绿；
- V2 isolation/V1 fail-loud 绿；
- Task 1 低层双 child 现在允许“一方成功、一方 `CHANGE_RECORD_CONFLICT`”，且零静默覆盖；冲突方以相同 operationId 重新打开后重试可成功；
- 原始 RED artifact 保留。

- [ ] **Step 7: 提交 Task 2**

Run:

```powershell
git add -- packages/authoring/src/contracts.ts packages/authoring/src/change-session.ts packages/authoring/test/change-session.test.ts packages/cli/src/authoring/node-json-record.ts packages/cli/test/node-json-record.test.ts packages/cli/src/authoring/node-change-store.ts packages/cli/test/change-isolation.test.ts packages/cli/test/multi-process-change-concurrency.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "feat(authoring): add versioned change record CAS"
```

---

### Task 3: change/project 本地租约与安全接管

**Files:**
- Create: `packages/cli/src/authoring/node-local-lease.ts`
- Create: `packages/cli/test/node-local-lease.test.ts`
- Modify: `packages/cli/src/authoring/node-change-store.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: Task 2 `replaceJsonRecord()`、dataRoot/project identity helper。
- Produces: `NodeLocalLeaseManager`、`LeaseHandle`、leased store handle、稳定 lock errors。

- [ ] **Step 1: 写租约红灯**

测试必须注入 clock、hostname、pid probe 和 heartbeat scheduler，覆盖：

```ts
const first = await manager.acquire({ scope: 'change', resourceId: 'chg-1' });
await expect(manager.acquire({ scope: 'change', resourceId: 'chg-1' }))
  .rejects.toMatchObject({ code: 'CHANGE_BUSY' });
await expect(manager.release({ ...first, ownerToken: 'wrong' }))
  .rejects.toMatchObject({ code: 'CHANGE_BUSY' });
expect(await manager.inspect('change', 'chg-1')).toMatchObject({ state: 'owned' });
```

另写：死 PID + 超时 + 同主机接管成功；活 PID、异机、未超时、损坏 JSON 均不接管；stale 目录被 rename 到 quarantine，证据保留。

- [ ] **Step 2: 实现唯一租约模块**

接口固定为：

```ts
export type LeaseScope = 'change' | 'project';

export interface LeaseHandle {
  scope: LeaseScope;
  resourceId: string;
  ownerToken: string;
  directory: string;
  release(): Promise<void>;
}

export interface LeaseInspection {
  state: 'free' | 'owned' | 'stale-candidate' | 'corrupt' | 'foreign-host';
  scope: LeaseScope;
  resourceId: string;
  holder?: {
    pid: number;
    hostname: string;
    acquiredAt: string;
    heartbeatAt: string;
  };
  retryAfterMs?: number;
  manualRecoveryRequired: boolean;
}

export class NodeLocalLeaseManager {
  acquire(input: { scope: LeaseScope; resourceId: string }): Promise<LeaseHandle>;
  inspect(scope: LeaseScope, resourceId: string): Promise<LeaseInspection>;
  withLease<T>(
    input: { scope: LeaseScope; resourceId: string },
    callback: (lease: LeaseHandle) => Promise<T>,
  ): Promise<T>;
  withProjectLease<T>(projectIdentity: string, callback: (lease: LeaseHandle) => Promise<T>): Promise<T>;
}
```

产品常量固定：

```ts
const HEARTBEAT_INTERVAL_MS = 2_000;
const STALE_AFTER_MS = 15_000;
```

获取使用 `fs.mkdir(lockDir)`；lease 包含 formatVersion/scope/resourceId/ownerToken/pid/hostname/acquiredAt/heartbeatAt。heartbeat 用 `replaceJsonRecord()`；release 再读 ownerToken。不得 `rm(lockDir, recursive)`，除非 ownerToken 匹配且先停止 heartbeat。

- [ ] **Step 3: 实现 stale takeover**

只有下列谓词全部 true 才接管：

```ts
lease.hostname === currentHostname
  && nowMs - Date.parse(lease.heartbeatAt) > 15_000
  && isProcessAlive(lease.pid) === false
```

先将整个旧 lock dir rename 到 `.locks/stale/<timestamp>-<ownerToken>`，再重新 `mkdir` 竞争。异机/损坏 lease 返回结构化人工恢复错误，绝不删除。

- [ ] **Step 4: NodeChangeStore 提供 leased handle**

接口固定为：

```ts
NodeChangeStore.withChangeLease<T>(
  changeId: string,
  callback: (leased: NodeChangeStore) => Promise<T>,
): Promise<T>;
```

leased store 持有 ownerToken；callback 内 `write()`、`writeJournal()`、invocation sequence 不重新取锁。未绑定 lease 的 mutation write 必须 fail-loud，纯 read 保持可用。

- [ ] **Step 5: 运行聚焦测试并提交**

Run:

```powershell
npm run test -w @surdet/cli -- node-local-lease.test.ts node-json-record.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

Expected: 全绿，无真实 15 秒等待；测试时钟来自注入，产品常量未暴露配置。

Commit:

```powershell
git add -- packages/cli/src/authoring/node-local-lease.ts packages/cli/test/node-local-lease.test.ts packages/cli/src/authoring/node-change-store.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "feat(cli): add local change and project leases"
```

---

### Task 4: 在 service 边界完成锁内刷新与同-change 多进程保留

**Files:**
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Modify: `packages/cli/src/agent-port/invocation-ledger.ts`
- Modify: `packages/cli/src/agent-port/session.ts`
- Modify: `packages/cli/test/fixtures/transaction-worker.mjs`
- Modify: `packages/cli/test/multi-process-change-concurrency.test.ts`
- Modify: `packages/cli/test/agent-port-session.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: Task 3 `withChangeLease()`、Task 2 CAS。
- Produces: 每项 change mutation/evidence 在锁内重新 open；真实 service-level 两进程成功结果全部保留；truthful invocation failure。

- [ ] **Step 1: 写 service-level 双进程红灯**

扩展 worker mode=`service-mutation`，在 barrier 后通过真实 `AuthoringService` 调用不同 typed mutation。测试要求两个独立进程都成功，最终 operations、working files、workingRevision 和 invocation 顺序全部保留。

关键断言：

```ts
expect(results).toMatchObject([{ ok: true }, { ok: true }]);
expect(final.record.workingRevision).toBe(2);
expect(final.record.recordVersion).toBeGreaterThanOrEqual(2);
expect(Object.keys(final.record.operations).sort()).toEqual(['op-service-a', 'op-service-b']);
const ordered = [...invocations].sort((left, right) => left.workingRevisionAfter! - right.workingRevisionAfter!);
expect(ordered.map((item) => [item.workingRevisionBefore, item.workingRevisionAfter])).toEqual([[0, 1], [1, 2]]);
expect(ordered.map((item) => item.operationId).sort()).toEqual(['op-service-a', 'op-service-b']);
```

- [ ] **Step 2: 把 open+operation 放入同一 change lease**

在 `AuthoringService` 提取：

```ts
async function withOpenChange<T>(
  changeId: string,
  callback: (context: OpenChangeContext) => Promise<T>,
): Promise<T> {
  const located = await NodeChangeStore.locate(changeId);
  return located.store.withChangeLease(changeId, async (leasedStore) => {
    const record = await leasedStore.read(changeId);
    if (record === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
    return callback(await contextFromRecord(record, leasedStore));
  });
}
```

所有会改变 record、evidence pointer、diff pointer、trace pointer、journal 或 invocation sequence 的 service 调用必须使用它。纯静态 capability describe 不取锁。

- [ ] **Step 3: 修复 invocation truthfulness**

将 `invokeSerial()` 的 before record 读取纳入 try/catch。领域 operation 成功但 invocation 写失败时返回：

```ts
new AuthoringOperationError('INVOCATION_LEDGER_WRITE_FAILED', message, {
  operationMayHaveSucceeded: envelope.ok,
  operationId,
  changeId,
});
```

error catalog 在 Task 8 登记 repair action；当前 Task 测试必须证明使用同一 operationId 重试不会重复 workingRevision，且会产生新的可读 invocation fact。

- [ ] **Step 4: 运行 GREEN**

Run:

```powershell
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-session.test.ts
```

Expected: 低层 stale worker 仍有 CAS conflict；service-level 两进程均成功且结果全保留；同一进程既有 concurrent invocation 测试继续通过。

- [ ] **Step 5: 提交 Task 4**

```powershell
git add -- packages/cli/src/authoring/authoring-service.ts packages/cli/src/agent-port/invocation-ledger.ts packages/cli/src/agent-port/session.ts packages/cli/test/fixtures/transaction-worker.mjs packages/cli/test/multi-process-change-concurrency.test.ts packages/cli/test/agent-port-session.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "fix(authoring): serialize cross-process change mutations"
```

---

### Task 5: project lease、一致快照与 commit 串行化

**Files:**
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Modify: `packages/authoring/src/change-session.ts`
- Modify: `packages/authoring/test/commit-recovery.test.ts`
- Modify: `packages/cli/test/multi-process-change-concurrency.test.ts`
- Modify: `packages/cli/test/agent-port-security.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: NodeLocalLeaseManager project scope、change lease、现有 commitChange/NodeProjectStorage。
- Produces: 真实项目 snapshot/commit 的共同 project lease、固定锁序、锁内 project revision recheck。

- [ ] **Step 1: 写不同 change 双 commit 红灯**

测试准备同一项目的 change A/B，它们都从相同 base 开始并取得新鲜 validation/simulation/runtime evidence。两个 child 同时请求 commit；注入/记录 `replace-start` 与 `replace-end` 事件。

合同：

```ts
expect(maxConcurrentReplacement).toBe(1);
expect(results.filter((item) => item.ok)).toHaveLength(1);
expect(results.filter((item) => !item.ok)[0].code).toBe('PROJECT_CHANGED_SINCE_BEGIN');
expect([recordA.status, recordB.status].sort()).toEqual(['COMMITTED', 'STALE']);
```

失败方不得 replacement、不得覆盖成功方文件、不得被自动合并。

- [ ] **Step 2: project snapshot 入口使用短 project lease**

`project.inspect`、`project.assets`、无 change 的 validate/simulate、`change.begin` snapshot load 通过：

```ts
leaseManager.withProjectLease(projectIdentity, async () => loadSnapshot(storage));
```

持有 project lease 时不得再取得 change lease。对已有 change 的 working snapshot 不读取真实项目，因此只使用 change lease。

- [ ] **Step 3: commit 固定取锁顺序并锁内刷新**

service commit 必须：

```ts
return store.withChangeLease(changeId, async (leasedStore) => {
  const context = await reopenLatestChange(leasedStore, changeId);
  return leaseManager.withProjectLease(context.session.record.projectRootIdentity, async () => {
    const freshProject = await loadSnapshot(context.storage);
    assertBaseStillMatches(context.session.record, freshProject);
    return commitChange(context.session, context.storage);
  });
});
```

不得在 `commitChange()` 内 import Node lease；共享函数只接收已经受保护的 repository/storage。

- [ ] **Step 4: 锁错误零副作用**

真实活 project lease 存在时，第二 commit 返回 `PROJECT_BUSY`，record/journal/project bytes 不变；不得内部长等待。错误 details 含 holder scope、pid、hostname、acquiredAt、heartbeatAt、retryAfterMs，不含 ownerToken。

- [ ] **Step 5: 运行聚焦 GREEN 并提交**

Run:

```powershell
npm run test -w @surdet/authoring -- commit-recovery.test.ts
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-security.test.ts
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
```

Commit:

```powershell
git add -- packages/cli/src/authoring/authoring-service.ts packages/authoring/src/change-session.ts packages/authoring/test/commit-recovery.test.ts packages/cli/test/multi-process-change-concurrency.test.ts packages/cli/test/agent-port-security.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "fix(authoring): serialize project commit boundaries"
```

---

### Task 6: Journal V2 与共享显式恢复状态机

**Files:**
- Create: `packages/authoring/src/transaction-recovery.ts`
- Create: `packages/authoring/test/transaction-recovery.test.ts`
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/src/change-session.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/authoring/test/commit-recovery.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: ChangeRecord V2、ProjectWriteStorage、record CAS、现有 original/target/stagedIdentity。
- Produces: CommitJournal V2、RecoveryInspection、`inspectTransactionRecovery()`、`executeTransactionRecovery()`。

- [ ] **Step 1: 定义共享类型**

在 `contracts.ts` 增加并导出：

```ts
export type CommitJournalStatus = 'STAGING' | 'REPLACING' | 'RECOVERED' | 'RECOVERY_FAILED' | 'COMMITTED';

export interface CommitJournalEntry {
  path: string;
  originalSha256?: string;
  targetSha256: string;
  stagedIdentity: string;
  replaced: boolean;
  restored: boolean;
}

export interface CommitJournal {
  formatVersion: 2;
  journalVersion: number;
  changeId: string;
  recordVersionAtCommitStart: number;
  projectRevisionAtCommitStart: string;
  status: CommitJournalStatus;
  files: CommitJournalEntry[];
}
```

恢复输出严格使用设计规格第 8.2 节的 `RecoveryInspection` 字段和枚举；不要添加自由文本替代 typed states。

```ts
export type RecoveryDisposition =
  | 'NO_ACTION'
  | 'REOPEN_OPEN'
  | 'ROLL_BACK_TO_BASE'
  | 'FINALIZE_COMMITTED'
  | 'MANUAL_RECOVERY_REQUIRED';

export interface RecoveryInspection {
  changeId: string;
  recordState: 'readable' | 'corrupt' | 'unsupported';
  changeStatus?: ChangeStatus;
  journalStatus?: CommitJournalStatus;
  lockState: 'free' | 'owned' | 'stale-candidate' | 'corrupt' | 'foreign-host';
  projectState: 'base' | 'target' | 'mixed-known' | 'ambiguous';
  fileStates: Array<{
    path: string;
    state: 'original' | 'target' | 'absent-expected' | 'unexpected';
    actualSha256?: string;
  }>;
  disposition: RecoveryDisposition;
  recoveryToken?: string;
  manualRecoveryRequired: boolean;
  reasons: string[];
}
```

- [ ] **Step 2: 写恢复矩阵红灯**

测试表驱动至少包含：

```ts
const cases = [
  ['STAGING + project base', 'REOPEN_OPEN'],
  ['REPLACING + all targets known', 'ROLL_BACK_TO_BASE'],
  ['RECOVERY_FAILED + mixed original/target known', 'ROLL_BACK_TO_BASE'],
  ['COMMITTED journal + all target', 'FINALIZE_COMMITTED'],
  ['RECOVERED journal + all base', 'REOPEN_OPEN'],
  ['REPLACING + one unexpected sha', 'MANUAL_RECOVERY_REQUIRED'],
] as const;
```

每个 case 断言 disposition、manualRecoveryRequired、fileStates、recoveryToken。有 unexpected 时 execute 零 storage/repository write。

- [ ] **Step 3: 实现 inspect 纯裁决**

接口：

```ts
export async function inspectTransactionRecovery(input: {
  record: ChangeRecord;
  journal: CommitJournal | null;
  storage: ProjectWriteStorage;
  leaseState: RecoveryInspection['lockState'];
  sha256(value: string): Promise<string>;
}): Promise<RecoveryInspection>;
```

对每个 entry 调用 `exists/readText` 分类 original/target/absent-expected/unexpected；recoveryToken 对规范化 JSON 事实做 SHA-256。该函数不写 repository、journal、stage 或项目。

- [ ] **Step 4: 实现 execute 的唯一安全动作**

接口：

```ts
export async function executeTransactionRecovery(input: {
  change: ChangeSession;
  journal: CommitJournal;
  storage: ProjectWriteStorage;
  inspection: RecoveryInspection;
  recoveryToken: string;
  operationId: string;
}): Promise<{ changeId: string; status: 'OPEN' | 'COMMITTED'; disposition: string }>;
```

执行前重新 inspect，token 不同抛 `RECOVERY_PLAN_STALE`。恢复顺序：

- STAGING：删除合法 stage → journal RECOVERED → CAS record OPEN；
- REPLACING/RECOVERY_FAILED：按 entries 逆序，target 恢复 original 或删除新文件，每步回读 SHA → journal RECOVERED → CAS OPEN；
- COMMITTED：全部 target 后 CAS COMMITTED，不重复 replacement；
- RECOVERED：全部 base 后 CAS OPEN；
- 其他：`RECOVERY_AMBIGUOUS`，零写入。

operationId 进入 record operations，重复相同请求幂等；不同 payload 使用同 id 保持 `OPERATION_ID_CONFLICT`。

- [ ] **Step 5: CommitJournal V2 append-only**

`commitChange()` 不再维护 private journal 类型；每次变化递增 `journalVersion` 并调用公共 repository。journal 文件名为十位零填充版本：`0000000001.json`。`readLatestJournal()` 只接受最大连续版本；缺号/损坏/身份矛盾抛 `JOURNAL_CORRUPT`。

- [ ] **Step 6: 运行 Authoring GREEN 并提交**

Run:

```powershell
npm run test -w @surdet/authoring -- transaction-recovery.test.ts commit-recovery.test.ts change-session.test.ts
npm run test -w @surdet/authoring
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

Commit:

```powershell
git add -- packages/authoring/src/contracts.ts packages/authoring/src/change-session.ts packages/authoring/src/transaction-recovery.ts packages/authoring/src/index.ts packages/authoring/test/transaction-recovery.test.ts packages/authoring/test/commit-recovery.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "feat(authoring): add explicit transaction recovery"
```

---

### Task 7: Node recovery service、崩溃重开与项目身份保护

**Files:**
- Modify: `packages/cli/src/authoring/node-change-store.ts`
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Create: `packages/cli/test/agent-transaction-recovery.test.ts`
- Modify: `packages/cli/test/node-project-storage.test.ts`
- Modify: `packages/cli/test/change-isolation.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: Task 6 recovery state machine、Task 3 leases、Task 2 V2 store。
- Produces: `AuthoringService.inspectRecovery()`、`executeRecovery()`、项目定向 open、真实 restart recovery。

- [ ] **Step 1: 让已绑定项目直接定位 change**

新增：

```ts
NodeChangeStore.openForProject(
  changeId: string,
  projectRootIdentity: string,
  options?: { allowTerminal?: boolean; allowStale?: boolean },
): Promise<OpenChangeResult | null>;
```

它直接计算 `<dataRoot>/<projectHash>/<changeId>`，先读 manifest 再读 head/record；不得先全局扫描。`openByChangeId()` 保留给未知项目的原生 CLI 场景，但扫描时一个无关损坏 record 不得阻断其他候选；目标候选损坏必须结构化报告而非静默跳过。

- [ ] **Step 2: 写真实 restart recovery 集成测试**

测试用新 `AuthoringService` 实例模拟进程重启，覆盖：

1. STAGING journal + base project → inspect REOPEN_OPEN → execute OPEN；
2. REPLACING mixed-known → execute 恢复 base；
3. COMMITTED journal + record OPEN → execute COMMITTED；
4. unexpected project bytes → manualRecoveryRequired、project/record/journal bytes 不变；
5. stale recoveryToken → `RECOVERY_PLAN_STALE`、零写；
6. V1/corrupt manifest/head/record/journal → 对应稳定错误且文件保留。

- [ ] **Step 3: 接线 service inspect/execute**

接口：

```ts
async inspectRecovery(changeId: string): Promise<ServiceResult<RecoveryInspection>>;

async executeRecovery(
  changeId: string,
  input: { operationId: string; recoveryToken: string },
): Promise<ServiceResult<{ changeId: string; status: 'OPEN' | 'COMMITTED'; disposition: string }>>;
```

inspect 按 `change → project` 短暂取锁后读取并释放；execute 使用同顺序持锁到 journal/record 完成。锁内必须重新读取 record/journal/project，不复用 inspect 时对象。

- [ ] **Step 4: 路径和恢复安全**

恢复只调用现有 `NodeProjectStorage` 安全方法；stagedIdentity 必须通过现有 project root、symlink/junction、`.surdet-` 文件检查。任何路径逃逸返回 `PATH_OUTSIDE_PROJECT`/`RECOVERY_AMBIGUOUS`，不继续下一文件。

- [ ] **Step 5: 运行 CLI 聚焦 GREEN 并提交**

Run:

```powershell
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-transaction-recovery.test.ts node-project-storage.test.ts change-isolation.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

Commit:

```powershell
git add -- packages/cli/src/authoring/node-change-store.ts packages/cli/src/authoring/authoring-service.ts packages/cli/test/agent-transaction-recovery.test.ts packages/cli/test/node-project-storage.test.ts packages/cli/test/change-isolation.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "feat(cli): recover interrupted local transactions"
```

---

### Task 8: Capability registry、错误目录与 Agent Port STALE 会话

**Files:**
- Modify: `packages/authoring/src/capability-contract.ts`
- Modify: `packages/authoring/src/capability-registry.ts`
- Modify: `packages/authoring/src/error-catalog.ts`
- Modify: `packages/authoring/test/capability-registry.test.ts`
- Modify: `packages/authoring/test/error-catalog.test.ts`
- Modify: `packages/cli/src/authoring/authoring-dispatcher.ts`
- Modify: `packages/cli/src/agent-port/session.ts`
- Modify: `packages/cli/src/agent-port/server.ts`
- Modify: `packages/cli/src/agent-port/delivery-capsule.ts`
- Modify: `packages/cli/test/agent-port-session.test.ts`
- Modify: `packages/cli/test/agent-port-tools.test.ts`
- Modify: `packages/cli/test/agent-port-output-contract.test.ts`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: Task 7 service methods、RecoveryInspection、新错误。
- Produces: 22 项 registry、MCP schema、STALE/terminal resume、完整 text/structured envelope。

- [ ] **Step 1: 扩展 retry/错误合同**

`RetryDisposition` 增加 `'after-refresh'`。错误目录增加：

```ts
'CHANGE_RECORD_CONFLICT'
'CHANGE_BUSY'
'PROJECT_BUSY'
'LEASE_CORRUPT'
'CHANGE_STORE_CORRUPT'
'CHANGE_STORE_FORMAT_UNSUPPORTED'
'JOURNAL_CORRUPT'
'RECOVERY_NOT_REQUIRED'
'RECOVERY_PLAN_STALE'
'RECOVERY_AMBIGUOUS'
'RECOVERY_EXECUTION_FAILED'
'INVOCATION_LEDGER_WRITE_FAILED'
```

category 使用现有 request/not-found/conflict/validation/runtime/commit；锁/CAS/lease 为 conflict，store/journal corruption 和 recovery execution 为 commit。每项必须有 retry disposition 与 repairActions；不得空 repairActions 除非 truly terminal 且提供 terminal action。

- [ ] **Step 2: 新增两项 registry schema**

能力 ID：

```ts
'change.recovery.inspect'
'change.recovery.execute'
```

inspect input：empty strict object；output 精确覆盖 RecoveryInspection。execute input：

```ts
strictObject({
  operationId: stringSchema,
  recoveryToken: stringSchema,
}, ['operationId', 'recoveryToken'])
```

inspect minimumPolicy=`observe`、pure-read；execute minimumPolicy=`apply`、operation-id、sideEffects=`project-read/project-write/change-store-write`。registry 数量从 20 变为 22；不得硬编码旧 20。

- [ ] **Step 3: dispatcher 只做薄调用**

```ts
case 'change.recovery.inspect':
  return { value: await service.inspectRecovery(context.activeChangeId!) };
case 'change.recovery.execute':
  return {
    value: await service.executeRecovery(context.activeChangeId!, {
      operationId: requireString(input, 'operationId'),
      recoveryToken: requireString(input, 'recoveryToken'),
    }),
    operationId: requireString(input, 'operationId'),
  };
```

不得在 dispatcher/server/session 复制 SHA 分类或恢复顺序。

- [ ] **Step 4: 修复 resume/describe 状态可达性**

`--resume-change` 接受同项目 V2 `OPEN | STALE | COMMITTED | ROLLED_BACK`：

- OPEN 为 active mutation；
- STALE 为 active recovery；
- terminal 只读，不可 mutation；
- corrupt/unsupported 返回 recovery fault description 或稳定错误。

`SessionDescription.activeChange` 增加 `recordVersion`；顶层增加 `lease`、`journal`、`recoveryDisposition`。STALE 的 `manualRecoveryRequired` 必须可达。nextActions 按状态固定，不得给 STALE 推荐普通 scene mutation。

- [ ] **Step 5: capability availability 与 policy**

- STALE + observe/stage/apply：inspect available；
- STALE + apply：execute available；
- STALE + observe/stage：execute policy-blocked；
- terminal：mutation state-blocked；
- OPEN：现有能力保持；recovery.inspect 可以返回 NO_ACTION；execute 返回 RECOVERY_NOT_REQUIRED。

- [ ] **Step 6: MCP output conformance**

更新真实 dispatcher case 到 22 项，逐项以输出 schema 校验 `structuredContent`。文本块必须等于完整 envelope 的 JSON 序列化。session describe、recovery success/failure、lock/CAS error 都必须同时可见；不得只让 error path 有载荷。

- [ ] **Step 7: delivery capsule 一致读取**

capsule 在短 change lease 内读取 record/journal/invocations/diff，加入 recovery 摘要；不得取得 project lease或修改项目。STALE/RECOVERY_FAILED 必须进入 warnings/manualReviewRequired。

- [ ] **Step 8: 运行聚焦 GREEN 并提交**

Run:

```powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-session.test.ts agent-port-tools.test.ts agent-port-output-contract.test.ts agent-port-capsule.test.ts
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

Commit:

```powershell
git add -- packages/authoring/src/capability-contract.ts packages/authoring/src/capability-registry.ts packages/authoring/src/error-catalog.ts packages/authoring/test/capability-registry.test.ts packages/authoring/test/error-catalog.test.ts packages/cli/src/authoring/authoring-dispatcher.ts packages/cli/src/agent-port/session.ts packages/cli/src/agent-port/server.ts packages/cli/src/agent-port/delivery-capsule.ts packages/cli/test/agent-port-session.test.ts packages/cli/test/agent-port-tools.test.ts packages/cli/test/agent-port-output-contract.test.ts docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "feat(agent-port): expose transaction recovery contracts"
```

---

### Task 9: 双进程聚合 runner、preflight 与有界 DIAGNOSTIC

**Files:**
- Create: `packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: Task 1～8 完整能力。
- Produces: `--mode preflight|diagnostic|formal` runner、冻结代码证据 HEAD、聚合 artifact。

- [ ] **Step 1: 定义 runner CLI 与唯一 artifact schema**

Run modes：

```text
node packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs --mode preflight
node packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs --mode diagnostic
node packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs --mode formal
```

artifact 至少包含：

```js
{
  status,
  evidenceClass,
  runHead,
  projectRoot,
  dataDir,
  projectTreeBefore,
  projectTreeAfter,
  sameChange: { operations, recordVersions, workingRevision, invocations },
  differentChanges: { stageOverlapObserved, commitOverlapObserved, winner, staleLoser },
  lease: { liveBlocked, orphanTakenOver, foreignHostBlocked, corruptBlocked, released },
  recovery: { staging, replacing, committed, unexpected },
  mcp: { inspectVisible, executePolicyBlocked, executeApplyPassed, textEqualsStructured },
  errors: [],
  childProcesses: [],
  cleanup: { timersStopped, childrenExited, locksReleased },
}
```

- [ ] **Step 2: preflight 使用正式 dist 与隔离根**

preflight 必须确认：

- `packages/cli/dist/agent-port/main.js` 存在；
- Authoring/CLI dist 与当前源码 build 成功；
- project fixture、data dir 和 artifact root 均在系统 Temp 且不在仓库；
- `SURDET_AGENT_DATA_DIR` 显式传给每个 child；
- child 使用同一 launcher/cwd/dist；
- 初始 data dir 为空；
- 原始 Starter 仅作为只读复制源，preflight 不创建 change；
- stdout 仅协议内容，stderr 无意外日志；
- cleanup 可结束 child/heartbeat。

- [ ] **Step 3: diagnostic/formal 业务路径**

同一 runner 必须确定性完成：

1. 同一 change 两进程并发 typed mutation，成功结果全保留；
2. 不同 change 并行 stage，证明不被 project lease 串行；
3. 两个 commit 请求窗口同时开始并真实重叠，唯一 winner，loser STALE；replacement 最大并发为 1 的内部事件由 `packages/cli/test/multi-process-change-concurrency.test.ts` 提供；
4. 活 change lock 阻断；child 退出后短测试时钟下 orphan lock 接管；
5. 人工构造 STAGING crash fixture，fresh process inspect+execute 后 OPEN；
6. 人工构造 REPLACING mixed-known，恢复到 base；
7. COMMITTED journal/OPEN record 补闭合为 COMMITTED；
8. unexpected bytes 返回 MANUAL_RECOVERY_REQUIRED 且 bytes 不变；
9. MCP observe inspect 可见、stage/apply policy 正确、text/structured 一致；
10. 最终项目树仅含被明确成功 commit 的 winner，原始 Starter 不变；
11. child、timer、lock 全部释放。

聚合 runner 只记录它能真实观察的外部结果：commit 请求窗口重叠、唯一 winner、loser=`STALE`、最终项目树只含 winner。replacement overlap 不在聚合 artifact 中硬编码；本 Task 的证据是“聚合外部可观察结果 + 聚焦测试内部 replacement 事件”的组合证据。

- [ ] **Step 4: node check 与 preflight**

Run:

```powershell
node --check packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs
node packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs --mode preflight
```

Expected: `PREFLIGHT_PASSED`，无项目 mutation、无残留 child/lock。

- [ ] **Step 5: 运行有界 DIAGNOSTIC**

最多 3 次。每次产生新目录、新 artifact，不覆盖。失败后只修第一个失败节点；每次 runner 修正都必须 node check、聚焦测试并创建普通提交，不能积累未提交 runner diff。

停止规则：第 3 次仍失败 → `DIAGNOSTIC_BUDGET_EXHAUSTED`；不得运行 FORMAL。

- [ ] **Step 6: 冻结 runner 并创建代码证据提交**

DIAGNOSTIC 通过后，更新紧凑 Ledger，确保 tracked clean，然后：

```powershell
git add -- packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
git diff --cached --check
git commit -m "test(cli): add multi-process transaction formal"
git rev-parse HEAD
```

该 HEAD 记为 `CODE_EVIDENCE_HEAD`。之后在 FORMAL 前不得再改任何生产、测试或 runner 文件。

---

### Task 10: 聚焦总门、唯一 verify:all 与唯一 FORMAL

**Files:**
- Read only until failure: all Task 1～9 code/tests
- Modify only on an explicitly authorized recovery path: the exact task-related whitelist file that caused the first gate failure
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md` only after FORMAL result

**Interfaces:**
- Consumes: frozen `CODE_EVIDENCE_HEAD`。
- Produces: 全量门禁、FORMAL artifact、最终代码证据结论。

- [ ] **Step 1: 运行聚焦总门**

Run:

```powershell
npm run test -w @surdet/authoring -- transaction-recovery.test.ts commit-recovery.test.ts change-session.test.ts capability-registry.test.ts error-catalog.test.ts
npm run test -w @surdet/authoring
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- node-json-record.test.ts node-local-lease.test.ts multi-process-change-concurrency.test.ts agent-transaction-recovery.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-output-contract.test.ts change-isolation.test.ts
npm run test -w @surdet/cli
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
node --check packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs
git diff --check
git diff --cached --check
```

Expected: 全部 exit 0。不得用单个 `-t` 绿灯代替完整相关测试文件。

- [ ] **Step 2: 运行唯一正式 verify:all**

Run:

```powershell
npm run verify:all 2>&1 | Tee-Object -FilePath "$wave4Root\task10-verify-all.log"
```

Expected: exit 0、抵达最终 diff-check。

若失败：

- 记录最后通过节点和第一个失败节点；
- 若与本轮修改无关或原因未知，立即停止；
- 若由本轮白名单直接引起，先建立匹配聚焦红灯、最小修复、聚焦绿灯并提交，之后仅允许一次 recovery `verify:all`；
- recovery 再失败立即停止；
- 不修改性能门限或跳过测试。

- [ ] **Step 3: 确认正式取证前 Git 身份**

Run:

```powershell
git status --short
git rev-parse HEAD
git diff --check
```

Expected: tracked clean、staging empty、HEAD=`CODE_EVIDENCE_HEAD`。若 verify recovery 产生了修复提交，则新的冻结 HEAD 取代旧值，并必须重新运行 node check/preflight；不得重跑 DIAGNOSTIC。

- [ ] **Step 4: 运行唯一 FORMAL**

Run:

```powershell
node packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs --mode formal
```

Expected: exit 0，`status=PASSED`、`evidenceClass=FORMAL`、`artifact.runHead === CODE_EVIDENCE_HEAD`、错误通道为空、child/timer/lock 清理确认、原始 Starter unchanged。

FORMAL 失败：保留 artifact，记录最后通过节点和第一个失败节点，停止；不得重跑、不得修后再 FORMAL。

- [ ] **Step 5: 从磁盘回读正式证据**

必须重新读取：

- artifact 绝对路径；
- evidence.json bytes/SHA-256；
- identity.json bytes/SHA-256；
- runHead/status/evidenceClass；
- project/data root；
- operation/recordVersion/workingRevision 序列；
- lease/recovery/commit 结果；
- project tree before/after；
- child/timer/lock cleanup；
- 所有失败 artifact 仍存在。

- [ ] **Step 6: 追加 Task 10 Ledger**

只写命令、结果、artifact 身份、CODE_EVIDENCE_HEAD 和停止状态；不要复制整段测试输出。此时允许 taskbook 成为唯一 tracked 文档修改，生产/test/runner 保持 clean。

---

### Task 11: 交付报告、精确提交与停止复审

**Files:**
- Create: `docs/PRE-WAVE-5-AGENT-TRANSACTION-RECOVERY-WAVE-4-DELIVERY-REPORT-2026-08-24.md`
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`

**Interfaces:**
- Consumes: 全部真实提交、测试与 artifact。
- Produces: 可独立复审的最终报告、docs-only closure HEAD、干净 tracked 状态。

- [ ] **Step 1: 创建交付报告**

报告首行必须按真实结果选择，不得预写通过。通过时：

```text
PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4_VERIFIED — CROSS_PROCESS_CAS_PASSED; LOCAL_LEASES_PASSED; PROJECT_COMMIT_SERIALIZED; EXPLICIT_RECOVERY_PASSED; FORMAL_PASSED; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW; NOT_PUSHED; WAVE_5_NOT_STARTED
```

失败时首行必须包含失败节点和 `NOT_VERIFIED`。

报告固定分节：

1. 结论与未声明边界；
2. 真实 Git 基线与提交链；
3. Task 1 RED；
4. Change Store V2/CAS；
5. lease 与接管；
6. project commit 串行化；
7. journal/recovery；
8. Agent Port/MCP；
9. 测试与 verify；
10. DIAGNOSTIC/FORMAL artifact；
11. 未解决问题与 out-of-scope；
12. 最终 Git 与停止状态。

必须区分 `AUTOMATED_FACTS`、`REASONABLE_INFERENCES`、`UNVERIFIED_CLAIMS`。本轮无 owner 视觉验收，不得写 OWNER_ACCEPTANCE=PASS。

- [ ] **Step 2: 文档自检**

Run:

```powershell
rg -n "TB[D]|TO[D]O|PEND[I]NG|will be append[e]d|placeholde[r]|待[补]|待[定]" docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md docs/PRE-WAVE-5-AGENT-TRANSACTION-RECOVERY-WAVE-4-DELIVERY-REPORT-2026-08-24.md
npm run verify:docs
git diff --check
```

Expected: 占位词匹配数为 0；`verify:docs` exit 0；diff-check exit 0。若任务书中存在历史未决状态词，必须明确标注 `HISTORICAL_SNAPSHOT`，不能让读者误认为当前状态。

- [ ] **Step 3: 回读文件身份和提交范围**

对任务书、报告、FORMAL evidence/identity 分别读取 bytes/SHA-256。运行：

```powershell
git status --short
git diff --name-status
git diff --cached --name-status
git ls-files '*.log'
```

Expected: tracked 修改仅两份 Wave 4 文档；staging empty；tracked log none；既有 untracked 原样。

- [ ] **Step 4: 创建 docs-only closure**

```powershell
git add -- docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md docs/PRE-WAVE-5-AGENT-TRANSACTION-RECOVERY-WAVE-4-DELIVERY-REPORT-2026-08-24.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(authoring): report transaction recovery wave 4"
```

Expected: 仅两份文档。

- [ ] **Step 5: 最终回读**

Run:

```powershell
git show --name-status --oneline HEAD
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
```

从 FORMAL artifact 读取 `runHead` 到 `$formalRunHead` 后记录：

```powershell
"CODE_EVIDENCE_HEAD=$formalRunHead"
"DOCUMENT_CLOSURE_HEAD=$(git rev-parse HEAD)"
"FINAL_HEAD=$(git rev-parse HEAD)"
"PUSH=NOT_PERFORMED"
"WAVE_5=NOT_STARTED"
"NEXT_STOP=WAITING_FOR_INDEPENDENT_MANAGER_REVIEW"
```

不要把聊天中的 hash 反写成已提交文档里的“自指最终 HEAD”；文档只记录其创建前已知的代码证据 HEAD 和 parent，最终 docs commit 身份在交接包中单独报告，避免再制造 docs-only 身份修正循环。

- [ ] **Step 6: 停止**

不得 push、不得启动 Wave 5、不得继续 Low 建议、不得清理 artifact。向项目所有者提交：结论、提交链、关键测试、FORMAL artifact、未解决问题、Git 状态和下一门。等待小衡/独立经理只读复审。

---

## Independent Manager Review Checklist

独立复审只读，不修改、不重跑 FORMAL、不 push。至少核验：

1. Task 1 旧实现真实出现两个 child success 但一个成功结果丢失；
2. V2 record/head/manifest 不再生成新 `transaction.json`/`working-files.json`；
3. recordVersion 对所有 record write 递增，workingRevision 只跟内容；
4. CAS conflict 零写入，operationId 重试幂等；
5. change/project lease ownerToken、heartbeat、stale takeover、release 安全；
6. 锁顺序固定，无 project→change 路径；
7. 不同 change stage 可并行，commit replacement 不重叠；
8. 第二 commit 在 project lock 内看到新 revision 并 STALE；
9. Journal V2 连续版本和 crash matrix；
10. unexpected 文件零恢复写入；
11. recoveryToken stale 零写入；
12. STALE session describe/inspect 可达，execute 仅 apply；
13. registry=22，MCP output conformance 全部通过；
14. invocation ledger failure 没有把成功 operation 伪装为未发生；
15. FORMAL artifact runHead 与 CODE_EVIDENCE_HEAD 一致；
16. child/timer/lock cleanup 全部确认；
17. 原始 Starter 和禁止范围无 diff；
18. verify:all 运行次数符合预算；
19. 提交范围、文档身份、tracked/staging/untracked 与报告一致；
20. 没有 push、Wave 5、部署、发行或 owner acceptance 冒领。

建议通过状态：

```text
INDEPENDENT_FINAL_REVIEW = PASS
PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4 = CLOSED_LOCALLY
READY_FOR_OWNER_PUSH_DECISION
WAVE_5 = NOT_STARTED
```

若发现 Blocker/High/Medium，只报告第一个可操作问题、证据和最小返工范围；不得顺手修复。

---

## Taskbook Creation Record

设计批准与任务书创建前的真实基线：

```text
DATE = 2026-08-24
BRANCH = main
HEAD_BEFORE_TASKBOOK = 6c6f812aa757b0074ebf51a05306aa5b4e6bf063
REMOTE_MAIN_AT_CREATION = 00255f64916d412f20b57ba0954eea8c7b63b26e
AHEAD_BEHIND_BEFORE_TASKBOOK = 2/0
TRACKED_WORKTREE_BEFORE_TASKBOOK = CLEAN
STAGING_AREA_BEFORE_TASKBOOK = EMPTY
DESIGN_SPEC_COMMIT_1 = 1c4002f
DESIGN_SPEC_COMMIT_2 = 6c6f812
DESIGN_APPROVED_BY_OWNER = YES
IMPLEMENTATION = NOT_STARTED
PUSH = NOT_AUTHORIZED
WAVE_5 = NOT_STARTED
```

执行 AI 从 Task 0 开始，在本节后追加紧凑 Ledger；不得改写本条创建事实，不得复制整段测试日志。

## Execution Ledger

### 2026-08-24T17:28:44+08:00 — Task 0 baseline and source preflight

```text
HEAD=526a0fcb68870ec8dc881a7d5a9d133a9615d3ae; REMOTE=00255f64916d412f20b57ba0954eea8c7b63b26e; AHEAD_BEHIND=3/0
BRANCH=main; TRACKED_WORKTREE=CLEAN; STAGING_AREA=EMPTY; TRACKED_LOG_FILES=0; KNOWN_UNTRACKED_ONLY=YES
WAVE4_ROOT=<local-path> INITIAL_CONTENTS=EMPTY
READ E:\surdet\AGENTS.md bytes=7808 sha256=4184285B9BD47B6AD61C34A181CA99BFEEDD7257896815461BE4B46E8137AEEB
READ docs/superpowers/specs/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4-design.md bytes=31368 sha256=F81003510C836C3F14B5FBAAB016B1071A498EB142A7F57560FFE25E7047EB7C
READ docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md bytes=63775 sha256=4CC99638CF8EB6310AC84D8EE3A835F50614C686CD0579C6A3239A91282B8691
READ docs/superpowers/plans/2026-08-24-pre-wave-5-evidence-trustworthiness-wave-3.md bytes=42516 sha256=A9D8DD827968418224E8C746AD80DCF9406D65D5DBDE2F76C739BA3425E37E58
READ docs/EVIDENCE-TRUSTWORTHINESS-WAVE-3-DELIVERY-REPORT-2026-08-24.md bytes=13073 sha256=54C2DBCD018B48FDCA1D30D0B7A2FF2C3D2FD1239B4BFF311D8F6E851B7B9A8D
READ packages/authoring/src/contracts.ts bytes=8354 sha256=85DC09F47EC545BA8B1447EF443CE6CECC9DEB9282795C42BAE75C6177278179
READ packages/authoring/src/change-session.ts bytes=15869 sha256=63380D9D40F1532834756EA4D5A5231F1E3749388472B51BEE3D2907972D828C
READ packages/cli/src/authoring/node-change-store.ts bytes=12906 sha256=9C6E84BB01979612D502DC9EDDCCFFC60E491CC85BDD224F3E5F3B1D96912FDC
READ packages/cli/src/authoring/node-project-storage.ts bytes=13572 sha256=AD1021B6B3B3B52DB07C80BA55B2836AF5FB44179C3CAA9F56D6043EE5867EBA
READ packages/cli/src/authoring/node-file-replacement.ts bytes=1555 sha256=BB206DEB5C8C82AD35AB0B37C6C0595DADE2688BE50341D72785EB938E40A616
READ packages/cli/src/authoring/authoring-service.ts bytes=30750 sha256=3D1FB62B145B5A1532AD2E21A282292DFEB3339AC8AB92712E4862CE65D9D666
READ packages/cli/src/agent-port/session.ts bytes=16803 sha256=E1C012B6A3FA74ADF096D4328D1512BD6C8408B662F1EE46414D265C6A9D3465
STATIC_GAP=direct JSON overwrite; V1 transaction+working-files double write; no CAS; Node-only readLatestJournal; OPEN-only resume; process-local invocationTail
COMMANDS=git baseline/diff checks/ls-files/log, rg static gap, Temp root readback; all produced expected results and no source writes
BUILD=npm run build -w @surdet/authoring EXIT=0; npm run build -w @surdet/cli EXIT=0; ignored dist only
NEXT_STOP=TASK_1_WRITE_AND_RUN_SINGLE_REAL_TWO_PROCESS_RED
```

### 2026-08-24T17:31:27+08:00 — Task 1 RED

```text
FILES_CREATED=packages/cli/test/fixtures/transaction-worker.mjs; packages/cli/test/multi-process-change-concurrency.test.ts
RED_RUNS=1; COMMAND=npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts -t "reproduces cross-process last-write-wins" --reporter=json --outputFile="$WAVE4_ROOT\task1-red.json"; EXIT=1
ARTIFACT=<local-path> BYTES=1278; SHA256=A1FDD5FA21CFA50AC86161FEDB2A5EA85FECA67830810FA576FDEA1605750EF8
ARTIFACT_FACTS=1 test; 1 failed; business assertion at multi-process-change-concurrency.test.ts:130; child success/result assertion passed for 2 results; child exits reached 0/0 before final record assertion
FINAL_RECORD_FACT=operations contained only ['op-b']; workingFiles/workingRevision assertions were not reached after the first business failure
RED_STATUS=RED_REPRODUCED; HARNESS_INVALID=NO; RED_NOT_REPRODUCED=NO; FAILED_ARTIFACT_PRESERVED=YES
NEXT_STOP=COMMIT_TASK_1_RED_HARNESS_THEN_TASK_2
```

### 2026-08-24T17:46:19+08:00 — Task 2 V2 store, JSON identity and CAS

```text
TASK2_SHARED_RED=authoring change-session.test.ts EXIT=1; 5 tests with 2 expected contract failures (missing V2 version fields and stale write accepted)
IMPLEMENTED=ChangeRecord formatVersion/recordVersion; repository precondition/CAS; V2 manifest/head/immutable records; exclusive non-torn JSON create/replace/read; V1 fail-loud handling
GREEN=npm run test -w @surdet/authoring -- change-session.test.ts EXIT=0 (5/5); npm run build -w @surdet/authoring EXIT=0
GREEN_CLI=npm run test -w @surdet/cli -- node-json-record.test.ts change-isolation.test.ts multi-process-change-concurrency.test.ts EXIT=0 (3 files; 10/10); npm run typecheck -w @surdet/authoring EXIT=0; npm run typecheck -w @surdet/cli EXIT=0; npm run build -w @surdet/cli EXIT=0
CONCURRENCY=one child succeeds and one deterministic CHANGE_RECORD_CONFLICT; refresh/retry with same operationId retains both operations, markers and workingRevision=2
JSON_FIX=immutable record creation uses same-directory wx + fs.link exclusive target publication after fs.rename could overwrite an existing record on Windows; replacement still uses replaceFileByRename
LEGACY=direct NodeChangeStore V1 unique-ID open returns CHANGE_STORE_FORMAT_UNSUPPORTED and preserves old bytes; CLI envelope registry remains Task 8 scope
RED_ARTIFACT=<local-path> PRESERVED=YES
NEXT_STOP=COMMIT_TASK_2_THEN_TASK_3_LEASE_RED
```

### 2026-08-24T17:53:23+08:00 — Task 3 local lease and bound store

```text
RED_RUN=npm run test -w @surdet/cli -- node-local-lease.test.ts EXIT=1; 4 tests ran and failed on the intentional NOT_IMPLEMENTED/stub behavior; runner and child-free harness valid
IMPLEMENTED=NodeLocalLeaseManager change/project namespaces; mkdir ownership; injected clock/hostname/PID/scheduler; 2s heartbeat; 15s stale predicate; same-host dead-PID quarantine rename; owner-token release; corrupt/foreign/alive/fresh fail-loud
BOUND_STORE=NodeChangeStore.withChangeLease() binds one ownerToken; bound record/evidence/journal/diff/trace/invocation/capsule writes verify that lease without reacquiring; unbound mutation rejects while reads remain available
GREEN=npm run test -w @surdet/cli -- node-local-lease.test.ts node-json-record.test.ts EXIT=0 (2 files; 8/8); npm run typecheck -w @surdet/cli EXIT=0; npm run build -w @surdet/cli EXIT=0
NO_WAIT=lease tests use injected time/scheduler; no real 15-second sleep; project lock namespace and stale quarantine evidence are asserted
NEXT_STOP=COMMIT_TASK_3_THEN_TASK_4_SERVICE_BOUNDARY_RED
```

### 2026-08-24T18:06:58+08:00 — Task 4 service boundary and invocation truthfulness

```text
RED_RUN=npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts -t "real service mutations" EXIT=1; two real service children reached result files/exit 0 but both returned ok=false under the unbound mutation path; HARNESS_INVALID=NO
LOW_LEVEL=worker now reads stale record before barrier, then uses bounded test-only lease retry so the existing cross-process path still yields one success plus CHANGE_RECORD_CONFLICT; loser refresh/retry is lease-bound
SERVICE=AuthoringService mutation/evidence/diff/trace/rollback/commit paths reopen latest record inside one change lease; AgentPort active-change dispatch uses the bound service and writes its invocation fact before releasing that same lease
TRUTHFUL_FAILURE=invocation before-read is inside try; ledger failure returns internal INVOCATION_LEDGER_WRITE_FAILED details operationMayHaveSucceeded/operationId/changeId; same operationId retry is idempotent and creates one readable fact without incrementing workingRevision
GREEN=npm run build -w @surdet/authoring EXIT=0; npm run build -w @surdet/cli EXIT=0; npm run typecheck -w @surdet/cli EXIT=0; npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-session.test.ts EXIT=0 (2 files; 12/12); node --check worker EXIT=0
SCOPE=Task 4 tracked changes are limited to authoring-service.ts, session.ts, invocation/test worker, multi-process test, agent-port-session test and this plan; node-local-lease.ts remains at Task 3 commit
NEXT_STOP=COMMIT_TASK_4_THEN_TASK_5_PROJECT_LEASE_RED
```

### 2026-08-24T18:15:51+08:00 — Task 5 project lease and commit serialization

```text
RED_RUN=npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts -t "serializes different change commits at the project boundary" --reporter=json --outputFile="$WAVE4_ROOT\task5-red.json" EXIT=1
RED_ARTIFACT=<local-path> BYTES=2462 SHA256=AF00BDB1823E2F933503D4390EF1021BFB1A6DF47A275917E526A513609D8CB4
RED_FACTS=two real child service preparations reached the barrier and both change.commit calls returned ok; project-boundary one-success/one-stale assertion failed; HARNESS_INVALID=NO
IMPLEMENTED=project lease around Node adapter snapshot/asset reads and change.begin; fixed change-then-project commit lock order; lock-held base revision recheck marks loser STALE before staging/replacement; rollback retains change-lease-only recovery without opening the project
RACE_HANDLING=service retries only transient missing lease.json from Task 3 unlink/rmdir window; active PROJECT_BUSY and malformed/foreign lease errors remain fail-loud; test worker uses bounded PROJECT_BUSY retry to observe post-release PROJECT_CHANGED_SINCE_BEGIN
GREEN=npm run test -w @surdet/authoring -- commit-recovery.test.ts EXIT=0 (4/4); npm run build -w @surdet/authoring EXIT=0; npm run build -w @surdet/cli EXIT=0; npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-security.test.ts EXIT=0 (2 files; 18/18); npm run typecheck -w @surdet/authoring EXIT=0; npm run typecheck -w @surdet/cli EXIT=0
COUNTERTEST=live project lease returns PROJECT_BUSY with holder summary/retryAfterMs and no ownerToken; record/journal/project bytes unchanged; replacement max concurrency=1; records sort to COMMITTED/STALE; loser scene is absent
SCOPE=Task 5 tracked changes are limited to authoring-service.ts, change-session.ts, commit-recovery.test.ts, agent-port-security.test.ts, transaction-worker.mjs, multi-process-change-concurrency.test.ts and this plan; node-local-lease.ts remains unchanged
NEXT_STOP=COMMIT_TASK_5_THEN_TASK_6_JOURNAL_RECOVERY_RED
```

### 2026-08-24T18:25:11+08:00 — Task 6 shared Journal V2 and explicit recovery

```text
RED_RUN=npm run test -w @surdet/authoring -- transaction-recovery.test.ts --reporter=json --outputFile="$WAVE4_ROOT\task6-red.json" EXIT=1
RED_ARTIFACT=<local-path> BYTES=5419 SHA256=8CF50F2F3D6376DB977BFFA1DCD898ED68D921AA28EDC71421AFEEA9E2E180F4
RED_FACTS=7 recovery assertions ran through the valid runner; all 7 failed only at the intentional inspect/execute NOT_IMPLEMENTED boundary; HARNESS_INVALID=NO
IMPLEMENTED=public CommitJournal/RecoveryInspection contracts; Journal V2 versioned snapshots from shared commitChange; pure file-state inspection with normalized recovery token; explicit REOPEN/ROLLBACK/FINALIZE actions with record CAS, journal evidence, stale-token and operationId protections
MATRIX=STAGING base, REPLACING targets, RECOVERY_FAILED mixed, COMMITTED targets, RECOVERED base and unexpected sha; unexpected execute performs zero storage/repository writes
GREEN=npm run test -w @surdet/authoring -- transaction-recovery.test.ts commit-recovery.test.ts change-session.test.ts EXIT=0 (3 files; 18/18); npm run test -w @surdet/authoring EXIT=0 (23 files; 150/150); npm run typecheck -w @surdet/authoring EXIT=0; npm run build -w @surdet/authoring EXIT=0
JOURNAL=commit recovery versions verified as contiguous [1,2,3,4,5] for the two-file success path; shared commit no longer owns a private journal type
SCOPE=Task 6 tracked changes are limited to contracts.ts, change-session.ts, transaction-recovery.ts, index.ts, transaction-recovery.test.ts, commit-recovery.test.ts and this plan; Node adapter journal filename/recovery service remain Task 7 scope
NEXT_STOP=COMMIT_TASK_6_THEN_TASK_7_NODE_RECOVERY_RED
```

### 2026-08-24T19:01:09+08:00 — Task 7 RED

```text
RED_RUN=npm run test -w @surdet/cli -- agent-transaction-recovery.test.ts --reporter=json --outputFile="$WAVE4_ROOT\task7-red.json" EXIT=1
RED_ARTIFACT=<local-path> BYTES=1405 SHA256=3E9B432AB2580F5B5DFEBDBCF3CEDCFB519C049B36D0CC0A003A675785AF2B23
RED_FACTS=direct NodeChangeStore.openForProject() located the real V2 change; a fresh AuthoringService instance reached the intentional inspectRecovery NOT_IMPLEMENTED boundary; no type or runner failure
RED_STATUS=RED_REPRODUCED; HARNESS_INVALID=NO; RED_NOT_REPRODUCED=NO; FAILED_ARTIFACT_PRESERVED=YES
NEXT_STOP=TASK_7_IMPLEMENT_NODE_RECOVERY_SERVICE_AND_RESTART_MATRIX
```

### 2026-08-24T19:13:43+08:00 — Task 7 Node recovery service and project identity protection

```text
IMPLEMENTED=NodeChangeStore.openForProject() direct project-hash open with terminal/stale options; openByChangeId() skips unrelated corrupt V2 candidates but reports corruption when no valid candidate remains; journal files are contiguous 10-digit V2 snapshots with identity/content validation and V1/corrupt fail-loud
SERVICE=AuthoringService.inspectRecovery()/executeRecovery() acquire change then project locks, reread record/journal/project under lock, delegate classification and actions to shared transaction-recovery state machine, enforce base revision freshness and stagedIdentity root/symlink/junction/.surdet safety
MATRIX=7 fresh-process tests cover STAGING reopen OPEN, REPLACING mixed-known rollback, COMMITTED finalization, unexpected manual zero-write, stale-token zero-write, operationId idempotency, and V1/corrupt manifest/head/record/journal preservation
COUNTERTESTS=change-isolation direct project open and unrelated corrupt candidate; NodeProjectStorage outside/symlink staged cleanup refusal
RED_RUN=npm run test -w @surdet/cli -- agent-transaction-recovery.test.ts --reporter=json --outputFile="$WAVE4_ROOT\task7-red.json" EXIT=1
RED_ARTIFACT=<local-path> BYTES=1405 SHA256=3E9B432AB2580F5B5DFEBDBCF3CEDCFB519C049B36D0CC0A003A675785AF2B23
RED_FACTS=direct project open passed; fresh AuthoringService reached only the intentional NOT_IMPLEMENTED inspect boundary; HARNESS_INVALID=NO
GREEN=npm run build -w @surdet/authoring EXIT=0; npm run test -w @surdet/cli -- agent-transaction-recovery.test.ts node-project-storage.test.ts change-isolation.test.ts EXIT=0 (3 files; 21/21); npm run typecheck -w @surdet/cli EXIT=0; npm run build -w @surdet/cli EXIT=0
SCOPE=Task 7 tracked changes are limited to node-change-store.ts, authoring-service.ts, agent-transaction-recovery.test.ts, node-project-storage.test.ts, change-isolation.test.ts and this plan; node-local-lease.ts, session.ts, protected files and existing untracked governance files remain untouched
NEXT_STOP=COMMIT_TASK_7_THEN_TASK_8_CAPABILITY_AND_ERROR_CATALOG_RED
```

### 2026-08-24T19:17:06+08:00 — Task 8 RED

```text
RED_RUN=npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts --reporter=json --outputFile="$WAVE4_ROOT\task8-red.json" EXIT=1
RED_ARTIFACT=<local-path> BYTES=7464 SHA256=5CDB89082BF6A04A09B60573BC30F2C5566EACA45418B111878B9FD42DDA2D2B
RED_FACTS=registry contract assertions observed 20 instead of 22 and missing recovery definitions; error catalog assertion observed missing CHANGE_RECORD_CONFLICT; existing unrelated assertions passed; HARNESS_INVALID=NO
RED_STATUS=RED_REPRODUCED; RED_NOT_REPRODUCED=NO; FAILED_ARTIFACT_PRESERVED=YES
NEXT_STOP=TASK_8_IMPLEMENT_ERROR_REGISTRY_CAPABILITY_SCHEMA_AND_STALE_SESSION
```

### 2026-08-24T19:30:28+08:00 — Task 8 Capability registry, error catalog and Agent Port recovery session

```text
IMPLEMENTED=RetryDisposition after-refresh; 12 stable transaction/lease/store/journal/recovery/invocation errors with non-empty repair contracts; 22 registry capabilities including strict recovery inspect/execute schemas and dispatcher thin calls
SESSION=resume accepts same-project V2 OPEN/STALE/COMMITTED/ROLLED_BACK; STALE exposes recovery-only nextActions and manualRecoveryRequired; terminal changes are read-only; describe now includes recordVersion, change/project lease summaries, journal state and recoveryDisposition
MCP=all projected capability schemas remain registry-derived; session/capsule schemas include recovery fields; structuredContent equals the full envelope and text content serializes that same envelope
CAPSULE=record/journal/invocations/diff and capsule payload write run under one short bound change lease; no project lease or project mutation; recovery summary plus STALE/RECOVERY_FAILED/manual-review warnings are included
CHECKPOINTS=an initial authoring assertion omitted after-refresh from the edited test allow-list; an initial CLI run exposed cross-project resume as CHANGE_NOT_FOUND; both were corrected, and the final required commands below were rerun successfully
GREEN_AUTH_TEST=npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts EXIT=0 (2 files; 10/10)
GREEN_AUTH_BUILD=npm run build -w @surdet/authoring EXIT=0
GREEN_CLI_TEST=npm run test -w @surdet/cli -- agent-port-session.test.ts agent-port-tools.test.ts agent-port-output-contract.test.ts agent-port-capsule.test.ts EXIT=0 (4 files; 25/25)
GREEN_AUTH_TYPECHECK=npm run typecheck -w @surdet/authoring EXIT=0
GREEN_CLI_TYPECHECK=npm run typecheck -w @surdet/cli EXIT=0
GREEN_CLI_BUILD=npm run build -w @surdet/cli EXIT=0
FINAL_REVALIDATION_AT=2026-08-24T20:32:24+08:00
RED_ARTIFACT=<local-path> BYTES=7464 SHA256=5CDB89082BF6A04A09B60573BC30F2C5566EACA45418B111878B9FD42DDA2D2B PRESERVED=YES
SCOPE=tracked Task 8 diff is exactly the 13 paths listed by the Task 8 commit command; protected files and existing untracked governance/CLI artifacts remain untouched
NEXT_STOP=COMMIT_TASK_8_THEN_TASK_9_AGGREGATE_RUNNER_RED
```

### 2026-08-24T21:08:00+08:00 — Task 9 aggregate runner stopped at diagnostic budget

```text
RED_RUN=missing packages/cli/e2e/agent-transaction-recovery-wave-4.e2e.mjs; preflight entry returned MODULE_NOT_FOUND; HARNESS_INVALID=YES; no formal evidence was produced
RUNNER=created only the Task 9 runner path; old agent-port-wave-4.e2e.mjs was not reused or modified; all fixtures/data/artifacts were below unique system Temp roots and outside E:\surdet
EVIDENCE_BOUNDARY=the aggregate runner observes stage/commit request windows, winner/STALE outcome, final winner-only project tree and recovery/MCP/cleanup facts; replacement critical-section max concurrency remains evidenced by packages/cli/test/multi-process-change-concurrency.test.ts, not by an unobserved aggregate field
PREFLIGHT=node --check EXIT=0; runner preflight EXIT=0 twice after the two runner corrections; both builds EXIT=0; observe policy/tool filtering, text=structured, empty data, child exit, stderr and original Starter hash checks passed
DIAGNOSTIC_1=EXIT=1 at change.begin because runner used disallowed initiator; raw MCP response was input validation only; failure artifact=<local-path> BYTES=2394 SHA256=f795cfa8144a8acaa9a27067969d5dab4db8d65ef23910ed2c92ced3f47c9cae PRESERVED=YES
DIAGNOSTIC_2=EXIT=1 after both same-change mutations succeeded; runner counted begin's invocation, actual mutation invocation count was 2; failure artifact=<local-path> BYTES=2163 SHA256=e1ee8617084aa1c7ee95cf6b3f1344f47891a314a87573146e4fda4e6fa099ac PRESERVED=YES
DIAGNOSTIC_3=EXIT=1 at different-change runtime evidence; Starter ch01_01 contains a choice and runner passed choices=[]; engine returned structured RUNTIME_FAILED, not a transaction loss; failure artifact=<local-path> BYTES=3455 SHA256=509f452ecda519e8dd726ce43b1783c16fd88034dddda95b33c34965dd278c1f PRESERVED=YES
FIX_COMMITS=bacc0d5 fix(cli): correct transaction runner fixture input; 4a21d0e fix(cli): account for begin invocation in runner; each fix passed node --check and focused preflight before rerun
DIAGNOSTIC_BUDGET=EXHAUSTED_AFTER_THREE_RUNS; FORMAL=NOT_RUN; VERIFY_ALL=NOT_RUN; TASK_10=NOT_STARTED; PUSH/DEPLOY/RELEASE/WAVE_5=NOT_AUTHORIZED_AND_NOT_RUN
STOP=DO_NOT_FIX_OR_RERUN; WAITING_FOR_OWNER_OR_INDEPENDENT_MANAGER_REVIEW
```

### 2026-08-24T21:07:00+08:00 — W4-RUNNER-METHOD-RECOVERY-1 stopped at recovery diagnostic

```text
AUTHORIZATION=RECOVERY_DIAGNOSTIC_BUDGET=1; OLD_DIAGNOSTIC_BUDGET=3/3_USED remains historical and was not rewritten; FORMAL=NOT_STARTED; VERIFY_ALL=NOT_RUN
TASK0=AGENTS.md/spec/plan/runner and all three historical failure artifacts reread; HEAD=4a21d0e9a3fa9c466f5bde8f60527cd233af7df6 before repair; tracking=00255f64916d412f20b57ba0954eea8c7b63b26e; AHEAD_BEHIND=13/0; known untracked governance/protected/history artifacts preserved
METHOD_FIX=runner changed ch01_01 runtime choices to [0], diagnostic/formal success status to PASSED, fail-loud same-change mutation and commit request overlap assertions, removed replacementOverlap, and scanned every registered data dir's active changes/projects lock directories while excluding .locks/stale
PRECHECK=the four authorized checks all EXIT=0: node --check; multi-process-change-concurrency.test.ts 3/3; preflight with builds/protocol/child/stderr/original-Starter/active-lock checks; git diff --check
RUNNER_COMMIT=c894127d9c177b3f27a4ad004a575fdc8db199e0; COMMIT_MESSAGE=fix(cli): stabilize transaction evidence runner; COMMIT_SCOPE=runner only; current taskbook ledger was not staged
RECOVERY_DIAGNOSTIC=one and only one run; EXIT=1; runHead=c894127d9c177b3f27a4ad004a575fdc8db199e0; status=FAILED; evidenceClass=DIAGNOSTIC; artifact=<local-path> BYTES=4428 SHA256=5f358ae6f4bb09fa758ee3a88cf9a2271c42fe998e00a271cf066748aedcd1a9 PRESERVED=YES
PROGRESS=last passed node same-change; first failed node different-changes; failure at ch01_01 choices [0] reaching ch02.gal:14 @exp, engine returned structured RUNTIME_FAILED because GrowthSystem host injection is unavailable; no concurrency/recovery GREEN claim
CLEANUP=childProcesses exited; protocol=[]; unexpected stderr=[]; childCleanupFailures=[]; activeLeaseDirectories=[]; locksReleased=true; original Starter not reached by a passing full run, no mutation was made to repository Starter
STOP=RECOVERY_DIAGNOSTIC_FAILED; do not repair/rerun; do not run verify:all, FORMAL, Task 10, push, deploy, release or Wave 5; wait for new owner authorization
```

### 2026-08-24T22:21:18+08:00 — W4 recovery fixture method closure and passing DIAGNOSTIC

```text
TAKEOVER=project owner authorized the independent manager to continue the Wave 4 closure directly; no push, deployment, release or Wave 5 authorization was inferred
BASELINE=HEAD=5387c28dd30cd1ed931dad885a39cefd56cafa74; REMOTE=00255f64916d412f20b57ba0954eea8c7b63b26e; AHEAD_BEHIND=18/0; tracked diff was this taskbook Ledger only; staging empty; protected and existing untracked files preserved
ROOT_CAUSE_1=recoverFixture discarded prepareInterruptedJournal()'s changedPaths result and later read the non-existent prepared.changedPaths; no production recovery defect was observed
FIX_1=runner now retains interrupted journal preparation facts, asserts project identity continuity, and uses interrupted.changedPaths for the unexpected-bytes fixture; dead placeholder module/storage reads were removed
FIX_1_GREEN=node --check EXIT=0; CLI agent-transaction-recovery + multi-process-change-concurrency + agent-port-security EXIT=0 (3 files; 25/25); authoring capability/error catalog EXIT=0 (2 files; 11/11); authoring/CLI typecheck and build EXIT=0; regular preflight EXIT=0
FIX_1_COMMIT=fa0a31cd58bacf4748eb347e1d0693816292c601; MESSAGE=fix(cli): preserve recovery fixture paths; SCOPE=runner only
RECOVERY_DIAGNOSTIC_1=EXIT=1; runHead=fa0a31cd58bacf4748eb347e1d0693816292c601; status=FAILED; evidenceClass=DIAGNOSTIC; artifact=<local-path> BYTES=14111 SHA256=BF3A947AEB79D72AB3376F907D216DD1604926ACD312B3359396523E1CC6C52E PRESERVED=YES
RECOVERY_DIAGNOSTIC_1_PROGRESS=last passed lease-matrix; first failed recovery-matrix; failure=unexpected change bytes changed during manual recovery; project bytes were unchanged and all child/timer/lease cleanup passed
ROOT_CAUSE_2=the aggregate compared the entire change directory even though MCP recovery.inspect and the failed recovery.execute must append truthful invocation facts; retained fixture inspection showed only invocations/ changed while manifest, head, records and journals remained byte-identical
FIX_2=hashTree gained an explicit relative-path exclusion; the manual branch now compares all recovery state excluding invocations, asserts record remains OPEN, and requires exactly two truthful invocation facts for successful inspect and RECOVERY_AMBIGUOUS execute
METHOD_IMPROVEMENT=added recovery-preflight mode so the four-state recovery matrix can be validated without spending a full aggregate DIAGNOSTIC; this mode still checks protocol/stderr/child/lease cleanup and original Starter identity
RECOVERY_PREFLIGHT=EXIT=0; status=RECOVERY_PREFLIGHT_PASSED; artifact=<local-path> BYTES=48027 SHA256=AE977BAB307C5EB44B5579DFD8AE1D28FBEC6A89E89DAB9FC7DBB614F68AB2BE; PRE_COMMIT_METHOD_EVIDENCE=YES; artifact.runHead=fa0a31cd58bacf4748eb347e1d0693816292c601 therefore it is not the final frozen code identity
FIX_2_GREEN=node --check EXIT=0; recovery-preflight EXIT=0; regular preflight EXIT=0; git diff --check EXIT=0
FIX_2_COMMIT=6c22115645df537e42722088e5e897cb07398ef8; MESSAGE=test(cli): focus transaction recovery preflight; SCOPE=runner only
PASSING_DIAGNOSTIC=EXIT=0; status=PASSED; evidenceClass=DIAGNOSTIC; runHead=6c22115645df537e42722088e5e897cb07398ef8; artifact=<local-path> BYTES=101956 SHA256=859B1E50B7BDEE0A7B79E417622E5FE3CF2531946D476F1CC251338AC9F4A476
PASSING_NODES=same-change PASSED; different-changes PASSED with PROJECT_BUSY -> session.describe -> PROJECT_CHANGED_SINCE_BEGIN and COMMITTED/STALE; lease-matrix PASSED; recovery-matrix PASSED; mcp-policy-and-envelope PASSED
PASSING_CLEANUP=errors=[]; protocol=[]; stderrUnexpected=[]; childCleanupFailures=[]; all children exited; activeLeaseDirectories=[]; locksReleased=true; original Starter SHA256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6 unchanged
NEXT_STOP=freeze Task 9 evidence identity, then continue Task 10 focused aggregate gate, unique verify:all and unique FORMAL; any new gate failure stops without an unauthorized recovery run
```

### 2026-08-24T21:22:05+08:00 — W4-RUNTIME-PARITY-AND-FIXTURE-RECOVERY stopped at focused CLI gate

```text
AUTHORIZATION=CONTRACT_RECOVERY_DIAGNOSTIC_BUDGET=1; OLD_DIAGNOSTIC_BUDGET=3/3_USED remains historical and was not rewritten; FORMAL=NOT_STARTED; VERIFY_ALL=NOT_RUN
TASK0=AGENTS/spec/plan/runner/historical artifacts and current Git reread; baseline HEAD=c894127d9c177b3f27a4ad004a575fdc8db199e0; tracking=00255f64916d412f20b57ba0954eea8c7b63b26e; AHEAD_BEHIND=14/0
RED_TASK1=authoring-runtime-parity.test.ts run against the pre-fix CLI runtime; EXIT=1 because growth fixture runtime.run-from returned RUNTIME_FAILED with missing GrowthSystem; output=<local-path> BYTES=2198 SHA256=20B74F4997588EDE5DCD6F33EAFCEA1E2FB2BEF88CF6D58F671927C9D580A735 PRESERVED=YES
IMPLEMENTATION=shared runExplicitPath now returns normalized runtime events on success/failure; CLI runtime.run-from uses it and removes duplicate Interpreter/registry/store wiring; different-changes uses the deterministic transaction_runtime_probe fixture; Task 9 evidence text records aggregate external results plus focused replacement events
GREEN_AUTHORING=simulation.test.ts 12/12; authoring typecheck EXIT=0; authoring build EXIT=0
CLI_FOCUSED=after correcting the fixture to canonical content/config/growth.json and building CLI, authoring-runtime-parity.test.ts 2/2 and evidence-seed-contract.test.ts 2/2 passed; agent-port-security.test.ts 11/15 passed and 4 failed
FIRST_FAILED_NODE=agent-port-security.test.ts; failures were unchanged Agent Port session-boundary expectations for resume of COMMITTED/ROLLED_BACK/STALE changes and recovery-failed retry status (expected CHANGE_NOT_OPEN, received SESSION_STATE_INVALID); no files in the security/session path were modified by this authorization
GIT=tracked diff paths remain limited to the six authorized files; protected and existing untracked governance/history artifacts preserved; HEAD=c894127d9c177b3f27a4ad004a575fdc8db199e0; no commit or staging performed
NOT_RUN=node --check; runner preflight; recovery diagnostic; verify:all; FORMAL; Task 10; push/deploy/release/Wave 5
STOP=FOCUSED_CLI_GATE_FAILED; preserve current evidence and wait for a new owner authorization; do not continue to runner commit or any diagnostic
```

### 2026-08-24T22:14:24+08:00 — W4-PROJECT-BUSY-TO-STALE-RECOVERY-1 stopped at recovery diagnostic

```text
AUTHORIZATION=PROJECT_BUSY_TO_STALE_RECOVERY_DIAGNOSTIC_BUDGET=1_CONSUMED; OLD_DIAGNOSTIC_BUDGET=3/3_USED remains historical and was not rewritten; FORMAL=NOT_STARTED; VERIFY_ALL=NOT_RUN
BASELINE=HEAD=c42c048d49cf3fbcdb08dc5a44f683cb3ac9711a; REMOTE=00255f64916d412f20b57ba0954eea8c7b63b26e; AHEAD_BEHIND=17/0; PRE_COMMIT_TRACKED_DIFF=taskbook Ledger only; STAGING=EMPTY
IMPLEMENTED=change.commit possibleErrors now truthfully include CHANGE_BUSY and PROJECT_BUSY; capability-registry focused contract assertion added; aggregate runner records initial loser error/retry disposition, validates session.describe repair, keeps loser port open, performs at most one after-refresh commit, and requires PROJECT_CHANGED_SINCE_BEGIN
GREEN_FOCUS=npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts EXIT=0 (2 files; 11/11); npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-security.test.ts EXIT=0 (2 files; 18/18); authoring/CLI typecheck and build EXIT=0; node --check EXIT=0; preflight EXIT=0; git diff --check EXIT=0
CODE_EVIDENCE_HEAD=5387c28dd30cd1ed931dad885a39cefd56cafa74; CODE_COMMIT=fix(authoring): expose commit conflict recovery; COMMIT_SCOPE=runner, capability registry, capability registry test only; TASKBOOK_LEDGER_NOT_MIXED=YES
RECOVERY_DIAGNOSTIC=one and only one run; EXIT=1; runHead=5387c28dd30cd1ed931dad885a39cefd56cafa74; status=FAILED; evidenceClass=DIAGNOSTIC; artifact=<local-path> BYTES=13963 SHA256=C5B6C44B29E2F4CD2E560F10B3D1215A7EE0D6C2CA89C0A24344A791AEBC5B0A PRESERVED=YES
PROGRESS=last passed node lease-matrix; first failed node recovery-matrix; failure=unexpected recovery fixture has no first path; this is an existing runner recovery-fixture failure after same-change/different-changes/lease-matrix passed
DIFFERENT_CHANGES=initialLoserError=PROJECT_BUSY; initialLoserRetryDisposition=after-refresh; afterRefreshUsed=YES via same loser session session.describe; finalLoserError=PROJECT_CHANGED_SINCE_BEGIN; finalLoserStatus=STALE; winner=COMMITTED; commit request windows overlapped; no final winner-only tree assertion was reached after recovery-matrix stopped the run
PREVIOUS_CIRME_FAILURE=artifact=<local-path> BYTES=3435 SHA256=3D9814F98EB746353588766C63FC726018F5848EC7623708CB16F0A00E3FDE5C PRESERVED=YES; runHead=c42c048d49cf3fbcdb08dc5a44f683cb3ac9711a; lastPassed=same-change; firstFailed=different-changes; failure=loser commit error was PROJECT_BUSY
CLEANUP=current artifact childProcesses exited; protocol=[]; unexpected stderr=[]; childCleanupFailures=[]; activeLeaseDirectories=[]; locksReleased=true
GIT_AFTER=HEAD=5387c28dd30cd1ed931dad885a39cefd56cafa74; REMOTE=00255f64916d412f20b57ba0954eea8c7b63b26e; AHEAD_BEHIND=18/0; tracked diff remains taskbook Ledger only; staging empty; existing governance/protected/history artifacts preserved; PUSH=NOT_PERFORMED
STOP=RECOVERY_DIAGNOSTIC_FAILED; do not repair/rerun; do not run verify:all, FORMAL, Task 10, push, deploy, release or Wave 5; wait for new owner authorization
```
