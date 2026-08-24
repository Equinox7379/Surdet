# Pre-Wave 5 Evidence Trustworthiness / Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create sub-agents unless the project owner separately authorizes delegation.

**Goal:** 让 Surdet 的自动模拟、运行轨迹与项目验证真正可信：同一 seed 必须驱动同一条 `@random` 序列并可随快照恢复；非法场景 ID、缺少 `@` 的 choice 行内动作和重复场景 ID 必须 fail-loud，不能静默丢失、覆盖或跳到错误对象。

**Architecture:** Core 提供唯一的场景 ID 合同和可快照的状态化随机源；普通未注入随机源的玩家运行继续使用系统随机，不改变既有体验。Authoring 的模拟与显式路径、CLI 的 `simulate` 与 Agent Port 的 `project.simulate` / `runtime.run-from` 全部复用 Core 随机源，并记录实际生效的 seed。共享验证在建立场景索引前先检查非法与重复 ID，保留每个物理场景文件的诊断；CLI 只做 Node/协议薄适配，不复制解析器、模拟器或 RNG。

**Tech Stack:** TypeScript 5.7、Vitest 3、`@surdet/core` DSL / Interpreter / SaveSnapshot、`@surdet/authoring` validation / simulation / capability registry、`@surdet/cli` Node adapter / Agent Port。

## Global Constraints

- 本计划属于 `Pre-Wave 5 Foundation Polish` 的第三个可执行 Wave；Wave 5 仍未开始。
- 本 Wave 只有一个主题：`evidence trustworthiness`。四项缺口共同决定“自动证据能否被相信”，不得扩展为全 DSL 清理、全引擎重构或新 Agent 能力开发。
- 四项必须一起闭合：
  1. `@random` 的 seed 真正参与取值；
  2. 场景 ID 寻址不再允许点号歧义；
  3. choice 行内动作缺少 `@` 时编译失败；
  4. 共享 Authoring 验证发现重复场景 ID，且不丢失第二个文件的诊断。
- 普通玩家运行默认行为保持不变：未显式注入 seeded source 的 Interpreter 继续使用系统随机。
- 只有模拟、显式运行轨迹和 Agent evidence 路径默认使用固定 seed；不得把整个正式 Player 强制改成固定随机。
- 不升级 `SAVE_SCHEMA_VERSION`。新增的随机状态是可选字段；旧存档缺失该字段必须继续可读。
- 不声称“所有系统随机均已确定化”。本 Wave 只覆盖 DSL `@random` 与使用 Interpreter 的 Authoring / CLI evidence 路径；Combat 等独立随机入口不在范围内。
- 不改变 `sceneId.label` 的既有引用语法，也不改为“从最后一个点分割”。通过统一禁止 scene ID 含点号来消除歧义。
- 不新增第二套 scene ID 正则、第二套模拟器、第二套状态签名或第二套随机算法。
- CLI 和 Agent Port 必须复用 Core / Authoring 公共合同；不得为了输出 seed 在 dispatcher 中伪造字段。
- 不新增依赖，不修改 lockfile，不引入通用 RNG 框架、插件系统、迁移系统或版本协商层。
- 不修改 Renderer、Host、Shell、Editor 生产代码、Starter、Zero 或具体游戏内容。
- 不修改长期路线台账，不触碰 `SESSION-HANDOFF.md`、`USER.md` 与两份受保护美术资料。
- 不运行 Electron、浏览器人工验收、性能资格化、pack、部署或发行；本 Wave 是无头语义可靠性任务，精确自动证据足以验收。
- 不运行 DIAGNOSTIC / FORMAL 聚合 harness。聚焦测试稳定后运行一次 `verify:all`；若且仅若它暴露本 Wave 直接造成的单一问题，允许修复后运行一次 recovery `verify:all`，总次数最多 2。
- 测试失败必须区分产品红灯与 harness 无效。零测试、错误筛选、读取旧 dist 或只比较报告里自填的 seed，均不得算 GREEN。
- 失败证据保留；不得放宽断言、改随机期望值迎合实现、删除 artifact 或把概率性“不相等”当确定性证明。
- 只创建普通本地提交；不得 push、force push、rebase、reset、amend、squash、clean 或进入下一 Wave。
- 质量第一；质量不下降的前提下，省额度第二。不得一修一全量，也不得为文档身份反复制造无意义提交。

---

## 一、阶段位置与为什么现在做

前两项 Foundation Polish 已处理 Editor 基础布局与 Renderer 表现快照。现在继续扩展编辑器或 Agent 能力之前，必须先修复四个会让自动证据失真的公共语义缺口：

1. 模拟和运行接口已经接受或记录 `seed`，但 Interpreter 的 `@random` 仍直接调用 `Math.random()`；同一个 seed 目前不能证明同一运行结果。
2. Runtime 使用 `sceneId.label` 寻址并在第一个点处分割，而 Core 当前允许注册含点号的场景 ID；这会产生误导报错，甚至把请求静默解析到另一个场景及标签。
3. choice 行内动作的 lexer 以 `@` 分段；`选项 -> goto target` 会得到空动作数组，错误内容被静默吞掉。
4. Authoring 验证先把 `snapshot.scenes` 转成 `Map<id, scene>`；重复 ID 后写覆盖前写，导致一个物理文件及其诊断从共享验证结果中消失。

这四项都不是“未来可能发生”的理论风险，而是当前源码可直接构造的确定性反例。完成本 Wave 后，以下不变量必须成立：

