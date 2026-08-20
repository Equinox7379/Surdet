# Surdet Agent Port / Stage 6 Wave 4 设计规格

> 日期：2026-08-20
> 状态：设计已完成，等待项目所有者文件级复核
> 阶段：Stage 6 Wave 4
> 产品方向：A / Surdet Agent Port
> 已选方案：A1 + A1.1 + P1 + T1 + S1
> 当前授权边界：只允许设计文档与本地设计提交；尚未授权实现、FORMAL、人工验收或 push

## 一、执行摘要

Wave 4 要把 Surdet 从“拥有一套可被脚本调用的 authoring 能力”，推进为“外部电脑端 Agent 能自行发现、理解、安全调用并交付结果的正式创作端口”。

本 Wave 不在引擎内部内置模型、聊天框、提示词编排器或 Agent 调度器。Surdet 负责提供确定、可发现、类型化、可验证的创作合同；外部 Agent 负责理解自然语言创作意图并选择工具。两者的边界是：

```text
外部桌面 Agent
  → 本地 MCP stdio
  → Surdet Agent Port 会话与权限门
  → 类型化能力工具
  → 既有 AuthoringService
  → @surdet/authoring 共享语义
  → NodeProjectStorage / NodeChangeStore
  → 普通 Surdet 项目、验证结果、运行证据与交付胶囊
```

首版严格采用以下组合：

- **A1：** Surdet 原生 authoring 合同为真相，MCP 只是薄适配；
- **A1.1：** 一个 Port 进程只绑定一个显式项目根；
- **P1：** 启动时固定 `observe | stage | apply` 三档权限，Agent 不能自助提升；
- **T1：** 一项正式 capability 对应一个独立、类型化 MCP 工具；
- **S1：** 只暴露并证明 Wave 1～3 已有创作能力，不夹带新对象、资产导入或全项目审计。

完成后的独特价值不是“Surdet 里面也有一个 AI”，而是：任何合格的外部桌面 Agent 只要获得 MCP 连接、项目目录与创作目标，就能低上下文地完成可审查、可恢复、可验证的 Galgame 创作。人类 Editor 与 Agent Port 最终读写同一种项目、使用同一事务、同一校验、同一模拟和同一运行证据，不产生 AI 专属旁路格式。

## 二、背景与当前能力基线

Wave 1～3 已经打通二十项原生 authoring capability：

1. `capabilities.describe`
2. `project.inspect`
3. `project.assets`
4. `object.inspect`
5. `change.begin`
6. `scene.create`
7. `scene.patch`
8. `variable.ensure`
9. `character.ensure`
10. `character.remove`
11. `timeline.create`
12. `timeline.patch`
13. `project.entry-scene.set`
14. `project.validate`
15. `project.simulate`
16. `runtime.run-from`
17. `runtime.read-trace`
18. `change.diff`
19. `change.commit`
20. `change.rollback`

它们已经能完成场景、选项、变量、角色、既有资源演出、入口场景、校验、模拟、正式运行证据、对象级 diff 与事务提交。但目前外部 Agent 仍需要提前知道命令名称、参数、前置条件、错误处理顺序与证据含义；`capabilities.describe` 主要还是名称清单，尚不能充当稳定、完整、机器可发现的创作合同。

因此 Wave 4 的工程目标不是增加更多内容种类，而是消除以下真实使用障碍：

- Agent 不应阅读 Surdet 源码才能知道怎么创作；
- Agent 不应依赖数千字项目专用提示词才能知道工具顺序；
- Agent 不应获得任意 Shell、任意路径或 Git 权限；
- Agent 遇到 stale ref、校验失败或项目基线变化时，应得到确定、机器可执行的修复方向；
- `stage` 必须能形成完整交付而不修改真实项目；
- `apply` 必须复用同一 change，在全部门禁满足后原子写回；
- 自动化通过不能替代外部 Agent 的真实可用性和项目所有者的 Editor/预览验收。

当前设计基线是 `main` 与 `surdet/main` 同步于 `0b14ca14ff16b275efe1a3578ade37dbbb2994ec`，tracked 工作树干净。该 Git 身份只说明设计开始时的仓库基线，不预先指定未来实现提交。

## 三、目标、非目标与成功定义

### 3.1 产品目标

1. 外部 Agent 能通过标准本地 MCP 客户端发现 Surdet 工具、精确 schema、权限与副作用。
2. Agent 只获得一个已绑定项目的能力面，不能在工具调用中切换项目或传入任意文件路径。
3. observe、stage、apply 三种自治工作流都具有明确、不可绕过的能力边界。
4. Agent 能复用 Wave 1～3 的全部创作纵向链，而不是走第二套解析、写盘或运行路径。
5. 失败结果包含足够的工程事实和官方修复动作，使 Agent 可以在不猜内部实现的情况下自我修正。
6. 每次 stage/apply 交付都能生成结构化、可哈希、可追溯的交付胶囊。
7. 通过确定性 MCP 客户端 FORMAL 证明协议和事务，通过真实外部 Agent 验收证明“低上下文可用”，再由项目所有者确认 Editor、画面与创作结果。

### 3.2 架构目标

- 一份协议无关 capability registry 驱动原生命令、MCP 工具、能力说明、schema 校验和合同测试。
- MCP adapter 不复制 Gal 解析、事务、对象索引、校验、模拟、runtime 或 commit 逻辑。
- 会话策略、项目绑定、工具投影和结果 envelope 是薄、确定、可单测的端口基础设施。
- 所有项目写入仍经过现有 change store、revision/precondition、validation 和 commit recovery 门。

### 3.3 明确非目标

Wave 4 不做：

- 引擎内嵌大模型、聊天 UI、提示词模板市场或 Agent 调度器；
- 任意 Shell、任意文件浏览、Git commit/push、部署、网络访问；
- 多项目单进程、协作锁、自动合并、分布式事务；
- 新的 authoring 领域对象、新 Gal DSL 或第二套场景表示；
- 项目级全局因果审计算法；
- 资产导入、生成、移动、删除或二进制事务；
- 扩展市场；
- Editor 大幅改版；
- Core、Renderer、Host、Shell 生产逻辑修改；
- 音频生产、美术生产、性能资格化、发行或 Legacy 清理；
- 为未来兼容而增加双协议、旧字段双写、migration 或 fallback。

### 3.4 完成定义

只有同时满足以下条件，Wave 4 才能请求最终关闭：

