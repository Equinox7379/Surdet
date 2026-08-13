# Surdet Stage 6 Wave 1 外部 Agent 友好创作纵向切片设计规格

> 状态：完整设计已由项目所有者逐节批准；本文等待项目所有者进行最终文件复核。
>
> 日期：2026-08-13
>
> 设计阶段：Stage 6 Wave 1 — Agent-Ready Authoring Vertical Slice
>
> 实现状态：尚未开始。本文不授权执行 AI 修改生产代码、push、部署、打包或进入 Wave 2。

## 1. 结论

Surdet 的下一阶段不是内置 AI、编辑器换皮或复刻参考产品，而是建立一条外部桌面 Agent 与人类作者共同使用的可靠创作主干：

```text
外部 Agent 负责理解、规划与编排
Surdet 负责发现、读取、类型化修改、验证、运行与提供证据
人类编辑器负责可见创作、因果理解、人工接管与最终体验判断
```

Stage 6 Wave 1 将新增单一 `@surdet/authoring` 共享创作内核，通过结构化 CLI/JSON 向外部 Agent 提供 14 项最小能力，并由现有编辑器接入同一项目快照、对象身份和运行轨迹。首轮用 Starter 的隔离副本证明：外部 Agent 可以安全制作、验证和提交一个双分支可玩短章，人类随后可以在编辑器中理解、预览、修改、保存并重新打开该成果。

该设计的核心差异化不是“编辑器里有 AI”，而是：

> Surdet 让任何合适的电脑端 Agent 在可发现、可隔离、可验证、可回滚、可由人类接管的公共创作契约上工作，并能把创作对象、状态变化和正式运行结果串成双向因果证据。

## 2. 背景与设计依据

Stage 5 已由项目所有者在真实 Chrome/Edge 中验证现有编辑器的最小创作闭环：

```text
编辑台词 → 真实预览可见 → 保存 → 刷新并重开 → 修改仍存在
```

Stage 5 同时留下两个 `model-roundtrip.test.ts` 混合 LF/CRLF 逐字节往返失败。该红灯在 Stage 5 不影响已完成的人工闭环，也不应被擅自扩展为当轮修复；但在 Stage 6 Wave 1 中，它直接关系到类型化修改是否会制造无意义全文件差异，因此成为本轮无损写入的相关前置条件。

项目所有者还明确了长期产品方向：

- 借鉴成熟产品已经验证过的工作流与信息架构，但不复制其代码、品牌、资产或产品外形；
- Surdet 必须形成自己的优势，成功标准不是追平某个参考产品的功能数量；
- 产品北极星是“创作对象 ↔ 正式运行 ↔ 因果状态/影响”的双向因果创作台；
- Surdet 最初的 AI 目标是让电脑端 Agent 使用引擎制作游戏，而不是在引擎内部嵌入模型、聊天页或 AI 工作区；
- 外部 Agent、人类编辑器和结构化 CLI 必须共享创作真相，不能存在 Agent 专属项目格式或第二套编辑器状态机；
- 音频生产、性能资格化、发行、Legacy 清理和文档大治理不进入本轮。

## 3. 目标

Stage 6 Wave 1 必须实现以下结果：

1. 外部 Agent 可以先查询 Surdet 当前支持的能力和输入合同，不需要阅读源码或猜测参数。
2. Agent 可以读取项目摘要、精确对象及引用关系。
3. 所有 Agent 写操作默认进入 Surdet 原生隔离事务，正式提交前不修改项目文件。
4. Agent 使用类型化操作创建场景、台词、选择、变量、条件和跳转，不使用任意文本搜索替换。
5. Surdet 返回稳定、结构化、可操作的错误，Agent 可以从一次真实红灯修正到绿灯。
6. 校验、模拟和正式运行证据绑定准确的引擎、项目和事务修订。
7. `change.diff` 同时提供人类摘要、结构化语义差异和原始文件差异。
8. 多文件提交检查磁盘冲突并具备失败恢复，不留下只提交一部分的项目。
9. 人类编辑器使用共享项目快照和对象身份，提供最小双向因果选择。
10. 项目所有者可以在桌面隔离 fixture 中真实预览、修改、保存并重新打开 Agent 成果。

