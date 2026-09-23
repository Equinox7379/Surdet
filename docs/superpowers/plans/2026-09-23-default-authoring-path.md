# 下一阶段：外部 Agent 默认完整创作路径

状态：**A1–A3 已实现并验证，继续 B1**。Owner 在审阅 `86963df` 的云端意见后授权核实后开工；后续允许 6luna 辅助简单任务。主代理负责设计、代码、复核、验收与 Git，仅将指南的机械补写交给 6luna；不启动陌生创作实验，不另开规格或报告。

核对基线：`b652128d6c06363301e8b5217320bdfa337a2ce7`；最近代码基线为已通过审核的 `389c5ed`。本计划依据当前源码及既有验证记录；本轮未执行新行为反例，不把静态核对写成运行复现。9 月 19 日发展报告仅作建议来源，已经修复的维护问题不重新立项。

## 1. 要交付的结果

陌生内容作者只凭当前创作指南和正式工具，能在普通项目中完成：**发现能力 → 读取当前内容 → 隔离编写 → 试玩 → 根据错误返修 → 明确交付 → 人类继续编辑**。

主验证任务使用既有 Starter 的隔离测试项目、现有素材和共享 Player：制作含跨场景回访、条件选择、两个可达结局及非音频演出的短章；中途修改一次已写正文和标签，经历一次可自行处理的输入/运行错误，关闭并续接同一草稿，再按授权写回、重开和游玩。它是工具路径验证，不是新作品生产或商业品质验收。

不包含：Editor 换框架或重新设计外观、内置模型/聊天/Agent 调度、音频生产、新美术、任意文件修改工具、通用批处理/插件系统、发行身份迁移、安装包、部署和恢复托管 CI。原生目录选择器/中文输入法仍按 Owner 既有决定暂缓。

## 2. 当前事实与对应工作

| 已核对的事实 | 当前源码入口 | 对应项 |
| --- | --- | --- |
| `scene.create`/`scene.patch` 示例仍有 `set` 参数缺少运算符、示例跳转标签未建立的问题；指南混合内容创作和底层装配 | [注册表](../../../packages/authoring/src/capability-registry.ts)、[AI 指南](../../AI-GUIDE.md) | A1 |
| 能力描述返回完整注册表；会话已能报告权限/状态下的实际可用性，不能另造可用性真相 | [AuthoringService.describeCapabilities](../../../packages/cli/src/authoring/authoring-service.ts)、[session.describe](../../../packages/cli/src/agent-port/session.ts) | A1 |
| `project.inspect`/`project.assets` 读正式项目；`object.inspect`/gallery/校验/模拟可读 active change，读取范围不一致 | [dispatcher](../../../packages/cli/src/authoring/authoring-dispatcher.ts) | A2 |
| 场景对象已有 `childRefs`，不是完全无法发现；但没有有界整段正文读取，patch 主要返回路径/行号/类型 | [对象索引](../../../packages/authoring/src/object-index.ts)、[scenePatch](../../../packages/cli/src/authoring/authoring-service.ts) | A2 |
| `INVALID_REQUEST` 默认 same-request；模拟提示调整预算，但公开 schema/dispatcher/service 只透传 sceneId/seed | [错误目录](../../../packages/authoring/src/error-catalog.ts)、[SimulationOptions](../../../packages/authoring/src/simulation.ts) | A3 |
| 失败运行已有 events；服务在写 trace 之前抛错，公开 read-trace 无从读取该次失败轨迹 | [AuthoringService.runFrom](../../../packages/cli/src/authoring/authoring-service.ts) | A3 |
| `change.begin` 以 policy 直接选择 candidate/direct；底层已经实现两种隔离变更，无须重建事务 | [dispatcher](../../../packages/cli/src/authoring/authoring-dispatcher.ts)、[begin](../../../packages/cli/src/authoring/authoring-service.ts) | B1 |
| 标签暴露为 `label:scene.name`，通用单行 patch 却按带行号引用定位，标签续修链不完整 | [contracts](../../../packages/authoring/src/contracts.ts)、[patchLineIndex](../../../packages/authoring/src/operations.ts) | B2 |
| 模板已使用共享 Player，但副标题、标题背景、结束场景仍硬编码在 main.ts | [模板入口](../../../packages/cli/templates/game/src/main.ts)、[PlayerProject](../../../examples/shared/player/player.ts) | C1 |