```text
SAME_SEED_SAME_RANDOM_SEQUENCE
RANDOM_STATE_SURVIVES_SAVE_LOAD
EFFECTIVE_SEED_IS_VISIBLE_IN_EVIDENCE
UNSEEDED_PLAYER_RUNTIME_REMAINS_SUPPORTED
SCENE_ID_GRAMMAR_HAS_ONE_SHARED_TRUTH
DOTTED_SCENE_ID_FAILS_BEFORE_REGISTRATION
CHOICE_INLINE_ACTION_WITHOUT_AT_FAILS_TO_COMPILE
DUPLICATE_SCENE_IDS_ARE_REPORTED_BEFORE_INDEXING
EVERY_PHYSICAL_SCENE_RETAINS_ITS_OWN_DIAGNOSTICS
```

完成本 Wave 只代表 Evidence Trustworthiness Wave 3 关闭，不自动进入 Agent transaction recovery Wave 4，也不代表 Wave 5 已授权。

---

## 二、当前已确认事实与边界

### 2.1 已确认事实

- `packages/core/src/runtime/interpreter.ts` 的 `@random` 当前直接调用 `Math.random()`。
- `packages/authoring/src/simulation.ts` 已接受并报告 `seed`，但创建 Interpreter 时没有把 seed 接入随机取值。
- `simulationStateSignature()` 当前只含位置、调用栈和变量，不含随机状态。
- `packages/cli/src/authoring/authoring-service.ts` 的 `runTrace()` 接受 `seed`，但 Interpreter 没有使用它；成功结果仅条件性回显输入 seed。
- Agent Port 的 `runtime.run-from` 已有 seed 输入；`project.simulate` 尚无 seed 输入，`runtime.read-trace` 也没有返回实际 seed。
- `SaveSnapshot` 当前没有 RNG 状态，schema 版本为 3。
- `SceneRegistry.resolve()` 使用第一个点把引用拆成 scene 与 label。
- CLI lint 已把点号 scene ID 视为非法，Core lint hint 也说明点号破坏寻址，但 Runtime 注册层没有执行同一合同。
- `packages/authoring/src/operations.ts` 另有私有 scene ID 正则，说明当前存在重复真相。
- choice parser 在 ` -> ` 后把尾部交给 `parseInlineInstructions()`；尾部不含 `@` 时得到空 token，而不是错误。
- `validateSnapshot()` 当前用 `new Map(snapshot.scenes.map(...))` 建索引，重复 ID 会覆盖。
- `ProjectSnapshot.scenes` 本身保留物理文件数组，因此可以在建 Map 之前检测重复并保留两边路径。
- `docs/known-limitations.md` 已明确写着 seeded determinism 尚未成立；只有本 Wave 真实通过后才能更新该限制。

### 2.2 设计判断

- RNG 必须是有状态、可快照的小型 Core 能力；只传一个 seed 而不保存当前 state，读档后下一次 `@random` 会从序列开头重播，仍然不可信。
- 新随机状态应作为 `SaveSnapshot` 的可选字段，而不是升级全局 schema。这样旧档继续合法，普通未注入随机源的 Player 也不会被强制写入新字段。
- 场景 ID 应统一采用当前 Authoring 已有的最小语法：`^[A-Za-z0-9][A-Za-z0-9_-]*$`。这与现有 lint 意图一致，且不会复制第二套引用语法。
- choice 行内动作缺少 `@` 是作者输入错误，正确行为是编译期 fail-loud，不应自动补 `@` 或把文本猜成命令。
- 重复场景 ID 的共享验证必须 first-wins 建立后续引用索引，同时显式报错；last-wins 会让结果依赖文件枚举顺序。

### 2.3 本 Wave 不验证

- Combat 或其他系统是否使用同一 seed。
- 网络多人同步、密码学安全随机、跨语言 RNG 兼容。
- 已发布存档迁移以外的长期存档版本策略。
- Renderer 动画帧、音频、视觉布局或真实玩家手感。
- Agent Port 的并发事务恢复、apply/commit 恢复或外部 Agent 新一轮人工验收。

---

## 三、固定公共合同

### 3.1 Core 随机源

新增一个小型公共模块，例如：

```text
packages/core/src/runtime/random-source.ts
```

最小合同：

```ts
export interface RandomState {
  readonly algorithm: 'mulberry32-v1';
  readonly state: number;
}

export interface RandomSource {
  next(): number;
  snapshot?(): RandomState;
  validateSnapshot?(value: RandomState): void;
  restore?(value: RandomState): void;
}

export function createSeededRandomSource(seed: number): RandomSource;
export function assertValidRandomSeed(seed: unknown): asserts seed is number;
```

允许等价命名，但必须保持以下语义：

- seed 是 `0..4294967295` 的有限整数；负数、小数、`NaN`、`Infinity` 和超范围值 fail-loud。
- 算法身份固定为 `mulberry32-v1`，不能只保存一个没有算法名的裸数字。
- 状态使用显式 uint32 运算，不能调用 `Math.random()` 生成或扰动 seed。
- 固定算法步骤：

```text
state = (state + 0x6D2B79F5) >>> 0
t = state
t = imul(t ^ (t >>> 15), t | 1)
t = t ^ (t + imul(t ^ (t >>> 7), t | 61))
value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
```

- 固定向量必须写入测试，至少：

