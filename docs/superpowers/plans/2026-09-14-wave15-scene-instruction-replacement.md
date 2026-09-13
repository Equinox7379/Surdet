# Wave 15：场景指令原位替换

2026-09-14，Owner 在 Wave 14 `6b25bba` 交付后明确回复“pass，启动新一轮”。本轮从已核实一致的本地与远端 `6b25bbafc7a45ecad18ecfd2c319f44d9831ae48` 开始；tracked 工作树干净，既有未跟踪和受保护材料保留。

目标是让外部 Agent 从真实预览观察定位原指令，通过现有 `scene.patch` 原位修改，再播放核对。新增 `replaceInstruction` 只处理现有 `bg/show/hide/wait` 单行，要求真实目标和原内容指纹；复用隔离事务、编译、差异、依赖、候选封装、组合和重放。其他行、注释、行结束符保留，不追加覆盖指令。场景子目录使用项目已有的唯一身份解析。

初始授权覆盖本轮普通实现、相关检查与本地提交。实现交付后，Owner 于 2026-09-14 明确“push，以后你完成后必须直接push”，授权本轮普通推送，并将完成已授权开发和必要验证后自动普通提交、普通推送设为 Surdet 长期约定，已写入根目录 AGENTS.md 与原台账；无需逐轮确认，用户后续明确的交付限制优先。九月 CI 保持暂停，不增加 Owner 人工任务，不代签未发生的 Owner 体验。无音频、发行、全 Editor 重做、任意多行替换、新运行器或下一波。主代理负责设计、整合、检查、视觉判断与 Git；Luna 仅并行编写独立测试或执行隔离内容创作，不承担审核或验收。

## 实现与验证

- 已先建立共享操作回归：未实现时 22 项中 14 项失败，暴露新增变体尚未处理、子目录无法定位及边界拒绝缺失；这是新能力的首红，不把尚未公开的新变体误称旧产品误删缺陷。场景声明反例首次误取场景父对象，已改为取其指令对象。
- 共享实现已完成：新变体进入原 `runOperation()`，在持久写入之前检查指令对象、场景身份、原内容指纹、单行范围并调用既有 Core 编译；整条指令替换，省略的修饰符不沿用。保留目标行的缩进、尾部空白和换行，其他行不改。拒绝结构指令与 CR/LF/Unicode 行分隔符；同一 operationId 重试复用持久结果。
- `scene.patch` 改用现有唯一场景路径解析，操作事实记录真实路径；子目录与顶层场景共用实现，身份不唯一不猜文件。公开 schema、发现示例与候选审阅展示同步，背景/立绘/等待语义仍交给既有编译、校验和运行器。工具总数仍为 39。
- 新增三个 CLI 真实服务/磁盘用例由 Luna 并行编写并实际执行：MCP 新变体、错误回执与未推进记录、缺少新素材拒绝、嵌套场景省略 sceneId 后封存与依赖、独立候选组合、同场景竞争和续接。主代理已逐段核对实际测试代码与调用链；未让 Luna 代作复审或最终判断。首次开发运行因测试夹具遗漏数据根环境变量失败，补齐后单文件 3/3 与 CLI 类型检查通过。中断用例模拟的是“首条真实 replay 已落盘但 integration 进度回执未更新”，通过正式 executePlan 续接同一结果；没有声称实际杀进程。
- 验证仅覆盖本轮影响，不复跑旧 Q1、Wave 11–14 整套验收或全仓维护。

## 本地检查结果

主代理实际执行并检查输出：

- Authoring `operations.test.ts` 最终 23/23；指令替换、字节保留、嵌套路径、持久重试、旧指纹和拒绝边界通过。
- Authoring `capability-registry` 13、`integration-execution` 18、`diff-ledger` 6、`review-projection` 原有 29 项通过；补入的指令和修饰符审阅用例另行 1/1 通过。各次有效结果复用，不把重跑或分组检查重复相加。
- CLI `authoring-contract` 5、`agent-port-tools` 9、`agent-port-output-contract` 3、`authoring-vertical-slice` 1 项通过；新增的三个组合用例执行来源见上段。
- Authoring / CLI / Editor 类型检查及构建通过；Authoring 首次类型检查发现新增测试把可选 source 当成必有字段，修正测试读取后通过。Editor 保留已有大 chunk 提示，未改性能门限。
- `npm run verify:docs` 与 `git diff --check` 通过。能力矩阵按现有生成命令核对，内容没有变化；没有扩大文档检查范围或启用 CI。

## 真实预览返修

复用现有 `startDevProject`、磁盘桥及 Playwright，隔离项目为 `D:/CodexTasks/surdet-wave15-20260914/project`。磁盘桥只替代原生目录选择器和文件句柄，使用正常项目绑定、Editor 预览及正式 MCP 能力。原生选择器与真实中文输入法的既有暂缓范围不变。

