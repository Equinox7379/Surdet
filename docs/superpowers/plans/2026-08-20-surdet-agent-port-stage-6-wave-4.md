# Surdet Agent Port / Stage 6 Wave 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个绑定单一 Surdet 项目的本地 MCP stdio Agent Port，让外部桌面 Agent 能自行发现并安全调用 Wave 1～3 已有 authoring 能力，在 observe/stage/apply 三档权限下形成可验证、可恢复、可人工复核的 Galgame 创作交付。

**Architecture:** `@surdet/authoring` 提供协议无关的唯一 capability/error/envelope 合同；`@surdet/cli` 继续承载 `AuthoringService`、Node storage/change store，并新增单项目 session、policy gate、T1 工具投影、MCP stdio 入口、调用日志和交付胶囊。MCP adapter 只做协议映射和会话上下文注入，不复制解析、事务、校验、模拟、runtime、diff 或 commit 逻辑。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、现有 `@surdet/authoring` / `@surdet/core` / `@surdet/cli`、`@modelcontextprotocol/server@2.0.0`、`@modelcontextprotocol/core@2.0.0`、测试专用 `@modelcontextprotocol/client@2.0.0`、MCP 2026-07-28 stdio、JSON Schema 2020-12。

## Global Constraints

- 权威设计规格：`docs/superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md`；任何冲突以该规格和项目所有者后续明确裁决为准。
- 已批准产品组合固定为 A1 + A1.1 + P1 + T1 + S1；不得改成 MCP-only、万能 dispatcher、多项目 server、stage-only 或 apply-only。
- Agent Port 不内嵌模型，不提供聊天 UI、sampling、prompts、resources、HTTP、WebSocket、网络、Shell、任意路径、Git、push、部署或发行能力。
- 一个进程只绑定一个显式项目根；工具参数不得出现 `projectRoot`、`changeId`、`cwd` 或任意文件路径。
- policy 只允许 `observe | stage | apply`，由受信启动参数决定，进程生命周期内不可提升。
- stage→apply 必须结束原进程，再以 `--policy apply --resume-change <changeId>` 显式恢复同一 OPEN change。
- Port 退出不得自动 commit 或 rollback；失败 change、journal、trace、invocation 和 artifact 必须保留。
- T1：每项正式 capability 独立映射为一个类型化 MCP 工具；禁止 `surdet_call` 或大型 action 联合工具。
- S1：仅暴露并证明既有 20 项 authoring capability，加 `surdet_session_describe` 与 `surdet_delivery_capsule` 两项 Port 基础设施；不新增领域对象、资产导入、项目审计或新 DSL。
- `@surdet/authoring` 不得依赖 MCP、stdio、Node 文件系统或模型；MCP/Node 依赖只能落在 `@surdet/cli`。
- 不修改 Editor 产品代码以及 Core、Renderer、Host、Shell、Starter、Zero 生产逻辑；原始 Starter 内容、配置和资产保持逐字节不变。
- 不修改存档 schema，不处理 A6、音频、美术生产、性能、扩展市场、Legacy、发行或文档大整理。
- 实施只允许普通本地提交；不得 push、force push、rebase、reset、amend、squash、删除失败证据或清理既有未跟踪治理文件。
- 长期路线台账仍由总经理登记产品裁决；执行 AI 只更新本任务书的 Execution Ledger 与本轮交付报告，不得擅自暂存长期路线台账。
- 每个代码 Task 必须先产生匹配合同的红灯，再做最小绿灯；不得先实现后补一个永远不会失败的测试。
- 文档头部 required sub-skill 只说明执行方法，不构成创建子 AI 或并发施工授权；本项目默认由一个执行 AI 串行完成，只有项目所有者另行给出具体并发目标时才能分派。
- FORMAL 前聚焦测试、typecheck、build、preflight 必须全绿；DIAGNOSTIC 总预算最多 3 次；冻结 `CODE_EVIDENCE_HEAD` 后 FORMAL 只运行一次。
- 最终 `verify:all` 只允许在代码和 runner 冻结后运行一次；失败即记录第一个失败节点并停止，不循环重跑。
- FORMAL 使用确定性 MCP client，不使用大模型；真实外部 Agent 与项目所有者 Editor/预览验收是两个后置、独立证据门。

---

## 一、权威输入与真实基线

执行 AI 必须按以下顺序完整读取：