```text
seed 0:
0.26642920868471265
0.0003297457005828619
0.2232720274478197

seed 1:
0.6270739405881613
0.002735721180215478
0.5274470399599522
```

- 不得在测试里调用被测实现生成 expected 值。

Interpreter 应通过保持构造器兼容的注入方式接收随机源。推荐新增 `setRandomSource(source)`，并限制只能在 `idle` / 未开始时替换；若采用构造参数，必须放在最后且保持所有现有调用方可编译。

未注入 source 时使用一个仅提供 `next()` 的系统随机适配器，内部可调用 `Math.random()`；这条 fallback 只服务普通非证据运行。

`@random name min max` 必须只调用当前 source 的 `next()`，并拒绝非有限或不在 `[0, 1)` 的返回值。

### 3.2 随机快照

`SaveSnapshot` 新增可选字段：

```ts
random?: RandomState;
```

要求：

- stateful source 的 `saveSnapshot()` 写入 random；系统随机 fallback 不写。
- `assertValidSnapshot()` 验证 algorithm 与 uint32 state。
- `loadSnapshot()` 在修改 variables、position、gallery、presentation 或任何系统状态之前验证 random。
- 快照带 random、但当前 source 不支持对应 validate / restore 时，必须在任何状态变化前失败。
- 快照不带 random 时，不重置当前 source；旧存档继续按既有行为恢复。
- RNG state 恢复后，下一次随机值必须等于存档时序列的下一个值，而不是重新从 seed 第一项开始。
- 不升级 `SAVE_SCHEMA_VERSION`，不新增 migration。

### 3.3 Evidence 默认 seed

Authoring 导出一个共享默认值，例如：

```ts
export const DEFAULT_AUTHORING_EVIDENCE_SEED = 0x5eedc0de; // 1592639710
```

以下入口使用 `input.seed ?? DEFAULT_AUTHORING_EVIDENCE_SEED`，并始终输出实际生效的规范化 seed：

- `simulateSnapshot()`；
- `runExplicitPath()`；
- CLI `surdet simulate`；
- Agent Port `project.simulate`；
- Agent Port `runtime.run-from`；
- `runtime.read-trace` 读取持久化轨迹。

要求：

- `simulationStateSignature()` 纳入 `snapshot.random ?? null`，否则相同剧情状态、不同 RNG state 会被错误剪枝。
- `project.simulate` schema 增加可选 seed。
- `runtime.run-from` 的 seed 范围与 Core 完全一致。
- `runtime.run-from` 成功结果、持久化 trace 和 `runtime.read-trace` 都返回实际 seed；不能只回显请求参数。
- CLI `surdet simulate` 增加 `--seed N`；帮助文本、位置参数过滤、参数解析和 JSON report 同步更新。
- CLI 非 JSON 文本报告至少显示 `seed: N`，便于人工复核证据身份。
- capability registry 的 deterministic 描述只有在实现与测试通过后才成立；在同一提交中同步 schema 与说明。

### 3.4 Scene ID 唯一语法

Core 新增共享模块，例如：

```text
packages/core/src/runtime/scene-id.ts
```

最小合同：

```ts
export const SCENE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export function isValidSceneId(value: string): boolean;
export function assertValidSceneId(value: string): void;
```

要求：

- `SceneRegistry.register()` 与 `replace()` 在写入前拒绝非法 ID。
- `my.scene` 不能注册；`sceneId.label` 仍表示场景 `sceneId` 内的 label。
- 场景 `my` 的 label `scene` 必须继续正常解析，证明没有粗暴禁用 label 语法。
- Authoring scene create / patch 等入口复用 Core helper，删除私有重复正则。
- Authoring validation 对快照中非法 ID 产生 `SCENE_ID` error，并带物理文件路径。
- CLI lint 可在不改变输出合同的前提下复用 helper；不强制为共享而重写整个 lint。

### 3.5 Choice 行内 fail-loud

当 choice 文本包含 ` -> ` 时：

- 尾部为空：失败；
- 尾部第一个非空字符不是 `@`：失败；
- 尾部形如 `text @goto x`：失败；
- 尾部形如 `@goto x`：保持成功；
- 没有箭头的普通 choice：保持成功。

新增一个未占用的 DSL 诊断码，建议 `S009`，并同步 `lint-hints.ts`。错误必须包含文件、行、列和“行内动作必须以 `@` 开头”的可执行提示。

不得自动修复输入，不得把 `goto` 猜成 `@goto`。

### 3.6 Duplicate scene validation

`validateSnapshot()` 必须先遍历 `snapshot.scenes`：

1. 验证每个 scene ID；
2. 记录第一个物理文件；
3. 遇到重复 ID 时产生 `LINT_DUP` error，并同时提及 first path 与 duplicate path；
4. 后续跨场景引用分析使用 first-wins Map；
5. 每个物理 scene 自己的 compiler diagnostics 都要单独进入结果，不能只遍历 Map values。

禁止：

- 用 last-wins 保持现状；
- 把子目录写入 scene ID 作为临时命名空间；
- 只依赖 CLI lint，而让 Agent Port `project.validate` 继续漏报；
- 遇到重复后立即 return，导致第二个文件的其它诊断丢失。

---

## 四、文件白名单

执行 AI 只能修改以下文件；确需新增相邻测试文件时，必须保持在同一工作区并在交付报告解释原因。

### Core 生产与测试