1. 原生 registry、CLI 原生调用和 MCP 投影使用同一合同真相；
2. P1 三档权限均有确定性反向测试，越权 fail-loud；
3. stage 完整创作后真实项目逐字节不变，change 与交付胶囊可恢复；
4. apply 只能在显式重启并 resume 同一 OPEN change 后提交；
5. 至少一个确定性错误由正式 `repairActions` 指引并成功修复；
6. FORMAL artifact 来自冻结代码 HEAD，且 `artifact.runHead === CODE_EVIDENCE_HEAD`；
7. 一个不知道 Surdet 源码的真实外部桌面 Agent 完成规定创作路径；
8. 项目所有者在现有 Editor/预览中确认结果可见、可理解、可保存重开；
9. Architect 与独立审核 AI 均通过；
10. 项目所有者另行授权后才可 push。设计或实现完成本身不构成 push 授权。

## 四、核心设计原则

### 4.1 原生合同优先

MCP 是连接协议，不是 Surdet 的领域模型。能力 ID、schema、错误、修复与副作用先以协议无关形式存在于 `@surdet/authoring`；MCP 名称和结构由它机械投影。未来若出现别的本地 Agent 协议，也只能适配同一原生合同，不能形成第二套语义。

### 4.2 Agent 与人类共享同一事实

Agent 生成的是普通 Surdet 项目文件。Editor 继续通过共享 authoring/项目格式读取；运行时继续通过正式项目入口执行。任何只能被 Agent Port 解释、Editor 或 runtime 不认识的隐藏元数据都不得进入项目。

Port 的会话日志、change 记录、交付胶囊和运行 artifact 存放在项目外的 Surdet 应用数据区；它们是证据，不是游戏内容。

### 4.3 最小权限且不牺牲真实自动化

observe 用于理解，stage 用于完整隔离施工，apply 用于经项目所有者明确选择后的自动落盘。安全不是把引擎永久限制为“只能建议”；自动化也不是授予 Agent Shell、Git 或任意路径。

### 4.4 失败必须保真

Port 不捕获领域错误后返回虚假成功，不把部分写入伪装成完整提交，不使用模糊 `retriable=true` 鼓励盲重试。每个错误都必须表明：发生了什么、当前事实是什么、是否可重试、重试前要取得什么新事实、必须调用哪个正式工具。

### 4.5 形式证据与产品验收分开

确定性 MCP 客户端用于 FORMAL，可证明协议、权限、事务和 artifact；真实外部 Agent 验收用于证明机器可发现性和低上下文使用；项目所有者验收用于判断 Editor、画面、交互与创作结果。三者不能互相冒充。

## 五、组件边界

### 5.1 `@surdet/authoring`

新增协议无关 registry 与公共合同类型，负责：

- capability 定义；
- 输入/输出 JSON Schema 或等价可序列化 schema；
- side effect、幂等性、最低 policy 与生命周期前置描述；
- error catalog、retry disposition 与 repair recipe；
- success/failure envelope 的领域字段；
- registry 完整性与唯一性校验。

它不得：

- import MCP SDK；
- 依赖 Node 文件系统、stdio 或进程环境；
- 绑定某个模型厂商；
- 解析 MCP JSON-RPC；
- 知道 Git、Shell 或部署。

### 5.2 `@surdet/cli`

继续承载：

- `AuthoringService`；
- `NodeProjectStorage`；
- `NodeChangeStore`；
- 现有 CLI 原生调用；
- 新的隔离 `agent-port/` 基础设施；
- 第二个可执行入口 `surdet-agent-port`。

首轮不拆出新 workspace。只有未来出现独立发布、第三个 Node host 或无法在 CLI 包内维持边界的真实需求时，才重新评估拆包。

### 5.3 MCP adapter

adapter 只负责：

1. 初始化 MCP stdio server；
2. 建立不可变 session；
3. 根据 policy 投影 T1 工具；
4. 校验协议输入；
5. 机械注入 project/change/session 上下文；
6. 调用 `AuthoringService`；
7. 把原生 envelope 映射为 MCP `structuredContent`；
8. 把协议日志写到 stderr，把证据日志写到项目外应用数据区；
9. 在进程退出时完成句柄清理，但不自动 commit/rollback。

adapter 禁止：

- 自己解析或序列化 Gal；
- 自己实现对象查找、patch、validation、simulation、runtime 或 commit；
- 启动 `surdet authoring ...` 子进程作为内部实现；
- 修改 Agent 参数以“帮助通过”；
- 为旧客户端猜测字段或静默降级；
- 在 stdout 输出任何非 MCP frame 内容。

### 5.4 Editor 与 runtime

Wave 4 不修改 Editor 产品界面，也不修改 Core/Renderer/Host/Shell 生产逻辑。Editor 只承担最终人工验收：打开 Agent 产出的普通项目，检查对象、因果关系、演出与预览结果。

如果实施中发现必须修改这些层才能让 Port 工作，应停止并回到设计复审；不得以“小接线”为名扩大 Wave 4。

## 六、协议无关 capability registry

### 6.1 单项定义

每项 capability 至少包含：

```ts
interface CapabilityDefinition {
  id: CapabilityId;
  title: string;
  purpose: string;
  minimumPolicy: "observe" | "stage" | "apply";
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffects: SideEffectClass[];
  idempotency: IdempotencyClass;
  preconditions: PreconditionDefinition[];
  possibleErrors: ErrorCode[];
  repairRecipes: RepairRecipe[];
  minimalExample: {
    input: JsonValue;
    expectedResultShape: JsonValue;
  };
}
```

设计要求：

- capability ID 稳定，首版沿用现有二十项名称；
- schema 为严格对象，默认 `additionalProperties: false`；
- registry 内所有错误必须存在于 error catalog；
- output schema 描述 `result`，通用 envelope 由统一层包裹；
- side effect 必须区分 `none`、`change-store-read`、`change-store-write`、`project-read`、`project-write`、`runtime-process`、`evidence-write`；
- idempotency 必须区分纯读、天然幂等、依赖 operationId 幂等、非幂等；
- `minimalExample` 只展示最小合法工程调用，不代替创作决策；
- registry 加载时发现重复 ID、重复 MCP 名、缺失 schema/error 或权限矛盾必须启动失败。

### 6.2 唯一真相的消费者

同一 registry 必须驱动：

- MCP `tools/list` 的名称、description 与 `inputSchema`；
- MCP 参数校验；
- `capabilities.describe` 的完整结构化结果；
- 现有 CLI 的能力帮助与机器可读能力输出；
- 原生 dispatcher 的 capability 联合类型或运行时校验；
- registry/CLI/MCP 一致性合同测试。

不得继续人工维护“CLI 20 项、MCP 20 项、文档 20 项”三份平行清单。

### 6.3 MCP 工具命名

