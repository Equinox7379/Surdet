# Stage 6 Wave 8：候选组合就绪性本地交付

- 施工基线：`47fd2fa07cf6502f74cca19403f3c1a7bc30c741`，`main`。
- 初始实现提交：`8cf275d4d532533fd43eef6c299397f9932bf239`。当前实现终点是包含本文 W8-R2-05 整改的后继提交，父提交为 `b267b11`；精确 SHA 随累计 `WAVE8-R2-REVIEW4.patch` 提供。
- 第三次云端源码复审：前三项修复和 W8-R2-04 均通过，剩余 W8-R2-05 为 `NEEDS_FIX`。本次整改与当前停止点见本文末节；push 仍未授权。
- 本轮依据：Owner 提供的 Wave 8 R2 正式施工包。长期路线台账、AGENTS 与受保护资料保持原样。

## 实现

新 stage 事务固定记录 candidate 身份、已解析基线素材身份和操作事实版本。apply 与旧内部 service 调用创建 direct 事务；恢复时沿用记录中的身份，integration 元数据优先，不因会话 policy 改变而绕过 candidate 检查。

八项可组合内容操作直接使用 handler 已生成并通过原有语法检查的拟结果，保存连续 sequence、原始引用、依赖来源、产物及该次前后指纹。事实、操作结果和 workingFiles 使用同一次 record CAS 持久化。精确重试先返回原结果；`changed:false` 不推进 workingRevision；缺依赖、互引环和 CAS 失败均不推进内存记录、持久化操作或已有证据。

`composition-reference-analysis.ts` 统一场景、选项内联指令、表达式、角色与时间轴素材分析。缺失对象保留在 raw facts 中；本地 goto/loop 和自场景跳转不生成跨单元依赖。赋值右侧、if/elif 和选项 when 都使用 Core 表达式解析器。解析错误保留来源与其他可解析引用，object index 再过滤可展示关系。

`candidate-composition-guard.ts` 只用不可变基线、冻结的已解析素材及更早的真实生产者解析依赖。`composition-unit-graph.ts` 由 guard、readiness 和 candidate comparison 共用；第二条互引边在落盘前拒绝，最终 integration-plan 的既有环检查保留。没有自动重排操作、拆分对象单元、planner 或新增工具。

新 candidate 的 manifest 使用已记录时点事实，继续核验唯一成功 invocation、输入摘要、capability 身份、更早生产者和最终对象/素材；不会用最终文件反推早期事实。候选比较使用最终结果指纹，同时保留完整重放历史，正确处理创建后修改及移除后重建。旧 OPEN 记录不补写历史；已封存 v2 capsule 继续读取。

Authoring Contract 为 **2.3.0**；envelope **1.0.0**、capsule **2.0.0**、manifest **1.0.0**、record format **2** 保持不变。新增三种明确错误及修复提示，session/diff 提供严格的 readiness 投影。readiness 不是最终胶囊或运行证据的通过声明。30 项原生 capability 与 30 个 stage MCP 工具数量保持不变。README 同步说明新行为；现有能力矩阵生成及漂移检查通过，生成器的既有跨层能力数据不受本轮合同版本影响。

## 验证与修复记录

