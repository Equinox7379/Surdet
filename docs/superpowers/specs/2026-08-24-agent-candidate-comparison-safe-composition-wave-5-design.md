# Stage 6 Wave 5 Agent 候选比较与安全合成设计规格

> 日期：2026-08-24
>
> 状态：核心方向与安全边界已获项目所有者批准，等待书面规格复核
>
> 阶段：Stage 6 / Wave 5
>
> 主题：外部 Agent 多候选方案的比较、裁决与安全合成
>
> 当前授权：完成设计规格；尚未授权生产实现、push、部署、发行或 Wave 6

## 一、执行摘要

Wave 5 要让 Surdet 从“一个外部 Agent 能安全地产生一份隔离变更”，提升为“多个外部 Agent 可以分别提出候选方案，系统能够比较它们、识别冲突、让人或 Review Agent 做出明确选择，再生成一份可验证、可追溯、可提交的新集成变更”。

本轮采用项目所有者批准的 **B2：多候选比较与安全合成**，并固定四条产品原则：

1. **候选不可变，合成永远产生新的集成变更。** 不依次 apply 候选，不修改来源 change，不直接拼接文件；
2. **最小选择单位是依赖闭合的对象变更单元。** 不允许选出引用缺失的半个场景、半条时间轴或孤立配置；
3. **自动合成边界保守且可证明。** 首版只自动合成依赖闭包互不相交的内容，或规范结果完全相同的重复内容；任何其他对象重叠都必须明确裁决；
4. **旧胶囊保留审计价值，但不猜测性升级。** 历史 v1 胶囊仍可查看；只有包含规范化可重放清单的新 v2 胶囊可以进入自动合成。

最终工作流是：

```text
Agent A / B / C 分别创建 stage change
  → 各自校验、模拟、运行取证并封存候选胶囊
  → Review Agent 或人类创建候选比较
  → 查看对象差异、依赖、因果影响和证据
  → 选择依赖闭合单元并裁决冲突
  → 生成不可变集成计划并执行 dry-run
  → 创建一个新的 OPEN 集成变更
  → 通过同一 authoring 合同确定性重放
  → 重新 diff / validate / simulate / runtime
  → 生成带完整来源的集成交付胶囊
  → 项目所有者批准后，才可沿用既有 commit 合同
```

Wave 5 不在引擎内嵌模型，也不把 prompt、模型选择或“智能最佳方案”写入业务层。MCP 仍是共享 authoring 合同之上的薄适配。当前优先建立对外部 Agent 友好的可靠底座；面向零基础用户的中文比较工作台属于后续产品层，但本轮数据合同必须保证未来界面不需要暴露原始英文代码和内部 JSON。

## 二、为什么现在做

### 2.1 已具备的基础

截至基线 `31b937638929fa8d09e575b120fd4b4681d9f7d2`，Surdet 已具备：

- 机器可读 capability registry 与 MCP 工具投影；
- 外部桌面 Agent 的 observe / stage / apply 权限边界；
- 隔离 change、幂等 operationId、workingRevision 和对象指纹；
- 场景、变量、角色、入口和既有资源时间轴的类型化 authoring；
- 对象级 diff、`potentialImpact`、`observedImpact` 和因果引用；
- 校验、确定性模拟、runtime trace 与 evidence freshness；
- 不可变 delivery capsule artifact；
- Change Store V2、跨进程 lease、记录 CAS、项目串行 commit 与显式恢复；
- Windows 非撕裂 replacement 和失败证据保留；
- 一个不知道 Surdet 源码的真实外部 Agent 能在 stage 环境完成发现、创作、自修复、验证和胶囊交付。

这些能力已经解决“Agent 能不能做”和“单份变更是否可信”。Wave 5 应继续向前解决“多个方案如何共同工作”，而不是重新设计另一套编辑器、状态机或 Agent 平台。

### 2.2 当前源码中的确定缺口

当前 delivery capsule 的 `operations` 只包含：

```text
operationId
requestHash
result
```

invocation ledger 只保留输入哈希，不保留可供确定性重放的规范输入。对象 diff 能说明“结果发生了什么”，但不能无损还原“应当通过哪项类型化 capability 以什么前置条件重放”。因此：

- 当前胶囊足以审核，但不足以自动合成；
- 从 unified diff、workingFiles 或结果对象反推操作会引入猜测；
- 依赖活动 change store 才能合成，会使胶囊失去独立、可移动和可审计属性；
- 直接文件三方合并会丢失场景、时间轴、变量和因果对象的类型语义。

Wave 5 必须补充规范化可重放清单，同时保持现有 authoring 业务逻辑是唯一真相。

### 2.3 用户价值

真实创作中，不同 Agent 可能擅长不同工作：剧情、演出、配置、验证或审稿。项目所有者不应被迫在聊天记录中人工复制代码，也不应只能选择“整份接受或整份丢弃”。Wave 5 应让他以后能够看到：

```text
方案 A 新增了什么
方案 B 与它哪里不同
哪些内容可以安全组合
哪些内容必须选择
采用后会影响哪些剧情和演出
这些结论由哪些新鲜证据支持
最终集成结果来自哪些候选
```

当前机器接口可以保持专业和精确；未来 Editor 应把同一事实投影成中文、渐进展开、适合零基础用户的界面，而不是把内部错误码和英文 schema 直接堆到屏幕上。

## 三、方案选择与被否决路径

### 3.1 采用方案：新建集成变更

所有来源候选保持不可变。比较和计划阶段不修改项目；执行阶段创建一个新的 integration change，并通过共享 authoring capability 重放被选中的规范操作。来源胶囊只提供输入与证据，不被就地修改或提交。

优点：

- 来源完整，可随时回到任一候选；
- 集成失败只影响新的 stage change，不污染来源和真实项目；
- 现有 diff、validate、simulate、trace、capsule、commit 和 recovery 全部可复用；
- 冲突与裁决可以形成机器可读审计链；
- 未来 Editor 和 Agent 使用同一集成计划事实。