原生 ID 与 MCP 名称采用确定性一一映射：

```text
project.inspect          → surdet_project_inspect
scene.patch              → surdet_scene_patch
project.entry-scene.set  → surdet_project_entry_scene_set
runtime.run-from         → surdet_runtime_run_from
change.commit            → surdet_change_commit
```

规则：`surdet_` 前缀；`.` 与 `-` 均映射为 `_`；registry 启动校验必须证明映射单射。发生名称碰撞即 fail-loud，禁止自动加数字后缀。

Port 另有两项基础设施工具，不计入二十项领域能力：

- `surdet_session_describe`
- `surdet_delivery_capsule`

因此首版 apply 进程最多发现二十二项工具；stage 少一项 commit；observe 只发现允许的只读子集。数量只是当前合同事实，不是永久写死的产品常量。

### 6.4 能力描述结果

`capabilities.describe` 不再只返回名称。它必须能返回：

- `contractVersion`；
- 全部原生 capability definition 的机器可读摘要；
- 当前 session 中每项能力的 `available | policy-blocked | state-blocked` 状态；
- MCP tool name；
- 被 policy 隐藏时的原因；
- 最小合法示例与确定性修复链接。

observe 可以通过它理解 stage/apply 存在哪些更高权限能力，但 `tools/list` 仍不能暴露不可调用工具。这样“权限未开放”与“引擎没有此能力”可被明确区分。

## 七、Agent Port 启动与单项目会话

### 7.1 启动形式

推荐首版命令：

```text
surdet-agent-port --project "E:\games\my-game" --policy observe
surdet-agent-port --project "E:\games\my-game" --policy stage
surdet-agent-port --project "E:\games\my-game" --policy apply --resume-change <changeId>
```

`--project` 和 `--policy` 必填，不使用当前工作目录猜测；`--resume-change` 可选但只能恢复同一项目身份下、状态为 OPEN 的 change。

启动顺序：

1. 解析项目根为规范绝对路径；
2. 使用现有 storage 安全规则确认目录存在且是合法 Surdet 项目；
3. 计算稳定 `projectIdentity`、读取 `projectRevision`；
4. 验证 policy；
5. 如有 resume，验证 change ownership、项目身份、状态与 journal 完整性；
6. 创建 `sessionId`；
7. 加载并自检 registry；
8. 初始化 MCP server；
9. 通过 initialize metadata 公布 engine/contract 版本；
10. 开始接受工具调用。

任一步失败都必须在 stderr 输出短、可操作的启动错误并以非零退出；stdout 仍不得输出非 MCP 内容。项目无效、change 不属于项目、合同版本不支持或 journal 需要人工恢复时，Port 不应以降级模式启动。

### 7.2 会话身份

session 固定保存：

```ts
interface AgentPortSession {
  sessionId: string;
  startedAt: string;
  engineVersion: string;
  contractVersion: string;
  projectRootCanonical: string; // 只在本机内部使用
  projectIdentity: string;
  openedProjectRevision: string;
  policy: "observe" | "stage" | "apply";
  activeChangeId?: string;
  resumed: boolean;
}
```

返回给 Agent 的 session 描述默认只需项目身份与项目显示名，不需要泄露不必要的本机绝对路径；如果现有结果合同需要报告项目根，应以明确字段返回已绑定根，而不能让 Agent修改它。

### 7.3 项目根与 changeId 的机械注入

MCP 工具输入不得出现：

- `projectRoot`
- 任意绝对或相对文件路径
- `cwd`
- 可替换的 `changeId`
- policy 或权限提升参数

Port 根据 session 向原生请求机械注入 project root 和 active changeId。原生 CLI 合同仍可保留显式字段，便于非 MCP 调用；MCP schema 是原生 schema 去除受会话绑定字段后的严格投影。

如果某项能力需要 active change 而会话没有，返回结构化 `CHANGE_NOT_FOUND` 或更精确的 state-precondition 错误和 `surdet_change_begin` 修复动作；不得创建隐藏 change。

### 7.4 单活动 change

一个 Port 会话最多有一个 active change：

```text
NO_CHANGE
  └─ change.begin → OPEN_CHANGE
       ├─ mutate / inspect / validate / simulate / runtime / diff / capsule
       ├─ change.rollback → ROLLED_BACK（会话回到 NO_CHANGE）
       └─ change.commit   → COMMITTED（仅 apply；会话回到 NO_CHANGE）
```

同一会话存在 OPEN change 时再次 `change.begin` 必须 fail-loud，并返回继续、rollback 或重启 Port 的正式选项。Port 不替 Agent 偷偷切换 change。

### 7.5 退出、恢复与策略升级

- 进程正常退出、客户端断开或意外中止都不自动 commit，也不自动 rollback；
- OPEN change、operation ledger、validation/simulation/runtime evidence 与调用日志保存在项目外 change store；
- stage 完成后，项目所有者如认可变更，必须结束 stage Port，再显式启动 apply Port 并 `--resume-change <changeId>`；
- Agent 不能调用工具把 stage 改为 apply；
- observe 可以用 `--resume-change` 只读检查既有 OPEN change 的 diff、证据与胶囊；
- apply resume 后仍必须重新核对项目 revision、validation freshness 和 commit recovery 状态；resume 本身不是提交授权替身。

### 7.6 并发与基线变化

Wave 4 不实现锁、自动 merge、rebase 或 operation replay。允许多个独立 Port 基于同一项目 revision 建立各自 change；一旦其中一个提交：

- 其他 change 仍保留；
- inspect/diff 可继续读取；
- commit 必须因 `PROJECT_CHANGED_SINCE_BEGIN` 或等价 stale precondition 失败；
- repair action 指示重新 inspect 项目、开始新 change、由外部 Agent基于新事实重新施工；
- Port 不自动把旧操作重放到新基线。

这是首版最简单且可证明的长期正确行为。

## 八、P1 权限矩阵

### 8.1 权限层级

三档是严格单向能力超集：

```text
observe ⊂ stage ⊂ apply
```

启动后 policy 不可变；任何工具参数、MCP capability negotiation 或 Agent 消息都不能改变它。

### 8.2 工具矩阵