- 写入前 hook 与时点 sequence 的两个用例先失败，修复后通过；覆盖精确重试、无变化操作、失败证据保留和 CAS 内存一致性。
- 时点归属、缺失引用、互引拒绝、本地跳转、角色迁移、入口连续设置、时间轴后续素材及旧记录路径通过。阶段聚焦为 Authoring 15 文件 / 154 项；随后比较层的三个新增红灯修复后，比较、计划、重放和 Review 投影 4 文件 / 62 项通过。
- 真实 Port 在同一 change 内先拒绝缺失 ending，补建后接受原操作；拒绝 A/B 第二条互引边后继续验证、模拟、运行并封装 ready capsule。记录不包含被拒绝的操作，项目字节不变。
- mode/resume、素材冻结、严格输出 schema、旧记录及未知事实版本、胶囊身份和失败 invocation 噪声均已验证。未知事实版本返回可读的 blocked 投影，不再破坏严格输出 schema。
- 真实候选比较验证“创建后修改”与“直接创建”得到相同最终内容；显式选择前者后，计划按该候选的 create/patch 两步重放，dry-run 通过。apply、integration、租约和恢复相邻回归保持通过。
- 旧 MCP/组合/输出合同夹具曾只引用背景名而无物理素材，已补齐夹具中的实际 SVG，未放宽断言。首轮全量因此失败的输出合同测试修复后 3/3 通过。
- 后续一次全量中的既有 stale-plan 纵向用例触及 5 秒测试超时；单独复验耗时 2.171 秒通过。未修改超时或性能门限，也不宣称已定位偶发根因。
- 最终 `npm run verify:all` 完整通过，退出码 0。9 个工作区共 296 个测试文件、2,716 项 Vitest 测试通过，其中 Authoring 346 项、CLI 525 项；类型检查、Starter/正式内容校验模拟及 Editor/Starter/正式项目构建均通过。正式内容既有 speaker 警告和构建 chunk 提示保留，不把它们写成零警告。前两次输出保留在任务目录的 `verify-all.log`、`verify-all-final.log`；最终代码结果为 `verify-all-completed.log`。

## 一次 fresh Agent 资格化

使用全新 Starter 副本与全新 Codex 会话，`gpt-5.6-luna / max`，一次自然创作要求，无人工 follow-up。会话 `01a08bbd-d1f7-7402-be38-4ac70cb42152`，耗时约 664 秒。源码、Shell、通用文件操作、Git、浏览器、其他业务 MCP、历史与子代理工具未接入。

当前客户端仍附带一个仅 Plan 模式可用的 `request_user_input` 定义，本次固定 Default。Owner 已明确接受并要求如实记录此限制。实际没有调用该工具，也没有人工补充输入；这是工具层边界记录，不冒充操作系统级隔离证明。

| 项目 | 实际结果 |
| --- | --- |
| 原始用户输入 / 完成轮次 | 1 / 1 |
| 工具调用 | 101 次 Surdet 业务调用，2 次 MCP 资源发现 |
| 调用错误 | 5 次：2 次提前依赖拒绝、1 次输入 schema、1 次 DSL 语法、1 次过期对象引用；均自行处理 |
| 整份回滚 / 重建 | 0 / 0，始终为同一 change |
| 作品 | 《雨停之前》；5 个新场景、入口、三场景单向链、变量双分支、时间轴与真实基线背景/立绘 |
| 轨迹后修订 | 有；实际读取两路 trace 后继续修改，最终工作版本 21，共 21 项成功内容操作 |
| 最终校验 | fresh，issues 为空 |
| 最终模拟 | fresh / passed，两路 ended，预算未耗尽，无运行错误 |
| 最终运行 | 选择 0 / 1 均 passed / fresh / workingRevision 21，变量分别为 truth / silence |
| Object diff | 最后一次生成于版本 19，最终为 stale；未冒称 fresh，也未由主代理替 Agent 补取。R2 本次资格门要求的新鲜证据为 validation、simulation 和两路 runtime |
| Capsule | ready，无原因或警告；磁盘 payload 身份经既有 store API 核验 |
| Stage 项目 | 41 个文件逐一比对，修改 0、新增 0 |

- change：`chg_0001_576fecda-5cb0-4027-8c3d-7aa74b05b3a3`
- capsule：`fa99bf91-eb45-4350-8a97-200ec938867a`
- capsule artifact SHA：`11d2888b24b933456e57c02e07c14cebffbd35283deafb30921f9b11e9e4a9c6`
- 最终 trace：`trace_1789051460650_f26a48e7-f9bf-44be-8a76-e63350a144a4`、`trace_1789051466217_f2b37ba8-77a8-413a-92cf-4a0377a3277b`。
- 原始会话、工具暴露核对和磁盘核对位于 `D:/CodexTasks/surdet-wave8-r2-20260910/fresh-1/reports/`。客户端已退出，临时认证链接已移除。