## 4. 非目标

Stage 6 Wave 1 明确不实现：

- 内置模型、聊天窗口、提示词编辑器或 Agent 会话 UI；
- MCP server、远端 Agent 服务、云同步或多人实时协作；
- 扩展市场、插件商店或通用第三方插件 SDK；
- 万能对象 CRUD、任意文件写入、任意命令执行或任意文本 patch；
- 新素材生成、音乐生产、音频质量判断或自动审美评分；
- Gallery、大系统、完整时间轴或所有项目配置的可视化创作；
- 截图像素回归矩阵、性能资格化、多轮 Electron 矩阵；
- 自动 Git 暂存、提交、建分支、push、rebase、打包、部署或发行；
- 修改《零点之后》、原始 Starter 或用户正式游戏项目；
- 解决浏览器编辑器中未保存缓冲区与外部 Agent 同时编辑同一项目的实时协作问题。

## 5. 产品原则

### 5.1 外部 Agent，而非内置 AI

自然语言理解、任务分解、内容创作和修正策略属于外部桌面 Agent。Surdet 只提供可靠的确定性能力，不选择模型、不保存聊天人格，也不把模型依赖引入运行时或编辑器。

### 5.2 人类可接管

Agent 创建的结果仍是正常的 `.gal` 与项目 JSON。人类可以不用 Agent，直接用编辑器或文本工具读取、修改、保存和运行。任何 Agent 专属元数据都不得成为项目运行的必要条件。

### 5.3 正式运行证据优先

静态通过不等于路径可玩，Core 发出事件不等于 Presentation 已应用，Presentation 已应用不等于项目所有者认可真实画面。证据必须明确区分这些层次。

### 5.4 最小长期正确实现

首轮新增一个真实存在 CLI 与 editor 两个消费者的共享包，不提前拆协议、事务、证据、SDK 或 MCP 包；不保留无必要的兼容路径，不增加没有当前调用方的配置层。

### 5.5 失败必须诚实

引用过期、目标不唯一、项目冲突、模拟未完成或运行超时时必须失败或标记不完整。不得模糊定位、静默合并、部分成功后冒充完成，也不得用下一次成功覆盖失败证据。

## 6. 系统分层与依赖方向

系统分为五层：

```text
1. 使用者与编排者
   - 项目所有者
   - 外部桌面 Agent

2. 入口适配
   - @surdet/cli 的 Node/JSON 入口
   - @surdet/editor 的人类工作台入口

3. 共享创作内核
   - @surdet/authoring

4. 正式引擎语义与演出
   - @surdet/core
   - @surdet/renderer
   - @surdet/host
   - @surdet/shell

5. 项目文件与本机事务证据
   - 正常 Surdet 项目文件
   - 项目目录外的本机事务/证据目录
```

依赖方向固定为：

```text
CLI ─┐
     ├→ authoring → core
editor┘

renderer/host/shell → core
正式运行证据适配器观察 core 与 presentation 事实
core 不依赖 authoring、CLI、editor 或 Agent
```

## 7. `@surdet/authoring` 组件

### 7.1 Project Snapshot

负责读取项目、保存源文件身份与换行风格、计算项目修订，并向其他组件提供统一只读模型。它通过 `ProjectStorage` 接口访问平台文件，不直接调用 Node `fs`、浏览器目录选择、localStorage、Electron IPC 或 Git。

最小存储职责包括：

```text
read(path)
list(path)
exists(path)
stageWrite(path, content)
replace(path, stagedContent)
```

Node CLI、浏览器编辑器和测试分别提供 Node、File System Access 和内存适配器。

### 7.2 Object Index

负责索引场景、标签、台词、选择、选择项、变量、时间轴和素材引用；生成语义身份和修订期对象引用；支持项目/对象查询；建立文件位置、编译指令与运行轨迹之间的映射。