这些事实决定范围；不能把“还可优化”的旁支自动加入计划。事务补偿、存读档、资源迁移和 A 工作台的已通过维护不重开。

## 3. 分批与依赖

| ID | 可交付结果 / 主要责任区 | 前置条件 | 当前状态 |
| --- | --- | --- | --- |
| A1 | 可信的创作入口、可执行示例、精简能力发现；Authoring/CLI/文档 | 现有基线 | 已完成 |
| A2 | 明确读视图、场景片段和修改后续接事实；Authoring/CLI | A1 的 schema/示例检查可复用 | 已完成 |
| A3 | 可执行错误修复、模拟预算和失败轨迹；Authoring/CLI/MCP | A1；与 A2 的来源字段一致 | 已完成 |
| B1 | 无来源写权限的普通隔离创作；Authoring/CLI/会话/封装 | A2、A3 | 施工中 |
| B2 | direct 精确标签修改和真实引用一致性；Authoring/候选拒绝边界 | A2、B1 | 待实施 |
| C1 | 无须编辑 Player 源码的普通项目收尾；配置操作/模板/共享 Player | B1、B2；A 组指南可更新 | 待实施 |
| V1 | 完整创作、返修、续接与交付的集成验证；主代理负责 | A1–C1 | 待实施；陌生 Agent 实验另按授权 |

按 **A1 → A2 → A3 → B1 → B2 → C1 → V1** 执行。三个批次分别交付“入口与反馈自洽”“普通章节可连续创作”“普通项目可交付”，复用本文件更新进度，不每个接口另开 Wave/规格/报告。6luna 仅辅助可独立并行的简单执行，不承担审核、验收或 Git。

## 4. 各项实施与验收

### A1：公开入口自洽

- 修改既有 `docs/AI-GUIDE.md`，以内容创作主路径开篇；开发接线知识指向现有架构/迁移资料，不要求内容 Agent 先读源码和长期台账。环境准备复用 `surdet new`、`dev:project`、Agent Port，不重写 launcher。
- 修正注册表示例的真实语法、变量、标签和依赖；扩展既有 `capability-registry.test.ts` 与 CLI 纵向检查。正常成功示例须用真实准备出来的项目事实执行，不能只断言示例对象存在或通过 JSON schema。
- `capabilities.describe` 在原入口增加按能力 ID 选择及摘要/完整详情读取；所有描述仍来自同一注册表。先做 ID 与 detail 两个实际需求，不预建分类平台。省略参数保留现有完整描述行为，摘要不得被解释为已获权限；可用性仍以 `session.describe` 为准。
- **验收：** 按指南建立普通测试项目，客户端仅靠公开输出取得必要前置事实；示例能真实编译/执行；未授权能力仍被拒绝，完整描述的原调用不回归。无需先改任何写入保护。

### A2：让 Agent 明确自己读到什么、接着能改什么