该结果证明无需人工救场、无需因依赖顺序重建整个候选；不宣称零调用错误。资格化后发现的比较签名和未知版本投影问题由对应回归及最终全量覆盖，两处不改变本次正常 candidate 创作轨迹，未重复消耗 fresh Agent 试次。

## 检查与停止点

当前 AGENTS 禁止委派审核，因此施工包中的 Luna 审核条款未执行。Luna 仅承担共享解析器、依赖图和对应测试的独立并行实现；主代理亲自检查状态原子性、时点事实、引用边界、环、恢复模式、旧数据和严格 schema，并修复上述发现。不能把这写成 Luna 独立审核通过。后续云端独立复审仍待进行。

未修改 Core、Renderer、Host、Shell、Editor 或正式游戏生产源码，未增加依赖、修改权限/审批语义、部署或正式 pack/release。本轮没有重新执行 Electron/新作品视觉人工签收。实现已普通本地提交，停止于 `WAITING_FOR_CLOUD_INDEPENDENT_REVIEW`，未执行 push，没有针对本轮新提交的远端 CI 或云端复审结论。

## 2026-09-11 云端复审定向整改

云端针对累计 `47fd2fa..7e213be` 提出 W8-R2-01、02 两个 HIGH 与 W8-R2-03 一个阻断 push 的 MEDIUM。本轮保留 `8cf275d` 和 `7e213be`，仅追加一个包含代码、测试和本节的普通后继提交；原始验证和 fresh Agent 记录作为首轮历史保留，未重跑 fresh Agent、Electron 或人工 Review 路径。

- **W8-R2-01：重放状态前置关系。** handler 从实际操作前状态记录 `replayStatePreconditions`；角色操作覆盖 `config:characters` 和所有 speaker migration 场景，scene.patch 同时记录其消费的完整场景前态。guard 将其解析为独立的 `replayStateRequirements`：优先最后一个匹配指纹的更早 producer sequence，否则匹配不可变 base。状态边与语义边共用现有 primary-unit 图；缺失、指纹不符或成环均在 CAS 前拒绝。readiness 与 sealer 检查这些已存事实，封装时重新核验来源，不补写旧历史。
- **W8-R2-02：完整产物比较。** 每个 unit 按 objectRef 计算最后 production，保留相对基线的 create/update/remove 语义。identical 签名同时包含 primary、完整最终 footprint，以及规范化的 base/candidate 依赖语义；候选依赖连同生产单元的完整签名比较，排除 artifact ID、operation ID 和内部重放步骤差异。重叠索引覆盖全部产物。同候选共享写入不产生选择冲突；混合重叠按跨候选关系处理，避免选择一个来源时排除该来源自身的必要前置单元。
- **W8-R2-03：成功重试的胶囊幂等。** invocation ledger 保留所有真实调用。仅胶囊事实投影按成功记录的 `(operationId, capabilityId, inputSha256)` 合并等价项；capability 或输入摘要不同仍为歧义，规范输入/摘要/身份检查继续有效。

反例与回归：