### 7.3 Change Session

负责 `baseRevision`、`workingRevision`、`operationId`、隔离工作版本、状态转换、磁盘冲突检查和提交恢复。它不决定某种 DSL 对象如何修改。

首轮状态机只有：

```text
OPEN → COMMITTED
OPEN → ROLLED_BACK
OPEN → STALE
```

### 7.4 Authoring Operations

负责类型化创作操作。Stage 6 Wave 1 只支持完成短章所需的子集：

- 创建场景；
- 替换或插入台词；
- 插入标签与基础演出指令；
- 插入一个选择并修改选择项；
- 为选择项加入变量变化和跳转；
- 插入条件、场景跳转和结束；
- 声明或幂等确认变量。

不提供任意文件路径或任意文本补丁。

### 7.5 Validation and Simulation

复用现有 Core lint、CLI 跨场景/配置/素材检查和 Interpreter 模拟能力，把结果绑定对象引用、项目修订、事务与统一证据信封。不得重新实现第二套 lint 或 Interpreter。

### 7.6 Diff and Evidence

负责三层差异、证据身份、运行轨迹索引和双向查询。它只报告事实与清晰标注的推断，不判断剧情质量、视觉美感或玩家手感。

## 8. 最小 Agent Capability Contract

Stage 6 Wave 1 固定 14 项能力。能力名表达稳定语义，不要求内部必须存在 14 个独立模块。

### 8.1 发现与读取

#### `capabilities.describe`

返回引擎/schema 版本、对象类型、支持的 patch 操作、输入合同、是否需要事务、错误代码与明确不支持范围。

#### `project.inspect`

返回项目身份、修订、入口场景、场景与变量摘要、可用素材键、配置/场景错误摘要、对象数量和引用概况。默认使用摘要模式，不把整个项目一次性输出。

#### `object.inspect`

读取单个对象、局部结构、直接依赖和直接影响，并返回合法对象引用。外部 Agent 不自行拼接匿名对象引用。

### 8.2 隔离创作

#### `change.begin`

读取真实项目内容身份并建立隔离工作版本，返回 `changeId`、`baseRevision` 和初始 `workingRevision`。

#### `scene.create`

根据合法场景 ID创建规范场景；拒绝重复 ID和路径逃逸；保存原有项目格式约定并返回新对象引用。

#### `scene.patch`

只接受类型化操作、精确 `objectRef`、基础修订、原内容指纹和 `operationId`。目标缺失、不唯一、过期或不符合前置条件时失败。

#### `variable.ensure`

变量不存在时按明确类型和初始值声明；相同合同已存在时幂等成功；同名但合同冲突时失败，不静默改类型。

### 8.3 校验与运行证据

#### `project.validate`

校验指定 `changeId` 与 `workingRevision`。提交要求同一最新修订的新鲜校验且 error 为零，warning 必须保留。

#### `project.simulate`

遍历选择分支，记录覆盖、状态结果、场景出口、死路、错误和快照往返。预算或超时只能返回不完整，不能冒充通过。

#### `runtime.runFrom`

从场景、标签或对象附近启动确定性正式运行路径；调用方明确提供选择输入与必要初始变量；记录 Core 与 Presentation 证据。

#### `runtime.readTrace`

按对象、场景、变量、选择、演出效果和错误查询轨迹；支持创作对象到运行结果以及运行结果到来源/条件的反向定位。

### 8.4 复核与交付

#### `change.diff`

返回人类摘要、结构化语义差异和原始文件差异，并显式报告异常格式变化。

#### `change.commit`

重新核对相关磁盘文件、校验身份与提交条件，完成多文件安全替换。它只应用 Surdet 项目修改，不执行任何 Git 操作。

#### `change.rollback`

丢弃尚未提交的隔离工作版本，不覆盖真实项目文件。

## 9. 对象身份

### 9.1 命名对象

场景、标签、变量、时间轴和素材使用人类可读的长期语义身份，例如：

