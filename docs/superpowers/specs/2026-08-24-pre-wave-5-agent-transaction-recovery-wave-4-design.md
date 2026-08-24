# Pre-Wave 5 Agent Transaction Recovery Wave 4 设计规格

> 日期：2026-08-24  
> 状态：方案 3A 已获项目所有者批准，等待书面规格复核  
> 阶段：Pre-Wave 5 Foundation Polish / Wave 4  
> 主题：桌面本地多 Agent 事务管理器  
> 当前授权：设计与任务书；尚未授权实现、push、Wave 5、部署或发行

## 一、执行摘要

Wave 4 要把 Surdet 已有的单进程 authoring change，从“同一 Agent Port 进程内能够串行工作”，提升为“同一台电脑上的多个外部 Agent/CLI 进程能够安全地共享项目和事务目录”。

本轮选择项目所有者批准的 **方案 3A：桌面本地多 Agent 事务管理器**。它由四个不可拆开的纵向能力组成：

1. **非撕裂事务记录：** change record、journal、evidence 和 invocation 等应用数据不再直接覆盖写入；
2. **跨进程互斥与 CAS：** 同一 change 的记录更新串行化，不同 change 可以并行施工；真实项目 commit 由项目锁串行化；
3. **进程重启后的显式恢复：** Agent 能检查 journal 和磁盘身份，在结果完全可判定时恢复，在歧义时 fail-loud；
4. **机器可读恢复引导：** `session.describe`、capability registry 和 MCP 薄适配共同暴露锁、冲突、STALE 与恢复动作。

Surdet 不因此变成分布式数据库。本轮只保证：

```text
同一台电脑
  + 本地文件系统
  + 多个 Node/MCP/CLI 进程
  + 一个显式项目根
  + 项目外 SURDET_AGENT_DATA_DIR
  → 不静默覆盖、可诊断、可显式恢复
```

本轮不保证网络共享盘、多机协同、断电后的硬件级持久化、自动合并冲突或无限等待。任何超出可证明范围的状态都必须停止并交给人，而不是猜测修复。

## 二、为什么现在做

### 2.1 当前能力已经具备的基础

Surdet 当前已经具备：

- `ChangeRecord`、`workingRevision`、幂等 `operationId`；
- `OPEN | COMMITTED | ROLLED_BACK | STALE` 状态；
- staging、replacement、回滚和 commit journal；
- replacement 失败后的进程内恢复；
- Agent Port 会话内 `invocationTail` 串行化；
- stage/apply 策略、验证、模拟、runtime trace、diff 与 delivery capsule；
- Windows rename-only、有限重试、失败保留旧目标与 staged 内容的 R3 合同。

这意味着本轮不需要重写 authoring、commit 或 Agent Port，只需要补上“进程之间”和“进程重启之后”的可靠性边界。

### 2.2 当前源码中已确认的缺口

截至设计基线 `00255f64916d412f20b57ba0954eea8c7b63b26e`：

1. `packages/cli/src/authoring/node-change-store.ts` 的 `writeJson()` 直接 `writeFile(target)`，进程中止可能使共享 JSON 记录不可解析；
2. `transaction.json` 与派生的 `working-files.json` 分两次写入，缺少共同 commit point；
3. `ChangeRepository.write(record)` 没有预期版本，两个进程可能对同一旧快照分别写入，形成 last-write-wins；
4. `workingRevision` 只表示内容版本，validation/simulation/trace 等证据更新不会递增它，不能充当完整记录 CAS；
5. `NodeChangeStore.openByChangeId()` 扫描全部项目目录；一个候选 JSON 损坏可能阻断无关项目的事务查找；
6. commit journal 在 Node 实现中可读取，但 `ChangeRepository` 公共合同只有 `writeJournal()`；共享 authoring 无法实现进程重启恢复；
7. Agent Port resume 使用 `openOwnedChange()`，后者拒绝一切非 `OPEN` 状态，因此 `session.describe()` 中的 `manualRecoveryRequired: record.status === 'STALE'` 在关键路径上不可达；
8. `invokeSerial()` 在自己的错误信封 `try` 之外读取 before snapshot，损坏记录可能以原始异常逃逸，并留下 invocation ledger 缺口；
9. 当前只有单个 `AgentPortSession` 实例内的调用队列，没有跨进程 change 锁和项目 commit 锁。