| 工具/能力 | observe | stage | apply | 说明 |
|---|---:|---:|---:|---|
| `session.describe` | 是 | 是 | 是 | 只读会话与状态事实 |
| `capabilities.describe` | 是 | 是 | 是 | 返回完整合同及可用性 |
| `project.inspect` | 是 | 是 | 是 | 当前项目或 active working view |
| `project.assets` | 是 | 是 | 是 | 只读既有资产目录 |
| `object.inspect` | 是 | 是 | 是 | 只读项目/working view 对象 |
| `project.validate` | 是 | 是 | 是 | observe 对新鲜项目快照；stage/apply 对 working view |
| `project.simulate` | 是 | 是 | 是 | observe 不创建可写 change |
| `runtime.read-trace` | 是* | 是 | 是 | observe 仅可读已存在、属于绑定项目/change 的证据 |
| `change.diff` | 是* | 是 | 是 | observe 仅在显式 resume OPEN change 时可用 |
| `delivery.capsule` | 是* | 是 | 是 | observe 仅可生成/读取 resumed change 的事实胶囊 |
| `change.begin` | 否 | 是 | 是 | 建立项目外隔离 change |
| 所有 scene/variable/character/timeline/entry mutation | 否 | 是 | 是 | 只修改 working view |
| `runtime.run-from` | 否 | 是 | 是 | 生成新的正式运行证据 |
| `change.rollback` | 否 | 是 | 是 | 关闭并保留审计事实，不写项目 |
| `change.commit` | 否 | 否 | 是 | 唯一项目写入能力 |

星号表示还受 session state 与 evidence ownership 前置限制，不是无条件可用。

### 8.3 observe 的 validate/simulate 语义

P1 已明确 observe 允许校验和模拟，但禁止建立可写事务。因此 observe：

- 对调用时读取的新鲜项目快照运行共享 validation/simulation；
- 不持久化可写 change；
- 结果明确标记 `view=project` 与所用 `projectRevision`；
- 若运行期间项目 revision 变化，结果标记 stale 或直接失败，不能冒充当前事实；
- 可以产生项目外、只读用途的临时报告，但不能成为 apply commit 的 validation gate；
- apply 仍必须在其 active change 上获得新鲜 validation。

实现时不得用“偷偷 begin 再 rollback”模拟 observe；应在共享服务边界提供真正只读的 snapshot target。

### 8.4 `tools/list` 与不可用能力

`tools/list` 按 policy 过滤：

- observe 不注册 begin、mutation、runtime.run-from、rollback、commit；
- stage 注册除 commit 外的全部允许工具；
- apply 注册全部工具。

生命周期前置不改变工具注册。例如 stage 在尚未 begin 时仍能发现 `scene.patch`，但调用会得到“需要 active change”的结构化失败。`session.describe` 和 `capabilities.describe` 必须区分：

- `available`
- `policy-blocked`
- `state-blocked`

这样工具发现稳定，Agent 仍能理解下一步。

## 九、T1 工具投影与调用合同

### 9.1 每项能力独立工具

禁止提供万能 `surdet_call`、自由 action 字符串或任意 JSON dispatcher。二十项原生能力逐项映射；Port 基础设施只增加 session describe 与 delivery capsule。

独立工具的优点必须在实现中保留：

- 客户端能针对单项生成参数；
- schema 小且精确；
- 副作用可见；
- policy 可以从列表直接移除危险能力；
- 错误和示例与工具绑定；
- 无需把所有操作塞进巨大联合类型。

### 9.2 输入规范

每个 MCP 工具输入：

- 严格遵循 registry schema；
- `additionalProperties=false`；
- 不接受 project root、changeId、文件路径、Shell 命令、URL；
- mutation 必须保留既有 `operationId` 幂等合同；
- object mutation 必须保留既有 objectRef/fingerprint/precondition；
- enum、字符串长度、数组上限使用领域合同中已有或本轮明确需要的最小限制；
- 未知字段返回 `INVALID_REQUEST`，不能静默忽略。

### 9.3 成功 envelope

```ts
interface SuccessEnvelope<T> {
  schemaVersion: string;
  contractVersion: string;
  sessionId: string;
  capability: string;
  ok: true;
  projectIdentity: string;
  projectRevision: string;
  changeId?: string;
  workingRevision?: string;
  operationId?: string;
  result: T;
}
```

`projectRevision` 表示调用完成时确认的真实项目基线；`workingRevision` 表示隔离 view。两者不得混用。读取旧 evidence 时还应返回其 evidence revision 与当前 freshness。

### 9.4 失败 envelope

```ts
interface FailureEnvelope {
  schemaVersion: string;
  contractVersion: string;
  sessionId: string;
  capability: string;
  ok: false;
  projectIdentity: string;
  projectRevision?: string;
  changeId?: string;
  workingRevision?: string;
  error: {
    code: string;
    category: string;
    message: string;
    details?: JsonValue;
    retryDisposition:
      | "same-request"
      | "after-inspect"
      | "after-repair"
      | "new-change"
      | "manual-recovery"
      | "never";
    repairActions: RepairAction[];
  };
}
```

失败 envelope 在 MCP 层使用 `isError=true`，同时把完整结构放入 `structuredContent`；文本 content 只提供一行人类可读摘要。未知工具、损坏 JSON-RPC 等协议级错误使用 MCP protocol error，不伪装成 Surdet 领域错误。

### 9.5 repair action

```ts
interface RepairAction {
  tool: string;
  reason: string;
  requiredFreshFacts?: string[];
  inputTemplate?: JsonValue;
  terminal?: boolean;
}
```

repair action 只能指向当前合同中的正式工具或“人工恢复/重启进程”这类明确动作。它不得：

- 输出任意 Shell 命令；
- 建议 Agent 直接编辑文件；
- 生成剧情、台词、美术或审美选择；
- 让 Agent 删除 journal；
- 鼓励无限重试。

关键映射：

| 错误 | retryDisposition | 修复方向 |
|---|---|---|
| stale object/ref | `after-inspect` | `surdet_object_inspect` 获取新指纹后重试 |
| validation required/stale | `after-repair` | `surdet_project_validate` |
| validation failed | `after-repair` | 根据 issue.objectRef/action 调相应 typed mutation，再 validate |
| project changed since begin | `new-change` | inspect 当前项目、重新 begin；不自动 replay |
| operationId conflict | `never` 或 `after-inspect` | 检查原 operation 结果；新意图使用新 operationId |
| capability policy blocked | `never` | 由项目所有者以新 policy 重启 Port |
| commit recovery failed | `manual-recovery` | 保留 journal，停止自动写入，交人工处理 |

## 十、`surdet_session_describe`

这是所有策略都存在的只读基础设施工具，返回：

- sessionId、启动时间；
- engineVersion、contractVersion；
- projectIdentity、项目显示名、当前 projectRevision；
- policy；
- activeChangeId、change status、baseRevision、workingRevision；
- resumed 与否；
- 当前状态下 available/state-blocked/policy-blocked 能力；
- 最新 validation/simulation/runtime evidence 的身份与 freshness；
- commit recovery/journal 是否需要人工处理；
- 建议的下一个确定性动作。