```text
packages/core/src/runtime/random-source.ts                  # new
packages/core/src/runtime/scene-id.ts                       # new
packages/core/src/runtime/interpreter.ts
packages/core/src/runtime/scene-registry.ts
packages/core/src/dsl/parser.ts
packages/core/src/save/save-manager.ts
packages/core/src/lint-hints.ts
packages/core/src/index.ts
packages/core/test/random-source.test.ts                    # new
packages/core/test/interpreter-save.test.ts
packages/core/test/interpreter.test.ts
packages/core/test/compiler.test.ts
packages/core/test/scene-registry.test.ts                   # new
```

### Authoring 生产与测试

```text
packages/authoring/src/simulation.ts
packages/authoring/src/validation.ts
packages/authoring/src/operations.ts
packages/authoring/src/capability-registry.ts
packages/authoring/src/index.ts                              # only if new public seed constant/helper export requires it
packages/authoring/test/simulation.test.ts
packages/authoring/test/validation.test.ts
packages/authoring/test/operations.test.ts                  # only if shared scene ID contract needs direct coverage
packages/authoring/test/capability-registry.test.ts
```

### CLI / Agent Port 生产与测试

```text
packages/cli/src/index.ts
packages/cli/src/simulate.ts
packages/cli/src/lint.ts                                    # only to reuse shared scene ID helper without behavior expansion
packages/cli/src/authoring/authoring-service.ts
packages/cli/src/authoring/authoring-dispatcher.ts
packages/cli/test/simulate.test.ts
packages/cli/test/authoring-contract.test.ts
packages/cli/test/agent-port-output-contract.test.ts
packages/cli/test/evidence-seed-contract.test.ts            # optional new focused contract file
```

### 文档

```text
docs/known-limitations.md
docs/superpowers/plans/2026-08-24-pre-wave-5-evidence-trustworthiness-wave-3.md
docs/EVIDENCE-TRUSTWORTHINESS-WAVE-3-DELIVERY-REPORT-2026-08-24.md
```

以下明确禁止：

```text
packages/renderer/**
packages/host/**
packages/shell/**
packages/editor/**
examples/starter/**
games/zero-after-midnight/**
package-lock.json
任何依赖版本、发布配置、性能门限、旧 artifact 或受保护文件
```

---

## 五、Task 0 — 真实基线与证据目录

- [ ] 按顺序完整读取：
  1. `AGENTS.md`；
  2. 长期路线台账；
  3. 本任务书；
  4. Wave 2 任务书与交付报告；
  5. `docs/known-limitations.md`；
  6. 本计划白名单内的生产文件与现有测试。
- [ ] 记录真实：branch、HEAD、`surdet/main`、ahead/behind、tracked worktree、staging area、untracked 清单、tracked `*.log`。
- [ ] 确认基线至少包含已关闭并推送的 Renderer Wave 2；若 `HEAD != surdet/main` 或 tracked 工作树不干净，停止，不覆盖他人修改。
- [ ] 创建仓库外临时证据根，例如：

```powershell
$evidenceRoot = Join-Path $env:LOCALAPPDATA ("Temp\surdet-evidence-trust-wave3-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
```

- [ ] 记录以下源码事实的文件和行号：
  - `@random` 调用 `Math.random()`；
  - simulation / runTrace 接受 seed 但未注入；
  - state signature 缺随机状态；
  - SceneRegistry 在点号处分割；
  - choice inline 缺 `@` 被忽略；
  - validation 的重复 Map 覆盖。
- [ ] 不运行 `verify:all`，不修改文件，不创建提交。

Task 0 停止条件：

```text
BASELINE_MISMATCH
TRACKED_WORKTREE_NOT_CLEAN
WAVE_2_NOT_ON_REMOTE_MAIN
```

---

## 六、Task 1 — 四类永久 RED

先写永久测试，再改生产代码。RED 必须分别命中当前真实缺口，避免一个异常遮蔽其它合同。

### 6.1 RNG RED

- [ ] 新增 Core 固定向量测试：当前不存在 seeded source，应失败。
- [ ] 新增 Interpreter 测试：同 seed 两次运行 `@random` 必须得到相同变量序列；当前应失败或无法接线。
- [ ] 新增 save/load 测试：保存后取一个 next 值，恢复同一快照后再次取值必须相同；当前应失败。
- [ ] 新增 Authoring 测试：同 seed 的模拟报告随机结果一致，且 report.seed 为实际 seed；当前应失败。
- [ ] 新增 CLI / Agent contract 测试：project.simulate、run-from、read-trace 都返回实际 seed；当前应失败。

### 6.2 Scene ID RED

- [ ] 注册 `my.scene` 必须失败；当前应通过注册。
- [ ] 注册 `my` 且含 label `scene` 后，`resolve('my.scene')` 必须正确解析。
- [ ] Authoring validation 对 dotted ID 产生 `SCENE_ID` error。

### 6.3 Choice inline RED

- [ ] `选项 -> goto target` 编译必须抛 `S009`；当前应静默通过。
- [ ] `选项 ->` 与 `选项 -> text @goto target` 同样失败。
- [ ] `选项 -> @goto target` 与无箭头 choice 保持成功。

### 6.4 Duplicate validation RED

- [ ] 构造两个不同路径、相同 scene ID 的 snapshot。
- [ ] 第二个场景额外带一个独有诊断。
- [ ] 断言结果同时含 `LINT_DUP`、first path、duplicate path 和第二个场景的独有诊断；当前应失败。
- [ ] 通过 AuthoringService / dispatcher 的 `project.validate` 再证明 Agent 可见同一错误，不只测内部函数。