### 2.3 用户价值

Surdet 的目标不是在引擎内嵌模型，而是让外部电脑端 Agent 更安全、更低上下文地制作 Galgame。多 Agent 并发不是为了炫技，而是为了支持未来真实工作流：

- 一个 Agent 写剧情，另一个 Agent 检查演出或配置；
- 一个 Agent 的进程崩溃后，另一个 Agent 能解释遗留事务；
- 两个 Agent 意外操作同一 change 时不会静默丢失成功结果；
- 两个独立 change 同时准备时互不阻塞，但真实 apply 必须按项目串行；
- 人类能看到谁持有锁、为什么失败、能否重试、是否必须人工处理。

## 三、目标、非目标与完成定义

### 3.1 产品目标

1. 两个独立 Agent Port/CLI 进程并发修改同一 change 时，每次成功 mutation 都保留，或有一个收到确定的冲突错误；绝不静默覆盖。
2. 两个不同 change 可以并行 stage；它们在 commit 时由项目锁串行，并在锁内重新核对项目 revision。
3. 进程在事务记录写入、journal 更新或 project replacement 的规定断点退出后，新进程可以检查真实状态。
4. 恢复只在所有文件均能按 SHA-256 分类为 original/target/absent 时执行；未知内容不碰。
5. `STALE`、锁占用、记录冲突和恢复建议能通过原生合同、CLI 与 MCP 一致呈现。
6. Agent 不需要 Shell、Git 或直接文件系统权限即可完成检查和允许的恢复。

### 3.2 架构目标

- `@surdet/authoring` 定义记录版本、CAS、journal 和恢复状态机；
- `@surdet/cli` 实现 Node 文件记录、租约、进程探测和项目文件适配；
- Agent Port/MCP 只投影共享 capability，不实现第二套恢复算法；
- 正常 mutation、commit、rollback、recovery 使用同一锁顺序；
- 失败证据留存，恢复动作幂等，重复请求不能扩大写入。

### 3.3 明确非目标

本轮不做：

- 多台电脑、网络文件系统、云端锁服务或分布式共识；
- CRDT、OT、自动三方合并或“最后写入者获胜”；
- 允许两个 change 同时写入真实项目；
- 自动启动恢复、自动抢锁、自动 commit 或自动 apply；
- 永久等待锁、后台常驻事务 daemon 或系统服务；
- Git 锁、Git commit/push、部署、打包或发行；
- Core、Renderer、Host、Shell、Editor 产品功能、Starter 内容、Zero、存档格式或游戏运行时修改；
- 为历史临时 acceptance change 自动 migration；
- 删除旧 data root、失败 artifact、旧 journal 或受保护文件；
- 把“临时文件已 `fsync` 且 rename 成功”描述为断电后绝对持久化；
- Wave 5、扩展市场、音频、性能资格化或文档大整理。

### 3.4 完成定义

只有同时满足以下事实，Wave 4 才能请求关闭：

1. 两个真实独立 Node 进程的同-change mutation 红灯在旧实现重现；
2. 新实现中成功 mutation 不丢失，冲突以结构化 CAS/锁错误返回；
3. 不同 change 的 stage 不被项目锁错误串行化；
4. 两个 commit 不能同时进入 replacement；后进入者在锁内看到新项目 revision 并 fail-loud；
5. 新 change store 不再双写 `working-files.json`；历史文件不删除、不迁移；
6. 所有新记录采用明确格式版本、记录版本与内容身份；
7. 失主 change 锁可在严格条件下接管，活锁、异机锁和歧义锁不可接管；
8. commit crash matrix 的所有可判定状态均能显式恢复，歧义状态不修改项目；
9. `STALE` session 能 resume、describe、inspect recovery；只有 apply policy 能 execute recovery；
10. registry、原生 dispatcher、CLI/MCP schema 和文本/structured envelope 一致；
11. 聚焦测试、Authoring/CLI 全套、typecheck/build、唯一正式跨进程聚合和一次 `verify:all` 按任务书通过；
12. 代码证据 HEAD、FORMAL artifact runHead、文档身份与 Git 状态从磁盘回读一致；
13. 独立审核通过后才进入项目所有者 push gate；不自动进入 Wave 5。