代价：需要新增可重放清单、比较引擎、计划 artifact 和集成执行进度，但这些正是 B2 的最小必要能力。

### 3.2 否决：依次提交候选

第一个候选会改变项目基线，后续候选的证据和前置指纹随即过期；顺序会影响结果，回退与来源追踪困难。该路径只适合人工一次性施工，不是多候选产品合同。

### 3.3 否决：直接合并文件或 diff

文本合并不知道 `scene`、`timeline`、`variable`、`entryScene`、track/cue 或资源引用的语义，也不能可靠保留 operationId、对象指纹和修复建议。首版禁止 raw patch、unified diff 或 workingFiles 直接成为合成输入。

## 四、目标、非目标与完成定义

### 4.1 产品目标

1. 同一项目、同一基线上的两个或以上 v2 候选胶囊可被统一比较。
2. 系统能按规范对象、依赖闭包、因果影响和证据状态生成稳定比较结果。
3. 系统只自动接受确定不相交或规范结果完全一致的组合。
4. 任何歧义重叠都产生稳定 conflictId，并要求明确裁决。
5. 选中一个对象变更单元时，所有强制依赖自动进入计划；缺失依赖时 fail-loud。
6. 集成计划是不可变、有身份、可重读、可 dry-run 的 artifact。
7. 执行计划只创建一个新的 OPEN integration change，不修改来源候选或真实项目。
8. 执行中断后可以通过同一 operationId 和计划身份安全恢复；不能确定时停止。
9. 集成变更重新使用既有 diff、validation、simulation、runtime 和 delivery capsule。
10. 集成交付胶囊能追溯每项结果的来源候选、来源操作、去重和人工裁决。
11. 一个只按公开 schema 和 repairActions 工作的确定性客户端可以完成主路径；一个不了解源码的真实外部 Agent 也可以完成同一路径。

### 4.2 架构目标

- `@surdet/authoring` 定义 composition manifest、选择单元、依赖闭包、冲突、计划和执行进度的协议无关语义；
- `@surdet/cli` 只实现 capsule/plan artifact 存储、项目快照、现有 dispatcher 重放和 Node 适配；
- capability registry 只保存合同 metadata/schema，不保存业务流程、prompt、示例库或冲突算法；
- MCP 机械投影新增 capability，不实现第二套比较或合成；
- Editor 不成为本轮业务真相，也不承载未完成的后端逻辑；
- 所有哈希来自规范 JSON，所有前置条件在执行前重新验证。

### 4.3 明确非目标

本轮不做：

- Editor 的最终候选比较工作台、拖拽合并或零基础引导流程；
- 引擎内嵌模型、模型路由、prompt 管理、Agent 排名或自动判断“哪个创意更好”；
- Agent 任务调度、队列、预算管理、团队权限或云端协作；
- CRDT、OT、通用 Git merge、任意文本 patch 或三方文件合并；
- 对同一对象的字段级自动合并、时间轴 cue 自动排序或剧情文本自动融合；
- 历史 v1 胶囊 migration、diff 反推或旧 change 数据重写；
- 跨项目、跨 data root、网络共享盘或多机候选导入；
- 新资产导入、资产复制、扩展市场、音频、美术、性能资格化或发行；
- Core、Renderer、Host、Shell、Editor 产品代码、Starter/Zero 内容或存档格式修改；
- 自动 commit、自动 apply、自动 push、部署或发行。

### 4.4 完成定义

只有同时满足以下事实，Wave 5 才能请求关闭：

1. 历史 v1 胶囊保留且能被明确识别为 audit-only；系统不从 diff 猜测操作；
2. 新 change 的成功类型化 mutation 持久化规范输入，v2 capsule 生成可验证 composition manifest；
3. manifest 的排序、规范 JSON 和 fingerprint 在相同输入上确定一致；
4. 两个不相交候选自动组成依赖闭合计划；相同结果去重并保留双方 provenance；
5. 同一规范对象的不同结果、基线不一致、依赖缺失和 artifact 身份错误均 fail-loud；
6. unresolved conflict 不能生成 executable plan；调用方不能注入任意 replay payload；
7. dry-run 使用同一 authoring 语义，且不写来源 change 或真实项目；
8. execute 创建一个新的 integration change，按确定顺序重放并记录进度；
9. 进程中断后同一计划可幂等恢复，确定性失败会阻断 commit 并保留证据；
10. 来源 capsule、change 和项目在 stage 执行后字节与身份不变；
11. 集成变更的 fresh diff/validation/simulation/runtime 和 v2 capsule 能证明最终结果与来源；
12. observe/stage/apply policy、原生 dispatcher、CLI/MCP schema、文本与 structured envelope 一致；
13. 聚焦测试、Authoring/CLI 全套、typecheck/build、唯一 FORMAL 和一次 `verify:all` 按任务书通过；
14. 确定性公开客户端与真实外部 Agent 验收通过；
15. 项目所有者只在独立复审后决定 push；不自动进入 Wave 6。

## 五、总体架构

```text
候选 change A ── v2 capsule A ─┐
候选 change B ── v2 capsule B ─┼─ composition.compare
候选 change C ── v2 capsule C ─┘         │
                                          ▼
                                  ComparisonResult
                                  - selectionUnits
                                  - dependencyGraph
                                  - conflicts
                                  - evidenceMatrix
                                          │
                              显式选择与冲突裁决
                                          ▼
                                   composition.plan
                                  - closure expansion
                                  - canonical replay
                                  - dry-run validation
                                  - immutable plan artifact
                                          │
                                          ▼
                                  composition.execute
                                  - new integration change
                                  - deterministic replay
                                  - progress / resume
                                          │
                                          ▼
                   existing diff → validate → simulate → runtime → capsule
                                          │
                             owner-authorized existing commit
```

### 5.1 唯一业务真相