1. `E:\surdet\AGENTS.md`
2. `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
3. `docs/superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md`
4. 本任务书
5. `docs/PROJECT-LEVEL-AUTHORING-CONFIG-STAGE-6-WAVE-3-DELIVERY-REPORT-2026-08-14.md`
6. `packages/authoring/src/`、`packages/cli/src/authoring/`、`packages/cli/src/authoring-command.ts`、相关测试和 package 配置

任务书生成时的只读基线：

```text
branch = main
planningBaseHead = 4af0d91ea59acc1a6de890df9481a345b503234c
surdet/main = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
ahead/behind = 1 0
tracked worktree = clean
staging area = empty
Wave 4 implementation = NOT STARTED
Wave 4 push = NOT AUTHORIZED
```

执行开始时必须重新读取，不能假定仍相同。若出现本任务书未记录的 tracked 修改、暂存内容、并行施工提交或远端变化，停止在 Task 0，不自行 reset/checkout/stash/clean。

## 二、文件结构与责任锁定

### 2.1 计划新增

| 文件 | 单一责任 |
|---|---|
| `packages/authoring/src/capability-contract.ts` | policy、schema、side effect、幂等性、envelope、repair 等协议无关类型 |
| `packages/authoring/src/capability-registry.ts` | 20 项 capability 的唯一 registry、MCP 名称确定性映射、registry 自检 |
| `packages/authoring/src/error-catalog.ts` | 错误代码、类别、retry disposition 与确定性 repair recipe 唯一真相 |
| `packages/authoring/test/capability-registry.test.ts` | registry 数量、唯一性、完整性、schema 和名称映射红绿灯 |
| `packages/authoring/test/error-catalog.test.ts` | error/retry/repair/envelope 合同红绿灯 |
| `packages/cli/src/authoring/authoring-dispatcher.ts` | 原生 capability ID 到 `AuthoringService` 方法的唯一 Node dispatcher |
| `packages/cli/src/authoring/schema-validator.ts` | 使用 MCP Core JSON Schema adapter 校验 registry input/output；不含领域逻辑 |
| `packages/cli/src/authoring/project-identity.ts` | 从 canonical root identity 生成稳定、不可反推路径的项目身份 |
| `packages/cli/src/agent-port/args.ts` | 严格解析 `--project`、`--policy`、`--resume-change` |
| `packages/cli/src/agent-port/session.ts` | 单项目、单 policy、单活动 change 会话状态与上下文注入 |
| `packages/cli/src/agent-port/policy.ts` | observe/stage/apply 工具允许矩阵与 annotations |
| `packages/cli/src/agent-port/invocation-ledger.ts` | 项目外最小调用事实记录，不保存模型对话 |
| `packages/cli/src/agent-port/delivery-capsule.ts` | 从真实 change/diff/evidence/trace 派生并封装胶囊 |
| `packages/cli/src/agent-port/tool-projection.ts` | registry → T1 MCP tool 的机械投影 |
| `packages/cli/src/agent-port/server.ts` | `McpServer` 构建、tool 注册、structuredContent 映射 |
| `packages/cli/src/agent-port/main.ts` | `serveStdio` 入口、stderr 诊断、signal 清理与退出码 |
| `packages/cli/test/agent-port-session.test.ts` | 项目绑定、policy、resume、单活动 change、退出语义 |
| `packages/cli/test/agent-port-tools.test.ts` | tool discovery、schema、envelope、原生等价性 |
| `packages/cli/test/agent-port-capsule.test.ts` | invocation 与 capsule 身份、stage/apply/rollback 事实 |
| `packages/cli/test/agent-port-security.test.ts` | 越权、跨项目、路径、stdout、child cleanup 反向测试 |
| `packages/cli/e2e/agent-port-wave-4.e2e.mjs` | preflight/diagnostic/formal/acceptance-prep 唯一真实 stdio runner |
| `docs/SURDET-AGENT-PORT-STAGE-6-WAVE-4-DELIVERY-REPORT-2026-08-20.md` | 本 Wave 事实、证据、边界、人工门和停止状态 |

### 2.2 计划修改

| 文件 | 允许修改目的 |
|---|---|
| `packages/authoring/src/contracts.ts` | ChangeIntentMetadata、latest evidence/capsule 所需最小事务元数据 |
| `packages/authoring/src/change-session.ts` | begin metadata 与 evidence freshness 记录；不改变 commit 原子语义 |
| `packages/authoring/src/index.ts` | 导出新协议无关合同 |
| `packages/authoring/test/change-session.test.ts` | intent/evidence metadata 持久化与回滚合同 |
| `packages/cli/src/authoring/authoring-service.ts` | 消费 registry，增加真正只读 project validate/simulate，记录 evidence identity |
| `packages/cli/src/authoring/node-change-store.ts` | 专用 invocation/capsule/evidence/diff/journal 读写接口 |
| `packages/cli/src/authoring-command.ts` | 改为统一 dispatcher/schema/envelope；删除 CLI 私有错误清单 |
| `packages/cli/src/index.ts` | 保持 `surdet` CLI 帮助与原生命令入口一致 |
| `packages/cli/package.json` | 精确依赖、测试依赖、第二 bin |
| `package-lock.json` | 锁定 MCP v2 依赖 |
| `packages/cli/test/authoring-contract.test.ts` | 20 项完整描述与新 envelope 合同 |
| `packages/cli/test/authoring-presentation-wave2.test.ts` | 从旧字符串清单迁移到 registry 描述 |
| `packages/cli/test/authoring-project-config-wave3.test.ts` | 从旧字符串清单迁移到 registry 描述 |
| 本任务书 | Execution Ledger，只记录真实执行事实 |

### 2.3 默认禁止

以下任何 tracked 文件若出现在 diff，立即停止并报告：

```text
packages/core/**
packages/renderer/**
packages/host/**
packages/shell/**
packages/editor/**
examples/starter/**
examples/zero-after-midnight/**
games/**
docs/capabilities.json
docs/capability-matrix.md
SESSION-HANDOFF.md
USER.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

`docs/capabilities.json` 是既有引擎能力矩阵，不是本 Wave 的 authoring registry；不要为了“统一名字”混改它。

## 三、固定公共接口

后续 Task 必须使用以下名字，不得各自发明变体。

```ts
export const AUTHORING_CONTRACT_VERSION = '1.0.0';
export const AUTHORING_ENVELOPE_SCHEMA_VERSION = '1.0.0';
export const DELIVERY_CAPSULE_VERSION = '1.0.0';

export type AutonomyPolicy = 'observe' | 'stage' | 'apply';
export type CapabilityAvailability = 'available' | 'policy-blocked' | 'state-blocked';
export type RetryDisposition =
  | 'same-request'
  | 'after-inspect'
  | 'after-repair'
  | 'new-change'
  | 'manual-recovery'
  | 'never';

export interface InvocationContext {
  sessionId: string;
  projectRoot?: string;
  projectIdentity: string;
  policy: AutonomyPolicy;
  activeChangeId?: string;
}

export interface DispatchRequest {
  capability: AuthoringCapabilityId;
  input: Record<string, unknown>;
  context: InvocationContext;
}

export function dispatchAuthoringCapability(
  service: AuthoringService,
  request: DispatchRequest,
): Promise<AuthoringEnvelope<unknown>>;

export function nativeCapabilityToMcpTool(id: AuthoringCapabilityId): string;
export function createAgentPortServer(session: AgentPortSession): McpServer;
export function openAgentPortSession(options: AgentPortOptions): Promise<AgentPortSession>;
export function generateDeliveryCapsule(session: AgentPortSession): Promise<SealedDeliveryCapsule>;
```

Port 工具名固定：

```text
surdet_session_describe
surdet_capabilities_describe
surdet_project_inspect
surdet_project_assets
surdet_object_inspect
surdet_change_begin
surdet_scene_create
surdet_scene_patch
surdet_variable_ensure
surdet_character_ensure
surdet_character_remove
surdet_timeline_create
surdet_timeline_patch
surdet_project_entry_scene_set
surdet_project_validate
surdet_project_simulate
surdet_runtime_run_from
surdet_runtime_read_trace
surdet_change_diff
surdet_change_commit
surdet_change_rollback
surdet_delivery_capsule
```

---

### Task 0: 权威基线、依赖事实与施工闸门

**Files:**
- Read: `AGENTS.md`
- Read: `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
- Read: `docs/superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md`
- Read: `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`
- Modify: `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`（仅 Execution Ledger，暂不暂存）

**Interfaces:**
- Consumes: 项目所有者后续明确的“批准实施”授权；没有该授权不得执行本 Task 之后的代码步骤。
- Produces: 新鲜 Git/依赖/工作树基线与允许施工的唯一范围。

- [ ] **Step 1: 读取六类权威输入并记录真实 Git**

Run（使用 `pwsh`）：

```powershell
Set-Location E:\surdet
git status --short --branch
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git log --oneline -8
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：tracked 工作树干净、暂存区为空；只存在台账已知未跟踪治理文件。若不一致，停止，不执行 install、test 或代码修改。

- [ ] **Step 2: 核对官方 MCP 依赖身份**

```powershell
npm view @modelcontextprotocol/server@2.0.0 version license engines --json
npm view @modelcontextprotocol/core@2.0.0 version license engines --json
npm view @modelcontextprotocol/client@2.0.0 version license engines --json
```

Expected：三者 version=`2.0.0`、license=`MIT`、Node engine 与仓库 `>=20` 兼容。任何事实不一致都停止，请 Architect 复审依赖；不得自动改用 v1 或另一个 MCP 实现。

Task 0 同时只读核对官方文档：

- `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md`
- `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md`
- `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md`

确认 v2 仍使用 `McpServer.registerTool`、`serveStdio`、`Client` 与 `StdioClientTransport`；若官方 2.0.0 包的实际 `.d.ts` 与任务书调用签名冲突，以已锁定包的真实类型为准做最小机械调整，并在 Ledger 精确记录，不得改产品边界。

- [ ] **Step 3: 记录 Task 0 Ledger**

在本任务书 `Execution Ledger` 末尾追加：时间、HEAD、远端关系、工作树、依赖事实、实施授权原文、当前状态 `TASK_0_BASELINE_CONFIRMED`。该修改保持未暂存，直到文档闭合 Task。

No commit in Task 0.

---

### Task 1: 协议无关 capability registry

**Files:**
- Create: `packages/authoring/src/capability-contract.ts`
- Create: `packages/authoring/src/capability-registry.ts`
- Create: `packages/authoring/test/capability-registry.test.ts`
- Modify: `packages/authoring/src/index.ts`

**Interfaces:**
- Consumes: 现有 20 项 capability ID 与 `contracts.ts` 输入类型。
- Produces: `AUTHORING_CAPABILITY_REGISTRY`、`AUTHORING_CAPABILITY_IDS`、`getCapabilityDefinition()`、`nativeCapabilityToMcpTool()`、`assertCapabilityRegistry()`。

- [ ] **Step 1: 写 registry 红灯**

测试必须至少包含：

```ts
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_CAPABILITY_IDS,
  AUTHORING_CAPABILITY_REGISTRY,
  assertCapabilityRegistry,
  nativeCapabilityToMcpTool,
} from '../src/index.js';

describe('authoring capability registry', () => {
  it('is the single complete 20-capability contract', () => {
    expect(AUTHORING_CAPABILITY_IDS).toHaveLength(20);
    expect(new Set(AUTHORING_CAPABILITY_IDS).size).toBe(20);
    expect(AUTHORING_CAPABILITY_IDS).toEqual([
      'capabilities.describe', 'project.inspect', 'project.assets', 'object.inspect',
      'change.begin', 'scene.create', 'scene.patch', 'variable.ensure',
      'character.ensure', 'character.remove', 'timeline.create', 'timeline.patch',
      'project.entry-scene.set', 'project.validate', 'project.simulate',
      'runtime.run-from', 'runtime.read-trace', 'change.diff', 'change.commit',
      'change.rollback',
    ]);
    expect(() => assertCapabilityRegistry(AUTHORING_CAPABILITY_REGISTRY)).not.toThrow();
  });

  it('maps native ids to unique stable MCP tool names', () => {
    const names = AUTHORING_CAPABILITY_IDS.map(nativeCapabilityToMcpTool);
    expect(new Set(names).size).toBe(20);
    expect(nativeCapabilityToMcpTool('project.entry-scene.set'))
      .toBe('surdet_project_entry_scene_set');
    expect(nativeCapabilityToMcpTool('runtime.run-from'))
      .toBe('surdet_runtime_run_from');
  });

  it('requires strict schemas, side effects, errors, repairs and examples', () => {
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.additionalProperties).toBe(false);
      expect(definition.outputSchema).toBeTruthy();
      expect(definition.sideEffects.length).toBeGreaterThan(0);
      expect(definition.possibleErrors.length).toBeGreaterThan(0);
      expect(definition.minimalExample.input).toEqual(expect.any(Object));
    }
  });
});
```

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts
```

Expected：exit `1`，首个失败为新导出不存在；保留输出到 Task Ledger，不创建 `.log`。

- [ ] **Step 3: 实现公共合同类型**

`capability-contract.ts` 必须定义以下实际类型，不依赖 MCP：

```ts
export const AUTHORING_CONTRACT_VERSION = '1.0.0' as const;
export const AUTHORING_ENVELOPE_SCHEMA_VERSION = '1.0.0' as const;
export const DELIVERY_CAPSULE_VERSION = '1.0.0' as const;

export type AutonomyPolicy = 'observe' | 'stage' | 'apply';
export type CapabilityAvailability = 'available' | 'policy-blocked' | 'state-blocked';
export type SideEffectClass =
  | 'none' | 'project-read' | 'change-store-read' | 'change-store-write'
  | 'project-write' | 'runtime-process' | 'evidence-write';
export type IdempotencyClass =
  | 'pure-read' | 'idempotent' | 'operation-id' | 'non-idempotent';
export type RetryDisposition =
  | 'same-request' | 'after-inspect' | 'after-repair'
  | 'new-change' | 'manual-recovery' | 'never';
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface CapabilityDefinition<TId extends string = string> {
  id: TId;
  title: string;
  purpose: string;
  minimumPolicy: AutonomyPolicy;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffects: readonly SideEffectClass[];
  idempotency: IdempotencyClass;
  preconditions: readonly string[];
  possibleErrors: readonly string[];
  repairRecipes: readonly string[];
  minimalExample: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly expectedResultShape: JsonSchema;
  };
}
```

`capability-contract.ts` 不得 import `capability-registry.ts`。`AuthoringCapabilityId` 必须在 registry 文件中从常量 tuple 推导，再声明 `type AuthoringCapabilityDefinition = CapabilityDefinition<AuthoringCapabilityId>`；这样既没有第二份 union，也没有 contract↔registry 循环依赖。

- [ ] **Step 4: 实现 20 项 registry**

registry 必须按下表逐项填写，输入 schema 只描述 capability payload；`projectRoot` 与 `changeId` 属于 invocation context，不进入 schema。

| ID | 最低 policy | payload 必填 | sideEffects | idempotency |
|---|---|---|---|---|
| capabilities.describe | observe | 无 | none | pure-read |
| project.inspect | observe | 无 | project-read | pure-read |
| project.assets | observe | 无 | project-read | pure-read |
| object.inspect | observe | objectRef | project-read/change-store-read | pure-read |
| change.begin | stage | 可选 intent/acceptanceCriteria/initiator | project-read/change-store-write | non-idempotent |
| scene.create | stage | operationId/sceneId，可选 blocks | change-store-write | operation-id |
| scene.patch | stage | operationId/patch，可选 sceneId | change-store-write | operation-id |
| variable.ensure | stage | operationId/name/type/initial | change-store-write | operation-id |
| character.ensure | stage | operationId/id/name/expectedFingerprint | change-store-write | operation-id |
| character.remove | stage | operationId/id/expectedFingerprint | change-store-write | operation-id |
| timeline.create | stage | operationId/timelineId/definition | change-store-write | operation-id |
| timeline.patch | stage | operationId/timelineId/patch | change-store-write | operation-id |
| project.entry-scene.set | stage | operationId/sceneId/expectedFingerprint | change-store-write | operation-id |
| project.validate | observe | 无 | project-read/evidence-write | idempotent |
| project.simulate | observe | 可选 sceneId | project-read/evidence-write | idempotent |
| runtime.run-from | stage | sceneId/choices，可选 label/variables/maxSteps/seed | runtime-process/evidence-write | non-idempotent |
| runtime.read-trace | observe | traceId，可选 query | change-store-read | pure-read |
| change.diff | observe | 无 | change-store-read/evidence-write | idempotent |
| change.commit | apply | 无 | project-write/change-store-write | non-idempotent |
| change.rollback | stage | 无 | change-store-write | idempotent |

每项 output schema 的 `result` 至少关闭并声明以下一级字段；嵌套对象继续按现有 TypeScript 返回类型展开，不能用空对象或 `additionalProperties:true` 代替：

| ID | result 一级字段 |
|---|---|
| capabilities.describe | contractVersion, capabilities |
| project.inspect | rootIdentity, revision, scenes, variables, characters, assets, objectCount, referenceCount，可选 entryScene/title |
| project.assets | backgrounds, portraits, avatars |
| object.inspect | kind, objectRef, references, referencedBy，可选 semanticId/parentRef/source/details/fingerprint |
| change.begin | changeId, baseRevision, workingRevision |
| scene.create | sceneId, path |
| scene.patch | path, line, kind |
| variable.ensure | name, created |
| character.ensure/remove | id, objectRef, fingerprint, diffEntry，可选 created/removed/speakerMigrations |
| timeline.create | timelineId, path, objectRef, fingerprint, diffEntry |
| timeline.patch | timelineId, objectRef, fingerprint, diffEntry |
| project.entry-scene.set | sceneId, entryScene, fingerprint, diffEntry |
| project.validate | view, ok, issues，可选 evidenceId |
| project.simulate | view, status, report，可选 evidenceId |
| runtime.run-from | view, traceId, status, sceneId, choices, finalVariables, eventCount |
| runtime.read-trace | traceId, events, count, freshness |
| change.diff | summary, semantic, files, evidenceId, freshness |
| change.commit | changeId, status, files |
| change.rollback | changeId, status |

上述字段来自当前 `operations.ts`、`timeline-operations.ts` 与 `config-operations.ts` 的真实返回接口；不得为写 schema 改变 mutation 领域返回，也不得留下 permissive output schema。

所有 schema 使用 `$schema: 'https://json-schema.org/draft/2020-12/schema'`、`type:'object'`、`additionalProperties:false`。复杂输入的 nested object 同样关闭未知字段；不得用顶层 `Record<string, unknown>` 逃避 schema。

- [ ] **Step 5: 实现 registry 自检与名称映射**

```ts
export function nativeCapabilityToMcpTool(id: AuthoringCapabilityId): string {
  return `surdet_${id.replace(/[.-]/g, '_')}`;
}

export function assertCapabilityRegistry(
  definitions: readonly CapabilityDefinition[],
): void {
  if (definitions.length !== 20) throw new Error(`authoring registry 必须是 20 项，实际 ${definitions.length}`);
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`重复 capability id：${definition.id}`);
    ids.add(definition.id);
    const tool = nativeCapabilityToMcpTool(definition.id);
    if (tools.has(tool)) throw new Error(`MCP tool name 碰撞：${tool}`);
    tools.add(tool);
    if (definition.inputSchema['additionalProperties'] !== false) {
      throw new Error(`${definition.id} inputSchema 必须拒绝未知字段`);
    }
  }
}
```

- [ ] **Step 6: 运行绿灯、typecheck、build**

```powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

Expected：三条 exit `0`。

- [ ] **Step 7: 精确提交 Task 1**

```powershell
git add -- packages/authoring/src/capability-contract.ts packages/authoring/src/capability-registry.ts packages/authoring/src/index.ts packages/authoring/test/capability-registry.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(authoring): define agent capability registry"
```

提交范围只能是上述四个文件。立即把 commit、命令结果和下一状态写入未暂存 Task Ledger。

---

### Task 2: 统一错误目录、repair contract 与 envelope

**Files:**
- Create: `packages/authoring/src/error-catalog.ts`
- Create: `packages/authoring/test/error-catalog.test.ts`
- Modify: `packages/authoring/src/capability-contract.ts`
- Modify: `packages/authoring/src/capability-registry.ts`
- Modify: `packages/authoring/src/index.ts`

**Interfaces:**
- Consumes: Task 1 registry 与 `AuthoringOperationError`。
- Produces: `AuthoringErrorCode`、`AUTHORING_ERROR_CATALOG`、`normalizeAuthoringError()`、`createSuccessEnvelope()`、`createFailureEnvelope()`、`createEnvelopeJsonSchema()`。

- [ ] **Step 1: 写错误/修复红灯**

```ts
it('turns stale object failures into an inspect-first repair contract', () => {
  const envelope = createFailureEnvelope({
    sessionId: 's1', capability: 'scene.patch', projectIdentity: 'p1',
  }, new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'fingerprint stale'));
  expect(envelope.ok).toBe(false);
  if (envelope.ok) throw new Error('expected failure');
  expect(envelope.error.retryDisposition).toBe('after-inspect');
  expect(envelope.error.repairActions).toEqual(expect.arrayContaining([
    expect.objectContaining({ capability: 'object.inspect' }),
  ]));
});

it('marks recovery failure terminal and manual', () => {
  const error = errorDefinition('COMMIT_RECOVERY_FAILED');
  expect(error.retryDisposition).toBe('manual-recovery');
  expect(error.repairActions.every((action) => action.terminal)).toBe(true);
});
```

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/authoring -- error-catalog.test.ts
```

Expected：exit `1`，失败原因为新 API 不存在。

- [ ] **Step 3: 定义完整 error catalog**

必须收纳现有 CLI 的全部错误，并增加 Port 状态所需的 `SESSION_STATE_INVALID`、`POLICY_BLOCKED`、`PROJECT_IDENTITY_MISMATCH`、`CONTRACT_VERSION_UNSUPPORTED`：

```ts
export const AUTHORING_ERROR_CODES = [
  'CAPABILITY_UNAVAILABLE', 'INVALID_REQUEST', 'UNSUPPORTED_OBJECT_KIND',
  'UNSUPPORTED_OPERATION', 'PROJECT_NOT_FOUND', 'PROJECT_INVALID',
  'PATH_OUTSIDE_PROJECT', 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS',
  'OBJECT_REF_STALE', 'OBJECT_PRECONDITION_FAILED', 'CHANGE_NOT_FOUND',
  'CHANGE_NOT_OPEN', 'CHANGE_ID_AMBIGUOUS', 'OPERATION_ID_CONFLICT',
  'PROJECT_CHANGED_SINCE_BEGIN', 'VALIDATION_REQUIRED', 'VALIDATION_STALE',
  'VALIDATION_FAILED', 'SIMULATION_REQUIRED', 'SIMULATION_INCOMPLETE',
  'RUNTIME_EVIDENCE_REQUIRED', 'RUNTIME_FAILED', 'RUNTIME_TIMED_OUT',
  'COMMIT_FAILED_RECOVERED', 'COMMIT_RECOVERY_FAILED',
  'SESSION_STATE_INVALID', 'POLICY_BLOCKED', 'PROJECT_IDENTITY_MISMATCH',
  'CONTRACT_VERSION_UNSUPPORTED',
] as const;

export type AuthoringErrorCode = (typeof AUTHORING_ERROR_CODES)[number];
export type ErrorCategory =
  | 'request' | 'not-found' | 'conflict' | 'validation' | 'runtime' | 'commit';

export interface RepairAction {
  capability?: AuthoringCapabilityId | 'session.describe';
  reason: string;
  requiredFreshFacts?: string[];
  inputTemplate?: Readonly<Record<string, unknown>>;
  terminal?: boolean;
}
```

每项 definition 必须有 `category`、`retryDisposition`、`repairActions`。关键映射固定：

```text
OBJECT_REF_STALE / OBJECT_PRECONDITION_FAILED → after-inspect → object.inspect
VALIDATION_REQUIRED / VALIDATION_STALE → after-repair → project.validate
VALIDATION_FAILED → after-repair → issue 指定 typed mutation + project.validate
SIMULATION_REQUIRED → after-repair → project.simulate
RUNTIME_EVIDENCE_REQUIRED → after-repair → runtime.run-from + runtime.read-trace
PROJECT_CHANGED_SINCE_BEGIN → new-change → project.inspect + change.begin
OPERATION_ID_CONFLICT → never（同一 operationId 不可换负载）
POLICY_BLOCKED → never → 由项目所有者重启 Port
COMMIT_FAILED_RECOVERED → after-inspect → session.describe + project.inspect
COMMIT_RECOVERY_FAILED → manual-recovery，terminal=true
CONTRACT_VERSION_UNSUPPORTED → never
```

其余代码的 category/retry 固定如下，执行者不得凭 message 临时猜测：

| code | category | retryDisposition |
|---|---|---|
| CAPABILITY_UNAVAILABLE | request | never |
| INVALID_REQUEST | request | same-request |
| UNSUPPORTED_OBJECT_KIND / UNSUPPORTED_OPERATION | request | never |
| PROJECT_NOT_FOUND | not-found | after-inspect |
| PROJECT_INVALID | validation | after-repair |
| PATH_OUTSIDE_PROJECT | conflict | never |
| OBJECT_NOT_FOUND / OBJECT_AMBIGUOUS | not-found | after-inspect |
| CHANGE_NOT_FOUND | not-found | never |
| CHANGE_NOT_OPEN | conflict | never |
| CHANGE_ID_AMBIGUOUS | conflict | manual-recovery |
| SIMULATION_INCOMPLETE | validation | after-repair |
| RUNTIME_FAILED / RUNTIME_TIMED_OUT | runtime | after-repair |
| SESSION_STATE_INVALID | conflict | after-repair |
| PROJECT_IDENTITY_MISMATCH | conflict | never |

`normalizeAuthoringError()` 优先接受 `AuthoringOperationError.code/details`；未知异常只归为 `INVALID_REQUEST` 或已有明确边界错误，禁止继续用“消息包含 Scene/JSON”等启发式覆盖真实 code。

- [ ] **Step 4: 实现统一 envelope**

成功/失败必须共享：

```ts
interface EnvelopeBase {
  schemaVersion: typeof AUTHORING_ENVELOPE_SCHEMA_VERSION;
  contractVersion: typeof AUTHORING_CONTRACT_VERSION;
  sessionId: string;
  capability: AuthoringCapabilityId | 'session.describe' | 'delivery.capsule';
  projectIdentity: string;
  projectRevision?: string;
  changeId?: string;
  workingRevision?: number;
  operationId?: string;
}

export type AuthoringEnvelope<T> =
  | (EnvelopeBase & { ok: true; result: T })
  | (EnvelopeBase & {
      ok: false;
      error: {
        code: AuthoringErrorCode;
        category: ErrorCategory;
        message: string;
        details?: Record<string, unknown>;
        retryDisposition: RetryDisposition;
        repairActions: RepairAction[];
      };
    });
```

`RepairAction` 在 registry/error catalog 中保存原生 `capability`，MCP 投影时再机械转换为 tool name；不得把 `surdet_*` 名称硬编码进共享 authoring 包。

`createEnvelopeJsonSchema(resultSchema)` 必须返回 success/failure 的严格 `oneOf`：success 分支的 `result` 使用该 capability 的 output schema，failure 分支包含完整 error/retry/repair 字段。MCP `outputSchema` 与 native CLI envelope 都使用它，不能让 MCP 只声明 result 却实际返回 envelope。

- [ ] **Step 5: 删除模糊 retry 模型的合同可能性**

测试必须断言 envelope 不包含：

```ts
expect(JSON.stringify(envelope)).not.toContain('"retriable"');
expect(JSON.stringify(envelope)).not.toContain('"action"');
```

`actionFor()` 的自由文本模型将在 Task 4 从 CLI 删除。

- [ ] **Step 6: 运行聚焦绿灯**

```powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

- [ ] **Step 7: 精确提交 Task 2**

```powershell
git add -- packages/authoring/src/error-catalog.ts packages/authoring/src/capability-contract.ts packages/authoring/src/capability-registry.ts packages/authoring/src/index.ts packages/authoring/test/error-catalog.test.ts
git diff --cached --check
git commit -m "feat(authoring): define repairable agent envelopes"
```

---

### Task 3: Change 意图元数据、证据 freshness 与 observe 只读路径

**Files:**
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/src/change-session.ts`
- Modify: `packages/authoring/test/change-session.test.ts`
- Create: `packages/cli/src/authoring/project-identity.ts`
- Modify: `packages/cli/src/authoring/node-change-store.ts`
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Create: `packages/cli/test/authoring-observe-mode.test.ts`

**Interfaces:**
- Consumes: 现有 `ChangeRecord`、validation/simulation/runtime evidence。
- Produces: `ChangeIntentMetadata`、latest evidence 元数据、`validateProject()`、`simulateProject()`，且 observe 不建立 change。

- [ ] **Step 1: 写 change metadata 红灯**

```ts
it('persists bounded intent metadata outside project contents', async () => {
  const metadata = {
    intent: '建立 Agent Port 演示分支',
    acceptanceCriteria: ['双分支可达', '使用既有背景'],
    initiator: 'external-agent' as const,
  };
  const change = await beginChange(snapshot, repository, undefined, metadata);
  expect(change.record.intent).toEqual(metadata);
  expect(change.record.workingFiles).toEqual(change.record.baseContents);
});

it('records simulation and runtime freshness without changing workingRevision', async () => {
  const repository = new InMemoryChangeRepository();
  const change = await beginChange(snapshot, repository);
  const revision = change.record.workingRevision;
  await recordSimulationEvidence(change, { evidenceId: 'sim-1', status: 'passed' });
  await recordRuntimeTrace(change, { traceId: 'trace-1', status: 'passed' });
  expect(change.record.workingRevision).toBe(revision);
  expect(change.record.latestSimulation).toEqual({
    evidenceId: 'sim-1', status: 'passed', workingRevision: revision,
  });
  expect(change.record.runtimeTraces).toEqual([
    { traceId: 'trace-1', status: 'passed', workingRevision: revision },
  ]);
});
```

该测试复用 `change-session.test.ts` 已有 `snapshot` fixture；若名称不同，只允许复用同等现有 fixture，不新造第二套 snapshot loader。

- [ ] **Step 2: 写 observe 红灯**

```ts
it('validates and simulates a project snapshot without creating a change', async () => {
  const before = fs.readdirSync(agentDataDir, { recursive: true });
  const validation = await service.validateProject(projectRoot);
  const simulation = await service.simulateProject(projectRoot, { sceneId: 'ch01_01' });
  const after = fs.readdirSync(agentDataDir, { recursive: true });
  expect(validation.result.view).toBe('project');
  expect(simulation.result.view).toBe('project');
  expect(after).toEqual(before);
});
```

- [ ] **Step 3: 运行双红灯**

```powershell
npm run test -w @surdet/authoring -- change-session.test.ts
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- authoring-observe-mode.test.ts
```

Expected：前两条/第三条至少一条 exit `1`，明确缺少新签名或只读方法。

- [ ] **Step 4: 扩展 ChangeRecord**

```ts
export interface ChangeIntentMetadata {
  intent?: string;
  acceptanceCriteria?: string[];
  initiator?: 'external-agent' | 'human' | 'automation';
}

export interface ChangeRecord {
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
  runtimeTraces?: {
    traceId: string;
    workingRevision: number;
    status: 'passed';
  }[];
  latestDiff?: {
    workingRevision: number;
    evidenceId: string;
  };
}

export interface EvidenceFreshness {
  evidenceId?: string;
  status: 'missing' | 'fresh' | 'stale' | 'failed' | 'incomplete';
  workingRevision?: number;
  currentWorkingRevision?: number;
}
```

元数据限制：intent 最长 2,000 字符；acceptanceCriteria 最多 20 项、每项 500 字符；超限 `INVALID_REQUEST`。不得保存模型完整对话。

- [ ] **Step 5: 修改 begin 与 evidence recorder**

`beginChange` 第四参数固定为 `intent?: ChangeIntentMetadata`。新增：

```ts
export async function recordSimulationEvidence(
  change: ChangeSession,
  input: { evidenceId: string; status: 'passed' | 'failed' | 'incomplete' },
): Promise<void>;

export async function recordRuntimeTrace(
  change: ChangeSession,
  input: { traceId: string; status: 'passed' },
): Promise<void>;

export async function recordDiffEvidence(
  change: ChangeSession,
  input: { evidenceId: string },
): Promise<void>;
```

任何 mutation 成功后仍清除 `latestValidation`，同时将旧 simulation/runtime/diff 通过 workingRevision 标记为 stale；不删除旧 evidence。

- [ ] **Step 6: 实现真正只读 project validate/simulate**

`AuthoringService` 增加：

```ts
async validateProject(projectRoot: string): Promise<ServiceResult<{
  view: 'project';
  ok: boolean;
  issues: unknown[];
}>>;

async simulateProject(projectRoot: string, input?: { sceneId?: string }): Promise<ServiceResult<{
  view: 'project';
  status: 'passed';
  report: ReturnType<typeof simulateSnapshot>;
}>>;
```

共享内部 helper 必须接收 `ProjectStorage/ProjectSnapshot`，不能通过 `begin()` + `rollback()` 伪造 observe。只读调用不写 change store；其结果不能成为 commit validation gate。

- [ ] **Step 7: 统一稳定 project identity**

新增：

```ts
import * as crypto from 'node:crypto';

export function projectIdentityFromRoot(rootIdentity: string): string {
  return crypto.createHash('sha256').update(rootIdentity).digest('hex').slice(0, 32);
}
```

`NodeChangeStore` 删除其私有项目哈希逻辑并复用该 helper。`ServiceMetadata` 增加必填 `projectIdentity`；所有 project/change service result 都从 canonical `rootIdentity` 生成它，`capabilities.describe` 使用字面值 `unbound`。envelope 不得把本机绝对项目路径冒充 projectIdentity。

同时纠正 revision 语义：active change 的 `projectRevision` 始终是 `record.baseRevision`（commit 成功后才是新鲜磁盘 revision），`workingRevision` 是事务整数序号；若 evidence 需要 working files 的内容哈希，使用独立 `workingSnapshotRevision` 字段。不得继续把 `context.snapshot.revision` 填进 `projectRevision`，否则 Agent 无法区分真实项目基线与隔离内容。

`authoring-observe-mode.test.ts` 必须断言：stage mutation 后 `projectRevision===baseRevision`、`workingRevision>0`、`workingSnapshotRevision!==baseRevision`，且真实项目磁盘仍为 baseRevision。

- [ ] **Step 8: 让 working-view evidence 可追踪**

`validate(changeId)`、`simulate(changeId)`、`runFrom(changeId)`、`diff(changeId)` 在真实写入 evidence 后调用对应 recorder，并在 result 中显式返回 `view:'working'`、`evidenceId/traceId` 与 freshness revision。不得改变现有运行语义或 commit recovery。

- [ ] **Step 9: 运行聚焦绿灯与相邻回归**

```powershell
npm run test -w @surdet/authoring -- change-session.test.ts commit-recovery.test.ts
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- authoring-observe-mode.test.ts authoring-vertical-slice.test.ts
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [ ] **Step 10: 精确提交 Task 3**

```powershell
git add -- packages/authoring/src/contracts.ts packages/authoring/src/change-session.ts packages/authoring/test/change-session.test.ts packages/cli/src/authoring/project-identity.ts packages/cli/src/authoring/node-change-store.ts packages/cli/src/authoring/authoring-service.ts packages/cli/test/authoring-observe-mode.test.ts
git diff --cached --check
git commit -m "feat(authoring): preserve agent change evidence"
```

---

### Task 4: 唯一 dispatcher、schema 校验与原生 CLI 迁移

**Files:**
- Create: `packages/cli/src/authoring/schema-validator.ts`
- Create: `packages/cli/src/authoring/authoring-dispatcher.ts`
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Modify: `packages/cli/src/authoring-command.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`
- Modify: `package-lock.json`
- Modify: `packages/cli/test/authoring-contract.test.ts`
- Modify: `packages/cli/test/authoring-presentation-wave2.test.ts`
- Modify: `packages/cli/test/authoring-project-config-wave3.test.ts`

**Interfaces:**
- Consumes: Task 1 registry、Task 2 envelope、Task 3 service。
- Produces: `dispatchAuthoringCapability()`；CLI 与后续 MCP 共用同一 dispatcher/schema/envelope。

- [ ] **Step 1: 写 CLI 合同红灯**

更新 `authoring-contract.test.ts`：

```ts
it('describes 20 complete registered definitions', () => {
  const result = runCli(['capabilities', 'describe', '--json']);
  const body = JSON.parse(result.stdout);
  expect(result.status).toBe(0);
  expect(body.contractVersion).toBe('1.0.0');
  expect(body.result.capabilities).toHaveLength(20);
  expect(body.result.capabilities[0]).toEqual(expect.objectContaining({
    id: 'capabilities.describe',
    mcpTool: 'surdet_capabilities_describe',
    minimumPolicy: 'observe',
    inputSchema: expect.any(Object),
    outputSchema: expect.any(Object),
  }));
});

it('rejects unknown input fields before service dispatch', () => {
  const input = writeJson(requestDir, 'invalid-scene.json', {
    operationId: 'op-invalid', sceneId: 'blocked', projectRoot: root,
  });
  const before = fs.readdirSync(root, { recursive: true });
  const result = runCli(['scene', 'create', '--change', changeId, '--input', input, '--json']);
  const body = JSON.parse(result.stdout);
  expect(result.status).toBe(1);
  expect(body.error.code).toBe('INVALID_REQUEST');
  expect(fs.readdirSync(root, { recursive: true })).toEqual(before);
});

it('returns repairActions instead of retriable/action', () => {
  const result = runCli(['object', 'inspect', '--project', root, '--ref', 'scene:missing', '--json']);
  const body = JSON.parse(result.stdout);
  expect(result.status).toBe(1);
  expect(body.error.retryDisposition).toBe('after-inspect');
  expect(body.error.repairActions).toEqual(expect.any(Array));
  expect(body.error).not.toHaveProperty('retriable');
  expect(body.error).not.toHaveProperty('action');
});
```

上述片段复用 `authoring-contract.test.ts` 中已有的 `runCli` 风格，并在该文件内建立独立 root/data/requestDir/changeId；不得依赖其它 test 的执行顺序。

Wave 2/Wave 3 测试把字符串数组断言改为 `capabilities.map(({id}) => id)`；禁止同时保留旧字符串清单字段作为兼容 fallback。

- [ ] **Step 2: 运行红灯**

```powershell
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run test -w @surdet/cli -- authoring-contract.test.ts authoring-presentation-wave2.test.ts authoring-project-config-wave3.test.ts
```

Expected：exit `1`，旧 `capabilities: string[]` 或 envelope 断言失败。

- [ ] **Step 3: 安装精确依赖**

```powershell
npm install @modelcontextprotocol/core@2.0.0 @modelcontextprotocol/server@2.0.0 -w @surdet/cli --save-exact
npm install @modelcontextprotocol/client@2.0.0 -w @surdet/cli -D --save-exact
```

核对 `packages/cli/package.json`：server/core 位于 dependencies，client 位于 devDependencies；不得新增 HTTP adapter、Express、数据库或第二种 schema 库。

- [ ] **Step 4: 实现 schema adapter**

使用官方 v2 raw JSON Schema adapter：

```ts
import { AjvJsonSchemaValidator, fromJsonSchema } from '@modelcontextprotocol/core';
import type { JsonSchema } from '@surdet/authoring';

const validator = new AjvJsonSchemaValidator();

export function standardSchemaFromJson(schema: JsonSchema) {
  return fromJsonSchema(schema, validator);
}

export async function validateCapabilityInput(
  schema: JsonSchema,
  input: unknown,
): Promise<Record<string, unknown>> {
  const result = await standardSchemaFromJson(schema)['~standard'].validate(input);
  if (result.issues !== undefined) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'capability 输入不符合合同', {
      issues: result.issues,
    });
  }
  return result.value as Record<string, unknown>;
}
```

不得在 MCP 与 CLI 各写一个 validator。

- [ ] **Step 5: 实现唯一 dispatcher**

dispatcher 接收 `InvocationContext` 与 payload；先 registry lookup/schema validate，再调用 service。switch 只负责类型化方法映射，不包含业务逻辑。上下文规则：

```text
project inspect/assets → context.projectRoot
object.inspect → context.projectRoot + activeChangeId（有则 working view）
observe validate/simulate 且无 change → validateProject/simulateProject
stage/apply validate/simulate → activeChangeId 必填
mutation/runtime/diff/rollback/commit → activeChangeId 必填
change.begin → projectRoot + intent metadata；成功后由 AgentPortSession 接管 activeChangeId
```

CLI 本身为单命令进程，使用 `sessionId=cli_<uuid>`、policy=`apply`，但仍必须显式传 `--project/--change`；CLI 不获得 Port 的隐藏 active state。

- [ ] **Step 6: 删除 CLI 私有错误/能力真相**

从 `authoring-command.ts` 删除：

```text
ErrorCode union
ErrorCategory union
codeFor
categoryFor
actionFor
successEnvelope
failureEnvelope
AUTHORING_CAPABILITIES 依赖
```

改为 registry lookup、dispatcher 与共享 envelope。`--debug` 仍只把 stack 写 stderr；普通 JSON 失败 stdout 只有一份 envelope。

- [ ] **Step 7: 运行 CLI 绿灯与全量 CLI 测试**

```powershell
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- authoring-contract.test.ts authoring-presentation-wave2.test.ts authoring-project-config-wave3.test.ts authoring-vertical-slice.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
npm run test -w @surdet/cli
```

Expected：全部 exit `0`；旧 20 项仍是 20 项，不增加 Port 基础设施到领域 registry。

- [ ] **Step 8: 精确提交 Task 4**

```powershell
git add -- packages/cli/src/authoring/schema-validator.ts packages/cli/src/authoring/authoring-dispatcher.ts packages/cli/src/authoring/authoring-service.ts packages/cli/src/authoring-command.ts packages/cli/src/index.ts packages/cli/package.json package-lock.json packages/cli/test/authoring-contract.test.ts packages/cli/test/authoring-presentation-wave2.test.ts packages/cli/test/authoring-project-config-wave3.test.ts
git diff --cached --check
git commit -m "refactor(cli): share agent authoring contract"
```

---

### Task 5: 单项目 session、P1 policy 与显式 resume

**Files:**
- Create: `packages/cli/src/agent-port/args.ts`
- Create: `packages/cli/src/agent-port/policy.ts`
- Create: `packages/cli/src/agent-port/session.ts`
- Create: `packages/cli/test/agent-port-session.test.ts`
- Modify: `packages/cli/src/authoring/node-change-store.ts`

**Interfaces:**
- Consumes: `NodeProjectStorage.open()`、`NodeChangeStore.openByChangeId()`、Task 4 dispatcher。
- Produces: `parseAgentPortArgs()`、`allowedCapabilitiesForPolicy()`、`AgentPortSession`、`openAgentPortSession()`。

- [ ] **Step 1: 写 session/policy 红灯**

必须建立独立临时 root/data fixture，并逐项覆盖：

| 测试名 | 调用 | 必须断言 |
|---|---|---|
| requires explicit project and immutable policy | `parseAgentPortArgs([])`、未知/重复参数 | 抛 `INVALID_REQUEST`，不创建目录 |
| binds one canonical project | 以相对/绝对同一 root 启动 | session projectIdentity 相同；tool input 的 projectRoot/changeId/extra 被 schema 拒绝 |
| observe cannot begin or mutate | `session.invoke('change.begin', {})`、`scene.create` | `POLICY_BLOCKED`；项目和 change data 目录不变 |
| stage cannot commit | begin+scene.create 后 `change.commit` | `POLICY_BLOCKED`；项目文件逐字节不变；change 仍 OPEN |
| apply starts with no hidden change | apply 无 resume 后 `scene.create` | `SESSION_STATE_INVALID`；不自动 begin |
| resume ownership | project B resume project A change | `PROJECT_IDENTITY_MISMATCH`；两个项目均不变 |
| one active change | stage begin 成功后第二次 begin | `SESSION_STATE_INVALID`；原 activeChangeId 不变 |
| close preserves OPEN | stage mutate 后 `session.close()` 再读 transaction | status=OPEN、workingFiles 保留、项目不变 |

测试必须比较 change store transaction 文件和真实项目文件，不能只检查 boolean。每个测试自行创建/清理其临时目录，不依赖执行顺序。

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/cli -- agent-port-session.test.ts
```

- [ ] **Step 3: 实现严格参数解析**

```ts
export interface AgentPortOptions {
  projectRoot: string;
  policy: AutonomyPolicy;
  resumeChangeId?: string;
  requestedContractVersion?: string;
}

export function parseAgentPortArgs(args: readonly string[]): AgentPortOptions;
```

规则：

- `--project`、`--policy` 必填；
- policy 只能是三项；
- `--resume-change` 只能出现一次；
- 可选 `--contract-version` 只接受精确 `1.0.0`；其它值在打开项目或 change 前返回 `CONTRACT_VERSION_UNSUPPORTED`；省略时使用当前 `1.0.0`；
- 未知参数、缺值、重复参数均 `INVALID_REQUEST`；
- 不接受 cwd 默认、不接受配置文件覆盖、不接受 `--allow-shell` 类扩展。

- [ ] **Step 4: 实现 policy matrix**

```ts
export const POLICY_ORDER: Record<AutonomyPolicy, number> = {
  observe: 0, stage: 1, apply: 2,
};

export function isCapabilityAllowed(
  policy: AutonomyPolicy,
  definition: CapabilityDefinition,
): boolean {
  return POLICY_ORDER[policy] >= POLICY_ORDER[definition.minimumPolicy];
}
```

observe 特例来自 registry 最低 policy，不允许 adapter 手写另一份列表。`runtime.read-trace`、`change.diff` 在 observe 只有 resumed change 时 state-available；工具仍可注册，调用时返回 state-blocked。

- [ ] **Step 5: 实现 session 类**

```ts
export class AgentPortSession {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly projectIdentity: string;
  readonly policy: AutonomyPolicy;
  readonly openedProjectRevision: string;
  private activeChangeIdValue?: string;

  get activeChangeId(): string | undefined;
  describe(): Promise<SessionDescription>;
  invoke(capability: AuthoringCapabilityId, input: Record<string, unknown>): Promise<AuthoringEnvelope<unknown>>;
  close(): Promise<void>;
}
```

`SessionDescription` 必须包含：

```ts
export interface SessionDescription {
  sessionId: string;
  startedAt: string;
  engineVersion: string;
  contractVersion: '1.0.0';
  projectIdentity: string;
  projectName: string;
  projectRevision: string;
  policy: AutonomyPolicy;
  activeChange?: {
    changeId: string;
    status: ChangeStatus;
    baseRevision: string;
    workingRevision: number;
  };
  resumed: boolean;
  capabilities: {
    id: AuthoringCapabilityId;
    mcpTool: string;
    availability: CapabilityAvailability;
    reason?: string;
  }[];
  evidence: {
    validation?: EvidenceFreshness;
    simulation?: EvidenceFreshness;
    runtime?: EvidenceFreshness;
  };
  manualRecoveryRequired: boolean;
  nextActions: string[];
}
```

`capabilities.describe` 在 Port 内返回同一 availability 列表与完整 registry definition；native CLI 使用 policy=`apply` 且没有 active change，因此 mutation 能力为 `state-blocked`，不是假装当前可调用。

`invoke()` 行为：

- policy block → `POLICY_BLOCKED`，不调用 service；
- `change.begin` 成功 → 设置 activeChangeId；已有 active change → `SESSION_STATE_INVALID`；
- `change.commit/rollback` 成功 → 清空 activeChangeId；失败不清空；
- Port 的 `change.commit` 额外要求当前 workingRevision 上 validation passed、simulation passed 且至少一条 runtime trace passed；缺失/过期分别返回 `VALIDATION_REQUIRED`、`SIMULATION_REQUIRED`、`RUNTIME_EVIDENCE_REQUIRED`，随后仍调用共享 `commitChange` 的既有 validation/revision/recovery 门；
- 所有调用机械注入绑定 root/change；input 中出现 `projectRoot/changeId/cwd/path` 因严格 schema 直接失败；
- close 只关闭 Port 资源，不变更 transaction。

- [ ] **Step 6: 加强 resume ownership**

`NodeChangeStore` 增加只读专用方法：

```ts
static async openOwnedChange(
  changeId: string,
  projectRootIdentity: string,
): Promise<OpenChangeResult | null>;
```

它复用 `openByChangeId`，再严格比较 `record.projectRootIdentity` 与 canonical root；不复制目录扫描。非 OPEN、跨项目、ambiguous、recovery-failed 分别 fail-loud。

- [ ] **Step 7: 运行 session 绿灯及 storage 回归**

```powershell
npm run test -w @surdet/cli -- agent-port-session.test.ts node-project-storage.test.ts change-isolation.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [ ] **Step 8: 精确提交 Task 5**

```powershell
git add -- packages/cli/src/agent-port/args.ts packages/cli/src/agent-port/policy.ts packages/cli/src/agent-port/session.ts packages/cli/src/authoring/node-change-store.ts packages/cli/test/agent-port-session.test.ts
git diff --cached --check
git commit -m "feat(cli): bind agent port sessions"
```

---

### Task 6: T1 MCP tool 投影与正式 stdio 入口

**Files:**
- Create: `packages/cli/src/agent-port/tool-projection.ts`
- Create: `packages/cli/src/agent-port/server.ts`
- Create: `packages/cli/src/agent-port/main.ts`
- Create: `packages/cli/test/agent-port-tools.test.ts`
- Modify: `packages/cli/package.json`

**Interfaces:**
- Consumes: registry、schema adapter、AgentPortSession、MCP Server v2。
- Produces: `createAgentPortServer()`、`surdet-agent-port` bin、22 项以内的 policy-filtered tools/list。

- [ ] **Step 1: 写 tool discovery/stdio 红灯**

测试至少断言：

| 测试 | 必须断言 |
|---|---|
| typed projection | 每个允许 definition 恰有一个 tool；name/description/inputSchema/outputSchema/annotations 与 registry 派生值一致 |
| observe list | 不含 begin、mutation、runtime.run-from、rollback、commit |
| stage list | 含 begin/mutation/runtime/diff/rollback，不含 commit |
| apply list | Task 6 时为 20 项领域工具 + `surdet_session_describe`，无重复 |
| domain failure | `tools/call` 返回 `isError=true`，structuredContent 为统一 failure envelope |
| protocol failure | 未知 tool/损坏请求为 MCP protocol error，不伪装 Surdet code |
| stdout purity | 真实 child initialize/tools/list 后，stdout 每个 frame 均可由官方 client 解析，banner 只在 stderr |

Task 6 末尾 apply 数量为 21（20 项领域工具 + session）；Task 7 注册真实胶囊后才增加为最终 22。observe/stage 应按 registry 和基础设施定义计算，不另外维护手写领域清单。

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/cli -- agent-port-tools.test.ts
```

- [ ] **Step 3: 实现 tool projection**

```ts
export interface ProjectedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ReturnType<typeof standardSchemaFromJson>;
  outputSchema: ReturnType<typeof standardSchemaFromJson>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: false;
  };
}

export function projectCapabilityTool(
  definition: CapabilityDefinition,
): ProjectedTool {
  const sideEffects = new Set(definition.sideEffects);
  return {
    name: nativeCapabilityToMcpTool(definition.id),
    title: definition.title,
    description: `${definition.purpose}\nPreconditions: ${definition.preconditions.join('; ')}`,
    inputSchema: standardSchemaFromJson(definition.inputSchema),
    outputSchema: standardSchemaFromJson(createEnvelopeJsonSchema(definition.outputSchema)),
    annotations: {
      readOnlyHint: [...sideEffects].every((item) =>
        item === 'none' || item === 'project-read' || item === 'change-store-read'),
      destructiveHint: sideEffects.has('project-write') || definition.id === 'change.rollback',
      idempotentHint: definition.idempotency !== 'non-idempotent',
      openWorldHint: false,
    },
  };
}
```

`inputSchema` 使用 `definition.inputSchema`；`outputSchema` 必须使用 Task 2 的 `createEnvelopeJsonSchema(definition.outputSchema)`，因为 handler 的 `structuredContent` 是完整 envelope。禁止把 result-only schema 注册给返回 envelope 的工具。

`destructiveHint=true` 仅用于 project write 的 commit 与关闭 change 的 rollback；`readOnlyHint` 只在不改变 project/change/evidence 时为 true；annotations 只是客户端提示，真实授权仍由 session policy gate 执行。

- [ ] **Step 4: 实现 MCP server factory**

使用官方 v2 API：

```ts
import { McpServer } from '@modelcontextprotocol/server';

export function createAgentPortServer(session: AgentPortSession): McpServer {
  const server = new McpServer(
    { name: 'surdet-agent-port', version: '0.1.0' },
    { instructions: 'Inspect the session and capabilities before authoring. Use typed Surdet tools only. The server never grants shell, git, network, or project switching.' },
  );
  // 先注册 surdet_session_describe；再按 policy 从 registry 注册领域工具；
  // Task 7 完成后注册 surdet_delivery_capsule。
  return server;
}
```

每项领域工具：

```ts
server.registerTool(tool.name, {
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  outputSchema: tool.outputSchema,
  annotations: tool.annotations,
}, async (input) => {
  const envelope = await session.invoke(definition.id, input as Record<string, unknown>);
  return {
    isError: !envelope.ok,
    content: [{
      type: 'text',
      text: envelope.ok
        ? `${definition.id} completed`
        : `${envelope.error.code}: ${envelope.error.message}`,
    }],
    structuredContent: mapRepairCapabilitiesToMcpTools(envelope),
  };
});
```

禁止 handler 解析 Gal、直接打开 storage 或实现特殊 fallback。

- [ ] **Step 5: 实现 stdio main**

```ts
#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const options = parseAgentPortArgs(process.argv.slice(2));
const session = await openAgentPortSession(options);
const handle = serveStdio(() => createAgentPortServer(session), { legacy: 'reject' });
console.error(`Surdet Agent Port ready: ${session.projectIdentity} (${session.policy})`);

const close = async (): Promise<void> => {
  await handle.close();
  await session.close();
};
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
```

main 必须捕获启动失败、写 stderr、设置非零退出；不得写 stdout。`legacy:'reject'` 避免首版静默双时代协议 fallback。

- [ ] **Step 6: 注册第二 bin**

`packages/cli/package.json`：

```json
"bin": {
  "surdet": "./dist/index.js",
  "surdet-agent-port": "./dist/agent-port/main.js"
}
```

build 后检查 shebang 和入口存在。

- [ ] **Step 7: 运行绿灯与真实启动冒烟**

```powershell
npm run test -w @surdet/cli -- agent-port-tools.test.ts agent-port-session.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
node packages/cli/dist/agent-port/main.js --project E:\surdet\examples\starter --policy invalid
```

最后一条 Expected：非零退出、错误只在 stderr、无 stdout；它不是正式 Port 连接测试。

- [ ] **Step 8: 精确提交 Task 6**

```powershell
git add -- packages/cli/src/agent-port/tool-projection.ts packages/cli/src/agent-port/server.ts packages/cli/src/agent-port/main.ts packages/cli/test/agent-port-tools.test.ts packages/cli/package.json
git diff --cached --check
git commit -m "feat(cli): expose typed MCP agent tools"
```

---

### Task 7: Invocation ledger 与可封存交付胶囊

**Files:**
- Create: `packages/cli/src/agent-port/invocation-ledger.ts`
- Create: `packages/cli/src/agent-port/delivery-capsule.ts`
- Create: `packages/cli/test/agent-port-capsule.test.ts`
- Modify: `packages/cli/src/agent-port/session.ts`
- Modify: `packages/cli/src/agent-port/server.ts`
- Modify: `packages/cli/src/authoring/node-change-store.ts`

**Interfaces:**
- Consumes: ChangeRecord、evidence/diff/trace/journal、session invoke 结果。
- Produces: `recordInvocation()`、`generateDeliveryCapsule()`、`surdet_delivery_capsule`。

- [ ] **Step 1: 写 capsule 红灯**

| 测试 | fixture 动作 | 必须断言 |
|---|---|---|
| failure retention | 先失败 stale patch，再成功 repair | 两条 invocation 都存在；记录无 prompt/text/input 原文，只有 inputSha256 |
| stage capsule | stage 完成 mutation/validate/simulate/runtime/diff | status=OPEN、projectMutation=false、项目内容 hash 前后相等 |
| apply capsule | apply resume 并 commit | status=COMMITTED、before/after revision 不同、expectedByPolicy=true |
| freshness | evidence 后再 mutation | validation/simulation/runtime/diff 均报告 stale，不删除旧文件 |
| immutable capsules | 连续生成两次 | capsuleId/path 不同，第一份 bytes/hash 不变 |
| disk identity | 读取 payload 实际 bytes/hash | 与返回 artifactIdentity 完全一致，identity.json 指向 payload.json |

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/cli -- agent-port-capsule.test.ts
```

- [ ] **Step 3: 实现专用 change-store API**

不要暴露任意相对路径写入。`NodeChangeStore` 仅增加：

```ts
writeInvocation(changeId: string, record: InvocationRecord): Promise<string>;
readInvocations(changeId: string): Promise<InvocationRecord[]>;
readAllEvidence(changeId: string): Promise<unknown[]>;
readDiff(changeId: string): Promise<unknown | null>;
readLatestJournal(changeId: string): Promise<unknown | null>;
writeCapsulePayload(changeId: string, capsuleId: string, payload: unknown): Promise<ArtifactIdentity>;
```

`ArtifactIdentity` 固定为：

```ts
export interface ArtifactIdentity {
  path: string;
  bytes: number;
  sha256: string;
}
```

每次 invocation 为独立 JSON 文件，命名使用单调序号 + UUID；不使用脆弱的共享 NDJSON append。`writeCapsulePayload` 写临时文件、原子 rename、重新从磁盘读取 bytes/hash 后返回 identity。

- [ ] **Step 4: 实现最小调用记录**

```ts
export interface InvocationRecord {
  invocationId: string;
  sessionId: string;
  occurredAt: string;
  capability: string;
  operationId?: string;
  ok: boolean;
  errorCode?: string;
  projectRevisionBefore?: string;
  projectRevisionAfter?: string;
  workingRevisionBefore?: number;
  workingRevisionAfter?: number;
  inputSha256: string;
  evidenceIds: string[];
}
```

输入只保存 `stableStringify(input)` 的 SHA-256；不得保存模型原始消息、环境变量、Token 或大段项目文本。调用失败也要记录；ledger 写失败不得把领域调用改写成成功。

- [ ] **Step 5: 解决 capsule 自哈希边界**

禁止让一个 JSON 文件在自身内容里声称自身 SHA-256。采用两层封存：

```text
capsules/<capsuleId>/payload.json   # DeliveryCapsulePayload，不含 artifactIdentity
capsules/<capsuleId>/identity.json  # payload.json 的 path/bytes/sha256
```

返回给工具的 `SealedDeliveryCapsule` 为：

```ts
export interface SealedDeliveryCapsule extends DeliveryCapsulePayload {
  artifactIdentity: {
    path: string;
    bytes: number;
    sha256: string;
  };
}
```

`artifactIdentity` 只指向 immutable `payload.json`；FORMAL runner 另行从磁盘计算 `identity.json` 和最终 FORMAL artifact 身份。

- [ ] **Step 6: 派生胶囊事实**

胶囊必须从磁盘 change record、invocations、diff、evidence、trace 和 journal 派生：

```ts
export interface DeliveryCapsulePayload {
  capsuleVersion: '1.0.0';
  capsuleId: string;
  generatedAt: string;
  sessionId: string;
  policy: AutonomyPolicy;
  contractVersion: '1.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  currentProjectRevision: string;
  changeId: string;
  changeStatus: 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'STALE';
  workingRevision?: number;
  intent?: string;
  acceptanceCriteria: string[];
  operations: unknown[];
  invocationSummary: unknown;
  objectDiff: unknown;
  causalImpact: { potentialImpact: unknown[]; observedImpact: unknown[] };
  validation: EvidenceFreshness;
  simulation: EvidenceFreshness;
  runtime: EvidenceFreshness;
  warnings: unknown[];
  manualReviewRequired: unknown[];
  projectMutation: {
    occurred: boolean;
    expectedByPolicy: boolean;
    beforeRevision: string;
    afterRevision: string;
  };
}
```

stage OPEN：`occurred=false`、before=after。apply COMMITTED：`occurred=true`、after 为提交后 revision。rollback：未改项目。空 change 必须在 warnings 中标记 `EMPTY_CHANGE`，不能宣称完成创作。

- [ ] **Step 7: 注册 capsule 工具**

`surdet_delivery_capsule` 在 stage/apply 可生成；observe 只有显式 resumed change 时可生成/读取。它不接受 path/changeId；session 注入。工具输入只有可选 `label`（最长 120 字符，不参与领域事实）。

更新 `agent-port-tools.test.ts`：最终 apply tools/list 必须恰为 22 项；stage 只少 `surdet_change_commit`；observe 只包含 registry 允许的只读领域工具、session 与胶囊，并由 state 在无 resumed change 时拒绝胶囊调用。

- [ ] **Step 8: 运行绿灯和回归**

```powershell
npm run test -w @surdet/cli -- agent-port-capsule.test.ts agent-port-session.test.ts agent-port-tools.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [ ] **Step 9: 精确提交 Task 7**

```powershell
git add -- packages/cli/src/agent-port/invocation-ledger.ts packages/cli/src/agent-port/delivery-capsule.ts packages/cli/src/agent-port/session.ts packages/cli/src/agent-port/server.ts packages/cli/src/authoring/node-change-store.ts packages/cli/test/agent-port-capsule.test.ts
git diff --cached --check
git commit -m "feat(cli): seal agent delivery capsules"
```

---

### Task 8: 安全反测、跨项目拒绝与清理合同

**Files:**
- Create: `packages/cli/test/agent-port-security.test.ts`
- Modify only if a red light proves necessary: `packages/cli/src/agent-port/args.ts`
- Modify only if a red light proves necessary: `packages/cli/src/agent-port/session.ts`
- Modify only if a red light proves necessary: `packages/cli/src/agent-port/server.ts`
- Modify only if a red light proves necessary: `packages/cli/src/agent-port/main.ts`
- Modify only if a red light proves necessary: `packages/cli/src/authoring/node-change-store.ts`

**Interfaces:**
- Consumes: 完整 Agent Port。
- Produces: 对产品安全边界的可持续反向回归。

- [ ] **Step 1: 写反向测试**

每个测试必须断言“拒绝 + 原状态不变”：

```text
observe 调 change.begin
observe/stage 调 change.commit
任意 tool 注入 projectRoot/changeId/cwd/path/extra
resume 另一个项目的 change
resume COMMITTED/ROLLED_BACK/STALE change
同一 session 第二次 begin
operationId 同 ID 不同负载
项目在 begin 后外部改变再 commit
commit recovery failed 后自动重试
stdio stdout 注入 console.log
SIGINT/SIGTERM 后 Port/runtime child 残留
```

真实项目/fixture 字节、change status、journal 与目录状态都要前后比较。

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/cli -- agent-port-security.test.ts
```

若初版已全部通过，必须证明测试能抓到缺陷：仅在本地未提交状态临时反转一个 policy 条件，确认指定测试红灯，然后立即用 `apply_patch` 恢复该行并重新运行。不得提交故意缺陷，也不得靠改测试制造假红灯。

- [ ] **Step 3: 做最小修复**

只修改被红灯证明的 Port/Node 边界；不得顺手重构 storage 或扩大到 Shell。关键拒绝统一使用 `POLICY_BLOCKED`、`SESSION_STATE_INVALID`、`PROJECT_IDENTITY_MISMATCH` 或已有 stale/recovery 错误。

- [ ] **Step 4: 运行安全绿灯和 CLI 全量**

```powershell
npm run test -w @surdet/cli -- agent-port-security.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-capsule.test.ts
npm run test -w @surdet/cli
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [ ] **Step 5: 精确提交 Task 8**

只暂存安全测试和被红灯证明必要的文件：

```powershell
git add -- packages/cli/test/agent-port-security.test.ts
git add -- packages/cli/src/agent-port/args.ts packages/cli/src/agent-port/session.ts packages/cli/src/agent-port/server.ts packages/cli/src/agent-port/main.ts packages/cli/src/authoring/node-change-store.ts
git diff --cached --name-status
git diff --cached --check
git commit -m "test(cli): enforce agent port boundaries"
```

若某个可选生产文件没有实际 diff，Git 不会加入；提交前逐项回读，禁止夹带。

---

### Task 9: 确定性真实 stdio runner 与冻结代码证据

**Files:**
- Create: `packages/cli/e2e/agent-port-wave-4.e2e.mjs`
- Modify only if runner reveals a real contract defect: Wave 4 白名单内生产/测试文件

**Interfaces:**
- Consumes: 构建后的 `surdet-agent-port`、官方 MCP Client v2、Starter fixture。
- Produces: preflight/diagnostic/formal/acceptance-prep 四模式与唯一 FORMAL artifact。

- [ ] **Step 1: 写 runner 静态红灯**

先建立测试或自检，要求：

```text
mode 只能是 preflight|diagnostic|formal|acceptance-prep
使用 @modelcontextprotocol/client 与 StdioClientTransport
入口必须是 packages/cli/dist/agent-port/main.js
fixture 必须复制 Starter 到独立临时/桌面目录
不允许 import server/session 内部函数
不允许 HTTP、替身 server 或直接改 fixture
```

Run：

```powershell
node --check packages/cli/e2e/agent-port-wave-4.e2e.mjs
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
```

初始 Expected：文件不存在或 preflight 失败，形成真实红灯。

- [ ] **Step 2: 实现官方 Client 连接 helper**

```js
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function connectPort({ projectRoot, policy, resumeChangeId, dataDir }) {
  const args = [portEntry, '--project', projectRoot, '--policy', policy];
  if (resumeChangeId) args.push('--resume-change', resumeChangeId);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: repoRoot,
    env: { ...process.env, SURDET_AGENT_DATA_DIR: dataDir, SURDET_GIT_HEAD: runHead },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'surdet-wave-4-evidence', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}
```

helper 必须捕获 stderr、关闭 client/transport、等待 child 退出；不得假定 `disconnect()` 等于进程已释放。

- [ ] **Step 3: 实现精确 FORMAL 创作 fixture**

两个 Starter 副本：`fixture-stage`、`fixture-apply`。两者创作目标固定：

```text
变量：agent.route，type=string，initial=""
角色：agent_guide，name="引路人"，avatar="lynn"
时间轴：agent_port_intro
背景：night_field
立绘：lynn:uniform，expression=night，position=left
场景 1：agent_port_entry
场景 2：agent_port_result
入口：agent_port_entry
choice A：@set agent.route = "A"，jump agent_port_result.path_a
choice B：@set agent.route = "B"，jump agent_port_result.path_b
```

`agent_port_intro` 使用 background/portrait/screen 三种已批准 track；screen fade 第一 cue alpha=1，最后 cue alpha=0。不得使用不存在资源或修改 Starter catalog。

- [ ] **Step 4: 实现确定性错误修复链**

在 timeline 创建后：

1. `object.inspect(timeline:agent_port_intro)` 取得 fingerprint A；
2. 用 A 成功执行一个 `timeline.patch`；
3. 再用旧 A 执行不同 patch，必须得到 `OBJECT_PRECONDITION_FAILED`；
4. 断言 `retryDisposition=after-inspect` 且 repair 指向 `surdet_object_inspect`；
5. 重新 inspect 得 fingerprint B；
6. 用 B 完成原意图；
7. 断言失败 invocation 仍在 capsule 中。

不得通过直接读取 JSON 或手工计算新 fingerprint 绕过 repair contract。

- [ ] **Step 5: 实现 stage 路径断言**

```text
tools/list 不含 surdet_change_commit
20 项领域 registry 可由 capabilities.describe 理解
完整创作、validate、simulate、两条 runtime、trace、diff、capsule 通过
project tree 前后 SHA-256 清单完全一致
stage Port 关闭后 changeStatus 仍 OPEN
observe --resume-change 可读 diff/trace/capsule，mutation 被拒绝
capsule projectMutation.occurred=false 且 beforeRevision=afterRevision
```

- [ ] **Step 6: 实现 apply resume 路径断言**

```text
先以 stage 建立 OPEN change 并关闭
再以 apply --resume-change 同一 changeId
resume 前先尝试无新鲜 validation 的 commit，必须 VALIDATION_REQUIRED
validate/simulate/runtime 新鲜后 commit 成功一次
重复 commit 不产生第二次写入并返回 CHANGE_NOT_OPEN/等价终态
项目磁盘包含两个新场景、timeline、变量、角色、entryScene
普通 AuthoringService project.inspect 能读取结果
capsule status=COMMITTED，projectMutation.occurred=true
```

- [ ] **Step 7: 实现 artifact 与模式纪律**

runner 参数：

```text
--mode preflight：只验证 launcher、initialize、tools/list、最小只读 inspect、清理
--mode diagnostic：完整路径，artifact evidenceClass=DIAGNOSTIC
--mode formal：完整路径，artifact evidenceClass=FORMAL，拒绝重复覆盖
--mode acceptance-prep：只创建桌面 fixture 与 MCP 配置，不调用创作工具
```

artifact 必须写唯一目录并包含 design 15.7 全字段、`runHead`、stage/apply fixture hash、原 Starter hash、错误通道、child cleanup。写完从磁盘回读 bytes/SHA-256。

- [ ] **Step 8: 运行 runner 静态与聚焦绿灯**

```powershell
node --check packages/cli/e2e/agent-port-wave-4.e2e.mjs
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
```

- [ ] **Step 9: 创建冻结 CODE_EVIDENCE_HEAD**

```powershell
git add -- packages/cli/e2e/agent-port-wave-4.e2e.mjs
git add -- packages/authoring/src packages/authoring/test packages/cli/src packages/cli/test packages/cli/package.json package-lock.json
git diff --cached --check
git diff --cached --name-status
git commit -m "test(cli): prove agent port vertical slice"
git rev-parse HEAD
```

提交前确认没有 Taskbook Ledger、Starter、Editor、Shell 或未跟踪治理文件。该 HEAD 暂定为 `CODE_EVIDENCE_HEAD`；之后任何代码/runner 修改都会使它失效，必须新建普通提交并重新记录。

---

### Task 10: 有界验证、唯一 FORMAL 与工程交付报告

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`（Ledger）
- Create: `docs/SURDET-AGENT-PORT-STAGE-6-WAVE-4-DELIVERY-REPORT-2026-08-20.md`
- Preserve: 所有 DIAGNOSTIC/FORMAL artifact 与 fixture

**Interfaces:**
- Consumes: 冻结 CODE_EVIDENCE_HEAD 与 runner。
- Produces: 一份可信 FORMAL、工程交付报告和 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`。

- [ ] **Step 1: 冻结前最终聚焦回读**

```powershell
git status --short --branch
git show --name-status --format=fuller HEAD
node --check packages/cli/e2e/agent-port-wave-4.e2e.mjs
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
```

Expected：全部 exit `0`。Taskbook Ledger 未提交修改允许存在；除此之外 tracked 代码应干净。

- [ ] **Step 2: 运行一次全仓门禁**

```powershell
npm run verify:all
```

只运行一次。exit 非 0：记录最后通过节点与第一个失败节点，判断是否与 Wave 4 相关，但不继续 FORMAL、不重跑、不顺手修无关问题，停止等待复审。

- [ ] **Step 3: 运行有界 DIAGNOSTIC**

```powershell
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode diagnostic
```

最多 3 次总预算。每次失败：保留 artifact，记录最后通过/首个失败；只修被证据证明的白名单缺陷，跑聚焦测试并普通提交，更新 CODE_EVIDENCE_HEAD 后再用下一次预算。第 3 次仍失败：停止，不运行 FORMAL。

- [ ] **Step 4: 运行唯一 FORMAL**

只有最近 DIAGNOSTIC 通过且当前 HEAD 为冻结代码证据时：

```powershell
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode formal
```

只运行一次。无论通过失败都不得自动第二次运行。失败时保留 artifact，停止；通过时从磁盘回读并断言：

```text
status=PASSED
evidenceClass=FORMAL
runHead=git rev-parse HEAD=CODE_EVIDENCE_HEAD
stage project unchanged=true
apply committed=true
repair chain passed=true
stdout contamination=[]
request/protocol/domain/unhandled/child cleanup failures=[]
```

- [ ] **Step 5: 写交付报告**

报告必须区分：

```text
已验证：registry/MCP/session/policy/stage/apply/repair/capsule/FORMAL
尚未验证：真实外部 Agent 的低上下文可用性、Editor 可见体验、项目所有者判断
未做：push/部署/发行/Wave5/音频/市场/性能
```

列出所有真实命令、exit code、提交链、FORMAL 路径/bytes/SHA-256、失败 artifact、原 Starter 身份、最终 Git 状态。不得写成“人工验收通过”。

- [ ] **Step 6: 文档闭合提交**

```powershell
git add -- docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md docs/SURDET-AGENT-PORT-STAGE-6-WAVE-4-DELIVERY-REPORT-2026-08-20.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(authoring): report wave 4 agent port"
```

提交只能包含任务书和交付报告。提交后回读 HEAD、surdet/main、ahead/behind、工作树、两文档 bytes/SHA-256。

- [ ] **Step 7: 停止等待独立复审**

最终状态：

```text
WAVE_4_AGENT_PORT_ENGINEERING_IMPLEMENTED
FORMAL_PASSED（仅当真实通过）
REAL_EXTERNAL_AGENT_ACCEPTANCE_NOT_STARTED
OWNER_EDITOR_ACCEPTANCE_NOT_STARTED
READY_FOR_ARCHITECT_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_5_NOT_STARTED
```

### 2026-08-21 Task 0 fresh-gate revalidation

```text
TASK_0_REVALIDATION_TIME = 2026-08-21 02:17:57 +08:00
TASK_0_AUTHORIZATION = OWNER_AUTHORIZED_WAVE_4_IMPLEMENTATION
TASK_0_BRANCH = main
TASK_0_HEAD = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
TASK_0_SURDET_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
TASK_0_AHEAD_BEHIND = 0 0
TASK_0_TRACKED_WORKTREE = CLEAN
TASK_0_STAGING_AREA = EMPTY
TASK_0_DIFF_CHECK = PASS
TASK_0_CACHED_DIFF_CHECK = PASS
TASK_0_TRACKED_LOG_FILES = NONE
TASK_0_KNOWN_UNTRACKED_GOVERNANCE = PRESERVED
TASK_0_ROADMAP_MODIFIED = NO
TASK_0_PROTECTED_FILES_MODIFIED = NO
TASK_0_SCOPE_EXPANSION = NO
TASK_0_PUSH = NOT_AUTHORIZED
TASK_0_MCP_SERVER_VERSION = 2.0.0
TASK_0_MCP_CORE_VERSION = 2.0.0
TASK_0_MCP_CLIENT_VERSION = 2.0.0
TASK_0_MCP_LICENSES = MIT
TASK_0_MCP_NODE_ENGINE = >=20
TASK_0_OFFICIAL_STDIO_API = serveStdio_FACTORY_AND_STDERR_LOGGING_CONFIRMED
TASK_0_OFFICIAL_TOOL_API = McpServer_REGISTER_TOOL_CONFIRMED
TASK_0_OFFICIAL_CLIENT_API = Client_AND_StdioClientTransport_CONFIRMED
TASK_0_CLIENT_DOC_REDIRECT = REQUESTED_docs/client.md_RETURNED_404_CURRENT_OFFICIAL_GUIDE_docs/clients/connect.md_READ
TASK_0_AUTHORITY_READBACK = AGENTS_ROADMAP_DESIGN_TASKBOOK_WAVE3_REPORT_SOURCE_TEST_CONFIGS
TASK_0_BASELINE_CONFIRMED = YES
TASK_0_IMPLEMENTATION_STARTED = NO
```

Task 0 fresh evidence confirms the owner-supplied `f7ab58d... / 0/0` baseline. The historical planning snapshot above remains unchanged. The current official MCP client guide is under `docs/clients/connect.md`; it confirms `Client` with `StdioClientTransport` over the `@modelcontextprotocol/client/stdio` subpath after the requested historical `docs/client.md` URL returned 404. No source, test, roadmap, protected file, or long-term ledger was modified during this revalidation.

### 2026-08-21 Task 1 capability registry result

```text
TASK_1_RED = npm run test -w @surdet/authoring -- capability-registry.test.ts ; EXIT_CODE=1 ; missing exports reproduced
TASK_1_GREEN = npm run test -w @surdet/authoring -- capability-registry.test.ts ; EXIT_CODE=0 ; 3 tests passed
TASK_1_TYPECHECK = npm run typecheck -w @surdet/authoring ; EXIT_CODE=0
TASK_1_BUILD = npm run build -w @surdet/authoring ; EXIT_CODE=0
TASK_1_COMMIT = 319be273ca5371d2402e6d6f32491ce71b4ef1ca
TASK_1_COMMIT_PARENT = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
TASK_1_COMMIT_MESSAGE = feat(authoring): define agent capability registry
TASK_1_COMMIT_FILES = 4_EXACT_FILES
TASK_1_SCOPE = capability-contract_registry_index_test_only
TASK_1_STATUS = PASS
```

Task 1 defines one protocol-independent 20-capability registry, strict object schemas, minimum policies, side effects, idempotency classes, error/repair metadata, examples, and deterministic native-to-MCP name mapping. No CLI, MCP dependency, project storage, or non-authoring production layer was modified.

### 2026-08-21 Task 2 repairable envelope result

```text
TASK_2_RED = npm run test -w @surdet/authoring -- error-catalog.test.ts ; EXIT_CODE=1 ; missing error API reproduced
TASK_2_GREEN = npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts ; EXIT_CODE=0 ; 2 files / 6 tests passed
TASK_2_TYPECHECK = npm run typecheck -w @surdet/authoring ; EXIT_CODE=0
TASK_2_BUILD = npm run build -w @surdet/authoring ; EXIT_CODE=0
TASK_2_COMMIT = 70b15d2894e4e3b14725f158bf49b492bc78efa7
TASK_2_COMMIT_PARENT = 319be273ca5371d2402e6d6f32491ce71b4ef1ca
TASK_2_COMMIT_MESSAGE = feat(authoring): define repairable agent envelopes
TASK_2_COMMIT_FILES = 4_EXACT_CHANGED_FILES_WITHIN_TASK_ALLOWLIST
TASK_2_SCOPE = shared_error_catalog_normalization_envelopes_only
TASK_2_STATUS = PASS
```

Task 2 adds the complete error code catalog, deterministic category/retry/repair mappings, typed success/failure envelopes, and strict envelope JSON schema. Stale object errors repair through `object.inspect`; recovery failure is terminal/manual; legacy `retriable` and `action` fields are absent. No CLI dispatch or MCP dependency was changed.

### 2026-08-21 Task 3 evidence and observe result

```text
TASK_3_RED_AUTHORING = npm run test -w @surdet/authoring -- change-session.test.ts ; EXIT_CODE=1 ; missing intent/evidence APIs reproduced
TASK_3_RED_CLI = npm run test -w @surdet/cli -- authoring-observe-mode.test.ts ; EXIT_CODE=1 ; validateProject missing reproduced
TASK_3_GREEN_AUTHORING = npm run test -w @surdet/authoring -- change-session.test.ts commit-recovery.test.ts ; EXIT_CODE=0 ; 2 files / 6 tests passed
TASK_3_GREEN_AUTHORING_BUILD = npm run build -w @surdet/authoring ; EXIT_CODE=0
TASK_3_GREEN_CLI = npm run test -w @surdet/cli -- authoring-observe-mode.test.ts authoring-vertical-slice.test.ts ; EXIT_CODE=0 ; 2 files / 2 tests passed
TASK_3_AUTHORING_TYPECHECK = npm run typecheck -w @surdet/authoring ; EXIT_CODE=0
TASK_3_CLI_TYPECHECK = npm run typecheck -w @surdet/cli ; EXIT_CODE=0
TASK_3_CLI_BUILD = npm run build -w @surdet/cli ; EXIT_CODE=0
TASK_3_COMMIT = 4112169f3c941f04c085b733eef2c17bdfe09deb
TASK_3_COMMIT_PARENT = 70b15d2894e4e3b14725f158bf49b492bc78efa7
TASK_3_COMMIT_MESSAGE = feat(authoring): preserve agent change evidence
TASK_3_COMMIT_FILES = 7_EXACT_FILES
TASK_3_SCOPE = authoring_change_metadata_evidence_freshness_cli_observe_only
TASK_3_STATUS = PASS
```

Task 3 persists bounded intent outside project contents, records simulation/runtime/diff freshness without advancing the working revision, exposes a stable project identity derived from the canonical root identity, and provides true project-level validate/simulate paths that do not create or write a change. Active changes report base `projectRevision` plus independent `workingSnapshotRevision`; mutation remains isolated from project disk. No MCP dependency, Core/Renderer/Host/Shell/Editor/Starter/Zero production code was modified.

不得自行进入 Task 11；由总经理/Architect/小衡复审两类提交、关键 diff 与 artifact。

---

### Task 11: 复审通过后的真实外部 Agent 与项目所有者验收

**Files:**
- Reuse: `packages/cli/e2e/agent-port-wave-4.e2e.mjs`
- Modify: 本任务书 Ledger 与交付报告（只记录真实结果）
- Create outside repository: 桌面隔离 acceptance fixture 与 MCP 配置

**Interfaces:**
- Consumes: 总经理明确的“批准开始真实外部 Agent 验收”授权。
- Produces: 低上下文外部 Agent 证据和项目所有者 Editor/预览结果。

- [ ] **Step 1: 只在书面授权后准备 fixture**

```powershell
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode acceptance-prep
```

Expected：创建新的桌面 Starter 副本、独立 `SURDET_AGENT_DATA_DIR`、stage MCP 配置；原 Starter hash 不变。该模式不调用创作工具。

- [ ] **Step 2: 给新上下文外部 Agent 的唯一提示词**

必须原样使用以下低上下文提示，不附源码、任务书、schema 速查或调用顺序：

```text
你可以访问一个名为 Surdet Agent Port 的本地创作工具服务。请只使用该服务提供的 Surdet 工具，不要使用 Shell，不要直接读取或修改项目文件，也不要访问 Surdet 源码。

请在已绑定的隔离项目里建立一个短小但完整的双分支 Galgame 片段：至少包含两个场景、一个变量、一个角色、一个使用项目既有背景和立绘的演出时间轴、一个有 A/B 两条结果的选择，并把新片段设为入口。你需要自行发现能力和参数，先在 stage 中完成创作，再完成校验、模拟、两条路径的正式运行证据、轨迹读取、对象级差异和交付胶囊。遇到工具错误时，请根据 Surdet 返回的结构化修复动作自行修正。完成后只汇报 changeId、胶囊路径/字节数/SHA-256、校验与两条路径结果，以及是否触碰真实项目。
```

- [ ] **Step 3: 验证外部 Agent 没有旁路**

审核其调用历史：

```text
未使用 Shell/直接文件编辑/源码阅读
先发现 session/capabilities
没有获得隐藏工具顺序
至少一次确定性错误通过 repairActions 恢复
stage 项目磁盘不变
胶囊来自 Port 而不是 Agent 自造 JSON
```

任何一项失败都视为产品合同缺口，记录第一个失败点；不临时加长提示词让验收“通过”。

- [ ] **Step 4: 项目所有者批准后 apply resume**

项目所有者明确授权 fixture apply 后，停止 stage Port，以：

```text
surdet-agent-port --project <acceptance-fixture> --policy apply --resume-change <changeId>
```

启动新进程。外部 Agent 先 session.describe，再取得新鲜 validate/simulate/runtime 门，最后 commit；不得让 stage 进程提升权限。

- [ ] **Step 5: 主动邀请项目所有者人工路径**

必须把以下十步作为强制提醒点发给项目所有者：

1. 用现有 Editor 打开 acceptance fixture；
2. 确认入口、两个场景、变量、角色、timeline 是普通可编辑对象；
3. 检查块选择后的直接引用、直接被引用、potentialImpact、observedImpact；
4. 点击演出/因果轨迹事件能反向跳回块；
5. 从新入口预览；
6. 真实看到既有背景与立绘；
7. 分别走 A/B 两条路径；
8. 保存、刷新、重开；
9. 确认对象仍存在且无异常脏标记；
10. 确认原始 Starter 未修改。

只接受项目所有者的一手反馈；自动化不得代填视觉与手感结论。

- [ ] **Step 6: 停止等待验收裁决**

出现异常只记录第一个异常、触发动作、实际现象与必要截图；不要立即猜测修代码。全部通过后更新 Ledger/报告，但仍不 push。

---

### Task 12: 人工通过后的最终文档闭合与 push 门

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`
- Modify: `docs/SURDET-AGENT-PORT-STAGE-6-WAVE-4-DELIVERY-REPORT-2026-08-20.md`

**Interfaces:**
- Consumes: 真实外部 Agent 结果、项目所有者人工反馈、磁盘 fixture 身份。
- Produces: Wave 4 最终本地文档闭合；push 仍由项目所有者单独决定。

- [ ] **Step 1: 只读回读最终证据**

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git diff --check
git diff --cached --check
git ls-files '*.log'
```

重新读取 acceptance fixture 的关键场景、timeline、config bytes/SHA-256 与原 Starter 对应身份。

- [ ] **Step 2: 写入真实验收结论**

只有项目所有者明确全部通过时才能写：

```text
REAL_EXTERNAL_AGENT_LOW_CONTEXT_ACCEPTANCE_PASSED
OWNER_EDITOR_AND_PREVIEW_ACCEPTANCE_PASSED
WAVE_4_AGENT_PORT_VERIFIED
READY_FOR_OWNER_PUSH_DECISION
```

若失败，写实际阻断，不得使用上述通过状态。

- [ ] **Step 3: 创建普通文档闭合提交**

```powershell
git add -- docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md docs/SURDET-AGENT-PORT-STAGE-6-WAVE-4-DELIVERY-REPORT-2026-08-20.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(authoring): close wave 4 acceptance"
```

- [ ] **Step 4: 停在 push 门**

```text
WAITING_FOR_OWNER_PUSH_AUTHORIZATION
NOT_DEPLOYED
NOT_RELEASED
WAVE_5_NOT_STARTED
```

执行 AI 不运行 `git push`。只有项目所有者明确说“批准 push”后，总经理另行核对提交范围、实时远端和 ahead/behind，再执行普通 push 与远端回读。

---

## 四、任务间审查门

每个代码 Task 完成后，日常 Architect 只审本 Task 的提交，不要求重复整个 Wave：

| Task | 架构审查重点 | 可靠性反测重点 |
|---|---|---|
| 1 | registry 是否协议无关、是否唯一真相 | 20 项唯一、schema 严格、MCP 名单射 |
| 2 | 错误/repair 是否确定且不做创作判断 | terminal/retry 分类、无 retriable fallback |
| 3 | observe 是否真只读、evidence 是否新鲜 | 无隐藏 change、mutation 后 evidence stale |
| 4 | CLI/MCP 是否共用 dispatcher/envelope | 旧 CLI 纵向回归、未知字段拒绝 |
| 5 | single project/session/policy 是否不可绕过 | 跨项目 resume、单活动 change、退出保留 |
| 6 | MCP 是否纯薄适配 | tools/list、structuredContent、stdout 纯净 |
| 7 | 胶囊是否由真实证据派生 | 磁盘回读 hash、失败记录不删除、stage 未写项目 |
| 8 | 安全边界是否有反向证据 | 越权/路径/基线/recovery/child cleanup |
| 9 | runner 是否真实 stdio 且方法稳定 | official client、同 launcher、fixture 隔离 |
| 10 | FORMAL 身份是否匹配冻结 HEAD | runHead/hash/失败保留/未代填人工 |

Architect 发现 Blocker/High 时停止下一 Task；Medium 只有确实影响当前合同才返修；Low 建议登记，不自动扩大本 Wave。

## 五、FORMAL artifact 最低字段

```json
{
  "schemaVersion": "1.0.0",
  "evidenceClass": "FORMAL",
  "status": "PASSED",
  "runHead": "<exact CODE_EVIDENCE_HEAD>",
  "contractVersion": "1.0.0",
  "engineVersion": "0.1.0",
  "launcher": {
    "entry": "packages/cli/dist/agent-port/main.js",
    "transport": "stdio",
    "sdkServer": "2.0.0",
    "sdkClient": "2.0.0",
    "legacy": "reject"
  },
  "stage": {
    "policy": "stage",
    "toolNames": [],
    "changeId": "",
    "projectBeforeSha256": "",
    "projectAfterSha256": "",
    "projectUnchanged": true,
    "capsule": {}
  },
  "apply": {
    "policy": "apply",
    "resumedChangeId": "",
    "validationRequiredRedLight": true,
    "committed": true,
    "projectBeforeSha256": "",
    "projectAfterSha256": "",
    "capsule": {}
  },
  "repairChain": {
    "errorCode": "OBJECT_PRECONDITION_FAILED",
    "retryDisposition": "after-inspect",
    "repairTool": "surdet_object_inspect",
    "repaired": true
  },
  "validation": {},
  "simulation": {},
  "runtimePaths": [],
  "traces": [],
  "diff": {},
  "originalStarter": {},
  "errors": {
    "protocol": [],
    "domainUnexpected": [],
    "stderrUnexpected": [],
    "unhandledRejections": [],
    "childCleanupFailures": []
  }
}
```

尖括号值只表示运行时必须写入的真实 HEAD；报告不得预填或凭记忆复制。artifact 写盘实现不得使用此示例作为假结果。

## 六、失败停止模板

任何高成本节点失败时，报告统一使用：

```text
RESULT = FAILED
EVIDENCE_CLASS = PREFLIGHT | DIAGNOSTIC | FORMAL | EXTERNAL_AGENT | OWNER_ACCEPTANCE
RUN_HEAD = <git rev-parse HEAD>
LAST_PASSED_NODE = <实际节点>
FIRST_FAILED_NODE = <实际节点>
FAILURE_SCOPE = PRODUCTION | CONTRACT | HARNESS | ENVIRONMENT | UNKNOWN
ARTIFACT_PATH = <磁盘路径>
ARTIFACT_BYTES = <磁盘回读>
ARTIFACT_SHA256 = <磁盘回读>
PROJECT_MUTATED = YES | NO | UNKNOWN
NEXT_ALLOWED_ACTION = <任务书允许的唯一动作>
NOT_RERUN = TRUE
```

不得把失败一律归因于 harness，也不得因 runner 失败猜改生产代码。

## 七、Execution Ledger

### 2026-08-20 总任务书生成基线

```text
PLANNING_BASE_HEAD = 4af0d91ea59acc1a6de890df9481a345b503234c
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND = 1 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
DESIGN_SPEC = APPROVED_BY_OWNER
TASKBOOK_AUTHORING = AUTHORIZED
WAVE_4_IMPLEMENTATION = NOT_AUTHORIZED_AT_TASKBOOK_CREATION
FORMAL = NOT_STARTED
REAL_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
OWNER_ACCEPTANCE = NOT_STARTED
PUSH = NOT_AUTHORIZED
WAVE_5 = NOT_STARTED
```

总经理只读盘点确认：当前 20 项能力仍由 `packages/cli/src/authoring/authoring-service.ts` 的 `AUTHORING_CAPABILITIES` 手写；错误代码、category、`retriable` 与 action 仍由 `packages/cli/src/authoring-command.ts` 私有维护；`project.validate` / `project.simulate` 当前只接受 changeId；Node change store 已有 transaction/evidence/journal/diff/trace 项目外持久化能力。任务书据此把 registry/error、observe、dispatcher、session、MCP、capsule 与 FORMAL 分成独立红绿灯任务。

官方依赖事实于任务书生成时只读核对：`@modelcontextprotocol/server@2.0.0`、`@modelcontextprotocol/core@2.0.0`、`@modelcontextprotocol/client@2.0.0` 均为 MIT、Node >=20；正式实现仍须在 Task 0 重新核对。

当前停止状态：

```text
WAVE_4_MASTER_TASKBOOK_COMPLETED
WAITING_FOR_OWNER_IMPLEMENTATION_AUTHORIZATION
NO_PRODUCTION_CODE_CHANGED_BY_TASKBOOK_AUTHORING
NOT_PUSHED_AFTER_WAVE_4_DESIGN
WAVE_5_NOT_STARTED
```

### 2026-08-21 Task 4 evidence and native CLI contract migration

```text
TASK_4_EXECUTION_TIME = 2026-08-21 02:51:58 +08:00
TASK_4_RED = PASS
TASK_4_RED_COMMAND = npm run build -w @surdet/authoring; npm run build -w @surdet/cli; npm run test -w @surdet/cli -- authoring-contract.test.ts authoring-presentation-wave2.test.ts authoring-project-config-wave3.test.ts
TASK_4_RED_EXIT = 1
TASK_4_RED_EVIDENCE = legacy capability string/envelope assertions failed; unknown input fields were accepted before dispatcher/schema migration
TASK_4_GREEN_FOCUSED_COMMAND = npm run test -w @surdet/cli -- authoring-contract.test.ts authoring-presentation-wave2.test.ts authoring-project-config-wave3.test.ts authoring-vertical-slice.test.ts
TASK_4_GREEN_FOCUSED_EXIT = 0
TASK_4_GREEN_FOCUSED_RESULT = 4 files / 14 tests passed
TASK_4_TYPECHECK_COMMAND = npm run typecheck -w @surdet/cli
TASK_4_TYPECHECK_EXIT = 0
TASK_4_BUILD_COMMAND = npm run build -w @surdet/cli
TASK_4_BUILD_EXIT = 0
TASK_4_FULL_CLI_COMMAND = npm run test -w @surdet/cli
TASK_4_FULL_CLI_INITIAL_EXIT = 1
TASK_4_FULL_CLI_INITIAL_FAILURE = stale packages/cli/test/change-isolation.test.ts assertion expected removed error.retriable=false
TASK_4_CONTRACT_SYNC_COMMIT = e879ad7
TASK_4_CONTRACT_SYNC_SCOPE = packages/cli/test/change-isolation.test.ts only; retryDisposition=manual-recovery and no retriable field
TASK_4_CONTRACT_SYNC_RETEST = npm run test -w @surdet/cli -- change-isolation.test.ts; exit 0; 6 tests passed
TASK_4_FULL_CLI_FINAL_EXIT = 0
TASK_4_FULL_CLI_FINAL_RESULT = 16 files / 141 tests passed
TASK_4_SCOPE = shared dispatcher, MCP v2 JSON Schema adapter, native CLI envelope/registry migration, exact MCP dependencies, contract test migration
TASK_4_PROJECT_ROOT_CONTEXT = injected by dispatcher; rejected from payload schema
TASK_4_SHARED_DISPATCHER = PASS
TASK_4_SHARED_SCHEMA_VALIDATOR = PASS
TASK_4_SHARED_ENVELOPE = PASS
TASK_4_UNKNOWN_INPUT_REJECTION = PASS
TASK_4_NO_CLI_PRIVATE_ERROR_CATALOG = PASS
TASK_4_MCP_DEPENDENCIES = @modelcontextprotocol/core@2.0.0,@modelcontextprotocol/server@2.0.0 dependencies; @modelcontextprotocol/client@2.0.0 devDependency
TASK_4_CODE_COMMIT = 04c5392
TASK_4_CODE_COMMIT_PARENT = e879ad7
TASK_4_CODE_COMMIT_MESSAGE = refactor(cli): share agent authoring contract
TASK_4_CODE_COMMIT_SCOPE = package-lock.json; packages/cli/package.json; packages/cli/src/authoring-command.ts; packages/cli/src/authoring/authoring-dispatcher.ts; packages/cli/src/authoring/authoring-service.ts; packages/cli/src/authoring/schema-validator.ts; packages/cli/test/authoring-contract.test.ts; packages/cli/test/authoring-presentation-wave2.test.ts; packages/cli/test/authoring-project-config-wave3.test.ts
TASK_4_PUSH = NOT_AUTHORIZED
TASK_4_ROADMAP_MODIFIED = NO
TASK_4_FORBIDDEN_PRODUCTION_FILES_MODIFIED = NO
TASK_4_NEXT = TASK_5_SINGLE_PROJECT_SESSION_POLICY_RESUME
```

### 2026-08-21 Task 5 evidence and session policy/resume contract

```text
TASK_5_EXECUTION_TIME = 2026-08-21 03:00:31 +08:00
TASK_5_RED = PASS
TASK_5_RED_COMMAND = npm run test -w @surdet/cli -- agent-port-session.test.ts
TASK_5_RED_EXIT = 1
TASK_5_RED_EVIDENCE = agent-port/session.ts did not exist; independent session contract suite could not load the implementation
TASK_5_GREEN_FOCUSED_COMMAND = npm run test -w @surdet/cli -- agent-port-session.test.ts
TASK_5_GREEN_FOCUSED_EXIT = 0
TASK_5_GREEN_FOCUSED_RESULT = 1 file / 8 tests passed
TASK_5_STORAGE_REGRESSION_COMMAND = npm run test -w @surdet/cli -- agent-port-session.test.ts node-project-storage.test.ts change-isolation.test.ts
TASK_5_STORAGE_REGRESSION_EXIT = 0
TASK_5_STORAGE_REGRESSION_RESULT = 3 files / 20 tests passed
TASK_5_TYPECHECK_COMMAND = npm run typecheck -w @surdet/cli
TASK_5_TYPECHECK_EXIT = 0
TASK_5_BUILD_COMMAND = npm run build -w @surdet/cli
TASK_5_BUILD_EXIT = 0
TASK_5_ARGUMENT_PARSER = PASS
TASK_5_POLICY_MATRIX = PASS
TASK_5_SINGLE_PROJECT_BINDING = PASS
TASK_5_CONTEXT_INJECTION_REJECTION = PASS
TASK_5_OBSERVE_NO_MUTATION = PASS
TASK_5_STAGE_COMMIT_BLOCK = PASS
TASK_5_APPLY_NO_HIDDEN_CHANGE = PASS
TASK_5_RESUME_OWNERSHIP = PASS
TASK_5_ONE_ACTIVE_CHANGE = PASS
TASK_5_CLOSE_PRESERVES_OPEN = PASS
TASK_5_OWNED_CHANGE_LOOKUP = PASS
TASK_5_CONTRACT_SYNC_COMMIT = e879ad7
TASK_5_ERROR_MAPPING_COMMIT = 40a8a9d
TASK_5_CODE_COMMIT = 3eedfdb
TASK_5_CODE_COMMIT_PARENT = 40a8a9d
TASK_5_CODE_COMMIT_MESSAGE = feat(cli): bind agent port sessions
TASK_5_CODE_COMMIT_SCOPE = packages/cli/src/agent-port/args.ts; packages/cli/src/agent-port/policy.ts; packages/cli/src/agent-port/session.ts; packages/cli/src/authoring/node-change-store.ts; packages/cli/test/agent-port-session.test.ts
TASK_5_PUSH = NOT_AUTHORIZED
TASK_5_ROADMAP_MODIFIED = NO
TASK_5_FORBIDDEN_PRODUCTION_FILES_MODIFIED = NO
TASK_5_NEXT = TASK_6_MCP_STDIO_TOOL_PROJECTION
```

### 2026-08-21 Task 6 evidence and MCP stdio tool projection

```text
TASK_6_EXECUTION_TIME = 2026-08-21 03:06:55 +08:00
TASK_6_RED = PASS
TASK_6_RED_COMMAND = npm run test -w @surdet/cli -- agent-port-tools.test.ts
TASK_6_RED_EXIT = 1
TASK_6_RED_EVIDENCE = agent-port/server.ts did not exist; typed MCP projection suite could not load the implementation
TASK_6_GREEN_FOCUSED_COMMAND = npm run test -w @surdet/cli -- agent-port-tools.test.ts agent-port-session.test.ts
TASK_6_GREEN_FOCUSED_EXIT = 0
TASK_6_GREEN_FOCUSED_RESULT = 2 files / 13 tests passed
TASK_6_TYPECHECK_COMMAND = npm run typecheck -w @surdet/cli
TASK_6_TYPECHECK_EXIT = 0
TASK_6_BUILD_COMMAND = npm run build -w @surdet/cli
TASK_6_BUILD_EXIT = 0
TASK_6_POLICY_TOOL_COUNTS = observe=allowedCapabilitiesForPolicy(observe)+session; stage=allowedCapabilitiesForPolicy(stage)+session; apply=21
TASK_6_TYPED_PROJECTION = PASS
TASK_6_OUTPUT_SCHEMA = FULL_ENVELOPE_SCHEMA_FROM_CREATE_ENVELOPE_JSON_SCHEMA
TASK_6_ANNOTATIONS = PASS
TASK_6_DOMAIN_FAILURE = isError=true_and_structuredContent_failure_envelope_PASS
TASK_6_PROTOCOL_FAILURE = unknown_tool_rejected_as_protocol_error_PASS
TASK_6_INVALID_POLICY_SMOKE_STATUS = 1
TASK_6_INVALID_POLICY_SMOKE_STDOUT = EMPTY
TASK_6_INVALID_POLICY_SMOKE_STDERR = Surdet Agent Port failed: INVALID_REQUEST
TASK_6_REAL_STDIO_CLIENT = @modelcontextprotocol/client Client+StdioClientTransport
TASK_6_REAL_STDIO_INITIALIZE_TOOLS_LIST = PASS
TASK_6_REAL_STDIO_TOOL_COUNT = 21
TASK_6_REAL_STDIO_UNIQUE_TOOL_NAMES = PASS
TASK_6_REAL_STDIO_STDOUT_PROTOCOL_PURITY = PASS
TASK_6_REAL_STDIO_READY_BANNER = STDERR_ONLY
TASK_6_SCOPE = typed tool projection, policy-filtered MCP server, legacy reject stdio entry, second CLI bin, protocol/security regressions
TASK_6_CODE_COMMIT = 108d9ab
TASK_6_CODE_COMMIT_PARENT = 3eedfdb
TASK_6_CODE_COMMIT_MESSAGE = feat(cli): expose typed MCP agent tools
TASK_6_CODE_COMMIT_SCOPE = packages/cli/package.json; packages/cli/src/agent-port/main.ts; packages/cli/src/agent-port/server.ts; packages/cli/src/agent-port/tool-projection.ts; packages/cli/test/agent-port-tools.test.ts
TASK_6_PUSH = NOT_AUTHORIZED
TASK_6_ROADMAP_MODIFIED = NO
TASK_6_FORBIDDEN_PRODUCTION_FILES_MODIFIED = NO
TASK_6_NEXT = TASK_7_INVOCATION_LEDGER_AND_DELIVERY_CAPSULE
```

### 2026-08-21 Task 7 evidence and invocation ledger / delivery capsule

```text
TASK_7_EXECUTION_TIME = 2026-08-21 03:20:10 +08:00
TASK_7_RED = PASS
TASK_7_RED_COMMAND = npm run test -w @surdet/cli -- agent-port-capsule.test.ts
TASK_7_RED_EXIT = 1
TASK_7_RED_EVIDENCE = delivery-capsule module did not exist; capsule suite failed during module loading before any test ran
TASK_7_GREEN_FOCUSED_COMMAND = npm run test -w @surdet/cli -- agent-port-capsule.test.ts agent-port-session.test.ts agent-port-tools.test.ts
TASK_7_GREEN_FOCUSED_EXIT = 0
TASK_7_GREEN_FOCUSED_RESULT = 3 files / 18 tests passed
TASK_7_CAPSULE_TESTS = 5 passed; failure retention, OPEN stage, committed apply resume, stale evidence freshness, immutable/disk identity
TASK_7_TYPECHECK_COMMAND = npm run typecheck -w @surdet/cli
TASK_7_TYPECHECK_EXIT = 0
TASK_7_BUILD_COMMAND = npm run build -w @surdet/cli
TASK_7_BUILD_EXIT = 0
TASK_7_DIFF_CHECK = git diff --check; exit 0
TASK_7_CACHED_DIFF_CHECK = git diff --cached --check; exit 0 before commit
TASK_7_INVOCATION_LEDGER = independent JSON records with monotonic sequence + UUID; stableStringify(input) SHA-256 only; failed calls retained; no raw input/text/prompt
TASK_7_CAPSULE_STORAGE = payload.json plus identity.json; temporary write + atomic rename; disk reread bytes/SHA-256 identity
TASK_7_CAPSULE_DERIVATION = PASS; transaction, invocation, evidence, diff, trace and latest journal are read from project-external change storage
TASK_7_PROJECT_MUTATION_CONTRACT = OPEN stage occurred=false and before=after; committed apply occurred=true with changed revision; empty change warning retained
TASK_7_EVIDENCE_FRESHNESS = PASS; validation/simulation/runtime/diff report stale after later mutation without deleting prior evidence
TASK_7_MCP_CAPSULE_TOOL = PASS; stage=21 tools, apply=22 tools, unresumed observe excludes capsule; stage call returned structured immutable artifact identity
TASK_7_CODE_COMMIT = 58e6804b10c52388365da539ca1e2e7b79c5ec01
TASK_7_CODE_COMMIT_PARENT = 108d9abf4b393dae11bae2a74b54b3874ff21e40
TASK_7_CODE_COMMIT_MESSAGE = feat(cli): seal agent delivery capsules
TASK_7_CODE_COMMIT_SCOPE = packages/cli/src/agent-port/invocation-ledger.ts; packages/cli/src/agent-port/delivery-capsule.ts; packages/cli/src/agent-port/session.ts; packages/cli/src/agent-port/server.ts; packages/cli/src/authoring/node-change-store.ts; packages/cli/test/agent-port-capsule.test.ts; packages/cli/test/agent-port-tools.test.ts
TASK_7_PUSH = NOT_AUTHORIZED
TASK_7_ROADMAP_MODIFIED = NO
TASK_7_FORBIDDEN_PRODUCTION_FILES_MODIFIED = NO
TASK_7_NEXT = TASK_8_SECURITY_COUNTERTESTS
```

### 2026-08-21 Task 8 evidence and security countertests

```text
TASK_8_EXECUTION_TIME = 2026-08-21 03:27:22 +08:00
TASK_8_RED = PASS
TASK_8_RED_COMMAND = npm run test -w @surdet/cli -- agent-port-security.test.ts
TASK_8_RED_EXIT = 1
TASK_8_RED_EVIDENCE = security test file did not exist; the new security suite could not load
TASK_8_POLICY_NEGATIVE_CONTROL = PASS
TASK_8_POLICY_NEGATIVE_CONTROL_ACTION = temporarily changed session policy gate to false && isCapabilityAllowed; restored immediately with apply_patch
TASK_8_POLICY_NEGATIVE_CONTROL_COMMAND = npm run test -w @surdet/cli -- agent-port-security.test.ts -t "rejects observe begin"
TASK_8_POLICY_NEGATIVE_CONTROL_EXIT = 1
TASK_8_POLICY_NEGATIVE_CONTROL_EVIDENCE = observe change.begin returned success and the rejection assertion failed
TASK_8_SECURITY_GREEN_COMMAND = npm run test -w @surdet/cli -- agent-port-security.test.ts
TASK_8_SECURITY_GREEN_EXIT = 0
TASK_8_SECURITY_GREEN_RESULT = 1 file / 12 tests passed
TASK_8_FOCUSED_REGRESSION_COMMAND = npm run test -w @surdet/cli -- agent-port-security.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-capsule.test.ts
TASK_8_FOCUSED_REGRESSION_EXIT = 0
TASK_8_FOCUSED_REGRESSION_RESULT = 4 files / 30 tests passed
TASK_8_FULL_CLI_COMMAND = npm run test -w @surdet/cli
TASK_8_FULL_CLI_EXIT = 0
TASK_8_FULL_CLI_RESULT = 20 files / 171 tests passed
TASK_8_TYPECHECK_COMMAND = npm run typecheck -w @surdet/cli
TASK_8_TYPECHECK_EXIT = 0
TASK_8_BUILD_COMMAND = npm run build -w @surdet/cli
TASK_8_BUILD_EXIT = 0
TASK_8_BOUNDARY_COVERAGE = policy/state gates; payload context/path/extra rejection; project ownership; terminal change resume; operationId conflict; external project stale; recovery-failed no retry; stdout purity; SIGINT/SIGTERM child cleanup
TASK_8_PRODUCTION_FILES_MODIFIED = NO
TASK_8_CODE_COMMIT = 873c4615ac19e4a950cb4f68ac4c9821e4d057c7
TASK_8_CODE_COMMIT_PARENT = 58e6804b10c52388365da539ca1e2e7b79c5ec01
TASK_8_CODE_COMMIT_MESSAGE = test(cli): enforce agent port boundaries
TASK_8_CODE_COMMIT_SCOPE = packages/cli/test/agent-port-security.test.ts
TASK_8_PUSH = NOT_AUTHORIZED
TASK_8_ROADMAP_MODIFIED = NO
TASK_8_FORBIDDEN_PRODUCTION_FILES_MODIFIED = NO
TASK_8_NEXT = TASK_9_DETERMINISTIC_REAL_STDIO_RUNNER
```

### 2026-08-21 Task 9/10 deterministic runner evidence and bounded diagnostic stop

```text
TASK_9_EXECUTION_TIME = 2026-08-21 03:41:51 +08:00
TASK_9_STATIC_RED = PASS
TASK_9_STATIC_RED_COMMAND = node --check packages/cli/e2e/agent-port-wave-4.e2e.mjs; node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
TASK_9_STATIC_RED_EXIT = 1
TASK_9_STATIC_RED_EVIDENCE = initial runner skeleton rejected preflight as not implemented
TASK_9_PROTOCOL_NEGOTIATION_REPAIR = PASS
TASK_9_PROTOCOL_NEGOTIATION_EVIDENCE = official Client v2 auto negotiation required because the real launcher serves legacy=reject
TASK_9_FOCUSED_AUTHORING_COMMAND = npm run test -w @surdet/authoring
TASK_9_FOCUSED_AUTHORING_EXIT = 0
TASK_9_FOCUSED_AUTHORING_RESULT = 22 files / 132 tests passed
TASK_9_FOCUSED_CLI_COMMAND = npm run test -w @surdet/cli
TASK_9_FOCUSED_CLI_EXIT = 0
TASK_9_FOCUSED_CLI_RESULT = 20 files / 171 tests passed
TASK_9_TYPECHECK_AUTHORING_EXIT = 0
TASK_9_TYPECHECK_CLI_EXIT = 0
TASK_9_BUILD_AUTHORING_EXIT = 0
TASK_9_BUILD_CLI_EXIT = 0
TASK_9_PREFLIGHT_COMMAND = node --check packages/cli/e2e/agent-port-wave-4.e2e.mjs; node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
TASK_9_PREFLIGHT_EXIT = 0
TASK_9_PREFLIGHT_RESULT = launcher/initialize/tools-list/read-only inspect/stdout purity/child cleanup PASS
TASK_9_RUNNER_COMMIT = 6107a3fe48de9dd619d10f8871d47e78f899a620
TASK_9_RUNNER_COMMIT_PARENT = 873c4615ac19e4a950cb4f68ac4c9821e4d057c7
TASK_9_RUNNER_COMMIT_SCOPE = packages/cli/e2e/agent-port-wave-4.e2e.mjs only
TASK_9_PUSH = NOT_AUTHORIZED

TASK_10_FINAL_FOCUSED_RERUN_EXIT = 0
TASK_10_VERIFY_ALL_COMMAND = npm run verify:all
TASK_10_VERIFY_ALL_EXIT = 0
TASK_10_VERIFY_ALL_RUN_COUNT = 1
TASK_10_DIAGNOSTIC_ATTEMPT_1_RUN_HEAD = 6107a3fe48de9dd619d10f8871d47e78f899a620
TASK_10_DIAGNOSTIC_ATTEMPT_1_EXIT = 1
TASK_10_DIAGNOSTIC_ATTEMPT_1_FIRST_FAILED_NODE = stage-connect-and-discover / surdet_capabilities_describe
TASK_10_DIAGNOSTIC_ATTEMPT_1_FAILURE = MCP output schema rejected registry metadata JSON Schema and mcpTool; no structuredContent
TASK_10_DIAGNOSTIC_ATTEMPT_1_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-Wdr0lC\evidence.json
TASK_10_DIAGNOSTIC_ATTEMPT_1_ARTIFACT_BYTES = 740
TASK_10_DIAGNOSTIC_ATTEMPT_1_ARTIFACT_SHA256 = 16E809B9FD2F0CA0277FE822297D281422C5C5B7FEDCFB53628F5CF11537D090
TASK_10_DIAGNOSTIC_ATTEMPT_1_IDENTITY_READBACK = PASS
TASK_10_DIAGNOSTIC_ATTEMPT_1_REPAIR_COMMIT = ca1ab808faee0e25b3c51dd44565ca9935d49d3b
TASK_10_DIAGNOSTIC_ATTEMPT_1_REPAIR_SCOPE = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-tools.test.ts
TASK_10_DIAGNOSTIC_ATTEMPT_1_REPAIR_VERIFICATION = focused MCP tools 5 tests PASS; authoring test/typecheck/build and CLI typecheck/build exit 0

TASK_10_DIAGNOSTIC_ATTEMPT_2_RUN_HEAD = ca1ab808faee0e25b3c51dd44565ca9935d49d3b
TASK_10_DIAGNOSTIC_ATTEMPT_2_EXIT = 1
TASK_10_DIAGNOSTIC_ATTEMPT_2_FIRST_FAILED_NODE = stage-connect-and-discover / surdet_object_inspect timeline
TASK_10_DIAGNOSTIC_ATTEMPT_2_FAILURE = MCP output schema rejected nested timeline details; no structuredContent
TASK_10_DIAGNOSTIC_ATTEMPT_2_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-vC7Diz\evidence.json
TASK_10_DIAGNOSTIC_ATTEMPT_2_ARTIFACT_BYTES = 726
TASK_10_DIAGNOSTIC_ATTEMPT_2_ARTIFACT_SHA256 = BB924C244502C72A20D6267237BC4DE36E7CEFECA9F33E9CBCEE5823BE3B610B
TASK_10_DIAGNOSTIC_ATTEMPT_2_IDENTITY_READBACK = PASS
TASK_10_DIAGNOSTIC_ATTEMPT_2_REPAIR_COMMIT = 0a712640f600c0955579144f045668e822e39896
TASK_10_DIAGNOSTIC_ATTEMPT_2_REPAIR_SCOPE = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-tools.test.ts
TASK_10_DIAGNOSTIC_ATTEMPT_2_REPAIR_VERIFICATION = focused MCP tools 6 tests PASS; authoring test/typecheck and CLI typecheck/build exit 0

TASK_10_DIAGNOSTIC_ATTEMPT_3_RUN_HEAD = 0a712640f600c0955579144f045668e822e39896
TASK_10_DIAGNOSTIC_ATTEMPT_3_EXIT = 1
TASK_10_DIAGNOSTIC_ATTEMPT_3_FIRST_FAILED_NODE = stage-connect-and-discover / surdet_object_inspect config:entryScene
TASK_10_DIAGNOSTIC_ATTEMPT_3_FAILURE = MCP output schema still requires object details, while config:entryScene details is a scalar string
TASK_10_DIAGNOSTIC_ATTEMPT_3_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-giII4f\evidence.json
TASK_10_DIAGNOSTIC_ATTEMPT_3_ARTIFACT_BYTES = 726
TASK_10_DIAGNOSTIC_ATTEMPT_3_ARTIFACT_SHA256 = A205F9BC2A2E6A78EBF8DE5120A58C08901826E6C564791089FC9BFE450D354B
TASK_10_DIAGNOSTIC_ATTEMPT_3_IDENTITY_READBACK = PASS
TASK_10_DIAGNOSTIC_BUDGET = 3
TASK_10_DIAGNOSTIC_BUDGET_USED = 3
TASK_10_FORMAL = NOT_STARTED
TASK_10_FORMAL_REASON = third DIAGNOSTIC failed; taskbook requires stop and forbids FORMAL rerun/continuation
TASK_10_PRODUCTION_AFTER_THIRD_DIAGNOSTIC = NO_CHANGE
TASK_10_LAST_CODE_EVIDENCE_HEAD = 0a712640f600c0955579144f045668e822e39896
TASK_10_REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
TASK_10_AHEAD_BEHIND = 13/0
TASK_10_AHEAD_BEHIND_STATUS = PRE_DOCUMENT_CLOSURE_HISTORICAL_SNAPSHOT
TASK_10_UNRELATED_TRACKED_CHANGES = NO
TASK_10_PROTECTED_UNTRACKED_GOVERNANCE = PRESERVED_NOT_STAGED
TASK_10_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
TASK_10_STATUS = BLOCKED_AT_DIAGNOSTIC_BUDGET_EXHAUSTED
TASK_10_PUSH = NOT_AUTHORIZED
TASK_10_WAVE_5 = NOT_STARTED
```

### 2026-08-21 Task 10 recovery — `object.inspect.details` output schema

```text
TASK_10_RECOVERY_EXECUTION_TIME = 2026-08-21 04:09:55 +08:00
TASK_10_RECOVERY_AUTHORIZATION = OWNER_AUTHORIZED_DETAILS_SCHEMA_ONLY
TASK_10_RECOVERY_SCOPE = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-tools.test.ts; current Wave 4 taskbook/report
TASK_10_RECOVERY_RED_COMMAND = npm run test -w @surdet/cli -- test/agent-port-tools.test.ts
TASK_10_RECOVERY_RED_EXIT = 1
TASK_10_RECOVERY_RED_RESULT = 6 tests / 1 failed; config:entryScene scalar details rejected by object-only MCP output schema
TASK_10_RECOVERY_DETAILS_CASES = config:entryScene string; timeline nested object; ordinary scene without details
TASK_10_RECOVERY_SCHEMA_FIX = inspection details oneOf string/object; whole envelope and jsonValueSchema unchanged
TASK_10_RECOVERY_AUTHORING_FOCUSED = npm run test -w @surdet/authoring -- test/capability-registry.test.ts ; EXIT_CODE=0 ; 3 tests passed
TASK_10_RECOVERY_CLI_FOCUSED = npm run test -w @surdet/cli -- test/agent-port-tools.test.ts ; EXIT_CODE=0 ; 6 tests passed
TASK_10_RECOVERY_AUTHORING_TYPECHECK = EXIT_CODE=0
TASK_10_RECOVERY_AUTHORING_BUILD = EXIT_CODE=0
TASK_10_RECOVERY_CLI_TYPECHECK = EXIT_CODE=0
TASK_10_RECOVERY_CLI_BUILD = EXIT_CODE=0
TASK_10_RECOVERY_CODE_COMMIT = ba22c488f045621909432114d68b4a0ea121aff3
TASK_10_RECOVERY_CODE_COMMIT_PARENT = 90f413f8bf2539a70eca8ed18bebd816c22cc5f2
TASK_10_RECOVERY_CODE_COMMIT_SCOPE = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-tools.test.ts
TASK_10_RECOVERY_PREFLIGHT_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
TASK_10_RECOVERY_PREFLIGHT_EXIT = 0
TASK_10_RECOVERY_DIAGNOSTIC_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode diagnostic
TASK_10_RECOVERY_DIAGNOSTIC_RUN_HEAD = ba22c488f045621909432114d68b4a0ea121aff3
TASK_10_RECOVERY_DIAGNOSTIC_EXIT = 1
TASK_10_RECOVERY_DIAGNOSTIC_LAST_PASSED_NODE = none
TASK_10_RECOVERY_DIAGNOSTIC_FIRST_FAILED_NODE = stage-connect-and-discover / surdet_project_validate
TASK_10_RECOVERY_DIAGNOSTIC_FAILURE = surdet_project_validate returned no structuredContent
TASK_10_RECOVERY_DIAGNOSTIC_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-DeyCw3\evidence.json
TASK_10_RECOVERY_DIAGNOSTIC_ARTIFACT_BYTES = 730
TASK_10_RECOVERY_DIAGNOSTIC_ARTIFACT_SHA256 = 2CEE0934EE80B0897510E51865C31AD59368074255B5D59947D3477709C3AA61
TASK_10_RECOVERY_DIAGNOSTIC_IDENTITY_READBACK = PASS
TASK_10_RECOVERY_DIAGNOSTIC_BUDGET = 1/3 USED
TASK_10_RECOVERY_VERIFY_ALL = NOT_RUN_AFTER_DIAGNOSTIC_FAILURE
TASK_10_RECOVERY_FORMAL = NOT_STARTED
TASK_10_RECOVERY_RUNNER_MODIFIED = NO
TASK_10_RECOVERY_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
TASK_10_RECOVERY_OWNER_ACCEPTANCE = NOT_STARTED
TASK_10_RECOVERY_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
TASK_10_RECOVERY_WAVE_5 = NOT_STARTED
TASK_10_RECOVERY_PUSH = NOT_AUTHORIZED

TASK_10_WDR0LC_SHA256_IDENTITY_CORRECTION = 16E809B9FD2F0CA0277FE822297D281422C5C5B7FEDCFB53628F5CF11537D090
TASK_10_PRE_DOCUMENT_CLOSURE_AHEAD_BEHIND = 13/0
TASK_10_PRE_DOCUMENT_CLOSURE_AHEAD_BEHIND_STATUS = HISTORICAL_SNAPSHOT_ONLY
TASK_10_DOCUMENT_SELF_COMMIT_HASH = NOT_REQUIRED_BY_OWNER
```