## 四、总体架构

```text
外部 Agent A ─┐
              ├─ Agent Port / CLI 进程
外部 Agent B ─┘          │
                         ▼
              @surdet/authoring contracts
              - recordVersion / CAS
              - commit journal state machine
              - recovery inspect/execute
                         │
              @surdet/cli Node adapters
              - NodeChangeStore V2
              - NodeLeaseManager
              - NodeProjectStorage
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
SURDET_AGENT_DATA_DIR              普通 Surdet 项目
- immutable manifest               - project files
- append-only record snapshots     - .surdet-* stage
- journal snapshots                - no hidden Agent schema
- evidence / trace / invocation
- change/project lease directories
```

### 4.1 锁的职责边界

- **change lease：** 保护同一 change 的 record、journal、evidence pointers 和 invocation sequence；
- **project lease：** 保护真实项目一致快照、revision preflight、replacement、journal commit point 与恢复；
- **不同 change 的 stage：** 只取得各自 change lease，可以并行；
- **project.inspect / change.begin 等项目快照读取：** 短暂取得 project lease；禁止在持有 project lease 时再取得 change lease；
- **commit/recovery：** 固定按 `change lease → project lease` 取得；任何代码不得反向取锁；
- **只读 change inspect：** 默认无锁读取不可变 record；需要组合 record+journal 一致视图时短暂取得 change lease；
- **recovery.inspect：** 为取得一致恢复计划，按 `change lease → project lease` 读取后立即释放；
- **delivery capsule：** 短暂取得 change lease读取闭合快照，不得长期持锁。

### 4.2 CAS 的职责边界

锁避免同一时刻的物理写入竞争，CAS 防止调用方基于过时快照提交。

因此二者必须同时存在：

- 仅有锁：后取得锁的旧快照仍可能覆盖新记录；
- 仅有 CAS：多个进程仍可能竞争写文件、journal head 或 invocation sequence；
- 锁内重新读取 + `expectedRecordVersion`：才能让冲突确定、可解释。

## 五、Change Store V2

### 5.1 目录格式

新建 change 使用版本化、单一真相的目录：

```text
<dataRoot>/<projectIdentityHash>/<changeId>/
  manifest.json
  record-head.json
  records/
    0000000000.json
    0000000001.json
  journals/
    0000000001.json
    0000000002.json
  evidence/
  traces/
  invocations/
  diff.json
  capsules/
```

规则：

1. `manifest.json` 创建后不可改，至少包含 `formatVersion=2`、`changeId`、`projectRootIdentity` 和创建时间；
2. `records/<recordVersion>.json` 是不可变完整 `ChangeRecord` 快照；
3. `record-head.json` 只包含当前 `recordVersion`、记录 SHA-256 和格式版本；
4. `transaction.json` 与 `working-files.json` 不再是 V2 真相，也不再为新 change 生成；
5. 历史 V1 目录保持原样，不删除、不迁移；尝试 resume 时返回 `CHANGE_STORE_FORMAT_UNSUPPORTED` 和人工处理说明；
6. evidence、trace、diff 和 invocation 采用非撕裂写入；带唯一 ID 的记录使用 exclusive create，固定名称使用同目录临时文件 + rename-only replacement；
7. 正常读取只接受 head 指向且 SHA-256 匹配的 record；不根据“最大文件名”自动猜测 commit point。

### 5.2 新记录字段

`ChangeRecord` 增加：

```ts
interface ChangeRecord {
  formatVersion: 2;
  recordVersion: number;
  // 其余现有字段保持领域含义
}
```

- `recordVersion` 在任何持久记录变化时递增，包括 evidence freshness、trace、diff、status 和 operation ledger；
- `workingRevision` 只在工作内容变化时递增；
- `operationId` 幂等合同保持不变；
- `recordVersion` 不暴露为创作内容版本，也不代替项目 revision。

### 5.3 CAS 合同