- 为 project/object/assets/gallery 的相关读取统一提供显式 `view: project | working` 选择，复用已有项目快照和工作文件存储；输出来源与 envelope 的 projectRevision/changeId/workingRevision 必须一致。working 无 active change 时明确失败，不退回正式项目。
- 不静默改变已有省略参数调用的默认范围；新版指南始终显式选择来源。既有 `runtime.read-preview` 的四类来源保持原合同，只做清楚对应，不增加字段别名或第二套视图存储。
- 在 `object.inspect` 的场景读取上提供有界片段选项：完整行文本、来源行、实际对象引用和分页/截断信息；复用既有 `childRefs`/结构解析。固定有限返回量，越界输入拒绝；正文、对象与分页结果必须来自同一快照，不伪造可写引用。
- 续页请求必须携带并核对首页的 revision/workingRevision；版本变化明确要求重读，不只返回版本让调用方自行发现拼接错误，不另存长期快照。
- 修改成功后给出本次确切工作版本和可重新定位的父场景/受影响对象入口。删除不制造“替代对象”；旧回执重放与当前续接事实分开，不能把旧 operationId 的历史结果冒充当前 fresh 引用。
- **验收：** 创建新场景后 working 概览能发现它、project 概览仍无它；嵌套路径、重复台词、行位移和跨场景修改下继续精确定位；旧引用拒绝，新引用可修改；分页无静默丢行或跨版本拼接。素材事实不得混入其他项目或错误来源。

### A3：错误后能在同一进度里继续

- 区分“输入需要修改”与“结果未知需核对原操作”，修正错误目录及输入模板；保留实际 operationId、是否已发生操作、当前权限和可读取父对象等事实，不统一自动重试。
- 将已有 `maxPaths`、`maxStepsPerPath` 接到 `project.simulate` 的 schema、dispatcher、项目/工作变更两条 service 路径；采用有界正整数输入，保留现有默认预算，非法/过大值拒绝。预算不足继续报告 incomplete，错误附可执行参数或分段方案，不抬高全局默认值来掩盖失败。
- 当 `runExplicitPath` 返回失败结果时，先在原 trace store 保存该次已收集的轨迹，再返回带 traceId 和定位信息的失败；运行前就失败时不得伪造轨迹。read-trace 能区分状态/版本，失败记录不产生 passed 证据或放行提交。
- 检查实际 MCP 传输与 SDK schema 拒绝路径，不只验证内部 envelope。可改善错误投影和定位，但不移除 schema、不复制 SDK、不用假成功把协议错误包装成业务通过。
- **验收：** 客户端能按公开错误修正输入、调整模拟预算、读取失败前事件并继续原 change；重复查询/请求不重复写入；失败资格不进入提交条件。确实需要批准或恢复的情况仍停止相应写入。

### B1：分开创作方式与来源写权限

- 在 `change.begin` 增加可选 `compositionMode: direct | candidate`，调用既有底层实现。direct 是普通隔离草稿，绝不表示直接改源文件。新内容指南显式使用 stage + direct；已有省略字段的 stage→candidate、apply→direct 行为保留，因为现有客户端与候选测试真实依赖它。
- observe 仍不能 begin/编辑；stage 可在两种模式下编辑、验证、试玩，但始终不能 commit 来源；apply 的写入保护及 integration 的批准要求不变。不新增权限档位，不允许模型在会话内提权。
- 模式创建时保存并在 session.describe/交付中明确投影；恢复沿原记录模式，不按新会话 policy 重写。已有 record/capsule/review 保持真实身份，不回填缺失历史事实或伪造组合资格。
- 普通 direct 草稿可出现据点→商店→据点这样的剧情回访；candidate 继续执行既有操作依赖和环检查。普通结果使用现有 `change.diff`、`working-change` 试玩和原 change 续接进行审读/返修；session.nextActions 不把正常 direct 当作坏候选只推荐 rollback。
- 普通交付胶囊固定交付事实，不因可读取而获得候选组合、正式结果审阅或批准资格；后续工作版本不得冒充胶囊封存版本。本轮不新增独立审批流程，明确授权的 apply 会话仍沿原保护写回。
- **验收：** 真实 stage 进程创建普通回访章节、关闭后恢复同一 change 并继续；整个 stage 期间来源不变。明确启动 apply 后才可按原校验写回；旧 candidate 比较/重放/批准链照常工作，普通草稿拒绝冒充可组合候选。

### B2：补齐标签的精确续修