- authoring mutation 的真实语义仍由现有 `scene.create/patch`、`variable.ensure`、`character.*`、`timeline.*` 和 `project.entry-scene.set` 实现；
- composition engine 只决定“选择哪些已封存规范操作、以何种确定顺序重放”，不复制解析器或文件写入逻辑；
- Node 层不判断对象能否合并；它只解析 artifact、取得 lease、载入快照并调用共享合同；
- MCP 工具名、schema 和错误来自 capability registry；adapter 不手写第二套状态机。

### 5.2 组件职责

1. **Operation capture：** 把成功 mutation 的规范输入持久化进 ChangeRecord；
2. **Capsule v2 sealer：** 生成自包含、可验证、可组合或明确不可组合的胶囊；
3. **Comparison engine：** 纯函数式验证候选、构建对象单元、依赖图和冲突；
4. **Plan builder：** 应用选择与裁决、展开闭包、排序、dry-run 并生成计划身份；
5. **Plan store：** 在项目对应 data root 保存不可变 plan payload/identity；
6. **Integration executor：** 创建并恢复新的集成 change，重放同一 authoring operation；
7. **Capability projection：** 原生 service、CLI 与 MCP 的薄投影；
8. **Evidence chain：** 复用现有证据和胶囊，将 provenance 加入最终交付。

每个组件必须可以在不了解相邻内部实现时独立测试。不得把上述职责堆进 capability registry 或 `server.ts`。

## 六、规范操作捕获与 Capsule v2

### 6.1 ChangeRecord 的最小演进

当前 operation 记录保留幂等身份，但缺少重放输入。新成功 mutation 追加规范输入：

```ts
interface RecordedOperation {
  requestHash: string;
  normalizedInput?: JsonValue;
  result: unknown;
}
```

规则：

- `normalizedInput` 是经过对应 capability 严格 schema 接受、键顺序规范化后的 JSON 值；
- 它包含 operationId 和领域参数，不包含 sessionId、项目绝对路径、MCP envelope、prompt、模型信息或调用方私有上下文；
- 老记录没有该字段时仍可读取，但不能被声明为 composable；
- 幂等 requestHash 继续由同一规范输入计算；不得维护第二份输入规范化算法；
- 失败 mutation 不进入成功 operation ledger，也不能出现在 replay manifest 中。

该字段是 Change Store V2 的向前可选字段，不迁移或重写旧 record。

### 6.2 可组合 capability 白名单

首版只允许现有类型化内容 mutation 进入 manifest：

```text
scene.create
scene.patch
variable.ensure
character.ensure
character.remove
timeline.create
timeline.patch
project.entry-scene.set
```

以下调用不属于可重放内容：

```text
change.begin / commit / rollback / recovery
project.inspect / assets / validate / simulate
object.inspect
runtime.run-from / read-trace
change.diff
composition.*
delivery capsule 自身
```

白名单是共享 authoring 合同的一部分。registry 可以保存 `composable: true|false` 这一项合同 metadata，但不得保存重放函数、冲突策略或流程说明。

### 6.3 CompositionManifest

```ts
interface CompositionManifest {
  manifestVersion: '1.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  sourceChangeId: string;
  sourceWorkingRevision: number;
  operations: CompositionOperation[];
  manifestFingerprint: string;
}

interface CompositionOperation {
  sequence: number;
  capabilityId: ComposableCapabilityId;
  sourceOperationId: string;
  normalizedInput: JsonValue;
  inputSha256: string;
  primaryObject: string;
  objectFingerprintBefore?: string;
  objectFingerprintAfter?: string;
  requiredObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
}
```

`primaryObject` 使用现有规范对象身份，例如 `scene:ch01_01`、`timeline:opening`、`variable:trust` 或 `config:entryScene`。track/cue 没有持久语义 ID，因此首版归入所属 timeline 对象，不允许把单个 cue 当成跨候选独立合成对象。

`requiredObjects` 和 `producedObjects` 由成功 operation 的输入、对象 diff 和当前对象索引共同产生；它们必须携带“来自基线”或“由同候选 operation 产生”的明确来源，不能只保存字符串猜测。

### 6.4 Capsule v2

新生成的胶囊版本为 `2.0.0`，保留现有审计字段，并增加：

```ts
composition: {
  eligibility: 'ready' | 'unavailable';
  reasons: CompositionIneligibility[];
  manifest?: CompositionManifest;
}
```

- 全部内容 mutation 都有规范输入、对象身份和依赖时，`eligibility=ready`；
- 旧 change、未知 capability、缺失规范输入或无法建立依赖时，胶囊仍可用于审计，但必须标记 `unavailable`；
- 不从 file diff、workingFiles 或 operation result 反推缺失输入；
- `artifactIdentity.sha256` 覆盖完整 payload；manifest 另有独立 fingerprint；
- 历史 v1 artifact 原样保留，不删除、不覆盖、不迁移；compare 遇到 v1 时返回明确 audit-only 结果和修复动作“重新创建候选”，不提供假兼容转换。

本轮将 authoring 对外合同与 delivery capsule 一并提升为 `2.0.0`。MCP protocol version、envelope schema version 和 Change Store formatVersion 不随之改变。显式请求旧 authoring contract 的新客户端应 fail-loud，不做隐式降级。

## 七、候选引用、比较与选择单元

### 7.1 安全候选引用

调用方不得传任意文件路径。候选只通过项目 data root 内的稳定引用定位：

```ts
interface CandidateCapsuleRef {
  changeId: string;
  capsuleId: string;
  artifactSha256: string;
}
```

服务端按当前 session 的 projectIdentity 和 data root 解析；任何越界路径、change 归属不一致、identity 缺失或 SHA 不匹配都在读取阶段阻断。

### 7.2 比较资格与合成资格

二者严格区分：

- **可比较：** artifact 完整、能识别版本和项目身份；即使证据不足或基线过期，也可以产生 review-only 比较；
- **可合成：** 必须是 capsule v2、`composition.eligibility=ready`、同一 projectIdentity、同一 baseProjectRevision、artifact/manifest 身份匹配且无结构阻断；
- source change 后续被 rollback、commit 或继续编辑，不改变已封存 capsule 的内容；合成只信任胶囊身份，不重新借用活动 source change；
- 当前项目 revision 与候选基线不一致时仍可只读查看，但 executable plan 必须阻断。