公共仓库写入必须声明前置条件：

```ts
interface ChangeWritePrecondition {
  expectedRecordVersion: number;
  expectedStatus?: ChangeStatus;
}

interface ChangeRepository {
  write(record: ChangeRecord, precondition: ChangeWritePrecondition): Promise<void>;
  readLatestJournal(changeId: string): Promise<CommitJournal | null>;
}
```

写入成功时：

1. 锁内重新读取 head 和当前 record；
2. 检查 `recordVersion` 与 status；
3. 写入 `recordVersion + 1` 的不可变快照；
4. 回读并验证 SHA-256；
5. 原子替换 head；
6. 返回新版本。

前置不匹配返回 `CHANGE_RECORD_CONFLICT`，至少包含：

- changeId；
- expected/actual recordVersion；
- expected/actual status；
- `retryDisposition=after-refresh`；
- repair action：重新 `session.describe`、`change.diff` 或重新打开 change 后，使用同一 `operationId` 重试。

CAS 冲突不得写新 record、不得增加 workingRevision、不得写成功 invocation。

Node 适配层必须提供 `withChangeLease(changeId, callback)`。callback 接收绑定 ownerToken 的 leased repository handle；handle 内的多次 `write()`、`writeJournal()` 和 invocation 写入复用同一 lease，不得递归重新取锁。共享 Authoring 状态机只依赖 `ChangeRepository`/`ProjectWriteStorage`，不 import Node 租约类型。

### 5.4 非撕裂写入边界

Node 层新增单一 JSON record writer：

1. 在目标同目录用 `wx` 创建随机临时文件；
2. 写入 UTF-8 JSON + LF；
3. `FileHandle.sync()`；
4. 从临时文件回读 bytes/SHA-256；
5. 复用现有 rename-only、有界 Windows retry helper 替换固定目标，或对不可变文件直接 rename 到不存在目标；
6. 失败时保留旧目标，清理本轮临时文件，抛出原始结构化错误。

本合同证明进程级中断不应暴露半截 JSON；不把它扩大成硬件断电后绝对持久化保证。

## 六、桌面本地租约

### 6.1 物理格式

锁使用目录创建的排他性，而不是“先检查再写文件”：

```text
<dataRoot>/.locks/changes/<safeChangeId>.lock/lease.json
<dataRoot>/.locks/projects/<projectIdentityHash>.lock/lease.json
<dataRoot>/.locks/stale/<timestamp>-<ownerToken>/...
```

`lease.json` 至少包含：

```ts
interface LocalLease {
  formatVersion: 1;
  scope: 'change' | 'project';
  resourceId: string;
  ownerToken: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
}
```

### 6.2 生命周期

- `mkdir(lockDirectory)` 成功即取得锁；
- ownerToken 使用 `crypto.randomUUID()`，不得使用 PID 作为所有权；
- 默认每 2 秒刷新 heartbeat；15 秒无 heartbeat 才进入 stale 候选；
- release 前必须再次读取 lease，并确认 ownerToken 相同；
- release 失败不得删除其他 owner 的目录；
- 进程正常结束应释放；异常退出由 stale takeover 处理。

测试可通过依赖注入使用短时钟，但产品默认值固定为 2 秒/15 秒，不增加用户配置项。

### 6.3 失主接管

自动接管必须同时满足：

1. lease JSON 完整且 schema 有效；
2. `hostname` 与当前主机一致；
3. heartbeat 超过 15 秒；
4. `process.kill(pid, 0)` 确认原 PID 不存在；
5. 当前调用拥有该 scope 的正常权限。

接管通过单次 rename 将旧 lock 目录移动到 `.locks/stale/`，再竞争创建新 lock。只有 rename 成功的进程可继续。

以下情况禁止自动接管：

- 原 PID 仍存活；
- PID 被复用导致探测为存活；
- hostname 不同；
- heartbeat 未超时；
- lease JSON 损坏或字段缺失；
- stale quarantine rename 失败。

禁止接管时返回 `CHANGE_BUSY`、`PROJECT_BUSY` 或 `LEASE_CORRUPT`，并给出 holder 摘要、retryAfterMs 和人工动作。不得无限轮询。