- 在既有 scene patch 中承接标签语义身份和内容指纹，提供明确的标签改名/删除行为；复用当前引用分析，不让 Agent 拼匿名行号，不新建对象 UUID 或全项目迁移系统。
- 改名在同一隔离操作中更新项目支持的实际引用；删除存在引用时拒绝并返回具体引用方。按 Core 的真实目标语义覆盖本场景 goto/loop、跨场景 jump/call 和选择项内目标，逐处定位参数，不全文替换，不把现有 referencedBy 当作完整标签调用清单。无法安全判断的相关引用明确拒绝；冲突标签、嵌套场景路径、行尾及未修改正文保持正确。
- 新增标签改名/删除本轮仅支持 direct；candidate 在落盘前拒绝这些新变体，既有 scene.patch 变体与候选比较/重放/批准链不变。今后若开放候选，必须完整记录全部受影响场景的前置状态、产物、冲突和重放，不能只放开入口。
- **验收：** A 定义标签、B 用 call A.标签 时，删除拒绝，改名正确更新 B；正文和其他场景的同名标签不变。无引用删除成功；同操作重试幂等，陈旧引用拒绝。candidate 拒绝新变体且记录与正文不变，原候选能力不回归。

### C1：普通项目的收尾不再依赖手改播放器

- 在现有 `game.config.json` 中定义共享 Player 实际消费的有限展示配置（副标题、标题背景、结束场景与首次提示）；标题沿已有字段，保存身份继续来自 package name，不因改展示标题迁移或串用存档。
- 复用 `config-operations.ts` 提供受指纹保护的窄字段修改，检查背景/场景引用并保留未知字段；不开放任意 JSON/源码覆盖。此阶段服务普通 direct 项目；若未实现候选事实与重放，该操作必须明确标为不可组合并在 candidate 内拒绝，不能靠隐藏限制伪装通用支持。
- 既有公开读取投影这组有限配置的当前值、明确缺省状态和修改指纹，遵循 A2 的 project/working 选择；修改后能重新读取，旧指纹拒绝。不要求 Agent 读取任意 JSON 或自行猜测/计算指纹。
- 消费优先级固定为：既有显式 PlayerProject 参数 > game.config.json 对应配置 > 不依赖具体示例场景/素材的默认行为。区分字段未提供和明确清空，例如空字符串首次提示不得回落到默认提示。
- 模板和共享 Player 消费上述配置，去除新项目对 `harbor`/`ch01_01` 的硬编码依赖。既有显式 PlayerProject 参数的真实消费者继续有效；不强迁移 Zero 独立入口，不改正式作品。不修改 Node/Electron 发行身份或存档 schema。
- 已有 Editor 读取/保存配置不得丢字段，内容仍能正常编辑；构建和试玩复用既有工具，不加“发布管理器”或新设置平台。
- **验收：** 新项目仅用公开读取与窄字段修改即可配置自己的入口、标题背景与两个结局并实际生效；没有改 src/main.ts，正常开始/结束、保存重开和 Editor 续写均成功，既有显式参数消费者不回归。明确交付开发项目，不称为安装包或商业发行品。

## 5. 集成验证与停止标准（V1）

| 要证明的行为 | 使用现有路径 / 必须观察的结果 |
| --- | --- |
| 真实公开入口可用 | 现有 MCP 客户端往返，不能以直接调用内部 service 代替全部集成检查；错误、schema、可用性和回执一致 |
| 内容读取与续修 | A2 的读视图、片段、陈旧引用反例；Agent 不需读源码取得必要事实 |
| 普通章节安全续接 | stage + direct 回访章节及进程重开；同一 change 可继续，来源不变，未知结果先查询原操作 |
| 原候选能力保持 | 聚焦 candidate/manifest/replay 测试及必要的现有 Review 批准写回真实流程；不替用户伪造批准 |
| 项目真实可玩可编辑 | 复用 new-project-player、Editor 保存重开与受影响 Player 检查；两个结局、一次存读档、继续编辑成立 |
| 陌生 Agent 是否顺畅 | 如获授权，由无源码/本任务上下文的外部创作者执行；只给自然题目和正式入口，保留首次结果与技术救援记录。技术脚本通过不能冒称此项通过 |