### 6.5 RED 运行与 artifact

分别运行聚焦命令并保存 stdout/stderr 与 exit code。建议：

```powershell
npm run test -w @surdet/core -- test/random-source.test.ts test/interpreter-save.test.ts test/compiler.test.ts test/scene-registry.test.ts
npm run test -w @surdet/authoring -- test/simulation.test.ts test/validation.test.ts
npm run test -w @surdet/cli -- test/simulate.test.ts test/evidence-seed-contract.test.ts test/agent-port-output-contract.test.ts
```

- [ ] 每组至少有一个期望红灯；若命令收集到 0 tests，标记 `HARNESS_INVALID` 并修测试入口，不算 RED。
- [ ] RED artifact 从磁盘回读 path、bytes、SHA-256。
- [ ] 不提交只会失败且没有实现的孤立测试；RED 与对应 GREEN 实现进入同一功能提交。

Task 1 完成状态：

```text
RNG_RED_REPRODUCED
SCENE_ID_RED_REPRODUCED
CHOICE_INLINE_RED_REPRODUCED
DUPLICATE_SCENE_RED_REPRODUCED
```

---

## 七、Task 2 — Core fail-loud：Scene ID 与 Choice inline

### 7.1 Shared scene ID

- [ ] 新增共享 scene ID helper 并从 Core public index 导出。
- [ ] `SceneRegistry.register()` / `replace()` 写入前断言合法。
- [ ] 保持 `sceneId.label` 解析规则，不改引用语法。
- [ ] Authoring operations 改用 Core helper，删除私有正则。
- [ ] Authoring validation 对非法 ID 报 `SCENE_ID`，带文件路径。

### 7.2 Choice parser

- [ ] 在 parser 检测到箭头后，先验证尾部存在且以 `@` 开头，再调用 inline lexer。
- [ ] 使用新诊断码 `S009`，同步 lint hint。
- [ ] 不在 lexer 中全局改变所有 inline parsing；修复只落在 choice arrow 语义边界。

### 7.3 聚焦验证

```powershell
npm run test -w @surdet/core -- test/compiler.test.ts test/scene-registry.test.ts
npm run test -w @surdet/authoring -- test/operations.test.ts test/validation.test.ts
npm run typecheck -w @surdet/core
npm run build -w @surdet/core
npm run typecheck -w @surdet/authoring
```

- [ ] 原 RED 全绿。
- [ ] 现有合法 label、choice inline 和 scene create 测试保持绿。
- [ ] 精确暂存本 Task 源码与测试，创建普通提交：

```text
fix(core): fail loud on ambiguous scene syntax
```

Task 2 禁止顺手改其它 DSL 诊断、命名规则或 lint 文案。

---

## 八、Task 3 — Core seeded RNG 与快照恢复

### 8.1 Random source

- [ ] 实现 `mulberry32-v1` 与固定向量。
- [ ] Interpreter 注入随机源；普通 fallback 保留。
- [ ] `@random` 只从 source 取值并验证范围。
- [ ] 替换 source 的时机有明确守卫，不能运行中静默重置序列。

### 8.2 Snapshot

- [ ] `SaveSnapshot.random?` 使用公共 `RandomState` 类型。
- [ ] current / legacy 校验都接受缺失字段；存在时严格验证。
- [ ] 所有校验先于状态修改。
- [ ] source 不支持恢复但 snapshot 带 random 时原子失败。
- [ ] old snapshot without random 仍可加载。
- [ ] save → draw → load → draw 精确复现同一个 next value。

### 8.3 聚焦验证

```powershell
npm run test -w @surdet/core -- test/random-source.test.ts test/interpreter.test.ts test/interpreter-save.test.ts test/save.test.ts test/migrate.test.ts
npm run typecheck -w @surdet/core
npm run build -w @surdet/core
```

- [ ] 固定向量精确相等。
- [ ] 不使用 `toBeCloseTo` 掩盖算法漂移；对于固定 JS 运算结果使用精确值。
- [ ] 无 seed 的既有 Interpreter 测试不需要全部改造。
- [ ] 精确暂存本 Task 源码与测试，创建普通提交：

```text
fix(core): make random state reproducible
```

---

## 九、Task 4 — Shared evidence、CLI / Agent 与重复场景验证

### 9.1 Authoring simulation

- [ ] `simulateSnapshot()` 与 `runExplicitPath()` 使用同一 Core seeded source。
- [ ] 两者总是报告实际 seed，包括未显式传入时的默认 seed。
- [ ] `simulationStateSignature()` 纳入 random state。
- [ ] DFS save/load 后 RNG 序列连续，不因分支回溯串线。
- [ ] 相同 seed 的路径结果、随机变量、终止状态与报告一致。
- [ ] 不同固定 seed 使用可证明会分歧的测试场景；断言精确结果，不只断言“多数时候不同”。

### 9.2 Shared validation

- [ ] 在 Map 建立前完成非法 / 重复 scene ID 检查。
- [ ] 重复错误同时保留两个物理路径。
- [ ] 每个物理场景 diagnostics 都进入结果。
- [ ] 跨引用 Map 使用 deterministic first-wins。

### 9.3 CLI simulate

- [ ] `SimulateOptions` 增加 seed。
- [ ] `SimulateReport` seed 为必需字段。
- [ ] `cmdSimulate` 解析 `--seed N`，拒绝缺值、非整数与超范围。
- [ ] `index.ts` 的 flag value 识别与 HELP 同步，避免 seed 值被误当项目目录。
- [ ] JSON 与文本报告都显示实际 seed。