### 7.3 对象变更单元

首版的直接选择对象不是文件行，也不是单次调用，而是 `ObjectChangeUnit`：

```ts
interface ObjectChangeUnit {
  unitId: string;
  candidateId: string;
  primaryObject: string;
  operationSequences: number[];
  finalFingerprint?: string;
  requiredUnitIds: string[];
  requiredBaseObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
  potentialImpact: unknown[];
  observedImpact: unknown[];
  evidenceSummary: CandidateEvidenceSummary;
}
```

同一候选中连续修改同一规范对象的操作必须组成一个不可拆分的对象变更单元。例如一个 timeline 的 create、addTrack、insertCue 和 moveCue 不能被调用方任意切成四个片段。

选择一个单元时，系统沿有向依赖边自动加入传递闭包。反向关系不自动加入：选择 `config:entryScene` 必须包含它指向的新场景；选择新场景不代表必须把它设为入口。

### 7.4 ComparisonResult

```ts
interface CompositionComparison {
  comparisonVersion: '1.0.0';
  projectIdentity: string;
  currentProjectRevision: string;
  baseProjectRevision?: string;
  status: 'ready' | 'review-only' | 'blocked';
  candidates: CandidateSummary[];
  units: ObjectChangeUnit[];
  dependencyEdges: DependencyEdge[];
  conflicts: CompositionConflict[];
  identicalGroups: IdenticalUnitGroup[];
  evidenceMatrix: CandidateEvidenceMatrix;
  comparisonFingerprint: string;
}
```

相同 capsule 集合和项目 revision 必须产生相同 fingerprint。生成时间、随机 ID、路径和数组输入顺序不得影响规范结果；候选按 artifact SHA、单元按规范对象与来源 SHA 稳定排序。

## 八、冲突模型与自动合成边界

### 8.1 四层检查

1. **身份和时效：** capsule、manifest、项目和基线身份；
2. **对象重叠：** 不同候选是否触碰同一 canonical object；
3. **依赖交叉：** 删除、替换或新增对象是否破坏其他候选的引用；
4. **行为风险：** potential/observed impact 和证据指出的可达性、状态或演出变化。

前三层产生结构化冲突或自动合成结论。第四层在比较阶段是风险提示，最终必须由集成后的新鲜 validation/simulation/runtime 证明，不能只靠静态推断宣布安全。

### 8.2 冲突等级

```ts
type CompositionConflictSeverity =
  | 'blocking'
  | 'selection-required'
  | 'advisory';
```

- `blocking`：artifact/manifest 损坏、项目身份不一致、基线不一致、依赖缺失、计划过期、不可重放；
- `selection-required`：两个候选对同一规范对象产生不同结果，或一个候选删除另一个所需对象；
- `advisory`：证据缺失、warning、未覆盖分支或潜在行为影响，不阻断只读比较，但必须进入人工复核字段。

每个冲突至少包含稳定 `conflictId`、code、涉及候选/单元/对象、证据参数、允许的 resolution 和 machine-readable repairActions。

### 8.3 首版自动合成规则

只允许：

1. 依赖闭包完全不相交；
2. 不同候选对同一对象产生完全相同的规范结果，按最终 fingerprint 去重，并保留全部 provenance。

以下即使看似兼容也不得自动合成：

- 同一 scene 的不同文本块；
- 同一 timeline 的不同 track/cue；
- 同一变量的不同默认值、范围或类型；
- 同一角色或 entryScene 的不同结果；
- 对同一对象的“非重叠字段”修改。

未来只有在真实案例证明两类操作可交换、且共享层具备确定性合同后，才可扩展自动规则；本轮不预设字段级 merge framework。

### 8.4 允许的裁决

```text
选择候选 A 的单元
选择候选 B 的单元
两个都不采用
退回 Agent 重新产生候选
```

不提供“自动选最佳”“让模型自由融合”或调用方注入替代 JSON。裁决保存 conflictId、resolution、chosenUnitId（若有）、actor、时间和可选 reason；时间与 reason 不进入语义计划 fingerprint，实际 resolution 必须进入。

## 九、集成计划

### 9.1 为什么需要独立计划 artifact

comparison 是当前事实的只读快照；execute 会产生新 change。中间必须有一份不可变计划，冻结候选身份、选择、依赖闭包、冲突裁决、重放顺序和 dry-run 结果，避免 Agent 在两次调用之间无声改变参数。

### 9.2 IntegrationPlan

```ts
interface IntegrationPlan {
  planVersion: '1.0.0';
  planId: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  sourceCapsules: CandidateCapsuleRef[];
  explicitlySelectedUnitIds: string[];
  implicitlyIncludedUnitIds: string[];
  excludedUnitIds: string[];
  conflictResolutions: ConflictResolution[];
  replayOperations: PlannedReplayOperation[];
  provenance: ProvenanceEntry[];
  dryRun: CompositionDryRunResult;
  planFingerprint: string;
}
```

调用方只提交 capsule refs、unitId 和允许的 resolution。服务端重新从已验证胶囊构造 `replayOperations`；不得接受调用方提供的 normalizedInput、依赖图、对象 fingerprint 或排序。

### 9.3 确定排序与 operationId

- 每个候选内部保持 source sequence；
- 先按依赖图拓扑排序；
- 无依赖关系的单元按 primaryObject、capsule SHA、source sequence 稳定排序；
- 相同结果去重时，以最小 capsule SHA 的操作作为规范代表，但 provenance 列出所有来源；
- 新 operationId 使用计划 fingerprint、来源 capsule 短哈希和 sourceOperationId 的确定性命名空间；
- 若图存在循环且不能由同一对象单元吸收，计划失败为 dependency cycle，不猜测顺序。

### 9.4 Dry-run