不要求 Owner 跑命令或人工兜底。主代理完成所有审核和验收判断；本计划不授权启动新 AI 会话。陌生创作者由 Owner 提供或在该验证环节明确授权合规执行者，只负责创作、不承担复审。没有完成独立试验时，只登记“工程路径通过，陌生 Agent 顺畅度未实测”，不隐瞒边界。

故障恢复由定向病例保证，与陌生作者自然创作分开：不强迫自然创作者犯错，也不把主代理安排的恢复脚本称作陌生 Agent 自修成功。

## 6. 检查、版本与恢复

按实际改动选已有检查，不每个小项重复全套。Authoring 重点复用 capability-registry/object-index/operations/error-catalog/simulation/composition 测试；CLI 重点复用 authoring-contract/runtime-parity/observe-mode、agent-port-tools/session/security/capsule/composition 及配置测试。

```powershell
npm run test -w @surdet/authoring -- test/capability-registry.test.ts test/object-index.test.ts test/error-catalog.test.ts
npm run test -w @surdet/cli -- test/authoring-contract.test.ts test/agent-port-tools.test.ts test/agent-port-session.test.ts
npm run typecheck -w @surdet/authoring -w @surdet/cli
npm run build -w @surdet/authoring -w @surdet/cli
npm run verify:docs
```

这些是后续执行入口，本次规划没有运行上述代码测试。构建顺序沿仓库依赖；C1 再验证实际受影响 Player/模板，公共 Renderer 或 Core 未改时不机械重跑其全包。合同变化按现有版本机制处理；只更新真实改变的合同版本，不给每个任务另建版本账本。已存在的调用默认值、记录、封存身份和输入错误格式必须在变更前列入回归，不凭想象搭双版本 API。

仍使用现有 Node change store、trace/evidence 文件、项目租约和 Editor authority；不引入数据库、后台队列或新传输层。正常失败在原事务/操作上核对、恢复或明确回退；不删除恢复屏障，不修改旧批准，不自动重建项目。验证写入使用任务内隔离夹具，不碰 Owner 唯一项目；没有真实冲突不另建引擎 worktree 或重装依赖。

## 7. 当前下一步与记录方式

**当前推进 B1**，A 组已落地，公开合同升至 2.5.0。A1 的 MCP 反例首先复现了示例缺少 set 运算符；A2 复现了缺失视图输入，随后验证版本锁定分页；A3 复现了公开预算缺失，并发现单路径步数耗尽原先被误记为运行错误，现统一为 incomplete。

有效验证（2026-09-23）：Authoring 注册表 15 项、对象索引 5 项、simulation/error-catalog 20 项通过；CLI/MCP 首批兼容检查 45 项通过；最新 A2/A3 相关 tools/output-contract/runtime-parity/observe/session/review-preparation/security 共 61 项通过。Authoring/CLI 类型检查、构建与 verify:docs 通过。测试中的错误路径、预算与续页反例在同一变更中恢复，不代签真实画面或陌生 Agent 实验。

失败轨迹保存在原 trace store，失败调用审计保留 traceId；不追加到原审阅通过证据清单，不修改批准门。read-trace 从记录读取 failed 状态和原 workingRevision，已有 passed 轨迹的资格规则不变。6luna 只补了指南“预算与失败后继续”段落，主代理已逐项核对。

Owner 已授权实施。主代理沿本表连续推进，在本文件更新完成项、有效验证和剩余问题，在有恢复价值的节点普通提交；不把每个接口拆成需 Owner 回复“继续”的任务。出现确切业务取舍或越出授权时才暂停相应动作。普通开发交付沿既有授权提交、推送、等待独立复审；CI、音频生产、发行与部署继续暂停。