## 七、Commit 串行化与项目 CAS

### 7.1 固定顺序

`change.commit` 的顺序调整为：

```text
取得 change lease
→ 重新读取最新 ChangeRecord 并检查 expectedRecordVersion/status
→ 取得 project lease
→ 在项目锁内重新 loadProjectSnapshot
→ 检查 baseRevision / changed path 身份
→ 执行现有 staging + replacement + journal
→ 持久化 COMMITTED journal
→ CAS 写 ChangeRecord=COMMITTED
→ best-effort stage cleanup
→ 释放 project lease
→ 释放 change lease
```

两个不同 change 可以同时准备，但第二个进入 commit 的 change 必须在项目锁内看到第一个 commit 后的新 revision。若基线不再匹配，它变为 `STALE` 并返回 `PROJECT_CHANGED_SINCE_BEGIN`，不得自动合并。

所有通过 Surdet Node adapter 读取项目一致快照的入口都必须使用同一 project lease。锁只覆盖 snapshot 读取所需的短窗口；普通 stage mutation 操作既不读取真实项目，也不取得 project lease，因此不同 change 的主要创作过程仍可并行。

### 7.2 Journal V2

共享 Authoring 导出版本化 journal：

```ts
type CommitJournalStatus =
  | 'STAGING'
  | 'REPLACING'
  | 'RECOVERED'
  | 'RECOVERY_FAILED'
  | 'COMMITTED';

interface CommitJournal {
  formatVersion: 2;
  journalVersion: number;
  changeId: string;
  recordVersionAtCommitStart: number;
  projectRevisionAtCommitStart: string;
  status: CommitJournalStatus;
  files: CommitJournalEntry[];
}
```

每次状态或 entry 变化写入新的不可变 `journalVersion` 文件。`readLatestJournal()` 只接受最大连续版本且 changeId/格式有效的快照；缺号、损坏或内容矛盾返回结构化 journal corruption，不猜测。

### 7.3 Invocation ledger

- 每个 invocation 仍是独立不可变文件；
- sequence 在 change lease 内分配；
- `invokeSerial()` 的 before snapshot 读取必须进入 failure envelope 的保护范围；
- 领域调用成功但 invocation 写入失败时，不得把领域结果伪装为未发生；错误必须包含 `operationMayHaveSucceeded=true` 和同一 operationId 的安全重试建议；
- 重试后若 operation 已存在，应返回幂等结果并补写新的调用事实，不重复 mutation。

## 八、显式恢复状态机

### 8.1 两项共享 capability

新增协议无关能力：

1. `change.recovery.inspect`
   - 最低 policy：`observe`；
   - 只读；
   - 允许 OPEN、STALE、COMMITTED、ROLLED_BACK 和无法正常 open 的已知 change；
   - 返回 record/head/journal/lease/project 文件分类及可执行动作。

2. `change.recovery.execute`
   - 最低 policy：`apply`；
   - 必须显式传入 changeId、inspect 返回的 recoveryToken 和 operationId；
   - 取得 change lease，再取得 project lease；
   - token 与当前 record/journal/project 身份不一致时返回 `RECOVERY_PLAN_STALE`；
   - 只执行 inspect 已判定的唯一安全动作。

MCP 工具名按现有机械映射规则生成，不在 adapter 中复制业务判断。

### 8.2 Inspect 输出

```ts
interface RecoveryInspection {
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
  disposition:
    | 'NO_ACTION'
    | 'REOPEN_OPEN'
    | 'ROLL_BACK_TO_BASE'
    | 'FINALIZE_COMMITTED'
    | 'MANUAL_RECOVERY_REQUIRED';
  recoveryToken?: string;
  manualRecoveryRequired: boolean;
  reasons: string[];
}
```

`recoveryToken` 是 inspect 输入事实的规范化 SHA-256，不是授权密钥。execute 必须重新检查全部事实，不能只相信 token。

### 8.3 恢复裁决

#### A. STAGING

若项目仍全部为 base/original，且 stagedIdentity 均位于合法项目路径：

- 删除/清理 staged 文件；
- journal 写 `RECOVERED`；
- record 恢复 `OPEN`；
- workingFiles 和 operation ledger 保留，可重新 validate/simulate/commit。