### 9.4 Agent Port

- [ ] `project.simulate` input schema 接受 seed。
- [ ] dispatcher 把 seed 与 sceneId 一起传入 service。
- [ ] project / change 两种 simulate 都使用实际 seed。
- [ ] `runTrace()` 注入同一 Core random source。
- [ ] run-from response、trace persistence、read-trace response 都保留实际 seed。
- [ ] output schema 与真实 dispatcher 返回一致。
- [ ] capability registry 只保存 contract metadata；不得塞 prompt、示例库或修复策略树。

### 9.5 聚焦验证

```powershell
npm run build -w @surdet/core
npm run test -w @surdet/authoring -- test/simulation.test.ts test/validation.test.ts test/capability-registry.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- test/simulate.test.ts test/authoring-contract.test.ts test/agent-port-output-contract.test.ts test/evidence-seed-contract.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [ ] 若没有新增 `evidence-seed-contract.test.ts`，从命令删除该文件并在报告说明 seed 合同落在哪个现有文件；禁止保留 0-test 命令。
- [ ] 运行真实 CLI JSON 路径两次，同一项目、同一 seed 的规范化业务结果一致。
- [ ] 再使用第二个固定 seed，精确证明 `@random` 结果按已知序列改变。
- [ ] Agent Port dispatcher 测试直接调用真实 capability schema 与 service，不伪造最终 envelope。
- [ ] 精确暂存本 Task 源码与测试，创建普通提交：

```text
fix(authoring): make evidence seed and scene validation trustworthy
```

---

## 十、Task 5 — 相邻回归与聚合门禁

### 10.1 全工作区相关验证

依次运行：

```powershell
npm run test -w @surdet/core
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run typecheck -w @surdet/core
npm run build -w @surdet/core
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
npm run simulate -w surdet-starter -- --seed 1592639710
```

- [ ] Starter 只读运行；`git diff --quiet -- examples/starter` 必须 exit 0。
- [ ] Starter 报告必须显示 seed，路径计数、剪枝、存档往返和 runtime errors 保持可信。
- [ ] 运行 `node packages/cli/dist/index.js simulate examples/starter --seed 1592639710 --json` 两次，将时间戳等非业务字段排除后比较；如果报告没有时间字段则直接逐字节比较。
- [ ] 不用“两个不同 seed 偶然得出相同结局”判失败；应使用 Task 4 的固定随机 fixture 精确验证随机值。

### 10.2 唯一主聚合

聚焦与相邻验证全绿后，运行：

```powershell
npm run verify:all
```

规则：

- 第一次通过：不得重跑。
- 第一次失败且首个失败节点与本 Wave 无关：保留 artifact，解释边界，停止复审；不得顺手修历史问题。
- 第一次失败且明确由本 Wave 的文件或合同造成：允许做一个最小修复，先跑受影响聚焦测试，再运行一次 recovery `verify:all`。
- recovery 通过：记录两次身份与修复原因。
- recovery 仍失败：停止；总次数不得超过 2。

### 10.3 静态范围核对

```powershell
git diff --check
git diff --cached --check
git diff --quiet -- examples/starter
git ls-files '*.log'
git status --short
```

- [ ] 不存在白名单外生产修改。
- [ ] 不存在测试日志、fixture、artifact 或构建产物进入 tracked diff。
- [ ] `docs/known-limitations.md` 只在所有 seeded contracts 通过后更新；措辞限定为 DSL / evidence 路径，不夸大成全引擎确定性。

---

## 十一、Task 6 — 文档、身份回读、提交与停止

### 11.1 创建交付报告

创建：

```text
docs/EVIDENCE-TRUSTWORTHINESS-WAVE-3-DELIVERY-REPORT-2026-08-24.md
```

报告必须分为：

```text
VERIFIED_FACTS
REASONABLE_INFERENCES
UNVERIFIED_BOUNDARIES
OUT_OF_SCOPE_FINDINGS
```

必须记录：

- 初始 HEAD、远端、ahead/behind、工作树；
- 四类 RED 的命令、exit、首个失败节点；
- 三个功能提交的 HEAD 与精确文件范围；
- 固定 RNG 算法身份、固定向量和默认 evidence seed；
- save/load 后 next random 的精确证据；
- same-seed 与 different-seed 的确定性证据；
- scene ID、choice inline 与 duplicate ID 的 fail-loud 证据；
- Core / Authoring / CLI 全量测试计数；
- `verify:all` 运行次数与结果；
- Starter 未修改；
- 所有 artifact 的磁盘 path、bytes、SHA-256；
- 没有 Electron、人工视觉验收、push、部署、发行或进入下一 Wave。

### 11.2 Execution Ledger

在本任务书末尾追加真实 Execution Ledger。不要预填未来 HEAD，不要把聊天报告当磁盘事实。

每笔至少含：

```text
timestamp
HEAD
surdet/main
ahead/behind
tracked worktree
staging area
modified files
commands actually run
artifact identities
current stop state
```

### 11.3 提交治理

- [ ] 代码提交已按 Task 2 / 3 / 4 分开创建；不得 squash 或 amend。
- [ ] 最后只暂存：任务书、交付报告、`docs/known-limitations.md`（若实际更新）。
- [ ] 创建一个普通 docs-only 提交：

```text
docs(engine): report evidence trustworthiness wave 3
```

- [ ] `git show --name-status HEAD` 核对 docs-only 范围。
- [ ] 重新读取最终 HEAD、parent、remote、ahead/behind、tracked worktree、staging area。
- [ ] 从磁盘重新读取任务书、交付报告和 artifact 的 bytes / SHA-256。
- [ ] 扫描两份文档中的 `PENDING`、`will be appended`、旧 HEAD、旧远端关系和 placeholder；历史快照必须显式标成历史。
- [ ] 如果最终身份修正会改变任务书自身哈希，不要制造无穷自指字段。任务书只记录交付报告的最终身份；任务书自身最终身份由聊天交接从磁盘回读报告，不要求写回任务书正文。
- [ ] 停止，不 push。

最终允许的状态：

```text
PRE_WAVE_5_EVIDENCE_TRUSTWORTHINESS_WAVE_3_VERIFIED
DSL_RANDOM_SEEDED_EVIDENCE_VERIFIED
SCENE_ID_ADDRESSING_FAIL_LOUD
CHOICE_INLINE_ACTION_FAIL_LOUD
DUPLICATE_SCENE_VALIDATION_FAIL_LOUD
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
AGENT_TRANSACTION_RECOVERY_WAVE_4_NOT_STARTED
WAVE_5_NOT_STARTED
```

若任一核心合同未通过，必须改为：

```text
PRE_WAVE_5_EVIDENCE_TRUSTWORTHINESS_WAVE_3_INCOMPLETE
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_5_NOT_STARTED
```

---

## 十二、独立复审清单

独立审核 AI 只读核验，不修复、不提交、不 push：

- [ ] HEAD / parent / remote / ahead-behind 真实一致。
- [ ] 三个代码提交与一个 docs closure 提交范围匹配。
- [ ] `@random` 不再直接调用 `Math.random()`；系统 fallback 与 DSL 调用边界清楚。
- [ ] RNG 固定向量不是被测实现自生成。
- [ ] SaveSnapshot.random 可选，旧档仍通过；有 random 时错误恢复原子失败。
- [ ] simulation state signature 含 RNG state。
- [ ] simulate / run-from / read-trace 输出实际生效 seed。
- [ ] SceneRegistry 拒绝 dotted ID，同时 label 寻址仍正常。
- [ ] choice 缺 `@` 在编译期失败。
- [ ] duplicate scene error 含两个路径，第二文件自己的诊断未消失。
- [ ] CLI / Agent 没有复制第二套 RNG、parser 或 validation。
- [ ] `verify:all` 次数符合预算，失败 artifact 未删除。
- [ ] Starter、Renderer、Host、Shell、Editor、Zero 未修改。
- [ ] 文档没有旧身份冒充最终身份。
- [ ] 未 push、未进入下一 Wave。

复审输出只需要：

```text
INDEPENDENT_FINAL_REVIEW = PASS | NEEDS_FIX
BLOCKER = ...
HIGH = ...
MEDIUM = ...
LOW = ...
NEW_OUT_OF_SCOPE_FINDING = ...
PUSH_AUTHORIZED = NO
NEXT_GATE = OWNER_PUSH_DECISION
```

---

## Execution Ledger

> 执行 AI 从 Task 0 开始按真实时间追加。任务书创建时不预填施工结果。

### 2026-08-24T14:31:00+08:00 — Task 0 baseline

```text
branch = main
HEAD = e636ac72b20ec8483c3131c4d18a14f43b81794e
HEAD_PARENT = f8a4c08aed404c06c1706b224466fda67b0abb9a
surdet/main = e636ac72b20ec8483c3131c4d18a14f43b81794e
AHEAD_BEHIND = 0/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
TRACKED_LOG_FILES = 0
WAVE_2_REMOTE_BASELINE = CONFIRMED
```

仓库中已有的未跟踪治理、交接、路线和历史 artifact 文件保持原状，包含 `.dsh/`、`.learnings/`、`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份受保护美术资料、历史 handoff、长期路线台账、`packages/cli/e2e/artifacts/` 与本任务书；本轮没有清理、暂存或提交它们。证据根为：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9
```

### 2026-08-24T14:36:56+08:00 — Task 1 permanent RED

三条聚焦命令覆盖任务书的四类 RED 合同：Core 命令同时覆盖 RNG、Scene ID、Choice inline 三个独立症状；Authoring 命令覆盖 duplicate validation；CLI 命令覆盖 evidence seed contract。三组命令均收集到真实失败测试，非零测试数，未发生 `HARNESS_INVALID`。

```text
RNG_RED_REPRODUCED = YES
SCENE_ID_RED_REPRODUCED = YES
CHOICE_INLINE_RED_REPRODUCED = YES
DUPLICATE_SCENE_RED_REPRODUCED = YES
```

```text
CORE_RED
command = npm run test -w @surdet/core -- test/random-source.test.ts test/interpreter-save.test.ts test/compiler.test.ts test/scene-registry.test.ts
exit = 1
artifact = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task1-core-red.log
bytes = 7921
sha256 = 63BC28F980553635C2C5994C7665653C444F4B0AFBB1941D23CA90B67C245ABF
evidence = seeded source unavailable; dotted scene registration accepted; S009 was not raised for invalid choice arrows