```text
scene:prologue
label:prologue.after_choice
variable:trust
timeline:intro
asset:bg/classroom
```

### 9.2 匿名对象

台词、选择项和匿名指令使用只在当前项目修订或事务内有效的精确引用，例如：

```text
scene:prologue/block:12@a81f
scene:prologue/choice:3/option:2@74cd
```

匿名引用由 `object.inspect` 返回，Agent 不自行猜测。修改成功后 Surdet 返回新的工作修订与引用；事务提交后需要继续操作时必须重新读取。

### 9.3 明确拒绝的方案

- 不在每条 `.gal` 内容中写永久 UUID；
- 不建立容易与文本漂移的永久旁路身份索引；
- 不使用模糊文本匹配、静默重定位或“尽量修改”；
- 不把行号本身当成跨修订永久身份。

## 10. 原生隔离事务

### 10.1 隔离不变量

`change.begin` 后，所有写操作只作用于项目外的隔离工作版本。`change.commit` 成功前，真实项目文件身份必须保持不变。

### 10.2 幂等操作

每个写请求携带 `operationId`。完全相同的重试返回原结果；同一 `operationId` 对应不同负载时返回 `OPERATION_ID_CONFLICT`。单次操作失败不得部分修改工作版本或推进 `workingRevision`。

### 10.3 新鲜校验

校验结果绑定准确 `workingRevision`。校验后发生任何修改，旧校验自动过期。所有提交至少需要当前修订的校验零 error。

### 10.4 冲突检测

提交前重新读取本轮涉及的磁盘文件。如果与事务基线不同：

```text
PROJECT_CHANGED_SINCE_BEGIN
COMMIT_REJECTED
NO_PROJECT_FILES_WRITTEN
```

事务变为 `STALE`。首轮不自动合并或 rebase；Agent 可读取差异，然后回滚并基于最新项目重新开始。

### 10.5 多文件提交

提交顺序为：

```text
重新核对磁盘基线
→ 写同目录临时文件
→ 回读并校验临时文件
→ 建立短期恢复 journal
→ 替换目标文件
→ 回读最终身份
→ 成功后完成事务
```

若替换失败且恢复成功，返回 `COMMIT_FAILED_RECOVERED`；若恢复失败，返回 `COMMIT_RECOVERY_FAILED`，立即停止写入并保留 journal、文件身份和失败证据等待人工复审。

### 10.6 Git 边界

`change.commit` 不等于 Git commit。Surdet 不自动暂存、提交、建分支、push、rebase、squash 或修改历史。Git 行为由外部 Agent 或人类根据项目治理另行执行。

## 11. 三层差异

`change.diff` 必须同时返回：

1. 人类摘要：新增/修改对象数量、受影响入口和警告；
2. 结构化语义差异：修改类型、前后对象、操作身份、引用与直接效果；
3. 原始文件差异：供人类、Git 和格式审查。

影响必须区分：

- `directChange`：实际修改的确定事实；
- `potentialImpact`：引用图与静态控制流推断；
- `observedImpact`：模拟或正式运行真实观察结果。

任何意外整文件换行变化必须显式报告，不能被人类摘要掩盖。

## 12. 统一结构化因果证据

### 12.1 四级证据

#### 静态校验

证明语法、类型、引用、配置和结构是否有效，不证明路径已经运行或画面已显示。

#### Core 模拟

证明解释器路径、选择覆盖、状态结果、死路和运行错误，不证明 Renderer 已应用演出。

#### 正式运行与 Presentation 应用

记录输入、位置、台词、选择、状态差异、条件、跳转、基础演出与错误；明确区分：

```text
CORE_EMITTED
PRESENTATION_APPLIED
```

`PRESENTATION_APPLIED` 仍不等于项目所有者已经亲眼确认或认可视觉效果。

#### 项目所有者观察

只有项目所有者或其明确委托的人工验收可以记录 `HUMAN_OBSERVED_BY_OWNER`。自动化只能产生清晰的人工提醒，不得代填。

### 12.2 统一证据信封

每份差异、校验、模拟和运行证据绑定：