#### B. REPLACING / RECOVERY_FAILED

逐文件分类：

- 原文件当前 SHA 等于 `originalSha256`：视为未替换或已恢复；
- 当前 SHA 等于 `targetSha256`：视为已替换；
- 新文件不存在且 originalSha256 缺失：视为 original 状态；
- 其他任何内容：`unexpected`。

只有全部文件均为已知状态时，才能按逆序恢复到 base：旧文件用 `baseContents` 恢复，新文件删除。每个动作后重新读取 SHA。全部成功后 journal=`RECOVERED`、record=`OPEN`。

一项 `unexpected`、baseContents 缺失、路径逃逸、symlink/junction、锁歧义或 restore 失败，都必须保留 `STALE`，写 `RECOVERY_FAILED` 证据并停止；不得继续处理其他未知文件。

#### C. COMMITTED journal / record 未闭合

只有全部目标文件均为 target SHA，且项目 revision 与这些目标内容一致时：

- CAS 将 record 补记为 `COMMITTED`；
- staged cleanup 继续 best-effort；
- 不重复 replacement。

若项目为 mixed 或 unexpected，不得标记 COMMITTED。

#### D. RECOVERED journal / record 未闭合

只有项目全部为 base/original 时，record 可恢复为 `OPEN`。否则转人工处理。

#### E. 记录损坏

原子 V2 写入应防止正常进程崩溃产生半截记录。若 manifest/head/record 仍因外部破坏、硬件问题或手工编辑损坏：

- 普通 mutation、commit、rollback 全部 fail-loud；
- recovery.inspect 报告具体损坏层；
- 不从孤儿 record 文件自动推断 head；
- 不删除损坏文件；
- 本轮不提供自动修复损坏 JSON 的能力。

## 九、Agent Port 会话行为

### 9.1 Resume

`--resume-change` 必须能够绑定同项目的 `OPEN` 或 `STALE` change：

- OPEN：保持现有 capability 行为；
- STALE：只开放 describe、inspect、diff/capsule 中安全的只读能力，以及 apply policy 下的 recovery.execute；
- COMMITTED/ROLLED_BACK：允许只读 describe/inspect/capsule，不把它们当 active mutation change；
- unsupported/corrupt：允许 describe recovery fault，但禁止 mutation。

### 9.2 Session description

`session.describe` 必须真实显示：

- change status、recordVersion、workingRevision；
- change/project lease state 和 holder 摘要；
- latest journal status/version；
- `manualRecoveryRequired`；
- 下一合法动作；
- policy 不足时明确指出需要 apply，而不是声称工具不存在。

### 9.3 错误目录

至少新增以下稳定错误代码：

- `CHANGE_RECORD_CONFLICT`
- `CHANGE_BUSY`
- `PROJECT_BUSY`
- `LEASE_CORRUPT`
- `CHANGE_STORE_CORRUPT`
- `CHANGE_STORE_FORMAT_UNSUPPORTED`
- `JOURNAL_CORRUPT`
- `RECOVERY_NOT_REQUIRED`
- `RECOVERY_PLAN_STALE`
- `RECOVERY_AMBIGUOUS`
- `RECOVERY_EXECUTION_FAILED`

每个错误必须登记 category、retryDisposition 和正式 repairActions。不得让 `SyntaxError`、`EEXIST`、`EPERM` 或原始 JSON parse 错误越过公共 envelope。

## 十、红灯与测试设计

### 10.1 第一原则

完整锁/CAS 实现以真实两进程红灯为前提。若旧实现在规定 harness 中没有出现成功结果丢失、记录损坏或 last-write-wins，执行 AI 必须停止在 `RED_NOT_REPRODUCED`，不得仅凭理论风险施工。

红灯必须使用：

- 两个独立 Node child processes；
- 同一个 `SURDET_AGENT_DATA_DIR`；
- 同一个隔离 project fixture；
- 同一个 changeId；
- 不共享进程内 `AgentPortSession` 或 `invocationTail`；
- 固定 barrier，使两个进程都读取同一 recordVersion 后再提交不同 mutation。