它不返回：

- 任意项目外目录清单；
- 环境变量；
- Token、密钥或网络凭据；
- Git remote、branch 或 push 信息；
- 创作建议。

session describe 必须成为 Agent 每次连接或恢复后的首选事实入口，但 Port 不强制客户端先调用它才能使用其它工具；真实前置仍由服务端校验。

## 十一、交付胶囊

### 11.1 定位

交付胶囊是“本次隔离创作做了什么、证据是什么、能否写回”的结构化事实包。它不是聊天总结，不替外部 Agent 做审美陈述，也不写入游戏项目。

胶囊从 change record、operation ledger、diff、validation、simulation、runtime evidence 和 Port invocation ledger 派生；不得由 Agent 直接上传一份自称通过的 JSON 替代真实证据。

### 11.2 change 意图元数据

为让胶囊能说明目标，`change.begin` 的协议无关合同增加可选事务元数据：

```ts
interface ChangeIntentMetadata {
  intent?: string;
  acceptanceCriteria?: string[];
  initiator?: "external-agent" | "human" | "automation";
}
```

这些字段存放在项目外 change record，不写入项目内容，也不参与剧情语义。它们仅用于审计和交付；长度受限，不能包含任意文件或命令。CLI 与 MCP 都使用同一元数据合同，避免 Port 私有 sidecar 成为第二套事务事实。

### 11.3 invocation ledger

Port 为每个 session/change 在应用数据区记录最小调用事实：

- invocationId；
- 时间；
- capability；
- operationId（如适用）；
- 成功/失败；
- error code；
- 调用前后 project/working revision；
- output evidence identity。

默认不重复存储大段项目内容或完整模型对话。输入只记录满足审计所需的规范化摘要/哈希，避免把台词和资产清单无界复制到日志。失败记录不能因后续成功而删除。

### 11.4 胶囊结构

```ts
interface DeliveryCapsule {
  capsuleVersion: string;
  capsuleId: string;
  generatedAt: string;
  sessionId: string;
  policy: "observe" | "stage" | "apply";
  contractVersion: string;
  projectIdentity: string;
  baseProjectRevision: string;
  currentProjectRevision: string;
  changeId: string;
  changeStatus: "OPEN" | "COMMITTED" | "ROLLED_BACK";
  workingRevision?: string;
  intent?: string;
  acceptanceCriteria: string[];
  operations: OperationSummary[];
  invocationSummary: InvocationSummary;
  objectDiff: ObjectDiffSummary;
  causalImpact: {
    potentialImpact: ImpactSummary[];
    observedImpact: ImpactSummary[];
  };
  validation: EvidenceSummary;
  simulation: EvidenceSummary;
  runtime: EvidenceSummary;
  warnings: IssueSummary[];
  manualReviewRequired: ManualReviewItem[];
  projectMutation: {
    occurred: boolean;
    expectedByPolicy: boolean;
    beforeRevision: string;
    afterRevision: string;
  };
  artifactIdentity: {
    path: string;
    bytes: number;
    sha256: string;
  };
}
```

### 11.5 stage 与 apply 的胶囊语义

stage 胶囊必须证明：

```text
changeStatus = OPEN
projectMutation.occurred = false
projectMutation.expectedByPolicy = false
beforeRevision = afterRevision
workingRevision != baseProjectRevision（存在实际变更时）
```

apply 提交前胶囊仍是 OPEN；提交后胶囊必须证明：

```text
changeStatus = COMMITTED
projectMutation.occurred = true
projectMutation.expectedByPolicy = true
afterRevision = commit 返回的新鲜项目 revision
```

rollback 胶囊标记 ROLLED_BACK 且项目未变。没有变更的空 change 不得伪装成成功创作交付。

### 11.6 artifact 保留

- 每次显式 capsule 生成使用唯一目录/文件，不覆盖旧失败或旧版本；
- 写盘后从磁盘重新读取 bytes 与 SHA-256；
- capsule 内部身份字段与外部报告一致；
- FORMAL capsule 必须记录运行时 `git rev-parse HEAD`；
- 普通 Agent 使用场景可以没有 Git 仓库，但必须有 engine/contract/project/change identity；
- 清理 artifact 属于另行授权，不在 Wave 4 自动执行。

## 十二、版本与兼容策略

### 12.1 三个版本维度

- MCP protocol version：由官方协议协商；
- `contractVersion`：Surdet capability/schema/error/repair 合同版本；
- `schemaVersion` / `capsuleVersion`：通用 envelope 与胶囊格式版本。

三者不得混为一个字符串。

### 12.2 首版策略

- Port 启动时声明唯一支持的合同范围；
- 客户端要求不支持的 contract version 时 fail-loud；
- 首版不为尚未发布的内部草案保留兼容；
- 不双写旧字段，不静默猜测，不自动降级；
- 未来真正有外部用户和已发布合同后，再由独立任务书定义兼容窗口。

### 12.3 SDK 选择

实现时优先使用官方、维护中的 TypeScript MCP SDK，不自行重写 JSON-RPC framing。任务 Task 0 必须核对当时版本、许可证、Node/ESM 兼容和体积，锁定精确版本；设计文档不预写一个可能过时的版本号。

## 十三、安全与故障边界

### 13.1 通信边界

- 仅本地 stdio；
- 不启动 HTTP/WebSocket 服务；
- 不监听端口；
- 不访问网络；
- 不使用 MCP sampling 调用模型；
- 首版不提供 prompts/resources 扩展面，只提供 tools；
- 项目根由受信启动者传入，不接受 MCP roots 动态换根。

### 13.2 文件系统边界

- 复用 `NodeProjectStorage` 已有规范化、项目根约束与 symlink/junction 防护；
- 工具 schema 不出现路径字段；
- 资产能力只返回项目内既有资源身份，不允许导入、移动或删除；
- change store、invocation ledger 和 artifact 使用 Surdet 应用数据区的受控目录；
- 不读取项目根外任意文件；
- 不修改受保护治理文档或 Git 元数据。

### 13.3 进程与 stdout 纯净性

- stdout 只允许 MCP frame；
- 所有人类诊断写 stderr；
- 正式证据写 artifact；
- console 调试不能污染 stdout；
- SIGINT/SIGTERM/客户端断开时关闭 MCP transport、runtime child 和文件句柄；
- 不因退出自动修改项目或 change 状态；
- 清理失败必须非零退出并保留可诊断信息。

### 13.4 commit 安全

`change.commit` 只有 apply 注册，且仍必须满足：