```text
schemaVersion
evidenceId
capability
status
engineIdentity/version/gitHead
projectRevision
changeId
workingRevision
createdAt
artifact path/bytes/sha256
```

每次运行生成独立证据身份。失败轨迹不得被下一次成功覆盖，必须保留最后成功节点与第一失败节点。

### 12.3 双向查询

`runtime.readTrace` 必须支持：

- 从台词/选择/变量等对象追踪运行结果；
- 从可见文本、变量结果、跳转或演出状态反查源对象；
- 返回成立条件、输入选择和最近状态来源；
- 在编辑器中使对象选择过滤轨迹、轨迹选择定位对象。

## 13. 本机事务与证据存储

跨进程 CLI 调用需要持久事务状态。首轮使用项目目录外的 Surdet 本机应用数据目录和普通文件：

```text
Surdet 本机数据目录
└─ agent-changes
   └─ <project-identity>
      └─ <changeId>
         ├─ transaction.json
         ├─ working-files
         ├─ diff.json
         └─ traces
```

该目录不属于游戏项目，不进入 Git，不承担项目运行或永久对象身份。首轮不引入数据库、云端存储或复杂保留策略。

## 14. CLI 与 JSON 合同

### 14.1 统一成功信封

```json
{
  "schemaVersion": 1,
  "capability": "scene.patch",
  "ok": true,
  "operationId": "op-add-choice",
  "projectRevision": "...",
  "changeId": "chg_...",
  "workingRevision": 4,
  "result": {}
}
```

### 14.2 统一失败信封

```json
{
  "schemaVersion": 1,
  "capability": "scene.patch",
  "ok": false,
  "operationId": "op-add-choice",
  "projectRevision": "...",
  "changeId": "chg_...",
  "workingRevision": 3,
  "error": {
    "code": "OBJECT_REF_STALE",
    "category": "conflict",
    "message": "目标对象来自旧的工作修订",
    "retriable": true,
    "action": "重新调用 object.inspect，并使用返回的新 objectRef",
    "objectRef": "scene:prologue/block:12@a81f"
  }
}
```

### 14.3 输出纪律

`--json` 标准输出只能包含一个完整 JSON 结果，不混入进度条、彩色文字、欢迎语或 npm 日志。人类调试信息使用标准错误；默认错误不输出大段内部堆栈。

### 14.4 首轮错误代码

```text
CAPABILITY_UNAVAILABLE
INVALID_REQUEST
UNSUPPORTED_OBJECT_KIND
UNSUPPORTED_OPERATION
PROJECT_NOT_FOUND
PROJECT_INVALID
PATH_OUTSIDE_PROJECT
OBJECT_NOT_FOUND
OBJECT_AMBIGUOUS
OBJECT_REF_STALE
OBJECT_PRECONDITION_FAILED
CHANGE_NOT_FOUND
CHANGE_NOT_OPEN
OPERATION_ID_CONFLICT
PROJECT_CHANGED_SINCE_BEGIN
VALIDATION_REQUIRED
VALIDATION_STALE
VALIDATION_FAILED
SIMULATION_INCOMPLETE
RUNTIME_FAILED
RUNTIME_TIMED_OUT
COMMIT_FAILED_RECOVERED
COMMIT_RECOVERY_FAILED
```

错误代码属于机器合同，不能随意更名；说明与修复提示可以在不改变语义的前提下改善。

## 15. 编辑器最小因果桥

Stage 6 Wave 1 不整体推翻现有 editor。必须保留 Stage 5 已验证的编辑、预览、保存与重开路径，并接入：

1. 共享 Project Snapshot 与 Object Index；
2. 紧凑、可折叠的最小因果检查区；
3. 创作对象选择过滤当前预览轨迹；
4. 预览轨迹事件反向定位对应创作对象。

因果检查只显示当前对象的直接信息：引用、被引用、变量/跳转可能影响、当前预览是否经过、运行时观察结果。首轮不绘制巨大项目因果图，不增加 AI 对话侧栏，不移除原始文本编辑。