plan builder 在不持久化 source/project 的隔离记录上调用同一 authoring mutation 实现，完成：

1. 从 expected project revision 建立临时 change；
2. 按确定顺序重放；
3. 运行共享结构校验；
4. 回读每个目标对象最终 fingerprint；
5. 确认结果与计划预期一致；
6. 丢弃临时状态。

Dry-run 不复制解析器、不写 project、不写 source change、不生成可提交 change，也不代替执行后的 fresh evidence。失败时 plan artifact仍可保存为不可执行审计结果，但 `composition.execute` 必须拒绝。

### 9.5 Plan Store

Node 层在当前 projectIdentity 对应 data root 下保存：

```text
<project-data>/composition-plans/<planId>/payload.json
<project-data>/composition-plans/<planId>/identity.json
```

- payload/identity 使用既有非撕裂 JSON record helper；
- planId 由 planFingerprint 派生，不依赖随机数；
- 同一 payload 重复创建返回同一 plan；不同 payload 不得覆盖；
- 不维护中央可变索引，不扫描任意路径，不把计划写进项目仓库；
- `composition.inspect` 通过 planId + SHA 读取，禁止绝对路径输入。

## 十、集成执行状态机

### 10.1 前置条件

`composition.execute` 首次调用要求：

- policy 至少为 stage；
- 当前 session 没有 active/resumed change；
- plan artifact 和 SHA 有效，dry-run passed；
- 当前 projectIdentity/revision 与 plan 完全一致；
- source capsule 和 manifest 身份仍可解析；
- 所有 conflict 已裁决；
- operationId 非空且幂等。

同一执行中断后的恢复调用是唯一例外：session 可以 resume 与 planId、planFingerprint 和 execute operationId 完全匹配的 integration change，但不得同时绑定其他 change。它无论在 stage 或 apply session 中都只创建或恢复 OPEN integration change，绝不自动 commit。

### 10.2 Integration metadata

新 ChangeRecord 增加可选字段：

```ts
interface IntegrationMetadata {
  planId: string;
  planFingerprint: string;
  sourceCapsules: CandidateCapsuleRef[];
  conflictResolutions: ConflictResolution[];
  status: 'REPLAYING' | 'READY' | 'FAILED';
  nextOperationIndex: number;
  replayed: ReplayReceipt[];
  failure?: CompositionFailure;
}
```

普通 change 没有该字段，现有行为不变。integration change 在 `status=READY` 前不得 commit；`REPLAYING` 或 `FAILED` 时 `change.commit` 必须返回结构化阻断。

### 10.3 执行顺序

```text
短 project lease 下核对 revision
→ 创建新的 ChangeRecord V2 + IntegrationMetadata(REPLAYING)
→ 取得 change lease
→ 逐项调用现有 authoring mutation
→ 每项成功后以 CAS 持久化 receipt / nextOperationIndex
→ 全部完成后核对最终对象 fingerprint
→ status=READY
→ 返回 integrationChangeId、workingRevision、provenance 与 requiredNextActions
```

不在整个重放期间长期持有 project lease；基线已封存在 integration change。不同 integration change 可以并行 stage，最终 commit 仍由既有 project lease 串行。

### 10.4 中断与重试

- 每项重放 operationId 确定且已有幂等账本；
- 进程在 operation 持久化后、进度推进前退出时，同一 execute operationId 重试会读取 operation ledger，不重复 mutation；
- `session.describe` 显示 planId、状态、nextOperationIndex 和允许动作；
- 同一 plan/operationId 可以从 `REPLAYING` 继续；不同 plan 使用同一 operationId 返回冲突；
- lease/CAS 暂态错误给出 after-refresh repairActions；
- 领域重放失败将 integration metadata 置为 `FAILED`，保留已完成 receipt 与错误，不修改 source/project；
- `FAILED` 不能被原地换计划修补。调用方可以 inspect、diff、rollback，再创建新 plan；禁止静默跳过失败操作。

### 10.5 失败后的安全属性

任何失败必须满足：

- source capsules 字节和 SHA 不变；
- source change records 不变；
- 真实 project revision 不变；
- 失败 integration change 可读、可 diff、可 rollback；
- 没有 READY 状态就不能 delivery as composable result 或 commit；
- 失败 artifact 和 invocation facts 保留。

## 十一、四项新增 capability

### 11.1 `composition.compare`

- minimum policy：observe；
- side effects：project-read、change-store-read；
- 输入：2 至 8 个 CandidateCapsuleRef；
- 输出：CompositionComparison；
- 不创建 change，不写计划，不修改胶囊；
- 可返回 review-only/blocked 结果，身份损坏则直接失败。

首版 2 至 8 个候选足以覆盖真实比较，同时限制 artifact 和上下文体积；更大批次留待后续真实需求。

### 11.2 `composition.plan`

- minimum policy：observe；
- side effects：project-read、change-store-read、change-store-write；
- 输入：comparisonFingerprint、candidate refs、selectedUnitIds、conflictResolutions；
- 输出：sealed IntegrationPlan + artifact identity；
- idempotency：同一规范输入返回同一 planId；
- unresolved conflict、闭包缺失或 dry-run 失败时不得产生 executable plan。

### 11.3 `composition.inspect`

- minimum policy：observe；
- side effects：change-store-read；
- 输入：planId、artifactSha256；
- 输出：完整 plan、identity、当前项目时效和 executable 状态；
- 进程重启后 Agent 不需要记住大段 plan JSON。

### 11.4 `composition.execute`

- minimum policy：stage；
- side effects：project-read、change-store-read、change-store-write；
- 输入：operationId、planId、artifactSha256、initiator；
- 输出：integrationChangeId、状态、workingRevision、replay summary、requiredNextActions；
- 不接受 replay payload，不自动 validate/simulate/runtime/capsule/commit；
- 可从同一 operationId 的 REPLAYING 状态恢复。

四项能力进入同一 registry，原生 dispatcher、CLI 和 MCP 名称机械派生。registry 只存 schema/metadata，不保存比较或执行实现。