外部 Agent 从目标“去灯塔 → 交出信后凛应微笑”出发，自行发现公开接口、素材与对象，再在同一隔离变更内原位修正。没有预先替它填业务调用参数，也未让它直接写项目文件。

- 修改前：真实试玩抵达目标台词；正式观察 `preview-4ecc778c-fa54-47a1-85f8-1f0cbe47598c` 有 18 条事件，项目版本 `0866e51cd6dbc423f1167903ea292691b1fc8dcff48a59b726223111d2fa5935`。对象为 `scene:start/instruction:16@0866e51c-164525fa`，位于 `content/scenario/chapter/start.gal`。主代理已查看迟疑表情画布。
- 变更 `chg_0001_d688d242-7d3c-4b5e-a04f-3cf682edb765`：校验 0 issues，模拟覆盖 4 个分支，明确 `[0,0]` 路径运行通过；差异仅把原 `  @show lynn:coat hesitant @ right` 改成 `  @show lynn:coat smile @pos=right`，正常 apply 提交成功。
- 正常重载、打开项目和重播后，主代理又通过正式原生 CLI 独立读取 current 观察并从活跃浏览器截图。新观察 `preview-54fd1368-f142-4cda-a743-77a9aad33b7e` 仍为 18 条事件，新版本 `ee141b533180a94dd585b71424ca21ff73ffa6c3dada29b9c198b99b78d7d1cf` 与已提交版本相同；第 16 行只执行一次，状态为 smile。主代理对比两幅真实画布确认表情变化，并逐字核对磁盘只替换一行、注释/台词/分支均保留。
- 原始调用与截图在 `D:/CodexTasks/surdet-wave15-20260914/`，包括 `mcp-wave15-change-diff.json`、`mcp-wave15-change-commit.json`、`mcp-preview-baseline-wave15.json`、`mcp-preview-postcommit-wave15.json`、`root-current-observation.json`、`root-check-result.json`、前后画布及 `root-current-canvas.png`。这些本机材料不纳入 Git。
- 协助边界：首次打开项目的脚本超过工具时限，随后读取页面确认已加载；选项点击沿用上轮已给出的画布操作提示。未把它称为完全无协助一次成功，未把结构化表现状态单独当成像素证明。没有新增 Owner 体验记录。

初次实现提交为 `a4e3c6af18aa2cb904b7c41c92e519cf02630f29`，随后连同授权记录 `6916076b3554ce89fa7f35dc79dfc0c25e2188ee` 普通推送。组合粒度保持既有场景对象，不宣称新增了跨候选的任意指令级合并；未扩展到控制流指令或多行替换。云端随后发现的旧引用遗漏及本地补修如下。

## 旧指令引用补修（2026-09-14）

- 开工核实本地与远端 `main` 均为 `6916076b3554ce89fa7f35dc79dfc0c25e2188ee`，tracked 工作树干净，原有未跟踪材料保留。沿用已登记的普通实现、验证、提交与推送授权；云端本次未签最终 PASS。
- 已核实桌面候选补丁及真实调用链：相同指令发生行号移动后，原文指纹仍可能匹配错误位置。补修在 `AuthoringService.scenePatch()` 的既有变更租约内，用当前工作快照的对象索引核对新 `replaceInstruction` 请求的完整引用；过期请求返回 `OBJECT_PRECONDITION_FAILED`，不重定位、不推进持久记录、不写来源项目。
- 已成功记录的 operationId 继续交给原 `runOperation()`：相同负载返回原结果，不同负载返回 `OPERATION_ID_CONFLICT`。MCP 和原生 authoring 调用共用该服务入口；封存候选重放仍直接使用共享操作及原组合约束，没有修改封存输入或要求候选版本等于组合后的全项目版本。
- 主代理先仅应用补丁中的两个回归，在未修复服务上实际执行：stage / apply 均因旧请求被接受而失败。应用生产修正后，完整 `scene-instruction-replacement.test.ts` **5/5 通过**，覆盖旧引用拒绝后完整记录和来源磁盘不变、重新查询后只改第 6 行、成功请求重试和变负载冲突，以及原有子目录封装、独立候选组合、同场景冲突和同一 integration 续接。测试通过真实 MCP 协议投影、服务、编译与磁盘存储，连接使用 InMemoryTransport；未将其称为独立进程或浏览器验收。
- CLI 类型检查、构建均通过。主代理核对最终生产差异仅为服务入口的 9 行检查；复用前述仍有效的画面及共享层验证，不重跑旧 Q1、全仓或整套浏览器流程。原始输出保留在 `D:/CodexTasks/surdet-wave15-20260914/stale-reference/` 的 `red-tests.log`、`green-tests.log`、`typecheck.log` 和 `build.log`，不纳入 Git。

此项已修复并完成定向验证，普通推送后等待云端定向复核；不代签最终 PASS 或 Owner 体验，九月 CI 继续暂停。