- active change 为 OPEN 且 ownership 匹配；
- 当前项目 revision 等于 change base；
- 没有 stale object precondition；
- validation 存在、通过且对应当前 workingRevision；
- 需要的 simulation/runtime gate 新鲜；
- recovery journal 不处于人工阻断；
- commit 使用现有原子/恢复机制；
- 部分失败不能返回成功；
- `COMMIT_RECOVERY_FAILED` 后停止自动重试。

Port policy gate 是额外门，不替代共享 commit 门。

### 13.5 日志与内容最小化

Port 只记录完成审计所需的调用身份、哈希、revision 与错误，不保存模型完整对话，不无界复制脚本文本。任何将来需要遥测或远程日志的需求都必须另开任务；首版本地、离线、无遥测。

## 十四、确定性验证设计

### 14.1 红灯优先

实现必须先建立以下最小红灯：

1. registry 与 dispatcher/CLI 能力清单漂移；
2. MCP tool schema 仍暴露 projectRoot/changeId/未知字段；
3. observe 能 begin 或写项目；
4. stage 能 commit；
5. Agent 可通过参数提升 policy 或切换项目；
6. stdout 被日志污染；
7. stale ref 失败缺少确定 repair action；
8. stage 完整路径后项目文件发生变化；
9. stage 进程退出时 change 被自动 rollback/commit；
10. apply 无显式 resume 或 validation stale 时仍能 commit；
11. 胶囊哈希/bytes 不是磁盘回读值；
12. 原生 CLI 与 MCP 对同一请求产生不同领域结果。

红灯必须匹配真实合同，不通过修改断言迎合实现。

### 14.2 聚焦单元/合同测试

`@surdet/authoring` 至少覆盖：

- registry 20 项唯一且完整；
- MCP 名称映射单射；
- 每项 schema/error/repair/permission 元数据完整；
- `capabilities.describe` 来自 registry；
- envelope 与 retry disposition schema；
- change intent metadata 的规范化和边界；
- 不引入 Node/MCP 依赖。

`@surdet/cli` 至少覆盖：

- policy matrix；
- single project/single active change；
- session field 注入与禁止覆盖；
- observe snapshot validate/simulate 不建立 change；
- stage/apply resume 生命周期；
- MCP structuredContent 与原生 envelope 等价；
- protocol error / domain error 分离；
- stdout 纯净；
- invocation ledger 与 delivery capsule；
- child/runtime/transport 清理；
- 项目路径、ownership、revision、commit recovery 边界。

### 14.3 原生等价性合同

选取 inspect、mutation、validate、simulate、runtime、diff、commit/rollback 代表调用，对相同 fixture 和相同 operationId 分别走：

```text
原生 AuthoringService/CLI
MCP Agent Port
```

去除 session/MCP 包装字段后，领域 result、错误 code、working revision 和项目结果必须等价。该合同用于证明 MCP 没有复制或改写语义。

### 14.4 真实 stdio 集成

使用官方 MCP client SDK 启动构建后的 `surdet-agent-port` 子进程，真实完成 initialize、tools/list、tools/call、shutdown；禁止直接 import server 内部函数冒充 stdio 证据。

至少证明：

- stdout frame 可被官方客户端解析；
- tools/list 符合 policy；
- schema 拒绝未知字段；
- structuredContent 可机器读取；
- stderr 不污染 transport；
- 退出后无残留 Port/runtime child；
- 项目根和 change ownership 不能跨 fixture。

## 十五、纵向 FORMAL 取证

### 15.1 证据等级

```text
UNIT/CONTRACT
  → PREFLIGHT
  → 有界 DIAGNOSTIC
  → 冻结 runner 与代码提交
  → 唯一 FORMAL
```

FORMAL 使用确定性 MCP 客户端，不使用大模型，避免模型随机性污染工程证据。真实外部 Agent 路径属于随后的人机产品验收。

### 15.2 成本纪律

- 聚焦测试未绿前不得跑聚合；
- preflight 必须使用与 FORMAL 相同的构建产物、launcher、cwd、stdio 入口和 fixture 生成方式；
- DIAGNOSTIC 最多 3 次；第 3 次仍失败就停止复审方法，不进入一修一 FORMAL 循环；
- runner 修正必须先聚焦验证，再重新开始获批的诊断预算；
- FORMAL 只在代码与 runner 冻结提交后运行一次；
- 失败 artifact 全部保留，不覆盖、不筛选；
- 不运行 Electron 矩阵、性能资格化、pack、部署或发行。

### 15.3 FORMAL fixture

从 Starter 创建两个隔离副本，原始 Starter 只读且哈希前后相同：

- Fixture S：stage 纵向路径；
- Fixture A：apply/resume 纵向路径。

两者都只使用项目内已存在、catalog 可发现的背景与立绘；不复制仓库外资产。

### 15.4 FORMAL 创作目标

确定性客户端通过 MCP 工具完成：

1. session/capabilities/project/assets inspect；
2. begin change，写入 intent 与 acceptance criteria；
3. 创建至少两个新场景；
4. 创建/确保一个变量；
5. 创建/确保一个角色；
6. 使用既有背景与立绘建立 timeline 演出；
7. 建立一个包含 A/B 两条路径的 choice；
8. 设置入口场景；
9. 故意使用一个 stale object ref 或确定性无效引用触发红灯；
10. 读取 failure envelope 的 repairActions；
11. 调用指定 inspect/repair 工具修复；
12. validate；
13. simulate 并证明两条规定路径与目标可达；
14. runtime.run-from 正式运行指定入口；
15. runtime.read-trace；
16. change.diff，读取 object diff、potentialImpact、observedImpact；
17. 生成交付胶囊。

### 15.5 stage 断言

- 所有创作只存在于 OPEN working view；
- Fixture S 项目树前后逐字节/规范化哈希一致；
- commit 工具不在 tools/list；直接构造调用也被协议/政策拒绝；
- Port 退出后 OPEN change 仍存在；
- observe resume 可读取 diff/evidence/capsule，不能修改；
- capsule 明确 `projectMutation.occurred=false`。

### 15.6 apply 断言

- 第一进程以 stage 建立并完成同等 OPEN change 后退出；
- 第二进程由受信启动参数选择 apply 并显式 resume 同一 changeId；
- resume 前后 change/working revision 和 operation ledger 连续；
- 不重新 validate 或基线已变化时 commit fail-loud；
- 新鲜门禁满足后 commit 成功一次；
- 重复 commit 不产生第二次写入；
- 项目结果可由普通 Editor/runtime 读取；
- capsule 明确 COMMITTED、before/after revision 与磁盘身份。

### 15.7 FORMAL artifact

artifact 至少包含：