## 十二、集成后的证据与交付

### 12.1 requiredNextActions

execute 成功只证明计划重放完成，不证明作品行为正确。返回结果必须明确要求：

```text
change.diff
project.validate
project.simulate
必要的 runtime.run-from / runtime.read-trace
surdet_delivery_capsule
```

Agent 不得把 dry-run 或 source candidate 的证据写成集成结果证据。

### 12.2 新鲜证据

- validation 必须对应 integration change 的最终 workingRevision，且 errors=0；
- simulation 必须对应同一 workingRevision 并 passed；
- scene/timeline 行为由显式 runtime target 取证，不把“场景结束”冒充演出执行；
- diff 必须列出最终对象、来源和去重/裁决记录；
- source evidence 只进入 comparison matrix，不替代 integration evidence；
- warning 分为基线、来源候选和集成新增，不允许混写。

### 12.3 集成交付胶囊

integration change 的 v2 capsule 额外包含：

```ts
integrationProvenance: {
  planId: string;
  planFingerprint: string;
  sourceCapsules: CandidateCapsuleRef[];
  includedUnits: string[];
  deduplicatedUnits: IdenticalUnitResolution[];
  conflictResolutions: ConflictResolution[];
  replayReceipts: ReplayReceipt[];
}
```

它仍是普通 delivery capsule 的扩展，不另造“最终包”格式。项目所有者批准后使用既有 `change.commit`；commit 只写 integration change 的 workingFiles，不触碰 source changes。

## 十三、机器接口与未来人类界面

### 13.1 机器层

机器合同使用：

- stable IDs、codes、fingerprints 和严格 schema；
- dependency graph、conflict resolution enum 和 evidence freshness；
- deterministic ordering、repairActions 和 retryDisposition；
- 完整 provenance 与 artifact identity。

机器结果不使用自然语言猜测创作优劣，不嵌入 prompt，不保存模型品牌或“置信度分数”。

### 13.2 人类层

未来 Editor 应把同一事实投影成：

```text
可以直接组合
需要你选择
缺少必要内容
证据不足
项目已经变化，请重新比较
```

默认显示中文摘要、对象名称、影响范围和推荐下一步；技术代码、完整 JSON、哈希和原始 diff 放在“高级详情”。普通用户不应被迫理解 `CANDIDATE_BASE_MISMATCH` 或 `manifestFingerprint`。

本轮不修改 Editor，但不得在共享合同中塞入只能由英文工程界面解释的非结构化句子。稳定 code + params 是未来本地化的依据，中文 CLI 文本只是投影，不是业务真相。

## 十四、错误与修复合同

新增错误至少包括：

| code | 含义 | retryDisposition |
|---|---|---|
| `CAPSULE_VERSION_UNSUPPORTED` | v1 或未知版本只能审计 | `new-change` |
| `CAPSULE_IDENTITY_MISMATCH` | payload 与 identity/SHA 不一致 | `never` |
| `CANDIDATE_PROJECT_MISMATCH` | 候选不属于当前项目 | `new-change` |
| `CANDIDATE_BASE_MISMATCH` | 候选基线不同 | `new-change` |
| `CANDIDATE_NOT_COMPOSABLE` | v2 manifest 不可用 | `new-change` |
| `COMPOSITION_DEPENDENCY_MISSING` | 选择闭包缺少必要对象 | `after-repair` |
| `COMPOSITION_CONFLICT_UNRESOLVED` | 必须裁决的冲突尚未处理 | `after-repair` |
| `COMPOSITION_PLAN_STALE` | 项目、候选或 comparison 身份已变化 | `after-refresh` |
| `COMPOSITION_PLAN_INVALID` | plan artifact/schema/hash 不成立 | `never` |
| `COMPOSITION_REPLAY_FAILED` | 规范操作在集成 change 中确定性失败 | `after-repair` |
| `COMPOSITION_INCOMPLETE` | integration change 尚未 READY | `same-request` 或 `after-inspect` |

错误 details 必须包含当前已知身份、冲突/单元 ID 和允许的下一动作；不得返回任意路径、敏感 prompt 或要求 Agent 用 Shell 修文件。

repairActions 只提供真实可执行路径，例如重新 compare、补齐 resolution、inspect plan、以同一 operationId resume、rollback failed integration 或创建新 plan。终局错误不得标成 `same-request`。

## 十五、存储、安全与隐私边界

1. 所有 capsule 和 plan 都位于 `SURDET_AGENT_DATA_DIR` 的当前 projectIdentity 命名空间；
2. API 不接受任意绝对路径，不跨 projectIdentity 扫描；
3. artifact 使用非撕裂写入、identity sidecar 和 SHA-256 回读；
4. source capsule/plan 创建后不可覆盖；同 ID 不同内容 fail-loud；
5. normalizedInput 只保存领域请求，不保存 token、环境变量、prompt、聊天记录、模型输出原文或用户主目录；
6. projectRoot 绝对路径不进入可移动 manifest fingerprint；projectIdentity 进入；
7. compare/plan 有界：最多 8 个候选、每候选最多 256 个可组合 operation、总计最多 1024 个 dependency edge；超限返回明确错误，不默默截断；
8. dry-run 和 execute 不启动后台 daemon，不调用 Git，不访问网络；
9. source/project 任何非预期写入都是 Blocker；
10. 不删除历史 capsule、plan、失败 integration change 或 artifact。

## 十六、测试与证据设计

### 16.1 第一组 RED：现有胶囊不可重放

永久测试用当前 v1/旧 operation record 证明：

- 只有 requestHash/result，缺少 normalizedInput；
- diff 无法唯一还原 typed request；
- 系统必须返回 audit-only / not-composable，而不是伪造 manifest。

RED 必须匹配真实缺口。若当前源码已具备等价能力，停止并复审，不重复实现。

### 16.2 共享单元合同

至少覆盖：