## 16. 首个真实短章纵向场景

外部桌面 Agent 在 Starter 的全新隔离副本中，通过正式能力完成：

- 至少两个场景；
- 一个包含两个选项的选择；
- 一个明确声明并实际改变的变量；
- 两条选择路径产生不同状态结果和不同后续台词；
- 路径最终汇合或明确结束；
- 使用已有背景/立绘，不生产新素材；
- 一次故意的不存在标签红灯，并由 Agent 使用正式能力修正；
- 校验零 error；
- 模拟选择覆盖 `2/2`；
- 正式运行记录两条路径的独立 trace；
- 三层差异只包含预期对象与文件；
- 原子提交后由编辑器和项目所有者接管。

Agent 不得直接读取后修改项目文件。红灯和修正发生在隔离事务中，红灯期间项目文件身份保持不变。

## 17. 路径安全与确定性

### 17.1 路径安全

- 所有项目路径解析并限制在真实项目根目录；
- 拒绝绝对子路径、`..`、符号链接或目录联接逃逸；
- `scene.create` 只生成规范场景路径；
- `variable.ensure` 只修改正式变量配置；
- `scene.patch` 只修改对象索引识别的场景；
- 首轮不提供任意删除、移动或执行命令能力。

### 17.2 确定性

- 选择输入由调用方显式指定；
- 初始变量包含在运行请求；
- 随机行为必须指定并记录种子，首个短章不依赖随机；
- 时间戳不参与项目修订或语义结果；
- 文件遍历、差异和证据顺序稳定；
- 相同项目、事务修订、输入和引擎身份产生等价结果。

## 18. 换行与无损写入前置条件

Stage 5 的两个混合 LF/CRLF roundtrip 红灯必须在 authoring 写入启用前被重新建立并在正确共享层最小修复：

```text
确认 parse → serialize 的换行变化
→ 保留每个文件的原始 EOL 契约
→ 证明只修改目标对象时无关行与格式不变化
→ 再允许 scene.patch 进入 commit
```

禁止批量归一化用户文件、放宽逐字节断言、隐藏格式变化或把全文件换行变化包装成单对象修改。

## 19. 验证策略

### 19.1 Authoring 单元测试

覆盖项目修订、对象身份、过期/歧义引用、操作幂等、类型化 patch、EOL 保持、三层差异、影响分类与事务状态机。

### 19.2 JSON 合同测试

覆盖 14 项能力的成功/错误信封、schema、必填字段、稳定错误代码、无噪声 stdout、CLI 退出码，以及 `capabilities.describe` 与实现一致性。

### 19.3 事务故障注入

在临时 fixture 验证提交前不写盘、rollback 不改变项目、磁盘冲突拒绝、分阶段写入失败恢复、恢复失败停止与 journal 保留。

### 19.4 外部 Agent 红灯到绿灯路径

使用真实外部桌面 Agent完成能力发现、项目读取、事务建立、故意错误、结构化修正、校验、模拟、轨迹、差异和提交。

### 19.5 正式运行 harness

只运行一个聚合 harness，一次覆盖双分支，生成两个 traceId，记录 Core、Presentation、错误通道和 artifact 身份。失败时不循环重跑，保留 artifact 并报告最后成功/第一失败节点。

### 19.6 工作区与全仓验证

施工中运行受影响 workspace 的聚焦测试、typecheck 和 build。整合完成后新鲜运行一次 `verify:all`；不追加性能资格化、多轮 Electron、pack 或发行。失败按相关性记录，Stage 6 直接相关的 EOL 红灯不得忽略。

## 20. 项目所有者人工验收

独立经理复审通过后，在桌面创建易选择的隔离 fixture，例如：

```text
<local-path><timestamp>
```

项目所有者使用真实 Chrome/Edge：