- 修改前已复现角色 `zeta → alpha` 的 ready capsule 在计划 dry-run 中报 `OBJECT_REF_STALE`；修复后只选 alpha 会闭合 zeta，并按源顺序成功重放。
- “先 patch 场景、后改名迁移”按状态边重放。与另一候选的场景正文形成真实 secondary 冲突后，测试显式选择迁移来源；最终 integration workingFiles 的场景与角色表逐项等于选定来源，原项目未写入。两个完整迁移 footprint 相同的真实胶囊只重放一条角色操作，同时保留双来源 provenance。
- 同 primary、不同迁移正文；不同角色共享角色表；迁移单元与 scene 单元共享场景；不同依赖前态；相同完整 footprint；最后 state producer 归属；封装时来源篡改/事实缺失，均有定向覆盖。角色表状态环和场景/角色互依环在持久化前拒绝，record、workingRevision、workingFiles 和证据保持不变。
- 两个独立真实 Agent Port 用例均执行首次成功和 exact retry，确认两条成功 invocation 留存、manifest 仅一个 operation、capsule ready；分别追加不同 capability 和不同 input SHA 的成功记录，两种反例均保持 unavailable。
- Q1 的匿名场景子对象遍历、已存在未引用素材与选定来源依赖闭包仍通过。入口字段值相同但来源依赖不同的单元现在明确要求选择，不再冒充 identical；选定来源及其依赖闭包仍保持正确。
- 聚焦测试、Authoring/CLI 类型检查及构建通过。一次聚焦运行中，既有 `plans only with reviewed fingerprint...` 用例触及原 5 秒超时；单独复验 3.733 秒通过，未调整测试门限，不将偶发原因写成已定位。
- 本轮唯一一次最终 `npm run verify:all` 完整通过，退出码 0；14 个现有检查步骤完成，9 个工作区共 296 个测试文件、2,732 项 Vitest 测试通过，其中 Authoring 357 项、CLI 530 项。此前超时的既有用例在本次全量内 2.733 秒通过。类型、内容校验/模拟和构建通过；原有内容与 chunk 警告保留。日志位于 `D:/CodexTasks/surdet-wave8-cloud-repair-20260911/verify-all.log`。

整改提交为本节所在提交，父提交是 `7e213be`；精确 SHA 随 `WAVE8-R2-REVIEW2.patch` 和交付消息提供。累计 patch 范围为 `47fd2fa07cf6502f74cca19403f3c1a7bc30c741..HEAD`。

## 2026-09-11 第二次云端复审：W8-R2-04 定向整改

第二次云端复审确认前三项修复基本通过，但发现角色改名在 integration replay 中重新扫描全部场景，可能产生未封存的场景修改。本轮保留 `8cf275d → 7e213be → 4528a66`，只追加一笔普通本地修复提交。

- 公共 Authoring 层 `replayCompositionOperation` 把封存 operation 的产物和状态前置条件传给角色操作。集成改名只读取声明的迁移场景；普通 candidate/direct 改名仍扫描并自动迁移全部场景。
- 声明场景必须有唯一 before fingerprint、update disposition 和 after fingerprint；先核对当前字节，再计算迁移。返回持久化结果前，将实际完整 produced footprint 与封存对象、disposition、fingerprint 逐项比较。任何缺失、重复、前后指纹失配或声明了却未发生的迁移均拒绝，不写入 operation 或 working files。
- 没有扩展场景依赖图、增加 capability、修改 MCP 输入或提升版本；原有角色表状态边、完整 footprint 比较、exact retry 和 Q1 路径保留。

本轮验证：

- 三个真实 CompositionService 反例修改前均失败：删除最后旧 speaker 后改名并同时选择两单元，dry-run 报对象指纹失配；只选角色单元时原场景被暗改；另一个候选先引入旧 speaker 后也被改名。修复后，三条路径都完成真实胶囊、plan dry-run 与 integration execute，并核对场景字节及原项目不变。
- Authoring 新增 6 项：场景 before 不符、before 缺失、after 不符、没有实际迁移及重复声明均在持久化前拒绝；无场景 footprint 时允许非 speaker-token 显示名，并验证精确重试不重复写入。
- 聚焦验证共 8 文件 / 131 项通过：Authoring 5 文件 / 99 项，CLI 3 文件 / 32 项。覆盖普通自动迁移、已有正向迁移重放、完整 footprint 去重、角色表状态顺序、候选 readiness 与真实 invocation exact retry。Authoring/CLI 类型检查与构建通过。
- 本轮唯一一次最终 `npm run verify:all` 完整通过，退出码 0；14 个现有检查步骤完成，9 个工作区共 296 个测试文件、2,741 项 Vitest 测试通过，其中 Authoring 363 项、CLI 533 项。类型检查、内容校验/模拟与构建通过；既有内容和 chunk 警告保留。日志位于 `D:/CodexTasks/surdet-wave8-cloud-repair-20260911/verify-all-review3.log`。