AUTHORING_RED
command = npm run test -w @surdet/authoring -- test/simulation.test.ts test/validation.test.ts
exit = 1
artifact = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task1-authoring-red.log
bytes = 5204
sha256 = 48D04DFE5D73690DC9727D8266472AAE81FC22B5D3E30F3566BC7D2ABDF5B759
evidence = seeded simulation result and duplicate-scene diagnostics were not trustworthy

CLI_RED
command = npm run test -w @surdet/cli -- test/simulate.test.ts test/evidence-seed-contract.test.ts test/agent-port-output-contract.test.ts
exit = 1
artifact = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task1-cli-red.log
bytes = 2068
sha256 = 16867E16AB08AB5F8968022A9FEC9733DEF29E5175D680C5104558BD3AC7F7B6
evidence = evidence seed contract failed before implementation
```

### 2026-08-24T15:04:00+08:00 — Task 2–4 implementation evidence

代码按功能边界创建了三笔任务书要求的普通提交，另有一笔必要的 public export correction；没有 amend、rebase、squash 或 push。

```text
TASK2_COMMIT = 0aec8801ea8bcb9cf16378dc12c4ac9eeef2cc90
TASK2_MESSAGE = fix(core): fail loud on ambiguous scene syntax
TASK2_SCOPE = Core scene-id/registry/parser/lint-hints/index + Authoring operations/validation + corresponding tests