- evidenceClass=`FORMAL`；
- status；
- runHead、contractVersion、engineVersion；
- fixture identity 与原始 Starter identity；
- policy/tool list；
- 每个里程碑、首个失败节点；
- 故意红灯与修复链；
- validation/simulation/runtime/trace/diff/capsule 摘要；
- stage 项目未变证明；
- apply resume/commit 证明；
- stdout/stderr/child cleanup 证明；
- 所有错误通道；
- artifact 路径、bytes、SHA-256。

## 十六、真实外部 Agent 验收

### 16.1 为什么必须单独验收

确定性客户端知道预设工具顺序，只能证明协议可工作。Wave 4 的核心产品主张是“外部 Agent 不读源码也能自行工作”，必须由一个新上下文、真实桌面 Agent 验证。

### 16.2 给外部 Agent 的最小输入

外部 Agent 只能获得：

1. MCP server 启动配置；
2. 一个隔离 Starter fixture 路径；
3. 一段自然语言创作目标；
4. 明确禁止 Shell、直接文件编辑和源码阅读。

不得给它：

- Surdet 源码；
- Wave 4 任务书；
- 工具调用顺序；
- 参数速查表；
- 预先编写的超长专用提示词；
- FORMAL runner 代码。

### 16.3 外部 Agent 的目标

目标与 FORMAL 的内容规模相当，但台词与具体结构可由 Agent 自行决定。它必须：

- 先发现 session 与能力；
- 在 stage 完成至少两场景、一变量、一角色、一个既有资源 timeline、一个双分支 choice 和入口配置；
- 遇到至少一个自然产生或验收者注入的确定性错误，并根据 Port 修复；
- 完成 validate/simulate/runtime/trace/diff；
- 输出胶囊身份和简短人类摘要；
- 不调用 Shell、不直接编辑文件、不读取源码；
- 不修改真实项目。

如果 Agent 只有在获得额外 Surdet 专用说明后才能继续，应把缺失信息视为 registry/schema/repair contract 缺陷，而不是把说明永久塞进验收提示词。

### 16.4 apply 验收

stage 结果经项目所有者或总经理确认后：

1. 停止 stage Port；
2. 由项目所有者明确授权在隔离 fixture 上启动 apply 并 resume；
3. 可以让同一或新的外部 Agent 读取 session/capsule；
4. Agent 重新确认新鲜门禁并 commit；
5. 回读磁盘、project revision 与胶囊。

这只证明 fixture 内的全自动能力，不自动授权对真实创作项目 apply。

## 十七、项目所有者人工验收

FORMAL、Architect 和独立审核通过后，必须主动提醒项目所有者完成以下真实路径：

1. 用现有 Surdet Editor 打开外部 Agent apply 后的隔离 fixture；
2. 检查入口场景、场景列表、变量、角色与 timeline 均是普通可编辑对象；
3. 从场景块选择对象，确认因果面板能显示直接引用、直接被引用、potentialImpact 与 observedImpact；
4. 从演出/因果轨迹反向跳回对应块；
5. 预览从新入口开始；
6. 真实看到既有背景与立绘演出；
7. 分别走 A/B 两条 choice 路径并确认结果；
8. 保存、刷新、重新打开项目；
9. 确认对象和结果仍存在且没有异常脏标记；
10. 确认原始 Starter 未修改。

项目所有者只需报告第一个异常，或明确“人工路径全部通过”。视觉、操作手感和创作结果是否可接受，以项目所有者判断为准。

任务书必须把这一步登记为强制提醒点：在自动化/审核完成后主动邀请，不能因 FORMAL 全绿而省略。

## 十八、实现范围指导（非施工授权）

### 18.1 预计修改面

未来任务书可在核对真实源码后，从以下范围形成精确白名单：

- `packages/authoring/src/`：registry、合同/error/repair/envelope/change intent 的最小公共实现；
- `packages/authoring/test/`：registry 与协议无关合同测试；
- `packages/cli/src/authoring/`：让现有 service/command 消费 registry，补只读 project snapshot validate/simulate；
- `packages/cli/src/agent-port/`：session、policy、MCP tool projection、stdio server、invocation ledger、delivery capsule；
- `packages/cli/test/`：Port/CLI 合同与安全边界；
- `packages/cli/e2e/` 或等价 CLI 内测试目录：真实 stdio MCP 纵向 runner；
- `packages/cli/package.json` 与 lockfile：第二 bin、经核验的官方 MCP SDK；
- 根级最小 script（仅在真实运行入口需要时）；
- Wave 4 任务书与交付报告。

具体文件名必须由实施前源码核对决定。本设计不授权“预计范围”内的任何修改。

### 18.2 默认禁止修改

- `packages/core/`
- `packages/renderer/`
- `packages/host/`
- `packages/shell/` 生产逻辑与 Electron E2E
- `packages/editor/` 产品代码
- `examples/starter/` 内容、配置、资产与运行时
- `games/zero-after-midnight/` 或等价 Zero 项目
- 存档 schema
- 受保护文件
- 长期路线台账的 Git 跟踪状态

如果真实实现证明某个禁止层是必要依赖，执行 AI 必须停下，请总经理修订任务书；不得自行扩大白名单。

### 18.3 依赖纪律

- 只新增官方 MCP SDK 这一项被当前能力直接需要的依赖；
- 先检查现有 JSON schema/validation 依赖，禁止重复引入同类库；
- 不新增 DI 容器、框架式 command bus、数据库或守护进程；
- 不为未来市场、多项目或远程 Agent 预建抽象。

## 十九、验证强度与 Git 治理

### 19.1 与风险匹配的命令面

未来实施至少需要：

- authoring 聚焦测试、typecheck、build；
- CLI 聚焦/完整测试、typecheck、build；
- package boundary / dependency 检查；
- runner `node --check`；
- 真实 stdio preflight/DIAGNOSTIC/FORMAL；
- 原始 Starter 未变检查；
- `git diff --check` 与 tracked log 检查。

由于这是新的公开本地协议面并改动共享 registry，聚焦验证全部通过、代码冻结后允许一次 `verify:all` 作为最终仓库门禁；不得用它替代聚焦红灯，也不得循环运行。无需性能、Electron、pack 或发行矩阵。

### 19.2 提交策略

实施任务书应要求：