### 10.2 永久合同测试

至少覆盖：

1. 同-change 两进程不同 operation：两者成功结果保留，或一方冲突后同 operationId 刷新重试成功；
2. 同-change 相同 operationId/相同 payload：幂等返回，不重复增 workingRevision；
3. 同-change 相同 operationId/不同 payload：`OPERATION_ID_CONFLICT`；
4. 不同 change 并行 stage：彼此不持有 project lease；
5. 两个 commit：replacement 临界区绝不重叠；第二个在锁内发现项目 revision 变化；
6. 活进程 lock 不可接管；
7. 死进程 + 超时 + 同主机 lock 可接管；
8. 异机、损坏、未超时和 PID 仍存活的 lease 不可接管；
9. ownerToken 不匹配时 release 不删除锁；
10. CAS 冲突不产生新 record/head/workingRevision；
11. append-only record/head 在注入的各写入断点后，读取只能得到完整旧版或完整新版；
12. 损坏无关项目记录不阻断已绑定项目 change；
13. V1 record fail-loud 且磁盘不变；
14. invocation before-read 失败进入结构化 envelope；
15. invocation ledger 写失败明确标记 operationMayHaveSucceeded；
16. STAGING、REPLACING、RECOVERY_FAILED、COMMITTED、RECOVERED crash matrix；
17. mixed-known 可回滚，unexpected 一律不写；
18. recoveryToken stale 时零写入；
19. stage policy inspect 可用但 execute policy-blocked；
20. apply policy execute 后 fresh process 能读到最终状态。

### 10.3 正式跨进程聚合

新增一个职责单一的 CLI E2E runner，至少有：

- `preflight`：检查 launcher、cwd、dist、隔离 project/data root、端口/child cleanup；
- `diagnostic`：有界最多 3 次，只用于稳定 runner；
- `formal`：冻结 runner 提交后唯一一次；
- artifact 记录 runHead、子进程 PID/ownerToken 摘要、barrier、operationId、recordVersion/workingRevision 序列、lock 事件、journal/recovery、项目树身份、错误通道和 cleanup；
- FORMAL 完成后确认所有 child、heartbeat timer 和 lock 已释放；
- 失败 artifact 不覆盖、不删除、不筛选。

本轮不需要项目所有者做视觉人工验收，因为没有画面、声音或交互手感变化。外部 LLM Agent 也不是锁/CAS 正确性的可靠证明；正式证据使用确定性双进程客户端。

## 十一、实施边界与文件责任

预期公共落点：

- `packages/authoring/src/contracts.ts`：V2 record、CAS、journal、recovery 类型；
- `packages/authoring/src/change-session.ts`：recordVersion、CAS 调用、commit/recovery 共享状态机；
- `packages/authoring/src/capability-registry.ts`：两项 recovery capability；
- `packages/authoring/src/error-catalog.ts`：稳定错误与修复动作；
- 新的 focused authoring 模块可按职责拆出 `transaction-recovery.ts`，不得继续让 `change-session.ts` 无限膨胀；
- `packages/cli/src/authoring/node-change-store.ts`：V2 store 适配；
- 新建 `node-local-lease.ts`：租约唯一职责；
- 新建 `node-json-record.ts`：非撕裂 JSON record 写入唯一职责；
- `packages/cli/src/authoring/authoring-service.ts`：共享能力的 Node 接线；
- `packages/cli/src/agent-port/session.ts`：会话状态与恢复 capability 调度；
- `packages/cli/src/agent-port/server.ts`：机械投影；
- 聚焦测试和新的跨进程 E2E runner。

不得修改：

- `packages/core/**`
- `packages/renderer/**`
- `packages/host/**`
- `packages/shell/**`
- `packages/editor/**` 生产代码
- `examples/starter/**`
- `games/zero-after-midnight/**`
- 存档 schema、release、pack、性能门限
- 长期路线台账和受保护文件

若现有依赖足以完成，不新增 npm dependency。锁使用 Node 标准库实现；不得引入 native addon、PowerShell 子进程、数据库或常驻服务。

## 十二、实施节奏与停止纪律

建议按以下可独立复审的提交组织：