TASK3_COMMIT = 52be22a580dd2aa232a1795cb5ae8defbed785d7
TASK3_MESSAGE = fix(core): make random state reproducible
TASK3_SCOPE = Core random-source/interpreter/save-manager + corresponding tests

TASK3_EXPORT_CORRECTION_COMMIT = d14f52adec8132324df163909ad3eee69c1c6d44
TASK3_EXPORT_CORRECTION_MESSAGE = fix(core): export seeded random source
TASK3_EXPORT_CORRECTION_SCOPE = packages/core/src/index.ts only

TASK4_COMMIT = f4f8f2417d5f121864f3f66848432a0e502ce8dc
TASK4_MESSAGE = fix(authoring): make evidence seed and scene validation trustworthy
TASK4_SCOPE = Authoring simulation/capability registry + CLI dispatcher/service/index/simulate + corresponding tests
CODE_EVIDENCE_HEAD = f4f8f2417d5f121864f3f66848432a0e502ce8dc
```

已验证的固定证据：

```text
SEEDED_RANDOM_ALGORITHM = mulberry32-v1
seed=0 = [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]
seed=1 = [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]
seed=7 save/load next raw value = 0.06195825757458806
seed=0 @random integer result = [26, 0]
seed=1 @random integer result = [63, 0]
DEFAULT_AUTHORING_EVIDENCE_SEED = 1592639710
```

Scene/choice/duplicate 合同的绿色证据为：非法 `my.scene` 在写入 SceneRegistry 前抛错且 registry 保持为空；合法 `my` 的 `scene` label 仍可通过 `my.scene` 解析；`A ->`、`A -> goto target` 与 `A -> text @goto target` 均抛 `S009`，而合法 `@goto` 与无箭头 choice 仍通过；duplicate validation 同时保留 `LINT_DUP`、first/duplicate 两个物理路径，并保留第二个文件自己的 `J002` 诊断。

### 2026-08-24T15:18:39+08:00 — Task 5 gates

以下命令均实际 exit 0：

```text
npm run test -w @surdet/core                         = 26 files / 327 tests
npm run test -w @surdet/authoring                   = 22 files / 138 tests
npm run test -w @surdet/cli                        = 22 files / 178 tests
npm run typecheck -w @surdet/core
npm run build -w @surdet/core
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
npm run simulate -w surdet-starter -- --seed 1592639710
```

Starter 模拟报告显示 13 paths、2/3 choices、25 save/load、runtime errors = 0。最新 dist 的 CLI JSON 路径以同一 seed 连续运行两次，两个 328-byte 结果逐字节一致；`git diff --quiet -- examples/starter` exit 0，初始与当前提交的 Git tree object 均为 `3333db468f50c848b8c5b7bd6869ae91c2e376a7`，因此 Starter 未被本轮修改。

```text
VERIFY_ALL_RUNS = 1
VERIFY_ALL_EXIT = 0
VERIFY_ALL_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task5-verify-all.log
VERIFY_ALL_BYTES = 58476
VERIFY_ALL_SHA256 = B1CA024C929CEB93BE9230C9858D506C8417E5D5E32DA13C718C6606441B5409
```

唯一 `verify:all` 日志实际记录了 tools、probe、renderer boundaries/legacy、docs、hygiene、types、tests、starter lint/simulate、formal、editor-build、starter-build、formal-build 与 diff-check 节点；没有第二次 recovery 运行。

### 2026-08-24T15:23:10+08:00 — Task 6 documentation preparation

Task 5 的核心门禁已通过，开始 Task 6。当前文档写入前真实身份为：

```text
HEAD = f4f8f2417d5f121864f3f66848432a0e502ce8dc
HEAD_PARENT = d14f52adec8132324df163909ad3eee69c1c6d44
surdet/main = e636ac72b20ec8483c3131c4d18a14f43b81794e
AHEAD_BEHIND = 4/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
```

已更新 `docs/known-limitations.md`，仅把 DSL/evidence 路径的已验证事实写入限制项，并保留无 seed 普通解释器与未覆盖随机路径不等于全链路确定性的边界。交付报告与本任务书将在同一 docs-only 提交中落盘；该提交的最终 HEAD 不在本条记录写入，避免预填未来身份。