1. 最小红灯/共享实现/Port 基础设施可以按可复审边界形成普通本地提交；
2. FORMAL 前存在一个明确 `CODE_EVIDENCE_HEAD`，包含最终生产代码、测试和冻结 runner；
3. FORMAL artifact 的 runHead 必须等于该 HEAD；
4. 之后只允许任务书/交付报告形成文档闭合提交；
5. 所有提交停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`；
6. 未经项目所有者明确授权不得 push；
7. 不 amend、squash、rebase、force push 或清理失败证据。

### 19.3 审核分工

- 日常 Architect：检查共享合同、MCP 薄适配、权限/错误/版本边界，没有第二套 authoring；
- 小衡：独立核对 HEAD/diff/工作树、反向权限测试、artifact 身份、stage 未写项目、apply commit 原子性与残留进程；
- 总经理：裁决是否达到 Agent 友好目标、是否邀请人工验收、是否允许进入 push 门；
- 项目所有者：真实外部 Agent/Editor/预览体验，以及 push、部署、发行的最终授权。

## 二十、风险与对应控制

### 风险 1：MCP 壳与原生合同漂移

控制：唯一 registry、机械投影、原生/MCP 等价性合同；禁止手写第二份工具清单。

### 风险 2：Agent 能发现工具但仍不会修错

控制：retryDisposition、repairActions、最小合法示例、真实错误修复验收；不能靠追加隐藏提示词掩盖合同缺口。

### 风险 3：stage 名义隔离但实际触碰项目

控制：项目树前后磁盘身份、Port policy 反向测试、change store 位于项目外、commit 工具不注册。

### 风险 4：apply 变成绕过项目所有者的自动写入

控制：policy 由启动者固定；stage→apply 必须结束进程并显式 resume；仅在隔离 fixture 验收；真实项目 apply 仍需单独授权。

### 风险 5：adapter 逐渐复制业务逻辑

控制：组件依赖测试、原生结果等价性、Architect 逐文件审查；任何解析/patch/validate/runtime 分支都应回到共享 service。

### 风险 6：FORMAL runner 进入一修一跑循环

控制：同 launcher preflight、有界三次 DIAGNOSTIC、冻结提交后唯一 FORMAL、失败 artifact 全保留。

### 风险 7：把确定性客户端通过误写成真实 Agent 可用

控制：独立的低上下文外部 Agent 验收；不提供源码、任务书或调用顺序；产品失败回流合同设计。

### 风险 8：证据和项目内容泄露到无界日志

控制：invocation ledger 只存身份、哈希、revision、错误与摘要；不记录模型完整对话或无界项目文本。

### 风险 9：并行 change 静默覆盖

控制：不做自动 merge/replay；commit 严格检查 base revision；stale 强制 new change。

## 二十一、被否决或延期的替代方案

### 21.1 MCP-only 领域模型

否决。它会让协议形态反向控制 authoring，产生与 CLI/Editor 漂移的第二套真相。

### 21.2 万能 `surdet_call`

否决。schema 巨大、权限不透明、客户端难以生成参数，也难对单项副作用和错误建立合同。

### 21.3 多项目常驻 server

延期。首版没有必须跨项目批处理的真实需求，却会显著扩大路径、ownership、缓存与并发风险。

### 21.4 stage-only

否决。它能安全提案但不能证明 Surdet 的全自动创作梦想；P1 已用受信启动策略保留 apply，同时不授予 Git/Shell。

### 21.5 apply-only

否决。项目所有者失去隔离审查门，也无法安全验证陌生 Agent。

### 21.6 Wave 4 同时做资产导入或全项目审计

延期。两者都有价值，但会把协议、权限、二进制事务或新算法混入同一纵向切片。先证明现有二十项能力能被 Agent 可靠使用。

### 21.7 Editor 内置 AI

否决。它与外部电脑端 Agent 目标相反，会绑定模型、UI 和提示词，削弱 Surdet 作为通用 AI 友好创作基础设施的独特性。

### 21.8 自动 Git 与 push

否决。Port 的“项目提交”仅指共享 `change.commit` 写回 Surdet 项目，不是 Git commit。Git 与远端继续由项目所有者治理。

## 二十二、未来演进但不属于 Wave 4

在本 Wave 真实通过后，未来候选包括：

- 全项目因果/可达性/孤立对象审计；
- 受控资产导入、哈希与二进制事务；
- 更丰富的 Editor Agent 交付胶囊可视化；
- 扩展市场的签名、权限和可复现安装合同；
- 多项目批处理或显式协作协议；
- 已发布 Agent contract 的兼容策略。

这些方向必须由新的真实痛点和任务书授权，不能提前塞入首版。

## 二十三、规格验收清单

项目所有者文件级复核时，只需确认以下产品裁决是否符合意图：

- [ ] Surdet 的优势是“对外部 Agent 友好”，不是“内部塞一个 AI”；
- [ ] 原生 authoring 合同是唯一真相，MCP 为本地 stdio 薄适配；
- [ ] 一个进程只绑定一个项目；
- [ ] observe/stage/apply 由启动者固定，Agent 不可提升；
- [ ] 每项能力是独立类型化工具；
- [ ] Wave 4 只打通 Wave 1～3 现有能力；
- [ ] stage 能完整交付但不写项目；
- [ ] apply 必须显式重启/resume 且通过新鲜门禁；
- [ ] 错误提供确定性修复，不替 Agent 做创作判断；
- [ ] 交付胶囊来自真实 change/diff/validation/simulation/runtime 证据；
- [ ] FORMAL 使用确定性 MCP 客户端，真实外部 Agent 与人工 Editor 验收另行执行；
- [ ] 无 Shell、Git、网络、任意路径、内嵌模型、资产导入、市场、音频或 Wave 5 夹带；
- [ ] 完成实现后仍先本地提交、独立复审、人工验收，push 需项目所有者另行授权。

## 二十四、当前停止点

本规格完成后，状态应为：

```text
WAVE_4_AGENT_PORT_DIRECTION_APPROVED
A1_NATIVE_CONTRACT_WITH_MCP_THIN_ADAPTER
A1_1_ONE_PROCESS_ONE_PROJECT
P1_OBSERVE_STAGE_APPLY
T1_TYPED_TOOL_PER_CAPABILITY
S1_EXISTING_AUTHORING_CAPABILITIES_ONLY
DESIGN_SPEC_COMPLETED
WAITING_FOR_OWNER_FILE_LEVEL_REVIEW
IMPLEMENTATION_TASKBOOK_NOT_CREATED
WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED
FORMAL_NOT_STARTED
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_WAVE_4_DESIGN
WAVE_5_NOT_STARTED
```

项目所有者明确批准本规格后，总经理的唯一下一步是调用 writing-plans 方法，把本设计转为可直接交给 Architect 与执行 AI 的详细总任务书。该批准仍不等同于任务书施工授权；总任务书完成后应再由项目所有者明确批准，执行 AI 才能开始 Task 0。