1. Change Store V2 + 非撕裂 record + CAS；
2. 本地租约 + 同-change 多进程 mutation；
3. project lease + 项目 revision recheck；
4. journal V2 + 显式 recovery inspect/execute；
5. Agent Port registry/session/schema；
6. 跨进程 FORMAL harness；
7. docs-only closure。

每一笔代码提交必须有自己的红灯/绿灯和文件白名单。不得一边修 runner 一边反复运行 FORMAL。正式 runner 取证纪律沿用已验证规则：先有界 DIAGNOSTIC，冻结 runner，再唯一 FORMAL。

以下情况立即停止：

- 两进程业务红灯无法重现；
- 必须修改禁止范围才能继续；
- 发现 Node/Windows 原语不能满足不静默覆盖的最低合同；
- recovery 出现无法按 original/target SHA 分类的项目文件；
- 第 3 次 DIAGNOSTIC 仍失败；
- FORMAL 失败；
- `verify:all` 首次失败且任务书未授权对应 recovery run；
- 发现真实数据损失、真实项目被测试 fixture 修改或锁目录逃逸 data root。

## 十三、新执行 AI 的最小介绍

任务书开头需要保留以下短介绍，不能复制整个项目历史：

> Surdet 是一个面向外部电脑端 Agent 的 AI 友好型 Galgame 引擎。引擎不内嵌模型；Agent 通过共享 `@surdet/authoring` 合同和薄 MCP Agent Port 创作。真实项目体验与数据可靠性优先，所有写入必须可审查、可恢复、不可静默覆盖。本任务只处理同机多进程事务可靠性，不处理游戏内容、Editor UI、音频、性能或 Wave 5 产品能力。

此外，任务书必须要求新执行 AI：

1. 先读取 `AGENTS.md`、本规格、当前任务书和 Wave 3 交付报告；
2. 以执行时实测 HEAD/remote/worktree 为准，不照抄设计基线；
3. 不修改、暂存或提交既有未跟踪治理/受保护文件；
4. 不把网页 Agent、执行 AI 或审核 AI 的角色混在同一报告里；
5. 到停止门后如实停下，不为追求绿灯循环重跑。

## 十四、风险与裁决

### 14.1 复杂度风险

方案 3A 比单纯恢复更复杂，但其组件有严格依赖顺序：record/CAS → lease → commit lock → recovery → Agent Port。不得并行修改相互依赖的共享合同，也不得把它们拆成两套实现。

### 14.2 锁永久残留

通过 heartbeat、同主机 PID 探测、超时和 quarantine rename 处理。安全优先于自动解锁；无法确定时宁可阻断，也不抢锁。

### 14.3 PID 复用

若 PID 被复用，探测结果为“仍存活”，锁保持阻断。这可能产生保守假阳性，但不会造成错误接管，符合本轮优先级。

### 14.4 多文件 commit crash

继续依赖 journal + original/target SHA 分类，不声称底层文件系统提供多文件原子事务。Surdet 的保证是可检测、可回滚或明确人工介入。

### 14.5 旧事务格式

本轮不迁移临时 Agent change。旧格式 fail-loud、保留磁盘证据。若未来真实用户数据需要迁移，必须另立任务并先确认支持范围。

### 14.6 过度验证

不运行 Electron、视觉矩阵、性能资格化、pack、部署或发行。正式成本集中在可重复的双进程/崩溃边界合同和一次聚合。

## 十五、设计批准记录

项目所有者先比较了三种方向：

1. 仅做损坏隔离；
2. 显式事务恢复纵向切片；
3. 完整多进程事务管理器。

随后批准将方案 3 收敛为本规格的 **3A：桌面本地多 Agent 事务管理器**。该批准不等于实现、push、Wave 5、部署或发行授权。

设计创建时的只读基线：

```text
BRANCH = main
HEAD = 00255f64916d412f20b57ba0954eea8c7b63b26e
REMOTE = surdet/main
REMOTE_MAIN = 00255f64916d412f20b57ba0954eea8c7b63b26e
AHEAD_BEHIND = 0/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
```

既有未跟踪治理文件、受保护文件和 CLI artifact 保持原样，未进入本规格提交。