1. 打开编辑器并选择桌面 fixture；
2. 确认 Agent 创建的两个场景出现；
3. 确认 `.gal` 内容正常可读且没有 UUID 噪声；
4. 选择台词与选择项，查看直接因果信息；
5. 运行路径 A，并从轨迹反向定位对象；
6. 运行路径 B，确认不同后续文本；
7. 手工修改一句 Agent 创建的台词；
8. 预览、保存、刷新并重开；
9. 确认修改仍存在且没有脏标记；
10. 由项目所有者判断内容可见性、操作清晰度、因果信息可理解性与整体使用意愿。

项目所有者不需要检查内部 JSON、哈希或测试日志。自动化不能代填人工结果。

## 21. 实施治理与停止点

详细实施计划应按以下顺序展开：

```text
Task 0：读取准则、路线、规格和任务书，核对 Git 基线
Task 1：建立 EOL 与能力合同相关红灯
Task 2：实现最小共享创作内核
Task 3：打通 CLI 与隔离事务
Task 4：打通校验、模拟、差异和运行证据
Task 5：接入编辑器最小双向因果桥
Task 6：聚焦验证、一次纵向 harness、报告和本地提交
Task 7：停止等待独立经理复审
```

执行 AI 完成本地施工和提交后必须停止在：

```text
STAGE_6_WAVE_1_IMPLEMENTED_LOCALLY
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_6_WAVE_1
STAGE_6_WAVE_2_NOT_STARTED
```

复审通过后才能邀请项目所有者人工验收。即使验收通过，也不自动 push、进入 Wave 2、建立扩展市场、启动音频、修改《零点之后》、打包或发行。

## 22. 被拒绝的主要替代方案

### 22.1 每个对象写永久 UUID

拒绝原因：污染人类剧本、复制粘贴容易冲突、制造无意义 diff，并把项目绑定内部编辑器格式。

### 22.2 永久旁路对象索引

拒绝原因：普通文本编辑后容易漂移，需要同步、修复和迁移机制，首轮复杂度不成立。

### 22.3 Git worktree 作为 Surdet 事务

拒绝原因：项目不一定使用 Git；Git 不理解创作对象与运行证据；会把引擎事务和版本治理混为一层。

### 22.4 直接写盘后依赖备份或撤销

拒绝原因：Agent 中断时会留下半成品，多文件操作可能部分成功，无法可靠保护真实项目。

### 22.5 把 authoring 能力塞进 Core

拒绝原因：文件系统、事务、artifact 和 Agent 协议会污染正式运行核心及跨平台边界。

### 22.6 CLI 与 editor 各建一套

拒绝原因：对象、校验、预览和保存语义会漂移，破坏人类与 Agent 共享创作真相。

### 22.7 先全面重构编辑器外壳

拒绝原因：视觉变化不能证明 Agent 创作主干成立，会延迟首个可玩端到端结果。

### 22.8 先建完整平台、MCP 或扩展市场

拒绝原因：没有当前纵向切片的真实需要，属于预防性抽象和范围膨胀。

### 22.9 日志、截图或测试绿灯作为唯一证据

拒绝原因：无法解释因果，也不能替代正式 Presentation 应用和项目所有者真实观察。

## 23. 设计完成条件

本文没有未决产品选择。以下决定已经由项目所有者批准：

- 外部桌面 Agent 是自动化执行者，Surdet 不内置 AI；
- 双向因果创作台是编辑器北极星；
- 结构化 CLI/JSON 是首个 Agent 入口；
- 14 项最小能力目录；
- 语义身份与修订期对象引用；
- 原生隔离事务；
- 三层差异与四级因果证据；
- 单一 `@surdet/authoring` 共享内核；
- Stage 6 Wave 1 双分支短章纵向切片；
- 相关 EOL 前置修复、分层验证和项目所有者人工验收；
- 本地实现后独立复审、默认不 push、不进入 Wave 2。

项目所有者完成本文文件复核后，下一步是使用 `writing-plans` 流程生成详细 Stage 6 Wave 1 实施任务书。实施任务书仍需明确文件白名单、任务顺序、测试命令、提交范围、artifact 身份和停止条件；在任务书得到批准前不得修改生产代码。