- 规范输入捕获和 operationId 幂等；
- manifest 稳定排序、哈希、白名单和隐私字段排除；
- v1 audit-only、v2 ready/unavailable；
- 同项目/同基线资格；
- 对象变更单元、同对象操作链和有向依赖闭包；
- 不相交自动组合；
- 相同结果去重且多来源保留；
- 同对象不同结果必须裁决；
- 删除依赖、缺失资源、循环和 stale plan；
- 调用方不能伪造 replay payload；
- plan 相同输入产生相同 fingerprint；
- dry-run 零持久副作用；
- execute 顺序、receipt、崩溃恢复、FAILED/READY commit gate；
- integration capsule provenance。

### 16.3 Node/CLI/MCP 合同

至少覆盖：

- capsule/plan artifact immutable storage 和 SHA readback；
- 目录穿越、错 project、错 hash、损坏 JSON；
- 26 项 capability registry、policy 和 schema；
- 原生 dispatcher 与 MCP output conformance；
- stdout 协议纯净、stderr 诊断和 child cleanup；
- MCP modern/legacy transport 仍通过既有 preflight；
- observe 可以 compare/plan/inspect，stage 才能 execute，apply 不会自动 commit；
- session active change 阻断 execute 并给出真实 repair action。

### 16.4 确定性纵向 FORMAL

系统临时目录创建 Starter 隔离副本，并使用同一 launcher/cwd/dist：

1. 候选 A：新增 `scene:agent_candidate_alpha` 与它需要的变量；
2. 候选 B：新增互不相交的 `scene:agent_candidate_beta` 与既有资源 timeline；
3. 候选 C：对 `scene:agent_candidate_alpha` 提供不同规范结果，制造 selection-required 冲突；
4. 另一个候选产生与 A 完全相同的结果，用于去重证据；
5. 所有候选从同一 base 创建、完成 fresh evidence 并封存 v2 capsule；
6. compare 证明 B 可与 A 自动组合、C 必须裁决、重复 A 被去重；
7. plan 选择 A+B、明确排除 C，dependency closure 与 dry-run 通过；
8. execute 创建唯一 integration change，来源候选和真实项目不变；
9. fresh diff/validation/simulation/explicit runtime 证明 Alpha/Beta 都存在且 C 的替代结果不存在；
10. integration capsule provenance、bytes、SHA、runHead 与 plan identity 全部回读；
11. 在同一隔离 fixture 的 apply policy 下，项目所有者预授权的确定性客户端只 commit integration change，回读磁盘；原始 Starter 不变；
12. 所有错误通道、lease、child 和端口清理为空。

FORMAL runner 必须先有 preflight，DIAGNOSTIC 最多 3 次；冻结 runner 并提交后 FORMAL 只运行 1 次，失败即停，不一修一 FORMAL。

### 16.5 Agent 差异控制

不把“一个特别强的模型会用”当成唯一证据：

1. **确定性公开客户端：** 只按 capability schema、result 和 repairActions 工作，不读取源码，不使用隐含知识；
2. **真实外部 Agent：** 新对话、只给项目目标和 MCP 配置，不给 Surdet 源码解释，让它完成 compare → plan → execute → evidence → capsule；
3. 两者都不得使用 Shell、Git 或直接文件系统修改；
4. 若确定性客户端通过而真实 Agent 失败，判为发现性/引导问题；若二者都失败，优先判断合同或实现问题；
5. 不要求同时购买或运行多个特定商业模型，避免把产品门槛绑定到供应商。

### 16.6 项目所有者短验收

FORMAL 与外部 Agent 通过后，项目所有者只需在隔离 fixture 中确认：

- 被选择的 Alpha/Beta 内容能够从 Editor/preview 看到；
- 被排除的 C 替代内容不存在；
- 项目仍可正常打开、预览和保存；
- 这不是对未来候选比较 UI 的验收。

自动化不能代填这四项。若项目所有者不希望进行视觉路径，本轮只能声明机器合成合同通过，不能把人类可见结果写成已验收。

## 十七、实施范围指导

### 17.1 预计新增共享文件

- `packages/authoring/src/composition-contracts.ts`：manifest、comparison、unit、conflict、plan、integration metadata 类型；
- `packages/authoring/src/composition-manifest.ts`：规范 operation → manifest 与 fingerprint；
- `packages/authoring/src/candidate-comparison.ts`：资格、单元、依赖、冲突和去重纯逻辑；
- `packages/authoring/src/integration-plan.ts`：闭包、裁决、排序和 plan fingerprint；
- `packages/authoring/src/integration-execution.ts`：协议无关 replay 进度与 resume 状态机；
- 对应聚焦测试文件。

### 17.2 预计修改共享文件

- `contracts.ts`：RecordedOperation 和可选 IntegrationMetadata；
- `change-session.ts`：记录 normalizedInput、integration commit gate；
- `capability-contract.ts`：authoring/capsule 2.0.0；
- `capability-registry.ts`：四项 composition capability 与 composable metadata；
- `error-catalog.ts`：稳定错误和 repair actions；
- `index.ts`：公开导出。

### 17.3 预计 CLI 文件

- 新增 `node-composition-store.ts`：读取 capsule、保存/读取 plan artifact；
- 新增 `composition-service.ts`：Node 快照、dry-run adapter 与 executor 接线；
- 修改 `node-change-store.ts`：capsule read API，不复制 plan store；
- 修改 `authoring-service.ts`、`authoring-dispatcher.ts`：四项薄服务；
- 修改 Agent Port session/server/delivery capsule 的投影与 v2 schema；
- 新增聚焦、MCP conformance 和唯一 E2E runner。

### 17.4 默认禁止修改

- `packages/core/**`、`renderer/**`、`host/**`、`shell/**`、`editor/**` 生产代码；
- `examples/starter/**`、Zero、games、资产、剧情、配置和存档格式；
- package 依赖、MCP SDK、lockfile、性能门限、pack/release/deploy；
- 长期路线台账、受保护文件、既有 handoff、历史 artifact；
- 除非任务书针对真实源码漂移重新取得项目所有者批准，不得扩大白名单。