该轮提交为 `b267b11`，父提交为 `4528a66`；累计 `WAVE8-R2-REVIEW3.patch` 范围为 `47fd2fa07cf6502f74cca19403f3c1a7bc30c741..b267b11`。该轮未重跑 fresh Agent、人工 Review、Editor 或 Electron 专项路径，未 push；第三次云端复审已确认 W8-R2-04 通过，后续状态见下节。

## 2026-09-11 第三次云端复审：W8-R2-05 嵌套场景身份整改

本轮保留 `8cf275d → 7e213be → 4528a66 → b267b11`，追加一笔代码、测试和本文更新的普通本地提交。此前夹具仅覆盖根目录场景，未覆盖项目既有的嵌套路径支持，导致场景语义 ID 与物理路径混用未被发现。

- 公共 `scenario-identity.ts` 统一文件名 stem 与语义 scene ID，按该 ID 唯一反查实际路径；多个文件同 basename 明确报 `OBJECT_AMBIGUOUS`，不优先选择根目录或任意一个路径。
- 项目 snapshot、角色迁移时点 facts、封存角色重放、工作对象指纹，以及胶囊封装的最终产物指纹核对共用解析。`chapter/start.gal` 的对象始终为 `scene:start`，读取和写入保留真实 nested path。
- 没有移动用户场景、增加能力、改变 MCP 输入或版本；封存 footprint 限制、指纹前置条件及写入前原子边界保持不变。

本轮验证：

- 修改前真实 Port 反例确认：嵌套迁移被 `CANDIDATE_OPERATION_FACTS_REQUIRED` 拒绝，根目录与子目录同名却被接受。修改后，嵌套 candidate 改名、语义 facts、ready capsule、plan dry-run 和 integration READY 全链通过；workingFiles 精确等于选定候选，不生成 root `start.gal`，原项目不变。同 basename 的 candidate 改名明确报歧义，持久化 ChangeRecord 零推进。
- Authoring 覆盖嵌套与根目录的同语义指纹、缺失场景、拒绝路径型 objectRef、根目录/嵌套及双嵌套重名；封存重放遇同 basename 时，内存与 repository ChangeRecord 均不变。W8-R2-04 三个真实反例、正向迁移、完整 footprint、exact retry 与既有 Q1 路径继续保留。
- 聚焦验证共 11 文件 / 157 项通过：Authoring 8 文件 / 123 项，CLI 3 文件 / 34 项。Authoring/CLI 类型检查与构建通过。
- 本轮唯一一次最终 `npm run verify:all` 完整通过，退出码 0；14 个现有检查步骤完成，9 个工作区共 296 个测试文件、2,747 项 Vitest 测试通过，其中 Authoring 367 项、CLI 535 项。类型检查、内容校验/模拟与构建通过；既有内容和 chunk 警告保留。日志位于 `D:/CodexTasks/surdet-wave8-cloud-repair-20260911/verify-all-review4.log`。

本轮提交的父提交为 `b267b11`；累计 `WAVE8-R2-REVIEW4.patch` 范围为 `47fd2fa07cf6502f74cca19403f3c1a7bc30c741..HEAD`。未重跑 fresh Agent、人工 Review、Editor 或 Electron 专项路径，未 push；当前停止于等待第四次云端源码复审。

`PUSH_NOT_AUTHORIZED`。完成本地整改后停止于 `WAITING_FOR_CLOUD_INDEPENDENT_REVIEW`，等待第二次云端源码复审，不声称云端已通过。