## 十八、实施节奏、成本与 Git 治理

任务书应拆为可独立审核的纵向任务：

```text
Task 0  基线与旧胶囊 RED
Task 1  operation capture + Capsule v2
Task 2  comparison / dependency / conflict
Task 3  immutable plan + dry-run
Task 4  integration execute / resume / commit gate
Task 5  registry / CLI / MCP 投影
Task 6  integration evidence + capsule provenance
Task 7  聚焦全量与唯一 verify:all
Task 8  preflight / DIAGNOSTIC / FORMAL
Task 9  外部 Agent 与项目所有者验收准备
Task 10 文档、磁盘身份、精确提交与独立复审
```

成本纪律：

- 质量优先；质量不受影响时节省额度；
- 不为每个小改动跑全仓门禁；聚焦 RED/GREEN 后再跑受影响工作区；
- `verify:all` 正式运行 1 次，只有直接相关且已有聚焦红灯时允许 1 次 recovery；
- DIAGNOSTIC 最多 3 次；失败先复审方法，禁止无限 runner 轮回；
- FORMAL 只在 runner/code evidence frozen 后运行 1 次；
- 真实外部 Agent 验收不得被执行 AI 代填；
- 每个代码纵向任务独立普通提交；最后文档闭合独立提交；
- 不 amend、rebase、squash、reset、clean 或改写历史；
- 未经项目所有者明确授权不得 push。

## 十九、主要风险与控制

### 19.1 可重放清单变成第二套领域模型

控制：manifest 只保存已被共享 capability 接受的规范输入和对象关系；执行仍调用原实现，不提供 raw file fallback。

### 19.2 Capability Registry 膨胀成中央巨石

控制：registry 只保存 ID、schema、policy、side effect、idempotency、errors、repair metadata 和 composable 标记；比较算法、中文说明、prompt、示例库和执行策略放在专责模块。

### 19.3 依赖闭包过大

控制：首版按对象操作链分组、按有向强依赖扩展；反向关联只做提示，不自动吸入。报告显式列出 implicit inclusions。

### 19.4 看似无冲突但行为冲突

控制：静态比较不宣布行为安全；集成后必须重新生成 fresh validation/simulation/runtime evidence。

### 19.5 重放一半后进程退出

控制：IntegrationMetadata + record CAS + 幂等 operationId；同一 plan resume，READY 前禁止 commit。

### 19.6 旧胶囊兼容诱惑

控制：v1 只读审计，缺少规范输入即 fail-loud；不从 diff 推断、不查回活动 change 拼装 migration。

### 19.7 过度自动化创作选择

控制：引擎只判断结构上能否安全组合，不判断文学、美术或演出哪个更好；重叠必须由人或明确 Review Agent 裁决，并保留理由。

### 19.8 人类界面长期被机器合同绑架

控制：shared contract 输出 stable code/params；Editor 未来做中文和渐进展开。当前不把英文技术字段规定为最终 UI 文案。

### 19.9 测试只证明强模型会用

控制：确定性 schema-only client 是硬门，真实外部 Agent 是补充产品证据；不依赖某一家模型的隐含知识。

## 二十、未来演进但不属于 Wave 5

- Editor 中文候选比较与裁决工作台；
- 对象级反向选择、预览画面选择和可视化因果定位；
- 经真实案例证明的字段级可交换 operation；
- 候选评分、创作目标权重和人工偏好模板；
- Agent 任务分派、队列、角色与预算；
- 跨 data root 的签名候选导入；
- 扩展市场与第三方 authoring capability；
- 多用户权限、远程协作和云端 artifact store。

这些方向必须从本轮稳定的 manifest、comparison、plan 和 provenance 合同自然演进，不能提前塞进首版。

## 二十一、规格验收清单

- [x] 采用 B2 多候选比较与安全合成；
- [x] 候选不可变，合成只创建新 integration change；
- [x] 最小选择单位为依赖闭合的对象变更单元；
- [x] 首版只自动合成不相交或完全相同结果；
- [x] v1 audit-only，v2 composition manifest；
- [x] 不从 diff 猜测操作；
- [x] MCP 是共享合同薄适配；
- [x] 不内嵌模型，不保存 prompt 或模型品牌；
- [x] 机器合同与未来中文人类界面分离；
- [x] plan 不接受调用方伪造 replay payload；
- [x] dry-run 和 execute 使用同一 authoring 语义；
- [x] source/project 不被 stage 合成修改；
- [x] execute 可中断恢复，READY 前不可 commit；
- [x] 集成结果必须重新取证；
- [x] 确定性客户端与真实外部 Agent 双证据；
- [x] Editor、Core、runtime、资产和发行不扩入本轮；
- [x] 有界 DIAGNOSTIC、唯一 FORMAL 与明确 push gate。

## 二十二、批准记录与当前停止点

项目所有者已在设计对话中批准：

1. Wave 5 以 B2 为主，优先 Agent 友好的专业底座；
2. 采用“来源候选不可变，新建集成变更”的方案 3；
3. 使用依赖闭合对象单元，不允许残缺选择；
4. 首版采用保守自动合成边界；
5. 接受旧胶囊只读审计、新胶囊才可组合；
6. 授权总经理继续完成剩余设计，不再逐项要求项目所有者理解底层类型。

当前停止状态：

```text
WAVE_5_B2_DIRECTION_APPROVED
CANDIDATES_IMMUTABLE
DEPENDENCY_CLOSED_SELECTION_APPROVED
CONSERVATIVE_AUTO_COMPOSITION_APPROVED
CAPSULE_V1_AUDIT_ONLY_V2_COMPOSABLE_APPROVED
WRITTEN_SPEC_READY_FOR_OWNER_REVIEW
IMPLEMENTATION_NOT_AUTHORIZED
TASKBOOK_NOT_CREATED
NOT_PUSHED
WAVE_6_NOT_STARTED
```
